const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, adminMiddleware, superAdminMiddleware, accessSettingsMiddleware } = require('../middleware/auth');
const asyncHandler = require('express-async-handler');
const XLSX = require('xlsx');
const multer = require('multer');
const Joi = require('joi');
const { applyExportStyles, buildAutoColumns } = require('../utils/exportWorkbook');
const { validateFileType, validateWorkbookStructure, scanForMaliciousContent, sanitizeWorkbook } = require('../utils/fileUploadSecurity');

const statusTrackingItemSchema = Joi.object({
  id: Joi.string().allow(''),
  factory: Joi.string().allow(''),
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
  designDeliveryDays: Joi.number().integer().min(0).allow(null),
  salesPerson: Joi.string().allow(''),
  leader: Joi.string().allow(''),
  createdAt: Joi.string().allow(''),
  updatedAt: Joi.string().allow('')
});

function getItemPayload(value) {
  const { id, createdAt, updatedAt, ...payload } = value;
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

router.get('/items', [authMiddleware, accessSettingsMiddleware('statusTracking')], asyncHandler(async (req, res) => {
  const data = db.readDb();
  const items = data.statusTrackingItems || [];
  res.json(items);
}));

router.post('/items', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  const data = db.readDb();
  if (!data.statusTrackingItems) data.statusTrackingItems = [];
  
  const { error, value } = statusTrackingItemSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '数据验证失败', details: error.details.map(d => d.message) });
  }
  
  const payload = getItemPayload(value);
  const newItem = {
    ...payload,
    id: Date.now().toString(),
    productionPlanMonth: payload.productionPlanMonth || getCurrentMonthValue(),
    productionPlanMonths: payload.productionPlanMonths || [payload.productionPlanMonth || getCurrentMonthValue()],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  data.statusTrackingItems.push(newItem);
  await db.writeDb(data);
  
  const io = req.app.get('io');
  if (io) {
    io.emit('status_tracking_updated', { action: 'add', item: newItem });
  }
  
  res.json(newItem);
}));

router.put('/items/:id', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  const data = db.readDb();
  if (!data.statusTrackingItems) data.statusTrackingItems = [];
  
  const index = data.statusTrackingItems.findIndex(item => item.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: '记录未找到' });
  }
  
  const { error, value } = statusTrackingItemSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '数据验证失败', details: error.details.map(d => d.message) });
  }
  
  const payload = getItemPayload(value);
  data.statusTrackingItems[index] = {
    ...data.statusTrackingItems[index],
    ...payload,
    productionPlanMonth: payload.productionPlanMonth || getItemPlanMonth(data.statusTrackingItems[index]) || getCurrentMonthValue(),
    productionPlanMonths: payload.productionPlanMonths || getItemPlanMonths(data.statusTrackingItems[index]),
    updatedAt: new Date().toISOString()
  };
  
  await db.writeDb(data);
  
  const io = req.app.get('io');
  if (io) {
    io.emit('status_tracking_updated', { action: 'update', item: data.statusTrackingItems[index] });
  }
  
  res.json(data.statusTrackingItems[index]);
}));

router.delete('/items/:id', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  const data = db.readDb();
  if (!data.statusTrackingItems) data.statusTrackingItems = [];
  
  const item = data.statusTrackingItems.find(i => i.id === req.params.id);
  if (!item) {
    return res.status(404).json({ message: '记录未找到' });
  }
  
  data.statusTrackingItems = data.statusTrackingItems.filter(i => i.id !== req.params.id);
  await db.writeDb(data);
  
  const io = req.app.get('io');
  if (io) {
    io.emit('status_tracking_updated', { action: 'delete', itemId: req.params.id });
  }
  
  res.json({ success: true });
}));

router.post('/sync', [authMiddleware, accessSettingsMiddleware('statusTracking')], asyncHandler(async (req, res) => {
  const data = db.readDb();
  const items = data.statusTrackingItems || [];
  res.json(items);
}));

router.post('/items/bulk', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
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
        data.statusTrackingItems[index] = {
          ...data.statusTrackingItems[index],
          ...payload,
          productionPlanMonth: payload.productionPlanMonth || getItemPlanMonth(data.statusTrackingItems[index]) || getCurrentMonthValue(),
          productionPlanMonths: payload.productionPlanMonths || getItemPlanMonths(payload),
          updatedAt: new Date().toISOString()
        };
      }
    } else {
      data.statusTrackingItems.push({
        ...payload,
        id: itemId,
        productionPlanMonth: payload.productionPlanMonth || getItemPlanMonth(payload) || getCurrentMonthValue(),
        productionPlanMonths: payload.productionPlanMonths || getItemPlanMonths(payload),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      existingIds.add(itemId);
    }
  }

  await db.writeDb(data);
  
  const io = req.app.get('io');
  if (io) {
    io.emit('status_tracking_bulk', data.statusTrackingItems);
  }
  
  res.json(data.statusTrackingItems);
}));

router.get('/export', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  const { month, deliveryMonth, factory, searchTerm, fullTableSearch } = req.query;
  
  const data = db.readDb();
  const items = data.statusTrackingItems || [];
  
  let filteredItems = items;
  
  if (fullTableSearch !== 'true') {
    if (month) {
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ message: '请选择月份（格式：YYYY-MM）' });
      }
      filteredItems = filteredItems.filter(item => getItemPlanMonths(item).includes(month));
    } else if (deliveryMonth) {
      if (!/^\d{4}-\d{2}$/.test(deliveryMonth)) {
        return res.status(400).json({ message: '请选择纳期月份（格式：YYYY-MM）' });
      }
      filteredItems = filteredItems.filter(item => !item.deliveryDate || item.deliveryDate.startsWith(deliveryMonth));
    } else {
      return res.status(400).json({ message: '请选择月份（格式：YYYY-MM）' });
    }
  }
  
  if (factory) {
    filteredItems = filteredItems.filter(item => item.factory === factory);
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
    { key: 'productionPlanMonth', label: '生产计划' },
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
      if (col.key === 'productionPlanMonth') {
        return getItemPlanMonths(item).join(', ');
      }
      return item[col.key] || '';
    });
  });

  const worksheetData = [headerRow, ...dataRows];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData, { sheetStubs: true });
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
    const productionPlanColIndex = headerRow.findIndex(cell => String(cell).includes('生产计划'));
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
      else if (label.includes('生产计划')) columnMap.productionPlanMonth = index;
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

  const io = req.app.get('io');
  if (io) {
    io.emit('status_tracking_bulk', data.statusTrackingItems);
  }

  res.json({ importedRows, updatedRows });
}));

module.exports = router;
