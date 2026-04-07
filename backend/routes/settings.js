const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, superAdminMiddleware } = require('../middleware/auth');
const Joi = require('joi');
const asyncHandler = require('express-async-handler');

const leaderboardSettingsSchema = Joi.object({
  enabled: Joi.boolean().required(),
  allowAdmins: Joi.boolean().required(),
  allowViewers: Joi.boolean().required()
});

router.get('/leaderboard', asyncHandler(async (req, res) => {
  const data = db.readDb();
  const settings = data.settings?.leaderboard || { enabled: true, allowAdmins: true, allowViewers: false };
  res.json(settings);
}));

router.put('/leaderboard', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const { error, value } = leaderboardSettingsSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const data = db.readDb();
  if (!data.settings) data.settings = {};
  data.settings.leaderboard = value;
  await db.writeDb(data);
  res.json(value);
}));

module.exports = router;

