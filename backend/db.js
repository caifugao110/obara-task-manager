const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const securityConfig = require('./config/security');

const sqlitePath = path.resolve(__dirname, securityConfig.database.sqlitePath);

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
// 操作日志保留条数默认值。实际生效值取自「系统设置 → 日志管理」中的
// auditLogMaxRows 配置项；未配置或非法时回退该默认值。
const DEFAULT_AUDIT_LOG_MAX_ROWS = 5000;

// 读取当前配置的操作日志保留条数。
// _cache 尚未加载时（如启动阶段的日志迁移）回退默认值，保证始终可用。
const getAuditLogMaxRows = () => {
  const raw = _cache && _cache.settings && _cache.settings.system
    ? _cache.settings.system.auditLogMaxRows
    : undefined;
  const rows = Number(raw);
  if (!Number.isInteger(rows) || rows < 100 || rows > 100000) return DEFAULT_AUDIT_LOG_MAX_ROWS;
  return rows;
};

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

// 只保留最近 getAuditLogMaxRows() 条（默认 5000，可在系统设置中调整）。
// 用 MAX(rowid) 定位而无须 COUNT(*)：rowid 单调递增，删除「小于等于 MAX-上限」的行
// 即等价于保留最后写入的 N 条。表内不足 N 条时差值为负，不会误删任何行；
// 未超限时该语句匹配 0 行，开销仅一次 rowid 末端查找，可忽略。
const trimAuditLogs = (database) => {
  database
    .prepare('DELETE FROM audit_logs WHERE rowid <= (SELECT MAX(rowid) FROM audit_logs) - ?')
    .run(getAuditLogMaxRows());
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

// ---------------------------------------------------------------------------
// 登录日志（loginLogs）独立表
//
// 与 audit_logs 同样的写放大问题：登录日志原先塞在 kv_store 的整库 JSON 里，
// 每次登录/登录失败都触发整库深拷贝 + 全量 UPSERT。独立表后写日志只是一次 INSERT。
// ---------------------------------------------------------------------------
const LOGIN_LOG_MAX_ROWS = 2000;

const ensureLoginLogTable = () => {
  const database = openDatabase();
  database.exec(`
    CREATE TABLE IF NOT EXISTS login_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      userId TEXT,
      username TEXT,
      name TEXT,
      role TEXT,
      ip TEXT,
      userAgent TEXT,
      browserInfo TEXT,
      success INTEGER,
      reason TEXT,
      action TEXT,
      deviceIndex INTEGER
    );
  `);
  // 旧表迁移：补充多设备登录序号列
  const loginLogColumns = database.prepare('PRAGMA table_info(login_logs)').all();
  if (!loginLogColumns.some(col => col.name === 'deviceIndex')) {
    database.exec('ALTER TABLE login_logs ADD COLUMN deviceIndex INTEGER');
  }
  database.exec('CREATE INDEX IF NOT EXISTS idx_login_logs_ts ON login_logs(timestamp)');
  return database;
};

const serializeLoginEntry = (entry = {}) => ({
  id: entry.id || crypto.randomUUID(),
  timestamp: entry.timestamp || new Date().toISOString(),
  userId: entry.userId ?? null,
  username: entry.username ?? null,
  name: entry.name ?? null,
  role: entry.role ?? null,
  ip: entry.ip ?? null,
  userAgent: entry.userAgent ?? null,
  browserInfo: entry.browserInfo ? JSON.stringify(entry.browserInfo) : null,
  success: entry.success === undefined || entry.success === null ? null : (entry.success ? 1 : 0),
  reason: entry.reason ?? null,
  action: entry.action ?? null,
  deviceIndex: entry.deviceIndex ?? null
});

const deserializeLoginRow = (row) => {
  if (!row) return row;
  let browserInfo = null;
  if (row.browserInfo) {
    try {
      browserInfo = JSON.parse(row.browserInfo);
    } catch (e) {
      browserInfo = null;
    }
  }
  return { ...row, browserInfo, success: row.success === null ? null : Boolean(row.success) };
};

const trimLoginLogs = (database) => {
  database
    .prepare('DELETE FROM login_logs WHERE rowid <= (SELECT MAX(rowid) FROM login_logs) - ?')
    .run(LOGIN_LOG_MAX_ROWS);
};

const appendLoginLogEntry = (entry) => {
  const database = ensureLoginLogTable();
  database
    .prepare(`
      INSERT INTO login_logs (id, timestamp, userId, username, name, role, ip, userAgent, browserInfo, success, reason, action, deviceIndex)
      VALUES (@id, @timestamp, @userId, @username, @name, @role, @ip, @userAgent, @browserInfo, @success, @reason, @action, @deviceIndex)
    `)
    .run(serializeLoginEntry(entry));
  trimLoginLogs(database);
};

const listLoginLogs = () => {
  const database = ensureLoginLogTable();
  return database
    .prepare('SELECT * FROM login_logs ORDER BY timestamp DESC, rowid DESC')
    .all()
    .map(deserializeLoginRow);
};

// 查询指定用户最近一次成功登录的时间（ISO 字符串），无记录时返回 null。
// 用于「上次登录时间」展示的历史数据兜底：用户字段缺失时可回落到登录日志表。
const getLastSuccessfulLoginAt = (userId) => {
  if (!userId) return null;
  const database = ensureLoginLogTable();
  const row = database
    .prepare('SELECT timestamp FROM login_logs WHERE userId = ? AND success = 1 ORDER BY timestamp DESC, rowid DESC LIMIT 1')
    .get(userId);
  return row?.timestamp || null;
};

const countLoginLogs = () => {
  const database = ensureLoginLogTable();
  return Number(database.prepare('SELECT COUNT(*) AS c FROM login_logs').get().c);
};

const clearLoginLogs = () => {
  const database = ensureLoginLogTable();
  return Number(database.prepare('DELETE FROM login_logs').run().changes);
};

// 将缓存中的顶层集合持久化到 kv_store（事务）。
// 脏检查：每个集合序列化后与上次落库内容比较，仅 UPSERT 真正变化的集合，
// 避免一次小改动引发全部集合的磁盘写入与 WAL 膨胀。
// 注意：tasks（taskStore 关系表）、auditLogs / loginLogs（独立表）均已迁出 kv_store。
let _lastPersistedJson = {};

const persistCache = () => {
  if (!_cache) return;
  const db = openDatabase();
  const upsert = db.prepare(
    `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.value`
  );
  const topLevelKeys = ['users', 'designers', 'settings', 'statusTrackingItems', 'gunLedger'];
  const tx = db.transaction(() => {
    for (const key of topLevelKeys) {
      if (Object.prototype.hasOwnProperty.call(_cache, key)) {
        const serialized = safeJsonStringify(_cache[key]);
        if (_lastPersistedJson[key] === serialized) continue;
        upsert.run(key, serialized);
        _lastPersistedJson[key] = serialized;
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
  _lastPersistedJson = {};
  for (const row of rows) {
    try {
      data[row.key] = JSON.parse(row.value);
      _lastPersistedJson[row.key] = row.value;
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
      'X2C-V3': tables(['C', 'X'], 200),
      'GLOBAL': tables(['RBC'], 250),
      'PSW': tables(['UC', 'UX', 'UCR', 'UXR', 'NOC', 'NOX'], 400),
      'IT': tables(['PTC', 'PTX', 'PTC-ALC', 'PTX-ALC'], 500),
      'ROBOT': tables(['RTC', 'RTX', 'RC', 'RX'], 600),
      'EQ': tables(['PE1', 'PE2', 'R', 'RR', 'SEN', 'SEU', 'SET', 'STUD'], 700),
      'TOYOTA': tables(
        ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09', 'C10',
         'X01', 'X02', 'X03', 'X04', 'X05', 'X06', 'X07', 'X08', 'X09', 'X10', 'X11', 'X12'],
        300
      )
    },
    defaultResponsiblePersons: ['张啸', '张明', '陈青松', '陈大仪', '翟世学', '朱海洋']
  };
};

const DEFAULT_CATEGORIES = ['X2C', 'X2C-V2', 'X2C-V3', 'GLOBAL', 'PSW', 'IT', 'ROBOT', 'EQ', 'TOYOTA'];

// 各默认分类的内置默认表名顺序（供「恢复默认排序」使用；分类间顺序与 DEFAULT_CATEGORIES 一致）
const DEFAULT_GUN_TABLES = (() => {
  const base = buildDefaultGunLedger();
  const map = {};
  for (const cat of Object.keys(base.categories)) {
    map[cat] = base.categories[cat].map(t => t.name);
  }
  return map;
})();

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
  // 保留所有已有分类（含用户新增），并确保默认分类存在；
  // 存量数据中缺失的默认分类（如新增的 TOYOTA）自动播种其默认表结构
  const merged = {};
  // 先放入默认分类，保证顺序
  for (const cat of DEFAULT_CATEGORIES) {
    merged[cat] = Object.prototype.hasOwnProperty.call(categories, cat)
      ? normalizeTableList(categories[cat])
      : normalizeTableList(base.categories[cat]);
  }
  // 再放入用户新增的分类（非默认分类）
  for (const cat of Object.keys(categories)) {
    if (!DEFAULT_CATEGORIES.includes(cat)) {
      merged[cat] = normalizeTableList(categories[cat]);
    }
  }
  // 兼容迁移：存量名单若仍为旧版默认值（未做过自定义），自动升级为新默认名单；
  // 已自定义过的名单保持原样
  const OLD_DEFAULT_RESPONSIBLE_PERSONS = ['张啸', '张明', '陈青松', '陈大仪'];
  const storedPersons = Array.isArray(gunLedger.defaultResponsiblePersons) && gunLedger.defaultResponsiblePersons.length
    ? gunLedger.defaultResponsiblePersons.map(p => String(p)).filter(Boolean)
    : base.defaultResponsiblePersons;
  const isLegacyDefault = storedPersons.length === OLD_DEFAULT_RESPONSIBLE_PERSONS.length
    && OLD_DEFAULT_RESPONSIBLE_PERSONS.every((p, i) => storedPersons[i] === p);
  const defaultResponsiblePersons = isLegacyDefault ? base.defaultResponsiblePersons : storedPersons;
  return { categories: merged, defaultResponsiblePersons };
};

const getInitialDb = () => ({
  users: [],
  designers: [],
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
      scheduleTimes: ['00:30', '12:30'],
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
    system: { allowMultiDevice: true, allowUserDesignPlanColorMark: true, allowUserEditOwnTaskColor: true, allowUserChangePassword: false, specNumberDigits: 5 }
  }
});

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
    parsed.settings.system = { allowMultiDevice: true, allowUserDesignPlanColorMark: true, allowUserEditOwnTaskColor: true, allowUserChangePassword: false, specNumberDigits: 5, auditLogMaxRows: DEFAULT_AUDIT_LOG_MAX_ROWS };
  }
  // IP 黑名单：{ enabled: boolean, entries: [{ id, ip, note, createdAt, createdBy }] }
  if (!parsed.settings.ipBlacklist || typeof parsed.settings.ipBlacklist !== 'object' || Array.isArray(parsed.settings.ipBlacklist)) {
    parsed.settings.ipBlacklist = { enabled: false, entries: [] };
  }
  if (typeof parsed.settings.ipBlacklist.enabled !== 'boolean') {
    parsed.settings.ipBlacklist.enabled = false;
  }
  if (!Array.isArray(parsed.settings.ipBlacklist.entries)) {
    parsed.settings.ipBlacklist.entries = [];
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
  // 操作日志保留条数：缺失/非法时回填默认值（前端「系统设置 → 日志管理」可调整）
  const auditLogMaxRows = Number(parsed.settings.system.auditLogMaxRows);
  if (!Number.isInteger(auditLogMaxRows) || auditLogMaxRows < 100 || auditLogMaxRows > 100000) {
    parsed.settings.system.auditLogMaxRows = DEFAULT_AUDIT_LOG_MAX_ROWS;
  }
  if (!parsed.statusTrackingItems) parsed.statusTrackingItems = [];
  // auditLogs / loginLogs 存放于独立表，tasks 存放于 taskStore 关系表，此处不再回填
  parsed.gunLedger = normalizeGunLedger(parsed.gunLedger);
};

// 初始化：打开数据库、加载缓存
const init = () => {
  if (_cache) return;
  openDatabase();
  const rows = _db.prepare('SELECT COUNT(*) as c FROM kv_store').get().c;
  let gunSerialNeedPersist = false;
  if (rows === 0) {
    _cache = getInitialDb();
    persistCache();
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
  // tasks 由 taskStore 关系表承载，不进入内存缓存，
  // readDb 的整库深拷贝与 persistCache 都不包含任务数据
  if (_cache.tasks !== undefined) {
    delete _cache.tasks;
    delete _lastPersistedJson.tasks;
  }
};

const readDb = () => {
  if (!_cache) init();
  return deepClone(_cache);
};

// ---------------------------------------------------------------------------
// 窄读接口
//
// readDb() 会 structuredClone 整个缓存（users + designers + settings +
// statusTrackingItems + gunLedger）。而鉴权中间件、Socket 鉴权、会话校验等
// 高频只读路径往往只需要 users 或 settings 其中之一，且每个请求会被调用
// 多次（authMiddleware 一次、hasAccessSettings 一次、路由处理器再一次）。
// 台账数据（gunLedger）体积最大，每次请求全量克隆数 MB 纯属浪费。
// 这些接口只克隆需要的那一个集合，语义与 readDb() 一致（返回克隆，
// 调用方可安全读写而不污染 _cache）；需要改库时仍应使用 readDb()。
// ---------------------------------------------------------------------------
const readSettings = () => {
  if (!_cache) init();
  return deepClone(_cache.settings || {});
};

// 焊枪台账（体积最大的集合）：只在确需读取台账的接口里克隆这一份
const readGunLedger = () => {
  if (!_cache) init();
  return deepClone(_cache.gunLedger || {});
};

// 设计人员列表：名称映射类场景（如枪名归属回显）只需这一份
const readDesigners = () => {
  if (!_cache) init();
  return deepClone(_cache.designers || []);
};

// 按 id 取单个用户（克隆）：鉴权热路径只关心一条记录，连整个 users 数组都不必克隆
const findUserById = (id) => {
  if (!_cache) init();
  const user = (_cache.users || []).find(u => u.id === id);
  return user ? deepClone(user) : undefined;
};

const processQueue = () => {
  if (isWriting || writeQueue.length === 0) return;
  isWriting = true;
  const { data, resolve, reject } = writeQueue.shift();
  try {
    // 写入前再补齐一次默认配置，保证落库数据结构正确
    applySettingsDefaults(data);
    _cache = data;
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
      // 用 UUID 而非 Date.now()：与 users 路由保持一致的 id 生成方式
      id: crypto.randomUUID(),
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
  // 只读场景优先使用窄读接口，避免每个请求多次全库深拷贝
  readSettings,
  readGunLedger,
  readDesigners,
  findUserById,
  writeDb,
  initAdmin,
  getRawDb,
  getDbPath,
  init,
  // 台账默认结构（供「恢复默认排序」等使用）
  getDefaultGunCategories: () => [...DEFAULT_CATEGORIES],
  getDefaultGunTables: (category) => (DEFAULT_GUN_TABLES[category] ? [...DEFAULT_GUN_TABLES[category]] : undefined),
  // 操作日志独立表（避免每请求整库读写）
  appendAuditLogEntry,
  listAuditLogs,
  countAuditLogs,
  clearAuditLogs,
  // 登录日志独立表
  appendLoginLogEntry,
  listLoginLogs,
  getLastSuccessfulLoginAt,
  countLoginLogs,
  clearLoginLogs
};
