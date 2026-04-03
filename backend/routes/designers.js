const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const Joi = require('joi');
const asyncHandler = require('express-async-handler');

const designerSchema = Joi.object({
  name: Joi.string().min(1).max(50).required(),
  group: Joi.string().allow('').default('')
});

// Get all designers (Public access for rendering table)
router.get('/', asyncHandler(async (req, res) => {
  const data = db.readDb();
  res.json(data.designers || []);
}));

// Create designer (Admin only)
router.post('/', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  const { error } = designerSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const { name, group } = req.body;
  const data = db.readDb();

  const newDesigner = {
    id: Date.now().toString(),
    name,
    group: group || ''
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

  const { name, group } = req.body;
  data.designers[index].name = name;
  data.designers[index].group = group;

  await db.writeDb(data);
  res.json(data.designers[index]);
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
