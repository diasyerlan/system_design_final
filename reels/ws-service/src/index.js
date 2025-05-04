const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const redis = require('redis');
const { v4: uuidv4 } = require('uuid');

// Initialize express app
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Environment variables
const PORT = process.env.PORT || 4000;
const SHARD_ID = process.env.SHARD_ID || '1';
const REDIS_URI = process.env.REDIS_URI || 'redis://redis:6379';

console.log(`Starting WebSocket Shard ${SHARD_ID}`);

// Client connections store
const clients = new Map();

// Redis client for pub/sub
const redisClient = redis.createClient({
  url: REDIS_URI,
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    shardId: SHARD_ID,
    connections: clients.size,
    timestamp: new Date().toISOString()
  });
});

// Connect to Redis
(async () => {
  await redisClient.connect();
  console.log('Connected to Redis');

  // Create subscriber client
  const subscriber = redisClient.duplicate();
  await subscriber.connect();

  // Subscribe to reel events
  await subscriber.subscribe('reel:created', (message) => {
    broadcastToAll('NEW_REEL', JSON.parse(message));
  });

  await subscriber.subscribe('reel:liked', (message) => {
    broadcastToAll('REEL_LIKED', JSON.parse(message));
  });
})().catch(err => console.error('Redis connection error:', err));

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const clientId = uuidv4();
  const userId = getUserIdFromRequest(req);
  
  console.log(`[Shard ${SHARD_ID}] Client connected: ${clientId}, userId: ${userId || 'anonymous'}`);
  
  // Store client information
  clients.set(clientId, {
    ws,
    userId,
    connectedAt: new Date().toISOString(),
    shardId: SHARD_ID
  });

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'CONNECTED',
    data: {
      clientId,
      shardId: SHARD_ID,
      message: `Connected to WebSocket server, shard ${SHARD_ID}`
    }
  }));

  // Message handler
  ws.on('message', async (message) => {
    try {
      const parsedMessage = JSON.parse(message);
      console.log(`[Shard ${SHARD_ID}] Received: ${message}`);

      switch (parsedMessage.type) {
        case 'PING':
          ws.send(JSON.stringify({
            type: 'PONG',
            data: { timestamp: new Date().toISOString() }
          }));
          break;
          
        case 'SUBSCRIBE_USER':
          if (parsedMessage.userId) {
            // Update client with user ID
            clients.set(clientId, {
              ...clients.get(clientId),
              userId: parsedMessage.userId
            });
            
            // Register to user channel in Redis
            await redisClient.publish('user:online', JSON.stringify({
              userId: parsedMessage.userId,
              shardId: SHARD_ID,
              clientId
            }));
            
            ws.send(JSON.stringify({
              type: 'SUBSCRIBED',
              data: { userId: parsedMessage.userId }
            }));
          }
          break;
          
        default:
          console.log(`[Shard ${SHARD_ID}] Unknown message type: ${parsedMessage.type}`);
      }
    } catch (err) {
      console.error(`[Shard ${SHARD_ID}] Error processing message: ${err.message}`);
    }
  });

  // Close handler
  ws.on('close', () => {
    const client = clients.get(clientId);
    
    if (client && client.userId) {
      // Notify Redis that user disconnected
      redisClient.publish('user:offline', JSON.stringify({
        userId: client.userId,
        shardId: SHARD_ID,
        clientId
      })).catch(err => console.error('Redis publish error:', err));
    }
    
    // Remove client from map
    clients.delete(clientId);
    console.log(`[Shard ${SHARD_ID}] Client disconnected: ${clientId}`);
  });

  // Error handler
  ws.on('error', (error) => {
    console.error(`[Shard ${SHARD_ID}] WebSocket error for client ${clientId}:`, error);
  });
});

// Utility to extract user ID from request
function getUserIdFromRequest(req) {
  // In a real app, you would parse a JWT token or session cookie
  const queryString = new URL(req.url, 'http://localhost').searchParams;
  return queryString.get('userId');
}

// Broadcast message to all connected clients
function broadcastToAll(type, data) {
  const message = JSON.stringify({ type, data });
  console.log(`[Shard ${SHARD_ID}] Broadcasting: ${type} to ${clients.size} clients`);
  
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}

// Broadcast message to specific user across all connections
function broadcastToUser(userId, type, data) {
  const message = JSON.stringify({ type, data });
  console.log(`[Shard ${SHARD_ID}] Broadcasting to user ${userId}: ${type}`);
  
  let sentCount = 0;
  
  clients.forEach((client) => {
    if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
      sentCount++;
    }
  });
  
  return sentCount;
}

// Start the server
server.listen(PORT, () => {
  console.log(`WebSocket shard ${SHARD_ID} server running on port ${PORT}`);
}); 