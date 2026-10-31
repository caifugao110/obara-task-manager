const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const db = require('../db');
const taskStore = require('../taskStore');
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
  scheduleTimes: ['00:30', '12:30'],
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
// 每日自动维护最多可配置两个执行时间点
const MAX_SCHEDULE_TIMES = 2;

const pad = (value) => String(value).padStart(2, '0');
const toTimestamp = (date = new Date()) => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
const toDateKey = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// 调度日志面向运维人员：一律按服务器本地时区输出，并附时区标识，
// 避免 UTC 的 ISO 时间（…T16:30:00.000Z）被误读成 16:30 本地时间。
const getTimezoneLabel = () => {
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  let timezone = '';
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (err) { /* 忽略时区名解析失败 */ }
  return `${timezone ? `${timezone} ` : ''}UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

const formatLocalDateTime = (date = new Date()) => {
  const target = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(target.getTime())) return String(date);
  const time = `${pad(target.getHours())}:${pad(target.getMinutes())}:${pad(target.getSeconds())}`;
  return `${toDateKey(target)} ${time} (${getTimezoneLabel()})`;
};

const normalizeScheduleTimes = (settings = {}) => {
  // 每日自动维护时间：最多两个时间点。兼容旧配置里的单值 scheduleTime（历史数据迁移）。
  const source = Array.isArray(settings.scheduleTimes)
    ? settings.scheduleTimes
    : (settings.scheduleTime ? [settings.scheduleTime] : []);
  const cleaned = source
    .map(value => String(value || '').trim())
    .filter(value => /^\d{2}:\d{2}$/.test(value))
    .slice(0, MAX_SCHEDULE_TIMES);
  return cleaned.length > 0 ? cleaned : [...defaultMaintenanceSettings.scheduleTimes];
};

const normalizeMaintenanceSettings = (settings = {}) => {
  const normalized = {
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
    scheduleTimes: normalizeScheduleTimes(settings),
    backupDir: String(settings.backupDir || defaultMaintenanceSettings.backupDir).trim(),
    taskExportDir: String(settings.taskExportDir || defaultMaintenanceSettings.taskExportDir).trim(),
    gunLedgerExportDir: String(settings.gunLedgerExportDir || defaultMaintenanceSettings.gunLedgerExportDir).trim(),
    yearlyArchiveDir: String(settings.yearlyArchiveDir || defaultMaintenanceSettings.yearlyArchiveDir).trim(),
    offlineBackupDir: String(settings.offlineBackupDir || defaultMaintenanceSettings.offlineBackupDir).trim(),
    yearlyCleanupHistory: settings.yearlyCleanupHistory && typeof settings.yearlyCleanupHistory === 'object' && !Array.isArray(settings.yearlyCleanupHistory)
      ? settings.yearlyCleanupHistory
      : {}
  };
  // 历史字段 scheduleTime 已被 scheduleTimes 取代，避免旧值残留到持久化数据中
  delete normalized.scheduleTime;
  return normalized;
};

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
// 表格导出（.xls/.xlsx）、编号台账打包导出（.zip）与年度归档（.json）。加上白名单后，
// 即使某个目录被指向了混合内容的文件夹，也只会删除这些产物，不会误删无关文件。
const MANAGED_FILE_PATTERN = /\.(db|db-shm|db-wal|xlsx?|zip|json)$/i;

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
  const size = fs.statSync(filePath).size;
  // 备份只写入配置的本地备份目录（backups/database），不再复制到固定的网络共享地址。
  return { fileName, filePath, dir: backupDir, size };
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
  // 任务数据在 taskStore 关系表中，直接查询有内容的表
  const exportSheets = taskStore.listSheetsWithData();

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

// 焊枪编号台账导出：所有分类打包为一个 zip（每个分类一个独立 xls）
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

  const timestamp = toTimestamp();
  const buffer = gunExport.buildCategoriesZipBuffer(gunLedger, categories, timestamp);
  const fileName = `gun-ledger-all-${timestamp}.zip`;
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
  // 任务数据在 taskStore 关系表中：按年份查询待归档的表
  const archiveTasks = taskStore.listSheetsBeforeYear(cutoffYear);

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
  const archiveIds = archiveTasks.map(sheet => sheet.id);
  taskStore.deleteSheetsByIds(archiveIds);
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

  // 年度清理往往一次删掉几千条记录，同样需要压缩才能真正腾出磁盘
  let compaction = null;
  try {
    compaction = compactDatabase();
  } catch (e) {
    console.error('[maintenance] 年度清理后压缩数据库失败:', e.message);
  }

  return { skipped: false, cutoffYear, archivedSheets: archive.taskSheets, removedSheets: archive.taskSheets, removedTaskItems: archive.taskItems, archive, compaction };
};

// 计算下一次执行时刻：在配置的多个时间点中取最近的一个（不足两个时按实际数量计算）
const getNextRunAt = (scheduleTimes, fromDate = new Date()) => {
  const times = Array.isArray(scheduleTimes) && scheduleTimes.length > 0
    ? scheduleTimes
    : defaultMaintenanceSettings.scheduleTimes;
  return times.reduce((earliest, time) => {
    const [hours, minutes] = String(time).split(':').map(part => parseInt(part, 10));
    const candidate = new Date(fromDate);
    candidate.setHours(hours || 0, minutes || 0, 0, 0);
    if (candidate <= fromDate) candidate.setDate(candidate.getDate() + 1);
    return !earliest || candidate < earliest ? candidate : earliest;
  }, null);
};

const runScheduledMaintenance = async () => {
  if (schedulerRunning) return { skipped: true, reason: 'already-running' };
  schedulerRunning = true;
  const startedAt = new Date();
  const result = { startedAt: startedAt.toISOString(), backup: null, taskExport: null, gunLedgerExport: null, backupCleanup: null, yearlyCleanup: null, errors: [] };

  console.log(`[maintenance] 计划维护开始 (${formatLocalDateTime(startedAt)})`);
  try {
    const { settings } = getMaintenanceSettings();
    if (!settings.enabled) {
      result.skipped = true;
      result.reason = 'disabled';
      console.log('[maintenance] 维护总开关已关闭，本次计划执行跳过');
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
    console.log(`[maintenance] 计划维护结束 (${formatLocalDateTime(result.finishedAt)})${result.errors.length ? `，失败项: ${result.errors.join('; ')}` : ''}`);
  }
};

const scheduleNextRun = () => {
  const { settings } = getMaintenanceSettings();
  const nextRun = getNextRunAt(settings.scheduleTimes);
  const delay = Math.max(1000, nextRun.getTime() - Date.now());
  if (schedulerTimer) clearTimeout(schedulerTimer);
  schedulerTimer = setTimeout(async () => {
    await runScheduledMaintenance();
    const rescheduled = scheduleNextRun();
    console.log(`[maintenance] 已排定下次执行: ${formatLocalDateTime(rescheduled)}`);
  }, delay);
  lastSchedulerState = { ...(lastSchedulerState || {}), nextRunAt: nextRun.toISOString(), scheduleDate: toDateKey(nextRun) };
  return nextRun;
};

// 历史数据迁移：旧版本只存单值 scheduleTime，升级到「每天最多两个时间点」后
// 内存里 normalize 能兼容，但库里仍是旧字段，UI 保存前每次启动都会被当成单点计划。
// 这里在调度器启动时把旧字段一次性落库为 scheduleTimes（补齐默认第二个时间点）。
const migrateLegacyScheduleTime = async () => {
  const data = db.readDb();
  const raw = data.settings?.maintenance;
  if (!raw || typeof raw !== 'object') return null;
  const hasLegacyField = Object.prototype.hasOwnProperty.call(raw, 'scheduleTime');
  const lacksArray = !Array.isArray(raw.scheduleTimes) || raw.scheduleTimes.length === 0;
  if (!hasLegacyField && !lacksArray) return null;

  const normalized = normalizeMaintenanceSettings(raw);
  if (!data.settings) data.settings = {};
  data.settings.maintenance = normalized;
  await db.writeDb(data);
  console.log(`[maintenance] 已迁移维护计划配置: ${JSON.stringify(raw.scheduleTimes || raw.scheduleTime)} -> ${JSON.stringify(normalized.scheduleTimes)}`);
  return normalized;
};

const startMaintenanceScheduler = async () => {
  await migrateLegacyScheduleTime();
  const nextRun = scheduleNextRun();
  console.log(`[maintenance] scheduler started, next run at ${formatLocalDateTime(nextRun)}`);
};

// ---------------------------------------------------------------------------
// 磁盘回收：VACUUM + WAL 截断
//
// SQLite 的 DELETE 只是把页放进 freelist（空闲页链表），文件大小不会变小，
// WAL 也不会自动收缩。所以「清理任务数据」之后，任务记录已经清零，但数据文件
// 依旧占着原来的体积，数据管理页看到的磁盘占用毫无变化 —— 这是最常被误认为
// 「清理不干净」的现象。这里把页真正交还操作系统。
// ---------------------------------------------------------------------------
const compactDatabase = () => {
  const dbPath = getDbPath();
  const walPath = `${dbPath}-wal`;
  const measure = () => {
    const dbFileSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
    const walSize = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
    return { dbFileSize, walSize, totalDiskSize: dbFileSize + walSize };
  };

  const raw = db.getRawDb();

  let freelistBytesBefore = 0;
  try {
    const pageSize = Number(raw.pragma('page_size', { simple: true })) || 0;
    const freelistCount = Number(raw.pragma('freelist_count', { simple: true })) || 0;
    freelistBytesBefore = pageSize * freelistCount;
  } catch {
    freelistBytesBefore = 0;
  }

  const before = measure();

  // 孤儿条目（所属工作表已被删）不清理的话，VACUUM 会继续把它们保留下来
  let removedOrphans = 0;
  try {
    removedOrphans = taskStore.deleteOrphanEntries();
  } catch (e) {
    console.error('[maintenance] 清理孤儿任务条目失败:', e.message);
  }

  // VACUUM 不能运行在事务内，此处为单条同步调用，不包事务
  raw.pragma('wal_checkpoint(TRUNCATE)');
  raw.exec('VACUUM');
  raw.pragma('wal_checkpoint(TRUNCATE)');

  const after = measure();
  const freedBytes = Math.max(0, before.totalDiskSize - after.totalDiskSize);

  if (removedOrphans > 0 || freedBytes > 0) {
    console.log(`[maintenance] 数据库压缩完成：回收 ${(freedBytes / 1048576).toFixed(2)} MB，清理孤儿条目 ${removedOrphans} 条`);
  }

  return {
    before,
    after,
    freedBytes,
    freelistBytesBefore,
    removedOrphans
  };
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

  // tasks 集合的逻辑大小（任务条目 JSON 字节数）及任务统计（taskStore 关系表）
  const tasksJsonSize = taskStore.entriesJsonSize();
  const tasksCount = taskStore.countSheets();
  const taskItemsCount = taskStore.countEntries();

  // 空闲页体积：删除数据后仍留在文件里、需要 VACUUM 才能真正回收的部分。
  // 前端据此提示「可回收 xx MB」，避免把物理占用不变误读成没清干净。
  let freelistBytes = 0;
  try {
    const raw = db.getRawDb();
    const pageSize = Number(raw.pragma('page_size', { simple: true })) || 0;
    const freelistCount = Number(raw.pragma('freelist_count', { simple: true })) || 0;
    freelistBytes = pageSize * freelistCount;
  } catch {
    freelistBytes = 0;
  }

  const nextRunAtIso = lastSchedulerState?.nextRunAt || getNextRunAt(settings.scheduleTimes).toISOString();

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
      // 空闲页（已删除但未归还给操作系统的空间）与压缩后可回收的体积
      freelistBytes,
      reclaimableBytes: freelistBytes,
      tasksJsonSize,
      tasksCount,
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
      // 计划时间以服务器本地时区为准；这里同时给出本地字符串，避免前端/接口
      // 消费 ISO(UTC) 时被当成 UTC 时刻展示。
      timezone: getTimezoneLabel(),
      lastRun: lastSchedulerState,
      nextRunAt: nextRunAtIso,
      nextRunAtLocal: formatLocalDateTime(nextRunAtIso)
    }
  };
};

module.exports = {
  defaultMaintenanceSettings,
  normalizeMaintenanceSettings,
  formatLocalDateTime,
  getTimezoneLabel,
  getMaintenanceStatus,
  compactDatabase,
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
