'use strict';
/**
 * 系统设置（settings）的按键行存储
 *
 * 为什么迁：settings 不是数组，而是「14 个顶层键」的对象（leaderboard / workHours /
 * systemSettings / maintenance / ipBlacklist / workdayOverrides / system …）。
 * 原先改任意一个开关（比如关掉某个页面的访问权限）都要把整份 6 KB JSON 重写，
 * 而系统设置页一次保存往往会连着改几个键。按**顶层键**存成行后，一次保存只写真正变化的几行。
 *
 * 为什么按「顶层键」而不是拆得更细：设置项的读取方（各路由、鉴权中间件）都是整块拿
 * `settings.workHours` 这种粒度来用的，拆到字段级会让读写两边都得重新拼装，
 * 收益（每次省几 KB）远小于改错的风险。
 *
 * 顺序：用 position 列保留原始键顺序，保证 load 出来的对象与迁移前一致，
 * 便于用「JSON 全等」直接验收迁移结果。
 */

const fs = require('fs');
const path = require('path');

const ROW_TABLE = 'settings_entries';
const KV_KEY = 'settings';

/** 上次落库的内容（key -> 序列化），用于按键脏检查 */
let _lastRows = new Map();

const safeJson = (value) => {
  try {
    return JSON.stringify(value);
  } catch (err) {
    console.error('[settings] 序列化失败：', err.message);
    return 'null';
  }
};

const ensureTable = (database) => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ${ROW_TABLE} (
      key TEXT PRIMARY KEY,
      position INTEGER NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
};

const countRows = (database) => {
  ensureTable(database);
  return Number(database.prepare(`SELECT COUNT(*) AS c FROM ${ROW_TABLE}`).get().c);
};

const isEmpty = (database) => countRows(database) === 0;

/** 按键的 position 还原成对象；空表返回 null */
const load = (database) => {
  ensureTable(database);
  const rows = database.prepare(`SELECT key, payload FROM ${ROW_TABLE} ORDER BY position`).all();
  if (rows.length === 0) return null;

  const settings = {};
  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.payload);
    } catch (err) {
      console.error(`[settings] 键 ${row.key} 解析失败，已跳过：`, err.message);
    }
  }
  _lastRows = new Map(rows.map(row => [row.key, row.payload]));
  return settings;
};

/**
 * 落库（按键脏检查）。必须在调用方事务里执行。
 * @returns {{written:number, deleted:number, unchanged:number}}
 */
const persist = (database, settings) => {
  ensureTable(database);
  const source = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};

  const keys = Object.keys(source);
  const nextRows = new Map();
  keys.forEach((key, index) => {
    nextRows.set(key, { position: index, json: safeJson(source[key]) });
  });

  const upsert = database.prepare(
    `INSERT INTO ${ROW_TABLE} (key, position, payload, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       position = excluded.position,
       payload = excluded.payload,
       updated_at = excluded.updated_at`
  );
  const remove = database.prepare(`DELETE FROM ${ROW_TABLE} WHERE key = ?`);

  let written = 0;
  let unchanged = 0;
  let deleted = 0;

  for (const [key, row] of nextRows) {
    if (_lastRows.get(key) === row.json) {
      unchanged += 1;
      continue;
    }
    upsert.run(key, row.position, row.json);
    _lastRows.set(key, row.json);
    written += 1;
  }
  for (const key of [..._lastRows.keys()]) {
    if (nextRows.has(key)) continue;
    remove.run(key);
    _lastRows.delete(key);
    deleted += 1;
  }

  return { written, deleted, unchanged };
};

const backupLegacy = (legacySettings, dirOverride) => {
  try {
    const dir = dirOverride || path.resolve(__dirname, 'backups', 'database');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `${KV_KEY}-before-migration-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(legacySettings, null, 2), 'utf8');
    return file;
  } catch (err) {
    console.error('[settings] 迁移前的 JSON 备份失败（继续迁移）：', err.message);
    return null;
  }
};

/** 首次迁移：写行表 + 删 kv 旧 key（同一事务）；行表没写进去就抛错，不删旧数据 */
const migrateFromKv = (database, legacySettings, options = {}) => {
  ensureTable(database);
  const backupPath = options.backupPath || null;
  let count = 0;
  const tx = database.transaction(() => {
    _lastRows = new Map();
    count = persist(database, legacySettings).written;
    const written = countRows(database);
    if (written === 0 && legacySettings && Object.keys(legacySettings).length > 0) {
      throw new Error(`迁移后 ${ROW_TABLE} 为空，放弃删除 kv_store.${KV_KEY}`);
    }
    database.prepare('DELETE FROM kv_store WHERE key = ?').run(KV_KEY);
  });
  tx();
  return { keys: count, backupPath };
};

/** 决定数据从哪来：行表优先 → kv 迁移 → null */
const resolveForLoad = (database, kvData, options = {}) => {
  const stored = load(database);
  if (stored) return { settings: stored, migrated: false };
  const legacy = kvData ? kvData[KV_KEY] : undefined;
  if (legacy === undefined) return { settings: null, migrated: false };
  const backupPath = backupLegacy(legacy, options.backupDir);
  const result = migrateFromKv(database, legacy, { backupPath });
  return { settings: legacy, migrated: true, count: result.keys, backupPath };
};

const resetCache = () => {
  _lastRows = new Map();
};

module.exports = {
  ROW_TABLE,
  KV_KEY,
  ensureTable,
  isEmpty,
  load,
  persist,
  migrateFromKv,
  resolveForLoad,
  countRows,
  resetCache,
};
