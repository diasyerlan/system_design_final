const express = require('express');
const { Pool } = require('pg');
const redis = require('redis');
const morgan = require('morgan');
const cors = require('cors');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3000;
const SERVICE_ID = process.env.SERVICE_ID || '1';

// Middleware
app.use(express.json());
app.use(morgan('combined'));
app.use(cors());
app.use(helmet());

// Database connection with PgBouncer
const pgPool = new Pool({
  connectionString: process.env.PGBOUNCER_URI || 'postgres://postgres:postgres@pgbouncer:6432/reelsdb',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Redis client for caching and pub/sub
const redisClient = redis.createClient({
  url: process.env.REDIS_URI || 'redis://redis:6379',
});

(async () => {
  // Connect to Redis
  await redisClient.connect();

  // Subscribe to relevant channels
  const subscriber = redisClient.duplicate();
  await subscriber.connect();
  await subscriber.subscribe('reel:created', (message) => {
    console.log(`[Service ${SERVICE_ID}] New reel created: ${message}`);
  });

  await subscriber.subscribe('reel:liked', (message) => {
    console.log(`[Service ${SERVICE_ID}] Reel liked: ${message}`);
  });
})().catch(err => console.error('Redis connection error:', err));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    serviceId: SERVICE_ID,
    timestamp: new Date().toISOString()
  });
});

// API routes
app.get('/api/reels', async (req, res) => {
  try {
    // Check cache first
    const cacheKey = 'reels:latest';
    const cachedReels = await redisClient.get(cacheKey);
    
    if (cachedReels) {
      console.log('Cache hit for latest reels');
      return res.json(JSON.parse(cachedReels));
    }

    // If not in cache, query database
    const result = await pgPool.query(
      'SELECT * FROM reels ORDER BY created_at DESC LIMIT 20'
    );
    
    // Store in cache for 5 minutes
    await redisClient.set(cacheKey, JSON.stringify(result.rows), {
      EX: 300
    });

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching reels:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/reels/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Check cache first
    const cacheKey = `reel:${id}`;
    const cachedReel = await redisClient.get(cacheKey);
    
    if (cachedReel) {
      console.log(`Cache hit for reel:${id}`);
      return res.json(JSON.parse(cachedReel));
    }

    // If not in cache, query database
    const result = await pgPool.query(
      'SELECT * FROM reels WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reel not found' });
    }
    
    // Store in cache for 15 minutes
    await redisClient.set(cacheKey, JSON.stringify(result.rows[0]), {
      EX: 900
    });

    res.json(result.rows[0]);
  } catch (error) {
    console.error(`Error fetching reel ${id}:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/reels', async (req, res) => {
  const { user_id, video_url, caption } = req.body;

  if (!user_id || !video_url) {
    return res.status(400).json({ error: 'Missing required fields: user_id and video_url are required' });
  }

  // Validate that video_url is a CDN URL
  if (!video_url.startsWith('/cdn/')) {
    return res.status(400).json({ error: 'Video URL must be a CDN URL' });
  }

  try {
    const result = await pgPool.query(
      'INSERT INTO reels (user_id, video_url, caption) VALUES ($1, $2, $3) RETURNING *',
      [user_id, video_url, caption]
    );
    
    const newReel = result.rows[0];
    
    // Invalidate cache
    await redisClient.del('reels:latest');
    
    // Publish event to Redis
    await redisClient.publish('reel:created', JSON.stringify(newReel));
    
    res.status(201).json(newReel);
  } catch (error) {
    console.error('Error creating reel:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/reels/:id/like', async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pgPool.query(
      'UPDATE reels SET likes = likes + 1 WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reel not found' });
    }
    
    const updatedReel = result.rows[0];
    
    // Invalidate cache
    await redisClient.del(`reel:${id}`);
    
    // Publish event to Redis
    await redisClient.publish('reel:liked', JSON.stringify({
      id,
      likes: updatedReel.likes
    }));
    
    res.json(updatedReel);
  } catch (error) {
    console.error(`Error liking reel ${id}:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Reels service ${SERVICE_ID} running on port ${PORT}`);
}); 