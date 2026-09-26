const db = require('../db');
const crypto = require('crypto');
const { getBrowserInfo, getRouteActionDisplay } = require('../utils/auditLogDisplay');

// 操作日志写入 audit_logs 独立表。
// 早期实现把日志塞进 kv_store 的整库 JSON，每写一条都要 readDb()（整库深拷贝）
// + writeDb()（8 个集合全量序列化 UPSERT）；而本中间件在每个请求结束时都会写一次，
// 造成严重的写放大。改为单次 INSERT 后不再触碰业务数据快照。
const appendAuditLog = async (entry) => {
  db.appendAuditLogEntry({
    id: crypto.randomUUID(),
    ...entry,
    timestamp: new Date().toISOString()
  });
};

// 以 req.ip 为准（trust proxy='loopback' 时已过滤外部伪造的 XFF），
// 不再直接读 X-Forwarded-For 头——该头可被客户端任意伪造
const getClientIp = (req) => {
  const raw = req.ip || req.socket?.remoteAddress || '';
  // 去除 IPv4 映射地址的 ::ffff: 前缀
  return raw.replace(/^::ffff:/, '');
};

const MAX_RESPONSE_MESSAGE_LENGTH = 2000;
const MAX_REQUEST_BODY_LENGTH = 2000;

const truncateText = (text, maxLength) => {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}... [truncated ${text.length - maxLength} chars]`;
};

// 敏感字段名（不区分大小写）：命中即在审计日志中脱敏
const SENSITIVE_KEY_PATTERN = /password|passwd|secret|token|api[-_]?key|authorization/i;

// 递归脱敏：嵌套对象与数组中的敏感字段同样处理，避免明文口令进入审计日志
const sanitizeBody = (value) => {
  if (Array.isArray(value)) {
    return value.map(sanitizeBody);
  }
  if (!value || typeof value !== 'object') return value;
  const sanitized = {};
  for (const [key, val] of Object.entries(value)) {
    sanitized[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : sanitizeBody(val);
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
      // 响应体中的敏感字段（如登录/改密返回的 token）同样需要脱敏，
      // 避免可冒用身份的凭证明文落入操作日志
      let parsed = null;
      try { parsed = JSON.parse(responseBody); } catch { /* 非 JSON 字符串，原样记录 */ }
      message = parsed && typeof parsed === 'object'
        ? JSON.stringify(sanitizeBody(parsed))
        : responseBody;
    } else {
      const sanitizedBody = sanitizeBody(responseBody);
      const seen = new WeakSet();
      message = JSON.stringify(sanitizedBody, (key, value) => {
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
    'auth/login': '登录系统',
    'auth/logout': '退出登录',
    'auth/change-password': '修改密码',
    'auth/validate': '验证登录',
    'users': method === 'POST' ? '创建用户' : method === 'PUT' ? '更新用户' : method === 'DELETE' ? '删除用户' : '查看用户',
    'users/batch-delete': '批量删除用户',
    'designers': method === 'POST' ? '添加设计员' : method === 'PUT' ? '更新设计员' : method === 'DELETE' ? '删除设计员' : '查看设计员',
    'designers/manage': '管理设计员',
    'designers/reorder': '重新排序设计员',
    'designers/batch-delete': '批量删除设计员',
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
    'settings/workday-overrides': method === 'PUT' ? '更新工作日设置' : '查看工作日设置',
    'settings/leader-rules': method === 'PUT' ? '更新组长规则' : '查看组长规则',
    'settings/leader-rules/reset': '重置组长规则',
    'system/settings': method === 'PUT' ? '更新系统设置' : '查看系统设置',
    'system/version': '查看版本',
    'system/export-xls': '导出任务数据',
    'system/import-xls': '导入任务数据',
    'system/maintenance': method === 'PUT' ? '更新维护配置' : '查看维护状态',
    'system/maintenance/backup': '执行数据库备份',
    'system/maintenance/export-tasks': '导出任务数据',
    'system/maintenance/cleanup-backups': '清理过期备份',
    'system/maintenance/yearly-cleanup': '执行年度清理',
    'system/maintenance/clear-logs': '清空日志',
    'system/maintenance/cleanup-tasks': '清理任务数据',
    'system/db-stats': '查看数据库统计',
    'system/cleanup/login-logs': '清空登录日志',
    'system/cleanup/audit-logs': '清空操作日志',
    'system/cleanup/old-tasks': '清理历史任务',
    'system/cleanup/status-tracking': '清理历史状态跟踪',
    'system/audit-logs': '查看日志',
    'system/audit-logs/filter-options': '筛选日志',
    'system/audit-logs/export': '导出日志',
    'system/login-logs': '查看登录日志',
    'system/admin-login-logs': '查看管理员登录记录',
    'status-tracking/items': method === 'POST' ? '添加状态跟踪' : method === 'PUT' ? '更新状态跟踪' : method === 'DELETE' ? '删除状态跟踪' : '查看状态跟踪',
    'status-tracking/items/bulk': '批量导入状态跟踪',
    'status-tracking/export': '导出状态跟踪表',
    'status-tracking/import': '导入状态跟踪表',
    'status-tracking/import/check': '检查导入文件',
    'status-tracking/sync': '同步状态跟踪',
    'status-tracking/cleanup': '清理状态跟踪',
    'work-hours/export': '导出工时管理表',
    'spec/spec-info': '查询仕样信息',
    'spec/delivery-date': '查询交期',
    'spec/spec-raw-text': '查询仕样原文',
    'design-standards/status': '查看知识库状态',
    'design-standards/knowledge-bases': method === 'POST' ? '关联知识库' : method === 'DELETE' ? '删除知识库' : '查看知识库列表',
    'design-standards/search': '检索设计规范',
    'design-standards/chat': '智能问答',
    'settings/design-standards-prompt': method === 'PUT' ? '更新智能问答提示词设置' : '查看智能问答提示词设置'
  };

  // 未收录路由的兜底：使用中文通用动作，避免在日志中留下英文
  const genericActions = { GET: '查看数据', POST: '提交操作', PUT: '更新数据', PATCH: '更新数据', DELETE: '删除数据' };
  const key = `${resource}/${action}`;
  return descriptions[key] || descriptions[resource] || genericActions[method] || '未知操作';
};

const appendAuditLogDirect = async (entry) => {
  await appendAuditLog(entry);
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

      // 单次 INSERT 写入独立表：不再走 readDb()/writeDb()，
      // 避免每个 API 请求都触发整库深拷贝与全量落盘
      await appendAuditLog(logEntry);
    } catch (err) {
      console.error('Error writing audit log:', err);
    }
  });

  next();
};

module.exports = { auditLogMiddleware, appendAuditLogDirect };
