/**
 * 状态监测接口（系统设置 → 状态监测）
 *
 * GET  /api/system/monitor/overview?preset=today|3d|7d|30d|90d|180d|day&date=YYYY-MM-DD
 * GET  /api/system/monitor/live
 * GET  /api/system/monitor/storage
 * POST /api/system/monitor/cleanup
 *
 * 仅超级管理员可访问：返回的是系统内部运行信息（进程、内存、异常原因），
 * 不具备业务价值，但对攻击者有价值，因此权限与「数据库维护」保持一致。
 */

const express = require('express');
const asyncHandler = require('express-async-handler');
const router = express.Router();
const { authMiddleware, superAdminMiddleware } = require('../middleware/auth');
const monitor = require('../utils/systemMonitor');

const ALLOWED_PRESETS = new Set(['today', '3d', '7d', '30d', '90d', '180d', 'day']);
const ALLOWED_CLEANUP_MODES = new Set(['retention', 'days', 'vacuum', 'all']);

router.get('/overview', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const rawPreset = String(req.query.preset || 'today');
  const preset = ALLOWED_PRESETS.has(rawPreset) ? rawPreset : 'today';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : undefined;
  // 开发期 nodemon 热重载会制造大量「非故障中断」，允许按需从可用率里剔除
  const ignoreHotReload = String(req.query.ignoreHotReload || '') === '1';

  res.json(monitor.getOverview({ preset, date, ignoreHotReload }));
}));

router.get('/live', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  res.json(monitor.getLive());
}));

router.get('/storage', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  // 汇总接口会跟自动刷新一起被调用，默认走 30 秒缓存；手动点刷新时前端传 force=1
  res.json(monitor.getStorage({ force: String(req.query.force || '') === '1' }));
}));

router.post('/cleanup', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const body = req.body || {};
  const requested = String(body.mode || 'retention');
  const mode = ALLOWED_CLEANUP_MODES.has(requested) ? requested : 'retention';
  const days = Math.max(1, Math.min(365, Number(body.days) || 7));
  // mode=all（清空全部监测数据）默认顺手 VACUUM：否则删完一大堆行，主文件体积一点不变，
  // 用户会以为没清干净。显式传 vacuum:false 可跳过重建，用于只想清数据、不想阻塞写入的场景。
  const vacuum = mode === 'all'
    ? body.vacuum !== false
    : mode === 'vacuum' || body.vacuum === true;
  // 事件表在 all 模式下必然一起清（在 runCleanup 内处理），其余模式仍按开关
  const includeEvents = body.includeEvents === true;

  const result = monitor.runCleanup({
    mode: mode === 'vacuum' ? 'retention' : mode,
    days,
    vacuum,
    includeEvents,
    source: mode === 'all' ? 'manual-purge' : 'manual'
  });

  res.json({ ...result, storage: monitor.getStorage({ force: true }) });
}));

module.exports = router;
