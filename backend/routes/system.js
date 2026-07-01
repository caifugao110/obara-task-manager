const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const crypto = require('crypto');
const db = require('../db');
const { authMiddleware, superAdminMiddleware } = require('../middleware/auth');
const Joi = require('joi');
const asyncHandler = require('express-async-handler');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const defaultSystemSettings = { allowGuestView: true, allowMultiDevice: true };

const systemSettingsSchema = Joi.object({
  allowGuestView: Joi.boolean().required(),
  allowMultiDevice: Joi.boolean().required()
});

const loginLogQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(500).default(200),
  username: Joi.string().allow('').max(60).default(''),
  role: Joi.string().valid('all', 'superadmin', 'admin', 'user').default('all'),
  success: Joi.string().valid('all', 'true', 'false').default('all'),
  browser: Joi.string().allow('').max(80).default(''),
  ip: Joi.string().allow('').max(80).default(''),
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional()
});

const sheetHasData = (sheet) => {
  if (!sheet?.days || typeof sheet.days !== 'object') return false;
  return Object.values(sheet.days).some(items => Array.isArray(items) && items.length > 0);
};

const parseMonthFromSheetName = (name) => {
  const trimmed = String(name || '').trim();
  const isoMatch = trimmed.match(/(\d{4})[-/年](\d{1,2})/);
  if (isoMatch) {
    return { year: parseInt(isoMatch[1], 10), month: parseInt(isoMatch[2], 10) };
  }
  return null;
};

const buildExportRows = (tasks, designers) => {
  const designerMap = new Map(designers.map(d => [d.id, d.name]));
  const rows = [];

  tasks.filter(sheetHasData).forEach(sheet => {
    const designerName = designerMap.get(sheet.designerId) || sheet.designerId;
    Object.entries(sheet.days).forEach(([date, items]) => {
      if (!Array.isArray(items)) return;
      items.forEach(item => {
        rows.push({
          year: sheet.year,
          month: sheet.month,
          designerId: sheet.designerId,
          designerName,
          date,
          taskName: item.taskName || '',
          hours: item.hours ?? 0,
          leaveType: item.leaveType || '',
          color: item.color || '',
          guns: JSON.stringify(item.guns || [])
        });
      });
    });
  });

  return rows;
};

router.get('/settings', asyncHandler(async (req, res) => {
  const data = db.readDb();
  res.json(data.settings?.system || defaultSystemSettings);
}));

router.put('/settings', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const { error, value } = systemSettingsSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const data = db.readDb();
  if (!data.settings) data.settings = {};
  data.settings.system = value;
  await db.writeDb(data);
  res.json(value);
}));

router.get('/login-logs', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const { error, value } = loginLogQuerySchema.validate(req.query, { stripUnknown: true, convert: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const data = db.readDb();
  const fromTime = value.from ? new Date(value.from).getTime() : null;
  const toTime = value.to ? new Date(value.to).getTime() + 24 * 60 * 60 * 1000 - 1 : null;
  const usernameKeyword = value.username.trim().toLowerCase();
  const browserKeyword = value.browser.trim().toLowerCase();
  const ipKeyword = value.ip.trim().toLowerCase();

  const logs = (data.loginLogs || [])
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

router.get('/export-xls', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const data = db.readDb();
  const tasks = data.tasks || [];
  const designers = data.designers || [];
  const rows = buildExportRows(tasks, designers);

  if (rows.length === 0) {
    return res.status(404).json({ message: '没有可导出的数据' });
  }

  const monthGroups = new Map();
  rows.forEach(row => {
    const key = `${row.year}-${String(row.month).padStart(2, '0')}`;
    if (!monthGroups.has(key)) monthGroups.set(key, []);
    monthGroups.get(key).push(row);
  });

  const workbook = XLSX.utils.book_new();
  const header = ['设计员ID', '设计员', '日期', '任务名称', '工时', '请假类型', '背景色', '枪名详情'];

  [...monthGroups.keys()].sort().forEach(key => {
    const monthRows = monthGroups.get(key);
    const sheetData = [
      header,
      ...monthRows.map(r => [
        r.designerId,
        r.designerName,
        r.date,
        r.taskName,
        r.hours,
        r.leaveType,
        r.color,
        r.guns
      ])
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(workbook, worksheet, key);
  });

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const filename = `obara-tasks-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}));

router.post('/import-xls', [authMiddleware, superAdminMiddleware, upload.single('file')], asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: '请上传 xls/xlsx 文件' });
  }

  let workbook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  } catch {
    return res.status(400).json({ message: '无法解析表格文件，请检查格式' });
  }

  const data = db.readDb();
  if (!data.tasks) data.tasks = [];
  const designers = data.designers || [];
  const designerById = new Map(designers.map(d => [d.id, d]));
  const designerByName = new Map(designers.map(d => [d.name, d]));

  const importedMonths = new Set();
  let importedRows = 0;

  workbook.SheetNames.forEach(sheetName => {
    const parsed = parseMonthFromSheetName(sheetName);
    if (!parsed) return;

    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (rawRows.length <= 1) return;

    const dataRows = rawRows.slice(1).filter(row => Array.isArray(row) && row.some(cell => String(cell).trim() !== ''));
    if (dataRows.length === 0) return;

    const sheetMap = new Map();

    dataRows.forEach(row => {
      const designerId = String(row[0] || '').trim();
      const designerName = String(row[1] || '').trim();
      const date = String(row[2] || '').trim().slice(0, 10);
      if (!date) return;

      let resolvedDesignerId = designerId;
      if (!designerById.has(resolvedDesignerId)) {
        const byName = designerByName.get(designerName);
        if (byName) resolvedDesignerId = byName.id;
      }
      if (!designerById.has(resolvedDesignerId)) return;

      let guns = [];
      try {
        const gunsRaw = row[7];
        if (gunsRaw) guns = typeof gunsRaw === 'string' ? JSON.parse(gunsRaw) : gunsRaw;
        if (!Array.isArray(guns)) guns = [];
      } catch {
        guns = [];
      }

      const item = {
        id: crypto.randomUUID(),
        taskName: String(row[3] || ''),
        hours: parseFloat(row[4]) || 0,
        leaveType: row[5] ? String(row[5]) : null,
        color: String(row[6] || ''),
        guns: guns.map(g => ({
          id: g.id || crypto.randomUUID(),
          name: String(g.name || ''),
          hours: parseFloat(g.hours) || 0
        }))
      };

      if (!item.leaveType) item.leaveType = null;

      const mapKey = resolvedDesignerId;
      if (!sheetMap.has(mapKey)) {
        sheetMap.set(mapKey, { designerId: resolvedDesignerId, month: parsed.month, year: parsed.year, days: {} });
      }
      const target = sheetMap.get(mapKey);
      if (!target.days[date]) target.days[date] = [];
      target.days[date].push(item);
      importedRows += 1;
    });

    if (sheetMap.size === 0) return;

    importedMonths.add(`${parsed.year}-${parsed.month}`);

    sheetMap.forEach((importedSheet, designerId) => {
      if (!sheetHasData(importedSheet)) return;

      const existingIndex = data.tasks.findIndex(
        t => t.designerId === designerId && t.month === parsed.month && t.year === parsed.year
      );
      const normalized = {
        id: `sheet-${designerId}-${parsed.year}-${parsed.month}`,
        designerId,
        month: parsed.month,
        year: parsed.year,
        days: importedSheet.days
      };

      if (existingIndex >= 0) {
        data.tasks[existingIndex] = normalized;
      } else {
        data.tasks.push(normalized);
      }
    });
  });

  if (importedMonths.size === 0) {
    return res.status(400).json({ message: '文件中没有可导入的有效月份数据' });
  }

  await db.writeDb(data);

  const io = req.app.get('io');
  if (io) io.emit('task_refreshed');

  res.json({
    message: '导入成功',
    importedMonths: [...importedMonths],
    importedRows
  });
}));

module.exports = router;
