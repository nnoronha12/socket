const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const httpServer = createServer(app);

// Enable CORS for all origins
app.use(cors());
app.use(express.json());

// Create Socket.IO server with CORS configuration
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Store connected clients by sessionId
const clients = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`[Socket.IO] Client connected: ${socket.id}`);
  
  // Handle client joining a session room
  socket.on('join', ({ sessionId }) => {
    console.log(`[Socket.IO] Client ${socket.id} joining session: ${sessionId}`);
    socket.join(sessionId);
    clients.set(sessionId, socket.id);
  });
  
  // Handle client leaving a session room
  socket.on('leave', ({ sessionId }) => {
    console.log(`[Socket.IO] Client ${socket.id} leaving session: ${sessionId}`);
    socket.leave(sessionId);
    clients.delete(sessionId);
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    // Remove client from all sessions
    for (const [sessionId, socketId] of clients.entries()) {
      if (socketId === socket.id) {
        clients.delete(sessionId);
      }
    }
  });
});

// Webhook endpoint for n8n to send messages
app.post('/webhook', (req, res) => {
  const message = req.body;
  console.log('[Webhook] Received message from n8n:', JSON.stringify(message, null, 2));
  
  const sessionId = message.sessionDetails?.sessionId;
  
  if (!sessionId) {
    console.error('[Webhook] No sessionId in message');
    return res.status(400).json({ error: 'Missing sessionId in sessionDetails' });
  }
  
  // Emit message to the session room
  console.log(`[Webhook] Emitting to session: ${sessionId}`);
  io.to(sessionId).emit('n8n_response', message);
  
  res.json({ success: true, sessionId });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    connectedClients: clients.size,
    sessions: Array.from(clients.keys())
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'WeaveAI WebSocket Server',
    status: 'running',
    endpoints: {
      webhook: '/webhook',
      health: '/health'
    }
  });
});

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║          WeaveAI WebSocket Server - Railway Deployment          ║
╠══════════════════════════════════════════════════════════════════╣
║  Server running on port: ${PORT}                                    ║
║                                                                  ║
║  Endpoints:                                                      ║
║  - POST /webhook       - n8n sends messages here                 ║
║  - GET  /health        - Health check                            ║
║  - GET  /              - Server info                             ║
╚══════════════════════════════════════════════════════════════════╝
  `);
});
