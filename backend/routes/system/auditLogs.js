'use strict';
/**
 * 操作日志的内存筛选与分页参数钳制。
 * 分页上限是防「一次把整张日志表序列化进单个响应」的硬约束，不要因为「前端不会传这么大」就放开。
 *
 * 由 backend/routes/system.js 拆分而来，代码为原样搬运（未改逻辑）。
 */
const { getAuditActionDisplay } = require('../../utils/auditLogDisplay');

const filterAuditLogs = (logs, { username, action, method, ip, from, to } = {}) => {
  const fromTime = from ? new Date(from).getTime() : null;
  const toTime = to ? new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1 : null;

  return logs.filter(log => {
    const timestamp = new Date(log.timestamp).getTime();
    if (fromTime && timestamp < fromTime) return false;
    if (toTime && timestamp > toTime) return false;
    if (username && log.username !== username) return false;
    if (action) {
      const logDisplay = getAuditActionDisplay(log);
      if (logDisplay.label !== action) return false;
    }
    if (method && log.method !== method.toUpperCase()) return false;
    if (ip && !String(log.ip || '').includes(ip)) return false;
    return true;
  });
};

// 操作日志分页参数上限。
// 不加约束时：limit 可传 99999999 把整张日志表序列化进单个响应（内存与带宽放大），
// page 可传极大值让 (page-1)*pageSize 溢出为不可控偏移。两者都必须 clamp。
const AUDIT_LOG_MAX_PAGE_SIZE = 500;
const AUDIT_LOG_MAX_PAGE = 10000;

const parseClampedInt = (raw, fallback, min, max) => {
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

module.exports = {
  filterAuditLogs,
  AUDIT_LOG_MAX_PAGE_SIZE,
  AUDIT_LOG_MAX_PAGE,
  parseClampedInt,
};
