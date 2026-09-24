const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

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
const { startMaintenanceScheduler, createOfflineBackup } = require('./utils/dbMaintenance');
const gunTableLocks = require('./utils/gunTableLocks');

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
const gunLedgerRoutes = require('./routes/gunLedger');

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
app.use('/api/gun-ledger', gunLedgerRoutes);

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

// 焊枪编号台账：按行锁定会话（锁键 tableId::serialNumber）
const gunLedgerSessions = new Map();
const gunLedgerKey = (tableId, serialNumber) => `${tableId}::${serialNumber}`;
const publicGunLedgerSessions = () => Array.from(gunLedgerSessions.values());
const broadcastGunLedgerStopped = (sessions, sourceSocket) => {
  sessions.forEach(session => {
    const payload = { tableId: session.tableId, serialNumber: session.serialNumber, userId: session.userId };
    if (sourceSocket) {
      sourceSocket.broadcast.emit('gun_ledger_edit_stop', payload);
      sourceSocket.emit('gun_ledger_edit_stop', payload);
    } else {
      io.emit('gun_ledger_edit_stop', payload);
    }
  });
};
const removeGunLedgerSessions = (predicate) => {
  const removed = [];
  for (const [key, session] of gunLedgerSessions.entries()) {
    if (predicate(session)) {
      gunLedgerSessions.delete(key);
      removed.push(session);
    }
  }
  return removed;
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
  socket.emit('gun_ledger_editing_state', publicGunLedgerSessions());
  socket.emit('gun_ledger_table_locks_state', gunTableLocks.snapshot());

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
        mode: data.mode === 'colorMark' ? 'colorMark' : 'edit',
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

  // 焊枪编号台账：开始编辑某行（取号）
  socket.on('gun_ledger_start_edit', (data) => {
    try {
      const authenticatedUser = requireSocketAuth(socket);
      if (!data?.tableId || data?.serialNumber === undefined || data?.serialNumber === null) {
        socket.emit('error', { message: 'Missing tableId or serialNumber' });
        return;
      }
      const serialNumber = Number(data.serialNumber);
      const key = gunLedgerKey(data.tableId, serialNumber);
      const existing = gunLedgerSessions.get(key);
      if (existing && existing.socketId !== socket.id && existing.userId !== authenticatedUser.id) {
        socket.emit('gun_ledger_edit_blocked', existing);
        return;
      }
      // 一个用户同时只持一把行锁：清除自身其他锁并广播停止
      const removedOwn = removeGunLedgerSessions(s =>
        s.userId === authenticatedUser.id && gunLedgerKey(s.tableId, s.serialNumber) !== key
      );
      broadcastGunLedgerStopped(removedOwn, socket);

      const session = {
        tableId: data.tableId,
        serialNumber,
        userId: authenticatedUser.id,
        username: authenticatedUser.username,
        name: authenticatedUser.name,
        socketId: socket.id
      };
      gunLedgerSessions.set(key, session);
      socket.broadcast.emit('gun_ledger_edit_start', session);
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // 焊枪编号台账：停止编辑某行
  socket.on('gun_ledger_stop_edit', (data) => {
    try {
      requireSocketAuth(socket);
      if (!data?.tableId || data?.serialNumber === undefined || data?.serialNumber === null) {
        socket.emit('error', { message: 'Missing tableId or serialNumber' });
        return;
      }
      const serialNumber = Number(data.serialNumber);
      const key = gunLedgerKey(data.tableId, serialNumber);
      const session = gunLedgerSessions.get(key);
      if (session && session.socketId === socket.id) {
        gunLedgerSessions.delete(key);
        broadcastGunLedgerStopped([session], socket);
      }
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // 焊枪编号台账：申请表级独占编辑锁（打开表准备编辑时触发）
  socket.on('gun_ledger_lock_table', (data) => {
    try {
      const authenticatedUser = requireSocketAuth(socket);
      if (!data?.tableId) {
        socket.emit('error', { message: 'Missing tableId' });
        return;
      }
      const tableId = String(data.tableId);
      const result = gunTableLocks.lock(tableId, authenticatedUser, socket.id);
      if (result.status === 'blocked') {
        socket.emit('gun_ledger_table_lock_blocked', { tableId, holder: result.holder });
        return;
      }
      if (result.status === 'acquired') {
        io.emit('gun_ledger_table_locked', result.holder);
      } else {
        // 同一用户多标签页：仅向本人确认，无需重复广播
        socket.emit('gun_ledger_table_locked', result.holder);
      }
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // 焊枪编号台账：释放表级编辑锁（切换表 / 完成编辑 / 离开页面时触发）
  socket.on('gun_ledger_unlock_table', (data) => {
    try {
      requireSocketAuth(socket);
      if (!data?.tableId) {
        socket.emit('error', { message: 'Missing tableId' });
        return;
      }
      const tableId = String(data.tableId);
      const released = gunTableLocks.unlock(tableId, socket.id);
      if (released) io.emit('gun_ledger_table_unlocked', { tableId });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // 焊枪编号台账：表级锁心跳续期
  socket.on('gun_ledger_table_heartbeat', (data) => {
    try {
      const authenticatedUser = requireSocketAuth(socket);
      if (!data?.tableId) return;
      gunTableLocks.heartbeat(String(data.tableId), authenticatedUser.id);
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('disconnect', () => {
    const removedSessions = removeSessions(session => session.socketId === socket.id);
    broadcastStoppedSessions(removedSessions, socket);
    const removedGunSessions = removeGunLedgerSessions(s => s.socketId === socket.id);
    broadcastGunLedgerStopped(removedGunSessions, socket);
    // 释放该 socket 持有的表级编辑锁（引用归零才真正释放并广播）
    const releasedTableIds = gunTableLocks.releaseSocket(socket.id);
    releasedTableIds.forEach(tableId => {
      io.emit('gun_ledger_table_unlocked', { tableId });
    });
    console.log(`User disconnected: ${user.username} (${socket.id})`);
  });

  // 错误处理
  socket.on('error', (error) => {
    console.error(`Socket error for user ${user.username}:`, error);
  });
});

// 每 30 秒清理一次焊枪台账僵死表锁（心跳超时且无存活连接）
const gunTableLockSweeper = setInterval(() => {
  const staleTableIds = gunTableLocks.sweepStale(io);
  staleTableIds.forEach(tableId => {
    io.emit('gun_ledger_table_unlocked', { tableId });
  });
}, 30 * 1000);
gunTableLockSweeper.unref();


const handleShutdown = async (signal) => {
  console.log(`\n[shutdown] Received ${signal}, starting graceful shutdown...`);
  console.log('[shutdown] Creating offline backup before exit...');
  
  const backupResult = await createOfflineBackup(undefined, undefined, { async: true });
  if (backupResult.skipped) {
    console.log(`[shutdown] Backup skipped: ${backupResult.reason}`);
  } else if (backupResult.success) {
    console.log(`[shutdown] Backup completed: ${backupResult.fileName} (${backupResult.size} bytes)`);
  } else {
    console.error(`[shutdown] Backup failed: ${backupResult.error}`);
  }
  
  console.log('[shutdown] Closing server...');
  server.close(() => {
    console.log('[shutdown] Server closed successfully');
    process.exit(0);
  });
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

// 启动前初始化数据库：若存在遗留 db.json 则自动迁移到 SQLite
db.init();

server.listen(securityConfig.server.port, () => {
  console.log(`Server running on port ${securityConfig.server.port}`);
  db.initAdmin();
  startMaintenanceScheduler();
});
