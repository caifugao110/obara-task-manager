const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const securityConfig = require('./config/security');
const { socketAuthMiddleware, requireSocketAuth, requireSocketRole } = require('./middleware/socketAuth');
const { hasAccessSettings } = require('./middleware/auth');

// ---------------------------------------------------------------------------
// 进程级崩溃兜底
//
// 此前 server.js 没有任何 uncaughtException / unhandledRejection 处理：
// Node 22 默认会因「未处理的 Promise 拒绝」直接以 code 1 退出进程，
// 外部只看到 nodemon 打一句「app crashed - waiting for file changes」，
// 端口 5000 随即消失，前端所有请求变成 ECONNREFUSED —— 但日志里连一行堆栈都没有。
// 现在把这类异常连同堆栈落到 logs/backend-crash.log 再继续运行，保证可用性；
// 需要「一旦出现未捕获异常就退出」（便于 nodemon 重启）时设 CRASH_EXIT_ON_UNCAUGHT=1。
// ---------------------------------------------------------------------------
const CRASH_LOG_PATH = path.join(__dirname, '..', 'logs', 'backend-crash.log');

const writeCrashLog = (kind, error) => {
  const stack = error && error.stack ? error.stack : String(error);
  const line = `[${new Date().toISOString()}] ${kind} (pid=${process.pid}) ${stack}\n`;
  try {
    fs.mkdirSync(path.dirname(CRASH_LOG_PATH), { recursive: true });
    fs.appendFileSync(CRASH_LOG_PATH, line, 'utf8');
  } catch (writeError) {
    // 落盘失败不能再抛，否则就是异常套异常
  }
  // 这里必须自己也兜住：stdout/stderr 是管道时，读端一消失 console.error 就抛
  // EPIPE。它发生在 uncaughtException 处理器内部，Node 不会再次派发事件而是
  // 直接静默退出（无日志、无堆栈），崩溃就变成了「查不到原因的退出」。
  // logs/backend-crash.log 里那份 248MB 的 EPIPE 自激记录就是这么来的。
  try {
    console.error(`[crash] ${kind}:`, stack);
  } catch (writeError) {
    // 输出通道已断，放弃打印；上面的 appendFileSync 已经落盘
  }
};

const handleCrash = (kind) => (error) => {
  writeCrashLog(kind, error);
  if (process.env.CRASH_EXIT_ON_UNCAUGHT === '1') {
    setTimeout(() => process.exit(1), 100);
  }
};

process.on('uncaughtException', handleCrash('uncaughtException'));
process.on('unhandledRejection', handleCrash('unhandledRejection'));

// ---------------------------------------------------------------------------
// 退出取证
//
// 现象：2026-11-08 19:31 与 20:17 两次后端消失，nodemon 只打一句 "app crashed"，
// 而 uncaughtException 兜底没有新记录、Windows 事件日志里也没有 Application
// Error / WER 报告。这两点合起来说明退出既不经过 JS 异常，也不是原生崩溃
// （原生崩溃（访问冲突等）一定会留 Application Error 事件与 dump）。
// 剩下两种可能，只能靠 exit 事件区分：
//   有这条记录 → 进程自己退的，code 就是真实退出码；
//   没有记录   → 被外部 TerminateProcess 强杀，exit 事件根本不会触发。
// 记录里带上内存与活跃句柄数，顺便能排除「句柄泄漏拖死事件循环」这类猜测。
// ---------------------------------------------------------------------------
const EXIT_LOG_PATH = path.join(__dirname, '..', 'logs', 'backend-exit.log');

const writeExitLog = (code, reason) => {
  const mem = process.memoryUsage();
  const countOf = (fn) => {
    try {
      return typeof fn === 'function' ? fn().length : -1;
    } catch (error) {
      return -1;
    }
  };
  const line = [
    `[${new Date().toISOString()}]`,
    `exit code=${code}`,
    `reason=${reason}`,
    `pid=${process.pid}`,
    `uptime=${Math.round(process.uptime())}s`,
    `rss=${Math.round(mem.rss / 1048576)}MB`,
    `heapUsed=${Math.round(mem.heapUsed / 1048576)}MB`,
    `handles=${countOf(process._getActiveHandles)}`,
    `requests=${countOf(process._getActiveRequests)}`
  ].join(' ');
  try {
    fs.mkdirSync(path.dirname(EXIT_LOG_PATH), { recursive: true });
    fs.appendFileSync(EXIT_LOG_PATH, line + '\n', 'utf8');
  } catch (writeError) {
    // 退出路径上不允许再抛
  }
  try {
    console.error(line);
  } catch (writeError) {
    // 同上，输出通道可能已断
  }
};

// exit 在 process.exit()、事件循环耗尽、未捕获信号处理后都会触发；
// 被 TerminateProcess 强杀或原生崩溃时不会触发，因此「没有记录」本身就是结论。
process.on('exit', (code) => writeExitLog(code, 'exit-event'));

// 事件循环自然清空（没有任何待处理任务）时会先触发 beforeExit 再走 exit。
// 正常服务有监听句柄，不该走到这里；一旦出现，说明有人 close 了 server。
process.on('beforeExit', (code) => writeExitLog(code, 'beforeExit-loop-drained'));

const app = express();

// 只信任回环代理（本机 Vite 开发代理 / 同机 nginx）。
// 必需：经代理转发的请求带 X-Forwarded-For 头，express-rate-limit v8 在
// trust proxy 未开启时会抛 ERR_ERL_UNEXPECTED_X_FORWARDED_FOR 并使进程崩溃。
// 为何用 'loopback' 而非跳数：已确认生产环境用户直连后端（0 跳），
// 若设为 1，直连客户端伪造的 X-Forwarded-For 会被采信——日志 IP 可伪造、
// 限流可绕过（登录日志中已发现 10.0.0.1-5 连号伪造痕迹）。
// 'loopback' 下仅 127.0.0.1/::1 代理的 XFF 被采信，外部直连一律以 socket 地址为准。
app.set('trust proxy', 'loopback');
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: securityConfig.cors.origin,
    methods: securityConfig.cors.methods,
    credentials: securityConfig.cors.credentials
  }
  // 注：socket.io Server 选项中没有 auth 字段（此前配置为无效死配置）。
  // 连接认证由下方 io.use(socketAuthMiddleware) 实现。
});

// 应用 Socket.IO 认证中间件
io.use(socketAuthMiddleware);

// 后端只提供 API 与 Socket.IO（不托管前端 HTML），启用收敛的 CSP 作为纵深防御：
// 即使未来某个接口返回 HTML/错误页，也只允许同源资源、禁止插件与 framing。
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
}));
app.use(cors({
  origin: securityConfig.cors.origin,
  methods: securityConfig.cors.methods,
  credentials: securityConfig.cors.credentials
}));
app.use(bodyParser.json());

// 全局限流：覆盖所有 /api 接口，防暴力探测与滥用。
// 登录（20 次/15 分钟）与改密码（5 次/15 分钟）另有更严格的独立限流，先生效。
// 默认 3000 次/15 分钟/IP：按 300+ 人内网规模设计，活跃编辑峰值约 1-2 次/秒，
// 且兼容多人经同一代理出口（按出口 IP 合并计数）的场景；
// 可用 API_RATE_LIMIT_MAX 调整；OPTIONS 预检与本机回环（stop.bat 等运维脚本）不计数。
const isLoopback = (ip) => {
  const normalized = String(ip || '').replace(/^::ffff:/, '');
  return normalized === '127.0.0.1' || normalized === '::1';
};
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.API_RATE_LIMIT_MAX) || 3000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS' || isLoopback(req.socket.remoteAddress),
  message: { message: '请求过于频繁，请稍后再试' }
});
app.use('/api', apiLimiter);

// IP 黑名单：命中黑名单的 IP 访问任意 /api 接口一律 403（登录接口会额外记录失败日志）。
// 中间件内部放行 OPTIONS 预检与本机回环地址（127.0.0.1/::1），
// 防止管理员误封自身出口 IP 后无法从服务器本机自救。
const ipBlacklist = require('./utils/ipBlacklist');
app.use('/api', ipBlacklist.middleware);

// Database logic (Simple JSON storage)
const db = require('./db');
const { startMaintenanceScheduler, createOfflineBackup } = require('./utils/dbMaintenance');
const gunTableLocks = require('./utils/gunTableLocks');
const {
  statusTrackingSessions,
  statusTrackingKey,
  publicStatusTrackingSessions,
  removeStatusTrackingSessions
} = require('./utils/statusTrackingLocks');
const taskStore = require('./taskStore');
const productionSchedule = require('./utils/productionSchedule');
const logFiles = require('./utils/logFiles');
const systemMonitor = require('./utils/systemMonitor');

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
const { runGunLedgerSelfHeal } = gunLedgerRoutes;
const designStandardsRoutes = require('./routes/designStandards');
const monitorRoutes = require('./routes/monitor');

app.use(auditLogMiddleware);

// 状态监测流量统计：仅内存累加，定时批量落盘（见 utils/systemMonitor.js）
app.use(systemMonitor.trafficMiddleware);

app.use('/api/system/monitor', monitorRoutes);
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
app.use('/api/design-standards', designStandardsRoutes);

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  const status = err.status || 500;
  const isDev = process.env.NODE_ENV === 'development';
  // 5xx 服务端错误：生产环境不向客户端透出内部错误细节（如 SQLite 约束错误、
  // 文件路径等），避免信息泄露；4xx 客户端错误保留原始消息便于排障。
  // 显式标了 err.expose 的错误（如「备份失败已中止写入」）例外：这类消息不含内部细节，
  // 且正是运维需要看到的操作结论，不该被吞成「服务器内部错误」。
  const message = status >= 500 && !isDev && !err.expose
    ? '服务器内部错误'
    : (err.message || '服务器内部错误');
  res.status(status).json({
    message,
    error: isDev ? err : {}
  });
});

// Socket.io connection
app.set('io', io);

// 状态监测：在线连接数取自 socket.io 引擎，用于「前端并发」指标
systemMonitor.setSocketCountProvider(() => (io.engine ? io.engine.clientsCount : 0));
// 进程退出（含崩溃退出路径能走到 exit 的场景）补记一条结束事件，
// 与启动时的 boot 事件配对，即可判定这一轮会话正常结束还是异常中断。
process.on('exit', (code) => {
  try {
    systemMonitor.recordExit(code);
  } catch {
    // 退出路径不允许再抛
  }
});

const editingSessions = new Map();
// 会话键精确到主任务：同一单元格内不同主任务的编辑互不影响；itemId 为空为旧版整格会话
const editingKey = (designerId, date, itemId) => `${designerId}::${date}::${itemId || ''}`;
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

// 状态跟踪：按行锁定会话（锁键 itemId）。
// 锁状态存储在 utils/statusTrackingLocks.js（与 HTTP 写接口共享同一份），
// 这里负责 socket 事件的仲裁与广播。
const broadcastStatusTrackingStopped = (sessions, sourceSocket) => {
  sessions.forEach(session => {
    const payload = { itemId: session.itemId, userId: session.userId };
    if (sourceSocket) {
      sourceSocket.broadcast.emit('status_tracking_edit_stop', payload);
      sourceSocket.emit('status_tracking_edit_stop', payload);
    } else {
      io.emit('status_tracking_edit_stop', payload);
    }
  });
};

// 状态快照按需补发：服务端只在「连接建立」时下发一次 editing_state 等快照。
// 共享连接由 AuthContext 常驻持有，页面来回切换时客户端缓存的快照早已过期；
// 若拿旧快照覆盖本地状态，会把别人正在持有的行锁显示成「已释放」。
// 因此允许客户端主动请求一次最新快照（限流，避免被高频轮询放大）。
const stateSnapshotProviders = {
  editing_state: publicEditingSessions,
  gun_ledger_editing_state: publicGunLedgerSessions,
  gun_ledger_table_locks_state: () => gunTableLocks.snapshot(),
  status_tracking_editing_state: publicStatusTrackingSessions
};

// Socket 事件频率限制：按连接计数，防止单个客户端高频广播造成全体刷新风暴。
// 计数挂在 socket.data 上，连接断开时随对象一起回收，不会累积占用内存。
const socketRateLimit = (socket, eventName, limit, windowMs) => {
  if (!socket.data.rateBuckets) socket.data.rateBuckets = {};
  const now = Date.now();
  const bucket = (socket.data.rateBuckets[eventName] || []).filter(t => now - t < windowMs);
  if (bucket.length >= limit) {
    socket.data.rateBuckets[eventName] = bucket;
    return false;
  }
  bucket.push(now);
  socket.data.rateBuckets[eventName] = bucket;
  return true;
};

// task_updated 广播频率上限。完成任务状态来回切换会连续触发该事件，
// 上限过低（原 5 次/10 秒）时正常的连续切换就会被限流。
const TASK_UPDATED_LIMIT = 20;
const TASK_UPDATED_WINDOW_MS = 10 * 1000;

// 广播「任务数据已变更」：客户端给出变更坐标时，由服务端从数据库读取最新工时表
// 再广播，其他客户端可直接本地合并，无需重新拉取整月数据。广播内容取自数据库
// 而非客户端 payload，避免转发客户端构造的任意内容。坐标缺失/非法或全部读取
// 失败时退化为「空信号」，客户端按原逻辑全量刷新。
//
// 坐标支持两种形态：
//   { designerId, month, year }                     单表（旧格式，仍兼容）
//   { targets: [{ designerId, month, year }, ...] } 多表
// 移动主任务会同时改动「源设计员表」和「目标设计员表」，跨月移动还会落在不同月份，
// 只广播一张表会让另一端的目标行迟迟不出现，因此这里按多表处理。
const MAX_BROADCAST_TARGETS = 8;

const resolveBroadcastTargets = (payload) => {
  const targets = [];
  const seen = new Set();
  const push = (designerId, month, year) => {
    const id = designerId ? String(designerId) : '';
    const m = Number(month);
    const y = Number(year);
    if (!id || !Number.isInteger(m) || !Number.isInteger(y)) return;
    const key = `${id}::${m}::${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ designerId: id, month: m, year: y });
  };
  if (Array.isArray(payload?.targets)) {
    payload.targets.slice(0, MAX_BROADCAST_TARGETS).forEach(t => push(t?.designerId, t?.month, t?.year));
  } else {
    push(payload?.designerId, payload?.month, payload?.year);
  }
  return targets;
};

const broadcastTaskRefresh = (socket, payload) => {
  const targets = resolveBroadcastTargets(payload);
  const sheets = [];
  for (const target of targets) {
    try {
      const sheet = taskStore.getSheet(target.designerId, target.month, target.year);
      if (sheet) sheets.push(sheet);
    } catch (e) {
      // 单张表读取失败不放弃整批：其余表照常广播，避免一处异常拖累全部客户端
      console.error('[socket] task_updated 增量读取失败:', e.message);
    }
  }
  socket.broadcast.emit('task_refreshed', sheets.length > 0 ? { sheets } : undefined);
};

// 限流命中时记录最后一次变更坐标，并在窗口结束后补发一次，
// 保证最终状态一定送达其他客户端。补发期间继续到来的变更只更新坐标，
// 不重复排定定时器。
const scheduleTrailingTaskRefresh = (socket, payload) => {
  socket.data.trailingTaskPayload = payload;
  if (socket.data.trailingTaskTimer) return;
  socket.data.trailingTaskTimer = setTimeout(() => {
    socket.data.trailingTaskTimer = null;
    if (!socket.connected) {
      socket.data.trailingTaskPayload = null;
      return;
    }
    broadcastTaskRefresh(socket, socket.data.trailingTaskPayload);
    socket.data.trailingTaskPayload = null;
  }, TASK_UPDATED_WINDOW_MS);
};

const cancelTrailingTaskRefresh = (socket) => {
  if (socket.data.trailingTaskTimer) {
    clearTimeout(socket.data.trailingTaskTimer);
    socket.data.trailingTaskTimer = null;
  }
  socket.data.trailingTaskPayload = null;
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
  // 状态跟踪行锁快照：后连接的客户端据此渲染「被他人编辑」状态，
  // 不必等下一次编辑广播才能看到锁
  socket.emit('status_tracking_editing_state', publicStatusTrackingSessions());

  // task_updated 事件：验证用户身份
  socket.on('task_updated', (payload) => {
    try {
      requireSocketAuth(socket);
      // 限制单个连接的广播频率：该事件会触发全体客户端重新拉取数据，
      // 不加限制时可被任意登录用户高频触发，形成刷新风暴。
      // 限流命中时不能直接丢弃（见 scheduleTrailingTaskRefresh）：
      // 该事件只是「数据已变更」信号，丢弃最后一次信号会让其他客户端
      // 一直停在旧状态，直到本端下一次编辑或手动刷新。
      if (!socketRateLimit(socket, 'task_updated', TASK_UPDATED_LIMIT, TASK_UPDATED_WINDOW_MS)) {
        scheduleTrailingTaskRefresh(socket, payload);
        return;
      }
      // 已经成功广播了最新数据，之前被限流的待补发信号已无意义，取消掉
      cancelTrailingTaskRefresh(socket);
      broadcastTaskRefresh(socket, payload);
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

      const key = editingKey(data.designerId, data.date, data.itemId);
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
        editingKey(session.designerId, session.date, session.itemId) !== key
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
        // colorMark 模式下行定位：itemId 主任务 id，gunIndex 枪名下标（null 表示主任务）
        itemId: typeof data.itemId === 'string' ? data.itemId : null,
        gunIndex: Number.isInteger(data.gunIndex) ? data.gunIndex : null,
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
        // 停止消息不带 itemId：移除该连接在此单元格内的全部主任务会话
        removedSessions = removeSessions(session =>
          session.socketId === socket.id &&
          session.designerId === data.designerId &&
          session.date === data.date
        );
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

      // 状态追踪的新增/编辑/删除均要求管理员权限，占用广播同样收敛到管理员，
      // 否则普通用户可向全体客户端伪造「正在编辑」提示干扰他人
      if (!['admin', 'superadmin'].includes(authenticatedUser.role)) {
        socket.emit('error', { message: 'Insufficient permissions' });
        return;
      }

      // 与 HTTP 写接口对齐：模块被超管关闭或收回管理员访问时，
      // 禁止占用「正在编辑」广播（hasAccessSettings 内部对超管恒放行）
      if (!hasAccessSettings(authenticatedUser, 'statusTracking')) {
        socket.emit('error', { message: '无权访问' });
        return;
      }

      if (!socketRateLimit(socket, 'status_tracking_start_edit', 30, 10 * 1000)) {
        socket.emit('error', { message: '操作过于频繁，请稍后再试' });
        return;
      }

      if (!data?.itemId) {
        socket.emit('error', { message: 'Missing itemId' });
        return;
      }
      
      // 服务端仲裁：行锁按「连接」归属——一个正在编辑的人就是一条连接。
      // 1) 该行已被其他在线连接占用：一律拒绝。无论是他人账号，还是同一账号的
      //    另一个标签页/设备，都不允许抢占：抢占等于「替原持有者解锁」，
      //    而后来者换行走查时还会把这个抢来的锁顺手释放掉，
      //    表现就是「别人点一下就把刚才人的锁放掉了」。
      // 2) 持有者连接已不存在（进程重启/掉线残留的僵死锁）：允许接管并补一次
      //    释放广播，避免该行被永久锁死。
      const key = statusTrackingKey(data.itemId);
      const existingSession = statusTrackingSessions.get(key);
      if (existingSession && existingSession.socketId !== socket.id) {
        const holderSocket = io.of('/').sockets.get(existingSession.socketId);
        if (holderSocket) {
          socket.emit('status_tracking_edit_blocked', existingSession);
          return;
        }
        // 僵死锁：先清理并广播释放，再由本连接接管
        const staleSessions = removeStatusTrackingSessions(s => s.itemId === key);
        broadcastStatusTrackingStopped(staleSessions, socket);
      }

      // 同一连接只保留一行锁：焦点移到其他行时释放自己之前占用的行。
      // 注意过滤条件是 socketId——只会释放自己的锁，永远不会碰到他人持有的锁，
      // 因此「编辑其他行」不可能导致别人的行锁被释放。
      const removedOwnSessions = removeStatusTrackingSessions(session =>
        session.socketId === socket.id && session.itemId !== key
      );
      broadcastStatusTrackingStopped(removedOwnSessions, socket);

      // 使用服务器端验证的用户信息
      const session = {
        itemId: key,
        userId: authenticatedUser.id,
        username: authenticatedUser.username,
        name: authenticatedUser.name,
        socketId: socket.id
      };

      statusTrackingSessions.set(key, session);
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

      // 只释放「本连接自己持有」的锁：他人连接上的锁（包括同一用户其他
      // 标签页接管后的锁）不受影响，任何客户端都无法替别人解锁。
      const removedSessions = removeStatusTrackingSessions(session =>
        session.socketId === socket.id && session.itemId === statusTrackingKey(data.itemId)
      );

      broadcastStatusTrackingStopped(removedSessions, socket);
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // request_state：主动索取一次最新状态快照（见 stateSnapshotProviders 说明）。
  // 事件名走白名单，避免被当成任意事件转发器；限流防高频轮询。
  socket.on('request_state', (data) => {
    try {
      requireSocketAuth(socket);
      const eventName = typeof data?.event === 'string' ? data.event : '';
      const provider = Object.prototype.hasOwnProperty.call(stateSnapshotProviders, eventName)
        ? stateSnapshotProviders[eventName]
        : null;
      if (!provider) return;
      if (!socketRateLimit(socket, 'request_state', 20, 10 * 1000)) return;
      socket.emit(eventName, provider());
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // 焊枪编号台账：开始编辑某行（取号）
  socket.on('gun_ledger_start_edit', (data) => {
    try {
      // 行编辑锁（取号）仅管理员可用：普通用户为只读视图，
      // 防止构造客户端抢占行锁干扰管理员编辑
      const authenticatedUser = requireSocketRole(socket);
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
      // 表级独占编辑锁仅管理员可申请：普通用户为只读视图（前端亦不发锁请求），
      // 防止构造客户端抢占表锁并经心跳无限续期，阻断管理员编辑
      const authenticatedUser = requireSocketRole(socket);
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
      // 锁心跳续期同样仅限管理员：防止普通用户为已抢占的锁续命
      const authenticatedUser = requireSocketRole(socket);
      if (!data?.tableId) return;
      gunTableLocks.heartbeat(String(data.tableId), authenticatedUser.id);
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('disconnect', () => {
    // 释放待补发的 task_refreshed 定时器，避免连接断开后仍持有 socket 引用
    cancelTrailingTaskRefresh(socket);
    const removedSessions = removeSessions(session => session.socketId === socket.id);
    broadcastStoppedSessions(removedSessions, socket);
    const removedGunSessions = removeGunLedgerSessions(s => s.socketId === socket.id);
    broadcastGunLedgerStopped(removedGunSessions, socket);
    // 释放该连接持有的状态跟踪行锁，否则掉线后行会一直显示为「他人正在编辑」
    const removedStatusTracking = removeStatusTrackingSessions(s => s.socketId === socket.id);
    broadcastStatusTrackingStopped(removedStatusTracking, socket);
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
  // 先登记「计划内停止」，下次启动时状态监测就能把这段空窗判定为正常停止而非崩溃
  try {
    systemMonitor.recordGracefulStop(signal);
  } catch {
    // 监测写入失败不阻塞关机
  }
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

// nodemon 热重载通过 SIGUSR2 结束子进程。默认终止信号不会触发 exit 事件，
// 状态监测会把每次热重载都记成「进程被外部强制结束」。这里显式登记为计划内停止，
// 让开发期的重启不会被误报为故障（生产环境没有 SIGUSR2 发送方，不影响线上判定）。
process.on('SIGUSR2', () => {
  try {
    systemMonitor.recordGracefulStop('SIGUSR2');
  } catch {
    // 忽略
  }
  process.exit(0);
});

// 启动前初始化数据库（加载缓存到内存）
db.init();

server.listen(securityConfig.server.port, async () => {
  console.log(`Server running on port ${securityConfig.server.port}`);
  // 状态监测：登记本次启动，并判定上一轮是正常停止还是异常中断
  try {
    systemMonitor.recordBoot();
  } catch (err) {
    console.error('[monitor] 启动登记失败:', err && err.message ? err.message : err);
  }
  // 台账启动自愈：把历史错位的焊枪名编号校正到对应序号（只在有变化时落库，GET 只读）
  try {
    await runGunLedgerSelfHeal();
  } catch (err) {
    console.error('[gun-ledger] 启动自愈失败:', err && err.message ? err.message : err);
  }
  db.initAdmin();
  // 共享盘预热：配了 PRODUCTION_SCHEDULE_UNC_USER 时，先用该凭据把 SMB 连接建好。
  // 否则「第一次读大日程」可能由一次普通 UNC 访问先落成 guest/匿名隐式会话，
  // 之后再换凭据就会撞 1219，要多绕一轮断开重连才恢复。
  // 不 await：预热失败要等满 15 秒超时，等它只会把后面的调度器、日志截断一起拖后；
  // 而且预热只是「顺手把连接建好」，读取路径上还有 withShareRetryAsync 的 1219 重连兜底。
  productionSchedule.ensureShareReady()
    .then((warm) => {
      if (warm && warm.attempted) {
        console.log(`[productionSchedule] 共享预热${warm.ok ? '成功' : '失败'}：${warm.message}`);
      }
    })
    .catch((err) => {
      console.error('[productionSchedule] 共享预热异常:', err && err.message ? err.message : err);
    });
  // 维护计划配置迁移（旧 scheduleTime 单值 -> scheduleTimes）在调度器内部完成
  startMaintenanceScheduler().catch((err) => {
    console.error('[maintenance] 维护计划调度启动失败:', err && err.message ? err.message : err);
  });
  // 磁盘日志自动截断：logs/ 下的文件没有上限，超过阈值就地截断并保留末尾内容
  try {
    logFiles.startAutoTrim();
  } catch (err) {
    console.error('[logFiles] 自动截断调度启动失败:', err && err.message ? err.message : err);
  }
});
