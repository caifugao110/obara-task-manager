const jwt = require('jsonwebtoken');
const db = require('../db');
const securityConfig = require('../config/security');

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
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });
    const data = db.readDb();
    const user = data.users.find(u => u.id === decoded.id);

    if (!user) {
      return next(new Error('Authentication error: User not found'));
    }

    if (user.disabled) {
      return next(new Error('Authentication error: Account disabled'));
    }

    const systemSettings = data.settings?.system || { allowMultiDevice: true };
    // Enhanced session check: always validate sessionId against user.sessionToken
    if (user.sessionToken && decoded.sessionId !== user.sessionToken) {
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
