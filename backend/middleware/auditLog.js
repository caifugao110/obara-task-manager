const db = require('../db');
const crypto = require('crypto');
const { getBrowserInfo, getRouteActionDisplay } = require('../utils/auditLogDisplay');

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

const sanitizeBody = (body) => {
  if (!body || typeof body !== 'object') return body;
  const sanitized = { ...body };
  if ('password' in sanitized) sanitized.password = '[REDACTED]';
  if ('oldPassword' in sanitized) sanitized.oldPassword = '[REDACTED]';
  if ('newPassword' in sanitized) sanitized.newPassword = '[REDACTED]';
  if (Array.isArray(sanitized)) {
    return sanitized.map(item => sanitizeBody(item));
  }
  return sanitized;
};

const formatRequestBody = (method, body) => {
  if (!['POST', 'PUT'].includes(method)) return null;
  if (body == null) return null;
  const sanitized = sanitizeBody(body);
  return truncateText(JSON.stringify(sanitized), MAX_REQUEST_BODY_LENGTH);
};

const formatResponseMessage = (method, responseBody) => {
  if (responseBody == null) return null;

  if (method === 'GET') return null;

  try {
    let message;
    if (typeof responseBody === 'string') {
      message = responseBody;
    } else {
      const seen = new WeakSet();
      message = JSON.stringify(responseBody, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (Buffer.isBuffer(value)) {
            return '[Buffer]';
          }
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);
        }
        if (typeof value === 'function') {
          return '[Function]';
        }
        return value;
      });
    }

    return truncateText(message, MAX_RESPONSE_MESSAGE_LENGTH);
  } catch (err) {
    console.error('Error formatting response message:', err);
    return '[Error: Response body too large or contains circular references]';
  }
};

const getActionDescription = (method, path, body) => {
  const pathParts = path.split('/');
  const resource = pathParts[2] || '';
  const action = pathParts[3] || '';

  const routeDisplay = getRouteActionDisplay(method, path);
  if (routeDisplay) return routeDisplay.label;

  const descriptions = {
    'auth/login': '用户登录',
    'auth/logout': '用户退出',
    'auth/change-password': '修改密码',
    'users': method === 'POST' ? '创建用户' : method === 'PUT' ? '更新用户' : method === 'DELETE' ? '删除用户' : '查看用户',
    'designers': method === 'POST' ? '添加设计员' : method === 'PUT' ? '更新设计员' : method === 'DELETE' ? '删除设计员' : '查看设计员',
    'designers/reorder': '重新排序设计员',
    'tasks': method === 'POST' ? '添加任务' : method === 'PUT' ? '更新任务' : method === 'DELETE' ? '删除任务' : '查看任务',
    'tasks/item': method === 'POST' ? '添加任务' : method === 'PUT' ? '更新任务' : method === 'DELETE' ? '删除任务' : '查看任务',
    'tasks/item/batch': '批量添加任务',
    'tasks/batch-replace/search': '查询批量替换',
    'tasks/batch-replace': '批量替换任务',
    'tasks/move': '移动任务',
    'settings': method === 'PUT' ? '更新设置' : '查看设置',
    'settings/leaderboard': method === 'PUT' ? '更新排行榜设置' : '查看排行榜设置',
    'settings/work-hours': method === 'PUT' ? '更新工时设置' : '查看工时设置',
    'settings/status-tracking': method === 'PUT' ? '更新状态跟踪设置' : '查看状态跟踪设置',
    'settings/system-settings': method === 'PUT' ? '更新系统设置权限' : '查看系统设置权限',
    'system/settings': method === 'PUT' ? '更新系统设置' : '查看系统设置',
    'system/export-xls': '导出任务数据',
    'system/import-xls': '导入任务数据',
    'system/version': '查看版本',
    'system/audit-logs': '查看日志',
    'system/audit-logs/filter-options': '筛选日志',
    'system/audit-logs/export': '导出日志',
    'system/login-logs': '查看登录日志',
    'system/admin-login-logs': '查看管理员登录记录',
    'status-tracking/items': method === 'POST' ? '添加状态跟踪' : method === 'PUT' ? '更新状态跟踪' : method === 'DELETE' ? '删除状态跟踪' : '查看状态跟踪',
    'status-tracking/items/bulk': '批量导入状态跟踪',
    'status-tracking/export': '导出状态跟踪表',
    'status-tracking/import': '导入状态跟踪表',
    'work-hours/export': '导出工时管理表',
    'spec/spec-info': '查询仕样信息'
  };

  const key = `${resource}/${action}`;
  return descriptions[key] || descriptions[resource] || `${method} ${path}`;
};

const appendAuditLogDirect = async (entry) => {
  const data = db.readDb();
  await appendAuditLog(data, entry);
  await db.writeDb(data);
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
      let user = req.user;

      const fullPath = req.originalUrl ? req.originalUrl.split('?')[0] : req.path;

      if (!user && fullPath === '/api/auth/login' && responseStatus === 200 && responseBody) {
        const body = typeof responseBody === 'string' ? JSON.parse(responseBody) : responseBody;
        if (body.user) {
          user = body.user;
        }
      }

      if (!user) return;

      const path = fullPath;
      const method = req.method;

      if (['OPTIONS', 'HEAD'].includes(method)) return;

      if (path.startsWith('/api/system/login-logs') || path.startsWith('/api/system/audit-logs')) return;

      const action = getActionDescription(method, path, req.body);
      const ip = getClientIp(req);
      const userAgent = req.headers['user-agent'] || '';
      const browserInfo = getBrowserInfo(userAgent);

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
        browserInfo,
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

module.exports = { auditLogMiddleware, appendAuditLogDirect };
