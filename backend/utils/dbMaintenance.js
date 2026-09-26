const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const db = require('../db');
const XLSX = require('xlsx');
const { getEffectiveIsWeekend, normalizeWorkdayOverrides } = require('./workday');
const { sanitizeAoaRows } = require('./fileUploadSecurity');
const { buildTaskExportBuffer } = require('./taskExportWorkbook');
const gunExport = require('./gunLedgerExport');

// 备份最终化：rawDb.backup() 生成的备份文件继承源库的 WAL 模式，
// 会在备份目录留下 .db-wal / .db-shm 伴随文件，导致前端列表出现多条记录。
// 这里打开备份文件并切换到 DELETE 日志模式，会把 WAL 内容合并入主库文件
// 并删除伴随文件，最终只保留一个干净的单文件 .db 备份。
const finalizeBackup = (filePath) => {
  try {
    const backupDb = new Database(filePath);
    backupDb.pragma('journal_mode = DELETE');
    backupDb.close();
  } catch (err) {
    console.warn(`[backup] 最终化备份文件失败 (${path.basename(filePath)}):`, err.message);
  }
};

const backendRoot = path.resolve(__dirname, '..');
// SQLite 数据库路径由 db 模块统一管理，避免路径不一致
const getDbPath = () => db.getDbPath();

const defaultMaintenanceSettings = {
  enabled: true,
  dailyBackupEnabled: true,
  dailyTaskExportEnabled: true,
  dailyGunLedgerExportEnabled: true,
  offlineBackupEnabled: true,
  backupRetentionDays: 30,
  offlineBackupRetentionDays: 7,
  taskExportRetentionDays: 30,
  gunLedgerExportRetentionDays: 30,
  scheduleTime: '00:30',
  yearlyCleanupEnabled: true,
  yearlyCleanupMonth: 1,
  yearlyCleanupCheckDays: 10,
  yearlyTaskRetentionYears: 1,
  backupDir: 'backups/database',
  taskExportDir: 'backups/task-exports',
  gunLedgerExportDir: 'backups/gun-ledger-exports',
  yearlyArchiveDir: 'backups/yearly-archives',
  offlineBackupDir: 'backups/offline',
  yearlyCleanupHistory: {}
};

let schedulerTimer = null;
let schedulerRunning = false;
let lastSchedulerState = null;
let lastOfflineBackupTime = 0;
const OFFLINE_BACKUP_MIN_INTERVAL = 5 * 60 * 1000;

const pad = (value) => String(value).padStart(2, '0');
const toTimestamp = (date = new Date()) => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
const toDateKey = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const normalizeMaintenanceSettings = (settings = {}) => ({
  ...defaultMaintenanceSettings,
  ...settings,
  enabled: settings.enabled ?? defaultMaintenanceSettings.enabled,
  dailyBackupEnabled: settings.dailyBackupEnabled ?? defaultMaintenanceSettings.dailyBackupEnabled,
  dailyTaskExportEnabled: settings.dailyTaskExportEnabled ?? defaultMaintenanceSettings.dailyTaskExportEnabled,
  dailyGunLedgerExportEnabled: settings.dailyGunLedgerExportEnabled ?? defaultMaintenanceSettings.dailyGunLedgerExportEnabled,
  offlineBackupEnabled: settings.offlineBackupEnabled ?? defaultMaintenanceSettings.offlineBackupEnabled,
  yearlyCleanupEnabled: settings.yearlyCleanupEnabled ?? defaultMaintenanceSettings.yearlyCleanupEnabled,
  backupRetentionDays: Math.max(1, parseInt(settings.backupRetentionDays, 10) || defaultMaintenanceSettings.backupRetentionDays),
  offlineBackupRetentionDays: Math.max(1, parseInt(settings.offlineBackupRetentionDays, 10) || defaultMaintenanceSettings.offlineBackupRetentionDays),
  taskExportRetentionDays: Math.max(1, parseInt(settings.taskExportRetentionDays, 10) || defaultMaintenanceSettings.taskExportRetentionDays),
  gunLedgerExportRetentionDays: Math.max(1, parseInt(settings.gunLedgerExportRetentionDays, 10) || defaultMaintenanceSettings.gunLedgerExportRetentionDays),
  yearlyCleanupMonth: Math.min(12, Math.max(1, parseInt(settings.yearlyCleanupMonth, 10) || defaultMaintenanceSettings.yearlyCleanupMonth)),
  yearlyCleanupCheckDays: Math.min(31, Math.max(1, parseInt(settings.yearlyCleanupCheckDays, 10) || defaultMaintenanceSettings.yearlyCleanupCheckDays)),
  yearlyTaskRetentionYears: Math.max(1, parseInt(settings.yearlyTaskRetentionYears, 10) || defaultMaintenanceSettings.yearlyTaskRetentionYears),
  scheduleTime: /^\d{2}:\d{2}$/.test(String(settings.scheduleTime || '')) ? settings.scheduleTime : defaultMaintenanceSettings.scheduleTime,
  backupDir: String(settings.backupDir || defaultMaintenanceSettings.backupDir).trim(),
  taskExportDir: String(settings.taskExportDir || defaultMaintenanceSettings.taskExportDir).trim(),
  gunLedgerExportDir: String(settings.gunLedgerExportDir || defaultMaintenanceSettings.gunLedgerExportDir).trim(),
  yearlyArchiveDir: String(settings.yearlyArchiveDir || defaultMaintenanceSettings.yearlyArchiveDir).trim(),
  offlineBackupDir: String(settings.offlineBackupDir || defaultMaintenanceSettings.offlineBackupDir).trim(),
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

// 维护目录一律限制在 backend/ 之内。
// 仅做「去盘符 + 去前导分隔符」的清洗是不够的：'../../..' 这类相对段会被
// path.resolve 原样展开，导致目录跳出 backendRoot；再配合 cleanupOldBackups
// 的 unlinkSync，就能删除 backend 之外的任意文件（越权删除）。
// 这里 fail-closed：解析结果越界直接抛错，不静默回退到别的目录。
const resolveManagedDir = (relativeDir) => {
  const cleanDir = String(relativeDir || '')
    .replace(/^[a-zA-Z]:/, '')
    .replace(/^[/\\]+/, '')
    .replace(/\.\.[/\\]/g, '')
    .replace(/[/\\]\.\./g, '');
  const resolved = path.resolve(backendRoot, cleanDir);
  if (resolved !== backendRoot && !resolved.startsWith(backendRoot + path.sep)) {
    throw new Error(`非法的维护目录配置：${relativeDir}`);
  }
  return resolved;
};

// 可被「清理过期备份」删除的文件类型白名单。
// 四个维护目录只应存放数据库备份（.db 及其 WAL/SHM 伴随文件）、
// 表格导出（.xls/.xlsx）与年度归档（.json）。加上白名单后，即使某个目录
// 被指向了混合内容的文件夹，也只会删除这些产物，不会误删无关文件。
const MANAGED_FILE_PATTERN = /\.(db|db-shm|db-wal|xlsx?|json)$/i;

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


const sheetHasData = (sheet) => {
  if (!sheet?.days || typeof sheet.days !== 'object') return false;
  return Object.values(sheet.days).some(items => Array.isArray(items) && items.length > 0);
};

const getDaysInMonth = (year, month) => new Date(year, month, 0).getDate();

const getTaskHours = (item = {}) => {
  if (Array.isArray(item.guns) && item.guns.length > 0) {
    return item.guns.reduce((sum, gun) => sum + (parseFloat(gun?.hours) || 0), 0);
  }
  return parseFloat(item.hours) || 0;
};

const getTaskName = (item = {}) => {
  if (item.leaveType === 'sick') return '\u4e8b\u5047';
  if (item.leaveType === 'vacation') return '\u4f11\u5047';
  if (item.leaveType === 'illness') return '\u75c5\u5047';
  if (item.leaveType === 'trip') {
    const name = String(item.taskName || '').trim();
    return name ? (name.endsWith('\u51fa\u5dee') ? name : `${name}\u51fa\u5dee`) : '\u51fa\u5dee';
  }
  return item.taskName || '';
};

const buildTaskExportWorkbook = (sheets, designers, workdayOverrides = {}) => {
  const workbook = XLSX.utils.book_new();
  const designerMap = new Map((designers || []).map(designer => [designer.id, designer]));
  const monthGroups = new Map();

  sheets.forEach(sheet => {
    const key = `${sheet.year}-${pad(sheet.month)}`;
    if (!monthGroups.has(key)) monthGroups.set(key, []);
    monthGroups.get(key).push(sheet);
  });

  [...monthGroups.keys()].sort().forEach(key => {
    const [year, month] = key.split('-').map(Number);
    const daysInMonth = getDaysInMonth(year, month);
    const header = ['\u8bbe\u8ba1\u5458'];
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = `${year}-${pad(month)}-${pad(day)}`;
      const weekendMark = getEffectiveIsWeekend(dateKey, workdayOverrides) ? '\uff08\u4f11\uff09' : '';
      header.push(`${day}\u65e5${weekendMark} \u4efb\u52a1\u5185\u5bb9`, `${day}\u65e5 \u5de5\u65f6`);
    }
    header.push('\u6708\u603b\u5de5\u65f6');

    const rows = [header];
    monthGroups.get(key).forEach(sheet => {
      const designer = designerMap.get(sheet.designerId) || designerMap.get(sheet.userId) || {};
      const maxRows = Math.max(1, ...Array.from({ length: daysInMonth }, (_, index) => {
        const dateKey = `${year}-${pad(month)}-${pad(index + 1)}`;
        return Array.isArray(sheet.days?.[dateKey]) ? sheet.days[dateKey].length : 0;
      }));
      const monthlyTotal = Array.from({ length: daysInMonth }, (_, index) => {
        const dateKey = `${year}-${pad(month)}-${pad(index + 1)}`;
        return (sheet.days?.[dateKey] || []).reduce((sum, item) => sum + getTaskHours(item), 0);
      }).reduce((sum, hours) => sum + hours, 0);

      for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
        const row = [rowIndex === 0 ? (designer.name || sheet.designerName || sheet.designerId || '') : ''];
        for (let day = 1; day <= daysInMonth; day += 1) {
          const dateKey = `${year}-${pad(month)}-${pad(day)}`;
          const item = sheet.days?.[dateKey]?.[rowIndex];
          row.push(item ? getTaskName(item) : '', item ? getTaskHours(item) : '');
        }
        row.push(rowIndex === 0 ? monthlyTotal : '');
        rows.push(row);
      }
    });

    const worksheet = XLSX.utils.aoa_to_sheet(sanitizeAoaRows(rows));
    worksheet['!cols'] = [{ wch: 12 }, ...Array.from({ length: daysInMonth }, () => [{ wch: 28 }, { wch: 8 }]).flat(), { wch: 10 }];
    XLSX.utils.book_append_sheet(workbook, worksheet, key);
  });

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xls' });
};

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

// 使用 SQLite 在线备份 API 生成一致性快照（即使数据库正在写入也安全）
const createDatabaseBackup = async (options = {}) => {
  const { settings } = getMaintenanceSettings();
  const backupDir = resolveManagedDir(options.dir || settings.backupDir);
  ensureDir(backupDir);
  const fileName = `db-backup-${toTimestamp()}.db`;
  const filePath = path.join(backupDir, fileName);
  const rawDb = db.getRawDb();
  await rawDb.backup(filePath);
  // 切换到 DELETE 日志模式，合并 WAL 并删除伴随文件，只保留单个 .db
  finalizeBackup(filePath);
  return { fileName, filePath, dir: backupDir, size: fs.statSync(filePath).size };
};

const createOfflineBackup = (userId, username, options = {}) => {
  const { settings } = getMaintenanceSettings();
  if (!settings.offlineBackupEnabled) {
    const result = { skipped: true, reason: 'offline-backup-disabled' };
    return options.async ? Promise.resolve(result) : result;
  }
  const now = Date.now();
  if (now - lastOfflineBackupTime < OFFLINE_BACKUP_MIN_INTERVAL) {
    const result = { skipped: true, reason: 'rate-limited', nextAvailableAt: lastOfflineBackupTime + OFFLINE_BACKUP_MIN_INTERVAL };
    return options.async ? Promise.resolve(result) : result;
  }
  const offlineDir = resolveManagedDir(settings.offlineBackupDir);
  ensureDir(offlineDir);
  const timestamp = toTimestamp();
  const prefix = userId ? `offline-backup-${userId}-${String(username || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')}` : 'offline-backup-shutdown';
  const fileName = `${prefix}-${timestamp}.db`;
  const filePath = path.join(offlineDir, fileName);
  
  // 使用 SQLite 在线备份 API，保证即使有写入也能得到一致性快照
  const performCopy = async () => {
    try {
      await db.getRawDb().backup(filePath);
      // 切换到 DELETE 日志模式，合并 WAL 并删除伴随文件，只保留单个 .db
      finalizeBackup(filePath);
      lastOfflineBackupTime = now;
      const size = fs.statSync(filePath).size;
      console.log(`[offline-backup] Created backup${userId ? ` for user ${username} (${userId})` : ''}: ${fileName} (${size} bytes)`);
      return { fileName, filePath, dir: offlineDir, userId, username, skipped: false, success: true, size };
    } catch (err) {
      console.error(`[offline-backup] Failed to create backup${userId ? ` for user ${username} (${userId})` : ''}:`, err);
      return { fileName, filePath, dir: offlineDir, userId, username, skipped: false, success: false, error: err.message };
    }
  };
  
  if (options.async) {
    return performCopy();
  }
  
  // 非 async 调用：后台执行备份，立即返回（保持原接口语义）
  performCopy();
  
  return { fileName, filePath, dir: offlineDir, userId, username, skipped: false };
};

const exportTaskData = (options = {}) => {
  const { data, settings } = getMaintenanceSettings();
  const taskExportDir = resolveManagedDir(options.dir || settings.taskExportDir);
  ensureDir(taskExportDir);
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const exportSheets = tasks.filter(sheetHasData);

  if (exportSheets.length === 0) {
    const result = { skipped: true, reason: 'no-data', taskSheets: 0, taskItems: 0 };
    if (options.requireData) {
      const error = new Error('\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684\u6570\u636e');
      error.statusCode = 404;
      error.result = result;
      throw error;
    }
    return result;
  }

  const buffer = buildTaskExportBuffer(exportSheets, data.designers || [], normalizeWorkdayOverrides(data.settings?.workdayOverrides));
  const fileName = `task-export-${toTimestamp()}.xls`;
  const filePath = path.join(taskExportDir, fileName);
  fs.writeFileSync(filePath, buffer);
  return {
    fileName,
    filePath,
    dir: taskExportDir,
    size: fs.statSync(filePath).size,
    taskSheets: exportSheets.length,
    taskItems: countTaskItems(exportSheets),
    type: options.type || 'scheduled-task-export'
  };
};

// 焊枪编号台账导出：所有分类的表导出到一个大 xls（每张表一个工作表）
const exportGunLedgerData = (options = {}) => {
  const { data, settings } = getMaintenanceSettings();
  const exportDir = resolveManagedDir(options.dir || settings.gunLedgerExportDir);
  ensureDir(exportDir);
  const gunLedger = data.gunLedger;
  const categories = gunExport.getCategories(gunLedger);

  if (categories.length === 0) {
    const result = { skipped: true, reason: 'no-data', categories: 0 };
    if (options.requireData) {
      const error = new Error('没有可导出的焊枪编号台账数据');
      error.statusCode = 404;
      error.result = result;
      throw error;
    }
    return result;
  }

  const buffer = gunExport.buildCombinedBuffer(gunLedger);
  const fileName = `gun-ledger-all-${toTimestamp()}.xls`;
  const filePath = path.join(exportDir, fileName);
  fs.writeFileSync(filePath, buffer);
  return {
    fileName,
    filePath,
    dir: exportDir,
    size: fs.statSync(filePath).size,
    categories: categories.length,
    type: options.type || 'scheduled-gun-ledger-export'
  };
};

const cleanupOldBackups = (options = {}) => {
  const { settings } = getMaintenanceSettings();
  const retentionDays = Math.max(1, parseInt(options.retentionDays, 10) || settings.backupRetentionDays);
  const offlineRetentionDays = Math.max(1, parseInt(options.offlineRetentionDays, 10) || settings.offlineBackupRetentionDays);
  const taskRetentionDays = Math.max(1, parseInt(options.taskRetentionDays, 10) || settings.taskExportRetentionDays);
  const gunLedgerRetentionDays = Math.max(1, parseInt(options.gunLedgerRetentionDays, 10) || settings.gunLedgerExportRetentionDays);
  const dayMs = 24 * 60 * 60 * 1000;
  const dirs = [
    { path: resolveManagedDir(settings.backupDir), cutoff: Date.now() - retentionDays * dayMs },
    { path: resolveManagedDir(settings.taskExportDir), cutoff: Date.now() - taskRetentionDays * dayMs },
    { path: resolveManagedDir(settings.gunLedgerExportDir), cutoff: Date.now() - gunLedgerRetentionDays * dayMs },
    { path: resolveManagedDir(settings.offlineBackupDir), cutoff: Date.now() - offlineRetentionDays * dayMs }
  ];
  const removed = [];

  dirs.forEach(({ path: dirPath, cutoff }) => {
    // 双重条件：既要在保留期之外，也必须是维护产物（扩展名白名单）
    listManagedFiles(dirPath, file =>
      file.mtime.getTime() < cutoff && MANAGED_FILE_PATTERN.test(file.name)
    ).forEach(file => {
      fs.unlinkSync(file.path);
      removed.push({ fileName: file.name, dir: dirPath, size: file.size });
    });
  });

  return {
    retentionDays,
    offlineRetentionDays,
    taskRetentionDays,
    gunLedgerRetentionDays,
    removedCount: removed.length,
    removed
  };
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
  const result = { startedAt: startedAt.toISOString(), backup: null, taskExport: null, gunLedgerExport: null, backupCleanup: null, yearlyCleanup: null, errors: [] };

  try {
    const { settings } = getMaintenanceSettings();
    if (!settings.enabled) {
      result.skipped = true;
      result.reason = 'disabled';
      return result;
    }
    if (settings.dailyBackupEnabled) result.backup = await createDatabaseBackup();
    if (settings.dailyTaskExportEnabled) result.taskExport = exportTaskData();
    if (settings.dailyGunLedgerExportEnabled) result.gunLedgerExport = exportGunLedgerData();
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

  // 数据库物理文件大小（data.db + WAL + SHM）
  const dbPath = getDbPath();
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  const dbFileSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  const walSize = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
  const shmSize = fs.existsSync(shmPath) ? fs.statSync(shmPath).size : 0;
  const totalDiskSize = dbFileSize + walSize + shmSize;

  // tasks 集合的逻辑大小（JSON 序列化后的字节数）及任务统计
  const data = db.readDb();
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const tasksJsonSize = Buffer.byteLength(JSON.stringify(tasks), 'utf8');
  const taskItemsCount = tasks.reduce((sum, sheet) => {
    return sum + Object.values(sheet.days || {}).reduce((daySum, items) => daySum + (Array.isArray(items) ? items.length : 0), 0);
  }, 0);

  return {
    settings,
    paths: {
      database: dbPath,
      backupDir: resolveManagedDir(settings.backupDir),
      taskExportDir: resolveManagedDir(settings.taskExportDir),
      gunLedgerExportDir: resolveManagedDir(settings.gunLedgerExportDir),
      yearlyArchiveDir: resolveManagedDir(settings.yearlyArchiveDir),
      offlineBackupDir: resolveManagedDir(settings.offlineBackupDir)
    },
    database: {
      dbFileSize,
      walSize,
      shmSize,
      totalDiskSize,
      tasksJsonSize,
      tasksCount: tasks.length,
      taskItemsCount
    },
    files: {
      backups: listManagedFiles(resolveManagedDir(settings.backupDir), file => !/\.db-(shm|wal)$/i.test(file.name)).slice(0, 5),
      taskExports: listManagedFiles(resolveManagedDir(settings.taskExportDir)).slice(0, 5),
      gunLedgerExports: listManagedFiles(resolveManagedDir(settings.gunLedgerExportDir)).slice(0, 5),
      yearlyArchives: listManagedFiles(resolveManagedDir(settings.yearlyArchiveDir)).slice(0, 5),
      offlineBackups: listManagedFiles(resolveManagedDir(settings.offlineBackupDir)).slice(0, 5)
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
  createOfflineBackup,
  exportTaskData,
  exportGunLedgerData,
  cleanupOldBackups,
  runYearlyTaskCleanup,
  runScheduledMaintenance,
  startMaintenanceScheduler,
  scheduleNextRun
};
