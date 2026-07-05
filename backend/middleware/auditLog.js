const db = require('../db');
const crypto = require('crypto');

const appendAuditLog = async (data, entry) => {
  if (!data.auditLogs) data.auditLogs = [];
  data.auditLogs.push({
    id: crypto.randomUUID(),
    ...entry,
    timestamp: new Date().toISOString()
  });
  if (data.auditLogs.length > 2000) {
    data.auditLogs = data.auditLogs.slice(-2000);
  }
};

const getClientIp = (req) => {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    '';
};

const MAX_RESPONSE_MESSAGE_LENGTH = 2000;
const MAX_REQUEST_BODY_LENGTH = 2000;

const truncateText = (text, maxLength) => {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}... [truncated ${text.length - maxLength} chars]`;
};

const formatRequestBody = (method, body) => {
  if (!['POST', 'PUT'].includes(method)) return null;
  if (body == null) return null;
  return truncateText(JSON.stringify(body), MAX_REQUEST_BODY_LENGTH);
};

const formatResponseMessage = (method, responseBody) => {
  if (responseBody == null) return null;

  // GET responses can include the entire task table. Keeping them in db.json
  // makes every future request parse the same large payload again.
  if (method === 'GET') return null;

  const message = typeof responseBody === 'string'
    ? responseBody
    : JSON.stringify(responseBody);

  return truncateText(message, MAX_RESPONSE_MESSAGE_LENGTH);
};

const getActionDescription = (method, path, body) => {
  const pathParts = path.split('/');
  const resource = pathParts[2] || '';
  const action = pathParts[3] || '';

  const descriptions = {
    'auth/login': '用户登录',
    'auth/logout': '用户退出',
    'auth/change-password': '修改密码',
    'users': method === 'POST' ? '创建用户' : method === 'PUT' ? '更新用户' : method === 'DELETE' ? '删除用户' : '查看用户',
    'designers': method === 'POST' ? '添加设计员' : method === 'PUT' ? '更新设计员' : method === 'DELETE' ? '删除设计员' : '查看设计员',
    'tasks': method === 'POST' ? '添加任务' : method === 'PUT' ? '更新任务' : method === 'DELETE' ? '删除任务' : '查看任务',
    'settings': method === 'PUT' ? '更新设置' : '查看设置',
    'system/settings': method === 'PUT' ? '更新系统设置' : '查看系统设置',
    'system/export-xls': '导出任务数据',
    'system/import-xls': '导入任务数据',
    'status-tracking/items': method === 'POST' ? '添加状态跟踪记录' : method === 'PUT' ? '更新状态跟踪记录' : method === 'DELETE' ? '删除状态跟踪记录' : '查看状态跟踪记录',
    'status-tracking/export': '导出状态跟踪表',
    'status-tracking/import': '导入状态跟踪表',
    'work-hours/export': '导出工时管理表',
    'spec/spec-info': '查询仕样信息'
  };

  const key = `${resource}/${action}`;
  return descriptions[key] || descriptions[resource] || `${method} ${path}`;
};

const auditLogMiddleware = async (req, res, next) => {
  const startTime = Date.now();
  const originalSend = res.send;
  const originalJson = res.json;

  let responseBody = null;
  let responseStatus = null;

  res.send = function(data) {
    responseBody = data;
    responseStatus = this.statusCode;
    return originalSend.call(this, data);
  };

  res.json = function(data) {
    responseBody = data;
    responseStatus = this.statusCode;
    return originalJson.call(this, data);
  };

  res.on('finish', async () => {
    try {
      const user = req.user;
      if (!user) return;

      const path = req.path;
      const method = req.method;

      if (['OPTIONS', 'HEAD'].includes(method)) return;

      if (path.startsWith('/api/system/login-logs') || path.startsWith('/api/system/audit-logs')) return;

      const action = getActionDescription(method, path, req.body);
      const ip = getClientIp(req);
      const userAgent = req.headers['user-agent'] || '';

      const logEntry = {
        userId: user.id,
        username: user.username,
        name: user.name || user.username,
        role: user.role,
        action,
        method,
        path,
        ip,
        userAgent,
        requestBody: formatRequestBody(method, req.body),
        responseStatus: responseStatus || res.statusCode,
        responseMessage: formatResponseMessage(method, responseBody),
        durationMs: Date.now() - startTime
      };

      const data = db.readDb();
      await appendAuditLog(data, logEntry);
      await db.writeDb(data);
    } catch (err) {
      console.error('Error writing audit log:', err);
    }
  });

  next();
};

module.exports = { auditLogMiddleware };
