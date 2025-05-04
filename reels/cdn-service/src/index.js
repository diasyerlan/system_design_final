const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const mime = require('mime-types');
const redis = require('redis');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 5000;
const STORAGE_PATH = process.env.STORAGE_PATH || path.join(__dirname, '../public');
const CACHE_TTL = parseInt(process.env.CACHE_TTL) || 86400; // 24 hours in seconds

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_PATH)) {
  fs.mkdirSync(STORAGE_PATH, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    
    const dirPath = path.join(STORAGE_PATH, `${year}/${month}/${day}`);
    
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    cb(null, dirPath);
  },
  filename: function(req, file, cb) {
    const uniquePrefix = uuidv4();
    const extension = path.extname(file.originalname);
    cb(null, `${uniquePrefix}${extension}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 250 * 1024 * 1024 }, // 250MB limit
  fileFilter: (req, file, cb) => {
    // Accept videos and images
    if (file.mimetype.startsWith('video/') || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video and image files are allowed'), false);
    }
  }
});

// Redis client for caching
const redisClient = redis.createClient({
  url: process.env.REDIS_URI || 'redis://redis:6379',
});

(async () => {
  await redisClient.connect();
  console.log('Connected to Redis');
})().catch(err => console.error('Redis connection error:', err));

// Middleware
app.use(cors());
app.use(helmet({ crossOriginResourcePolicy: false })); // Allow cross-origin resource sharing for CDN
app.use(compression());
app.use(express.json());
app.use(morgan('combined'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // 500 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/upload', limiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Serve static files with caching headers
app.use('/public', express.static(STORAGE_PATH, {
  maxAge: CACHE_TTL * 1000, // Convert to milliseconds
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', `public, max-age=${CACHE_TTL}`);
    res.setHeader('Content-Type', mime.lookup(path) || 'application/octet-stream');
  }
}));

// File upload endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.file;
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    
    // Create thumbnail for videos and images
    let thumbnailPath = null;
    if (file.mimetype.startsWith('image/')) {
      thumbnailPath = path.join(
        path.dirname(file.path),
        `thumb_${path.basename(file.path)}`
      );
      
      await sharp(file.path)
        .resize(200, 200, { fit: 'inside' })
        .toFile(thumbnailPath);
    }
    
    // Calculate relative paths for URLs
    const relativeFilePath = path.relative(STORAGE_PATH, file.path).replace(/\\/g, '/');
    const cdnUrl = `/cdn/${relativeFilePath}`;
    
    let thumbnailUrl = null;
    if (thumbnailPath) {
      const relativeThumbnailPath = path.relative(STORAGE_PATH, thumbnailPath).replace(/\\/g, '/');
      thumbnailUrl = `/cdn/${relativeThumbnailPath}`;
    }
    
    // Return file URLs
    res.status(201).json({
      fileUrl: cdnUrl,
      thumbnailUrl,
      filename: path.basename(file.path),
      size: file.size,
      mimetype: file.mimetype
    });
  } catch (error) {
    console.error('Error processing upload:', error);
    res.status(500).json({ error: 'File upload failed' });
  }
});

// Image resize endpoint (on-the-fly resizing)
app.get('/resize/:width/:height/*', async (req, res) => {
  try {
    const width = parseInt(req.params.width, 10);
    const height = parseInt(req.params.height, 10);
    
    // Limit dimensions for security
    if (width > 2000 || height > 2000 || width < 1 || height < 1) {
      return res.status(400).json({ error: 'Invalid dimensions' });
    }
    
    // Get the requested file path
    const filePath = req.params[0];
    const fullPath = path.join(STORAGE_PATH, filePath);
    
    // Check if file exists
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Check if it's an image
    const mimeType = mime.lookup(fullPath);
    if (!mimeType || !mimeType.startsWith('image/')) {
      return res.status(400).json({ error: 'Not an image file' });
    }
    
    // Generate cache key
    const cacheKey = `resize:${width}:${height}:${filePath}`;
    
    // Check cache first
    const cachedImageBuffer = await redisClient.get(cacheKey);
    if (cachedImageBuffer) {
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', `public, max-age=${CACHE_TTL}`);
      res.setHeader('X-Cache', 'HIT');
      return res.send(Buffer.from(cachedImageBuffer, 'binary'));
    }
    
    // Resize image
    const imageBuffer = await sharp(fullPath)
      .resize(width, height, { fit: 'inside', withoutEnlargement: true })
      .toBuffer();
    
    // Cache the result
    await redisClient.set(cacheKey, imageBuffer, {
      EX: CACHE_TTL,
      NX: true
    });
    
    // Send response
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', `public, max-age=${CACHE_TTL}`);
    res.setHeader('X-Cache', 'MISS');
    res.send(imageBuffer);
  } catch (error) {
    console.error('Error resizing image:', error);
    res.status(500).json({ error: 'Image processing failed' });
  }
});

// Purge cache endpoint (for administrators)
app.delete('/cache/:path(*)', async (req, res) => {
  try {
    const pathToPurge = req.params.path;
    const pattern = `*${pathToPurge}*`;
    
    // Find all keys matching the pattern
    let cursor = 0;
    let keys = [];
    
    do {
      const result = await redisClient.scan(cursor, {
        MATCH: pattern,
        COUNT: 100
      });
      
      cursor = result.cursor;
      keys = keys.concat(result.keys);
    } while (cursor !== 0);
    
    // Delete all matching keys
    if (keys.length > 0) {
      await redisClient.del(keys);
      res.json({ purged: keys.length, keys });
    } else {
      res.json({ purged: 0, message: 'No matching cache entries found' });
    }
  } catch (error) {
    console.error('Error purging cache:', error);
    res.status(500).json({ error: 'Cache purge failed' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`CDN service running on port ${PORT}`);
}); 