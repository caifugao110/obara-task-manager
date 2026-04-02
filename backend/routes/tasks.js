const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const Joi = require('joi');
const asyncHandler = require('express-async-handler');

const normalizeDate = (dateStr) => {
  if (typeof dateStr !== 'string') return dateStr;
  return dateStr.length >= 10 ? dateStr.slice(0, 10) : dateStr;
};

const createItemSchema = Joi.object({
  userId: Joi.string().required(),
  date: Joi.string().isoDate().required(),
  taskName: Joi.string().allow('').default(''),
  hours: Joi.number().min(0).default(0)
});

const updateItemSchema = Joi.object({
  userId: Joi.string().required(),
  date: Joi.string().isoDate().required(),
  itemId: Joi.string().required(),
  field: Joi.string().valid('taskName', 'hours').required(),
  value: Joi.alternatives().try(Joi.string().allow(''), Joi.number().min(0)).required()
});

const deleteItemSchema = Joi.object({
  userId: Joi.string().required(),
  date: Joi.string().isoDate().required(),
  itemId: Joi.string().required()
});

const getMonthYearFromDate = (dateStr) => {
  const date = normalizeDate(dateStr);
  const d = new Date(`${date}T00:00:00`);
  return { month: d.getMonth() + 1, year: d.getFullYear() };
};

const getOrCreateSheet = (data, userId, month, year) => {
  if (!data.tasks) data.tasks = [];
  let sheet = data.tasks.find(t => t.userId === userId && t.month === month && t.year === year);
  if (!sheet) {
    sheet = { id: `sheet-${userId}-${year}-${month}`, userId, month, year, days: {} };
    data.tasks.push(sheet);
  }
  if (!sheet.days || typeof sheet.days !== 'object') sheet.days = {};
  return sheet;
};

router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const { month, year, userId } = req.query;
  const data = db.readDb();

  let tasks = data.tasks || [];

  if (req.user.role !== 'admin') {
    tasks = tasks.filter(t => t.userId === req.user.id);
  } else if (userId) {
    tasks = tasks.filter(t => t.userId === userId);
  }

  if (month && year) {
    const m = parseInt(month);
    const y = parseInt(year);
    tasks = tasks.filter(t => t.month === m && t.year === y);
  }

  res.json(tasks);
}));

router.post('/item', authMiddleware, asyncHandler(async (req, res) => {
  const { error, value: validated } = createItemSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const { userId, date: rawDate, taskName, hours } = validated;
  const date = normalizeDate(rawDate);

  if (req.user.role !== 'admin' && userId !== req.user.id) {
    return res.status(403).json({ message: '没有创建他人任务的权限' });
  }

  const data = db.readDb();
  const { month, year } = getMonthYearFromDate(date);
  const sheet = getOrCreateSheet(data, userId, month, year);

  if (!sheet.days[date]) sheet.days[date] = [];
  const item = {
    id: `item-${Date.now().toString()}${Math.random().toString(36).slice(2, 9)}`,
    taskName,
    hours
  };
  sheet.days[date].push(item);

  await db.writeDb(data);
  res.status(201).json({ sheetId: sheet.id, userId, month, year, date, item, sheet });
}));

router.put('/item', authMiddleware, asyncHandler(async (req, res) => {
  const { error, value: validated } = updateItemSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const { userId, date: rawDate, itemId, field, value } = validated;
  const date = normalizeDate(rawDate);
  const data = db.readDb();
  const { month, year } = getMonthYearFromDate(date);
  const sheet = getOrCreateSheet(data, userId, month, year);

  if (req.user.role !== 'admin' && sheet.userId !== req.user.id) {
    return res.status(403).json({ message: '没有修改他人任务的权限' });
  }

  const items = Array.isArray(sheet.days[date]) ? sheet.days[date] : [];
  const idx = items.findIndex(i => i.id === itemId);
  if (idx === -1) {
    return res.status(404).json({ message: '任务条目不存在' });
  }

  if (field === 'hours') {
    items[idx].hours = typeof value === 'number' ? value : (parseFloat(value) || 0);
  } else {
    items[idx].taskName = value;
  }

  sheet.days[date] = items;
  await db.writeDb(data);
  res.json({ sheetId: sheet.id, userId, month, year, date, item: items[idx], sheet });
}));

router.delete('/item', authMiddleware, asyncHandler(async (req, res) => {
  const { error, value: validated } = deleteItemSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const { userId, date: rawDate, itemId } = validated;
  const date = normalizeDate(rawDate);
  const data = db.readDb();
  const { month, year } = getMonthYearFromDate(date);
  const sheet = getOrCreateSheet(data, userId, month, year);

  if (req.user.role !== 'admin' && sheet.userId !== req.user.id) {
    return res.status(403).json({ message: '没有删除他人任务的权限' });
  }

  const items = Array.isArray(sheet.days[date]) ? sheet.days[date] : [];
  const nextItems = items.filter(i => i.id !== itemId);
  if (nextItems.length === items.length) {
    return res.status(404).json({ message: '任务条目不存在' });
  }
  sheet.days[date] = nextItems;
  if (sheet.days[date].length === 0) delete sheet.days[date];

  await db.writeDb(data);
  res.json({ message: '任务条目已删除', sheetId: sheet.id, userId, month, year, date, sheet });
}));

module.exports = router;
