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
  role: Joi.string().valid('superadmin', 'admin').default('admin'),
  group: Joi.string().allow('').default('')
});

const userUpdateSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30),
  password: Joi.string().min(6),
  name: Joi.string().min(2).max(50),
  role: Joi.string().valid('superadmin', 'admin'),
  group: Joi.string().allow(''),
  disabled: Joi.boolean()
});

// Get all login users (Admins and SuperAdmins)
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

// Create login user (SuperAdmin can create Admin/SuperAdmin, Admin cannot create anyone)
router.post('/', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ message: '只有超级管理员可以增加管理员' });
  }

  const { error } = userCreateSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const { username, password, role, name, group } = req.body;
  const data = db.readDb();

  if (data.users.find(u => u.username === username)) {
    return res.status(400).json({ message: '用户名已存在' });
  }

  const newUser = {
    id: Date.now().toString(),
    username,
    password: bcrypt.hashSync(password, 10),
    role: role || 'admin',
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

// Delete login user (SuperAdmin only)
router.delete('/:id', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ message: '只有超级管理员可以删除管理员' });
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
