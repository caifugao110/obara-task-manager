'use strict';
/**
 * 系统信息：延迟探测、系统设置读写、版本检查、数据库体积统计。
 *
 * 由 backend/routes/system.js 拆分而来，代码为原样搬运（未改逻辑）。
 */
const express = require('express');

const router = express.Router();
const fs = require('fs');

const db = require('../../db');
const taskStore = require('../../taskStore');
const { authMiddleware, superAdminMiddleware } = require('../../middleware/auth');
const asyncHandler = require('express-async-handler');
const { systemSettingsSchema, normalizeSystemSettings } = require('./shared');
const { getLocalVersion, fetchGiteeLatestCommit, compareVersions } = require('./version');

router.get('/ping', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, serverTime: Date.now() });
});

router.get('/settings', authMiddleware, asyncHandler(async (req, res) => {
  const data = db.readDb();
  res.json(normalizeSystemSettings(data.settings?.system));
}));

router.put('/settings', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const { error, value } = systemSettingsSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const data = db.readDb();
  if (!data.settings) data.settings = {};
  // 与库中现有设置合并后再落库：只传部分字段时不会把其它设置（含任务内容配色）打回默认值
  const currentSystem = data.settings.system && typeof data.settings.system === 'object' ? data.settings.system : {};
  data.settings.system = normalizeSystemSettings({ ...currentSystem, ...value });
  await db.writeDb(data);
  res.json(data.settings.system);
}));

// 版本信息需登录后查看，避免匿名探测部署版本与更新渠道
router.get('/version', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const currentVersion = getLocalVersion();
    let hasUpdate = false;
    let latestVersion = null;

    const giteeCommit = await fetchGiteeLatestCommit();
    if (giteeCommit) {
      const remoteVersion = giteeCommit.date;
      const comparison = compareVersions(remoteVersion, currentVersion);
      if (comparison > 0) {
        hasUpdate = true;
        latestVersion = remoteVersion;
      }
    }

    res.json({ currentVersion, hasUpdate, latestVersion });
  } catch {
    res.json({ currentVersion: getLocalVersion(), hasUpdate: false, latestVersion: null });
  }
}));

router.get('/db-stats', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const data = db.readDb();

  // tasks 在 taskStore 关系表、loginLogs 在独立表，均不在 kv 缓存中，单独统计
  const sheetsCount = taskStore.countSheets();
  const totalTasks = taskStore.countEntries();
  const monthCount = taskStore.countMonths();
  const tasksJsonBytes = taskStore.entriesJsonSize();
  const loginLogsCount = db.countLoginLogs();
  const auditLogsCount = db.countAuditLogs();
  const statusTrackingItems = data.statusTrackingItems || [];
  const users = data.users || [];
  const designers = data.designers || [];

  // 逻辑数据大小（kv 集合序列化体积 + 任务条目 JSON 体积）
  const kvJsonBytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
  const sizeInBytes = kvJsonBytes + tasksJsonBytes;
  const sizeInKB = (sizeInBytes / 1024).toFixed(2);
  const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2);

  // SQLite 物理存储信息
  const dbPath = db.getDbPath();
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  const dbFileSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  const walSize = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
  const shmSize = fs.existsSync(shmPath) ? fs.statSync(shmPath).size : 0;
  const totalDiskSize = dbFileSize + walSize + shmSize;
  const journalMode = db.getRawDb().pragma('journal_mode', { simple: true });
  
  res.json({
    size: {
      bytes: sizeInBytes,
      kb: parseFloat(sizeInKB),
      mb: parseFloat(sizeInMB)
    },
    storage: {
      engine: 'SQLite',
      driver: 'better-sqlite3',
      journalMode,
      path: dbPath,
      dbFileSize,
      walSize,
      shmSize,
      totalDiskSize
    },
    counts: {
      users: users.length,
      designers: designers.length,
      tasks: sheetsCount,
      taskItems: totalTasks,
      months: monthCount,
      statusTrackingItems: statusTrackingItems.length,
      loginLogs: loginLogsCount,
      auditLogs: auditLogsCount
    },
    warnings: {
      over50MB: sizeInBytes > 50 * 1024 * 1024,
      over10MB: sizeInBytes > 10 * 1024 * 1024,
      oldTaskData: monthCount > 24
    }
  });
}));

module.exports = router;
