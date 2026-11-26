'use strict';
/**
 * 日志与审计：登录日志、操作日志的查询/筛选/导出、日志文件占用与截断、IP 黑名单。
 *
 * 由 backend/routes/system.js 拆分而来，代码为原样搬运（未改逻辑）。
 */
const express = require('express');

const router = express.Router();
const XLSX = require('xlsx');
const crypto = require('crypto');
const db = require('../../db');
const { authMiddleware, superAdminMiddleware } = require('../../middleware/auth');
const Joi = require('joi');
const asyncHandler = require('express-async-handler');
const { applyExportStyles, buildAutoColumns } = require('../../utils/exportWorkbook');
const { getAuditActionDisplay, getBrowserLabel } = require('../../utils/auditLogDisplay');
const { sanitizeAoaRows } = require('../../utils/fileUploadSecurity');
const logFiles = require('../../utils/logFiles');
const { loginLogQuerySchema } = require('./shared');
const { formatDownloadTimestamp } = require('./excel');
const { filterAuditLogs, AUDIT_LOG_MAX_PAGE_SIZE, AUDIT_LOG_MAX_PAGE, parseClampedInt } = require('./auditLogs');

router.get('/login-logs', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const { error, value } = loginLogQuerySchema.validate(req.query, { stripUnknown: true, convert: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const fromTime = value.from ? new Date(value.from).getTime() : null;
  const toTime = value.to ? new Date(value.to).getTime() + 24 * 60 * 60 * 1000 - 1 : null;
  const usernameKeyword = value.username.trim().toLowerCase();
  const browserKeyword = value.browser.trim().toLowerCase();
  const ipKeyword = value.ip.trim().toLowerCase();

  const logs = db.listLoginLogs()
    .filter(log => {
      const timestamp = new Date(log.timestamp).getTime();
      const browserText = [
        log.browserInfo?.summary,
        log.browserInfo?.browser,
        log.browserInfo?.os,
        log.browserInfo?.device,
        log.userAgent
      ].filter(Boolean).join(' ').toLowerCase();

      if (value.role !== 'all' && log.role !== value.role) return false;
      if (value.success !== 'all' && String(Boolean(log.success)) !== value.success) return false;
      if (usernameKeyword) {
        const userText = `${log.username || ''} ${log.name || ''}`.toLowerCase();
        if (!userText.includes(usernameKeyword)) return false;
      }
      if (browserKeyword && !browserText.includes(browserKeyword)) return false;
      if (ipKeyword && !String(log.ip || '').toLowerCase().includes(ipKeyword)) return false;
      if (fromTime && timestamp < fromTime) return false;
      if (toTime && timestamp > toTime) return false;
      return true;
    })
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, value.limit);
  res.json(logs);
}));

router.get('/audit-logs', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const { limit = 100, page = 1, username, action, method, ip, from, to } = req.query;

  // 操作日志已迁至 audit_logs 独立表，不再随整库读出。
  // 表内条数由 auditLogMaxRows 限制（默认 5000，上限 100000），
  // 因此这里一次读取全表再做内存筛选的代价可控；分页只截取需要的一段。
  let logs = filterAuditLogs(db.listAuditLogs(), { username, action, method, ip, from, to });

  logs = logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const pageSize = parseClampedInt(limit, 100, 1, AUDIT_LOG_MAX_PAGE_SIZE);
  const pageNum = parseClampedInt(page, 1, 1, AUDIT_LOG_MAX_PAGE);
  const start = (pageNum - 1) * pageSize;
  const end = start + pageSize;

  res.json({
    logs: logs.slice(start, end),
    total: logs.length,
    page: pageNum,
    pageSize
  });
}));

router.get('/audit-logs/filter-options', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const logs = db.listAuditLogs();
  const usernames = [...new Set(logs.map(log => log.username).filter(Boolean))].sort();
  
  const actionLabels = logs
    .filter(log => log.action)
    .map(log => {
      const display = getAuditActionDisplay(log);
      return display.label;
    });
  
  const uniqueActions = [...new Set(actionLabels)].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  
  res.json({ usernames, actions: uniqueActions });
}));

router.get('/audit-logs/export', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const { username, action, method, ip, from, to } = req.query;
  let logs = filterAuditLogs(db.listAuditLogs(), { username, action, method, ip, from, to });
  logs = logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (logs.length === 0) {
    return res.status(404).json({ message: '没有可导出的日志' });
  }

  const columns = ['时间', '用户', '姓名', '操作类型', '操作说明', '方法', 'IP', '状态码', '耗时(ms)', '浏览器信息'];

  const dataRows = logs.map(log => {
    const actionDisplay = getAuditActionDisplay(log);
    const browserLabel = getBrowserLabel(log);

    return [
      log.timestamp ? new Date(log.timestamp).toLocaleString('zh-CN', { hour12: false }) : '',
      log.username || '',
      log.name || '',
      actionDisplay.label,
      actionDisplay.description,
      log.method || '',
      log.ip || '',
      log.responseStatus ?? '',
      log.durationMs ?? '',
      browserLabel
    ];
  });

  const worksheetData = [columns, ...dataRows];
  const worksheet = XLSX.utils.aoa_to_sheet(sanitizeAoaRows(worksheetData));
  worksheet['!cols'] = buildAutoColumns(worksheetData, {
    min: 64,
    max: 360,
    charPx: 8,
    padding: 28
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '操作日志');
  let xml = XLSX.write(workbook, { type: 'string', bookType: 'xlml' });
  
  xml = applyExportStyles(xml, { freezeTopRow: true, freezeFirstColumn: false });

  const buffer = Buffer.from(xml, 'utf8');

  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${formatDownloadTimestamp()}.xls"`);
  res.send(buffer);
}));

router.get('/admin-login-logs', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const adminLogs = db.listLoginLogs()
    .filter(log => log.role === 'superadmin' || log.role === 'admin')
    .slice(0, 10);

  res.json(adminLogs);
}));

/* 日志文件占用（日志管理）：logs/ 目录下每个文件的大小 + 数据库日志表的行数与体积。
 * 只做 stat 不读内容——单个日志文件可能几百 MB，读进来会把后端拖死。
 * 权限与其它日志接口一致，仅超级管理员可见。 */
router.get('/log-files', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  res.json(logFiles.getLogSummary());
}));

/* 手动清理日志文件（日志管理）：就地截断而不是删除文件。
 * backend.log / frontend.log 在服务运行期间被隐藏 cmd 窗口占用，删除必然失败；
 * 这些文件都是追加写，就地截断不会产生空洞，写入方也不会失效。
 * mode=oversized 只清理超过阈值的文件，mode=all 清空全部日志文件（仅保留一行说明）。 */
const trimLogFilesSchema = Joi.object({
  mode: Joi.string().valid('oversized', 'all').default('oversized'),
  files: Joi.array().items(Joi.string().max(120)).max(50).optional()
});

router.post('/log-files/trim', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const { error, value } = trimLogFilesSchema.validate(req.body || {}, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const result = logFiles.trimLogFiles({ mode: value.mode, files: value.files, source: 'manual' });
  const trimmedBytes = result.trimmed.reduce((sum, item) => sum + Math.max(0, item.beforeBytes - item.afterBytes), 0);
  // 被运行中的服务占用的文件（backend.log 等）清不掉，要明确告诉用户「什么时候会清」，
  // 而不是笼统地报一句失败
  const lockedCount = result.failed.filter((item) => item.locked).length;
  const otherFailed = result.failed.length - lockedCount;

  let message;
  if (result.trimmed.length > 0) {
    message = `已清理 ${result.trimmed.length} 个日志文件，释放 ${(trimmedBytes / 1024 / 1024).toFixed(2)} MB`;
    if (lockedCount > 0) message += `；${lockedCount} 个正被运行中的进程占用，停止服务后启动时会自动轮转`;
    if (otherFailed > 0) message += `；${otherFailed} 个处理失败`;
  } else if (lockedCount > 0) {
    message = `${lockedCount} 个日志文件正被运行中的进程占用，停止服务后重新启动时会自动轮转`;
  } else if (result.failed.length > 0) {
    message = '日志文件清理失败，请查看详情';
  } else {
    message = '没有需要清理的日志文件';
  }

  res.json({ message, trimmedBytes, result, summary: logFiles.getLogSummary() });
}));

/* ==================== IP 黑名单（仅超级管理员） ====================
 * 存储：settings.ipBlacklist = { enabled, entries: [{ id, ip, note, createdAt, createdBy }] }
 * 生效：server.js 全局中间件拦截所有 /api 请求（回环地址永不拦截）。
 */

const ipBlacklistUtil = require('../../utils/ipBlacklist');

router.get('/ip-blacklist', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  res.json(ipBlacklistUtil.readBlacklist());
}));

router.put('/ip-blacklist', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ message: 'enabled 必须为布尔值' });
  }

  const data = db.readDb();
  const current = ipBlacklistUtil.readBlacklist();
  data.settings.ipBlacklist = { enabled, entries: current.entries };
  await db.writeDb(data);
  ipBlacklistUtil.invalidateBlacklistCache();
  res.json(data.settings.ipBlacklist);
}));

// 批量添加：body { ip: '1.2.3.4, 10.0.0.0/24', note } —— 支持逗号/空白分隔多条
router.post('/ip-blacklist', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const rawInput = String(req.body?.ip || '').trim();
  const note = String(req.body?.note || '').trim().slice(0, 100);
  if (!rawInput) {
    return res.status(400).json({ message: '请输入 IP 地址' });
  }

  const patterns = rawInput.split(/[\s,;，；]+/).filter(Boolean);
  if (patterns.length > 50) {
    return res.status(400).json({ message: '单次最多添加 50 条规则' });
  }

  const data = db.readDb();
  const current = ipBlacklistUtil.readBlacklist();
  const entries = current.entries.slice();
  if (entries.length + patterns.length > ipBlacklistUtil.MAX_BLACKLIST_ENTRIES) {
    return res.status(400).json({ message: `黑名单最多保留 ${ipBlacklistUtil.MAX_BLACKLIST_ENTRIES} 条规则` });
  }

  const added = [];
  const failed = [];
  for (const pattern of patterns) {
    const check = ipBlacklistUtil.validateIpPattern(pattern);
    if (!check.ok) {
      failed.push({ ip: pattern, reason: check.reason });
      continue;
    }
    // 已归一化的重复规则直接跳过，不报错（幂等添加）
    if (entries.some(entry => entry.ip === check.normalized)) {
      continue;
    }
    const entry = {
      id: crypto.randomUUID(),
      ip: check.normalized,
      note,
      createdAt: new Date().toISOString(),
      createdBy: req.user
        ? { id: req.user.id, username: req.user.username, name: req.user.name }
        : undefined
    };
    entries.push(entry);
    added.push(entry);
  }

  data.settings.ipBlacklist = { enabled: current.enabled, entries };
  await db.writeDb(data);
  ipBlacklistUtil.invalidateBlacklistCache();
  res.json({ added, failed, total: entries.length });
}));

router.delete('/ip-blacklist/:id', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const data = db.readDb();
  const current = ipBlacklistUtil.readBlacklist();
  const entries = current.entries.filter(entry => entry?.id !== req.params.id);
  if (entries.length === current.entries.length) {
    return res.status(404).json({ message: '该规则不存在或已被删除' });
  }

  data.settings.ipBlacklist = { enabled: current.enabled, entries };
  await db.writeDb(data);
  ipBlacklistUtil.invalidateBlacklistCache();
  res.json({ entries, total: entries.length });
}));

module.exports = router;
