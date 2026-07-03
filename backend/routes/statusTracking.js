const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const asyncHandler = require('express-async-handler');

router.get('/items', asyncHandler(async (req, res) => {
  const data = db.readDb();
  const items = data.statusTrackingItems || [];
  res.json(items);
}));

router.post('/items', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  const data = db.readDb();
  if (!data.statusTrackingItems) data.statusTrackingItems = [];
  
  const newItem = {
    id: Date.now().toString(),
    ...req.body,
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
  
  data.statusTrackingItems[index] = {
    ...data.statusTrackingItems[index],
    ...req.body,
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

router.post('/sync', asyncHandler(async (req, res) => {
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
    if (existingIds.has(item.id)) {
      const index = data.statusTrackingItems.findIndex(i => i.id === item.id);
      if (index !== -1) {
        data.statusTrackingItems[index] = {
          ...data.statusTrackingItems[index],
          ...item,
          updatedAt: new Date().toISOString()
        };
      }
    } else {
      data.statusTrackingItems.push({
        ...item,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  }

  await db.writeDb(data);
  
  const io = req.app.get('io');
  if (io) {
    io.emit('status_tracking_bulk', data.statusTrackingItems);
  }
  
  res.json(data.statusTrackingItems);
}));

module.exports = router;