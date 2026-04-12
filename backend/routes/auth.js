const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const asyncHandler = require('express-async-handler');

// Rate limiter for login to prevent brute force
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 login requests per windowMs
  message: { message: '登录尝试过于频繁，请15分钟后再试' }
});

const loginSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  password: Joi.string().min(6).required()
});

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  // Validate input
  const { error } = loginSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const { username, password } = req.body;
  const data = db.readDb();
  const user = data.users.find(u => u.username === username);

  if (!user) {
    return res.status(401).json({ message: '用户名或密码错误' }); // Generic message for security
  }

  // Check if user is disabled
  if (user.disabled) {
    return res.status(403).json({ message: '账号已被禁用，请联系管理员', code: 'ACCOUNT_DISABLED' });
  }

  const isMatch = bcrypt.compareSync(password, user.password);
  if (!isMatch) {
    return res.status(401).json({ message: '用户名或密码错误' });
  }

  const payload = {
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET || 'obara_task_secret_key_2026', { expiresIn: '7d' });

  res.json({
    token,
    user: payload
  });
}));

module.exports = router;
