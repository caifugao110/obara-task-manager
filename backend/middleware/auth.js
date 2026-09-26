const jwt = require('jsonwebtoken');
const db = require('../db');
const securityConfig = require('../config/security');

const JWT_SECRET = securityConfig.jwt.secret;
const JWT_ISSUER = securityConfig.jwt.issuer;
const JWT_AUDIENCE = securityConfig.jwt.audience;

const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  try {
    // 显式锁定 HS256：防止 alg=none / RS256 公钥混淆一类的算法降级攻击，
    // 不依赖 jsonwebtoken 版本的默认白名单
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });
    const data = db.readDb();
    const user = data.users.find(u => u.id === decoded.id);

    if (!user) {
      return res.status(401).json({ message: '用户不存在' });
    }

    if (user.disabled) {
      return res.status(403).json({ message: '账号已被禁用，请联系管理员', code: 'ACCOUNT_DISABLED' });
    }

    const systemSettings = data.settings?.system || { allowMultiDevice: true };
    // Enhanced session check: always validate sessionId against user.sessionToken
    // If they don't match, the token is considered stale (e.g., after logout or password change)
    if (user.sessionToken && decoded.sessionId !== user.sessionToken) {
      const message = !systemSettings.allowMultiDevice ? '您的账号已在其他设备登录' : '会话已过期，请重新登录';
      return res.status(401).json({ message, code: 'SESSION_INVALIDATED' });
    }

    // 必须先修改初始密码：未改密前除「修改密码 / 退出登录」外一律拒绝，
    // 防止绕过前端页面直接调用 API
    if (user.forcePasswordChange) {
      const pathOnly = (req.originalUrl || req.path || '').split('?')[0];
      const isAllowedPath = req.method === 'POST' &&
        (pathOnly === '/api/auth/change-password' || pathOnly === '/api/auth/logout');
      if (!isAllowedPath) {
        return res.status(403).json({
          message: '请先修改初始密码后再进行其他操作',
          code: 'FORCE_PASSWORD_CHANGE'
        });
      }
    }

    req.user = { ...decoded, role: user.role, name: user.name, username: user.username };
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};

const adminMiddleware = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'superadmin')) {
    next();
  } else {
    res.status(403).json({ message: '管理员资源，访问被拒绝。' });
  }
};

const superAdminMiddleware = (req, res, next) => {
  if (req.user && req.user.role === 'superadmin') {
    next();
  } else {
    res.status(403).json({ message: '超级管理员资源，访问被拒绝。' });
  }
};

const defaultAccessSettings = { enabled: true, allowAdmins: true, allowViewers: false };

const normalizeAccessSettings = (settings = defaultAccessSettings) => {
  const normalized = { ...defaultAccessSettings, ...settings };
  if (normalized.allowViewers) normalized.allowAdmins = true;
  return normalized;
};

const hasAccessSettings = (user, settingsKey) => {
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  const data = db.readDb();
  const settings = normalizeAccessSettings(data.settings?.[settingsKey]);
  if (settingsKey === 'systemSettings') settings.allowViewers = false;
  if (!settings.enabled) return false;
  if (user.role === 'admin' && settings.allowAdmins) return true;
  if (user.role === 'user' && settings.allowViewers) return true;
  return false;
};

const accessSettingsMiddleware = (settingsKey) => (req, res, next) => {
  if (hasAccessSettings(req.user, settingsKey)) {
    return next();
  }
  return res.status(403).json({ message: '无权访问' });
};

module.exports = {
  authMiddleware,
  adminMiddleware,
  superAdminMiddleware,
  accessSettingsMiddleware,
  hasAccessSettings,
  normalizeAccessSettings,
  defaultAccessSettings
};
