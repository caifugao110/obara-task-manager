const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const Joi = require('joi');
const asyncHandler = require('express-async-handler');

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
  name: Joi.string().min(2).max(50),
  role: Joi.string().valid('superadmin', 'admin', 'user'),
  group: Joi.string().allow(''),
  disabled: Joi.boolean()
});

const batchDeleteSchema = Joi.object({
  ids: Joi.array().items(Joi.string().required()).min(1).required()
});

// Get all login users
router.get('/', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  const data = db.readDb();
  
  // Migrate existing users to add disabled field if not exists
  let migrated = false;
  data.users.forEach(u => {
    if (u.disabled === undefined) {
      u.disabled = false;
      migrated = true;
    }
  });
  
  if (migrated) {
    await db.writeDb(data);
  }
  
  const users = data.users.map(u => {
    const { password, ...rest } = u;
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
    disabled: false // 新创建的管理员默认启用
  };

  data.users.push(newUser);
  await db.writeDb(data);

  const { password: _, ...userResponse } = newUser;
  res.status(201).json(userResponse);
}));

// Update login user (SuperAdmin can update anyone)
router.put('/:id', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
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
  const { username, password, role, name, group, disabled } = req.body;

  if (username && username !== targetUser.username && data.users.find(u => u.username === username)) {
    return res.status(400).json({ message: '用户名已存在' });
  }

  if (username) targetUser.username = username;
  if (password) targetUser.password = bcrypt.hashSync(password, 10);
  if (role && req.user.role === 'superadmin') targetUser.role = role;
  if (name) targetUser.name = name;
  if (group !== undefined) targetUser.group = group;
  if (disabled !== undefined) targetUser.disabled = disabled;

  await db.writeDb(data);

  const { password: _, ...userResponse } = targetUser;
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

  data.users.splice(userIndex, 1);
  await db.writeDb(data);
  res.json({ message: '用户已删除' });
}));

module.exports = router;
