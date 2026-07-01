const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, superAdminMiddleware } = require('../middleware/auth');
const Joi = require('joi');
const asyncHandler = require('express-async-handler');

const defaultAccessSettings = { enabled: true, allowAdmins: true, allowViewers: false };

const accessSettingsSchema = Joi.object({
  enabled: Joi.boolean().required(),
  allowAdmins: Joi.boolean().required(),
  allowViewers: Joi.boolean().required()
});

const normalizeAccessSettings = (settings = defaultAccessSettings) => {
  const normalized = { ...defaultAccessSettings, ...settings };
  if (normalized.allowViewers) normalized.allowAdmins = true;
  return normalized;
};

const getAccessSettings = (key) => asyncHandler(async (req, res) => {
  const data = db.readDb();
  const settings = normalizeAccessSettings(data.settings?.[key]);
  res.json(settings);
});

const updateAccessSettings = (key) => [authMiddleware, superAdminMiddleware, asyncHandler(async (req, res) => {
  const { error, value } = accessSettingsSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const data = db.readDb();
  if (!data.settings) data.settings = {};
  data.settings[key] = normalizeAccessSettings(value);
  await db.writeDb(data);
  res.json(data.settings[key]);
})];

router.get('/leaderboard', getAccessSettings('leaderboard'));
router.put('/leaderboard', updateAccessSettings('leaderboard'));

router.get('/work-hours', getAccessSettings('workHours'));
router.put('/work-hours', updateAccessSettings('workHours'));

module.exports = router;

