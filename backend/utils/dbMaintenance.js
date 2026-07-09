const fs = require('fs');
const path = require('path');
const db = require('../db');
const securityConfig = require('../config/security');

const backendRoot = path.resolve(__dirname, '..');
const dbPath = path.resolve(backendRoot, securityConfig.database.path);

const defaultMaintenanceSettings = {
  enabled: true,
  dailyBackupEnabled: true,
  dailyTaskExportEnabled: true,
  backupRetentionDays: 30,
  scheduleTime: '00:30',
  yearlyCleanupEnabled: true,
  yearlyCleanupMonth: 1,
  yearlyCleanupCheckDays: 10,
  yearlyTaskRetentionYears: 1,
  backupDir: 'backups/database',
  taskExportDir: 'backups/task-exports',
  yearlyArchiveDir: 'backups/yearly-archives',
  yearlyCleanupHistory: {}
};

let schedulerTimer = null;
let schedulerRunning = false;
let lastSchedulerState = null;

const pad = (value) => String(value).padStart(2, '0');
const toTimestamp = (date = new Date()) => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
const toDateKey = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const normalizeMaintenanceSettings = (settings = {}) => ({
  ...defaultMaintenanceSettings,
  ...settings,
  enabled: settings.enabled ?? defaultMaintenanceSettings.enabled,
  dailyBackupEnabled: settings.dailyBackupEnabled ?? defaultMaintenanceSettings.dailyBackupEnabled,
  dailyTaskExportEnabled: settings.dailyTaskExportEnabled ?? defaultMaintenanceSettings.dailyTaskExportEnabled,
  yearlyCleanupEnabled: settings.yearlyCleanupEnabled ?? defaultMaintenanceSettings.yearlyCleanupEnabled,
  backupRetentionDays: Math.max(1, parseInt(settings.backupRetentionDays, 10) || defaultMaintenanceSettings.backupRetentionDays),
  yearlyCleanupMonth: Math.min(12, Math.max(1, parseInt(settings.yearlyCleanupMonth, 10) || defaultMaintenanceSettings.yearlyCleanupMonth)),
  yearlyCleanupCheckDays: Math.min(31, Math.max(1, parseInt(settings.yearlyCleanupCheckDays, 10) || defaultMaintenanceSettings.yearlyCleanupCheckDays)),
  yearlyTaskRetentionYears: Math.max(1, parseInt(settings.yearlyTaskRetentionYears, 10) || defaultMaintenanceSettings.yearlyTaskRetentionYears),
  scheduleTime: /^\d{2}:\d{2}$/.test(String(settings.scheduleTime || '')) ? settings.scheduleTime : defaultMaintenanceSettings.scheduleTime,
  backupDir: String(settings.backupDir || defaultMaintenanceSettings.backupDir).trim(),
  taskExportDir: String(settings.taskExportDir || defaultMaintenanceSettings.taskExportDir).trim(),
  yearlyArchiveDir: String(settings.yearlyArchiveDir || defaultMaintenanceSettings.yearlyArchiveDir).trim(),
  yearlyCleanupHistory: settings.yearlyCleanupHistory && typeof settings.yearlyCleanupHistory === 'object' && !Array.isArray(settings.yearlyCleanupHistory)
    ? settings.yearlyCleanupHistory
    : {}
});

const getMaintenanceSettings = () => {
  const data = db.readDb();
  const settings = normalizeMaintenanceSettings(data.settings?.maintenance);
  if (!data.settings) data.settings = {};
  data.settings.maintenance = settings;
  return { data, settings };
};

const resolveManagedDir = (relativeDir) => {
  const cleanDir = String(relativeDir || '').replace(/^[a-zA-Z]:/, '').replace(/^[/\\]+/, '');
  return path.resolve(backendRoot, cleanDir);
};

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const writeJsonFile = (filePath, payload) => {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
};

const countTaskItems = (tasks = []) => tasks.reduce((total, sheet) => {
  const dayItems = Object.values(sheet.days || {}).reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0);
  return total + dayItems;
}, 0);

const listManagedFiles = (dirPath, predicate = () => true) => {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => {
      const filePath = path.join(dirPath, entry.name);
      const stat = fs.statSync(filePath);
      return { name: entry.name, path: filePath, size: stat.size, mtime: stat.mtime };
    })
    .filter(predicate)
    .sort((first, second) => second.mtime.getTime() - first.mtime.getTime());
};

const createDatabaseBackup = (options = {}) => {
  const { settings } = getMaintenanceSettings();
  const backupDir = resolveManagedDir(options.dir || settings.backupDir);
  ensureDir(backupDir);
  const fileName = `db-backup-${toTimestamp()}.json`;
  const filePath = path.join(backupDir, fileName);
  fs.copyFileSync(dbPath, filePath);
  return { fileName, filePath, dir: backupDir, size: fs.statSync(filePath).size };
};

const exportTaskData = (options = {}) => {
  const { data, settings } = getMaintenanceSettings();
  const taskExportDir = resolveManagedDir(options.dir || settings.taskExportDir);
  ensureDir(taskExportDir);
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const payload = {
    exportedAt: new Date().toISOString(),
    type: options.type || 'scheduled-task-export',
    taskSheets: tasks.length,
    taskItems: countTaskItems(tasks),
    designers: data.designers || [],
    tasks,
    workdayOverrides: data.settings?.workdayOverrides || {}
  };
  const fileName = `task-export-${toTimestamp()}.json`;
  const filePath = path.join(taskExportDir, fileName);
  writeJsonFile(filePath, payload);
  return { fileName, filePath, dir: taskExportDir, size: fs.statSync(filePath).size, taskSheets: payload.taskSheets, taskItems: payload.taskItems };
};

const cleanupOldBackups = (options = {}) => {
  const { settings } = getMaintenanceSettings();
  const retentionDays = Math.max(1, parseInt(options.retentionDays, 10) || settings.backupRetentionDays);
  const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const dirs = [resolveManagedDir(settings.backupDir), resolveManagedDir(settings.taskExportDir)];
  const removed = [];

  dirs.forEach(dirPath => {
    listManagedFiles(dirPath, file => file.mtime.getTime() < cutoffTime).forEach(file => {
      fs.unlinkSync(file.path);
      removed.push({ fileName: file.name, dir: dirPath, size: file.size });
    });
  });

  return { retentionDays, removedCount: removed.length, removed };
};

const createYearlyArchive = (archiveTasks, cutoffYear, settings) => {
  const archiveDir = resolveManagedDir(settings.yearlyArchiveDir);
  ensureDir(archiveDir);
  const payload = {
    archivedAt: new Date().toISOString(),
    type: 'yearly-cleanup-archive',
    neverCleanup: true,
    cutoff: `before-${cutoffYear}-01`,
    taskSheets: archiveTasks.length,
    taskItems: countTaskItems(archiveTasks),
    tasks: archiveTasks
  };
  const fileName = `yearly-archive-before-${cutoffYear}-${toTimestamp()}.json`;
  const filePath = path.join(archiveDir, fileName);
  writeJsonFile(filePath, payload);
  return { fileName, filePath, dir: archiveDir, size: fs.statSync(filePath).size, taskSheets: payload.taskSheets, taskItems: payload.taskItems };
};

const runYearlyTaskCleanup = async (options = {}) => {
  const currentDate = options.now || new Date();
  const { data, settings } = getMaintenanceSettings();
  const currentYear = currentDate.getFullYear();
  const cleanupKey = String(currentYear);
  const forced = Boolean(options.force);

  if (!forced) {
    if (!settings.yearlyCleanupEnabled) return { skipped: true, reason: 'disabled' };
    if (currentDate.getMonth() + 1 !== settings.yearlyCleanupMonth) return { skipped: true, reason: 'outside-cleanup-month' };
    if (currentDate.getDate() > settings.yearlyCleanupCheckDays) return { skipped: true, reason: 'outside-check-window' };
    if (settings.yearlyCleanupHistory?.[cleanupKey]) return { skipped: true, reason: 'already-completed', history: settings.yearlyCleanupHistory[cleanupKey] };
  }

  const cutoffYear = currentYear - settings.yearlyTaskRetentionYears;
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const archiveTasks = tasks.filter(sheet => Number(sheet.year) < cutoffYear);

  if (archiveTasks.length === 0) {
    if (!data.settings) data.settings = {};
    data.settings.maintenance = settings;
    data.settings.maintenance.yearlyCleanupHistory = {
      ...settings.yearlyCleanupHistory,
      [cleanupKey]: { completedAt: new Date().toISOString(), cutoffYear, archivedSheets: 0, removedSheets: 0, archiveFile: null }
    };
    await db.writeDb(data);
    return { skipped: false, cutoffYear, archivedSheets: 0, removedSheets: 0, removedTaskItems: 0, archive: null };
  }

  const archive = createYearlyArchive(archiveTasks, cutoffYear, settings);
  const archiveIds = new Set(archiveTasks.map(sheet => sheet.id || `${sheet.designerId || sheet.userId}-${sheet.year}-${sheet.month}`));
  data.tasks = tasks.filter(sheet => !archiveIds.has(sheet.id || `${sheet.designerId || sheet.userId}-${sheet.year}-${sheet.month}`));
  if (!data.settings) data.settings = {};
  data.settings.maintenance = settings;
  data.settings.maintenance.yearlyCleanupHistory = {
    ...settings.yearlyCleanupHistory,
    [cleanupKey]: {
      completedAt: new Date().toISOString(),
      cutoffYear,
      archivedSheets: archive.taskSheets,
      removedSheets: archive.taskSheets,
      removedTaskItems: archive.taskItems,
      archiveFile: archive.filePath
    }
  };
  await db.writeDb(data);

  return { skipped: false, cutoffYear, archivedSheets: archive.taskSheets, removedSheets: archive.taskSheets, removedTaskItems: archive.taskItems, archive };
};

const getNextRunAt = (scheduleTime, fromDate = new Date()) => {
  const [hours, minutes] = String(scheduleTime || defaultMaintenanceSettings.scheduleTime).split(':').map(part => parseInt(part, 10));
  const nextRun = new Date(fromDate);
  nextRun.setHours(hours || 0, minutes || 0, 0, 0);
  if (nextRun <= fromDate) nextRun.setDate(nextRun.getDate() + 1);
  return nextRun;
};

const runScheduledMaintenance = async () => {
  if (schedulerRunning) return { skipped: true, reason: 'already-running' };
  schedulerRunning = true;
  const startedAt = new Date();
  const result = { startedAt: startedAt.toISOString(), backup: null, taskExport: null, backupCleanup: null, yearlyCleanup: null, errors: [] };

  try {
    const { settings } = getMaintenanceSettings();
    if (!settings.enabled) {
      result.skipped = true;
      result.reason = 'disabled';
      return result;
    }
    if (settings.dailyBackupEnabled) result.backup = createDatabaseBackup();
    if (settings.dailyTaskExportEnabled) result.taskExport = exportTaskData();
    result.backupCleanup = cleanupOldBackups();
    result.yearlyCleanup = await runYearlyTaskCleanup();
    return result;
  } catch (error) {
    result.errors.push(error.message);
    console.error('[maintenance] scheduled maintenance failed:', error);
    return result;
  } finally {
    result.finishedAt = new Date().toISOString();
    lastSchedulerState = result;
    schedulerRunning = false;
  }
};

const scheduleNextRun = () => {
  const { settings } = getMaintenanceSettings();
  const nextRun = getNextRunAt(settings.scheduleTime);
  const delay = Math.max(1000, nextRun.getTime() - Date.now());
  if (schedulerTimer) clearTimeout(schedulerTimer);
  schedulerTimer = setTimeout(async () => {
    await runScheduledMaintenance();
    scheduleNextRun();
  }, delay);
  lastSchedulerState = { ...(lastSchedulerState || {}), nextRunAt: nextRun.toISOString(), scheduleDate: toDateKey(nextRun) };
  return nextRun;
};

const startMaintenanceScheduler = () => {
  const nextRun = scheduleNextRun();
  console.log(`[maintenance] scheduler started, next run at ${nextRun.toISOString()}`);
};

const getMaintenanceStatus = () => {
  const { settings } = getMaintenanceSettings();
  return {
    settings,
    paths: {
      database: dbPath,
      backupDir: resolveManagedDir(settings.backupDir),
      taskExportDir: resolveManagedDir(settings.taskExportDir),
      yearlyArchiveDir: resolveManagedDir(settings.yearlyArchiveDir)
    },
    files: {
      backups: listManagedFiles(resolveManagedDir(settings.backupDir)).slice(0, 10),
      taskExports: listManagedFiles(resolveManagedDir(settings.taskExportDir)).slice(0, 10),
      yearlyArchives: listManagedFiles(resolveManagedDir(settings.yearlyArchiveDir)).slice(0, 10)
    },
    scheduler: {
      running: schedulerRunning,
      lastRun: lastSchedulerState,
      nextRunAt: lastSchedulerState?.nextRunAt || getNextRunAt(settings.scheduleTime).toISOString()
    }
  };
};

module.exports = {
  defaultMaintenanceSettings,
  normalizeMaintenanceSettings,
  getMaintenanceStatus,
  createDatabaseBackup,
  exportTaskData,
  cleanupOldBackups,
  runYearlyTaskCleanup,
  runScheduledMaintenance,
  startMaintenanceScheduler,
  scheduleNextRun
};
