const jwt = require('jsonwebtoken');
const db = require('../db');

const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'obara_task_secret_key_2026');
    
    // Check if user is disabled
    const data = db.readDb();
    const user = data.users.find(u => u.id === decoded.id);
    
    if (!user) {
      return res.status(401).json({ message: '用户不存在' });
    }
    
    if (user.disabled) {
      return res.status(403).json({ message: '账号已被禁用，请联系管理员', code: 'ACCOUNT_DISABLED' });
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

module.exports = { authMiddleware, adminMiddleware, superAdminMiddleware };
