const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

// ---------------------------------------------------------------------------
// 操作日志（auditLogs）独立表
//
// 原先 auditLogs 与业务数据一起塞在 kv_store 的单个 JSON 里，写一条日志要经过
// readDb()（整库深拷贝）+ writeDb()（8 个集合全量序列化后 UPSERT）；而审计中间件
// 在每个 API 请求结束时都会写一次，写放大极为严重（P1-3）。
// 改为独立表后，写日志只是一次 INSERT，不再触碰业务数据快照。
// ---------------------------------------------------------------------------
const AUDIT_LOG_MAX_ROWS = 2000;

const ensureAuditLogTable = () => {
  const database = openDatabase();
  database.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      userId TEXT,
      username TEXT,
      name TEXT,
      role TEXT,
      action TEXT,
      method TEXT,
      path TEXT,
      ip TEXT,
      userAgent TEXT,
      browserInfo TEXT,
      requestBody TEXT,
      responseStatus INTEGER,
      responseMessage TEXT,
      durationMs INTEGER
    );
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_audit_logs_ts ON audit_logs(timestamp)');
  return database;
};

const serializeAuditEntry = (entry = {}) => ({
  id: entry.id || crypto.randomUUID(),
  timestamp: entry.timestamp || new Date().toISOString(),
  userId: entry.userId ?? null,
  username: entry.username ?? null,
  name: entry.name ?? null,
  role: entry.role ?? null,
  action: entry.action ?? null,
  method: entry.method ?? null,
  path: entry.path ?? null,
  ip: entry.ip ?? null,
  userAgent: entry.userAgent ?? null,
  browserInfo: entry.browserInfo ? JSON.stringify(entry.browserInfo) : null,
  requestBody: entry.requestBody ?? null,
  responseStatus: Number.isFinite(Number(entry.responseStatus)) ? Number(entry.responseStatus) : null,
  responseMessage: entry.responseMessage ?? null,
  durationMs: Number.isFinite(Number(entry.durationMs)) ? Number(entry.durationMs) : null
});

const deserializeAuditRow = (row) => {
  if (!row) return row;
  let browserInfo = null;
  if (row.browserInfo) {
    try {
      browserInfo = JSON.parse(row.browserInfo);
    } catch (e) {
      browserInfo = null;
    }
  }
  return { ...row, browserInfo };
};

// 只保留最近 AUDIT_LOG_MAX_ROWS 条。
// 用 MAX(rowid) 定位而无须 COUNT(*)：rowid 单调递增，删除「小于等于 MAX-上限」的行
// 即等价于保留最后写入的 N 条。表内不足 N 条时差值为负，不会误删任何行；
// 未超限时该语句匹配 0 行，开销仅一次 rowid 末端查找，可忽略。
const trimAuditLogs = (database) => {
  database
    .prepare('DELETE FROM audit_logs WHERE rowid <= (SELECT MAX(rowid) FROM audit_logs) - ?')
    .run(AUDIT_LOG_MAX_ROWS);
};

const appendAuditLogEntry = (entry) => {
  const database = ensureAuditLogTable();
  database
    .prepare(`
      INSERT INTO audit_logs (id, timestamp, userId, username, name, role, action, method, path,
        ip, userAgent, browserInfo, requestBody, responseStatus, responseMessage, durationMs)
      VALUES (@id, @timestamp, @userId, @username, @name, @role, @action, @method, @path,
        @ip, @userAgent, @browserInfo, @requestBody, @responseStatus, @responseMessage, @durationMs)
    `)
    .run(serializeAuditEntry(entry));

  trimAuditLogs(database);
};

const listAuditLogs = () => {
  const database = ensureAuditLogTable();
  return database
    .prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC, rowid DESC')
    .all()
    .map(deserializeAuditRow);
};

const countAuditLogs = () => {
  const database = ensureAuditLogTable();
  return Number(database.prepare('SELECT COUNT(*) AS c FROM audit_logs').get().c);
};

const clearAuditLogs = () => {
  const database = ensureAuditLogTable();
  return Number(database.prepare('DELETE FROM audit_logs').run().changes);
};

// 首次切换到独立表时，把 kv_store 里遗留的 auditLogs 搬迁过来（幂等）
const migrateAuditLogsToTable = () => {
  const database = ensureAuditLogTable();
  if (countAuditLogs() > 0) return;

  const row = database.prepare("SELECT value FROM kv_store WHERE key = 'auditLogs'").get();
  if (!row) return;

  let legacy = [];
  try {
    legacy = JSON.parse(row.value);
  } catch (e) {
    return;
  }
  if (!Array.isArray(legacy) || legacy.length === 0) return;

  const insert = database
    .prepare(`
      INSERT OR IGNORE INTO audit_logs (id, timestamp, userId, username, name, role, action, method, path,
        ip, userAgent, browserInfo, requestBody, responseStatus, responseMessage, durationMs)
      VALUES (@id, @timestamp, @userId, @username, @name, @role, @action, @method, @path,
        @ip, @userAgent, @browserInfo, @requestBody, @responseStatus, @responseMessage, @durationMs)
    `);
  const tx = database.transaction((items) => {
    for (const item of items) insert.run(serializeAuditEntry(item));
  });
  tx(legacy);

  // 搬迁完成后从 kv_store 移除，避免整库写时再带上这份数据
  database.prepare("DELETE FROM kv_store WHERE key = 'auditLogs'").run();
  trimAuditLogs(database);
  console.log(`[db] 已迁移 ${legacy.length} 条历史操作日志到 audit_logs 独立表`);
};

// 将缓存中的所有顶层集合持久化到 kv_store（事务）
const persistCache = () => {
  if (!_cache) return;
  const db = openDatabase();
  const upsert = db.prepare(
    `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.value`
  );
  // 注意：auditLogs 已迁出至 audit_logs 独立表，不再随整库一起序列化写入
  const topLevelKeys = ['users', 'tasks', 'designers', 'loginLogs', 'settings', 'statusTrackingItems', 'gunLedger'];
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

// 焊枪名自动生成规则（台账初始化设置，超管可按表配置）
const normalizeGunNameRule = (rule) => {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return undefined;
  const start = Number(rule.start);
  const padRaw = Number(rule.pad);
  return {
    enabled: Boolean(rule.enabled),
    prefix: String(rule.prefix || '').slice(0, 20),
    start: Number.isFinite(start) ? Math.max(0, Math.trunc(start)) : 0,
    pad: Number.isFinite(padRaw) ? Math.min(10, Math.max(1, Math.trunc(padRaw))) : 4
  };
};

// 用户元信息（createdBy/updatedBy）只允许普通对象或 null；
// 历史数据中曾出现 "[Circular Reference]" 等字符串脏值，会导致接口 Joi 校验失败
const sanitizeUserMeta = (v) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  return null;
};

const normalizeTableList = (list) => {
  if (!Array.isArray(list)) return [];
  return list.map(t => {
    if (typeof t === 'string') return { id: `gun-tbl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name: t, rows: [] };
    if (!t || typeof t !== 'object') return null;
    const rows = Array.isArray(t.rows) ? t.rows.filter(r => r && typeof r === 'object').map(r => ({
      id: r.id || `gun-row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      serialNumber: Number.isFinite(Number(r.serialNumber)) ? Number(r.serialNumber) : 0,
      gunName: String(r.gunName || ''),
      customer: String(r.customer || ''),
      time: String(r.time || ''),
      responsiblePerson: String(r.responsiblePerson || ''),
      remarks: String(r.remarks || ''),
      createdAt: r.createdAt || '',
      createdBy: sanitizeUserMeta(r.createdBy),
      updatedAt: r.updatedAt || '',
      updatedBy: sanitizeUserMeta(r.updatedBy)
    })) : [];
    // 序号严格按自然顺序连续排列：按序号升序后重新编号为 1..N，杜绝跳号（如 1 直接到 11）
    rows.sort((a, b) => a.serialNumber - b.serialNumber);
    rows.forEach((r, i) => { r.serialNumber = i + 1; });
    const normalized = {
      id: t.id || `gun-tbl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: String(t.name || '未命名表'),
      rows
    };
    // 仅在显式配置过规则时携带该字段（未配置的表沿用前端内置默认规则）
    const gunNameRule = normalizeGunNameRule(t.gunNameRule);
    if (gunNameRule) normalized.gunNameRule = gunNameRule;
    return normalized;
  }).filter(Boolean);
};

// 检测台账中是否存在序号跳号/乱序（启动时决定是否需要落库修复）
const gunLedgerHasGaps = (gunLedger) => {
  if (!gunLedger || !gunLedger.categories) return false;
  for (const cat of Object.keys(gunLedger.categories)) {
    const list = Array.isArray(gunLedger.categories[cat]) ? gunLedger.categories[cat] : [];
    for (const t of list) {
      const rows = Array.isArray(t?.rows) ? t.rows : [];
      if (rows.some((r, i) => !r || Number(r.serialNumber) !== i + 1)) return true;
    }
  }
  return false;
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
    designStandardsLinkedKbIds: [],
    designStandardsPrompt: { enabled: false, knowledgeBases: {} },
    system: { allowMultiDevice: true, allowUserDesignPlanColorMark: true, allowUserEditOwnTaskColor: true, specNumberDigits: 5 }
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
  // 设计规范知识库：已关联的知识库 ID 列表
  if (!Array.isArray(parsed.settings.designStandardsLinkedKbIds)) {
    parsed.settings.designStandardsLinkedKbIds = [];
  }
  // 设计规范知识库的「答复约束提示词」配置（仅超级管理员可编辑）：
  //   { enabled: boolean, knowledgeBases: { [kbId]: { prompt, agentId, updatedAt } } }
  if (!parsed.settings.designStandardsPrompt || typeof parsed.settings.designStandardsPrompt !== 'object' || Array.isArray(parsed.settings.designStandardsPrompt)) {
    parsed.settings.designStandardsPrompt = { enabled: false, knowledgeBases: {} };
  }
  if (typeof parsed.settings.designStandardsPrompt.enabled !== 'boolean') {
    parsed.settings.designStandardsPrompt.enabled = false;
  }
  if (!parsed.settings.designStandardsPrompt.knowledgeBases
    || typeof parsed.settings.designStandardsPrompt.knowledgeBases !== 'object'
    || Array.isArray(parsed.settings.designStandardsPrompt.knowledgeBases)) {
    parsed.settings.designStandardsPrompt.knowledgeBases = {};
  }
  if (!parsed.settings.system) {
    parsed.settings.system = { allowMultiDevice: true, allowUserDesignPlanColorMark: true, allowUserEditOwnTaskColor: true, specNumberDigits: 5 };
  }
  // 访客查看功能已移除：清理存量数据中残留的 allowGuestView 键
  delete parsed.settings.system.allowGuestView;
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
  // auditLogs 已迁出至 audit_logs 独立表，此处不再回填该字段
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
  // 首次切到独立表时搬迁历史操作日志，并从 kv_store 中摘除该集合
  migrateAuditLogsToTable();
  const rows = _db.prepare('SELECT COUNT(*) as c FROM kv_store').get().c;
  let gunSerialNeedPersist = false;
  if (rows === 0) {
    migrateFromLegacyJsonIfNeeded();
  } else {
    _cache = loadFromDb();
    // 归一化前检测存量序号跳号/乱序（归一化会原地修复为连续序号）
    gunSerialNeedPersist = gunLedgerHasGaps(_cache.gunLedger);
    if (gunSerialNeedPersist) {
      console.log('[db] 检测到焊枪台账序号跳号，启动时自动修复为连续自然序号');
    }
    applySettingsDefaults(_cache);
    if (gunSerialNeedPersist) persistCache();
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
    // 不再提供公开固定兜底口令（admin123）：未显式配置时随机生成，
    // 仅在控制台输出一次，由部署人员记录后登录并立即改密
    const explicitPassword = process.env.DEFAULT_ADMIN_PASSWORD;
    const generatedPassword = !explicitPassword;
    const defaultPassword = explicitPassword || crypto.randomBytes(9).toString('base64url');
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
    if (generatedPassword) {
      console.log('================================================================');
      console.log(`[INIT] 初始超级管理员随机密码（仅显示一次）：${defaultPassword}`);
      console.log('[INIT] 请立即记录，登录后修改密码；关闭窗口后将无法再次查看。');
      console.log('================================================================');
    } else {
      console.log(`SuperAdmin account created: ${process.env.DEFAULT_ADMIN_USERNAME || 'superadmin'}`);
      console.log('[SECURITY] Please change the initial password immediately after logging in.');
    }
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
  init,
  // 操作日志独立表（避免每请求整库读写）
  appendAuditLogEntry,
  listAuditLogs,
  countAuditLogs,
  clearAuditLogs
};
