const jwt = require('jsonwebtoken');
const db = require('../db');
const securityConfig = require('../config/security');
const { isSessionValid, getSessionInvalidationMessage } = require('./auth');
const { syncSocketRooms, disconnectSocketWithReason } = require('../utils/socketRooms');

const JWT_SECRET = securityConfig.jwt.secret;
const JWT_ISSUER = securityConfig.jwt.issuer;
const JWT_AUDIENCE = securityConfig.jwt.audience;

/**
 * Socket.IO 认证中间件
 * 验证 Socket 连接中的 JWT 令牌并将用户信息附加到 socket.data
 *
 * 注意：建连校验只是一次性快照。连接的寿命可能远长于令牌寿命，
 * 期间用户可能被禁用、删除、改密、登出、降权——因此事件处理前
 * 必须再走一次 validateSocketSession（见 requireSocketAuth）。
 */
const socketAuthMiddleware = (socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');

  if (!token) {
    return next(new Error('Authentication error: No token provided'));
  }

  try {
    // 与 HTTP 层对齐：显式锁定 HS256，防止算法降级攻击
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });
    // 与 HTTP 鉴权一致：只取需要的集合，避免每次连接克隆整库
    const user = db.findUserById(decoded.id);

    if (!user) {
      return next(new Error('Authentication error: User not found'));
    }

    if (user.disabled) {
      return next(new Error('Authentication error: Account disabled'));
    }

    // 与 HTTP 层对齐：未修改初始密码的账号不得建立实时连接。
    // 否则可绕过 authMiddleware 的 FORCE_PASSWORD_CHANGE 拦截，
    // 用初始口令连上 WebSocket 后持续接收数据广播、抢占编辑锁。
    if (user.forcePasswordChange) {
      return next(new Error('Authentication error: Password change required'));
    }

    const systemSettings = db.readSettings()?.system || { allowMultiDevice: true };
    // 与 HTTP 层对齐：多设备模式认可 sessionTokens 列表，单设备模式仅认可最新 sessionToken
    if (!isSessionValid(user, decoded.sessionId, systemSettings.allowMultiDevice)) {
      return next(new Error('Authentication error: Session invalidated'));
    }

    socket.data.user = {
      id: user.id,
      username: user.username,
      name: user.name || user.username,
      role: user.role
    };
    socket.data.userId = user.id;
    socket.data.userRole = user.role;
    // 记录会话与令牌有效期：供事件级复核与定时巡检使用，
    // 避免「连接一直挂着」变成「会话/令牌永久有效」
    socket.data.sessionId = decoded.sessionId || null;
    socket.data.tokenExpiresAt = decoded.exp ? decoded.exp * 1000 : 0;

    next();
  } catch (err) {
    return next(new Error(`Authentication error: ${err.message}`));
  }
};

/**
 * 事件级会话复核。
 * 重新读取用户实体，校验存在性、禁用、强制改密、令牌过期与 session 有效性，
 * 并返回实时角色（而不是建连时的快照）。
 */
const validateSocketSession = (socket) => {
  const cached = socket?.data?.user;
  if (!cached) {
    return { ok: false, reason: '连接未认证', code: 'NOT_AUTHENTICATED' };
  }

  const user = db.findUserById(cached.id);
  if (!user) {
    return { ok: false, reason: '账号不存在，请重新登录', code: 'USER_NOT_FOUND' };
  }
  if (user.disabled) {
    return { ok: false, reason: '账号已被禁用，请联系管理员', code: 'ACCOUNT_DISABLED' };
  }
  if (user.forcePasswordChange) {
    return { ok: false, reason: '请先修改初始密码后再继续操作', code: 'FORCE_PASSWORD_CHANGE' };
  }

  // 令牌过期后连接不得继续存活：建连后不再经过 jwt.verify，
  // 若只校验 session，旧版字符串条目（无 expiresAt）会一直放行
  const expiresAt = Number(socket.data.tokenExpiresAt) || 0;
  if (expiresAt > 0 && expiresAt <= Date.now()) {
    return { ok: false, reason: '登录状态已失效，请重新登录', code: 'TOKEN_EXPIRED' };
  }

  const systemSettings = db.readSettings()?.system || { allowMultiDevice: true };
  if (!isSessionValid(user, socket.data.sessionId, systemSettings.allowMultiDevice)) {
    return {
      ok: false,
      reason: getSessionInvalidationMessage(user, systemSettings.allowMultiDevice),
      code: 'SESSION_INVALIDATED'
    };
  }

  return { ok: true, user };
};

/**
 * Socket 事件认证检查
 * 用于在特定事件处理前验证用户身份。
 *
 * 这里是「事件级复核」的唯一入口：校验失败立即断开连接（而不是只回一条
 * 错误消息）——只回错误消息的旧实现会让已被吊销的连接继续挂着，
 * 继续接收后续的业务广播。
 */
const requireSocketAuth = (socket) => {
  if (!socket.data.user) {
    throw new Error('Not authenticated');
  }

  const result = validateSocketSession(socket);
  if (!result.ok) {
    disconnectSocketWithReason(socket, result.reason, result.code);
    throw new Error(result.reason);
  }

  // 用实时用户覆盖建连时的快照：角色被降级后不得继续按旧角色放行
  const live = result.user;
  socket.data.user = {
    id: live.id,
    username: live.username,
    name: live.name || live.username,
    role: live.role
  };
  socket.data.userId = live.id;
  socket.data.userRole = live.role;
  // 角色或页面权限可能已变化，顺带重算页面广播房间
  syncSocketRooms(socket);

  return socket.data.user;
};

/**
 * Socket 事件角色检查
 * 用于验证用户是否具有特定角色
 */
const requireSocketRole = (socket, requiredRoles = ['admin', 'superadmin']) => {
  const user = requireSocketAuth(socket);
  if (!requiredRoles.includes(user.role)) {
    throw new Error('Insufficient permissions');
  }
  return user;
};

module.exports = {
  socketAuthMiddleware,
  validateSocketSession,
  requireSocketAuth,
  requireSocketRole
};
