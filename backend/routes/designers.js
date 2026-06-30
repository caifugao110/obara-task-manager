const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, adminMiddleware, guestViewMiddleware } = require('../middleware/auth');
const Joi = require('joi');
const asyncHandler = require('express-async-handler');

const designerSchema = Joi.object({
  name: Joi.string().min(1).max(50).required(),
  group: Joi.string().allow('').default(''),
  hidden: Joi.boolean().default(false),
  order: Joi.number().default(0)
});

// Get all designers (Public access for rendering table)
router.get('/', guestViewMiddleware, asyncHandler(async (req, res) => {
  const data = db.readDb();
  const designers = (data.designers || []).sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json(designers);
}));

// Get all designers for admin management (Authenticated admin only)
router.get('/manage', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  const data = db.readDb();
  const designers = (data.designers || []).sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json(designers);
}));

// Create designer (Admin only)
router.post('/', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  const { error } = designerSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const { name, group, hidden, order } = req.body;
  const data = db.readDb();

  const newDesigner = {
    id: Date.now().toString(),
    name,
    group: group || '',
    hidden: hidden || false,
    order: order || 0
  };

  data.designers.push(newDesigner);
  await db.writeDb(data);

  res.status(201).json(newDesigner);
}));

// Update designer (Admin only)
router.put('/:id', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  const { error } = designerSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const data = db.readDb();
  const index = data.designers.findIndex(d => d.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: '设计人员不存在' });
  }

  const { name, group, hidden, order } = req.body;
  if (name !== undefined) data.designers[index].name = name;
  if (group !== undefined) data.designers[index].group = group;
  if (hidden !== undefined) data.designers[index].hidden = hidden;
  if (order !== undefined) data.designers[index].order = order;

  await db.writeDb(data);
  res.json(data.designers[index]);
}));

// Reorder designers (Admin only)
router.post('/reorder', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) {
    return res.status(400).json({ message: '输入格式不正确' });
  }

  const data = db.readDb();
  ids.forEach((id, index) => {
    const designer = data.designers.find(d => d.id === id);
    if (designer) {
      designer.order = index;
    }
  });

  await db.writeDb(data);
  res.json({ message: '排序已更新' });
}));

// Delete designer (Admin only)
router.delete('/:id', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  const data = db.readDb();
  const index = data.designers.findIndex(d => d.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: '设计人员不存在' });
  }

  data.designers.splice(index, 1);
  await db.writeDb(data);
  res.json({ message: '设计人员已删除' });
}));

module.exports = router;
