const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const asyncHandler = require('express-async-handler');

const JWT_SECRET = process.env.JWT_SECRET || 'obara_task_secret_key_2026';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: '登录尝试过于频繁，请15分钟后再试' }
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
      io.to(`user:${user.id}`).emit('session_invalidated', { reason: '您的账号已在其他设备登录' });
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

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

  res.json({ token, user: { id: user.id, username: user.username, role: user.role, name: user.name } });
}));

router.get('/validate', asyncHandler(async (req, res) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ valid: false, message: 'No token' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const data = db.readDb();
    const user = data.users.find(u => u.id === decoded.id);

    if (!user || user.disabled) {
      return res.status(401).json({ valid: false, code: user?.disabled ? 'ACCOUNT_DISABLED' : 'USER_NOT_FOUND' });
    }

    const systemSettings = data.settings?.system || { allowMultiDevice: true };
    if (!systemSettings.allowMultiDevice && user.sessionToken && decoded.sessionId !== user.sessionToken) {
      return res.status(401).json({ valid: false, code: 'SESSION_INVALIDATED', message: '您的账号已在其他设备登录' });
    }

    res.json({ valid: true, user: { id: user.id, username: user.username, role: user.role, name: user.name } });
  } catch {
    res.status(401).json({ valid: false, message: 'Token is not valid' });
  }
}));

module.exports = router;
