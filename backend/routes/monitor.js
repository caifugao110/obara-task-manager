/**
 * 状态监测接口（系统设置 → 状态监测）
 *
 * GET  /api/system/monitor/overview?preset=today|3d|7d|30d|90d|180d|day&date=YYYY-MM-DD
 * GET  /api/system/monitor/live
 * GET  /api/system/monitor/storage
 * GET  /api/system/monitor/shares?force=1
 * POST /api/system/monitor/cleanup
 *
 * 权限分两层：
 *   - 读取（overview / live / storage / shares）：管理员（admin）与超级管理员都可访问。
 *     这些信息本身不含业务数据，一般管理员排障时最需要它——「页面打不开」到底是进程挂了、
 *     事件循环卡住、还是共享盘掉了，只有这里能看出来；只让超管看的结果是管理员一律来找超管。
 *   - 写入（cleanup：删除/压缩监测数据）：仅超级管理员。页面按只读渲染，接口再挡一次，
 *     避免绕过前端直接 POST。
 */

const express = require('express');
const asyncHandler = require('express-async-handler');
const router = express.Router();
const { authMiddleware, adminMiddleware, superAdminMiddleware } = require('../middleware/auth');
const monitor = require('../utils/systemMonitor');
const shareStatus = require('../utils/shareStatus');
const productionSchedule = require('../utils/productionSchedule');

const ALLOWED_PRESETS = new Set(['today', '3d', '7d', '30d', '90d', '180d', 'day']);
const ALLOWED_CLEANUP_MODES = new Set(['retention', 'days', 'vacuum', 'all']);

router.get('/overview', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  const rawPreset = String(req.query.preset || 'today');
  const preset = ALLOWED_PRESETS.has(rawPreset) ? rawPreset : 'today';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : undefined;
  // 开发期 nodemon 热重载会制造大量「非故障中断」，允许按需从可用率里剔除
  const ignoreHotReload = String(req.query.ignoreHotReload || '') === '1';

  res.json(monitor.getOverview({ preset, date, ignoreHotReload }));
}));

router.get('/live', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  res.json(monitor.getLive());
}));

router.get('/storage', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  // 汇总接口会跟自动刷新一起被调用，默认走 30 秒缓存；手动点刷新时前端传 force=1
  res.json(monitor.getStorage({ force: String(req.query.force || '') === '1' }));
}));

// 共享路径访问状态：监测页要能看出「进程活着但共享盘掉了」这类故障，
// 否则仕样书取号 / 状态跟踪同步失败时只能去翻后端日志。
// 默认走缓存（成功 30 秒 / 失败 10 秒），点「重新探测」时前端传 force=1。
router.get('/shares', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  const payload = await shareStatus.getShareAccess({ force: String(req.query.force || '') === '1' });

  // 大日程额外带上「最近一次成功解析」与熔断状态：
  // 文件读得到但 XLSX 解析失败（结构改版、被写坏）只有这里能看出来。
  const scheduleEntry = payload.paths.find((item) => item.key === 'productionSchedule');
  if (scheduleEntry) {
    const status = productionSchedule.getScheduleStatus();
    scheduleEntry.runtime = {
      lastSuccessAt: status.lastSuccessAt || null,
      loadedAt: status.loadedAt || null,
      entryCount: status.entryCount || 0,
      breakerOpen: Boolean(status.breaker && status.breaker.open),
      breakerReason: (status.breaker && status.breaker.lastReason) || null,
      lastError: status.lastError
        ? {
          code: status.lastError.code || '',
          message: status.lastError.message || status.lastError.hint || ''
        }
        : null
    };
  }

  res.json(payload);
}));

// 唯一写接口：删数据 / VACUUM 都不可恢复，权限必须比读取更严——保持超级管理员专属。
// 一般管理员即使拿到管理台页面（只读渲染）也调不动这里。
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
