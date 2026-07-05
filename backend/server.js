const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const path = require('path');

const securityConfig = require('./config/security');
const { socketAuthMiddleware, requireSocketAuth } = require('./middleware/socketAuth');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: securityConfig.cors.origin,
    methods: securityConfig.cors.methods,
    credentials: securityConfig.cors.credentials
  },
  // 启用连接认证
  auth: {
    required: true
  }
});

// 应用 Socket.IO 认证中间件
io.use(socketAuthMiddleware);

app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: securityConfig.cors.origin,
  methods: securityConfig.cors.methods,
  credentials: securityConfig.cors.credentials
}));
app.use(bodyParser.json());

// Database logic (Simple JSON storage)
const db = require('./db');

// Middleware
const { auditLogMiddleware } = require('./middleware/auditLog');

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const designerRoutes = require('./routes/designers');
const taskRoutes = require('./routes/tasks');
const settingsRoutes = require('./routes/settings');
const systemRoutes = require('./routes/system');
const specRoutes = require('./routes/spec');
const statusTrackingRoutes = require('./routes/statusTracking');
const workHoursRoutes = require('./routes/workHours');

app.use(auditLogMiddleware);

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/designers', designerRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/spec', specRoutes);
app.use('/api/status-tracking', statusTrackingRoutes);
app.use('/api/work-hours', workHoursRoutes);

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

const editingSessions = new Map();
const editingKey = (designerId, date) => `${designerId}::${date}`;
const publicEditingSessions = () => Array.from(editingSessions.values());
const broadcastStoppedSessions = (sessions, sourceSocket) => {
  sessions.forEach(session => {
    const payload = {
      designerId: session.designerId,
      date: session.date,
      userId: session.userId
    };
    if (sourceSocket) {
      sourceSocket.broadcast.emit('user_stopped_editing', payload);
      sourceSocket.emit('user_stopped_editing', payload);
    } else {
      io.emit('user_stopped_editing', payload);
    }
  });
};

const removeSessions = (predicate) => {
  const removedSessions = [];
  for (const [key, session] of editingSessions.entries()) {
    if (predicate(session)) {
      editingSessions.delete(key);
      removedSessions.push(session);
    }
  }
  return removedSessions;
};

// 错误处理：认证失败
io.on('connect_error', (error) => {
  console.error('Socket connection error:', error.message);
});

io.on('connection', (socket) => {
  // 此时用户已通过认证中间件验证
  const user = socket.data.user;
  socket.join(`user:${user.id}`);
  console.log(`User connected: ${user.username} (${socket.id})`);

  socket.emit('editing_state', publicEditingSessions());

  // task_updated 事件：验证用户身份
  socket.on('task_updated', (data) => {
    try {
      requireSocketAuth(socket);
      // Broadcast to everyone except sender
      socket.broadcast.emit('task_refreshed', data);
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // start_editing 事件：验证用户身份并使用服务器端用户信息
  socket.on('start_editing', (data) => {
    try {
      const authenticatedUser = requireSocketAuth(socket);
      
      if (!data?.designerId || !data?.date) {
        socket.emit('error', { message: 'Missing required fields' });
        return;
      }

      const key = editingKey(data.designerId, data.date);
      const existingSession = editingSessions.get(key);
      
      if (
        existingSession &&
        existingSession.socketId !== socket.id &&
        existingSession.userId !== authenticatedUser.id
      ) {
        socket.emit('editing_blocked', existingSession);
        return;
      }

      const removedOwnSessions = removeSessions(session =>
        session.userId === authenticatedUser.id &&
        editingKey(session.designerId, session.date) !== key
      );
      broadcastStoppedSessions(removedOwnSessions, socket);

      // 使用服务器端验证的用户信息，而不是客户端提供的信息
      const session = {
        designerId: data.designerId,
        date: data.date,
        userId: authenticatedUser.id,
        username: authenticatedUser.username,
        name: authenticatedUser.name,
        socketId: socket.id
      };
      editingSessions.set(key, session);
      socket.broadcast.emit('user_editing', session);
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // stop_editing 事件：验证用户身份
  socket.on('stop_editing', (data) => {
    try {
      const authenticatedUser = requireSocketAuth(socket);
      
      let removedSessions = [];
      if (data?.designerId && data?.date) {
        const key = editingKey(data.designerId, data.date);
        const session = editingSessions.get(key);
        if (session && session.socketId === socket.id) {
          editingSessions.delete(key);
          removedSessions = [session];
        }
      } else {
        removedSessions = removeSessions(session => session.socketId === socket.id);
      }

      broadcastStoppedSessions(removedSessions, socket);
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // status_tracking_start_edit 事件：验证用户身份并使用服务器端用户信息
  socket.on('status_tracking_start_edit', (data) => {
    try {
      const authenticatedUser = requireSocketAuth(socket);
      
      if (!data?.itemId) {
        socket.emit('error', { message: 'Missing itemId' });
        return;
      }
      
      // 使用服务器端验证的用户信息
      const session = {
        itemId: data.itemId,
        userId: authenticatedUser.id,
        username: authenticatedUser.username,
        socketId: socket.id
      };
      
      socket.broadcast.emit('status_tracking_edit_start', session);
      socket.emit('status_tracking_edit_start', session);
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // status_tracking_stop_edit 事件：验证用户身份
  socket.on('status_tracking_stop_edit', (data) => {
    try {
      requireSocketAuth(socket);
      
      if (!data?.itemId) {
        socket.emit('error', { message: 'Missing itemId' });
        return;
      }
      
      socket.broadcast.emit('status_tracking_edit_stop', { itemId: data.itemId });
      socket.emit('status_tracking_edit_stop', { itemId: data.itemId });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('disconnect', () => {
    const removedSessions = removeSessions(session => session.socketId === socket.id);
    broadcastStoppedSessions(removedSessions, socket);
    console.log(`User disconnected: ${user.username} (${socket.id})`);
  });

  // 错误处理
  socket.on('error', (error) => {
    console.error(`Socket error for user ${user.username}:`, error);
  });
});


server.listen(securityConfig.server.port, () => {
  console.log(`Server running on port ${securityConfig.server.port}`);
  db.initAdmin();
});
