const jwt = require('jsonwebtoken');
const db = require('../db');
const securityConfig = require('../config/security');
const { isSessionValid } = require('./auth');

const JWT_SECRET = securityConfig.jwt.secret;
const JWT_ISSUER = securityConfig.jwt.issuer;
const JWT_AUDIENCE = securityConfig.jwt.audience;

/**
 * Socket.IO 认证中间件
 * 验证 Socket 连接中的 JWT 令牌并将用户信息附加到 socket.data
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

    next();
  } catch (err) {
    return next(new Error(`Authentication error: ${err.message}`));
  }
};

/**
 * Socket 事件认证检查
 * 用于在特定事件处理前验证用户身份
 */
const requireSocketAuth = (socket) => {
  if (!socket.data.user) {
    throw new Error('Not authenticated');
  }
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
  requireSocketAuth,
  requireSocketRole
};
