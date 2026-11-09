'use strict';

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

// 熔断器（方案 1B）：共享盘连续读取失败后，停止访问一段时间。
// 实测故障里 160.70 的 SMB 会话失效后，UNC 调用会在内核里挂住不返回；
// 如果每次缓存到期（5 分钟）、每轮失败重试（30 秒）都继续往里冲，
// 只会不断制造新的挂起调用，把线程池彻底占死。连续失败 N 次即熔断，
// 熔断窗口内完全不发 UNC 调用（普通查询返回最近一次成功缓存）。
const BREAKER_FAILURE_THRESHOLD = Math.max(1, Number(process.env.PRODUCTION_SCHEDULE_BREAKER_THRESHOLD) || 3);
const BREAKER_COOLDOWN_MS = Math.max(60 * 1000, Number(process.env.PRODUCTION_SCHEDULE_BREAKER_COOLDOWN_MS) || 60 * 60 * 1000);
const BREAKER_FAILURE_WINDOW_MS = 10 * 60 * 1000;

// 子进程隔离（方案 2）：对共享盘的 stat / readFile / readdir 与 XLSX 解析
// 全部放到 productionScheduleWorker.js 执行，主进程只等结果。
// 共享盘调用挂死时由这里的硬超时终止子进程——挂起的内核调用随子进程消失，
// 主进程的 libuv 线程池不会被占满，HTTP 请求也就不会整体排队。
const WORKER_PATH = require('path').join(__dirname, 'productionScheduleWorker.js');
const WORKER_TIMEOUT_MS = Math.max(5000, Number(process.env.PRODUCTION_SCHEDULE_WORKER_TIMEOUT_MS) || 20000);

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

// 最近一次成功解析的缓存。读取失败时 cache 会被清成空壳（让失败节流生效），
// 但熔断期间普通查询仍应返回这份「最后一次成功的数据」，保证前端可用。
let lastGoodCache = null;

// 熔断器状态：failures 是窗口期内的连续失败次数，openedAt 是熔断开启时刻。
let breaker = {
  failures: 0,
  openedAt: 0,
  lastFailureAt: 0,
  lastReason: ''
};

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
  EHOSTUNREACH: '共享服务器不可达（445/139 端口不通），请确认服务器在线、IP 未变更，或修正 PRODUCTION_SCHEDULE_PATH',
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
  EHOSTUNREACH: '共享服务器不可达',
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

// 同一时刻只允许有一次共享盘读取在飞：多个用户同时查询仕样号时，
// 后来的请求复用同一个 Promise，避免并发对共享盘发起多次读（每次都可能是几十秒）。
let inflightLoad = null;

// 共享服务器可达性结果缓存：主机彻底不通时不能每次请求都花 2 秒探一遍
let reachability = { host: '', ok: true, at: 0, code: '', port: 0, elapsedMs: 0 };
const REACHABILITY_TTL_MS = 60 * 1000;

// 这些错误码说明「主机层面就到不了」，后面再 stat / net use 只是把已经确定的结论
// 重新等一遍（stat 等 SMB 的 30 秒，net use 再等 15 秒）。EACCES / EPERM 不在此列：
// 那是「探测失败但共享可能仍可用」，必须继续尝试凭据连接（见 getScheduleIndex 注释）。
const HOST_UNREACHABLE_CODES = new Set(['ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN']);

async function checkReachability(filePath) {
  const host = uncShare.getShareHost(filePath);
  // 本地磁盘路径（非 UNC）不需要探测
  if (!host) return { ok: true, host: '', code: '', port: 0, elapsedMs: 0 };

  const now = Date.now();
  if (reachability.host === host && now - reachability.at < REACHABILITY_TTL_MS) {
    // 缓存里必须一并带上 code / elapsedMs：只返回 { ok:false } 会让调用方
    // 拿不到失败原因，日志里就会出现「失败（ETIMEDOUT，耗时 undefinedms）」
    return { ...reachability, cached: true };
  }

  const probe = await uncShare.probeHost(host, 2000);
  reachability = {
    host,
    ok: probe.ok,
    at: Date.now(),
    code: probe.code || '',
    port: probe.port || 0,
    elapsedMs: probe.elapsedMs || 0
  };
  if (!probe.ok) {
    console.warn(`[productionSchedule] 共享服务器 ${host} 不可达（${probe.code}，探测耗时 ${probe.elapsedMs}ms）`);
  }
  return { ...reachability };
}

function recordFailure(filePath, nowMs, code, error) {
  runtime.lastError = {
    code,
    message: error && error.message ? error.message : String(error || ''),
    hint: hintForError(code),
    shortHint: shortHintForError(code),
    at: new Date().toISOString(),
    shareEnsure: null
  };
  warnThrottled(`[productionSchedule] 无法读取大日程文件 ${filePath}（${code}，运行账户 ${getProcessUser()}）:`, error);
  breakerRecordFailure(code);
  cache = {
    filePath,
    loadedAt: nowMs,
    mtimeMs: 0,
    entryCount: 0,
    index: null
  };
}

function isBreakerOpen(now = Date.now()) {
  return breaker.failures >= BREAKER_FAILURE_THRESHOLD
    && breaker.openedAt > 0
    && now - breaker.openedAt < BREAKER_COOLDOWN_MS;
}

function breakerRecordFailure(code) {
  const now = Date.now();
  // 隔了很久的失败不算「连续」：前一天偶发一次失败不应推动熔断
  if (now - breaker.lastFailureAt > BREAKER_FAILURE_WINDOW_MS) breaker.failures = 0;
  breaker.failures += 1;
  breaker.lastFailureAt = now;
  breaker.lastReason = code || '';
  if (breaker.failures >= BREAKER_FAILURE_THRESHOLD) {
    // 冷却期内不会再有新的尝试；冷却到期后的半开探测若再次失败，重新计时
    const stillOpen = breaker.openedAt > 0 && now - breaker.openedAt < BREAKER_COOLDOWN_MS;
    if (!stillOpen) {
      console.warn(
        `[productionSchedule] 熔断开启：连续 ${breaker.failures} 次读取失败（${breaker.lastReason}），`
        + `${Math.round(BREAKER_COOLDOWN_MS / 60000)} 分钟内不再访问共享盘，普通查询改用最近一次成功缓存`
      );
      breaker.openedAt = now;
    }
  }
}

function breakerRecordSuccess() {
  if (!breaker.failures && !breaker.openedAt) return;
  if (breaker.failures >= BREAKER_FAILURE_THRESHOLD) {
    console.log('[productionSchedule] 熔断恢复：共享盘重新可读，恢复实时读取');
  }
  breaker.failures = 0;
  breaker.openedAt = 0;
}

/**
 * 在子进程里执行一次共享盘任务，主进程用硬超时兜底。
 * 子进程内的调用即使在内核里挂死，也只是这个子进程不返回；
 * 超时后 kill 掉它，主进程的线程池保持干净。
 * @param {object} job
 * @returns {Promise<object>} 子进程回传的消息；超时/异常返回 { ok: false, error, timedOut? }
 */
function runScheduleWorker(job) {
  return new Promise((resolve) => {
    let child = null;
    let timer = null;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (child) {
        try { child.kill(); } catch (error) { /* 已退出时忽略 */ }
      }
      resolve(result);
    };

    try {
      child = require('child_process').fork(WORKER_PATH, [], {
        // stdout/stderr 直接继承：子进程里的告警（工作表解析失败等）落在后端日志里
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        windowsHide: true,
        env: process.env
      });
    } catch (error) {
      finish({ ok: false, error: { code: error.code || 'WORKER_SPAWN_FAILED', message: error.message } });
      return;
    }

    timer = setTimeout(() => {
      finish({
        timedOut: true,
        ok: false,
        error: {
          code: 'ETIMEDOUT',
          message: `读取大日程子进程超过 ${WORKER_TIMEOUT_MS}ms 未返回（共享盘调用疑似挂死），已强制终止`
        }
      });
    }, WORKER_TIMEOUT_MS);

    child.on('message', (message) => finish(message || { ok: false, error: { code: 'WORKER_EMPTY', message: '子进程返回空结果' } }));
    child.on('error', (error) => {
      finish({ ok: false, error: { code: error.code || 'WORKER_ERROR', message: error.message } });
    });
    child.on('exit', (code, signal) => {
      finish({ ok: false, error: { code: 'WORKER_EXITED', message: `大日程子进程提前退出（code=${code}, signal=${signal}）` } });
    });

    try {
      child.send(job);
    } catch (error) {
      finish({ ok: false, error: { code: 'WORKER_SEND_FAILED', message: error.message } });
    }
  });
}

function buildIndexFromEntries(entries) {
  const index = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    let list = index.get(entry.specNumber);
    if (!list) {
      list = [];
      index.set(entry.specNumber, list);
    }
    list.push(entry);
  }
  return index;
}


/**
 * 读取并解析大日程（异步）。
 *
 * 这里必须是异步：文件在网络共享上，同步 fs.statSync / XLSX.readFile 会占住
 * Node 的事件循环，共享服务器不可达时一次就阻塞 30 秒以上，期间所有 HTTP 请求
 * 一起卡死——前端看到的是「页面很慢 + 查询仕样号总是失败」，而 services 的
 * Promise.race 15 秒超时也根本没机会触发（定时器同样在事件循环里）。
 *
 * @returns {Promise<Map<string, object[]>|null>}
 */
async function getScheduleIndex(now = new Date(), options = {}) {
  const filePath = getScheduleFilePath();
  if (!filePath) return null;

  const nowMs = Date.now();
  const cacheMs = getCacheMs();
  const forceReload = options.forceReload === true;

  if (!forceReload && cache.filePath === filePath && cache.index && nowMs - cache.loadedAt < cacheMs) {
    return cache.index;
  }

  // 熔断期间（方案 1B）：完全不发 UNC 调用。
  //   - 后台/手动「同步生产大日程」这类强制刷新：返回失败，宁可报不可用，
  //     也不拿可能过期的数据去落库；
  //   - 普通查询：返回最近一次成功缓存（可能已过期），页面继续可用；
  //   - 管理员诊断（probeSchedule）用 bypassBreaker 做一次半开探测。
  // 必须放在「失败节流」之前：否则熔断刚开启的 30 秒内普通查询仍会被
  // 失败节流挡成 null，而不是拿到上一次成功的数据。
  if (!options.bypassBreaker && isBreakerOpen(nowMs)) {
    warnThrottled(
      `[productionSchedule] 熔断中（连续失败 ${breaker.failures} 次，最后错误 ${breaker.lastReason}），跳过共享盘访问`,
      ''
    );
    if (forceReload) return null;
    if (lastGoodCache && lastGoodCache.filePath === filePath && lastGoodCache.index) {
      return lastGoodCache.index;
    }
    return null;
  }

  // 读取失败后短时间内不重复访问网络共享目录，避免拖慢每个请求
  if (!forceReload && cache.filePath === filePath && !cache.index && nowMs - cache.loadedAt < FAILURE_RETRY_MS) {
    return null;
  }

  if (inflightLoad) return inflightLoad;

  inflightLoad = (async () => {
    // 快速探测共享服务器 445/139 端口是否可达，结果仅作诊断日志。
    // 注意：探测失败（EACCES/EPERM/ETIMEDOUT）≠ 共享真的完全不可用——
    //   后端以计划任务 SYSTEM/Administrator 自启时，访问共享盘会先建立一条
    //   guest/匿名隐式会话，此时 probeHost 可能返回 EACCES，但 .env 里
    //   配置的 PRODUCTION_SCHEDULE_UNC_USER/PASSWORD 凭据 net use 之后仍然能
    //   成功。所以探测失败不能阻断下面的 withShareRetryAsync，必须给
    //   uncShare 的 1219 断开重连 + 凭据连接留一条活路。
    const reach = await checkReachability(filePath);
    if (!reach.ok) {
      const hostUnreachable = HOST_UNREACHABLE_CODES.has(reach.code);
      console.warn(
        `[productionSchedule] 快速探测 ${reach.host} 失败（${reach.code || 'ETIMEDOUT'}，耗时 ${reach.elapsedMs}ms）` +
        (hostUnreachable ? '，主机整体不可达，本次跳过共享访问' : '，继续尝试凭据连接...')
      );
      // 探测结果写入 runtime.lastError 作为诊断信息；真实的失败原因（net use 还是 fs.stat）
      // 会在 withShareRetryAsync 的 recordFailure 里被覆盖，所以这里只写不 return
      // ——但「主机整体不可达」是个已经确定的结论，再等 45 秒毫无意义。
      // 时间戳必须用「现在」而不是本次请求的起始时刻：否则一次耗时超过
      // FAILURE_RETRY_MS 的失败，写进缓存的 loadedAt 就已经是过期的，
      // 失败节流永远不生效，每次请求都要重新吃满一轮超时。
      recordFailure(filePath, Date.now(), reach.code || 'EHOSTUNREACH', new Error(`快速探测 ${reach.host} 失败（${reach.code || 'ETIMEDOUT'}）`));
      if (hostUnreachable) return null;
    }

    // 实际触达共享盘的 stat / readFile / XLSX 解析都在子进程里完成（方案 2）。
    // 这里只等 IPC 结果，最长等 WORKER_TIMEOUT_MS；超时即杀子进程并计为一次失败。
    const outcome = await runScheduleWorker({
      type: 'load',
      filePath,
      nowMs,
      expectedMtimeMs: cache.filePath === filePath && cache.index ? cache.mtimeMs : 0,
      credentials: getShareCredentials()
    });

    if (!outcome.ok) {
      const error = outcome.error || {};
      const code = error.code || 'ERROR';
      const ensure = outcome.ensure || null;
      const guestSession = Boolean(ensure && ensure.ok
        && (code === 'EPERM' || code === 'EACCES'));
      const credsRejected = Boolean(guestSession && ensure.credsConfigured);
      const guestHint = credsRejected
        ? `已用配置的账号（${process.env.PRODUCTION_SCHEDULE_UNC_USER}）连接共享，但文件访问仍被拒：请确认该账号在 ${uncShare.getShareRoot(filePath) || '共享服务器'} 上具有读权限（共享权限与 NTFS 权限都要给）`
        : `共享连接已建立但文件访问被拒：当前运行账户（${getProcessUser()}）在共享服务器上多半不存在，连接以 guest/匿名身份建立。请在 backend/.env 配置 PRODUCTION_SCHEDULE_UNC_USER 与 PRODUCTION_SCHEDULE_UNC_PASSWORD（服务器上真实存在且有读权限的账号）`;

      recordFailure(filePath, Date.now(), code, error);
      runtime.lastError.hint = guestSession ? guestHint : hintForError(code);
      runtime.lastError.shortHint = guestSession
        ? (credsRejected
          ? '共享账号无读权限，请给该账号授予共享与 NTFS 读权限'
          : '共享连接以 guest 身份建立，文件访问被拒；请在 backend/.env 配置共享账号')
        : shortHintForError(code);
      runtime.lastError.timedOut = Boolean(outcome.timedOut) || code === 'ETIMEDOUT';
      runtime.lastError.shareEnsure = ensure
        ? { attempted: ensure.attempted, ok: ensure.ok, message: ensure.message }
        : null;
      return null;
    }

    const value = outcome.value || {};
    let index;
    let entryCount;
    if (value.reused) {
      // 文件 mtime 未变：复用父进程里已解析的缓存，不再整本读取
      if (!(cache.filePath === filePath && cache.index)) return null;
      index = cache.index;
      entryCount = cache.entryCount;
    } else {
      index = buildIndexFromEntries(value.entries);
      entryCount = Number(value.entryCount) || countEntries(index);
    }

    runtime.lastError = null;
    runtime.lastSuccessAt = new Date(nowMs).toISOString();
    cache = {
      filePath,
      loadedAt: nowMs,
      mtimeMs: Number(value.mtimeMs) || 0,
      entryCount,
      index
    };
    // 熔断期间普通查询靠这份快照继续服务；成功后熔断器归零
    lastGoodCache = cache;
    breakerRecordSuccess();
    return index;
  })();

  try {
    return await inflightLoad;
  } finally {
    inflightLoad = null;
  }
}

/**
 * 按仕样号取大日程条目（异步）。
 * @param {string} specNumber
 * @param {string} [preferredMonth] YYYY-MM
 */
async function findScheduleEntry(specNumber, preferredMonth) {
  const normalizedSpec = String(specNumber === null || specNumber === undefined ? '' : specNumber).trim();
  if (!normalizedSpec) return null;

  const index = await getScheduleIndex();
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
async function getAllScheduleEntries(options = {}) {
  const index = await getScheduleIndex(options.now || new Date(), {
    forceReload: options.forceReload === true,
    // 管理员诊断（probeSchedule）需要绕过熔断做一次真正的半开探测
    bypassBreaker: options.bypassBreaker === true
  });
  if (!index) return null;

  const entries = [];
  for (const list of index.values()) {
    for (const entry of list) entries.push(entry);
  }
  return entries;
}

/**
 * 只读地看一眼共享可达性缓存，不发起任何探测。
 *
 * 用途：普通入口（主页面/台账/快速取号）的仕样号查询默认不碰大日程，
 * 只有「PDF 未命中」时才值得回退问一次表格。但回退绝不能把大日程的故障面
 * 带回来——所以调用方先用这个函数判断「70 现在是否已知可达」：
 * 缓存为空（不知道）或已知不可达时，直接放弃回退，零延迟代价。
 *
 * @param {string} [filePath] 默认取配置中的大日程路径
 * @returns {{ known: boolean, ok: boolean, host: string }}
 */
function getReachabilityHint(filePath) {
  const target = filePath || getScheduleFilePath();
  const host = uncShare.getShareHost(target);
  // 本地磁盘路径不存在「可达性」问题
  if (!host) return { known: true, ok: true, host: '' };

  const fresh = reachability.host === host && Date.now() - reachability.at < REACHABILITY_TTL_MS;
  return { known: fresh, ok: fresh ? reachability.ok : false, host };
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
    breaker: {
      open: isBreakerOpen(),
      failures: breaker.failures,
      threshold: BREAKER_FAILURE_THRESHOLD,
      openedAt: breaker.openedAt ? new Date(breaker.openedAt).toISOString() : '',
      cooldownMs: BREAKER_COOLDOWN_MS,
      lastReason: breaker.lastReason,
      workerTimeoutMs: WORKER_TIMEOUT_MS
    },
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
// 与读取路径一样放进子进程执行：管理员点一次排障也不能把后端卡死。
async function probeFileSystem(filePath) {
  const host = uncShare.getShareHost(filePath);
  const probe = await runScheduleWorker({ type: 'probeFs', filePath });
  if (!probe.ok) {
    const error = probe.error || {};
    return {
      host: host ? await uncShare.probeHost(host, 2000) : { ok: true, port: 0, elapsedMs: 0, code: '' },
      stat: { ok: false },
      read: { ok: false },
      readdir: { ok: false },
      workerError: {
        code: error.code || 'ERROR',
        message: error.message || '',
        timedOut: Boolean(probe.timedOut)
      }
    };
  }
  return {
    host: host ? await uncShare.probeHost(host, 2000) : { ok: true, port: 0, elapsedMs: 0, code: '' },
    ...(probe.value || {})
  };
}

// 管理员排查用：强制重读一次，返回能直接判断成败的信息（不写库、不改缓存之外的状态）
async function probeSchedule() {
  const startedAt = Date.now();
  // bypassBreaker：熔断期间管理员手动诊断仍应真的去读一次（半开探测），
  // 成功则熔断自动恢复，失败则重新计时
  const entries = await getAllScheduleEntries({ forceReload: true, bypassBreaker: true });
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
    raw: await probeFileSystem(status.filePath)
  };
}

module.exports = {
  findScheduleEntry,
  getAllScheduleEntries,
  getScheduleStatus,
  getReachabilityHint,
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
