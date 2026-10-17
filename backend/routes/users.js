const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const Joi = require('joi');
const asyncHandler = require('express-async-handler');

// 自助改密（本人修改自己的密码）限流：与 /api/auth/change-password 同级（5 次/15 分钟，按用户 ID 计数），
// 防止被盗 JWT 在旧密码校验环节在线爆破；超管重置他人密码不经过该校验，故不受此限流影响
const selfServicePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  message: { message: '密码修改尝试过于频繁，请15分钟后再试' }
});

// 仅当请求为「自助改密」（携带 password 且目标为本人）时才套用上述限流
const maybeSelfServicePasswordLimit = (req, res, next) => {
  if (req.user && req.user.id === req.params.id && req.body && req.body.password) {
    return selfServicePasswordLimiter(req, res, next);
  }
  next();
};

const userCreateSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  password: Joi.string().min(6).required(),
  name: Joi.string().min(2).max(50).required(),
  role: Joi.string().valid('superadmin', 'admin', 'user').default('admin'),
  group: Joi.string().allow('').default('')
});

const userUpdateSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30),
  password: Joi.string().min(6),
  // 自助改密时必填的当前密码（是否必填由处理器按 req.user.id === :id 判定）
  oldPassword: Joi.string(),
  name: Joi.string().min(2).max(50),
  role: Joi.string().valid('superadmin', 'admin', 'user'),
  group: Joi.string().allow(''),
  disabled: Joi.boolean()
});

const batchDeleteSchema = Joi.object({
  ids: Joi.array().items(Joi.string().required()).min(1).required()
});

const batchResetPasswordSchema = Joi.object({
  ids: Joi.array().items(Joi.string().required()).min(1).required(),
  mode: Joi.string().valid('manual', 'auto').required(),
  password: Joi.string().min(6).when('mode', {
    is: 'manual',
    then: Joi.required(),
    otherwise: Joi.forbidden()
  })
});

// Get all login users
router.get('/', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  const data = db.readDb();

  const users = data.users.map(u => {
    const { password, sessionToken, ...rest } = u;
    return rest;
  });
  res.json(users);
}));

// Create login user (SuperAdmin can create any role, Admin can create normal users)
router.post('/', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  const { error } = userCreateSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const { username, password, role, name, group } = req.body;
  const targetRole = req.user.role === 'superadmin' ? (role || 'admin') : 'user';
  if (req.user.role !== 'superadmin' && role && role !== 'user') {
    return res.status(403).json({ message: '一般管理员只能创建普通用户' });
  }

  const data = db.readDb();

  if (data.users.find(u => u.username === username)) {
    return res.status(400).json({ message: '用户名已存在' });
  }

  const newUser = {
    id: Date.now().toString(),
    username,
    password: bcrypt.hashSync(password, 10),
    role: targetRole,
    name: name || username,
    group: group || '',
    disabled: false,
    forcePasswordChange: true
  };

  data.users.push(newUser);
  await db.writeDb(data);

  const { password: _, sessionToken: __, ...userResponse } = newUser;
  res.status(201).json(userResponse);
}));

// Update login user (SuperAdmin can update anyone)
router.put('/:id', [authMiddleware, adminMiddleware, maybeSelfServicePasswordLimit], asyncHandler(async (req, res) => {
  if (req.user.role !== 'superadmin' && req.user.id !== req.params.id) {
    return res.status(403).json({ message: '权限不足' });
  }

  const { error } = userUpdateSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const data = db.readDb();
  const userIndex = data.users.findIndex(u => u.id === req.params.id);
  if (userIndex === -1) {
    return res.status(404).json({ message: '用户不存在' });
  }

  const targetUser = data.users[userIndex];
  const { username, password, oldPassword, role, name, group, disabled } = req.body;

  // 超级管理员账号一律不可被禁用（含超管禁用自己）。
  // 一旦禁用最后一个超管，系统将失去唯一的权限入口，只能改数据库恢复。
  if (disabled === true && targetUser.role === 'superadmin') {
    return res.status(403).json({ message: '超级管理员账号不可禁用' });
  }

  // 超级管理员不能把自己降级：同样是防止系统失去超管入口。
  if (role && req.user.role === 'superadmin' && targetUser.id === req.user.id && role !== 'superadmin') {
    return res.status(403).json({ message: '不能降低自己的超级管理员权限' });
  }

  if (username && username !== targetUser.username && data.users.find(u => u.username === username)) {
    return res.status(400).json({ message: '用户名已存在' });
  }

  if (username) targetUser.username = username;
  if (password) {
    // 自助改密（本人改自己）必须校验旧密码，与 /api/auth/change-password 对齐：
    // 否则被盗 JWT 可直接改密完成账号接管（旧密码校验正是防令牌窃取的控制点）；
    // 超级管理员重置他人密码属授权操作，无需旧密码
    if (req.user.id === req.params.id) {
      if (!oldPassword) {
        return res.status(400).json({ message: '请输入当前密码' });
      }
      // 旧密码错误返回 400 而非 401：避免前端全局拦截器误判会话过期而强制登出
      if (!bcrypt.compareSync(oldPassword, targetUser.password)) {
        return res.status(400).json({ message: '旧密码不正确' });
      }
    }
    targetUser.password = bcrypt.hashSync(password, 10);
    // 超级管理员重置密码后可直接用新密码登录，不强制改密；其他场景仍要求下次登录修改密码
    if (req.user.role !== 'superadmin') {
      targetUser.forcePasswordChange = true;
    } else {
      targetUser.forcePasswordChange = false;
    }
    // 重置密码后吊销该账号已签发的令牌，旧会话立即失效（对齐改密接口的行为）
    targetUser.sessionToken = crypto.randomUUID();
    targetUser.sessionTokens = [];
    // 记录会话失效原因：旧会话下次校验时据此返回准确提示，而非误报“在其他设备登录”
    targetUser.sessionInvalidationReason = 'password_reset';
  }
  if (role && req.user.role === 'superadmin') targetUser.role = role;
  if (name) targetUser.name = name;
  if (group !== undefined) targetUser.group = group;
  // 禁用/启用账号与角色变更同级，仅超级管理员可操作，防止管理员禁用自己或他人绕过管理
  if (disabled !== undefined && req.user.role === 'superadmin') targetUser.disabled = disabled;

  await db.writeDb(data);

  const { password: _, sessionToken: __, ...userResponse } = targetUser;
  res.json(userResponse);
}));

// Batch delete login users (SuperAdmin only)
router.post('/batch-delete', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ message: '只有超级管理员可以删除登录用户' });
  }

  const { error } = batchDeleteSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const idSet = new Set(req.body.ids);
  if (idSet.has(req.user.id)) {
    return res.status(400).json({ message: '不能删除当前登录账号' });
  }

  const data = db.readDb();
  const blocked = data.users.find(u => idSet.has(u.id) && u.role === 'superadmin');
  if (blocked) {
    return res.status(400).json({ message: '不能批量删除超级管理员账号' });
  }

  const beforeCount = data.users.length;
  data.users = data.users.filter(u => !idSet.has(u.id));
  const deletedCount = beforeCount - data.users.length;

  await db.writeDb(data);
  res.json({ message: `已删除 ${deletedCount} 个登录用户`, deletedCount });
}));

// Batch reset login user passwords (SuperAdmin only)
// mode=manual: 所有选中账号统一改为指定密码；mode=auto: 每个账号由服务端随机生成独立密码
// 密码仅在本次响应中明文返回一次，落库前已 bcrypt 加密
router.post('/batch-reset-password', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ message: '只有超级管理员可以批量重置密码' });
  }

  const { error } = batchResetPasswordSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const { ids, mode } = req.body;
  const idSet = new Set(ids);

  const data = db.readDb();

  if (idSet.has(req.user.id)) {
    return res.status(400).json({ message: '不能批量重置当前登录账号的密码，请使用单账号重置' });
  }

  if (data.users.find(u => idSet.has(u.id) && u.role === 'superadmin')) {
    return res.status(400).json({ message: '不能批量重置超级管理员账号的密码' });
  }

  const targets = data.users.filter(u => idSet.has(u.id));
  if (targets.length === 0) {
    return res.status(404).json({ message: '未找到要重置的登录用户' });
  }
  if (targets.length !== idSet.size) {
    return res.status(400).json({ message: '存在无效的用户，请刷新列表后重试' });
  }

  const results = targets.map(u => {
    const password = mode === 'manual' ? req.body.password : crypto.randomBytes(9).toString('base64url');
    u.password = bcrypt.hashSync(password, 10);
    // 与单个重置保持一致：超管重置后可直接用新密码登录，不强制改密
    u.forcePasswordChange = false;
    // 吊销该账号已签发的令牌，旧会话立即失效
    u.sessionToken = crypto.randomUUID();
    u.sessionTokens = [];
    u.sessionInvalidationReason = 'password_reset';
    return { id: u.id, username: u.username, name: u.name, password };
  });

  await db.writeDb(data);

  res.json({
    message: `已重置 ${results.length} 个账号的密码`,
    resetCount: results.length,
    credentials: results
  });
}));

// Delete login user (SuperAdmin only)
router.delete('/:id', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ message: '只有超级管理员可以删除登录用户' });
  }

  const data = db.readDb();
  if (req.params.id === req.user.id) {
    return res.status(400).json({ message: '不能删除当前登录账号' });
  }

  const userIndex = data.users.findIndex(u => u.id === req.params.id);
  if (userIndex === -1) {
    return res.status(404).json({ message: '用户不存在' });
  }

  // 与批量删除保持一致：超级管理员账号不可删除。
  // 删掉最后一个超管会让系统失去唯一的权限入口，只能手工改数据库恢复。
  if (data.users[userIndex].role === 'superadmin') {
    return res.status(400).json({ message: '不能删除超级管理员账号' });
  }

  data.users.splice(userIndex, 1);
  await db.writeDb(data);
  res.json({ message: '用户已删除' });
}));

module.exports = router;
