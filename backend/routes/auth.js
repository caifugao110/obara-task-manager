const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const Joi = require('joi');
const asyncHandler = require('express-async-handler');
const { authMiddleware, isSessionValid, getSessionEntryId, isSessionEntryExpired } = require('../middleware/auth');
const securityConfig = require('../config/security');

const JWT_SECRET = securityConfig.jwt.secret;
const JWT_ISSUER = securityConfig.jwt.issuer;
const JWT_AUDIENCE = securityConfig.jwt.audience;

// 登录限流第一层：仅按 IP 计数。「IP + 用户名」细粒度限流的桶随用户名切换而更换，
// 单一 IP 可对全部账号轮流各试一批弱口令（密码喷洒），此层按 IP 总量兜底。
// 阈值需远高于单账号限额：300+ 人经同一代理出口（共用一个 IP）时，
// 早高峰集中登录不应触发；默认 300 次/15 分钟/IP，可用 LOGIN_IP_RATE_LIMIT_MAX 调整。
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.LOGIN_IP_RATE_LIMIT_MAX) || 300,
  message: { message: '登录尝试过于频繁，请15分钟后再试' }
});

// 登录限流第二层：按「IP + 用户名」计数：既防针对单个账号的爆破，
// 又避免 300+ 人经同一代理出口（共用一个 IP）时早高峰互相挤爆额度
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${req.body?.username || ''}`,
  message: { message: '登录尝试过于频繁，请15分钟后再试' }
});

// 不存在用户的等价 bcrypt 比较目标：模块加载时生成一次（随机盐），
// 让「用户不存在」分支与真实密码校验执行同样的哈希工作量，抹平响应时序差
const DUMMY_HASH = bcrypt.hashSync('timing-equalization-placeholder', 10);

// 改密码限流按「用户 ID」计数（需先通过认证），避免共用出口 IP 时互相影响
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
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

// 获取客户端真实 IP：以 req.ip 为准（trust proxy='loopback' 时已过滤外部伪造的 XFF），
// 不再直接读 X-Forwarded-For 头——该头可被客户端任意伪造
const getClientIp = (req) => {
  const raw = req.ip || req.socket?.remoteAddress || '';
  return raw.replace(/^::ffff:/, '');
};

// 登录日志写入独立表（db.appendLoginLogEntry），不再随整库 JSON 读写

router.post('/login', loginIpLimiter, loginLimiter, asyncHandler(async (req, res) => {
  const { error } = loginSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const { username, password } = req.body;
  const data = db.readDb();
  const user = data.users.find(u => u.username === username);
  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || '';
  const browserInfo = getBrowserInfo(userAgent);

  const logBase = { username, ip, userAgent, browserInfo };

  if (!user) {
    // 对不存在的用户名执行一次等价 bcrypt 比较；返回文案与密码错误一致，不产生用户枚举
    bcrypt.compareSync(password, DUMMY_HASH);
    db.appendLoginLogEntry({ ...logBase, success: false, reason: '用户不存在' });
    return res.status(401).json({ message: '用户名或密码错误' });
  }

  const isMatch = bcrypt.compareSync(password, user.password);
  if (!isMatch) {
    db.appendLoginLogEntry({ ...logBase, userId: user.id, name: user.name, role: user.role, success: false, reason: '密码错误' });
    return res.status(401).json({ message: '用户名或密码错误' });
  }

  // 禁用检查必须在密码校验通过之后：若前置返回固定 403 ACCOUNT_DISABLED，
  // 攻击者无须口令即可借该响应码探测用户名存在性与禁用状态
  if (user.disabled) {
    db.appendLoginLogEntry({ ...logBase, userId: user.id, name: user.name, role: user.role, success: false, reason: '账号已禁用' });
    return res.status(403).json({ message: '账号已被禁用，请联系管理员', code: 'ACCOUNT_DISABLED' });
  }

  const systemSettings = data.settings?.system || { allowMultiDevice: true };
  const sessionId = crypto.randomUUID();
  const userIndex = data.users.findIndex(u => u.id === user.id);
  const previousSession = data.users[userIndex].sessionToken;
  let loggedAsForcedLogout = false;

  // 先签发令牌以获取真实过期时间，会话记录的 expiresAt 与 JWT 生命周期严格对齐
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
  const sessionExpiresAt = jwt.decode(token).exp * 1000;

  // 登录时清理僵尸会话：已过期的记录清除；旧版字符串格式无过期时间记录，无法判断，
  // 一并清除（其对应 JWT 若仍在有效期，设备重新登录一次即可恢复为新格式记录）
  const now = Date.now();
  const activeTokens = (data.users[userIndex].sessionTokens || [])
    .filter(t => typeof t === 'string' ? false : !isSessionEntryExpired(t, now));
  // 登录时刻的设备序号：基于清理后的真实活跃会话数（上限 10，超出淘汰最早会话）；单设备模式恒为 1
  const deviceIndex = systemSettings.allowMultiDevice
    ? Math.min(activeTokens.length + 1, 10)
    : 1;

  if (!systemSettings.allowMultiDevice && previousSession) {
    const io = req.app.get('io');
    if (io) {
      // 浏览器 / 操作系统 / 设备类型分字段下发，前端「对方设备」提示可分开准确展示
      io.to(`user:${user.id}`).emit('session_invalidated', {
        reason: '您的账号已在其他设备登录',
        timestamp: new Date().toLocaleString('zh-CN'),
        newLoginIp: ip,
        newLoginBrowser: browserInfo.browser,
        newLoginOs: browserInfo.os,
        newLoginDevice: browserInfo.device
      });
    }
    await db.appendLoginLogEntry({
      ...logBase,
      userId: user.id,
      name: user.name,
      role: user.role,
      success: true,
      action: 'forced_previous_logout',
      deviceIndex
    });
    // 该日志已含「登录成功 + 踢出旧会话」完整语义，跳过下方重复的 login 日志
    loggedAsForcedLogout = true;
  }

  if (systemSettings.allowMultiDevice) {
    // 多设备模式：追加而非覆盖会话，各设备互不挤下线；
    // 上限 10 个（超出时淘汰最早会话），防止 JSON 库中的会话列表无限增长
    data.users[userIndex].sessionTokens = [...activeTokens, { id: sessionId, expiresAt: sessionExpiresAt }].slice(-10);
  } else {
    data.users[userIndex].sessionTokens = [{ id: sessionId, expiresAt: sessionExpiresAt }];
  }
  // sessionToken 始终指向最近一次登录的会话：从多设备切回单设备时仅保留最新会话
  data.users[userIndex].sessionToken = sessionId;

  // 仅在未以 forced_previous_logout 记录时写入普通登录日志，避免同一秒出现两条成功记录
  if (!loggedAsForcedLogout) {
    db.appendLoginLogEntry({
      ...logBase,
      userId: user.id,
      name: user.name,
      role: user.role,
      success: true,
      action: 'login',
      deviceIndex
    });
  }
  await db.writeDb(data);

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
    // 与其他鉴权点一致：显式锁定 HS256
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
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
    // 会话校验：多设备模式认可 sessionTokens 列表，单设备模式仅认可最新 sessionToken
    if (!isSessionValid(user, decoded.sessionId, systemSettings.allowMultiDevice)) {
      const message = !systemSettings.allowMultiDevice ? '您的账号已在其他设备登录' : '会话已过期，请重新登录';
      return res.status(401).json({ valid: false, code: 'SESSION_INVALIDATED', message });
    }

    res.json({ valid: true, user: { id: user.id, username: user.username, role: user.role, name: user.name }, forcePasswordChange: user.forcePasswordChange || false });
  } catch {
    // jwt.verify 失败（主要是 Token 过期）：给出 TOKEN_EXPIRED 错误码，
    // 前端据此提示「登录状态已失效」而不是静默踢回登录页
    res.status(401).json({ valid: false, message: '登录状态已失效，请重新登录', code: 'TOKEN_EXPIRED' });
  }
}));

// 解析 JWT 有效期配置（如 '3d'、'12h'、'30m'）为中文展示文案，
// 登录页据此动态展示「每 X 需要重新登录一次」的会话限制政策
const formatJwtExpiresIn = (expiresIn) => {
  const match = /^(\d+)\s*(d|h|m|s)$/i.exec(String(expiresIn || '').trim());
  if (!match) return '3 天';
  const unitText = { d: '天', h: '小时', m: '分钟', s: '秒' }[match[2].toLowerCase()];
  return `${parseInt(match[1], 10)} ${unitText}`;
};

// 会话有效期政策（无需鉴权：登录页展示重新登录周期提示时读取）
router.get('/session-policy', (req, res) => {
  res.json({
    expiresIn: securityConfig.jwt.expiresIn,
    displayText: formatJwtExpiresIn(securityConfig.jwt.expiresIn)
  });
});

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
  const newSessionExpiresAt = jwt.decode(newToken).exp * 1000;

  data.users[userIndex].password = bcrypt.hashSync(newPassword, 10);
  data.users[userIndex].forcePasswordChange = false;
  // 改密后吊销所有设备会话（安全惯例），仅当前设备凭签发的新令牌保持登录
  data.users[userIndex].sessionToken = newSessionId;
  data.users[userIndex].sessionTokens = [{ id: newSessionId, expiresAt: newSessionExpiresAt }];

  await db.writeDb(data);

  res.json({ message: '密码修改成功', token: newToken });
}));

router.post('/logout', authMiddleware, asyncHandler(async (req, res) => {
  const data = db.readDb();
  const userIndex = data.users.findIndex(u => u.id === req.user.id);

  if (userIndex !== -1) {
    const targetUser = data.users[userIndex];
    const systemSettings = data.settings?.system || { allowMultiDevice: true };
    if (systemSettings.allowMultiDevice && Array.isArray(targetUser.sessionTokens) && targetUser.sessionTokens.length > 0) {
      // 多设备模式：仅吊销当前设备的会话，其他设备保持在线；
      // 顺带清除已过期的僵尸会话与无法判断有效期的旧版字符串条目
      const now = Date.now();
      targetUser.sessionTokens = targetUser.sessionTokens
        .filter(t => getSessionEntryId(t) !== req.user.sessionId)
        .filter(t => typeof t === 'string' ? false : !isSessionEntryExpired(t, now));
      if (targetUser.sessionToken === req.user.sessionId) {
        // 当前设备是「最新会话」时，将 sessionToken 指向剩余会话；全部离线则置随机值
        targetUser.sessionToken = targetUser.sessionTokens[0]?.id || crypto.randomUUID();
      }
    } else {
      // 单设备模式：重新生成 sessionToken 使该账号所有旧令牌失效
      targetUser.sessionToken = crypto.randomUUID();
      targetUser.sessionTokens = [];
    }
    await db.writeDb(data);
  }

  res.json({ message: '退出成功' });
}));

// 获取当前登录用户的客户端信息（IP、浏览器）
router.get('/client-info', authMiddleware, asyncHandler(async (req, res) => {
  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || '';
  const browserInfo = getBrowserInfo(userAgent);
  res.json({ ip, ...browserInfo });
}));

module.exports = router;
