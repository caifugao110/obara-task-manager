const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const securityConfig = require('./config/security');

const sqlitePath = path.resolve(__dirname, securityConfig.database.sqlitePath);
const legacyJsonPath = path.resolve(__dirname, securityConfig.database.legacyJsonPath);

// 内存中的数据缓存，所有 readDb 从这里返回克隆，避免每次请求访问磁盘
let _cache = null;

// SQLite 实例（better-sqlite3 同步 API）
let _db = null;

// 写入串行化队列（与原实现保持一致，保证写操作顺序）
let isWriting = false;
const writeQueue = [];

const safeJsonStringify = (data) => {
  const seen = new WeakSet();
  return JSON.stringify(data, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular Reference]';
      }
      seen.add(value);
    }
    return value;
  });
};

// 深拷贝（Node 17+ 原生 structuredClone，数据中无函数/BigInt 等不支持类型）
const deepClone = (obj) => {
  if (obj === null || typeof obj !== 'object') return obj;
  try {
    return structuredClone(obj);
  } catch (e) {
    // 回退到 JSON 方式
    return JSON.parse(JSON.stringify(obj));
  }
};

const openDatabase = () => {
  if (_db) return _db;
  _db = new Database(sqlitePath);
  // WAL 模式：并发读 + 单写，性能远好于默认 DELETE 模式
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');
  // 外键与外键一致性（KV 存储下暂不强制，保留默认）
  _db.exec(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return _db;
};

// 将缓存中的所有顶层集合持久化到 kv_store（事务）
const persistCache = () => {
  if (!_cache) return;
  const db = openDatabase();
  const upsert = db.prepare(
    `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.value`
  );
  const topLevelKeys = ['users', 'tasks', 'designers', 'loginLogs', 'settings', 'statusTrackingItems', 'auditLogs', 'gunLedger'];
  const tx = db.transaction(() => {
    for (const key of topLevelKeys) {
      if (Object.prototype.hasOwnProperty.call(_cache, key)) {
        upsert.run(key, safeJsonStringify(_cache[key]));
      }
    }
  });
  tx();
};

// 从 kv_store 加载所有数据到缓存
const loadFromDb = () => {
  const db = openDatabase();
  const rows = db.prepare('SELECT key, value FROM kv_store').all();
  const data = {};
  for (const row of rows) {
    try {
      data[row.key] = JSON.parse(row.value);
    } catch (e) {
      console.error(`[db] Failed to parse key ${row.key}:`, e.message);
      data[row.key] = row.key === 'settings' ? {} : [];
    }
  }
  return data;
};

const buildDefaultGunTable = (name) => ({
  id: `gun-tbl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  name,
  rows: []
});

const buildDefaultGunLedger = () => {
  const now = Date.now().toString(36);
  const makeId = (i) => `gun-tbl-${now}-${i}-${Math.random().toString(36).slice(2, 6)}`;
  const tables = (names, offset) => names.map((n, i) => ({ id: makeId(offset + i), name: n, rows: [] }));
  return {
    categories: {
      'X2C': tables(['SRTC', 'SRTX', 'SRTV', 'SRTC-ALA-DC', 'SRTX-ALA-DC', 'SRTD', 'SRTS'], 0),
      'X2C-V2': tables(['C', 'X'], 100),
      'X2C-V3': tables(['C', 'X'], 200)
    },
    defaultResponsiblePersons: ['张啸', '张明', '陈青松', '陈大仪']
  };
};

const DEFAULT_CATEGORIES = ['X2C', 'X2C-V2', 'X2C-V3'];

const normalizeTableList = (list) => {
  if (!Array.isArray(list)) return [];
  return list.map(t => {
    if (typeof t === 'string') return { id: `gun-tbl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name: t, rows: [] };
    if (!t || typeof t !== 'object') return null;
    return {
      id: t.id || `gun-tbl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: String(t.name || '未命名表'),
      rows: Array.isArray(t.rows) ? t.rows.filter(r => r && typeof r === 'object').map(r => ({
        id: r.id || `gun-row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        serialNumber: Number.isFinite(Number(r.serialNumber)) ? Number(r.serialNumber) : 0,
        gunName: String(r.gunName || ''),
        customer: String(r.customer || ''),
        time: String(r.time || ''),
        responsiblePerson: String(r.responsiblePerson || ''),
        remarks: String(r.remarks || ''),
        createdAt: r.createdAt || '',
        createdBy: r.createdBy || null,
        updatedAt: r.updatedAt || '',
        updatedBy: r.updatedBy || null
      })) : []
    };
  }).filter(Boolean);
};

const normalizeGunLedger = (gunLedger) => {
  const base = buildDefaultGunLedger();
  if (!gunLedger || typeof gunLedger !== 'object' || Array.isArray(gunLedger)) {
    return base;
  }
  const categories = gunLedger.categories && typeof gunLedger.categories === 'object' && !Array.isArray(gunLedger.categories)
    ? gunLedger.categories
    : {};
  // 保留所有已有分类（含用户新增），并确保三个默认分类存在
  const merged = {};
  // 先放入默认分类，保证顺序
  for (const cat of DEFAULT_CATEGORIES) {
    merged[cat] = normalizeTableList(categories[cat]);
  }
  // 再放入用户新增的分类（非默认分类）
  for (const cat of Object.keys(categories)) {
    if (!DEFAULT_CATEGORIES.includes(cat)) {
      merged[cat] = normalizeTableList(categories[cat]);
    }
  }
  const defaultResponsiblePersons = Array.isArray(gunLedger.defaultResponsiblePersons) && gunLedger.defaultResponsiblePersons.length
    ? gunLedger.defaultResponsiblePersons.map(p => String(p)).filter(Boolean)
    : base.defaultResponsiblePersons;
  return { categories: merged, defaultResponsiblePersons };
};

const getInitialDb = () => ({
  users: [],
  tasks: [],
  designers: [],
  loginLogs: [],
  statusTrackingItems: [],
  auditLogs: [],
  gunLedger: buildDefaultGunLedger(),
  settings: {
    leaderboard: { enabled: true, allowAdmins: true, allowViewers: false },
    workHours: { enabled: true, allowAdmins: true, allowViewers: false },
    statusTracking: { enabled: true, allowAdmins: true, allowViewers: false },
    systemSettings: { enabled: true, allowAdmins: true, allowViewers: false },
    gunLedger: { enabled: true, allowAdmins: true, allowViewers: false },
    maintenance: {
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
    },
    workdayOverrides: {},
    system: { allowGuestView: true, allowMultiDevice: true, allowUserDesignPlanColorMark: true, allowUserEditOwnTaskColor: true, specNumberDigits: 5 }
  }
});

const migrateTasksIfNeeded = (db) => {
  const tasks = Array.isArray(db.tasks) ? db.tasks : [];
  const hasOld = tasks.some(t => t && typeof t === 'object' && t.hours && !t.days);
  if (!hasOld) return { migrated: false, db };

  const sheetMap = new Map();

  for (const t of tasks) {
    if (!t || typeof t !== 'object') continue;

    if (t.days && typeof t.days === 'object') {
      const key = `${t.userId}::${t.year}::${t.month}`;
      const normalized = {
        id: t.id || `sheet-${t.userId}-${t.year}-${t.month}`,
        userId: t.userId,
        month: t.month,
        year: t.year,
        days: t.days && typeof t.days === 'object' ? t.days : {}
      };
      sheetMap.set(key, normalized);
      continue;
    }

    if (!t.userId || !t.month || !t.year || !t.hours || typeof t.hours !== 'object') continue;

    const key = `${t.userId}::${t.year}::${t.month}`;
    const sheet = sheetMap.get(key) || {
      id: `sheet-${t.userId}-${t.year}-${t.month}`,
      userId: t.userId,
      month: t.month,
      year: t.year,
      days: {}
    };

    for (const [date, rawHours] of Object.entries(t.hours)) {
      if (!sheet.days[date]) sheet.days[date] = [];
      const hours = typeof rawHours === 'number' ? rawHours : (parseFloat(rawHours) || 0);
      sheet.days[date].push({
        id: `${t.id || 'task'}-${date}`,
        taskName: t.taskName || '',
        hours
      });
    }

    sheetMap.set(key, sheet);
  }

  const migratedDb = { ...db, tasks: Array.from(sheetMap.values()) };
  return { migrated: true, db: migratedDb };
};

const normalizeSheetDatesIfNeeded = (db) => {
  const tasks = Array.isArray(db.tasks) ? db.tasks : [];
  let changed = false;

  const normalizedTasks = tasks.map(t => {
    if (!t || typeof t !== 'object' || !t.days || typeof t.days !== 'object') return t;

    const nextDays = {};
    for (const [rawDate, items] of Object.entries(t.days)) {
      const date = typeof rawDate === 'string' && rawDate.length >= 10 ? rawDate.slice(0, 10) : rawDate;
      if (date !== rawDate) changed = true;

      const arr = Array.isArray(items) ? items : [];
      if (!nextDays[date]) nextDays[date] = [];
      nextDays[date] = nextDays[date].concat(arr);
    }

    return { ...t, days: nextDays };
  });

  return { changed, db: changed ? { ...db, tasks: normalizedTasks } : db };
};

const applySettingsDefaults = (parsed) => {
  if (!parsed.designers) parsed.designers = [];
  if (!parsed.settings) parsed.settings = {};
  if (!parsed.settings.leaderboard) parsed.settings.leaderboard = { enabled: true, allowAdmins: true, allowViewers: false };
  if (!parsed.settings.workHours) {
    parsed.settings.workHours = parsed.settings.leaderboard
      ? { ...parsed.settings.leaderboard }
      : { enabled: true, allowAdmins: true, allowViewers: false };
  }
  if (!parsed.settings.statusTracking) {
    parsed.settings.statusTracking = parsed.settings.workHours
      ? { ...parsed.settings.workHours }
      : { enabled: true, allowAdmins: true, allowViewers: false };
  }
  if (!parsed.settings.systemSettings) {
    parsed.settings.systemSettings = { enabled: true, allowAdmins: true, allowViewers: false };
  }
  if (!parsed.settings.gunLedger) {
    parsed.settings.gunLedger = { enabled: true, allowAdmins: true, allowViewers: false };
  }
  if (!parsed.settings.maintenance || typeof parsed.settings.maintenance !== 'object' || Array.isArray(parsed.settings.maintenance)) {
    parsed.settings.maintenance = {};
  }
  parsed.settings.maintenance = {
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
    yearlyCleanupHistory: {},
    ...parsed.settings.maintenance
  };
  if (!parsed.settings.workdayOverrides || typeof parsed.settings.workdayOverrides !== 'object' || Array.isArray(parsed.settings.workdayOverrides)) {
    parsed.settings.workdayOverrides = {};
  }
  if (!parsed.settings.system) {
    parsed.settings.system = { allowGuestView: true, allowMultiDevice: true, allowUserDesignPlanColorMark: true, allowUserEditOwnTaskColor: true, specNumberDigits: 5 };
  }
  const hasDesignPlanColorMark = Object.prototype.hasOwnProperty.call(parsed.settings.system, 'allowUserDesignPlanColorMark');
  const hasEditOwnTaskColor = Object.prototype.hasOwnProperty.call(parsed.settings.system, 'allowUserEditOwnTaskColor');
  const allowOwnDesignPlanColor = hasDesignPlanColorMark || hasEditOwnTaskColor
    ? Boolean(parsed.settings.system.allowUserDesignPlanColorMark || parsed.settings.system.allowUserEditOwnTaskColor)
    : true;
  parsed.settings.system.allowUserDesignPlanColorMark = allowOwnDesignPlanColor;
  parsed.settings.system.allowUserEditOwnTaskColor = allowOwnDesignPlanColor;
  if (![5, 6].includes(parsed.settings.system.specNumberDigits)) {
    parsed.settings.system.specNumberDigits = 5;
  }
  if (!parsed.loginLogs) parsed.loginLogs = [];
  if (!parsed.statusTrackingItems) parsed.statusTrackingItems = [];
  if (!parsed.auditLogs) parsed.auditLogs = [];
  parsed.gunLedger = normalizeGunLedger(parsed.gunLedger);

  let migratedUsers = false;
  parsed.users.forEach(u => {
    if (u.forcePasswordChange === undefined) {
      u.forcePasswordChange = false;
      migratedUsers = true;
    }
  });

  return { migratedUsers };
};

// 从遗留 db.json 迁移到 SQLite（幂等：仅当 kv_store 为空时执行）
const migrateFromLegacyJsonIfNeeded = () => {
  const db = openDatabase();
  const count = db.prepare('SELECT COUNT(*) as c FROM kv_store').get().c;
  if (count > 0) return { migrated: false };

  if (!fs.existsSync(legacyJsonPath)) {
    console.log('[db] 未找到遗留 db.json，使用空数据库初始化');
    _cache = getInitialDb();
    persistCache();
    return { migrated: false };
  }

  try {
    console.log(`[db] 检测到遗留 ${legacyJsonPath}，开始迁移到 SQLite...`);
    const data = JSON.parse(fs.readFileSync(legacyJsonPath, 'utf8'));
    // 补齐默认字段
    applySettingsDefaults(data);
    const migratedRes = migrateTasksIfNeeded(data);
    const normalizedRes = normalizeSheetDatesIfNeeded(migratedRes.db);
    _cache = normalizedRes.db;
    persistCache();
    const stat = fs.statSync(legacyJsonPath);
    console.log(`[db] 迁移完成：${Object.keys(_cache).length} 个集合，源文件 ${(stat.size / 1024).toFixed(1)} KB`);
    // 迁移后将原 db.json 重命名为备份，避免重复迁移
    const backupPath = `${legacyJsonPath}.migrated-${Date.now()}.bak`;
    fs.renameSync(legacyJsonPath, backupPath);
    console.log(`[db] 原 db.json 已备份为 ${path.basename(backupPath)}`);
    return { migrated: true };
  } catch (err) {
    console.error('[db] 从遗留 JSON 迁移失败:', err.message);
    _cache = getInitialDb();
    persistCache();
    return { migrated: false, error: err.message };
  }
};

// 初始化：打开数据库、加载缓存、必要时迁移
const init = () => {
  if (_cache) return;
  openDatabase();
  const rows = _db.prepare('SELECT COUNT(*) as c FROM kv_store').get().c;
  if (rows === 0) {
    migrateFromLegacyJsonIfNeeded();
  } else {
    _cache = loadFromDb();
    applySettingsDefaults(_cache);
  }
  // 启动时执行一次迁移归一化并持久化
  const migratedRes = migrateTasksIfNeeded(_cache);
  const normalizedRes = normalizeSheetDatesIfNeeded(migratedRes.db);
  if (migratedRes.migrated || normalizedRes.changed) {
    _cache = normalizedRes.db;
    persistCache();
  }
};

const readDb = () => {
  if (!_cache) init();
  return deepClone(_cache);
};

const processQueue = () => {
  if (isWriting || writeQueue.length === 0) return;
  isWriting = true;
  const { data, resolve, reject } = writeQueue.shift();
  try {
    // 写入前再做一次归一化，保证落库数据结构正确
    applySettingsDefaults(data);
    const migratedRes = migrateTasksIfNeeded(data);
    const normalizedRes = normalizeSheetDatesIfNeeded(migratedRes.db);
    _cache = normalizedRes.db;
    persistCache();
    resolve();
  } catch (err) {
    console.error('Error writing database:', err);
    reject(err);
  } finally {
    isWriting = false;
    processQueue();
  }
};

const writeDb = (data) => {
  return new Promise((resolve, reject) => {
    writeQueue.push({ data, resolve, reject });
    processQueue();
  });
};

const initAdmin = async () => {
  if (!_cache) init();
  const superAdminExists = _cache.users.find(u => u.username === 'superadmin');
  if (!superAdminExists) {
    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
    const hashedPassword = bcrypt.hashSync(defaultPassword, 10);
    _cache.users.push({
      id: Date.now().toString(),
      username: process.env.DEFAULT_ADMIN_USERNAME || 'superadmin',
      password: hashedPassword,
      role: 'superadmin',
      name: '超级管理员',
      disabled: false,
      forcePasswordChange: true
    });
    await writeDb(_cache);
    console.log(`SuperAdmin account created: ${process.env.DEFAULT_ADMIN_USERNAME || 'superadmin'} / ${defaultPassword}`);
    console.log('[SECURITY] Default admin password is set. Please change it immediately after logging in.');
  }
};

// 暴露 SQLite 实例（供备份等维护操作使用）
const getRawDb = () => {
  if (!_db) openDatabase();
  return _db;
};

// 暴露 SQLite 文件路径
const getDbPath = () => sqlitePath;

module.exports = {
  readDb,
  writeDb,
  initAdmin,
  getRawDb,
  getDbPath,
  init
};
