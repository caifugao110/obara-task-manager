/**
 * taskStore.js — 任务工时表的关系型存储层
 *
 * 背景：原先 tasks 集合（所有设计员 × 每月一张工时表 × 每天多条任务）整体序列化为
 * 一个 JSON 大对象塞进 kv_store 单行，每次编辑任务都要「整库深拷贝 + 全量序列化 +
 * 全量 UPSERT」，任务量越大写放大越严重。
 *
 * 改造：拆成 task_sheets / task_entries 两张关系表，条目级 JSON 仍保留（任务条目字段
 * 灵活：颜色标记、焊枪明细、请假类型等），但读写粒度降到「单张工时表」：
 *   - 查询：按 designerId/year/month 走索引，只装配需要的表
 *   - 写入：saveSheet 只重写受影响表自身的条目（事务内 delete+insert）
 *
 * 对外保持原有 sheet 对象形状 { id, designerId, month, year, days: {date: [item]} }，
 * 路由与前端无需感知底层变化。
 */
const db = require('./db');

const safeJsonStringify = (data) => {
  const seen = new WeakSet();
  return JSON.stringify(data, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular Reference]';
      seen.add(value);
    }
    return value;
  });
};

let _ensured = false;

const ensureTables = () => {
  if (_ensured) return db.getRawDb();
  const raw = db.getRawDb();
  raw.pragma('foreign_keys = ON');
  raw.exec(`
    CREATE TABLE IF NOT EXISTS task_sheets (
      id TEXT PRIMARY KEY,
      designer_id TEXT NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_task_sheets_dmy ON task_sheets(designer_id, year, month);
    CREATE TABLE IF NOT EXISTS task_entries (
      id TEXT PRIMARY KEY,
      sheet_id TEXT NOT NULL REFERENCES task_sheets(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_entries_sheet_date ON task_entries(sheet_id, date);
  `);
  _ensured = true;
  return raw;
};

// ---------------------------------------------------------------------------
// 装配：行 -> 原 sheet 对象形状
// ---------------------------------------------------------------------------
const assembleSheet = (sheetRow, entryRows) => {
  const days = {};
  for (const entry of entryRows) {
    let item = null;
    try {
      item = JSON.parse(entry.data);
    } catch (e) {
      console.error(`[taskStore] 条目 ${entry.id} JSON 解析失败，已跳过:`, e.message);
      continue;
    }
    if (!days[entry.date]) days[entry.date] = [];
    days[entry.date].push(item);
  }
  return {
    id: sheetRow.id,
    designerId: sheetRow.designer_id,
    month: sheetRow.month,
    year: sheetRow.year,
    days
  };
};

const loadEntriesForSheets = (raw, sheetIds) => {
  if (sheetIds.length === 0) return new Map();
  const stmt = raw.prepare(
    'SELECT sheet_id, date, data FROM task_entries WHERE sheet_id = ? ORDER BY date, position, rowid'
  );
  const map = new Map(sheetIds.map(id => [id, []]));
  for (const id of sheetIds) {
    map.set(id, stmt.all(id));
  }
  return map;
};

const assembleSheets = (raw, sheetRows) => {
  const entriesMap = loadEntriesForSheets(raw, sheetRows.map(r => r.id));
  return sheetRows.map(row => assembleSheet(row, entriesMap.get(row.id) || []));
};

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------
const listSheets = ({ designerId, month, year } = {}) => {
  const raw = ensureTables();
  const conditions = [];
  const params = {};
  if (designerId) { conditions.push('designer_id = @designerId'); params.designerId = designerId; }
  if (month) { conditions.push('month = @month'); params.month = Number(month); }
  if (year) { conditions.push('year = @year'); params.year = Number(year); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = raw.prepare(`SELECT * FROM task_sheets ${where} ORDER BY year, month, designer_id`).all(params);
  return assembleSheets(raw, rows);
};

const getSheet = (designerId, month, year) => {
  const raw = ensureTables();
  const row = raw.prepare(
    'SELECT * FROM task_sheets WHERE designer_id = ? AND month = ? AND year = ?'
  ).get(designerId, Number(month), Number(year));
  if (!row) return null;
  return assembleSheets(raw, [row])[0];
};

// 存在则返回已装配的表；不存在则返回一个尚未落库的新对象（saveSheet 时才真正插入），
// 避免查询/删除等失败路径在库里留下空表
const getOrCreateSheet = (designerId, month, year) => {
  const existing = getSheet(designerId, month, year);
  if (existing) return existing;
  return {
    id: `sheet-${designerId}-${year}-${month}`,
    designerId,
    month: Number(month),
    year: Number(year),
    days: {}
  };
};

// 至少有一条任务条目的表（导出用）
const listSheetsWithData = () => {
  const raw = ensureTables();
  const rows = raw.prepare(`
    SELECT s.* FROM task_sheets s
    WHERE EXISTS (SELECT 1 FROM task_entries e WHERE e.sheet_id = s.id)
    ORDER BY s.year, s.month, s.designer_id
  `).all();
  return assembleSheets(raw, rows);
};

const listSheetsBeforeYear = (cutoffYear) => {
  const raw = ensureTables();
  const rows = raw.prepare('SELECT * FROM task_sheets WHERE year < ? ORDER BY year, month, designer_id').all(Number(cutoffYear));
  return assembleSheets(raw, rows);
};

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------
const saveSheet = (sheet) => {
  const raw = ensureTables();
  const upsertSheet = raw.prepare(`
    INSERT INTO task_sheets (id, designer_id, month, year, updated_at)
    VALUES (@id, @designerId, @month, @year, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      designer_id = excluded.designer_id,
      month = excluded.month,
      year = excluded.year,
      updated_at = excluded.updated_at
  `);
  const deleteEntries = raw.prepare('DELETE FROM task_entries WHERE sheet_id = ?');
  const insertEntry = raw.prepare(
    'INSERT INTO task_entries (id, sheet_id, date, position, data) VALUES (?, ?, ?, ?, ?)'
  );

  const tx = raw.transaction(() => {
    upsertSheet.run({
      id: sheet.id,
      designerId: sheet.designerId,
      month: Number(sheet.month),
      year: Number(sheet.year)
    });
    deleteEntries.run(sheet.id);
    const days = sheet.days && typeof sheet.days === 'object' ? sheet.days : {};
    for (const date of Object.keys(days).sort()) {
      const items = Array.isArray(days[date]) ? days[date] : [];
      items.forEach((item, index) => {
        if (!item || typeof item !== 'object') return;
        insertEntry.run(item.id || `entry-${sheet.id}-${date}-${index}`, sheet.id, date, index, safeJsonStringify(item));
      });
    }
  });
  tx();
};

const saveSheets = (sheets) => {
  const raw = ensureTables();
  const tx = raw.transaction((list) => {
    for (const sheet of list) saveSheet(sheet);
  });
  tx(sheets);
};

const deleteSheetsByIds = (ids) => {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const raw = ensureTables();
  const stmt = raw.prepare('DELETE FROM task_sheets WHERE id = ?');
  const tx = raw.transaction((list) => {
    let removed = 0;
    for (const id of list) removed += stmt.run(id).changes;
    return removed;
  });
  return tx(ids);
};

const deleteSheetsByMonth = (year, month) => {
  const raw = ensureTables();
  return raw.prepare('DELETE FROM task_sheets WHERE year = ? AND month = ?').run(Number(year), Number(month)).changes;
};

// 删除早于指定年月的表，返回 { removedSheets, removedTaskItems }
const deleteSheetsBefore = (year, month) => {
  const raw = ensureTables();
  const removedTaskItems = raw.prepare(`
    SELECT COUNT(*) AS c FROM task_entries e
    JOIN task_sheets s ON s.id = e.sheet_id
    WHERE s.year < @year OR (s.year = @year AND s.month < @month)
  `).get({ year: Number(year), month: Number(month) }).c;
  const removedSheets = raw.prepare(
    'DELETE FROM task_sheets WHERE year < @year OR (year = @year AND month < @month)'
  ).run({ year: Number(year), month: Number(month) }).changes;
  return { removedSheets, removedTaskItems: Number(removedTaskItems) };
};

// ---------------------------------------------------------------------------
// 统计
// ---------------------------------------------------------------------------
const countSheets = () => Number(ensureTables().prepare('SELECT COUNT(*) AS c FROM task_sheets').get().c);
const countEntries = () => Number(ensureTables().prepare('SELECT COUNT(*) AS c FROM task_entries').get().c);
const countMonths = () => Number(ensureTables().prepare('SELECT COUNT(DISTINCT year || \'-\' || month) AS c FROM task_sheets').get().c);
const entriesJsonSize = () => Number(ensureTables().prepare('SELECT COALESCE(SUM(LENGTH(data)), 0) AS s FROM task_entries').get().s);

// ---------------------------------------------------------------------------
// 批量替换：LIKE 预筛候选条目，避免全表装配
// 返回命中条目的 sheetId 集合；调用方再按需装配完整表做修改
// ---------------------------------------------------------------------------
const escapeLike = (text) => String(text).replace(/[\\%_]/g, ch => `\\${ch}`);

const findCandidateSheetIds = (findText, { allTable = false, month, year } = {}) => {
  const raw = ensureTables();
  const pattern = `%${escapeLike(findText)}%`;
  const conditions = ["e.data LIKE @pattern ESCAPE '\\'"];
  const params = { pattern };
  if (!allTable) {
    conditions.push('s.month = @month', 's.year = @year');
    params.month = Number(month);
    params.year = Number(year);
  }
  const rows = raw.prepare(`
    SELECT DISTINCT e.sheet_id AS sheetId FROM task_entries e
    JOIN task_sheets s ON s.id = e.sheet_id
    WHERE ${conditions.join(' AND ')}
  `).all(params);
  return rows.map(r => r.sheetId);
};

const getSheetsByIds = (ids) => {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const raw = ensureTables();
  const stmt = raw.prepare('SELECT * FROM task_sheets WHERE id = ?');
  const rows = ids.map(id => stmt.get(id)).filter(Boolean);
  return assembleSheets(raw, rows);
};

// ---------------------------------------------------------------------------
// 从 kv_store 的 tasks 大 JSON 迁移（幂等：仅当 kv 行存在时执行，成功后删除该行）
// tasksArray 来自已完成归一化迁移的内存缓存
// ---------------------------------------------------------------------------
const migrateFromCache = (tasksArray) => {
  const raw = ensureTables();
  const kvRow = raw.prepare("SELECT value FROM kv_store WHERE key = 'tasks'").get();

  let sheets = Array.isArray(tasksArray) ? tasksArray : [];
  if (sheets.length === 0 && kvRow) {
    try {
      const parsed = JSON.parse(kvRow.value);
      sheets = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      sheets = [];
    }
  }
  // 既没有缓存数据也没有 kv 遗留行：无需迁移（幂等）
  if (!kvRow && sheets.length === 0) return { migrated: false };

  const tx = raw.transaction(() => {
    for (const sheet of sheets) {
      if (!sheet || typeof sheet !== 'object') continue;
      const designerId = sheet.designerId || sheet.userId || '';
      if (!designerId || !sheet.month || !sheet.year) continue;
      saveSheet({
        id: sheet.id || `sheet-${designerId}-${sheet.year}-${sheet.month}`,
        designerId,
        month: sheet.month,
        year: sheet.year,
        days: sheet.days && typeof sheet.days === 'object' ? sheet.days : {}
      });
    }
    // 全部写入成功后再摘除 kv 行；任何一步失败整个事务回滚，kv 数据保留
    raw.prepare("DELETE FROM kv_store WHERE key = 'tasks'").run();
  });
  tx();

  const entryCount = countEntries();
  console.log(`[taskStore] 已迁移 ${sheets.length} 张工时表 / ${entryCount} 条任务条目到关系表`);
  return { migrated: true, sheets: sheets.length, entries: entryCount };
};

module.exports = {
  ensureTables,
  listSheets,
  getSheet,
  getOrCreateSheet,
  getSheetsByIds,
  listSheetsWithData,
  listSheetsBeforeYear,
  saveSheet,
  saveSheets,
  deleteSheetsByIds,
  deleteSheetsByMonth,
  deleteSheetsBefore,
  countSheets,
  countEntries,
  countMonths,
  entriesJsonSize,
  findCandidateSheetIds,
  migrateFromCache
};
