'use strict';
/**
 * 「一维数组集合」的行级存储工厂
 *
 * 背景：tasks / audit_logs / login_logs 迁出 kv_store 后，gunLedger / statusTrackingItems
 * 又各自写了一份「行级存储 + 脏检查 + 迁移 + 失败回退」的实现。如果再为 users / designers
 * 复制第三、第四份，四份代码会各自漂移（有的忘了比位置、有的忘了迁移失败要保留 kv 数据）。
 * 所以把数组型集合的共同部分收在这里，各集合只声明「表名、kv 里的 key、主键字段」。
 *
 * 约定（调用方只关心这些）：
 *   - persist 只写真正变化的行；位置变化也算变化（顺序就是展示顺序）；
 *   - 删除的条目会删行，不留孤儿；
 *   - migrateFromKv 在事务里「写行表 + 删 kv 旧 key」，行表没写进去就抛错，绝不删旧数据；
 *   - resolveForLoad 决定「读行表还是迁移」，迁移失败时不动 kvData（调用方继续用旧值服务）。
 */

const fs = require('fs');
const path = require('path');

/**
 * @param {object} options
 * @param {string} options.table     行表名
 * @param {string} options.kvKey     kv_store 里的集合名（也是内存缓存字段名）
 * @param {string} [options.label]   日志里的中文名
 * @param {string} [options.keyField] 主键字段，默认 id
 */
const createArrayStore = ({ table, kvKey, label, keyField = 'id' }) => {
  const ROW_TABLE = table;
  const LABEL = label || kvKey;

  /** 上次落库的内容（key -> 序列化）与位置，用于行级脏检查 */
  let lastRows = new Map();
  let lastPosition = new Map();

  const safeJson = (value) => {
    try {
      return JSON.stringify(value);
    } catch (err) {
      console.error(`[${LABEL}] 序列化失败：`, err.message);
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
      CREATE INDEX IF NOT EXISTS idx_${ROW_TABLE}_position ON ${ROW_TABLE} (position);
    `);
  };

  const rowKey = (entry, index) => {
    const raw = entry && entry[keyField];
    return raw ? String(raw) : `#${index}`;
  };

  const isEmpty = (database) => {
    ensureTable(database);
    return Number(database.prepare(`SELECT COUNT(*) AS c FROM ${ROW_TABLE}`).get().c) === 0;
  };

  const countRows = (database) => {
    ensureTable(database);
    return Number(database.prepare(`SELECT COUNT(*) AS c FROM ${ROW_TABLE}`).get().c);
  };

  /** 按 position 还原成数组；空表返回 null（调用方据此决定用默认值还是迁移） */
  const load = (database) => {
    ensureTable(database);
    const rows = database.prepare(
      `SELECT key, position, payload FROM ${ROW_TABLE} ORDER BY position`
    ).all();
    if (rows.length === 0) return null;

    const list = [];
    for (const row of rows) {
      try {
        list.push(JSON.parse(row.payload));
      } catch (err) {
        console.error(`[${LABEL}] 行 ${row.key} 解析失败，已跳过：`, err.message);
      }
    }
    lastRows = new Map(rows.map(row => [row.key, row.payload]));
    lastPosition = new Map(rows.map(row => [row.key, row.position]));
    return list;
  };

  /**
   * 落库（行级脏检查）。必须在调用方事务里执行。
   * @returns {{written:number, deleted:number, unchanged:number}}
   */
  const persist = (database, entries) => {
    ensureTable(database);
    const list = Array.isArray(entries) ? entries : [];

    const nextRows = new Map();
    list.forEach((entry, index) => {
      nextRows.set(rowKey(entry, index), { position: index, json: safeJson(entry) });
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
      if (lastRows.get(key) === row.json && lastPosition.get(key) === row.position) {
        unchanged += 1;
        continue;
      }
      upsert.run(key, row.position, row.json);
      lastRows.set(key, row.json);
      lastPosition.set(key, row.position);
      written += 1;
    }
    for (const key of [...lastRows.keys()]) {
      if (nextRows.has(key)) continue;
      remove.run(key);
      lastRows.delete(key);
      lastPosition.delete(key);
      deleted += 1;
    }

    return { written, deleted, unchanged };
  };

  /** 迁移前把原始数组备份成 JSON：字段一旦在迁移中丢掉，只靠整库备份要回滚太多 */
  const backupLegacy = (legacyItems, dirOverride) => {
    try {
      const dir = dirOverride || path.resolve(__dirname, 'backups', 'database');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = path.join(dir, `${kvKey}-before-migration-${stamp}.json`);
      fs.writeFileSync(file, JSON.stringify(legacyItems, null, 2), 'utf8');
      return file;
    } catch (err) {
      console.error(`[${LABEL}] 迁移前的 JSON 备份失败（继续迁移）：`, err.message);
      return null;
    }
  };

  /**
   * 首次迁移：写行表 + 删 kv 旧 key（同一事务）。
   * 行表写入失败时抛错，调用方保留 kv 旧数据、下次启动重试。
   */
  const migrateFromKv = (database, legacyItems, options = {}) => {
    ensureTable(database);
    const backupPath = options.backupPath || null;
    let count = 0;
    const tx = database.transaction(() => {
      lastRows = new Map();
      lastPosition = new Map();
      count = persist(database, legacyItems).written;
      const written = countRows(database);
      if (written === 0 && Array.isArray(legacyItems) && legacyItems.length > 0) {
        throw new Error(`迁移后 ${ROW_TABLE} 为空，放弃删除 kv_store.${kvKey}`);
      }
      database.prepare('DELETE FROM kv_store WHERE key = ?').run(kvKey);
    });
    tx();
    return { items: count, backupPath };
  };

  /** 决定数据从哪来：行表优先 → kv 迁移 → null（调用方给默认值） */
  const resolveForLoad = (database, kvData, options = {}) => {
    const stored = load(database);
    if (stored) return { items: stored, migrated: false };
    const legacy = kvData ? kvData[kvKey] : undefined;
    if (legacy === undefined) return { items: null, migrated: false };
    const backupPath = backupLegacy(legacy, options.backupDir);
    const result = migrateFromKv(database, legacy, { backupPath });
    return { items: legacy, migrated: true, count: result.items, backupPath };
  };

  /** 仅供测试/诊断：清空脏检查基线，强制下次 persist 全量重写 */
  const resetCache = () => {
    lastRows = new Map();
    lastPosition = new Map();
  };

  return {
    ROW_TABLE,
    KV_KEY: kvKey,
    ensureTable,
    isEmpty,
    load,
    persist,
    migrateFromKv,
    resolveForLoad,
    countRows,
    resetCache,
  };
};

module.exports = { createArrayStore };
