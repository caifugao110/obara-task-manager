const jwt = require('jsonwebtoken');
const db = require('../db');
const securityConfig = require('../config/security');

const JWT_SECRET = securityConfig.jwt.secret;

const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const data = db.readDb();
    const user = data.users.find(u => u.id === decoded.id);

    if (!user) {
      return res.status(401).json({ message: '用户不存在' });
    }

    if (user.disabled) {
      return res.status(403).json({ message: '账号已被禁用，请联系管理员', code: 'ACCOUNT_DISABLED' });
    }

    const systemSettings = data.settings?.system || { allowMultiDevice: true };
    if (!systemSettings.allowMultiDevice && user.sessionToken && decoded.sessionId !== user.sessionToken) {
      return res.status(401).json({ message: '您的账号已在其他设备登录', code: 'SESSION_INVALIDATED' });
    }

    req.user = decoded;
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

const guestViewMiddleware = (req, res, next) => {
  const data = db.readDb();
  const allowGuestView = data.settings?.system?.allowGuestView ?? true;
  if (allowGuestView) {
    return next();
  }

  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ message: '请先登录后查看', code: 'GUEST_VIEW_DISABLED' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = data.users.find(u => u.id === decoded.id);
    if (!user || user.disabled) {
      return res.status(401).json({ message: '请先登录后查看', code: 'GUEST_VIEW_DISABLED' });
    }
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: '请先登录后查看', code: 'GUEST_VIEW_DISABLED' });
  }
};

module.exports = {
  authMiddleware,
  adminMiddleware,
  superAdminMiddleware,
  guestViewMiddleware,
  accessSettingsMiddleware,
  hasAccessSettings,
  normalizeAccessSettings,
  defaultAccessSettings
};
