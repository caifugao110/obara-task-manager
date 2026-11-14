const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { authMiddleware, adminMiddleware, superAdminMiddleware, accessSettingsMiddleware } = require('../middleware/auth');
const asyncHandler = require('express-async-handler');
const XLSX = require('xlsx');
const multer = require('multer');
const Joi = require('joi');
const { applyExportStyles, buildAutoColumns } = require('../utils/exportWorkbook');
const { validateFileType, validateWorkbookStructure, scanForMaliciousContent, sanitizeWorkbook, sanitizeAoaRows } = require('../utils/fileUploadSecurity');
const { getStatusTrackingLock } = require('../utils/statusTrackingLocks');
const { emitToPage, emitToPageExcept } = require('../utils/socketRooms');
const { calculateDesignDeliveryDays, withDynamicDesignDeliveryDays } = require('../utils/designDelivery');
const scheduleSyncService = require('../utils/scheduleSyncService');

// 行锁归属判定：与 socket 层的占用仲裁同一口径。
//   1) 锁归他人账号 → 拒绝（他人不得改动我正在编辑的行）；
//   2) 锁归同一账号的另一条连接（另一个标签页/设备） → 也拒绝，
//      否则「同一账号多窗口共用」时后开的窗口可以顶掉先编辑者的锁，
//      等于替别人解锁。请求带 x-socket-id 时才做这层判定，
//      不带（脚本/旧客户端）时退化为按账号判定。
const rowLockConflictMessage = (lock, req) => {
  if (!lock) return null;
  if (lock.userId !== req.user.id) {
    return `该记录正在被 ${lock.name || lock.username || '他人'} 编辑，请稍后再试`;
  }
  const requesterSocketId = String(req.get('x-socket-id') || '').trim();
  if (requesterSocketId && lock.socketId && lock.socketId !== requesterSocketId) {
    return '该记录正在你的其他窗口/设备中编辑，请在该窗口继续或先退出编辑';
  }
  return null;
};

// 广播时排除发起者自己的那条连接。
// 广播的内容是本次请求写入后的服务端快照，对发起者而言永远滞后于它本地最新的输入：
// 若也回推给它，前端受控 input 的 value 会被改回旧值，中文输入法的合成被强行中断，
// 表现为「字还没打完就被截断」（浏览器里会残留 fafan'kuaifan'ku 这样的拼音）。
// 前端会带 x-socket-id，据此精确排除；不带（脚本/旧客户端）时退化为房间内全员广播。
// 收件人范围同时收敛到 page:statusTracking 房间——无该页面权限的连接不得收到业务数据。
const emitToOthers = (io, req, event, payload) => {
  if (!io) return;
  const requesterSocketId = String(req.get('x-socket-id') || '').trim();
  emitToPageExcept(io, 'statusTracking', event, payload, requesterSocketId);
};

// 全量下发（同步/导入/清理后）：同样只发往有状态的权限连接
const emitStatusTrackingBulk = (io, items) => emitToPage(io, 'statusTracking', 'status_tracking_bulk', items);

const statusTrackingItemSchema = Joi.object({
  id: Joi.string().allow(''),
  factory: Joi.string().allow(''),
  // 该行来自「各产品大日程.xls」的哪张工作表，仅同步/刷新时由服务端写入
  sheetName: Joi.string().allow(''),
  clientName: Joi.string().allow(''),
  specNumber: Joi.string().allow(''),
  productionPlanMonth: Joi.string().pattern(/^\d{4}-\d{2}$/).allow(''),
  productionPlanMonths: Joi.array().items(Joi.string().pattern(/^\d{4}-\d{2}$/)).allow(null),
  quantity: Joi.string().allow(''),
  deliveryDate: Joi.string().allow(''),
  shippedCount: Joi.number().integer().min(0).allow(null),
  unconfirmedCount: Joi.number().integer().min(0).allow(null),
  totalVarieties: Joi.number().integer().min(0).allow(null),
  feedbackVarieties: Joi.number().integer().min(0).allow(null),
  feedbackPlan: Joi.string().allow(''),
  drawingPlanStatus: Joi.string().allow(''),
  confirmedQuantity: Joi.number().integer().min(0).allow(null),
  confirmedVarieties: Joi.number().integer().min(0).allow(null),
  drawnVarieties: Joi.number().integer().min(0).allow(null),
  undrawnVarieties: Joi.number().integer().min(0).allow(null),
  undrawnQuantity: Joi.number().integer().min(0).allow(null),
  unconfirmedQuantity: Joi.number().integer().min(0).allow(null),
  // 设计纳期为服务端按当天日期动态推导：过期纳期会得到负数，故不限制下限
  designDeliveryDays: Joi.number().integer().allow(null),
  salesPerson: Joi.string().allow(''),
  leader: Joi.string().allow(''),
  createdAt: Joi.string().allow(''),
  updatedAt: Joi.string().allow('')
});

function getItemPayload(value) {
  // designDeliveryDays 是服务端按当天日期动态推导的派生字段，不接受客户端落库值
  const { id, createdAt, updatedAt, designDeliveryDays, ...payload } = value;
  return payload;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function getCurrentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getItemPlanMonth(item) {
  return getItemPlanMonths(item)[0] || '';
}

function getItemPlanMonths(item) {
  const months = Array.isArray(item.productionPlanMonths)
    ? item.productionPlanMonths.filter(Boolean)
    : [];
  if (months.length > 0) {
    return Array.from(new Set(months)).sort();
  }
  const fallbackMonth = item.productionPlanMonth || (item.deliveryDate ? item.deliveryDate.substring(0, 7) : '');
  return fallbackMonth ? [fallbackMonth] : [];
}

function makeSpecMonthKey(specNumber, productionPlanMonth) {
  return `${String(specNumber || '').trim().toLowerCase()}__${String(productionPlanMonth || '').trim()}`;
}

function makeSpecMonthKeys(item) {
  return getItemPlanMonths(item).map(month => makeSpecMonthKey(item.specNumber, month));
}

// 记录来自哪张日程表（南京焊钳/上海焊钳/南京焊钳修改/上海焊钳修改）。
// 老数据没有 sheetName，只能按工厂列兜底——兜底区分不出「修改」表，等下次同步会补上准确值。
const FACTORY_DEFAULT_SHEET = { 'O/NJG': '南京焊钳', 'O/SHA': '上海焊钳' };
const getItemSheetName = (item) => (item && item.sheetName) || FACTORY_DEFAULT_SHEET[item && item.factory] || '';

router.get('/items', [authMiddleware, accessSettingsMiddleware('statusTracking')], asyncHandler(async (req, res) => {
  const data = db.readDb();
  const items = (data.statusTrackingItems || []).map(withDynamicDesignDeliveryDays);
  res.json(items);
}));

router.post('/items', [authMiddleware, adminMiddleware, accessSettingsMiddleware('statusTracking')], asyncHandler(async (req, res) => {
  const data = db.readDb();
  if (!data.statusTrackingItems) data.statusTrackingItems = [];
  
  const { error, value } = statusTrackingItemSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '数据验证失败', details: error.details.map(d => d.message) });
  }
  
  const payload = getItemPayload(value);
  const newItem = {
    ...payload,
    // 用 UUID 而非 Date.now()：同毫秒内创建多条会产生重复 id，
    // 而 id 会用于后续编辑/删除/批量导入的主键匹配
    id: crypto.randomUUID(),
    productionPlanMonth: payload.productionPlanMonth || getCurrentMonthValue(),
    productionPlanMonths: payload.productionPlanMonths || [payload.productionPlanMonth || getCurrentMonthValue()],
    designDeliveryDays: calculateDesignDeliveryDays(payload.deliveryDate),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  data.statusTrackingItems.push(newItem);
  await db.writeDb(data);
  
  const io = req.app.get('io');
  if (io) {
    emitToOthers(io, req, 'status_tracking_updated', { action: 'add', item: withDynamicDesignDeliveryDays(newItem) });
  }
  
  res.json(withDynamicDesignDeliveryDays(newItem));
}));

router.put('/items/:id', [authMiddleware, adminMiddleware, accessSettingsMiddleware('statusTracking')], asyncHandler(async (req, res) => {
  const data = db.readDb();
  if (!data.statusTrackingItems) data.statusTrackingItems = [];

  const index = data.statusTrackingItems.findIndex(item => item.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: '记录未找到' });
  }

  // 行锁校验：该行被其他用户（或本人其他窗口）占用时拒绝保存，
  // 防止绕过前端锁定直接覆盖他人正在编辑的数据
  const lockConflict = rowLockConflictMessage(getStatusTrackingLock(req.params.id), req);
  if (lockConflict) {
    return res.status(409).json({ message: lockConflict });
  }

  const { error, value } = statusTrackingItemSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '数据验证失败', details: error.details.map(d => d.message) });
  }
  
  const payload = getItemPayload(value);
  const existingItem = data.statusTrackingItems[index];
  const effectiveDeliveryDate = Object.prototype.hasOwnProperty.call(payload, 'deliveryDate')
    ? payload.deliveryDate
    : existingItem.deliveryDate;
  data.statusTrackingItems[index] = {
    ...existingItem,
    ...payload,
    productionPlanMonth: payload.productionPlanMonth || getItemPlanMonth(existingItem) || getCurrentMonthValue(),
    productionPlanMonths: payload.productionPlanMonths || getItemPlanMonths(existingItem),
    designDeliveryDays: calculateDesignDeliveryDays(effectiveDeliveryDate),
    updatedAt: new Date().toISOString()
  };
  
  await db.writeDb(data);
  
  const dynamicItem = withDynamicDesignDeliveryDays(data.statusTrackingItems[index]);
  const io = req.app.get('io');
  if (io) {
    emitToOthers(io, req, 'status_tracking_updated', { action: 'update', item: dynamicItem });
  }
  
  res.json(dynamicItem);
}));

router.delete('/items/:id', [authMiddleware, adminMiddleware, accessSettingsMiddleware('statusTracking')], asyncHandler(async (req, res) => {
  const data = db.readDb();
  if (!data.statusTrackingItems) data.statusTrackingItems = [];

  const item = data.statusTrackingItems.find(i => i.id === req.params.id);
  if (!item) {
    return res.status(404).json({ message: '记录未找到' });
  }

  // 行锁校验：该行被其他用户（或本人其他窗口）占用时禁止删除，
  // 避免编辑者的行在其编辑期间被移除
  const lockConflict = rowLockConflictMessage(getStatusTrackingLock(req.params.id), req);
  if (lockConflict) {
    return res.status(409).json({ message: lockConflict });
  }

  data.statusTrackingItems = data.statusTrackingItems.filter(i => i.id !== req.params.id);
  await db.writeDb(data);
  
  const io = req.app.get('io');
  if (io) {
    emitToOthers(io, req, 'status_tracking_updated', { action: 'delete', itemId: req.params.id });
  }
  
  res.json({ success: true });
}));

router.post('/sync', [authMiddleware, accessSettingsMiddleware('statusTracking')], asyncHandler(async (req, res) => {
  const data = db.readDb();
  const items = (data.statusTrackingItems || []).map(withDynamicDesignDeliveryDays);
  res.json(items);
}));

router.post('/items/bulk', [authMiddleware, adminMiddleware, accessSettingsMiddleware('statusTracking')], asyncHandler(async (req, res) => {
  const items = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ message: '输入必须是数组' });
  }

  const data = db.readDb();
  if (!data.statusTrackingItems) data.statusTrackingItems = [];

  const existingIds = new Set(data.statusTrackingItems.map(item => item.id));
  
  for (const item of items) {
    const { error, value } = statusTrackingItemSchema.validate(item, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ message: '数据验证失败', details: error.details.map(d => d.message) });
    }
    const payload = getItemPayload(value);
    const itemId = value.id || item.id || Date.now().toString() + Math.random().toString(36).slice(2, 9);
    
    if (existingIds.has(itemId)) {
      const index = data.statusTrackingItems.findIndex(i => i.id === itemId);
      if (index !== -1) {
        const bulkExisting = data.statusTrackingItems[index];
        const bulkDeliveryDate = Object.prototype.hasOwnProperty.call(payload, 'deliveryDate')
          ? payload.deliveryDate
          : bulkExisting.deliveryDate;
        data.statusTrackingItems[index] = {
          ...bulkExisting,
          ...payload,
          productionPlanMonth: payload.productionPlanMonth || getItemPlanMonth(bulkExisting) || getCurrentMonthValue(),
          productionPlanMonths: payload.productionPlanMonths || getItemPlanMonths(bulkExisting),
          designDeliveryDays: calculateDesignDeliveryDays(bulkDeliveryDate),
          updatedAt: new Date().toISOString()
        };
      }
    } else {
      data.statusTrackingItems.push({
        ...payload,
        id: itemId,
        productionPlanMonth: payload.productionPlanMonth || getItemPlanMonth(payload) || getCurrentMonthValue(),
        productionPlanMonths: payload.productionPlanMonths || getItemPlanMonths(payload),
        designDeliveryDays: calculateDesignDeliveryDays(payload.deliveryDate),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      existingIds.add(itemId);
    }
  }

  await db.writeDb(data);
  
  const dynamicItems = data.statusTrackingItems.map(withDynamicDesignDeliveryDays);
  const io = req.app.get('io');
  if (io) {
    emitStatusTrackingBulk(io, dynamicItems);
  }
  
  res.json(dynamicItems);
}));


// ─── 同步生产大日程 ───────────────────────────────────────────────────────────
// 「各产品大日程.xls」中的南京焊钳、上海焊钳、南京焊钳修改、上海焊钳修改四张工作表，
// 是状态跟踪里工厂/客户/数量/纳期/已发图的来源。同步时把四张表所有有效仕样号
// （位数符合系统配置、数量>0）按所属月份块写入状态跟踪：已有记录只覆盖这些来源字段；
// 营业担当与组长从仕样书 PDF 自动补全，且只补空字段，不覆盖人工维护的值。
// 比对/应用逻辑在 utils/scheduleSyncService.js（按钮与定时任务共用）。

// 行锁：本窗口正在编辑的行直接跳过，不冲掉未保存的输入
const syncIsLocked = (req) => (itemId) => Boolean(rowLockConflictMessage(getStatusTrackingLock(itemId), req));

// 「同步生产大日程」的开关关闭时，只有超级管理员能执行：
// 前端会把一般管理员的按钮置灰，这里再做一层兜底，防止直接调接口绕过。
const scheduleSyncPermission = (req, res, next) => {
  if (req.user?.role === 'superadmin') return next();
  const settings = db.readSettings()?.statusTracking;
  if (settings?.allowAdminScheduleSync === false) {
    return res.status(403).json({ message: '超级管理员已关闭一般管理员的「同步生产大日程」权限' });
  }
  return next();
};

router.post('/sync-schedule/preview', [authMiddleware, adminMiddleware, scheduleSyncPermission, accessSettingsMiddleware('statusTracking')], asyncHandler(async (req, res) => {
  try {
    const { stats, filePath } = await scheduleSyncService.buildSyncPlan({ isLocked: syncIsLocked(req) });
    res.json({ success: true, ...stats, filePath });
  } catch (error) {
    if (error.code === 'SCHEDULE_UNAVAILABLE') {
      return res.status(503).json({ message: error.message, filePath: error.filePath, detail: error.detail, share: error.share });
    }
    throw error;
  }
}));

router.post('/sync-schedule', [authMiddleware, adminMiddleware, scheduleSyncPermission, accessSettingsMiddleware('statusTracking')], asyncHandler(async (req, res) => {
  let result;
  try {
    result = await scheduleSyncService.applySyncPlan({ isLocked: syncIsLocked(req) });
  } catch (error) {
    if (error.code === 'SCHEDULE_UNAVAILABLE') {
      return res.status(503).json({ message: error.message, filePath: error.filePath, detail: error.detail, share: error.share });
    }
    throw error;
  }

  const { stats, data, applied } = result;
  const io = req.app.get('io');
  if (io && applied) {
    emitStatusTrackingBulk(io, (data.statusTrackingItems || []).map(withDynamicDesignDeliveryDays));
  }

  res.json({
    success: true,
    ...stats,
    message: `同步完成：新增 ${stats.added} 条，更新 ${stats.updated} 条，补全营业担当 ${stats.salesFilled} 条`
  });
}));

router.get('/export', [authMiddleware, adminMiddleware, accessSettingsMiddleware('statusTracking')], asyncHandler(async (req, res) => {
  const { deliveryMonth, factory, sheetName, searchTerm, fullTableSearch, showOutdatedDelivery } = req.query;

  const data = db.readDb();
  const items = data.statusTrackingItems || [];
  
  let filteredItems = items;
  
  if (fullTableSearch !== 'true') {
    if (!deliveryMonth) {
      return res.status(400).json({ message: '请选择纳期月份（格式：YYYY-MM）' });
    }
    if (!/^\d{4}-\d{2}$/.test(deliveryMonth)) {
      return res.status(400).json({ message: '请选择纳期月份（格式：YYYY-MM）' });
    }
    filteredItems = filteredItems.filter(item => !item.deliveryDate || item.deliveryDate.startsWith(deliveryMonth));
  }

  if (fullTableSearch === 'true' && showOutdatedDelivery !== 'true') {
    filteredItems = filteredItems.filter(item => calculateDesignDeliveryDays(item.deliveryDate) >= 1);
  }
  
  if (factory) {
    filteredItems = filteredItems.filter(item => item.factory === factory);
  }

  // 按「来自哪张日程表」筛选（南京焊钳/上海焊钳/南京焊钳修改/上海焊钳修改）
  // 合并项（焊钳 / 焊钳修改）会重复传多个 sheetName，这里按「任一命中」处理
  const sheetNames = (Array.isArray(sheetName) ? sheetName : [sheetName])
    .flatMap(value => String(value || '').split(','))
    .map(value => value.trim())
    .filter(Boolean);
  if (sheetNames.length) {
    filteredItems = filteredItems.filter(item => sheetNames.includes(getItemSheetName(item)));
  }
  
  if (searchTerm && searchTerm.trim()) {
    const term = searchTerm.toLowerCase().trim();
    filteredItems = filteredItems.filter(item => 
      item.clientName.toLowerCase().includes(term) ||
      item.specNumber.toLowerCase().includes(term) ||
      item.salesPerson.toLowerCase().includes(term) ||
      item.leader.toLowerCase().includes(term)
    );
  }
  
  if (filteredItems.length === 0) {
    return res.status(404).json({ message: '没有可导出的数据' });
  }

  const columns = [
    { key: 'factory', label: '工厂' },
    { key: 'clientName', label: '客户' },
    { key: 'quantity', label: '数量' },
    { key: 'deliveryDate', label: '纳期' },
    { key: 'shippedCount', label: '已发图' },
    { key: 'unconfirmedCount', label: '未确认' },
    { key: 'totalVarieties', label: '总种数' },
    { key: 'feedbackVarieties', label: '反馈种数' },
    { key: 'feedbackPlan', label: '反馈计划' },
    { key: 'drawingPlanStatus', label: '下图计划及状态' },
    { key: 'confirmedQuantity', label: '确认数量' },
    { key: 'confirmedVarieties', label: '确认种数' },
    { key: 'drawnVarieties', label: '下图种数' },
    { key: 'undrawnVarieties', label: '未下种数' },
    { key: 'undrawnQuantity', label: '未下数量' },
    { key: 'unconfirmedQuantity', label: '未确认数' },
    { key: 'designDeliveryDays', label: '设计纳期' },
    { key: 'salesPerson', label: '营业担当' },
    { key: 'leader', label: '组长' }
  ];

  const headerRow = columns.map(col => col.label);
  const dataRows = filteredItems.map(item => {
    return columns.map(col => {
      if (col.key === 'deliveryDate' && item.deliveryDate) {
        const [, m, d] = item.deliveryDate.split('-');
        return `${parseInt(m)}/${parseInt(d)}`;
      }
      if (col.key === 'undrawnVarieties') {
        return Math.max(0, (item.confirmedVarieties || 0) - (item.drawnVarieties || 0));
      }
      if (col.key === 'undrawnQuantity') {
        return Math.max(0, (item.confirmedQuantity || 0) - (item.shippedCount || 0));
      }
      if (col.key === 'unconfirmedQuantity') {
        return Math.max(0, (parseInt(item.quantity) || 0) - (item.confirmedQuantity || 0));
      }
      if (col.key === 'unconfirmedCount') {
        return (item.confirmedQuantity || 0) < (parseInt(item.quantity) || 0) ? '是' : '';
      }
      if (col.key === 'designDeliveryDays') {
        const liveDays = calculateDesignDeliveryDays(item.deliveryDate);
        return liveDays >= 1 ? liveDays : '';
      }
      return item[col.key] || '';
    });
  });

  const worksheetData = [headerRow, ...dataRows];
  const worksheet = XLSX.utils.aoa_to_sheet(sanitizeAoaRows(worksheetData), { sheetStubs: true });
  worksheet['!cols'] = buildAutoColumns(worksheetData, {
    min: 50,
    max: 220,
    columns: {
      1: { min: 180, max: 620, charPx: 7.5, padding: 30 }
    }
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '状态跟踪表');

  const xml = applyExportStyles(XLSX.write(workbook, { type: 'string', bookType: 'xlml' }));
  const buffer = Buffer.from(xml, 'utf8');
  
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 14);
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="status-tracking-${timestamp}.xls"`);
  res.send(buffer);
}));

router.post('/import/check', [authMiddleware, superAdminMiddleware, upload.single('file')], asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: '请上传文件' });
  }

  const fileTypeValidation = validateFileType(req.file.originalname, req.file.mimetype);
  if (!fileTypeValidation.valid) {
    return res.status(400).json({ message: fileTypeValidation.error });
  }

  let workbook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  } catch {
    return res.status(400).json({ message: '无法解析文件，请检查格式' });
  }

  if (!workbook) {
    return res.status(400).json({ message: '无法解析文件，请检查格式' });
  }

  const structureValidation = validateWorkbookStructure(workbook);
  if (!structureValidation.valid) {
    return res.status(400).json({ message: structureValidation.error });
  }

  const securityScan = scanForMaliciousContent(workbook);
  if (!securityScan.safe) {
    return res.status(400).json({ 
      message: securityScan.message,
      details: securityScan.details
    });
  }

  sanitizeWorkbook(workbook);

  const data = db.readDb();
  const existingItems = data.statusTrackingItems || [];
  const existingSpecMonths = new Set(existingItems.flatMap(item => makeSpecMonthKeys(item)));
  
  const duplicateSpecs = [];
  
  workbook.SheetNames.forEach(sheetName => {
    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (rawRows.length <= 1) return;
    
    const headerRow = rawRows[0];
    const specColIndex = headerRow.findIndex(cell => String(cell).includes('仕样号'));
    const productionPlanColIndex = headerRow.findIndex(cell => String(cell).includes('添加时间'));
    if (specColIndex < 0) return;
    
    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      const specNumber = String(row[specColIndex] || '').trim();
      const productionPlanMonth = productionPlanColIndex >= 0
        ? String(row[productionPlanColIndex] || '').trim()
        : '';
      const productionPlanMonths = productionPlanMonth
        .split(',')
        .map(month => month.trim())
        .filter(Boolean);
      for (const month of productionPlanMonths) {
        if (specNumber && existingSpecMonths.has(makeSpecMonthKey(specNumber, month))) {
          const duplicateKey = `${specNumber}(${month})`;
          if (!duplicateSpecs.includes(duplicateKey)) {
            duplicateSpecs.push(duplicateKey);
          }
        }
      }
    }
  });

  res.json({ duplicateSpecs });
}));

router.post('/import', [authMiddleware, superAdminMiddleware, upload.single('file')], asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: '请上传文件' });
  }

  const fileTypeValidation = validateFileType(req.file.originalname, req.file.mimetype);
  if (!fileTypeValidation.valid) {
    return res.status(400).json({ message: fileTypeValidation.error });
  }

  const overwrite = req.body.overwrite === 'true';

  let workbook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  } catch {
    return res.status(400).json({ message: '无法解析文件，请检查格式' });
  }

  if (!workbook) {
    return res.status(400).json({ message: '无法解析文件，请检查格式' });
  }

  const structureValidation = validateWorkbookStructure(workbook);
  if (!structureValidation.valid) {
    return res.status(400).json({ message: structureValidation.error });
  }

  const securityScan = scanForMaliciousContent(workbook);
  if (!securityScan.safe) {
    return res.status(400).json({ 
      message: securityScan.message,
      details: securityScan.details
    });
  }

  sanitizeWorkbook(workbook);

  const data = db.readDb();
  if (!data.statusTrackingItems) data.statusTrackingItems = [];
  const existingSpecMonths = new Map();
  data.statusTrackingItems.forEach(item => {
    makeSpecMonthKeys(item).forEach(key => existingSpecMonths.set(key, item));
  });
  
  let importedRows = 0;
  let updatedRows = 0;

  workbook.SheetNames.forEach(sheetName => {
    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (rawRows.length <= 1) return;
    
    const headerRow = rawRows[0];
    
    const columnMap = {};
    headerRow.forEach((cell, index) => {
      const label = String(cell).trim();
      if (label.includes('工厂')) columnMap.factory = index;
      else if (label.includes('客户')) columnMap.clientName = index;
      else if (label.includes('添加时间')) columnMap.productionPlanMonth = index;
      else if (label.includes('数量')) columnMap.quantity = index;
      else if (label.includes('纳期')) columnMap.deliveryDate = index;
      else if (label.includes('已发图')) columnMap.shippedCount = index;
      else if (label.includes('未确认') && !columnMap.unconfirmedCount) columnMap.unconfirmedCount = index;
      else if (label.includes('总种数')) columnMap.totalVarieties = index;
      else if (label.includes('反馈种数')) columnMap.feedbackVarieties = index;
      else if (label.includes('反馈计划')) columnMap.feedbackPlan = index;
      else if (label.includes('下图计划')) columnMap.drawingPlanStatus = index;
      else if (label.includes('确认数量')) columnMap.confirmedQuantity = index;
      else if (label.includes('确认种数')) columnMap.confirmedVarieties = index;
      else if (label.includes('下图种数')) columnMap.drawnVarieties = index;
      else if (label.includes('未下种数')) columnMap.undrawnVarieties = index;
      else if (label.includes('未下数量')) columnMap.undrawnQuantity = index;
      else if (label.includes('设计纳期')) columnMap.designDeliveryDays = index;
      else if (label.includes('营业担当')) columnMap.salesPerson = index;
      else if (label.includes('组长')) columnMap.leader = index;
      else if (label.includes('仕样号')) columnMap.specNumber = index;
    });

    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      const specNumber = String(row[columnMap.specNumber] || '').trim();
      if (!specNumber) continue;

      const deliveryDate = String(row[columnMap.deliveryDate] || '').trim();
      const productionPlanMonths = (String(row[columnMap.productionPlanMonth] || '').trim() || deliveryDate.substring(0, 7))
        .split(',')
        .map(month => month.trim())
        .filter(Boolean);
      const existingItem = productionPlanMonths
        .map(month => existingSpecMonths.get(makeSpecMonthKey(specNumber, month)))
        .find(Boolean);
      
      const newItem = {
        id: existingItem?.id || Date.now().toString() + Math.random().toString(36).slice(2, 9),
        factory: String(row[columnMap.factory] || '').trim(),
        // 导入表里没有这一列，覆盖导入时保留原记录的表名，避免按表筛选失效
        sheetName: existingItem?.sheetName || '',
        clientName: String(row[columnMap.clientName] || '').trim(),
        productionPlanMonth: productionPlanMonths[0] || '',
        productionPlanMonths,
        quantity: String(row[columnMap.quantity] || '').trim(),
        deliveryDate,
        shippedCount: parseInt(String(row[columnMap.shippedCount] || ''), 10) || 0,
        unconfirmedCount: parseInt(String(row[columnMap.unconfirmedCount] || ''), 10) || 0,
        totalVarieties: parseInt(String(row[columnMap.totalVarieties] || ''), 10) || 0,
        feedbackVarieties: parseInt(String(row[columnMap.feedbackVarieties] || ''), 10) || 0,
        feedbackPlan: String(row[columnMap.feedbackPlan] || '').trim(),
        drawingPlanStatus: String(row[columnMap.drawingPlanStatus] || '').trim(),
        confirmedQuantity: parseInt(String(row[columnMap.confirmedQuantity] || ''), 10) || 0,
        confirmedVarieties: parseInt(String(row[columnMap.confirmedVarieties] || ''), 10) || 0,
        drawnVarieties: parseInt(String(row[columnMap.drawnVarieties] || ''), 10) || 0,
        undrawnVarieties: parseInt(String(row[columnMap.undrawnVarieties] || ''), 10) || 0,
        undrawnQuantity: parseInt(String(row[columnMap.undrawnQuantity] || ''), 10) || 0,
        designDeliveryDays: parseInt(String(row[columnMap.designDeliveryDays] || ''), 10) || 0,
        salesPerson: String(row[columnMap.salesPerson] || '').trim(),
        leader: String(row[columnMap.leader] || '').trim(),
        specNumber,
        createdAt: existingItem?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (existingItem) {
        if (overwrite) {
          const index = data.statusTrackingItems.findIndex(item => item.id === existingItem.id);
          if (index >= 0) {
            data.statusTrackingItems[index] = newItem;
            updatedRows++;
          }
        }
      } else {
        data.statusTrackingItems.push(newItem);
        importedRows++;
      }
    }
  });

  await db.writeDb(data);

  const dynamicItems = data.statusTrackingItems.map(withDynamicDesignDeliveryDays);
  const io = req.app.get('io');
  if (io) {
    emitStatusTrackingBulk(io, dynamicItems);
  }

  res.json({ importedRows, updatedRows });
}));

router.post('/cleanup', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const { beforeMonth, beforeYear, mode, all } = req.body;

  const data = db.readDb();
  const items = Array.isArray(data.statusTrackingItems) ? data.statusTrackingItems : [];
  const originalCount = items.length;

  let filteredItems;
  let scopeLabel;

  // 清空全部：不分月份、不分 mode，直接把状态跟踪列表清空
  if (all === true) {
    filteredItems = [];
    scopeLabel = '全部';
  } else {
    if (!beforeMonth || !beforeYear) {
      return res.status(400).json({ message: '请指定清理时间点，或选择清空全部状态跟踪数据' });
    }

    const m = parseInt(beforeMonth, 10);
    const y = parseInt(beforeYear, 10);
    scopeLabel = `${y}-${String(m).padStart(2, '0')} 之前`;

    if (mode === 'delivery') {
      filteredItems = items.filter(item => {
        if (!item.deliveryDate) return true;
        const [dy, dm] = item.deliveryDate.split('-').map(Number);
        if (dy < y) return false;
        if (dy === y && dm < m) return false;
        return true;
      });
    } else {
      filteredItems = items.filter(item => {
        const planMonths = getItemPlanMonths(item);
        if (planMonths.length === 0) return true;
        const oldestMonth = planMonths[0];
        const [py, pm] = oldestMonth.split('-').map(Number);
        if (py < y) return false;
        if (py === y && pm < m) return false;
        return true;
      });
    }
  }

  const removedCount = originalCount - filteredItems.length;
  data.statusTrackingItems = filteredItems;
  await db.writeDb(data);

  const dynamicItems = data.statusTrackingItems.map(withDynamicDesignDeliveryDays);
  const io = req.app.get('io');
  if (io) {
    emitStatusTrackingBulk(io, dynamicItems);
  }

  res.json({
    message: all === true ? '状态跟踪数据已清空' : '状态跟踪数据清理完成',
    scope: scopeLabel,
    removedCount,
    remainingCount: filteredItems.length
  });
}));

module.exports = router;
