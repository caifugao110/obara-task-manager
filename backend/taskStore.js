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

// ---------------------------------------------------------------------------
// 删除
//
// 统一显式删除 task_entries 再删 task_sheets，不依赖 ON DELETE CASCADE：
// foreign_keys 是「连接级」pragma，只要在某个环节被重置（或历史数据是在外键
// 未启用时写入的），级联就会静默失效，留下 sheet 已不存在、entry 还在的孤儿
// 条目 —— 表现为清理后库里仍残留任务记录。显式删除再加一道兜底，更可靠。
//
// 所有删除都返回 { removedSheets, removedTaskItems }，便于上层按「工作表张数 +
// 任务记录条数」两个口径如实汇报，而不是把张数当成条数展示。
// ---------------------------------------------------------------------------
const runStmt = (stmt, params) => (
  params && Object.keys(params).length > 0 ? stmt.run(params) : stmt.run()
);
const getStmt = (stmt, params) => (
  params && Object.keys(params).length > 0 ? stmt.get(params) : stmt.get()
);

// whereSql 作用于 task_sheets 表（不含别名）
const deleteSheetsWhere = (whereSql, params = {}) => {
  const raw = ensureTables();
  const countEntries = raw.prepare(
    `SELECT COUNT(*) AS c FROM task_entries WHERE sheet_id IN (SELECT id FROM task_sheets WHERE ${whereSql})`
  );
  const deleteEntries = raw.prepare(
    `DELETE FROM task_entries WHERE sheet_id IN (SELECT id FROM task_sheets WHERE ${whereSql})`
  );
  const deleteSheets = raw.prepare(`DELETE FROM task_sheets WHERE ${whereSql}`);
  const tx = raw.transaction(() => {
    const removedTaskItems = Number(getStmt(countEntries, params).c);
    runStmt(deleteEntries, params);
    const removedSheets = runStmt(deleteSheets, params).changes;
    return { removedSheets, removedTaskItems };
  });
  return tx();
};

const deleteSheetsByIds = (ids) => {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const raw = ensureTables();
  const deleteEntries = raw.prepare('DELETE FROM task_entries WHERE sheet_id = ?');
  const deleteSheet = raw.prepare('DELETE FROM task_sheets WHERE id = ?');
  const tx = raw.transaction((list) => {
    let removed = 0;
    for (const id of list) {
      deleteEntries.run(id);
      removed += deleteSheet.run(id).changes;
    }
    return removed;
  });
  return tx(ids);
};

const deleteSheetsByMonth = (year, month) => deleteSheetsWhere(
  'year = @year AND month = @month',
  { year: Number(year), month: Number(month) }
);

// 删除早于指定年月的表，返回 { removedSheets, removedTaskItems }
const deleteSheetsBefore = (year, month) => deleteSheetsWhere(
  'year < @year OR (year = @year AND month < @month)',
  { year: Number(year), month: Number(month) }
);

// 清空全部任务数据（数据管理里的「清空全部任务数据」）
const deleteAllSheets = () => deleteSheetsWhere('1 = 1');

// 清理孤儿条目：sheet 已被删但条目还在（外键未生效时的历史遗留）。
// 由「压缩数据库」调用，避免这些残留记录一直占着空间。
const deleteOrphanEntries = () => {
  const raw = ensureTables();
  return raw.prepare(
    'DELETE FROM task_entries WHERE sheet_id NOT IN (SELECT id FROM task_sheets)'
  ).run().changes;
};

// ---------------------------------------------------------------------------
// 主任务枪名使用情况
// ---------------------------------------------------------------------------
// 收集所有主任务条目中使用的焊枪名（去重、去空白）
// LIKE 预筛只读含 guns 字段的条目 JSON，避免全量反序列化
const listUsedGunNames = () => {
  const raw = ensureTables();
  const rows = raw.prepare(`SELECT data FROM task_entries WHERE data LIKE '%"guns"%'`).all();
  const names = new Set();
  for (const row of rows) {
    try {
      const item = JSON.parse(row.data);
      const guns = Array.isArray(item.guns) ? item.guns : [];
      for (const g of guns) {
        const name = String(g && g.name || '').trim();
        if (name) names.add(name);
      }
    } catch {
      // 条目 JSON 损坏时跳过，不影响其余条目
    }
  }
  return Array.from(names);
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

// ---------------------------------------------------------------------------
// 枪名归属：按枪名反查「当前被放在哪位设计员的哪一天、哪条任务里」
// 供主页面「确认图修改」快捷键快速添加使用：选中枪名后默认把任务安排给
// 该枪名所在任务的设计员。
// LIKE 只做预筛（备注等字段也可能命中），命中后仍逐条校验 guns 数组。
// ---------------------------------------------------------------------------
// scope 传入 { year, month } 时只在该月的表里预筛（默认范围），不传则全表
const gunEntryRows = (pattern, scope) => {
  const raw = ensureTables();
  const params = { pattern };
  const conditions = [`e.data LIKE @pattern ESCAPE '\\'`];
  const scopeYear = scope ? Number(scope.year) : NaN;
  const scopeMonth = scope ? Number(scope.month) : NaN;
  if (Number.isInteger(scopeYear) && Number.isInteger(scopeMonth)) {
    conditions.push('s.year = @scopeYear AND s.month = @scopeMonth');
    params.scopeYear = scopeYear;
    params.scopeMonth = scopeMonth;
  }
  return raw.prepare(`
    SELECT e.id AS itemId, e.data AS data, e.date AS date,
           s.designer_id AS designerId, s.year AS year, s.month AS month
    FROM task_entries e
    JOIN task_sheets s ON s.id = e.sheet_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY e.date DESC
  `).all(params);
};

const toGunHours = (value) => {
  const hours = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(hours) ? hours : 0;
};

const parseGuns = (data) => {
  try {
    const item = JSON.parse(data);
    return { item, guns: Array.isArray(item.guns) ? item.guns : [] };
  } catch {
    return null;
  }
};

// 按关键字反查枪名的归属（枪名 → 归属列表）
// 一次 LIKE 预筛即可同时「发现枪名」和「拿到归属」：台账里没有、只在任务里
// 手工录入过的枪名也能被搜到，不会因为不在台账而丢掉默认设计人员。
// 「确认图」任务排在最前：确认图修改的默认设计人员取该枪名的确认图负责人。
// scope={year,month} 时只在该月的任务里反查（前端「全表搜索」关闭时的默认范围）。
const isConfirmTask = (taskName) => {
  const name = String(taskName || '');
  return name.includes('确认图') && !name.includes('确认图修改');
};

const MAX_QUERY_GUN_NAMES = 200;

const findGunOwnersByQuery = (query, limitPerGun = 3, scope = null) => {
  const keyword = String(query || '').trim();
  const ownersByGun = new Map();
  if (!keyword) return ownersByGun;
  const lower = keyword.toLowerCase();

  for (const row of gunEntryRows(`%${escapeLike(keyword)}%`, scope)) {
    const parsed = parseGuns(row.data);
    if (!parsed) continue;
    for (const gun of parsed.guns) {
      const name = String(gun && gun.name || '').trim();
      if (!name || !name.toLowerCase().includes(lower)) continue;
      const owners = ownersByGun.get(name) || [];
      if (owners.length >= limitPerGun) continue;
      owners.push({
        itemId: row.itemId,
        designerId: row.designerId,
        date: row.date,
        year: row.year,
        month: row.month,
        taskName: String(parsed.item.taskName || ''),
        gunHours: toGunHours(gun.hours)
      });
      ownersByGun.set(name, owners);
    }
    if (ownersByGun.size >= MAX_QUERY_GUN_NAMES) break;
  }

  ownersByGun.forEach(owners => {
    owners.sort((a, b) => Number(isConfirmTask(b.taskName)) - Number(isConfirmTask(a.taskName)));
  });
  return ownersByGun;
};

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
  deleteAllSheets,
  deleteOrphanEntries,
  countSheets,
  countEntries,
  countMonths,
  entriesJsonSize,
  findCandidateSheetIds,
  listUsedGunNames,
  findGunOwnersByQuery
};
