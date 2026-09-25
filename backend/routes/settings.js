const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, superAdminMiddleware, adminMiddleware, guestViewMiddleware } = require('../middleware/auth');
const Joi = require('joi');
const asyncHandler = require('express-async-handler');
const weknora = require('../utils/weknora');
const {
  OVERRIDE_WORKDAY,
  OVERRIDE_WEEKEND,
  isNaturalWeekend,
  normalizeWorkdayOverrides
} = require('../utils/workday');

const defaultAccessSettings = { enabled: true, allowAdmins: true, allowViewers: false };

const accessSettingsSchema = Joi.object({
  enabled: Joi.boolean().required(),
  allowAdmins: Joi.boolean().required(),
  allowViewers: Joi.boolean().required()
});

const workdayOverrideSchema = Joi.object({
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  type: Joi.string().valid(OVERRIDE_WORKDAY, OVERRIDE_WEEKEND, null).allow(null).required()
});

const normalizeAccessSettings = (settings = defaultAccessSettings) => {
  const normalized = { ...defaultAccessSettings, ...settings };
  if (normalized.allowViewers) normalized.allowAdmins = true;
  return normalized;
};

const normalizeAccessSettingsForKey = (key, settings = defaultAccessSettings) => {
  const normalized = normalizeAccessSettings(settings);
  if (key === 'systemSettings' || key === 'gunLedger') {
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

router.get('/leaderboard', guestViewMiddleware, getAccessSettings('leaderboard'));
router.put('/leaderboard', updateAccessSettings('leaderboard'));

router.get('/work-hours', guestViewMiddleware, getAccessSettings('workHours'));
router.put('/work-hours', updateAccessSettings('workHours'));

router.get('/status-tracking', guestViewMiddleware, getAccessSettings('statusTracking'));
router.put('/status-tracking', updateAccessSettings('statusTracking'));

router.get('/design-standards', guestViewMiddleware, getAccessSettings('designStandards'));
router.put('/design-standards', updateAccessSettings('designStandards'));

/* ==================== 设计规范「答复约束提示词」（仅超级管理员） ====================
 *
 * WeKnora 的问答接口不接受自定义提示词，约束通过「自定义智能体」实现：
 * 每个知识库对应一个受管智能体，其 system_prompt 即管理员填写的约束内容。
 * 保存时由后端同步创建/更新/删除该智能体，并把 agentId 回写到配置里。
 */

const designStandardsPromptSchema = Joi.object({
  enabled: Joi.boolean().required(),
  knowledgeBases: Joi.object()
    .pattern(
      Joi.string().max(200),
      Joi.object({
        // 允许把整篇 Markdown 文档作为提示词粘贴进来
        prompt: Joi.string().allow('').max(20000).required()
      }).unknown(true)
    )
    .required()
});

router.get(
  '/design-standards-prompt',
  [authMiddleware, superAdminMiddleware],
  asyncHandler(async (req, res) => {
    const data = db.readDb();
    const stored = data.settings?.designStandardsPrompt;
    res.json({
      enabled: Boolean(stored?.enabled),
      knowledgeBases: stored?.knowledgeBases && typeof stored.knowledgeBases === 'object'
        ? stored.knowledgeBases
        : {}
    });
  })
);

router.put(
  '/design-standards-prompt',
  [authMiddleware, superAdminMiddleware],
  asyncHandler(async (req, res) => {
    const { error, value } = designStandardsPromptSchema.validate(req.body, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ message: '输入格式不正确', details: error.details });
    }

    const data = db.readDb();
    if (!data.settings) data.settings = {};
    const previous = data.settings.designStandardsPrompt || { enabled: false, knowledgeBases: {} };
    const prevKbs = previous.knowledgeBases && typeof previous.knowledgeBases === 'object'
      ? previous.knowledgeBases
      : {};
    const nextKbs = value.knowledgeBases || {};

    const nextState = { enabled: Boolean(value.enabled), knowledgeBases: {} };
    const syncErrors = [];

    // 1) 处理新增 / 修改：非空提示词 -> 同步到 WeKnora 智能体
    for (const [kbId, entry] of Object.entries(nextKbs)) {
      const prompt = String(entry?.prompt || '');
      if (!prompt.trim()) continue; // 空提示词等同于未配置

      const prevAgentId = prevKbs[kbId]?.agentId || '';
      try {
        const { id } = await weknora.ensureAgent({ kbId, prompt });
        nextState.knowledgeBases[kbId] = {
          prompt,
          agentId: id,
          updatedAt: new Date().toISOString()
        };
      } catch (err) {
        syncErrors.push({ kbId, message: err?.message || '同步智能体失败' });
        // 同步失败：保留原有记录（若原本就有），避免把可用配置丢掉
        if (prevAgentId) nextState.knowledgeBases[kbId] = { ...prevKbs[kbId], prompt };
      }
    }

    // 2) 处理移除 / 清空：删掉对应智能体
    for (const [kbId, entry] of Object.entries(prevKbs)) {
      const stillPresent = Boolean(String(nextKbs[kbId]?.prompt || '').trim());
      if (stillPresent) continue;
      const agentId = entry?.agentId;
      if (!agentId) continue;
      try {
        await weknora.deleteAgent(agentId);
      } catch (err) {
        syncErrors.push({ kbId, message: `删除旧智能体失败：${err?.message || err}` });
      }
    }

    data.settings.designStandardsPrompt = nextState;
    await db.writeDb(data);

    res.json({ ...nextState, syncErrors });
  })
);

router.get('/system-settings', guestViewMiddleware, getAccessSettings('systemSettings'));
router.put('/system-settings', updateAccessSettings('systemSettings'));

router.get('/gun-ledger', guestViewMiddleware, getAccessSettings('gunLedger'));
router.put('/gun-ledger', updateAccessSettings('gunLedger'));

router.get('/workday-overrides', guestViewMiddleware, asyncHandler(async (req, res) => {
  const data = db.readDb();
  res.json(normalizeWorkdayOverrides(data.settings?.workdayOverrides));
}));

router.put('/workday-overrides', [authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
  const { error, value } = workdayOverrideSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const data = db.readDb();
  if (!data.settings) data.settings = {};
  const overrides = normalizeWorkdayOverrides(data.settings.workdayOverrides);
  const naturalType = isNaturalWeekend(value.date) ? OVERRIDE_WEEKEND : OVERRIDE_WORKDAY;

  if (!value.type || value.type === naturalType) {
    delete overrides[value.date];
  } else {
    overrides[value.date] = value.type;
  }

  data.settings.workdayOverrides = overrides;
  await db.writeDb(data);
  res.json(overrides);
})]);

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

router.get('/leader-rules', guestViewMiddleware, asyncHandler(async (req, res) => {
  const data = db.readDb();
  const rules = data.settings?.leaderRules || defaultLeaderRules;
  res.json(rules);
}));

router.put('/leader-rules', [authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
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

router.post('/leader-rules/reset', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const data = db.readDb();
  if (!data.settings) data.settings = {};
  data.settings.leaderRules = defaultLeaderRules;
  await db.writeDb(data);
  res.json(defaultLeaderRules);
}));

module.exports = router;

