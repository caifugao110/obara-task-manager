'use strict';
/**
 * 焊枪台账（gunLedger）的行级存储
 *
 * 为什么要把台账从 kv_store 里搬出来：
 *   台账是体积最大的集合（分类 × 表 × 行），而 kv_store 是「一个 key 一整段 JSON」。
 *   改一个枪名 = 序列化整本台账 + 整段写回，磁盘与 WAL 都在做无谓的写放大。
 *   已经迁出 kv_store 的 tasks（关系表）、audit_logs / login_logs（独立表）都是这个理由。
 *
 * 本模块的做法（表级行存储 + 行级脏检查）：
 *   - 每张台账表存成 gun_ledger_tables 的一行（key = 分类 + 表 id），改一个枪名只重写那一张表；
 *   - 台账的其余顶层字段（defaultResponsiblePersons 等）与分类顺序存 gun_ledger_meta；
 *   - 落库前逐表比较序列化结果，只有真正变化的表才 UPSERT，删表时才 DELETE。
 *
 * 边界说明：这是「表级」而不是「枪名级」关系化。枪名仍以 JSON 存在表的 payload 里，
 * 因为台账的读写路径（整表导入/导出、拖拽排序、自愈重编号）都是整表操作，
 * 拆到行级会让 20 多处调用点全部重写，收益却只在这张表特别大时才体现。
 * 真正的写放大源头（整本台账重写）已经消除；剩下的是「单表重写」，属可接受范围。
 */

const fs = require('fs');
const path = require('path');

const ROW_TABLE = 'gun_ledger_tables';
const META_TABLE = 'gun_ledger_meta';
/** 分类名与表 id 之间用 \u0001 分隔：分类名里可能出现空格、斜杠，但不能出现这个控制字符 */
const KEY_SEP = '\u0001';

/** 台账顶层字段名（categories 之外的部分），用于和行表区分开 */
const META_CATEGORY_ORDER = '__categories';
const META_REST = '__rest';

/** 上次落库的内容快照（key -> 序列化结果），用于行级脏检查 */
let _lastRows = new Map();
let _lastMeta = new Map();

const safeJson = (value) => {
  try {
    return JSON.stringify(value);
  } catch (err) {
    console.error('[gunLedgerStore] 序列化失败：', err.message);
    return 'null';
  }
};

const ensureTables = (database) => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ${ROW_TABLE} (
      key TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      position INTEGER NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_${ROW_TABLE}_category ON ${ROW_TABLE} (category, position);
    CREATE TABLE IF NOT EXISTS ${META_TABLE} (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
};

const rowKey = (category, table, index) =>
  `${category}${KEY_SEP}${(table && table.id) ? String(table.id) : `#${index}`}`;

/** 台账是否为空：没有任何表行也没有元数据（用于区分「从未迁移」与「迁移后恰好只有元数据」） */
const isEmpty = (database) => {
  ensureTables(database);
  const rowCount = Number(database.prepare(`SELECT COUNT(*) AS c FROM ${ROW_TABLE}`).get().c);
  const metaCount = Number(database.prepare(`SELECT COUNT(*) AS c FROM ${META_TABLE}`).get().c);
  return rowCount === 0 && metaCount === 0;
};

/**
 * 从行表还原出与原先完全一致的内存结构：{ categories: { 分类: [表…] }, ...其它字段 }
 * 没有任何数据时返回 null（调用方据此决定是走迁移还是用默认值）。
 */
const load = (database) => {
  ensureTables(database);
  const metaRows = database.prepare(`SELECT key, value FROM ${META_TABLE}`).all();
  const rows = database.prepare(
    `SELECT key, category, position, payload FROM ${ROW_TABLE} ORDER BY category, position`
  ).all();
  if (metaRows.length === 0 && rows.length === 0) return null;

  const meta = {};
  for (const row of metaRows) {
    try {
      meta[row.key] = JSON.parse(row.value);
    } catch (err) {
      console.error(`[gunLedgerStore] 元数据 ${row.key} 解析失败：`, err.message);
    }
  }

  // 分类顺序以前端展示顺序为准，存在 __categories 里；
  // 兜底：元数据缺失时按表行里出现过的分类（保持查询顺序）重建
  let categoryOrder = Array.isArray(meta[META_CATEGORY_ORDER]) ? meta[META_CATEGORY_ORDER] : [];
  if (categoryOrder.length === 0) {
    categoryOrder = [...new Set(rows.map(r => r.category))];
  }

  const categories = {};
  for (const category of categoryOrder) categories[category] = [];
  // 元数据里有、表行里没有的分类（空分类）保持在原位：
  // 上面已按 categoryOrder 建好空数组，这里只往里填表
  for (const row of rows) {
    if (!categories[row.category]) categories[row.category] = [];
    try {
      categories[row.category].push(JSON.parse(row.payload));
    } catch (err) {
      console.error(`[gunLedgerStore] 表 ${row.key} 解析失败，已跳过：`, err.message);
    }
  }

  // 记录基线，避免刚启动就把整本台账重写一遍
  _lastRows = new Map(rows.map(row => [row.key, row.payload]));
  _lastMeta = new Map(metaRows.map(row => [row.key, row.value]));

  const rest = meta[META_REST] && typeof meta[META_REST] === 'object' ? meta[META_REST] : {};
  return { ...rest, categories };
};

const countRows = (database) => {
  ensureTables(database);
  return Number(database.prepare(`SELECT COUNT(*) AS c FROM ${ROW_TABLE}`).get().c);
};

/**
 * 把内存里的台账落库（行级脏检查）。必须在调用方的事务里执行，
 * 保证「改台账 + 改设置」这类复合写要么全成要么全不成。
 * @returns {{written:number, deleted:number, unchanged:number}}
 */
const persist = (database, ledger) => {
  ensureTables(database);
  const source = ledger && typeof ledger === 'object' ? ledger : {};
  const categories = source.categories && typeof source.categories === 'object' ? source.categories : {};

  const nextRows = new Map(); // key -> { category, position, json, key }
  const categoryOrder = Object.keys(categories);
  for (const category of categoryOrder) {
    const list = Array.isArray(categories[category]) ? categories[category] : [];
    list.forEach((table, index) => {
      const key = rowKey(category, table, index);
      nextRows.set(key, { category, position: index, json: safeJson(table) });
    });
  }

  const { categories: _ignored, ...rest } = source;
  const nextMeta = new Map([
    [META_CATEGORY_ORDER, safeJson(categoryOrder)],
    [META_REST, safeJson(rest)],
  ]);

  const upsertRow = database.prepare(
    `INSERT INTO ${ROW_TABLE} (key, category, position, payload, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       category = excluded.category,
       position = excluded.position,
       payload = excluded.payload,
       updated_at = excluded.updated_at`
  );
  const deleteRow = database.prepare(`DELETE FROM ${ROW_TABLE} WHERE key = ?`);
  const upsertMeta = database.prepare(
    `INSERT INTO ${META_TABLE} (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );

  let written = 0;
  let unchanged = 0;
  let deleted = 0;

  for (const [key, row] of nextRows) {
    if (_lastRows.get(key) === row.json) {
      unchanged += 1;
      continue;
    }
    upsertRow.run(key, row.category, row.position, row.json);
    _lastRows.set(key, row.json);
    written += 1;
  }
  // 删除已不存在的表（删除表 / 删除分类 / 导入后表数量变少）
  for (const key of [..._lastRows.keys()]) {
    if (nextRows.has(key)) continue;
    deleteRow.run(key);
    _lastRows.delete(key);
    deleted += 1;
  }
  for (const [key, value] of nextMeta) {
    if (_lastMeta.get(key) === value) continue;
    upsertMeta.run(key, value);
    _lastMeta.set(key, value);
  }

  return { written, deleted, unchanged };
};

/**
 * 首次迁移：把 kv_store 里的整本台账 JSON 写进行表，并在**同一个事务**里删掉旧 key。
 * 迁移前会把原始 JSON 备份成 `backups/database/gun-ledger-before-migration-<时间>.json`，
 * 万一字段结构在迁移中丢东西，还能对照找回。
 * @returns {{tables:number, backupPath:string|null}}
 */
const migrateFromKv = (database, legacyLedger, options = {}) => {
  ensureTables(database);
  const backupPath = options.backupPath || null;
  let tableCount = 0;
  const tx = database.transaction(() => {
    _lastRows = new Map();
    _lastMeta = new Map();
    const result = persist(database, legacyLedger);
    tableCount = result.written;
    // 旧 key 删除前先确认行表已经写进去了，否则宁可保留 kv 数据让下次启动重试
    const written = countRows(database);
    if (written === 0 && Object.keys(legacyLedger?.categories || {}).length > 0) {
      throw new Error('迁移后台账行表为空，放弃删除 kv_store.gunLedger');
    }
    database.prepare('DELETE FROM kv_store WHERE key = ?').run('gunLedger');
  });
  tx();
  return { tables: tableCount, backupPath };
};

/**
 * 迁移前把原始台账另存一份 JSON：字段、表内结构一旦在迁移中丢掉，
 * 只靠数据库备份要回滚整库，代价太大。备份失败不阻断迁移（记日志即可）。
 */
const backupLegacyLedger = (legacyLedger) => {
  try {
    const dir = path.resolve(__dirname, 'backups', 'database');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `gun-ledger-before-migration-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(legacyLedger, null, 2), 'utf8');
    return file;
  } catch (err) {
    console.error('[gunLedgerStore] 迁移前的 JSON 备份失败（继续迁移）：', err.message);
    return null;
  }
};

/**
 * 给 db.loadFromDb 用：决定「台账从哪来」并完成就地迁移。
 *   - 行表已有数据 → 直接用行表（kv 里残留的旧 key 视为过期，不再读）；
 *   - 行表为空但 kv 里有整本 JSON → 备份 + 迁移 + 删旧 key；
 *   - 两边都没有 → 返回 null，由调用方用默认台账。
 * 迁移失败时抛出，调用方保留旧数据、下次启动重试。
 * @returns {{ledger:object|null, migrated:boolean, tables?:number, backupPath?:string|null}}
 */
const resolveLedgerForLoad = (database, kvData) => {
  const stored = load(database);
  if (stored) return { ledger: stored, migrated: false };
  const legacy = kvData ? kvData.gunLedger : undefined;
  if (legacy === undefined) return { ledger: null, migrated: false };
  // 不在这里动 kvData：迁移抛错时调用方还要拿它兜底（下次启动重试）
  const backupPath = backupLegacyLedger(legacy);
  const result = migrateFromKv(database, legacy, { backupPath });
  return { ledger: legacy, migrated: true, tables: result.tables, backupPath };
};

/** 仅供测试/诊断：把内部脏检查基线清空，强制下次 persist 全量重写 */
const resetCache = () => {
  _lastRows = new Map();
  _lastMeta = new Map();
};

module.exports = {
  ROW_TABLE,
  META_TABLE,
  ensureTables,
  isEmpty,
  load,
  persist,
  migrateFromKv,
  resolveLedgerForLoad,
  countRows,
  resetCache,
};
