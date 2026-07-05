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

const normalizeAccessSettingsForKey = (key, settings = defaultAccessSettings) => {
  const normalized = normalizeAccessSettings(settings);
  if (key === 'systemSettings') {
    normalized.allowViewers = false;
  }
  return normalized;
};

const getAccessSettings = (key) => asyncHandler(async (req, res) => {
  const data = db.readDb();
  const settings = normalizeAccessSettingsForKey(key, data.settings?.[key]);
  res.json(settings);
});

const updateAccessSettings = (key) => [authMiddleware, superAdminMiddleware, asyncHandler(async (req, res) => {
  const { error, value } = accessSettingsSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const data = db.readDb();
  if (!data.settings) data.settings = {};
  data.settings[key] = normalizeAccessSettingsForKey(key, value);
  await db.writeDb(data);
  res.json(data.settings[key]);
})];

router.get('/leaderboard', getAccessSettings('leaderboard'));
router.put('/leaderboard', updateAccessSettings('leaderboard'));

router.get('/work-hours', getAccessSettings('workHours'));
router.put('/work-hours', updateAccessSettings('workHours'));

router.get('/status-tracking', getAccessSettings('statusTracking'));
router.put('/status-tracking', updateAccessSettings('statusTracking'));

router.get('/system-settings', getAccessSettings('systemSettings'));
router.put('/system-settings', updateAccessSettings('systemSettings'));

const defaultLeaderRules = [
  { leader: '陈大仪', members: ['郭涛', '王兴龙', '王会永', '李广亮'] },
  { leader: '张啸', members: ['李守健', '邓明江', '贾银鑫', '熊飞'] },
  { leader: '张明', members: ['吴露鹭', '茅舒', '沈雨帆', '张晟隽', '刘知新', '梁科研', '吴方盛'] },
  { leader: '陈青松', members: ['张广奇', '李劲日', '曹圩圩', '许孟涵'] }
];

const leaderRulesSchema = Joi.array().items(
  Joi.object({
    leader: Joi.string().required(),
    members: Joi.array().items(Joi.string()).required()
  })
);

router.get('/leader-rules', asyncHandler(async (req, res) => {
  const data = db.readDb();
  const rules = data.settings?.leaderRules || defaultLeaderRules;
  res.json(rules);
}));

router.put('/leader-rules', [authMiddleware, superAdminMiddleware, asyncHandler(async (req, res) => {
  const { error, value } = leaderRulesSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const data = db.readDb();
  if (!data.settings) data.settings = {};
  data.settings.leaderRules = value;
  await db.writeDb(data);
  res.json(data.settings.leaderRules);
})]);

module.exports = router;

