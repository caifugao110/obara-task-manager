'use strict';

const fs = require('fs');
const XLSX = require('xlsx');
const securityConfig = require('../config/security');
const uncShare = require('./uncShare');

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
  entryCount: 0,
  index: null
};
let lastWarnAt = 0;

// 读取失败的详细信息：前端只显示一句「请确认共享目录可访问」会掩盖真实原因
// （Session 0 的服务进程读不到共享 vs 文件被 Excel 独占，处理方式完全不同），
// 这里保留错误码与建议，供同步接口、诊断接口和日志使用。
let runtime = {
  lastError: null,
  lastSuccessAt: ''
};

const SCHEDULE_ERROR_HINTS = {
  EPERM: '后端以服务/计划任务方式运行时（Session 0）拿不到登录用户的共享凭据，请在 backend/.env 配置 PRODUCTION_SCHEDULE_UNC_USER 与 PRODUCTION_SCHEDULE_UNC_PASSWORD，或给运行该服务的账户授予共享权限',
  EACCES: '进程没有该共享的访问权限，请配置 PRODUCTION_SCHEDULE_UNC_USER/PASSWORD，或给运行该服务的账户授予共享权限',
  EBUSY: '文件正被 Excel 独占打开，关闭 Excel 后重试',
  ENOENT: '共享目录里没有该文件，请确认文件名仍为「各产品大日程.xls」',
  UNKNOWN: '共享连接不可用（认证失败或网络不通），请检查共享凭据配置',
  ENODEV: '网络提供程序未就绪，请检查到共享服务器的网络连接',
  ETIMEDOUT: '访问共享目录超时，请检查网络与共享服务器状态'
};

const hintForError = (code) => SCHEDULE_ERROR_HINTS[code] || '请检查共享目录权限与网络连接';

// 前端 toast 里显示的一句话提示：长建议放 detail.hint / 文档里，避免提示框刷屏
const SHORT_HINTS = {
  EPERM: '权限不足，请配置共享账号或给运行账户授权',
  EACCES: '权限不足，请配置共享账号或给运行账户授权',
  EBUSY: '文件正被 Excel 独占打开，请关闭后重试',
  ENOENT: '共享目录里找不到该文件',
  UNKNOWN: '共享连接不可用（认证失败或网络不通）',
  ENODEV: '网络提供程序未就绪',
  ETIMEDOUT: '访问共享超时'
};
const shortHintForError = (code) => SHORT_HINTS[code] || '请检查共享目录权限与网络连接';

// 运行后端的 Windows 账户：以服务/计划任务自启时常见为 SYSTEM，
// 而共享权限往往只授给了具体用户——排障时这一项最关键。
const getProcessUser = () => {
  const domain = process.env.USERDOMAIN || '';
  const user = process.env.USERNAME || '';
  if (user) return domain ? `${domain}\\${user}` : user;
  try {
    return require('os').userInfo().username || '';
  } catch (error) {
    return '';
  }
};

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

// 共享凭据：后端以服务/计划任务自启时在 Session 0 运行，没有登录用户的共享认证，
// 需要靠这对配置自己 net use（见 utils/uncShare.js）；未配置时沿用系统凭据。
const getShareCredentials = () => {
  const user = String(process.env.PRODUCTION_SCHEDULE_UNC_USER || '').trim();
  if (!user) return {};
  return { user, password: process.env.PRODUCTION_SCHEDULE_UNC_PASSWORD || '' };
};

function countEntries(index) {
  let total = 0;
  for (const list of index.values()) total += list.length;
  return total;
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

  // 首次 stat 失败（多半是 Session 0 没有共享凭据）时，uncShare 会按配置执行
  // net use 再重试一次；因此这里把「stat + 解析」整体作为一次可重试的读取。
  const outcome = uncShare.withShareRetry(filePath, () => {
    const stat = fs.statSync(filePath);
    if (cache.filePath === filePath && cache.index && cache.mtimeMs === stat.mtimeMs) {
      return { stat, index: cache.index, entryCount: cache.entryCount, reused: true };
    }
    const workbook = XLSX.readFile(filePath, { cellDates: false });
    const index = buildIndex(workbook, now);
    return { stat, index, entryCount: countEntries(index), reused: false };
  }, getShareCredentials());

  if (!outcome.ok) {
    const error = outcome.error || {};
    const code = error.code || 'ERROR';
    // net use 成功、文件操作仍被拒 → 连接建起来了但身份不对（多为 guest/匿名），
    // 这类情况给通用提示没有帮助，直接说明该配什么。
    const guestSession = Boolean(outcome.ensure && outcome.ensure.ok
      && (code === 'EPERM' || code === 'EACCES'));
    // 已经配了凭据还 EPERM：说明 net use 用的账号本身没有该共享/文件的读权限
    const credsRejected = Boolean(guestSession && outcome.ensure.credsConfigured);
    const guestHint = credsRejected
      ? `已用配置的账号（${process.env.PRODUCTION_SCHEDULE_UNC_USER}）连接共享，但文件访问仍被拒：请确认该账号在 ${uncShare.getShareRoot(filePath) || '共享服务器'} 上具有读权限（共享权限与 NTFS 权限都要给）`
      : `共享连接已建立但文件访问被拒：当前运行账户（${getProcessUser()}）在共享服务器上多半不存在，连接以 guest/匿名身份建立。请在 backend/.env 配置 PRODUCTION_SCHEDULE_UNC_USER 与 PRODUCTION_SCHEDULE_UNC_PASSWORD（服务器上真实存在且有读权限的账号）`;
    runtime.lastError = {
      code,
      message: error.message || String(error),
      hint: guestSession ? guestHint : hintForError(code),
      shortHint: guestSession
        ? (credsRejected
          ? '共享账号无读权限，请给该账号授予共享与 NTFS 读权限'
          : '共享连接以 guest 身份建立，文件访问被拒；请在 backend/.env 配置共享账号')
        : shortHintForError(code),
      at: new Date().toISOString(),
      shareEnsure: outcome.ensure
        ? { attempted: outcome.ensure.attempted, ok: outcome.ensure.ok, message: outcome.ensure.message }
        : null
    };
    warnThrottled(`[productionSchedule] 无法读取大日程文件 ${filePath}（${code}，运行账户 ${getProcessUser()}）:`, error);
    cache = {
      filePath,
      loadedAt: nowMs,
      mtimeMs: 0,
      entryCount: 0,
      index: null
    };
    return null;
  }

  const { stat, index, entryCount } = outcome.value;
  runtime.lastError = null;
  runtime.lastSuccessAt = new Date(nowMs).toISOString();
  cache = {
    filePath,
    loadedAt: nowMs,
    mtimeMs: stat.mtimeMs,
    entryCount,
    index
  };
  return index;
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
  const filePath = cache.filePath || getScheduleFilePath();
  return {
    filePath,
    loadedAt: cache.loadedAt ? new Date(cache.loadedAt).toISOString() : '',
    mtimeMs: cache.mtimeMs,
    entryCount: cache.entryCount || 0,
    lastSuccessAt: runtime.lastSuccessAt,
    lastError: runtime.lastError,
    share: uncShare.getShareStatus(filePath, getShareCredentials())
  };
}

// 启动时预热共享连接：后端以服务/计划任务自启（Session 0）时，如果第一次访问
// 共享盘的是普通 UNC 调用，Windows 可能先用 guest/匿名建一条隐式会话，
// 之后再换配置的凭据就会撞 1219，要多绕一轮「断开再重连」。
// 因此启动时若配了凭据，就主动先把连接建好；没配凭据则什么都不做。
function ensureShareReady() {
  const filePath = getScheduleFilePath();
  if (!filePath) return { attempted: false, ok: false, message: '未配置大日程文件路径（PRODUCTION_SCHEDULE_PATH）' };
  const credentials = getShareCredentials();
  if (!credentials.user) return { attempted: false, ok: false, message: '未配置共享凭据，跳过预热' };
  return uncShare.ensureShareAccess(filePath, { ...credentials, force: true });
}

// 同步失败时给用户看的消息：在原来的统一话术后面补上真实错误码与处置建议，
// 否则「Session 0 没凭据」和「Excel 独占打开」看起来一模一样。
function getUnavailableMessage() {
  const { lastError } = runtime;
  if (!lastError) return '无法读取「各产品大日程.xls」，请确认共享目录可访问或联系管理员';
  const shortHint = lastError.shortHint || lastError.hint || '';
  return `无法读取「各产品大日程.xls」（${lastError.code}${shortHint ? `：${shortHint}` : ''}）`;
}

// 裸文件系统探针：绕过 XLSX 解析，分别试 stat / readFile / readdir，
// 用于区分「共享根本连不上」「只有 stat 失败」「文件被独占」这几种情况。
function probeFileSystem(filePath) {
  const result = { stat: { ok: false }, read: { ok: false }, readdir: { ok: false } };
  try {
    const stat = fs.statSync(filePath);
    result.stat = { ok: true, size: stat.size, mtime: new Date(stat.mtimeMs).toISOString(), isFile: stat.isFile() };
  } catch (error) {
    result.stat = { ok: false, code: error.code || '', message: error.message };
  }
  try {
    const buffer = fs.readFileSync(filePath);
    result.read = { ok: true, bytes: buffer.length };
  } catch (error) {
    result.read = { ok: false, code: error.code || '', message: error.message };
  }
  try {
    const dir = require('path').dirname(filePath);
    const files = fs.readdirSync(dir);
    result.readdir = { ok: true, dir, count: files.length, files: files.slice(0, 10) };
  } catch (error) {
    result.readdir = { ok: false, code: error.code || '', message: error.message };
  }
  return result;
}

// 管理员排查用：强制重读一次，返回能直接判断成败的信息（不写库、不改缓存之外的状态）
function probeSchedule() {
  const startedAt = Date.now();
  const entries = getAllScheduleEntries({ forceReload: true });
  const status = getScheduleStatus();
  const sheets = {};
  const months = new Set();
  (entries || []).forEach((entry) => {
    sheets[entry.sheetName] = (sheets[entry.sheetName] || 0) + 1;
    months.add(entry.month);
  });
  return {
    filePath: status.filePath,
    readable: Boolean(entries),
    entryCount: entries ? entries.length : 0,
    sheets,
    monthBlocks: Array.from(months).sort(),
    elapsedMs: Date.now() - startedAt,
    processUser: getProcessUser(),
    lastSuccessAt: status.lastSuccessAt,
    lastError: status.lastError,
    share: status.share,
    raw: probeFileSystem(status.filePath)
  };
}

module.exports = {
  findScheduleEntry,
  getAllScheduleEntries,
  getScheduleStatus,
  getUnavailableMessage,
  probeSchedule,
  ensureShareReady,
  // 导出给测试/排查使用
  _private: {
    parseDeliveryDate,
    extractSpecNumber,
    buildIndex,
    getBlockMonth,
    hintForError
  }
};
