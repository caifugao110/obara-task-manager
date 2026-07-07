const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const asyncHandler = require('express-async-handler');
const { authMiddleware } = require('../middleware/auth');
const securityConfig = require('../config/security');

const JWT_SECRET = securityConfig.jwt.secret;
const JWT_ISSUER = securityConfig.jwt.issuer;
const JWT_AUDIENCE = securityConfig.jwt.audience;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: '登录尝试过于频繁，请15分钟后再试' }
});

const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: '密码修改尝试过于频繁，请15分钟后再试' }
});

const changePasswordSchema = Joi.object({
  oldPassword: Joi.string().required(),
  newPassword: Joi.string().min(6).required()
});

const loginSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  password: Joi.string().min(6).required()
});

const getBrowserInfo = (userAgent = '') => {
  const ua = String(userAgent);
  let browser = 'Unknown Browser';
  let os = 'Unknown OS';

  if (/Edg\//i.test(ua)) browser = 'Microsoft Edge';
  else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) browser = 'Opera';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && /Version\//i.test(ua)) browser = 'Safari';
  else if (/MSIE|Trident/i.test(ua)) browser = 'Internet Explorer';

  if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  const device = /Mobile|Android|iPhone|iPad|iPod/i.test(ua) ? 'Mobile' : 'Desktop';

  return { browser, os, device, summary: `${browser} / ${os} / ${device}` };
};

const appendLoginLog = async (data, entry) => {
  if (!data.loginLogs) data.loginLogs = [];
  data.loginLogs.push({
    id: crypto.randomUUID(),
    ...entry,
    timestamp: new Date().toISOString()
  });
  if (data.loginLogs.length > 500) {
    data.loginLogs = data.loginLogs.slice(-500);
  }
};

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const { error } = loginSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const { username, password } = req.body;
  const data = db.readDb();
  const user = data.users.find(u => u.username === username);
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
  const userAgent = req.headers['user-agent'] || '';
  const browserInfo = getBrowserInfo(userAgent);

  const logBase = { username, ip, userAgent, browserInfo };

  if (!user) {
    return res.status(401).json({ message: '用户名或密码错误' });
  }

  if (user.disabled) {
    await appendLoginLog(data, { ...logBase, userId: user.id, name: user.name, role: user.role, success: false, reason: '账号已禁用' });
    await db.writeDb(data);
    return res.status(403).json({ message: '账号已被禁用，请联系管理员', code: 'ACCOUNT_DISABLED' });
  }

  const isMatch = bcrypt.compareSync(password, user.password);
  if (!isMatch) {
    await appendLoginLog(data, { ...logBase, userId: user.id, name: user.name, role: user.role, success: false, reason: '密码错误' });
    await db.writeDb(data);
    return res.status(401).json({ message: '用户名或密码错误' });
  }

  const systemSettings = data.settings?.system || { allowMultiDevice: true };
  const sessionId = crypto.randomUUID();
  const userIndex = data.users.findIndex(u => u.id === user.id);
  const previousSession = data.users[userIndex].sessionToken;

  if (!systemSettings.allowMultiDevice && previousSession) {
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${user.id}`).emit('session_invalidated', {
        reason: '您的账号已在其他设备登录',
        timestamp: new Date().toLocaleString('zh-CN'),
        newLoginIp: ip,
        newLoginBrowser: browserInfo.summary
      });
    }
    await appendLoginLog(data, {
      ...logBase,
      userId: user.id,
      name: user.name,
      role: user.role,
      success: true,
      action: 'forced_previous_logout'
    });
  }

  data.users[userIndex].sessionToken = sessionId;

  await appendLoginLog(data, {
    ...logBase,
    userId: user.id,
    name: user.name,
    role: user.role,
    success: true,
    action: 'login'
  });
  await db.writeDb(data);

  const payload = {
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    sessionId
  };

  const token = jwt.sign(payload, JWT_SECRET, { 
    expiresIn: securityConfig.jwt.expiresIn,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE
  });

  res.json({ 
    token, 
    user: { 
      id: user.id, 
      username: user.username, 
      role: user.role, 
      name: user.name 
    },
    forcePasswordChange: user.forcePasswordChange || false
  });
}));

router.get('/validate', asyncHandler(async (req, res) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ valid: false, message: 'No token' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });
    const data = db.readDb();

    // Migrate: set forcePasswordChange=true for existing non-superadmin users
    if (!data.settings?._migrations?.forcePasswordChangeMigrated) {
      data.users.forEach(u => {
        if (u.role !== 'superadmin' && !u.forcePasswordChange) {
          u.forcePasswordChange = true;
        }
      });
      if (!data.settings) data.settings = {};
      if (!data.settings._migrations) data.settings._migrations = {};
      data.settings._migrations.forcePasswordChangeMigrated = true;
      db.writeDb(data);
    }

    const user = data.users.find(u => u.id === decoded.id);

    if (!user || user.disabled) {
      return res.status(401).json({ valid: false, code: user?.disabled ? 'ACCOUNT_DISABLED' : 'USER_NOT_FOUND' });
    }

    const systemSettings = data.settings?.system || { allowMultiDevice: true };
    // Enhanced session check: always validate sessionId against user.sessionToken
    if (user.sessionToken && decoded.sessionId !== user.sessionToken) {
      const message = !systemSettings.allowMultiDevice ? '您的账号已在其他设备登录' : '会话已过期，请重新登录';
      return res.status(401).json({ valid: false, code: 'SESSION_INVALIDATED', message });
    }

    res.json({ valid: true, user: { id: user.id, username: user.username, role: user.role, name: user.name }, forcePasswordChange: user.forcePasswordChange || false });
  } catch {
    res.status(401).json({ valid: false, message: 'Token is not valid' });
  }
}));

router.post('/change-password', authMiddleware, changePasswordLimiter, asyncHandler(async (req, res) => {
  const { error } = changePasswordSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const { oldPassword, newPassword } = req.body;

  const data = db.readDb();
  const userIndex = data.users.findIndex(u => u.id === req.user.id);
  
  if (userIndex === -1) {
    return res.status(404).json({ message: '用户不存在' });
  }

  const user = data.users[userIndex];
  const isMatch = bcrypt.compareSync(oldPassword, user.password);
  
  if (!isMatch) {
    return res.status(401).json({ message: '旧密码不正确' });
  }

  const newSessionId = crypto.randomUUID();
  data.users[userIndex].password = bcrypt.hashSync(newPassword, 10);
  data.users[userIndex].forcePasswordChange = false;
  data.users[userIndex].sessionToken = newSessionId;
  
  await db.writeDb(data);

  const payload = {
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    sessionId: newSessionId
  };
  const newToken = jwt.sign(payload, JWT_SECRET, { 
    expiresIn: securityConfig.jwt.expiresIn,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE
  });
  
  res.json({ message: '密码修改成功', token: newToken });
}));

router.post('/logout', authMiddleware, asyncHandler(async (req, res) => {
  const data = db.readDb();
  const userIndex = data.users.findIndex(u => u.id === req.user.id);
  
  if (userIndex !== -1) {
    // Generate a new UUID on logout to invalidate all existing tokens for this user
    data.users[userIndex].sessionToken = crypto.randomUUID();
    await db.writeDb(data);
  }
  
  res.json({ message: '退出成功' });
}));

module.exports = router;
