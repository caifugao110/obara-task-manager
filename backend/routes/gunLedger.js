const express = require('express');
const router = express.Router();
const db = require('../db');
const gunTableLocks = require('../utils/gunTableLocks');
const { authMiddleware, adminMiddleware, superAdminMiddleware, accessSettingsMiddleware } = require('../middleware/auth');
const asyncHandler = require('express-async-handler');
const Joi = require('joi');

// 分类名校称校验：1-30 字符，允许中文/英文/数字/连字符/下划线
const categoryNameSchema = Joi.object({
  name: Joi.string().min(1).max(30).required()
});

const rowSchema = Joi.object({
  id: Joi.string().allow('', null),
  serialNumber: Joi.number().integer().allow(null),
  gunName: Joi.string().allow(''),
  customer: Joi.string().allow(''),
  time: Joi.string().allow(''),
  responsiblePerson: Joi.string().allow(''),
  remarks: Joi.string().allow(''),
  createdAt: Joi.string().allow('', null),
  createdBy: Joi.object().allow(null),
  updatedAt: Joi.string().allow('', null),
  updatedBy: Joi.object().allow(null)
});

const rowsSchema = Joi.array().items(rowSchema);

const tableNameSchema = Joi.object({
  name: Joi.string().min(1).max(50).required()
});

const defaultPersonsSchema = Joi.array().items(Joi.string().min(1)).min(0);

// 在 gunLedger.categories 中查找表，返回 { category, table, index }
// 动态遍历所有分类（支持用户新增的分类）
const findTable = (gunLedger, tableId) => {
  const categories = gunLedger?.categories || {};
  for (const cat of Object.keys(categories)) {
    const list = Array.isArray(categories[cat]) ? categories[cat] : [];
    const index = list.findIndex(t => t && t.id === tableId);
    if (index !== -1) {
      return { category: cat, table: list[index], index, list };
    }
  }
  return null;
};

// 确保分类名校称合法（用于 URL 路径参数）：禁止特殊字符
const isValidCategoryName = (name) => {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 30) return false;
  // 禁止路径分隔符与控制字符
  if (/[/\\]/.test(trimmed)) return false;
  return true;
};

const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// 用户的可序列化信息
const userMeta = (req) => req.user ? { id: req.user.id, username: req.user.username, name: req.user.name } : null;

// GET /api/gun-ledger —— 取全部数据
router.get('/', [authMiddleware, accessSettingsMiddleware('gunLedger')], asyncHandler(async (req, res) => {
  const data = db.readDb();
  const gunLedger = data.gunLedger || { categories: { 'X2C': [], 'X2C-V2': [], 'X2C-V3': [] }, defaultResponsiblePersons: ['张啸', '张明', '陈青松', '陈大仪'] };
  res.json(gunLedger);
}));

// POST /api/gun-ledger/categories —— 新增分类
router.post('/categories', [authMiddleware, adminMiddleware, accessSettingsMiddleware('gunLedger')], asyncHandler(async (req, res) => {
  const { error, value } = categoryNameSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: '分类名不合法', details: error.details.map(d => d.message) });
  }
  const name = String(value.name).trim();
  if (!isValidCategoryName(name)) {
    return res.status(400).json({ message: '分类名含非法字符' });
  }
  const data = db.readDb();
  if (!data.gunLedger) data.gunLedger = { categories: { 'X2C': [], 'X2C-V2': [], 'X2C-V3': [] }, defaultResponsiblePersons: ['张啸', '张明', '陈青松', '陈大仪'] };
  if (!data.gunLedger.categories) data.gunLedger.categories = { 'X2C': [], 'X2C-V2': [], 'X2C-V3': [] };

  // 分类名唯一（大小写敏感）
  const exists = Object.prototype.hasOwnProperty.call(data.gunLedger.categories, name);
  if (exists) {
    return res.status(400).json({ message: '已存在同名分类' });
  }

  data.gunLedger.categories[name] = [];
  await db.writeDb(data);

  const io = req.app.get('io');
  if (io) io.emit('gun_ledger_updated', { action: 'add_category', category: name });

  res.json({ category: name });
}));

// DELETE /api/gun-ledger/categories/:category —— 删除分类（同时删除其下所有表）
router.delete('/categories/:category', [authMiddleware, superAdminMiddleware, accessSettingsMiddleware('gunLedger')], asyncHandler(async (req, res) => {
  const category = decodeURIComponent(req.params.category);
  if (!isValidCategoryName(category)) {
    return res.status(400).json({ message: '分类名含非法字符' });
  }
  const data = db.readDb();
  if (!data.gunLedger || !data.gunLedger.categories) {
    return res.status(404).json({ message: '分类未找到' });
  }
  if (!Object.prototype.hasOwnProperty.call(data.gunLedger.categories, category)) {
    return res.status(404).json({ message: '分类未找到' });
  }
  // 默认三大分类不允许删除
  if (['X2C', 'X2C-V2', 'X2C-V3'].includes(category)) {
    return res.status(400).json({ message: '默认分类不允许删除' });
  }
  // 释放该分类下所有表的编辑锁
  const removedTableIds = (data.gunLedger.categories[category] || []).map(t => t && t.id).filter(Boolean);
  removedTableIds.forEach(id => gunTableLocks.forceRelease(id));
  delete data.gunLedger.categories[category];
  await db.writeDb(data);

  const io = req.app.get('io');
  if (io) {
    removedTableIds.forEach(id => io.emit('gun_ledger_table_unlocked', { tableId: id }));
    io.emit('gun_ledger_updated', { action: 'delete_category', category });
  }

  res.json({ success: true });
}));

// POST /api/gun-ledger/categories/:category/tables —— 新增表
router.post('/categories/:category/tables', [authMiddleware, adminMiddleware, accessSettingsMiddleware('gunLedger')], asyncHandler(async (req, res) => {
  const category = decodeURIComponent(req.params.category);
  if (!isValidCategoryName(category)) {
    return res.status(400).json({ message: '分类名含非法字符' });
  }
  const { error, value } = tableNameSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: '表名不能为空', details: error.details.map(d => d.message) });
  }
  const data = db.readDb();
  if (!data.gunLedger) data.gunLedger = { categories: { 'X2C': [], 'X2C-V2': [], 'X2C-V3': [] }, defaultResponsiblePersons: ['张啸', '张明', '陈青松', '陈大仪'] };
  if (!data.gunLedger.categories) data.gunLedger.categories = { 'X2C': [], 'X2C-V2': [], 'X2C-V3': [] };
  if (!Array.isArray(data.gunLedger.categories[category])) data.gunLedger.categories[category] = [];

  // 同类下表名唯一
  const exists = data.gunLedger.categories[category].some(t => t && String(t.name).trim() === String(value.name).trim());
  if (exists) {
    return res.status(400).json({ message: '该分类下已存在同名表' });
  }

  const newTable = { id: newId('gun-tbl'), name: String(value.name).trim(), rows: [] };
  data.gunLedger.categories[category].push(newTable);
  await db.writeDb(data);

  const io = req.app.get('io');
  if (io) io.emit('gun_ledger_updated', { action: 'add_table', category, table: newTable });

  res.json(newTable);
}));

// PATCH /api/gun-ledger/tables/order —— 重排某分类下表格顺序
// 注意：必须定义在 /tables/:tableId 之前，否则 "order" 会被当作 tableId 匹配
router.patch('/tables/order', [authMiddleware, adminMiddleware, accessSettingsMiddleware('gunLedger')], asyncHandler(async (req, res) => {
  const orderSchema = Joi.object({
    category: Joi.string().min(1).max(30).required(),
    order: Joi.array().items(Joi.string().min(1)).min(0).required()
  });
  const { error, value } = orderSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: '表格顺序数据不正确', details: error.details.map(d => d.message) });
  }
  if (!isValidCategoryName(value.category)) {
    return res.status(400).json({ message: '分类名含非法字符' });
  }
  const data = db.readDb();
  if (!data.gunLedger || !data.gunLedger.categories) {
    return res.status(404).json({ message: '台账数据未找到' });
  }
  if (!Array.isArray(data.gunLedger.categories[value.category])) {
    return res.status(404).json({ message: '分类未找到' });
  }
  const list = data.gunLedger.categories[value.category];
  // 校验：order 必须与现有表 id 集合一致
  const existingIds = list.map(t => t && t.id).filter(Boolean);
  const orderSet = new Set(value.order);
  if (orderSet.size !== value.order.length) {
    return res.status(400).json({ message: '表格顺序包含重复项' });
  }
  const missing = existingIds.filter(id => !orderSet.has(id));
  const extra = value.order.filter(id => !existingIds.includes(id));
  if (missing.length || extra.length) {
    return res.status(400).json({ message: '表格顺序与现有表格不一致' });
  }
  // 按 order 顺序重排
  const byId = new Map(list.map(t => [t.id, t]));
  data.gunLedger.categories[value.category] = value.order.map(id => byId.get(id));
  await db.writeDb(data);

  const io = req.app.get('io');
  if (io) io.emit('gun_ledger_updated', { action: 'reorder_tables', category: value.category, order: value.order });

  res.json({ category: value.category, order: value.order });
}));

// PATCH /api/gun-ledger/tables/:tableId —— 改表名
router.patch('/tables/:tableId', [authMiddleware, adminMiddleware, accessSettingsMiddleware('gunLedger')], asyncHandler(async (req, res) => {
  const { error, value } = tableNameSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: '表名不能为空', details: error.details.map(d => d.message) });
  }
  const data = db.readDb();
  if (!data.gunLedger) return res.status(404).json({ message: '表未找到' });
  const found = findTable(data.gunLedger, req.params.tableId);
  if (!found) return res.status(404).json({ message: '表未找到' });

  // 同类下表名唯一
  const duplicate = found.list.some((t, i) => i !== found.index && t && String(t.name).trim() === String(value.name).trim());
  if (duplicate) {
    return res.status(400).json({ message: '该分类下已存在同名表' });
  }
  found.table.name = String(value.name).trim();
  await db.writeDb(data);

  const io = req.app.get('io');
  if (io) io.emit('gun_ledger_updated', { action: 'rename_table', tableId: req.params.tableId, name: found.table.name });

  res.json(found.table);
}));

// DELETE /api/gun-ledger/tables/:tableId —— 删表（仅超级管理员）
router.delete('/tables/:tableId', [authMiddleware, superAdminMiddleware, accessSettingsMiddleware('gunLedger')], asyncHandler(async (req, res) => {
  const data = db.readDb();
  if (!data.gunLedger) return res.status(404).json({ message: '表未找到' });
  const found = findTable(data.gunLedger, req.params.tableId);
  if (!found) return res.status(404).json({ message: '表未找到' });

  found.list.splice(found.index, 1);
  await db.writeDb(data);

  // 释放该表的编辑锁
  gunTableLocks.forceRelease(req.params.tableId);

  const io = req.app.get('io');
  if (io) {
    io.emit('gun_ledger_table_unlocked', { tableId: req.params.tableId });
    io.emit('gun_ledger_updated', { action: 'delete_table', tableId: req.params.tableId });
  }

  res.json({ success: true });
}));

// PUT /api/gun-ledger/tables/:tableId/rows —— 保存某表全部行
router.put('/tables/:tableId/rows', [authMiddleware, adminMiddleware, accessSettingsMiddleware('gunLedger')], asyncHandler(async (req, res) => {
  const { error, value } = rowsSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '行数据格式不正确', details: error.details.map(d => d.message) });
  }
  const data = db.readDb();
  if (!data.gunLedger) return res.status(404).json({ message: '表未找到' });
  const found = findTable(data.gunLedger, req.params.tableId);
  if (!found) return res.status(404).json({ message: '表未找到' });

  // 表级编辑锁保护：锁被他人持有时拒绝写入
  const holder = gunTableLocks.get(req.params.tableId);
  if (holder && (!req.user || holder.userId !== req.user.id)) {
    return res.status(409).json({ message: `该表正由「${holder.name || holder.username}」编辑，请等待其完成后再保存` });
  }

  const meta = userMeta(req);
  const now = new Date().toISOString();
  // 保留已存在的行的 createdAt/createdBy，新行（无 id 或 id 不存在）补全
  const existingById = new Map((found.table.rows || []).map(r => [r.id, r]));
  const nextRows = value.map(r => {
    const id = r.id || newId('gun-row');
    const prev = existingById.get(id);
    const isNew = !prev && String(r.gunName || '').trim() !== '';
    return {
      id,
      serialNumber: Number.isFinite(Number(r.serialNumber)) ? Number(r.serialNumber) : 0,
      gunName: String(r.gunName || ''),
      customer: String(r.customer || ''),
      time: String(r.time || ''),
      responsiblePerson: String(r.responsiblePerson || ''),
      remarks: String(r.remarks || ''),
      createdAt: prev?.createdAt || (isNew ? now : (r.createdAt || '')),
      createdBy: prev?.createdBy || (isNew ? meta : (r.createdBy || null)),
      updatedAt: now,
      updatedBy: meta
    };
  });
  found.table.rows = nextRows;
  await db.writeDb(data);

  const io = req.app.get('io');
  if (io) io.emit('gun_ledger_updated', { action: 'update_rows', tableId: req.params.tableId, rows: nextRows });

  res.json(nextRows);
}));

// PATCH /api/gun-ledger/categories/order —— 重排分类顺序
router.patch('/categories/order', [authMiddleware, adminMiddleware, accessSettingsMiddleware('gunLedger')], asyncHandler(async (req, res) => {
  const orderSchema = Joi.object({
    order: Joi.array().items(Joi.string().min(1).max(30)).min(1).required()
  });
  const { error, value } = orderSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: '分类顺序数据不正确', details: error.details.map(d => d.message) });
  }
  const data = db.readDb();
  if (!data.gunLedger || !data.gunLedger.categories) {
    return res.status(404).json({ message: '台账数据未找到' });
  }
  const oldCats = data.gunLedger.categories;
  // 校验：order 必须与现有分类集合一致（防止越权改/增分类）
  const existingKeys = Object.keys(oldCats);
  const orderSet = new Set(value.order);
  if (orderSet.size !== value.order.length) {
    return res.status(400).json({ message: '分类顺序包含重复项' });
  }
  const missing = existingKeys.filter(k => !orderSet.has(k));
  const extra = value.order.filter(k => !Object.prototype.hasOwnProperty.call(oldCats, k));
  if (missing.length || extra.length) {
    return res.status(400).json({ message: '分类顺序与现有分类不一致' });
  }
  // 重建 categories 对象，按 order 顺序插入
  const rebuilt = {};
  value.order.forEach(name => { rebuilt[name] = oldCats[name]; });
  data.gunLedger.categories = rebuilt;
  await db.writeDb(data);

  const io = req.app.get('io');
  if (io) io.emit('gun_ledger_updated', { action: 'reorder_categories', order: value.order });

  res.json({ order: value.order });
}));

// GET /api/gun-ledger/default-persons —— 默认担当人员
router.get('/default-persons', [authMiddleware, accessSettingsMiddleware('gunLedger')], asyncHandler(async (req, res) => {
  const data = db.readDb();
  const persons = (data.gunLedger && Array.isArray(data.gunLedger.defaultResponsiblePersons) && data.gunLedger.defaultResponsiblePersons.length)
    ? data.gunLedger.defaultResponsiblePersons
    : ['张啸', '张明', '陈青松', '陈大仪'];
  res.json(persons);
}));

// PUT /api/gun-ledger/default-persons —— 修改默认担当人员（超管）
router.put('/default-persons', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const { error, value } = defaultPersonsSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: '默认担当人员格式不正确', details: error.details.map(d => d.message) });
  }
  const data = db.readDb();
  if (!data.gunLedger) data.gunLedger = { categories: { 'X2C': [], 'X2C-V2': [], 'X2C-V3': [] }, defaultResponsiblePersons: [] };
  const persons = value.map(p => String(p).trim()).filter(Boolean);
  data.gunLedger.defaultResponsiblePersons = persons;
  await db.writeDb(data);

  const io = req.app.get('io');
  if (io) io.emit('gun_ledger_updated', { action: 'default_persons', defaultResponsiblePersons: persons });

  res.json(persons);
}));

module.exports = router;
