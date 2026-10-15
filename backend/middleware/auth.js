const jwt = require('jsonwebtoken');
const db = require('../db');
const securityConfig = require('../config/security');

const JWT_SECRET = securityConfig.jwt.secret;
const JWT_ISSUER = securityConfig.jwt.issuer;
const JWT_AUDIENCE = securityConfig.jwt.audience;

// 会话有效性校验（HTTP 与 Socket 层共用）：
// - 多设备模式（allowMultiDevice=true）：认可 sessionTokens 列表中的全部会话，
//   各设备新登录追加而非覆盖，旧设备不会被挤下线；
//   列表为空时回退到单 token 校验（兼容历史数据及管理员重置密码后的全吊销状态）
// - 单设备模式：仅认可 sessionToken 对应的最新会话；
//   sessionToken 为空视为未启用会话校验（兼容从未登录过的历史账号）
//
// sessionTokens 条目格式：
// - 旧格式：字符串 sessionId（无过期时间记录，默认视为有效，行为与历史版本一致）
// - 新格式：{ id, expiresAt }（毫秒时间戳，与 JWT 实际过期时间对齐），
//   已过期的条目校验不通过，并在登录/退出时被顺带清除
const getSessionEntryId = (entry) => (typeof entry === 'string' ? entry : entry?.id);

const isSessionEntryExpired = (entry, now = Date.now()) =>
  typeof entry !== 'string' && Number(entry?.expiresAt) > 0 && entry.expiresAt < now;

const isSessionValid = (user, sessionId, allowMultiDevice, now = Date.now()) => {
  if (allowMultiDevice) {
    const tokens = user.sessionTokens || [];
    if (tokens.length > 0) {
      const entry = tokens.find(t => getSessionEntryId(t) === sessionId);
      return Boolean(entry) && !isSessionEntryExpired(entry, now);
    }
  }
  return !user.sessionToken || user.sessionToken === sessionId;
};

// 会话失效提示文案：优先使用一次性失效原因（如密码被修改/重置），
// 避免统一误报「在其他设备登录」；鉴权中间件与 /verify 校验共用
const getSessionInvalidationMessage = (user, allowMultiDevice) => {
  if (user?.sessionInvalidationReason === 'password_reset') return '密码已被管理员重置，请使用新密码重新登录';
  if (user?.sessionInvalidationReason === 'password_changed') return '密码已修改，请使用新密码重新登录';
  return allowMultiDevice ? '会话已过期，请重新登录' : '您的账号已在其他设备登录';
};

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
    // 会话校验：多设备模式认可 sessionTokens 列表，单设备模式仅认可最新 sessionToken
    if (!isSessionValid(user, decoded.sessionId, systemSettings.allowMultiDevice)) {
      // 优先返回一次性失效原因（如密码被修改/重置）的准确提示；
      // 此处保持同步、不做读后即清（账号重新登录时会统一清除），
      // 避免被踢设备的普通请求仍误报「在其他设备登录」
      const message = getSessionInvalidationMessage(user, systemSettings.allowMultiDevice);
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
    // jwt.verify 失败（主要是 Token 过期）：返回 TOKEN_EXPIRED 错误码，
    // 前端据此弹出「登录状态已失效」提示并引导重新登录，避免静默登出让用户困惑
    res.status(401).json({ message: '登录状态已失效，请重新登录', code: 'TOKEN_EXPIRED' });
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
  defaultAccessSettings,
  isSessionValid,
  getSessionInvalidationMessage,
  getSessionEntryId,
  isSessionEntryExpired
};
