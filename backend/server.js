const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const helmet = require('helmet');
const path = require('path');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for development to allow inline scripts/styles if needed
}));
app.use(cors());
app.use(bodyParser.json());

// Database logic (Simple JSON storage)
const db = require('./db');

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const designerRoutes = require('./routes/designers');
const taskRoutes = require('./routes/tasks');
const settingsRoutes = require('./routes/settings');
const systemRoutes = require('./routes/system');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/designers', designerRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/system', systemRoutes);

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    message: err.message || '服务器内部错误',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

// Socket.io connection
app.set('io', io);

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('register_user', (token) => {
    if (!token || typeof token !== 'string') return;
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'obara_task_secret_key_2026');
      if (decoded?.id) {
        socket.join(`user:${decoded.id}`);
        socket.data.userId = decoded.id;
      }
    } catch {
      // ignore invalid token
    }
  });

  socket.on('task_updated', (data) => {
    // Broadcast to everyone except sender
    socket.broadcast.emit('task_refreshed', data);
  });

  socket.on('start_editing', (data) => {
    socket.broadcast.emit('user_editing', data);
  });

  socket.on('stop_editing', () => {
    socket.broadcast.emit('user_stopped_editing');
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // Initialize admin if not exists
  db.initAdmin();
});
