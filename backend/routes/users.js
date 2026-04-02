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
  role: Joi.string().valid('admin', 'user').default('user')
});

// Get all users (Admin only)
router.get('/', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  const data = db.readDb();
  const users = data.users.map(u => {
    const { password, ...rest } = u;
    return rest;
  });
  res.json(users);
}));

// Create user (Admin only)
router.post('/', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  const { error } = userCreateSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const { username, password, role, name } = req.body;
  const data = db.readDb();

  if (data.users.find(u => u.username === username)) {
    return res.status(400).json({ message: '用户名已存在' });
  }

  const newUser = {
    id: Date.now().toString(),
    username,
    password: bcrypt.hashSync(password, 10),
    role: role || 'user',
    name: name || username
  };

  data.users.push(newUser);
  await db.writeDb(data);

  const { password: _, ...userResponse } = newUser;
  res.status(201).json(userResponse);
}));

// Delete user (Admin only)
router.delete('/:id', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  const data = db.readDb();
  
  // Prevent deleting self
  if (req.params.id === req.user.id) {
    return res.status(400).json({ message: '不能删除当前登录账号' });
  }

  const userIndex = data.users.findIndex(u => u.id === req.params.id);
  if (userIndex === -1) {
    return res.status(404).json({ message: '用户不存在' });
  }

  data.users.splice(userIndex, 1);
  // Also clean up tasks for this user? Optional, but safer to keep them or clean up.
  // For now, just remove the user.
  
  await db.writeDb(data);
  res.json({ message: 'User deleted' });
}));

module.exports = router;
