'use strict';

const fs = require('fs');
const XLSX = require('xlsx');
const securityConfig = require('../config/security');

// 只解析这四个工作表；工作表名以「南京」/「上海」开头，分别对应两个工厂
const SCHEDULE_SHEETS = [
  { name: '南京焊钳', factory: 'O/NJG' },
  { name: '上海焊钳', factory: 'O/SHA' },
  { name: '南京焊钳修改', factory: 'O/NJG' },
  { name: '上海焊钳修改', factory: 'O/SHA' }
];

const MONTH_LABEL_PATTERN = /^\d{1,2}月$/;
const DEFAULT_CACHE_MS = 5 * 60 * 1000;
const FAILURE_RETRY_MS = 30 * 1000;
const WARN_INTERVAL_MS = 10 * 60 * 1000;

// 大日程文件位于网络共享目录，读取一次约几百 KB；缓存解析结果，
// 避免每次状态跟踪请求都去访问共享盘。
let cache = {
  filePath: '',
  loadedAt: 0,
  mtimeMs: 0,
  index: null
};
let lastWarnAt = 0;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatMonthKey(year, month) {
  return `${year}-${pad2(month)}`;
}

function getScheduleFilePath() {
  return String(securityConfig.schedule?.filePath || '').trim();
}

function getCacheMs() {
  const configured = Number(securityConfig.schedule?.cacheMs);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_CACHE_MS;
}

// 工作表内每个月份块按「当前月、下一个月、下下个月、下下下个月」排列，
// 用当前的年月为每个块推导出 YYYY-MM，避免跨年（11、12、1、2）时歧义。
function getBlockMonth(now, blockIndex) {
  const date = new Date(now.getFullYear(), now.getMonth() + blockIndex, 1);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    key: formatMonthKey(date.getFullYear(), date.getMonth() + 1)
  };
}

function formatDate(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

// 纳期在表格里通常是「11/02」「12/1」这样的月/日文本，也可能被 Excel 存成日期序列号。
// 只有月/日时，年份按所属月份块推导；跨年块（如 1 月块里的 12/xx）做邻近修正。
function parseDeliveryDate(value, blockMonth) {
  if (value === null || value === undefined || value === '') return '';

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return formatDate(parsed.y, parsed.m, parsed.d);
    }
  }

  const text = String(value).trim();
  if (!text) return '';

  const fullDateMatch = text.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (fullDateMatch) {
    return formatDate(
      parseInt(fullDateMatch[1], 10),
      parseInt(fullDateMatch[2], 10),
      parseInt(fullDateMatch[3], 10)
    );
  }

  const monthDayMatch = text.match(/(\d{1,2})\s*[/.\-月]\s*(\d{1,2})/);
  if (monthDayMatch) {
    const month = parseInt(monthDayMatch[1], 10);
    const day = parseInt(monthDayMatch[2], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let year = blockMonth.year;
      const monthDiff = month - blockMonth.month;
      if (monthDiff > 6) year -= 1;
      else if (monthDiff < -6) year += 1;
      return formatDate(year, month, day);
    }
  }

  return '';
}

function normalizeQuantity(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.round(value));
  }
  return String(value === null || value === undefined ? '' : value).trim();
}

function parseNumericValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value === null || value === undefined ? '' : value).trim();
  if (!text) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

function parseShippedCount(value) {
  const numeric = parseNumericValue(value);
  return numeric === null ? 0 : Math.max(0, Math.round(numeric));
}

// 客户列形如「58249>O/IND_CHROPYNSKA-...」，取行首的 5~6 位仕样号；
// 底部的「UC/UX」「OBARA SERVO」等汇总行不会被误识别。
function extractSpecNumber(cell) {
  const match = String(cell === null || cell === undefined ? '' : cell).trim().match(/^(\d{5,6})(?!\d)/);
  return match ? match[1] : '';
}

function buildClientText(cell) {
  return String(cell === null || cell === undefined ? '' : cell).trim();
}

function detectBlocks(rows) {
  const monthRow = rows[1] || [];
  const headerRow = rows[2] || [];
  const starts = [];

  for (let col = 0; col < monthRow.length; col++) {
    const label = String(monthRow[col] || '').trim();
    if (MONTH_LABEL_PATTERN.test(label)) {
      starts.push({ col, index: starts.length });
    }
  }

  const blocks = [];
  starts.forEach((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].col : start.col + 10;
    const headerMap = {};
    for (let col = start.col; col < end; col++) {
      const label = String(headerRow[col] || '').trim();
      if (label && headerMap[label] === undefined) headerMap[label] = col;
    }

    if (headerMap['客户'] === undefined) return;

    blocks.push({
      monthIndex: start.index,
      customerCol: headerMap['客户'],
      quantityCol: headerMap['数量'] !== undefined ? headerMap['数量'] : headerMap['客户'] + 1,
      deliveryCol: headerMap['纳期'] !== undefined ? headerMap['纳期'] : headerMap['客户'] + 2,
      shippedCol: headerMap['已发图'] !== undefined ? headerMap['已发图'] : headerMap['客户'] + 3
    });
  });

  return blocks;
}

// 同一仕样号在同一工作表、同一月份出现多行时（表格里常见「总25」的拆行），
// 数量与已发图累加，纳期取最早的日期。
function mergeEntry(index, entry) {
  let entries = index.get(entry.specNumber);
  if (!entries) {
    entries = [];
    index.set(entry.specNumber, entries);
  }

  const existing = entries.find(item => item.sheetName === entry.sheetName && item.month === entry.month);
  if (!existing) {
    entries.push(entry);
    return;
  }

  const existingQty = parseNumericValue(existing.quantity);
  const entryQty = parseNumericValue(entry.quantity);
  if (existingQty !== null || entryQty !== null) {
    existing.quantity = String((existingQty || 0) + (entryQty || 0));
  }

  existing.shippedCount += entry.shippedCount || 0;

  if (entry.deliveryDate && (!existing.deliveryDate || entry.deliveryDate < existing.deliveryDate)) {
    existing.deliveryDate = entry.deliveryDate;
  }

  if (!existing.clientText && entry.clientText) {
    existing.clientText = entry.clientText;
  }
}

function buildIndex(workbook, now) {
  const index = new Map();

  for (const sheetConfig of SCHEDULE_SHEETS) {
    const worksheet = workbook.Sheets[sheetConfig.name];
    if (!worksheet) continue;

    let rows;
    try {
      rows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: '',
        raw: true,
        blankrows: true
      });
    } catch (e) {
      console.warn(`[productionSchedule] 解析工作表「${sheetConfig.name}」失败:`, e.message);
      continue;
    }

    if (rows.length < 4) continue;

    const blocks = detectBlocks(rows);
    for (const block of blocks) {
      const blockMonth = getBlockMonth(now, block.monthIndex);

      for (let rowIndex = 3; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex] || [];
        const customerCell = row[block.customerCol];
        const specNumber = extractSpecNumber(customerCell);
        if (!specNumber) continue;

        mergeEntry(index, {
          specNumber,
          sheetName: sheetConfig.name,
          factory: sheetConfig.factory,
          month: blockMonth.key,
          clientText: buildClientText(customerCell),
          quantity: normalizeQuantity(row[block.quantityCol]),
          deliveryDate: parseDeliveryDate(row[block.deliveryCol], blockMonth),
          shippedCount: parseShippedCount(row[block.shippedCol])
        });
      }
    }
  }

  return index;
}

function warnThrottled(message, error) {
  const now = Date.now();
  if (now - lastWarnAt < WARN_INTERVAL_MS) return;
  lastWarnAt = now;
  console.warn(message, error?.message || error || '');
}

function getScheduleIndex(now = new Date(), options = {}) {
  const filePath = getScheduleFilePath();
  if (!filePath) return null;

  const nowMs = Date.now();
  const cacheMs = getCacheMs();
  // 「同步生产大日程」是用户显式触发的动作，必须拿到共享盘上的最新文件，
  // 不能吃 5 分钟缓存（否则同步完看起来没变化）
  const forceReload = options.forceReload === true;

  if (!forceReload && cache.filePath === filePath && cache.index && nowMs - cache.loadedAt < cacheMs) {
    return cache.index;
  }

  // 读取失败后短时间内不重复访问网络共享目录，避免拖慢每个请求
  if (!forceReload && cache.filePath === filePath && !cache.index && nowMs - cache.loadedAt < FAILURE_RETRY_MS) {
    return null;
  }

  try {
    const stat = fs.statSync(filePath);
    if (cache.filePath === filePath && cache.index && cache.mtimeMs === stat.mtimeMs) {
      cache.loadedAt = nowMs;
      return cache.index;
    }

    const workbook = XLSX.readFile(filePath, { cellDates: false });
    const index = buildIndex(workbook, now);
    cache = {
      filePath,
      loadedAt: nowMs,
      mtimeMs: stat.mtimeMs,
      index
    };
    return index;
  } catch (error) {
    warnThrottled(`[productionSchedule] 无法读取大日程文件 ${filePath}:`, error);
    cache = {
      filePath,
      loadedAt: nowMs,
      mtimeMs: 0,
      index: null
    };
    return null;
  }
}

function findScheduleEntry(specNumber, preferredMonth) {
  const normalizedSpec = String(specNumber === null || specNumber === undefined ? '' : specNumber).trim();
  if (!normalizedSpec) return null;

  const index = getScheduleIndex();
  if (!index) return null;

  const entries = index.get(normalizedSpec);
  if (!entries || entries.length === 0) return null;

  // 指定了添加时间月份时优先取该月份块，保证「区分月份」；
  // 但表格中该仕样号只出现在别的月份块时（例如 11 月添加、12 月生产），
  // 仍应返回表格里的数量/纳期/已发图，不能直接判为取不到。
  if (preferredMonth) {
    const exactEntry = entries.find(entry => entry.month === preferredMonth);
    if (exactEntry) return exactEntry;
  }

  const currentMonth = formatMonthKey(new Date().getFullYear(), new Date().getMonth() + 1);
  const currentEntry = entries.find(entry => entry.month === currentMonth);
  if (currentEntry) return currentEntry;

  // 无当前月份块时取离当前月最近的一个月份块
  const nowIndex = new Date().getFullYear() * 12 + new Date().getMonth();
  return entries.slice().sort((a, b) => {
    const aIndex = parseInt(a.month.slice(0, 4), 10) * 12 + parseInt(a.month.slice(5, 7), 10) - 1;
    const bIndex = parseInt(b.month.slice(0, 4), 10) * 12 + parseInt(b.month.slice(5, 7), 10) - 1;
    return Math.abs(aIndex - nowIndex) - Math.abs(bIndex - nowIndex);
  })[0];
}

// 「同步生产大日程」用：一次取回四张工作表的全部仕样号条目
// （每张表内的 4 个月份块都会展开，entry.month 为推导出的 YYYY-MM）。
// 文件不可读时返回 null，由调用方给出提示。
function getAllScheduleEntries(options = {}) {
  const index = getScheduleIndex(options.now || new Date(), {
    forceReload: options.forceReload === true
  });
  if (!index) return null;

  const entries = [];
  for (const list of index.values()) {
    for (const entry of list) entries.push(entry);
  }
  return entries;
}

function getScheduleStatus() {
  return {
    filePath: cache.filePath || getScheduleFilePath(),
    loadedAt: cache.loadedAt ? new Date(cache.loadedAt).toISOString() : '',
    mtimeMs: cache.mtimeMs
  };
}

module.exports = {
  findScheduleEntry,
  getAllScheduleEntries,
  getScheduleStatus,
  // 导出给测试/排查使用
  _private: {
    parseDeliveryDate,
    extractSpecNumber,
    buildIndex,
    getBlockMonth
  }
};
