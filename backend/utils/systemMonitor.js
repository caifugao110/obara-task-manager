/**
 * 系统运行状态监测（状态监测）
 *
 * 目标：回答「后端什么时候断过、断了多久、断之前稳了多久、为什么断、前端到底有多少访问」。
 *
 * 设计要点：
 * 1) 采集写入独立表（monitor_*），不碰 kv_store 整库快照，避免第二个审计日志式的写放大。
 * 2) 后端被强杀时没有机会写「我停了」，因此可用性以**心跳样本**为准：
 *    每 30 秒写一条 monitor_samples。样本之间出现长间隔 = 那段时间后端不在。
 * 3) 重启本身是明确事件：启动时写 boot 事件，并与上一轮会话最后一条样本/退出记录比对，
 *    即使进程 1 秒内被 nodemon 拉起（心跳间隔看不出断档），也能判定出一次断开。
 * 4) 断开原因不做猜测式编造，只给「可追溯的证据 + 置信度」：
 *    logs/backend-crash.log（未捕获异常）、logs/backend-exit.log（退出码）、
 *    断开前的内存曲线、断开前的 5xx 突增、以及是否为计划内停止。
 * 5) 前端流量在进程内按分钟聚合，每 20 秒批量落盘，请求路径不参与热路径写库。
 *
 * 数据保留：样本与流量保留 200 天（覆盖「近半年」并留余量），事件长期保留。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const CRASH_LOG_PATH = path.join(LOG_DIR, 'backend-crash.log');
const EXIT_LOG_PATH = path.join(LOG_DIR, 'backend-exit.log');
// 后端标准输出（start.bat 重定向）。nodemon 的重启提示只写在这里，且不带时间戳，
// 但仍可作为「确实是 nodemon 主动重启」的直接书面证据。
const BACKEND_LOG_PATH = path.join(LOG_DIR, 'backend.log');
// 假死探测脚本（backend-health-probe.bat）的日志：连续 N 次探测失败后会 taskkill 整棵树。
// 进程被强杀时不会执行退出钩子，是唯一能证明「这次断开是看门狗干的」的书面证据。
const WATCHDOG_LOG_PATH = path.join(LOG_DIR, 'backend-watchdog.log');
// 手动停止标记：stop.bat 在 taskkill /F 之前写入。
// taskkill /F 直接终止进程树，SIGINT/SIGTERM 处理器不会执行，进程既写不了 graceful_stop
// 也写不了退出码与崩溃堆栈；没有这份标记时，一次人为停机只能被判成「进程被外部强制结束」，
// 与真正的故障无法区分。标记由脚本侧落盘，即使后端被瞬间杀掉也一定可读。
const MANUAL_STOP_PATH = path.join(LOG_DIR, 'manual-stop.json');
// 心跳间隔 30 秒，断开起点取最后一次心跳，标记时刻通常比它晚几秒到几十秒；
// 90 秒窗口既吸收这个误差，又窄到不会把上一次手动停机错认成这一次。
const MANUAL_STOP_MATCH_MS = 90 * 1000;

const RETENTION_DAYS = 200;
// 分钟级流量明细保留天数（长期趋势由小时汇总表承担）
const MINUTE_RETENTION_DAYS = 35;
// 自动清理节奏：删除历史数据本身很便宜，但没必要更频繁
const CLEANUP_INTERVAL_HOURS = 6;
// 巡检间隔：每 10 分钟判断一次「是否已到清理时间」，避免用一次性计时器被重启清零
const CLEANUP_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const SAMPLE_INTERVAL_MS = 30 * 1000;
const FLUSH_INTERVAL_MS = 20 * 1000;
const LAG_INTERVAL_MS = 2000;
// 同一轮会话内部，两条样本间隔超过该值即视为「后端无响应」空窗
const GAP_THRESHOLD_MS = 90 * 1000;
// 慢请求阈值（前端体验分界）
const SLOW_MS = 1500;
// 读取日志尾部字节数上限：backend-crash.log 历史上曾膨胀到数百 MB，
// 只读尾部既能覆盖最近中断，也不会把整份文件读进内存。
const LOG_TAIL_BYTES = 2 * 1024 * 1024;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const PRESET_DAYS = {
  today: 1,
  '3d': 3,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '180d': 180
};

const PRESET_LABELS = {
  today: '今日',
  '3d': '近三天',
  '7d': '近一周',
  '30d': '近一月',
  '90d': '近三月',
  '180d': '近半年',
  day: '指定日期'
};

const nowMs = () => Date.now();
const toIso = (ms) => new Date(ms).toISOString();
const floorTo = (ms, size) => Math.floor(ms / size) * size;

// 进程退出/停止时顺手记录的资源快照：用于事后判断「是内存涨死了还是外部杀的」
const countActiveHandles = () => {
  try {
    return typeof process._getActiveHandles === 'function' ? process._getActiveHandles().length : null;
  } catch {
    return null;
  }
};

const countActiveRequests = () => {
  try {
    return typeof process._getActiveRequests === 'function' ? process._getActiveRequests().length : null;
  } catch {
    return null;
  }
};

/** 结束信号的中文说明：决定这条记录是「开发热重载」还是「运维停止」 */
const signalLabel = (signal) => {
  const value = String(signal || '').toUpperCase();
  if (value.includes('SIGUSR2')) return '代码热重载（nodemon 检测到文件变更）';
  if (value.includes('SIGINT')) return '运维停止（Ctrl+C / stop.bat）';
  if (value.includes('SIGTERM')) return '运维停止（SIGTERM）';
  if (!value) return '未知停止方式';
  return `收到 ${value} 信号`;
};

/** 当前进程的启动方式：npm 脚本（开发）还是直接 node（生产/服务脚本） */
const detectLauncher = () => {
  const lifecycle = process.env.npm_lifecycle_event || '';
  if (lifecycle) return `npm run ${lifecycle}`;
  const argv = process.argv.slice(0, 3).join(' ');
  if (/nodemon/i.test(argv)) return 'nodemon';
  return 'node';
};

/** 秒 -> 「1 天 2 小时 3 分」，用于事件描述的文案 */
const formatSpan = (sec) => {
  const total = Math.max(0, Math.round(Number(sec) || 0));
  if (total < 60) return `${total} 秒`;
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分 ${total % 60} 秒`;
};

// ---------------------------------------------------------------------------
// 表结构
// ---------------------------------------------------------------------------
let tablesReady = false;

const ensureTables = () => {
  if (tablesReady) return db.getRawDb();
  const raw = db.getRawDb();
  raw.exec(`
    CREATE TABLE IF NOT EXISTS monitor_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts_ms INTEGER NOT NULL,
      ts TEXT NOT NULL,
      boot_id TEXT,
      uptime_sec INTEGER,
      rss_mb REAL,
      heap_mb REAL,
      lag_ms REAL,
      db_ms REAL,
      sockets INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_samples_ms ON monitor_samples(ts_ms);

    CREATE TABLE IF NOT EXISTS monitor_events (
      id TEXT PRIMARY KEY,
      ts_ms INTEGER NOT NULL,
      ts TEXT NOT NULL,
      type TEXT NOT NULL,
      boot_id TEXT,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_events_ms ON monitor_events(ts_ms);

    CREATE TABLE IF NOT EXISTS monitor_traffic_min (
      bucket_ms INTEGER PRIMARY KEY,
      requests INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0,
      slow INTEGER NOT NULL DEFAULT 0,
      duration_sum INTEGER NOT NULL DEFAULT 0,
      duration_max INTEGER NOT NULL DEFAULT 0,
      clients INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS monitor_traffic_path (
      hour_ms INTEGER NOT NULL,
      path TEXT NOT NULL,
      method TEXT NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0,
      duration_sum INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (hour_ms, path, method)
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_traffic_path_ms ON monitor_traffic_path(hour_ms);

    CREATE TABLE IF NOT EXISTS monitor_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- 小时级汇总：图表只读这张表，避免「近半年」查询扫描 50 万行原始样本。
    -- 每 30 秒一次 upsert（累加），代价与写一条采样相当。
    CREATE TABLE IF NOT EXISTS monitor_samples_hour (
      hour_ms INTEGER PRIMARY KEY,
      samples INTEGER NOT NULL DEFAULT 0,
      rss_sum REAL NOT NULL DEFAULT 0,
      rss_max REAL NOT NULL DEFAULT 0,
      heap_sum REAL NOT NULL DEFAULT 0,
      lag_sum REAL NOT NULL DEFAULT 0,
      lag_max REAL NOT NULL DEFAULT 0,
      db_sum REAL NOT NULL DEFAULT 0,
      sockets_max INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS monitor_traffic_hour (
      hour_ms INTEGER PRIMARY KEY,
      requests INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0,
      slow INTEGER NOT NULL DEFAULT 0,
      duration_sum INTEGER NOT NULL DEFAULT 0,
      duration_max INTEGER NOT NULL DEFAULT 0,
      clients INTEGER NOT NULL DEFAULT 0
    );
  `);
  tablesReady = true;
  backfillHourRollups(raw);
  return raw;
};

/**
 * 一次性把已有的分钟/样本数据汇总进小时表。
 * 只在升级后的首次启动执行一次（marker 写入 monitor_meta）。
 */
const backfillHourRollups = (raw) => {
  try {
    const done = raw.prepare("SELECT value FROM monitor_meta WHERE key = 'hourRollupBackfilled'").get();
    if (done) return;
    raw.exec(`
      INSERT INTO monitor_samples_hour (hour_ms, samples, rss_sum, rss_max, heap_sum, lag_sum, lag_max, db_sum, sockets_max)
      SELECT (ts_ms / 3600000) * 3600000 AS h, COUNT(*), SUM(rss_mb), MAX(rss_mb), SUM(heap_mb),
             SUM(lag_ms), MAX(lag_ms), SUM(db_ms), MAX(sockets)
      FROM monitor_samples GROUP BY h
      ON CONFLICT(hour_ms) DO UPDATE SET
        samples = excluded.samples, rss_sum = excluded.rss_sum, rss_max = excluded.rss_max,
        heap_sum = excluded.heap_sum, lag_sum = excluded.lag_sum, lag_max = excluded.lag_max,
        db_sum = excluded.db_sum, sockets_max = excluded.sockets_max;

      INSERT INTO monitor_traffic_hour (hour_ms, requests, errors, slow, duration_sum, duration_max, clients)
      SELECT (bucket_ms / 3600000) * 3600000 AS h, SUM(requests), SUM(errors), SUM(slow),
             SUM(duration_sum), MAX(duration_max), MAX(clients)
      FROM monitor_traffic_min GROUP BY h
      ON CONFLICT(hour_ms) DO UPDATE SET
        requests = excluded.requests, errors = excluded.errors, slow = excluded.slow,
        duration_sum = excluded.duration_sum, duration_max = excluded.duration_max, clients = excluded.clients;
    `);
    raw.prepare("INSERT INTO monitor_meta (key, value) VALUES ('hourRollupBackfilled', ?) ON CONFLICT(key) DO NOTHING")
      .run(String(nowMs()));
  } catch (error) {
    // 回填失败不影响新数据（新数据会实时写入小时表），下次启动再试
    tablesReady = true;
  }
};

const readMeta = (key) => {
  try {
    const row = ensureTables().prepare('SELECT value FROM monitor_meta WHERE key = ?').get(key);
    return row ? row.value : null;
  } catch {
    return null;
  }
};

const writeMeta = (key, value) => {
  try {
    ensureTables()
      .prepare('INSERT INTO monitor_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, String(value));
  } catch {
    // 元数据写入失败不影响主流程
  }
};

// ---------------------------------------------------------------------------
// 运行时状态
// ---------------------------------------------------------------------------
let bootId = null;
let bootedAtMs = null;
let initialized = false;
let socketCountProvider = () => 0;
let lastSampleRssMb = 0;
let lastSampleHeapMb = 0;
let lastSampleLagMs = 0;
let lastSampleDbMs = 0;
let lastSampleAtMs = 0;
// 本轮会话的第一条样本不参与断档判定：这段时间的空窗已由启动时与上一轮会话的比对处理
let skipGapCheckOnce = true;

const lagWindow = [];

// 进程内流量聚合（每 FLUSH_INTERVAL_MS 落盘一次）
const minuteBuffer = new Map(); // bucketMs -> { requests, errors, slow, durationSum, durationMax, clients:Set }
const pathBuffer = new Map(); // `${hourMs}|${method}|${path}` -> { hourMs, path, method, requests, errors, durationSum }
let bufferDirty = false;

const recordEvent = (type, detail) => {
  try {
    const raw = ensureTables();
    raw.prepare(
      'INSERT INTO monitor_events (id, ts_ms, ts, type, boot_id, detail) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(crypto.randomUUID(), nowMs(), toIso(nowMs()), type, bootId, JSON.stringify(detail || {}));
  } catch {
    // 事件写入失败不能拖垮主流程
  }
};

// ---------------------------------------------------------------------------
// 日志取证
// ---------------------------------------------------------------------------
// 只读文件尾部，按行解析时间戳。返回 [{ tsMs, raw }]，按时间升序。
const readLogTail = (filePath) => {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0) return [];
    const start = Math.max(0, stat.size - LOG_TAIL_BYTES);
    const length = stat.size - start;
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(length);
    try {
      fs.readSync(fd, buffer, 0, length, start);
    } finally {
      fs.closeSync(fd);
    }
    let text = buffer.toString('utf8');
    if (start > 0) {
      // 丢弃被截断的首行
      const firstBreak = text.indexOf('\n');
      text = firstBreak >= 0 ? text.slice(firstBreak + 1) : '';
    }
    const lines = [];
    for (const raw of text.split(/\r?\n/)) {
      if (!raw.trim()) continue;
      const match = /^\[([^\]]+)\]/.exec(raw);
      if (!match) continue;
      const tsMs = new Date(match[1]).getTime();
      if (!Number.isFinite(tsMs)) continue;
      lines.push({ tsMs, raw: raw.slice(0, 400) });
    }
    lines.sort((a, b) => a.tsMs - b.tsMs);
    return lines;
  } catch {
    return [];
  }
};

/** 只取文件尾部原始文本（不解析时间戳），用于识别 nodemon 这类无时间戳的输出 */
const readLogTailText = (filePath) => {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0) return '';
    const start = Math.max(0, stat.size - LOG_TAIL_BYTES);
    const length = stat.size - start;
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(length);
    try {
      fs.readSync(fd, buffer, 0, length, start);
    } finally {
      fs.closeSync(fd);
    }
    let text = buffer.toString('utf8');
    if (start > 0) {
      const firstBreak = text.indexOf('\n');
      text = firstBreak >= 0 ? text.slice(firstBreak + 1) : '';
    }
    return text;
  } catch {
    return '';
  }
};

// ---------------------------------------------------------------------------
// 看门狗取证
// ---------------------------------------------------------------------------
// backend-health-probe.bat 写的是 Windows 的 %date% %time%：
//   [周三 2026/11/11 23:09:23.08] [probe] [FATAL] backend unresponsive 3 consecutive probes ...
// 前面可能带本地化的星期，年份在前，小数部分是「百分秒」（两位，不是毫秒），
// new Date() 解析不了这种串，只能按字段自己拼。
// 若某台机器的区域设置把 %date% 输出成「11/11/2026」（月在前），这里匹配不到「年份在前」的
// 形式会返回 null —— 结果只是少一条证据、退回原有判定，不会因此误判。
const WIN_LOG_TS = /^\[[^\]]*?(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?\]/;

const parseWindowsLogTimestamp = (raw) => {
  const match = WIN_LOG_TS.exec(raw);
  if (!match) return null;
  const fracText = match[7] || '';
  // 两位 = 百分秒，三位 = 毫秒
  const fracMs = fracText ? Number(fracText.length === 2 ? `${fracText}0` : fracText.padEnd(3, '0')) : 0;
  const ms = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
    fracMs
  ).getTime();
  return Number.isFinite(ms) ? ms : null;
};

/** 时刻 -> 「23:09:23」，用于证据文案 */
const clockOf = (ms) => {
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

// 结果缓存 5 秒：一次总览查询会对每条断开记录都问一次，没必要反复读同一份文件
let watchdogCache = { at: 0, items: [] };
const WATCHDOG_CACHE_TTL = 5000;

/**
 * 看门狗强杀记录（只取 FATAL 行），按时间升序。
 * @returns {{ tsMs: number, fails: number|null, pid: string, port: string, raw: string }[]}
 */
const readWatchdogKills = () => {
  const now = nowMs();
  if (now - watchdogCache.at < WATCHDOG_CACHE_TTL) return watchdogCache.items;

  const items = [];
  for (const raw of readLogTailText(WATCHDOG_LOG_PATH).split(/\r?\n/)) {
    if (!raw.includes('killing process tree')) continue;
    const tsMs = parseWindowsLogTimestamp(raw);
    if (tsMs === null) continue;
    const fails = /(\d+)\s+consecutive probes/.exec(raw);
    const pid = /\(PID (\d+)\)/.exec(raw);
    const port = /on port (\d+)/.exec(raw);
    items.push({
      tsMs,
      fails: fails ? Number(fails[1]) : null,
      pid: pid ? pid[1] : '',
      port: port ? port[1] : '',
      raw: raw.slice(0, 400)
    });
  }
  items.sort((a, b) => a.tsMs - b.tsMs);
  watchdogCache = { at: now, items };
  return items;
};

/**
 * 读取 stop.bat 落下的手动停止标记。
 * 文件由脚本侧写入，只读不改；解析失败一律当作「没有标记」，绝不因脏文件影响判定。
 * 缓存按 mtime 失效：同一次总览里每条断开记录都会问一次，没必要反复解析。
 * @returns {{ tsMs: number, at: string, source: string, operator: string|null, targets: string[] }|null}
 */
let manualStopCache = { at: 0, mtimeMs: -1, value: null };
const readManualStopMarker = () => {
  let stat;
  try {
    stat = fs.statSync(MANUAL_STOP_PATH);
  } catch {
    return null;
  }
  if (manualStopCache.mtimeMs === stat.mtimeMs && nowMs() - manualStopCache.at < 5000) {
    return manualStopCache.value;
  }

  let value = null;
  try {
    const raw = JSON.parse(fs.readFileSync(MANUAL_STOP_PATH, 'utf8'));
    const tsMs = Number(raw && raw.tsMs);
    if (Number.isFinite(tsMs) && tsMs > 0) {
      value = {
        tsMs,
        at: String((raw && raw.at) || '') || clockOf(tsMs),
        source: String((raw && raw.source) || 'stop.bat'),
        operator: String((raw && raw.user) || '').trim() || null,
        targets: Array.isArray(raw && raw.targets) ? raw.targets.map(String) : []
      };
    }
  } catch {
    value = null;
  }
  manualStopCache = { at: nowMs(), mtimeMs: stat.mtimeMs, value };
  return value;
};

/**
 * 把标记匹配到某一次断开上。
 * 下界：早于本次断开起点 90 秒的标记属于上一次停机，不能算；
 * 上界：晚于恢复时刻的标记与本次断开无关（脚本可能在进程停稳后才跑）。
 */
const matchManualStop = (startMs, endMs) => {
  const marker = readManualStopMarker();
  if (!marker) return null;
  if (marker.tsMs < startMs - MANUAL_STOP_MATCH_MS) return null;
  if (marker.tsMs > endMs + 2000) return null;
  return marker;
};

/**
 * 判断「本次启动」是不是 nodemon 拉起来的。
 *
 * nodemon 的 `[nodemon] restarting due to changes...` / `[nodemon] starting ...`
 * 行本身没有时间戳，事后无法定位到具体时刻；但在启动的那一瞬间，
 * 这几行一定是日志尾部紧邻的内容。所以在 recordBoot 里读一次尾部即可把
 * 「本次启动由 nodemon 重启触发」这条证据固化进 boot 事件，
 * 后续每条断开记录都能拿到确定的、不依赖时间窗的书面依据。
 */
const detectNodemonBootSignal = () => {
  const stripAnsi = (text) => text.replace(/\u001b\[[0-9;]*m/g, '');
  const lines = readLogTailText(BACKEND_LOG_PATH)
    .split(/\r?\n/)
    .map((line) => stripAnsi(line).trim())
    .filter(Boolean);
  // 只回看末尾几行：本进程自己会先打印若干行启动日志
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 6); i -= 1) {
    if (/\[nodemon\]/i.test(lines[i])) return lines[i].slice(0, 120);
  }
  return null;
};

// ---------------------------------------------------------------------------
// 采集
// ---------------------------------------------------------------------------
const takeSample = () => {
  try {
    const raw = ensureTables();
    const mem = process.memoryUsage();
    const rssMb = Math.round((mem.rss / 1048576) * 10) / 10;
    const heapMb = Math.round((mem.heapUsed / 1048576) * 10) / 10;

    // 事件循环延迟：最近若干次 2s 定时器的实际漂移均值
    const lagAvg = lagWindow.length
      ? lagWindow.reduce((sum, item) => sum + item, 0) / lagWindow.length
      : 0;

    const dbStart = process.hrtime.bigint();
    try {
      raw.prepare('SELECT 1 AS ok').get();
    } catch {
      // 忽略：下面按最差情况记录
    }
    const dbMs = Number(process.hrtime.bigint() - dbStart) / 1e6;

    const ms = nowMs();

    // 同一进程内的心跳断档：这里能第一时间发现（例如事件循环被长任务阻塞、
    // 数据库写锁等待、宿主机休眠），记成事件后历史查询就只需读事件表，
    // 不必在「近半年」时对 50 万行样本做窗口函数扫描。
    if (skipGapCheckOnce) {
      skipGapCheckOnce = false;
    } else if (lastSampleAtMs && ms - lastSampleAtMs > GAP_THRESHOLD_MS) {
      recordEvent('stall', {
        startMs: lastSampleAtMs,
        endMs: ms,
        durationSec: Math.round((ms - lastSampleAtMs) / 1000)
      });
    }

    raw.prepare(`
      INSERT INTO monitor_samples (ts_ms, ts, boot_id, uptime_sec, rss_mb, heap_mb, lag_ms, db_ms, sockets)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ms,
      toIso(ms),
      bootId,
      Math.round(process.uptime()),
      rssMb,
      heapMb,
      Math.round(lagAvg * 10) / 10,
      Math.round(dbMs * 10) / 10,
      socketCountProvider() || 0
    );

    raw.prepare(`
      INSERT INTO monitor_samples_hour (hour_ms, samples, rss_sum, rss_max, heap_sum, lag_sum, lag_max, db_sum, sockets_max)
      VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(hour_ms) DO UPDATE SET
        samples = samples + 1,
        rss_sum = rss_sum + excluded.rss_sum,
        rss_max = MAX(rss_max, excluded.rss_max),
        heap_sum = heap_sum + excluded.heap_sum,
        lag_sum = lag_sum + excluded.lag_sum,
        lag_max = MAX(lag_max, excluded.lag_max),
        db_sum = db_sum + excluded.db_sum,
        sockets_max = MAX(sockets_max, excluded.sockets_max)
    `).run(floorTo(ms, HOUR), rssMb, rssMb, heapMb, lagAvg, lagAvg, dbMs, socketCountProvider() || 0);

    lastSampleRssMb = rssMb;
    lastSampleHeapMb = heapMb;
    lastSampleLagMs = lagAvg;
    lastSampleDbMs = dbMs;
    lastSampleAtMs = ms;
  } catch (error) {
    // 采集失败不影响服务
    lastSampleAtMs = nowMs();
  }
};

const flushBuffers = () => {
  if (!bufferDirty) return;
  let raw;
  try {
    raw = ensureTables();
  } catch {
    return;
  }

  const upsertMinute = raw.prepare(`
    INSERT INTO monitor_traffic_min (bucket_ms, requests, errors, slow, duration_sum, duration_max, clients)
    VALUES (@bucketMs, @requests, @errors, @slow, @durationSum, @durationMax, @clients)
    ON CONFLICT(bucket_ms) DO UPDATE SET
      requests = requests + excluded.requests,
      errors = errors + excluded.errors,
      slow = slow + excluded.slow,
      duration_sum = duration_sum + excluded.duration_sum,
      duration_max = MAX(duration_max, excluded.duration_max),
      clients = MAX(clients, excluded.clients)
  `);
  const upsertPath = raw.prepare(`
    INSERT INTO monitor_traffic_path (hour_ms, path, method, requests, errors, duration_sum)
    VALUES (@hourMs, @path, @method, @requests, @errors, @durationSum)
    ON CONFLICT(hour_ms, path, method) DO UPDATE SET
      requests = requests + excluded.requests,
      errors = errors + excluded.errors,
      duration_sum = duration_sum + excluded.duration_sum
  `);
  // 小时汇总同步累加：图表只读这张表，分钟表只服务「最近 1 分钟请求量」与近期排障
  const upsertHour = raw.prepare(`
    INSERT INTO monitor_traffic_hour (hour_ms, requests, errors, slow, duration_sum, duration_max, clients)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(hour_ms) DO UPDATE SET
      requests = requests + excluded.requests,
      errors = errors + excluded.errors,
      slow = slow + excluded.slow,
      duration_sum = duration_sum + excluded.duration_sum,
      duration_max = MAX(duration_max, excluded.duration_max),
      clients = MAX(clients, excluded.clients)
  `);

  const minutes = Array.from(minuteBuffer.values());
  const paths = Array.from(pathBuffer.values());

  try {
    raw.transaction(() => {
      minutes.forEach((item) => {
        upsertMinute.run({
          bucketMs: item.bucketMs,
          requests: item.requests,
          errors: item.errors,
          slow: item.slow,
          durationSum: item.durationSum,
          durationMax: item.durationMax,
          clients: item.clients ? item.clients.size : 0
        });
        upsertHour.run(
          floorTo(item.bucketMs, HOUR),
          item.requests,
          item.errors,
          item.slow,
          item.durationSum,
          item.durationMax,
          item.clients ? item.clients.size : 0
        );
      });
      paths.forEach((item) => {
        upsertPath.run({
          hourMs: item.hourMs,
          path: item.path,
          method: item.method,
          requests: item.requests,
          errors: item.errors,
          durationSum: item.durationSum
        });
      });
    })();
    minuteBuffer.clear();
    pathBuffer.clear();
    bufferDirty = false;
  } catch {
    // 落盘失败保留缓冲，下一轮再试
  }
};

/**
 * 落库用的路径归一化：把 UUID / 纯数字段替换成 :id。
 * 不归一化时，带主键的接口会在 200 天保留期内把「小时 × 路径」的基数撑爆，
 * 而统计上这些路径本来就是同一个接口。
 */
const normalizePath = (rawPath) => String(rawPath || '')
  .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
  .replace(/\/\d+(?=\/|$)/g, '/:id')
  .slice(0, 160);

/**
 * 流量统计中间件：只做内存累加，落盘交给定时器。
 * 状态监测自身的轮询请求不计数，否则「打开监测页」会污染流量曲线。
 */
const trafficMiddleware = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  const urlPath = (req.originalUrl || req.url || '').split('?')[0];
  if (!urlPath.startsWith('/api') || urlPath.startsWith('/api/system/monitor')) {
    next();
    return;
  }

  res.on('finish', () => {
    try {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const ms = nowMs();
      const bucketMs = floorTo(ms, MINUTE);
      const hourMs = floorTo(ms, HOUR);
      const status = res.statusCode || 0;
      const isError = status >= 500;
      const isSlow = durationMs >= SLOW_MS;
      const rounded = Math.round(durationMs);

      let minute = minuteBuffer.get(bucketMs);
      if (!minute) {
        minute = { bucketMs, requests: 0, errors: 0, slow: 0, durationSum: 0, durationMax: 0, clients: new Set() };
        minuteBuffer.set(bucketMs, minute);
      }
      minute.requests += 1;
      if (isError) minute.errors += 1;
      if (isSlow) minute.slow += 1;
      minute.durationSum += rounded;
      minute.durationMax = Math.max(minute.durationMax, rounded);
      // 客户端来源用 IP 近似（内网同一出口会合并，仅作「并发来源」参考）
      const clientIp = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
      if (clientIp && minute.clients.size < 500) minute.clients.add(clientIp);

      // 路径拆分到小时粒度，避免 180 天 × 全路径 × 每分钟 的行数爆炸
      const method = String(req.method || 'GET').toUpperCase();
      const normalizedPath = normalizePath(urlPath);
      const pathKey = `${hourMs}|${method}|${normalizedPath}`;
      let pathItem = pathBuffer.get(pathKey);
      if (!pathItem) {
        pathItem = { hourMs, path: normalizedPath, method, requests: 0, errors: 0, durationSum: 0 };
        pathBuffer.set(pathKey, pathItem);
      }
      pathItem.requests += 1;
      if (isError) pathItem.errors += 1;
      pathItem.durationSum += rounded;

      bufferDirty = true;
    } catch {
      // 统计失败绝不能影响响应
    }
  });

  next();
};

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------
let timersStarted = false;

const startTimers = () => {
  if (timersStarted) return;
  timersStarted = true;

  const lagTimer = setInterval(() => {
    const drift = nowMs() - lastLagTick - LAG_INTERVAL_MS;
    lagWindow.push(Math.max(0, drift));
    if (lagWindow.length > 8) lagWindow.shift();
    lastLagTick = nowMs();
  }, LAG_INTERVAL_MS);
  if (lagTimer.unref) lagTimer.unref();

  const sampleTimer = setInterval(takeSample, SAMPLE_INTERVAL_MS);
  if (sampleTimer.unref) sampleTimer.unref();

  const flushTimer = setInterval(flushBuffers, FLUSH_INTERVAL_MS);
  if (flushTimer.unref) flushTimer.unref();

  // 自动清理：用「巡检 + 到期才执行」，而不是一次性 setInterval(6h)。
  // 原因：定时器是随进程启动开始的，若服务在 6 小时内重启过（本项目 nodemon 常态），
  // 一次性计时器会不断归零，清理就永远不会发生。巡检只读一个 meta 值，开销可忽略。
  const cleanupTimer = setInterval(() => {
    try {
      const lastAt = Math.max(
        Number(readMeta('lastCleanupAt')) || 0,
        // 上次失败也要推迟，避免每 10 分钟反复重试同一个失败
        Number(readMeta('lastCleanupAttemptAt')) || 0
      );
      if (nowMs() - lastAt < CLEANUP_INTERVAL_HOURS * HOUR) return;
      // 与手动清理走同一条代码路径，这样「上次清理」在页面上有据可查
      runCleanup({ mode: 'retention', source: 'auto' });
    } catch {
      writeMeta('lastCleanupAttemptAt', nowMs());
    }
  }, CLEANUP_CHECK_INTERVAL_MS);
  if (cleanupTimer.unref) cleanupTimer.unref();

  // 进程退出前尽力把缓冲落盘（强杀时不会执行，属于可接受的丢失）
  process.on('exit', () => {
    try {
      flushBuffers();
    } catch {
      // 退出路径不允许再抛
    }
  });
};

let lastLagTick = nowMs();

/**
 * 服务启动时调用一次：登记会话、判定上一轮是正常停止还是异常中断。
 */
const recordBoot = () => {
  if (initialized) return;
  initialized = true;

  try {
    const raw = ensureTables();
    const bootMs = nowMs();

    // 上一轮会话的最后一条样本 / 最后一条结束事件（必须在写入本次 boot 之前读取）
    const lastSample = raw
      .prepare('SELECT ts_ms, ts, boot_id, rss_mb FROM monitor_samples ORDER BY ts_ms DESC LIMIT 1')
      .get();
    const lastBoot = raw
      .prepare("SELECT ts_ms, ts FROM monitor_events WHERE type = 'boot' ORDER BY ts_ms DESC LIMIT 1")
      .get();
    const lastStop = lastBoot
      ? raw
        .prepare("SELECT ts_ms, ts, type, detail FROM monitor_events WHERE type IN ('graceful_stop', 'exit') AND ts_ms >= ? ORDER BY ts_ms DESC LIMIT 1")
        .get(lastBoot.ts_ms)
      : raw
        .prepare("SELECT ts_ms, ts, type, detail FROM monitor_events WHERE type IN ('graceful_stop', 'exit') ORDER BY ts_ms DESC LIMIT 1")
        .get();

    bootId = crypto.randomUUID();
    bootedAtMs = bootMs;

    // 首次部署：把采集起点记为现在，供前端标注「数据自何时开始」
    if (!readMeta('collectionStartedAt')) {
      writeMeta('collectionStartedAt', bootMs);
    }
    writeMeta('lastBootId', bootId);
    writeMeta('lastBootAt', bootMs);

    const firstEver = !lastBoot && !lastSample;

    // 上一轮会话的最终状态：启动事件本身没有运行时长/内存，但「被替换的那个进程跑了多久、占多少内存」同样有诊断价值。
    // 只有当最后一条样本确实属于上一轮会话（晚于上次启动）时才可用，否则是更早会话的陈旧值，宁可留空。
    const prevSampleMs = lastSample && lastBoot && lastSample.ts_ms > lastBoot.ts_ms ? lastSample.ts_ms : null;
    const bootDetail = {
      pid: process.pid,
      node: process.version,
      launcher: detectLauncher(),
      platform: `${process.platform} ${process.arch}`,
      uptimeBeforeBootSec: lastSample ? Math.round((bootMs - lastSample.ts_ms) / 1000) : null,
      previousUptimeSec: prevSampleMs ? Math.round((prevSampleMs - lastBoot.ts_ms) / 1000) : null,
      previousRssMb: prevSampleMs ? lastSample.rss_mb : null,
      // 本次启动是否由 nodemon 重启触发（决定上一段断开是不是热重载）
      nodemonBoot: detectNodemonBootSignal(),
      previousStopType: lastStop ? lastStop.type : null,
      previousStopSignal: (() => {
        if (!lastStop) return null;
        try {
          return JSON.parse(lastStop.detail || '{}').signal || null;
        } catch {
          return null;
        }
      })()
    };
    recordEvent('boot', bootDetail);

    if (!firstEver) {
      const stopMs = lastStop ? lastStop.ts_ms : null;
      const sampleMs = lastSample ? lastSample.ts_ms : null;
      // 断开开始时间：有正常停止记录就以停止时刻为准，否则取最后一次心跳（精度 ±30s）
      const startMs = stopMs && (!sampleMs || stopMs >= sampleMs)
        ? stopMs
        : (sampleMs || stopMs || null);
      const clean = Boolean(lastStop) && (() => {
        if (lastStop.type === 'graceful_stop') return true;
        try {
          const detail = JSON.parse(lastStop.detail || '{}');
          return Number(detail.code) === 0;
        } catch {
          return false;
        }
      })();

      if (startMs && bootMs - startMs > 5000) {
        const cause = inferCause({
          startMs,
          endMs: bootMs,
          // 本轮（刚结束的那次）会话的起点：崩溃日志早于它的一定属于更早的会话，不能算成本次证据
          sessionStartMs: lastBoot ? lastBoot.ts_ms : null,
          clean,
          lastStop,
          lastSampleRssMb: lastSample ? lastSample.rss_mb : null,
          kind: 'restart',
          // 本进程就是「新会话」，用自己的启动方式判断上一段断开是否热重载
          devMode: isDevSession({ launcher: bootDetail.launcher }),
          nodemonBoot: bootDetail.nodemonBoot
        });
        recordEvent('disconnect', {
          phase: 'restart',
          startMs,
          endMs: bootMs,
          durationSec: Math.round((bootMs - startMs) / 1000),
          clean,
          cause
        });
      }
    }

    takeSample();
    startTimers();
  } catch (error) {
    // 即使监测初始化失败，服务也必须正常起来
    bootId = bootId || crypto.randomUUID();
    bootedAtMs = bootedAtMs || nowMs();
    console.error('[monitor] 初始化失败:', error && error.message ? error.message : error);
  }
};

const recordGracefulStop = (signal) => {
  if (!initialized) return;
  recordEvent('graceful_stop', {
    signal: String(signal || ''),
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    rssMb: lastSampleRssMb,
    heapMb: lastSampleHeapMb,
    handles: countActiveHandles(),
    label: signalLabel(signal)
  });
  flushBuffers();
};

const recordExit = (code) => {
  if (!initialized) return;
  recordEvent('exit', {
    code: Number(code),
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    rssMb: lastSampleRssMb,
    heapMb: lastSampleHeapMb,
    handles: countActiveHandles(),
    requests: countActiveRequests()
  });
  flushBuffers();
};

const setSocketCountProvider = (provider) => {
  if (typeof provider === 'function') socketCountProvider = provider;
};

// ---------------------------------------------------------------------------
// 断开原因推断
// ---------------------------------------------------------------------------
/**
 * 扫描后端源码目录最近被修改的文件。
 *
 * 用途：区分「nodemon 因文件变更热重载」和「真正的异常退出」。
 * 背景：Linux/macOS 上 nodemon 用 SIGUSR2 结束子进程，可以留证据；
 * 但 Windows 上 Node 不支持 SIGUSR2（libuv 只实现 SIGINT/SIGBREAK），
 * 子进程被直接终止、什么也写不下来。此时「断开前几分钟内有 .js 被改动」
 * 就是最直接的可核对证据——文件改了才重载，没改就不是热重载。
 *
 * 结果缓存 5 秒：一次总览查询会对每条断开记录调用，避免反复遍历目录。
 */
const SOURCE_ROOT = path.join(__dirname, '..');
const SOURCE_IGNORE_DIRS = new Set(['node_modules', 'backups', 'logs', 'vendor', 'tests', 'templates', '.git']);
const SOURCE_CACHE_TTL = 5000;
let sourceCache = { at: 0, items: [] };

const scanRecentSourceChanges = () => {
  const now = nowMs();
  if (now - sourceCache.at < SOURCE_CACHE_TTL) return sourceCache.items;

  const items = [];
  const cutoff = now - 12 * HOUR;
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SOURCE_IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(full, depth + 1);
        continue;
      }
      if (!/\.(js|cjs|mjs|json)$/i.test(entry.name)) continue;
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs >= cutoff) {
          items.push({ file: path.relative(SOURCE_ROOT, full), mtimeMs: stat.mtimeMs });
        }
      } catch {
        // 忽略：并发删除/占用
      }
    }
  };
  walk(SOURCE_ROOT, 0);
  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  sourceCache = { at: now, items };
  return items;
};

/** 在断开点附近找被修改的源文件（断开前 5 分钟 ~ 断开后 1 分钟） */
const findSourceChangeNear = (startMs, endMs) => {
  const from = startMs - 5 * MINUTE;
  const to = endMs + MINUTE;
  const hit = scanRecentSourceChanges().find((item) => item.mtimeMs >= from && item.mtimeMs <= to);
  if (!hit) return null;
  return {
    file: hit.file,
    mtimeMs: hit.mtimeMs,
    leadSec: Math.max(0, Math.round((startMs - hit.mtimeMs) / 1000))
  };
};

/** 该会话是否是开发模式启动（npm run dev / nodemon），用于判断热重载的合理性 */
const isDevSession = (bootDetail) => {
  const launcher = String((bootDetail && bootDetail.launcher) || '');
  return /npm run (dev|start:dev)|nodemon/i.test(launcher);
};

/**
 * 只依据可核对的证据给结论，不编造。
 * evidence 会原样展示在前端「判定依据」里，便于运维复核。
 */
function inferCause({ startMs, endMs, clean, lastStop, lastSampleRssMb: rssBefore, kind, devMode, nodemonBoot, sessionStartMs }) {
  const evidence = [];

  if (clean) {
    const detail = (() => {
      try {
        return JSON.parse(lastStop?.detail || '{}');
      } catch {
        return {};
      }
    })();
    const signal = String(detail.signal || '').toUpperCase();
    const uptimeText = Number(detail.uptimeSec) > 0
      ? `，停止前已运行 ${formatSpan(Number(detail.uptimeSec))}`
      : '';
    const memoryText = Number(detail.rssMb) > 0 ? `，内存 ${Math.round(Number(detail.rssMb))} MB` : '';

    // nodemon 热重载用 SIGUSR2 结束子进程：与真正的运维停止必须区分开，
    // 否则开发期每次改文件都会在可用率里留下一次「中断」
    if (signal.includes('SIGUSR2')) {
      const sessionUptimeSec = Number(detail.uptimeSec) || Math.round((endMs - startMs) / 1000);
      const evidence = [
        '收到 SIGUSR2 信号：nodemon 重启子进程的标准信号',
        `被替换的会话已运行 ${formatSpan(sessionUptimeSec)}${memoryText}`
      ];
      if (nodemonBoot) evidence.push(`新会话由 nodemon 重启拉起，backend.log 记录：${nodemonBoot}`);
      return {
        code: 'hot_reload',
        label: '代码热重载（nodemon 检测到文件变更）',
        confidence: 'high',
        severity: 'info',
        evidence
      };
    }

    return {
      code: 'planned',
      label: '计划内停止 / 正常重启',
      confidence: 'high',
      severity: 'info',
      evidence: [
        lastStop?.type === 'graceful_stop'
          ? `${signalLabel(detail.signal)}${uptimeText}${memoryText}`
          : `进程以退出码 ${detail.code === undefined ? 0 : detail.code} 正常退出${uptimeText}`
      ]
    };
  }

  // 1) 未捕获异常：优先看崩溃日志（时间窗放宽到断开前 10 分钟，异常可能先于退出发生）
  //    但必须同时满足「晚于本轮会话的启动时刻」：崩溃日志是追加式文件，一次崩溃的记录会长期留在末尾，
  //    只按 startMs 往前收 10 分钟，会把它重复算到其后每一次重启头上（实测一次真崩溃被记成 7 次）。
  //    会话起点未知时（首轮部署、监测尚未初始化）退回旧的宽松窗口，宁可多认也不漏认。
  //    上界同样收紧到 endMs：崩溃/退出记录是「垂死进程」写的，必然早于新会话启动，
  //    原来留 1 分钟余量会把「下一条断开期间才发生的崩溃」倒挂算到上一条断开头上（实测 2 次剩 1 次真）。
  const sessionBoundMs = Number(sessionStartMs) > 0 ? Number(sessionStartMs) : null;
  const logWindowFrom = sessionBoundMs ? Math.max(startMs - 10 * MINUTE, sessionBoundMs) : startMs - 10 * MINUTE;
  // 2 秒只用于吸收时钟抖动/毫秒取整，不承担「宽限」语义
  const logWindowTo = endMs + 2 * 1000;
  const crashLines = readLogTail(CRASH_LOG_PATH).filter(
    (line) => line.tsMs >= logWindowFrom && line.tsMs <= logWindowTo
  );
  // 2) 退出码（同样限定在本轮会话内，避免复用上一轮留下的退出记录）
  const exitLines = readLogTail(EXIT_LOG_PATH).filter(
    (line) => line.tsMs >= logWindowFrom && line.tsMs <= logWindowTo
  );

  let memorySpike = null;
  try {
    const raw = ensureTables();
    const lastHourAvg = raw
      .prepare('SELECT AVG(rss_mb) AS avg_rss FROM monitor_samples WHERE ts_ms >= ? AND ts_ms <= ?')
      .get(startMs - HOUR, startMs);
    const avgRss = Number(lastHourAvg && lastHourAvg.avg_rss) || 0;
    if (rssBefore && avgRss > 0) {
      const ratio = rssBefore / avgRss;
      if (ratio >= 1.35 && rssBefore >= 300) {
        memorySpike = { rssBefore: Math.round(rssBefore), avgRss: Math.round(avgRss), ratio };
      }
    }
  } catch {
    // 忽略
  }

  const exitDetail = (() => {
    if (!exitLines.length) return null;
    const line = exitLines[exitLines.length - 1];
    const match = /exit code=(-?\d+)\s+reason=([^\s]+)/.exec(line.raw);
    return match ? { code: Number(match[1]), reason: match[2], tsMs: line.tsMs } : null;
  })();

  if (exitDetail && exitDetail.code !== 0) {
    evidence.push(`进程自行退出，退出码 ${exitDetail.code}（${exitDetail.reason}）`);
  }

  // 0) 看门狗强杀：backend-health-probe.bat 连续 N 次健康探测失败后会 taskkill 整棵树。
  //    被强杀的进程不执行 exit 钩子，所以既没有退出码也没有崩溃堆栈——不识别的话，
  //    开发模式下「断开前有文件刚被保存」会把这次假死重启洗成 hot_reload（info 级），
  //    真实故障就从页面上消失了。因此这一条必须优先于热重载启发式。
  //    再强调一次优先级排在崩溃日志之前：uncaughtException 在未设 CRASH_EXIT_ON_UNCAUGHT=1 时
  //    只记日志不退出，「本轮会话里有崩溃记录」≠「这次断开是它造成的」；
  //    真有强杀记录，就以强杀为准，崩溃记录作为附带线索一并列出。
  const killLine = readWatchdogKills().find(
    (item) => item.tsMs >= logWindowFrom && item.tsMs <= logWindowTo
  );
  if (killLine) {
    const killEvidence = [
      `看门狗日志命中：连续 ${killLine.fails || '多'} 次健康探测失败（单次探测超时 5 秒）后，`
        + `于 ${clockOf(killLine.tsMs)} 强杀进程树${killLine.pid ? `（PID ${killLine.pid}）` : ''}`
    ];
    if (crashLines.length) {
      killEvidence.push(`本轮会话内另有 ${crashLines.length} 条未捕获异常记录，但进程当时并未退出，不是本次断开的直接原因`);
    }
    if (endMs > killLine.tsMs) {
      killEvidence.push(`看门狗在 ${formatSpan((endMs - killLine.tsMs) / 1000)}后重新拉起后端`);
    }
    if (memorySpike) {
      killEvidence.push(`断开前内存 ${memorySpike.rssBefore}MB，为近 1 小时均值（${memorySpike.avgRss}MB）的 ${memorySpike.ratio.toFixed(2)} 倍`);
    }
    return {
      code: 'watchdog_kill',
      label: '看门狗强杀重启（健康探测连续失败）',
      confidence: 'high',
      severity: 'warning',
      evidence: killEvidence
    };
  }

  // 0.5) 手动停止：stop.bat 用 taskkill /F 结束进程树，进程收不到信号、写不了 graceful_stop，
  //      没有标记时只能归到兜底的 external_kill（「无退出取证」），人为停机被当成故障。
  //      标记证明「这个时刻有人主动停机」，因此必须优先于崩溃/退出码推断——
  //      crashLines 覆盖的是整轮会话，早些时候的异常记录不该顶替本次的人为停机。
  const manualStop = matchManualStop(startMs, endMs);
  if (manualStop) {
    const manualEvidence = [
      `手动停止标记命中：${manualStop.at} 执行 ${manualStop.source}`
        + `${manualStop.operator ? `（操作者 ${manualStop.operator}）` : ''}`
        + `，主动结束${manualStop.targets.length ? ` ${manualStop.targets.join(' / ')}` : '服务进程'}`
    ];
    manualEvidence.push(
      'stop.bat 以 taskkill /F 结束进程树：进程不会执行退出钩子，因此既没有正常停止事件，也没有退出码与崩溃堆栈——这是停止方式决定的，不代表故障'
    );
    if (crashLines.length) {
      manualEvidence.push(`本轮会话内另有 ${crashLines.length} 条未捕获异常记录，但进程当时并未退出，不是本次断开的直接原因`);
    }
    if (rssBefore) {
      manualEvidence.push(`断开前内存 ${Math.round(rssBefore)} MB`);
    }
    return {
      code: 'manual_stop',
      label: '手动停止（执行 stop.bat，计划内停机）',
      confidence: 'high',
      severity: 'info',
      evidence: manualEvidence
    };
  }

  if (crashLines.length) {
    const first = crashLines[crashLines.length - 1];
    const cleaned = first.raw.replace(/^\[[^\]]+\]\s*/, '');
    const bodyMatch = /^.*?\(pid=\d+\)\s*([\s\S]*)$/.exec(cleaned);
    const message = ((bodyMatch && bodyMatch[1] ? bodyMatch[1] : cleaned) || '').split('\n')[0].slice(0, 120);
    evidence.push(
      `崩溃日志命中 ${crashLines.length} 条${sessionBoundMs ? '（时间落在本轮会话启动之后）' : ''}：${message}`
    );
    if (memorySpike) {
      evidence.push(`断开前内存 ${memorySpike.rssBefore}MB，为近 1 小时均值（${memorySpike.avgRss}MB）的 ${memorySpike.ratio.toFixed(2)} 倍`);
    }
    return {
      code: 'uncaught_exception',
      label: '后端未捕获异常导致进程崩溃',
      confidence: 'high',
      severity: 'critical',
      evidence
    };
  }

  if (exitDetail) {
    if (memorySpike) {
      evidence.push(`断开前内存 ${memorySpike.rssBefore}MB，为近 1 小时均值（${memorySpike.avgRss}MB）的 ${memorySpike.ratio.toFixed(2)} 倍`);
      return {
        code: 'memory',
        label: '疑似内存耗尽（OOM）后退出',
        confidence: 'medium',
        severity: 'critical',
        evidence
      };
    }
    return {
      code: 'exit_nonzero',
      label: '进程异常退出（非零退出码）',
      confidence: 'medium',
      severity: 'critical',
      evidence
    };
  }

  // 开发模式（npm run dev / nodemon）下，进程是被 nodemon 直接杀掉的：
  // Windows 收不到 SIGUSR2，只能靠「新会话由 nodemon 拉起」+「断开前有源文件被改」来判定热重载。
  // 注意：start.bat 本身就走 nodemon，冷启动时同样会有 [nodemon] 日志，
  // 因此「只有 nodemon 拉起记录」时必须同时满足「几秒内就重新拉起」才算热重载，
  // 停了一夜再开机不能算。
  const quickRestart = endMs - startMs <= 5 * MINUTE;
  if (!crashLines.length && !exitDetail && devMode) {
    const change = findSourceChangeNear(startMs, endMs);
    if (change || (nodemonBoot && quickRestart)) {
      const evidence = [];
      if (nodemonBoot) evidence.push(`新会话由 nodemon 重启拉起，backend.log 记录：${nodemonBoot}`);
      if (change) {
        const relPath = change.file.replace(/\\/g, '/');
        evidence.push(
          change.leadSec <= 3
            ? `源文件 ${relPath} 在断开前 3 秒内被修改（刚刚保存）`
            : `源文件 ${relPath} 在断开前 ${formatSpan(change.leadSec)}被修改`
        );
      } else {
        evidence.push('未定位到具体变更文件（可能改的是监听范围之外的配置）');
      }
      evidence.push('开发模式启动（npm run dev），nodemon 监听文件变更后重启子进程');
      evidence.push('本轮会话内无崩溃日志、无退出码记录：进程由 nodemon 终止，不是自行崩溃');
      return {
        code: 'hot_reload',
        label: '代码热重载（文件变更触发 nodemon 重启）',
        // 有具体被改的文件就是高置信；只有 nodemon 拉起记录时降为中置信
        confidence: change ? 'high' : 'medium',
        severity: 'info',
        evidence
      };
    }
  }

  if (memorySpike) {
    evidence.push(`断开前内存 ${memorySpike.rssBefore}MB，为近 1 小时均值（${memorySpike.avgRss}MB）的 ${memorySpike.ratio.toFixed(2)} 倍`);
    evidence.push('崩溃日志与退出日志在时间窗内均无记录，退出路径不可见');
    return {
      code: 'memory',
      label: '疑似内存占用过高被系统终止',
      confidence: 'low',
      severity: 'critical',
      evidence
    };
  }

  // 3) 5xx 突增：说明断开前已出现服务端故障。
  // 先用分钟明细（保留 35 天），过期区间退回小时汇总，保证历史事件的证据链不因明细清理而失效。
  try {
    const raw = ensureTables();
    let row = raw
      .prepare('SELECT SUM(requests) AS req, SUM(errors) AS err FROM monitor_traffic_min WHERE bucket_ms >= ? AND bucket_ms <= ?')
      .get(startMs - 5 * MINUTE, startMs);
    let windowLabel = '断开前 5 分钟';
    if (!Number(row && row.req)) {
      row = raw
        .prepare('SELECT SUM(requests) AS req, SUM(errors) AS err FROM monitor_traffic_hour WHERE hour_ms >= ? AND hour_ms <= ?')
        .get(floorTo(startMs, HOUR) - HOUR, floorTo(startMs, HOUR));
      windowLabel = '断开所在小时';
    }
    const req = Number(row && row.req) || 0;
    const err = Number(row && row.err) || 0;
    if (req >= 20 && err / req >= 0.2) {
      evidence.push(`${windowLabel} ${req} 次请求中 ${err} 次返回 5xx（${Math.round((err / req) * 100)}%）`);
    }
  } catch {
    // 忽略
  }

  if (kind === 'restart') {
    evidence.push('本轮会话内无正常停止记录、无退出日志、无崩溃日志：进程被外部强制结束或运行环境直接消失（如机器重启/断电/任务管理器结束进程）');
  } else {
    evidence.push('心跳在空窗期间中断，且该时段没有正常停止记录');
  }

  return {
    code: 'external_kill',
    label: kind === 'restart' ? '进程被外部强制结束（无退出取证）' : '后端无响应（心跳中断）',
    confidence: evidence.length > 1 ? 'medium' : 'low',
    severity: 'warning',
    evidence
  };
}

// ---------------------------------------------------------------------------
// 区间解析
// ---------------------------------------------------------------------------
const startOfLocalDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);

const parseDayString = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
  return Number.isFinite(date.getTime()) ? date : null;
};

const resolveRange = ({ preset, date }) => {
  const now = new Date();
  const endDefault = nowMs();

  if (preset === 'day' || (date && preset !== 'today')) {
    const day = parseDayString(date) || startOfLocalDay(now);
    const startMs = day.getTime();
    const endMs = Math.min(startMs + DAY, endDefault + 1);
    return {
      preset: 'day',
      label: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
      startMs,
      endMs
    };
  }

  const days = PRESET_DAYS[preset] || 1;
  const today = startOfLocalDay(now);
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  return {
    preset: PRESET_DAYS[preset] ? preset : 'today',
    label: PRESET_LABELS[PRESET_DAYS[preset] ? preset : 'today'],
    startMs: start.getTime(),
    endMs: endDefault
  };
};

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------
const sumOverlap = (segments, fromMs, toMs) => segments.reduce((total, seg) => {
  const a = Math.max(seg.startMs, fromMs);
  const b = Math.min(seg.endMs, toMs);
  return total + Math.max(0, b - a);
}, 0);

const buildDowntimes = (fromMs, toMs) => {
  const raw = ensureTables();
  const events = raw
    .prepare("SELECT ts_ms, ts, type, detail FROM monitor_events WHERE type IN ('boot', 'graceful_stop', 'exit', 'disconnect') AND ts_ms >= ? ORDER BY ts_ms ASC")
    .all(fromMs - 30 * DAY);

  const boots = events.filter((event) => event.type === 'boot');
  const stops = events.filter((event) => event.type === 'graceful_stop' || event.type === 'exit');

  const downtimes = [];

  // A) 重启型断开：每次启动都意味着上一轮会话已经结束
  boots.forEach((boot, index) => {
    const prevBootMs = index > 0 ? boots[index - 1].ts_ms : null;
    if (prevBootMs === null) return;

    // 上一轮会话的启动方式决定「热重载」是否成立（开发模式才会被 nodemon 重启）；
    // 本次启动的 nodemonBoot 则直接说明「这次拉起就是 nodemon 干的」
    let prevBootDetail = {};
    let nextBootDetail = {};
    try {
      prevBootDetail = JSON.parse(boots[index - 1].detail || '{}');
    } catch {
      prevBootDetail = {};
    }
    try {
      nextBootDetail = JSON.parse(boots[index].detail || '{}');
    } catch {
      nextBootDetail = {};
    }
    const devMode = isDevSession(prevBootDetail);

    const stop = stops
      .filter((item) => item.ts_ms < boot.ts_ms && item.ts_ms >= prevBootMs)
      .sort((a, b) => b.ts_ms - a.ts_ms)[0] || null;

    const lastSample = raw
      .prepare('SELECT ts_ms, rss_mb FROM monitor_samples WHERE ts_ms < ? ORDER BY ts_ms DESC LIMIT 1')
      .get(boot.ts_ms);

    const startMsBySample = stop && (!lastSample || stop.ts_ms >= lastSample.ts_ms)
      ? stop.ts_ms
      : (lastSample ? lastSample.ts_ms : (stop ? stop.ts_ms : prevBootMs));

    // 手动停止有精确到毫秒的标记时刻：用它替代「最后一次心跳」的近似值。
    // 心跳 30 秒一次，近似值最坏会偏早半分钟；有标记就能把断开时刻和持续时长算准，
    // 页面上的「时间±30秒」提示也随之取消。留 1 秒余量，避免标记晚于启动时把时长算成 0。
    const manualStop = !stop ? matchManualStop(startMsBySample, boot.ts_ms) : null;
    const manualUsable = Boolean(manualStop && manualStop.tsMs < boot.ts_ms - 1000);
    const startMs = manualUsable ? manualStop.tsMs : startMsBySample;

    const durationMs = boot.ts_ms - startMs;
    if (durationMs < 3000) return;

    let clean = false;
    if (stop) {
      if (stop.type === 'graceful_stop') clean = true;
      else {
        try {
          clean = Number(JSON.parse(stop.detail || '{}').code) === 0;
        } catch {
          clean = false;
        }
      }
    }

    const cause = inferCause({
      startMs,
      endMs: boot.ts_ms,
      // 上一轮会话的起点（本次启动之前的那次 boot）：崩溃/退出日志早于它就不属于这次断开
      sessionStartMs: prevBootMs,
      clean,
      lastStop: stop,
      lastSampleRssMb: lastSample ? lastSample.rss_mb : null,
      kind: 'restart',
      devMode,
      nodemonBoot: nextBootDetail.nodemonBoot || null
    });

    downtimes.push({
      kind: 'restart',
      startMs,
      endMs: boot.ts_ms,
      durationMs,
      stableBeforeMs: Math.max(0, startMs - (downtimes.length ? downtimes[downtimes.length - 1].endMs : prevBootMs)),
      cause,
      precision: stop || manualUsable ? 'exact' : 'sample'
    });
  });

  // B) 同一轮会话内心跳空窗（后端进程还在，但事件循环被长时间阻塞/机器休眠）。
  // 这类空窗在采样时就已经落成 stall 事件，此处只读事件表，不再扫描原始样本。
  const stallEvents = raw
    .prepare("SELECT ts_ms, detail FROM monitor_events WHERE type = 'stall' AND ts_ms >= ? AND ts_ms <= ? ORDER BY ts_ms ASC")
    .all(fromMs - DAY, toMs);

  stallEvents.forEach((event) => {
    let detail = {};
    try {
      detail = JSON.parse(event.detail || '{}');
    } catch {
      detail = {};
    }
    const startMs = Number(detail.startMs) || event.ts_ms;
    const endMs = Number(detail.endMs) || event.ts_ms;
    if (!(endMs > startMs)) return;
    const overlapsRestart = downtimes.some(
      (item) => startMs >= item.startMs - 1000 && endMs <= item.endMs + 1000
    );
    if (overlapsRestart) return;
    downtimes.push({
      kind: 'stall',
      startMs,
      endMs,
      durationMs: endMs - startMs,
      stableBeforeMs: null,
      cause: {
        code: 'stall',
        label: '后端无响应（心跳中断）',
        confidence: 'medium',
        severity: 'warning',
        evidence: [
          `两次心跳间隔 ${Math.round((endMs - startMs) / 1000)} 秒（正常 30 秒）`,
          '进程未重启：疑似事件循环被长任务阻塞、数据库写锁等待或宿主机休眠'
        ]
      },
      precision: 'sample'
    });
  });

  return downtimes.sort((a, b) => a.startMs - b.startMs);
};

const buildTimeline = (fromMs, toMs, downtimes, collectionStartedAtMs) => {
  const points = [];
  const step = Math.max(HOUR, Math.ceil((toMs - fromMs) / 240 / HOUR) * HOUR);

  for (let cursor = floorTo(fromMs, step); cursor < toMs; cursor += step) {
    const segStart = Math.max(cursor, fromMs);
    const segEnd = Math.min(cursor + step, toMs);
    if (segEnd <= segStart) continue;

    const downMs = sumOverlap(downtimes, segStart, segEnd);
    let state = 'up';
    if (!collectionStartedAtMs || segEnd <= collectionStartedAtMs) state = 'unknown';
    else if (downMs >= (segEnd - segStart) * 0.5) state = 'down';
    else if (downMs > 0) state = 'partial';

    points.push({
      startMs: segStart,
      endMs: segEnd,
      state,
      downSec: Math.round(downMs / 1000),
      availability: Math.max(0, 1 - downMs / (segEnd - segStart))
    });
  }

  return points;
};

/**
 * 把小时汇总行聚合到展示桶。
 * 桶以区间起点（本地 00:00）为原点，避免直接按 epoch 整除导致「天」桶从早上 8 点开始。
 */
const aggregateHourRows = (rows, fromMs, bucketSize, initBucket, accumulate) => {
  const buckets = new Map();
  rows.forEach((row) => {
    const slot = Math.floor((Number(row.hour_ms) - fromMs) / bucketSize);
    let bucket = buckets.get(slot);
    if (!bucket) {
      bucket = initBucket(fromMs + slot * bucketSize);
      buckets.set(slot, bucket);
    }
    accumulate(bucket, row);
  });
  return Array.from(buckets.values()).sort((a, b) => a.tsMs - b.tsMs);
};

const buildTraffic = (fromMs, toMs, granularity) => {
  const raw = ensureTables();
  const bucketSize = granularity === 'hour' ? HOUR : DAY;

  const rows = raw.prepare(`
    SELECT hour_ms, requests, errors, slow, duration_sum, duration_max, clients
    FROM monitor_traffic_hour
    WHERE hour_ms >= ? AND hour_ms <= ?
    ORDER BY hour_ms ASC
  `).all(fromMs, toMs);

  const series = aggregateHourRows(
    rows,
    fromMs,
    bucketSize,
    (tsMs) => ({ tsMs, requests: 0, errors: 0, slow: 0, durationSum: 0, maxMs: 0, clients: 0 }),
    (bucket, row) => {
      bucket.requests += Number(row.requests) || 0;
      bucket.errors += Number(row.errors) || 0;
      bucket.slow += Number(row.slow) || 0;
      bucket.durationSum += Number(row.duration_sum) || 0;
      bucket.maxMs = Math.max(bucket.maxMs, Number(row.duration_max) || 0);
      bucket.clients = Math.max(bucket.clients, Number(row.clients) || 0);
    }
  ).map((bucket) => ({
    tsMs: bucket.tsMs,
    requests: bucket.requests,
    errors: bucket.errors,
    slow: bucket.slow,
    avgMs: bucket.requests ? Math.round(bucket.durationSum / bucket.requests) : 0,
    maxMs: bucket.maxMs,
    clients: bucket.clients,
    durationSum: bucket.durationSum
  }));

  const totals = series.reduce((acc, item) => ({
    requests: acc.requests + item.requests,
    errors: acc.errors + item.errors,
    slow: acc.slow + item.slow,
    durationSum: acc.durationSum + item.durationSum,
    clients: Math.max(acc.clients, item.clients)
  }), { requests: 0, errors: 0, slow: 0, durationSum: 0, clients: 0 });

  const topPaths = raw.prepare(`
    SELECT path, method,
           SUM(requests) AS requests,
           SUM(errors) AS errors,
           SUM(duration_sum) AS duration_sum
    FROM monitor_traffic_path
    WHERE hour_ms >= ? AND hour_ms <= ?
    GROUP BY path, method
    ORDER BY requests DESC
    LIMIT 12
  `).all(fromMs, toMs).map((row) => ({
    path: row.path,
    method: row.method,
    requests: Number(row.requests) || 0,
    errors: Number(row.errors) || 0,
    avgMs: Number(row.requests) ? Math.round(Number(row.duration_sum) / Number(row.requests)) : 0
  }));

  const methodRows = raw.prepare(`
    SELECT method, SUM(requests) AS requests
    FROM monitor_traffic_path
    WHERE hour_ms >= ? AND hour_ms <= ?
    GROUP BY method
    ORDER BY requests DESC
  `).all(fromMs, toMs).map((row) => ({ method: row.method, requests: Number(row.requests) || 0 }));

  const peak = series.reduce((best, item) => (item.requests > best.requests ? item : best), { requests: 0, tsMs: null });

  return {
    granularity,
    bucketMs: bucketSize,
    // durationSum 仅用于内部汇总，不进入响应体
    series: series.map(({ durationSum, ...rest }) => rest),
    totals: {
      requests: totals.requests,
      errors: totals.errors,
      slow: totals.slow,
      avgMs: totals.requests ? Math.round(totals.durationSum / totals.requests) : 0,
      errorRate: totals.requests ? totals.errors / totals.requests : 0,
      peakClients: totals.clients,
      peakRequests: peak.requests,
      peakAtMs: peak.tsMs
    },
    topPaths,
    methods: methodRows
  };
};

const buildHeatmap = (fromMs, toMs) => {
  const raw = ensureTables();
  const rows = raw.prepare(`
    SELECT hour_ms, requests FROM monitor_traffic_hour
    WHERE hour_ms >= ? AND hour_ms <= ?
    ORDER BY hour_ms ASC
  `).all(fromMs, toMs);

  // 7 × 24 矩阵：行=周一..周日，列=0..23 时（按本地时区还原）
  const matrix = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const max = { value: 0 };

  rows.forEach((row) => {
    const date = new Date(Number(row.hour_ms));
    const weekday = (date.getDay() + 6) % 7; // 周一=0
    const hour = date.getHours();
    const requests = Number(row.requests) || 0;
    matrix[weekday][hour] += requests;
    if (matrix[weekday][hour] > max.value) max.value = matrix[weekday][hour];
  });

  return { matrix, max: max.value, total: matrix.reduce((sum, row) => sum + row.reduce((a, b) => a + b, 0), 0) };
};

const buildResources = (fromMs, toMs, granularity) => {
  const raw = ensureTables();
  const bucketSize = granularity === 'hour' ? HOUR : DAY;

  const rows = raw.prepare(`
    SELECT hour_ms, samples, rss_sum, rss_max, heap_sum, lag_sum, lag_max, db_sum, sockets_max
    FROM monitor_samples_hour
    WHERE hour_ms >= ? AND hour_ms <= ?
    ORDER BY hour_ms ASC
  `).all(fromMs, toMs);

  const buckets = aggregateHourRows(
    rows,
    fromMs,
    bucketSize,
    (tsMs) => ({
      tsMs, samples: 0, rssSum: 0, rssMax: 0, heapSum: 0, lagSum: 0, lagMax: 0, dbSum: 0, sockets: 0
    }),
    (bucket, row) => {
      bucket.samples += Number(row.samples) || 0;
      bucket.rssSum += Number(row.rss_sum) || 0;
      bucket.rssMax = Math.max(bucket.rssMax, Number(row.rss_max) || 0);
      bucket.heapSum += Number(row.heap_sum) || 0;
      bucket.lagSum += Number(row.lag_sum) || 0;
      bucket.lagMax = Math.max(bucket.lagMax, Number(row.lag_max) || 0);
      bucket.dbSum += Number(row.db_sum) || 0;
      bucket.sockets = Math.max(bucket.sockets, Number(row.sockets_max) || 0);
    }
  );

  const round1 = (value) => Math.round(value * 10) / 10;
  const series = buckets.map((bucket) => {
    const count = bucket.samples || 1;
    return {
      tsMs: bucket.tsMs,
      rssMb: round1(bucket.rssSum / count),
      rssMaxMb: round1(bucket.rssMax),
      heapMb: round1(bucket.heapSum / count),
      lagMs: round1(bucket.lagSum / count),
      lagMaxMs: round1(bucket.lagMax),
      dbMs: round1(bucket.dbSum / count),
      sockets: bucket.sockets,
      samples: bucket.samples
    };
  });

  const aggregate = series.reduce((acc, item) => ({
    rss: Math.max(acc.rss, item.rssMaxMb),
    lag: Math.max(acc.lag, item.lagMaxMs),
    lagAvgSum: acc.lagAvgSum + item.lagMs,
    sockets: Math.max(acc.sockets, item.sockets),
    dbSum: acc.dbSum + item.dbMs
  }), { rss: 0, lag: 0, lagAvgSum: 0, sockets: 0, dbSum: 0 });

  return {
    series,
    summary: {
      peakRssMb: aggregate.rss,
      peakLagMs: aggregate.lag,
      avgLagMs: series.length ? Math.round((aggregate.lagAvgSum / series.length) * 10) / 10 : 0,
      peakSockets: aggregate.sockets,
      avgDbMs: series.length ? Math.round((aggregate.dbSum / series.length) * 10) / 10 : 0
    }
  };
};

// ---------------------------------------------------------------------------
// 对外查询接口
// ---------------------------------------------------------------------------
const getOverview = ({ preset, date, ignoreHotReload }) => {
  ensureTables();
  const range = resolveRange({ preset, date });
  const granularity = range.endMs - range.startMs <= 8 * DAY ? 'hour' : 'day';

  const collectionStartedAtMs = Number(readMeta('collectionStartedAt')) || null;
  const coverageStartMs = collectionStartedAtMs ? Math.max(range.startMs, collectionStartedAtMs) : null;
  const coverageEndMs = range.endMs;

  const allDowntimes = buildDowntimes(range.startMs, range.endMs);
  const inRangeAll = allDowntimes.filter(
    (item) => item.endMs > range.startMs && item.startMs < range.endMs
  );

  // 开发期的 nodemon 热重载不是故障：单独计数，并可整体从可用率里剔除
  const hotReloadItems = inRangeAll.filter((item) => item.cause.code === 'hot_reload');
  // 手动停止（stop.bat）是计划内停机，同样不是故障：列表照常展示（便于回溯），
  // 但一律不计入「中断次数 / 可用率 / 最长中断」，否则按流程停服会让可用率失真。
  const manualStopItems = inRangeAll.filter((item) => item.cause.code === 'manual_stop');
  const statsItems = inRangeAll.filter((item) => item.cause.code !== 'manual_stop');
  const inRange = ignoreHotReload
    ? statsItems.filter((item) => item.cause.code !== 'hot_reload')
    : statsItems;
  // 列表数据源与统计口径分开：手动停机关掉开关后也要能被看到，只是不进统计
  const listItems = ignoreHotReload
    ? inRangeAll.filter((item) => item.cause.code !== 'hot_reload')
    : inRangeAll;

  const clippedDowntimeMs = sumOverlap(inRange, coverageStartMs || range.startMs, coverageEndMs);
  const coverageMs = coverageStartMs ? Math.max(0, coverageEndMs - coverageStartMs) : 0;

  const restartDurations = inRange.filter((item) => item.kind === 'restart');
  const stableList = restartDurations
    .map((item) => item.stableBeforeMs)
    .filter((value) => Number.isFinite(value) && value > 0);

  const traffic = buildTraffic(range.startMs, range.endMs, granularity);
  const resources = buildResources(range.startMs, range.endMs, granularity);

  const events = ensureTables()
    .prepare("SELECT ts_ms, ts, type, detail FROM monitor_events WHERE ts_ms >= ? AND ts_ms <= ? AND type IN ('boot', 'graceful_stop', 'exit') ORDER BY ts_ms DESC LIMIT 60")
    .all(range.startMs, range.endMs)
    .map((row) => {
      let detail = {};
      try {
        detail = JSON.parse(row.detail || '{}');
      } catch {
        detail = {};
      }
      return { tsMs: row.ts_ms, type: row.type, detail };
    });

  return {
    serverTimeMs: nowMs(),
    range: {
      preset: range.preset,
      label: range.label,
      startMs: range.startMs,
      endMs: range.endMs,
      granularity
    },
    collection: {
      startedAtMs: collectionStartedAtMs,
      coverageStartMs,
      coverageMs,
      hasData: Boolean(collectionStartedAtMs && coverageMs > 0)
    },
    availability: {
      uptimeMs: Math.max(0, coverageMs - clippedDowntimeMs),
      downtimeMs: Math.round(clippedDowntimeMs),
      ratio: coverageMs > 0 ? Math.max(0, 1 - clippedDowntimeMs / coverageMs) : null,
      disconnectCount: inRange.length,
      totalCount: inRangeAll.length,
      hotReloadCount: hotReloadItems.length,
      manualStopCount: manualStopItems.length,
      ignoreHotReload: Boolean(ignoreHotReload),
      longestDowntimeMs: inRange.reduce((max, item) => Math.max(max, item.durationMs), 0),
      longestStableMs: stableList.length ? Math.max(...stableList) : null,
      avgStableMs: stableList.length
        ? Math.round(stableList.reduce((sum, value) => sum + value, 0) / stableList.length)
        : null,
      currentUptimeSec: Math.round(process.uptime()),
      bootedAtMs: bootedAtMs || (nowMs() - process.uptime() * 1000)
    },
    timeline: buildTimeline(range.startMs, range.endMs, inRange, collectionStartedAtMs),
    disconnects: listItems.slice(-60).map((item) => ({
      kind: item.kind,
      startAtMs: item.startMs,
      endAtMs: item.endMs,
      durationSec: Math.round(item.durationMs / 1000),
      stableBeforeSec: item.stableBeforeMs === null ? null : Math.round(item.stableBeforeMs / 1000),
      precision: item.precision,
      cause: item.cause
    })),
    traffic,
    resources,
    heatmap: buildHeatmap(range.startMs, range.endMs),
    events
  };
};

const getLive = () => {
  ensureTables();
  const raw = ensureTables();
  const sinceMs = nowMs() - MINUTE;
  const minuteRow = raw
    .prepare('SELECT SUM(requests) AS requests, SUM(errors) AS errors FROM monitor_traffic_min WHERE bucket_ms >= ?')
    .get(sinceMs);
  const lastSample = raw
    .prepare('SELECT ts_ms, rss_mb, heap_mb, lag_ms, db_ms, sockets FROM monitor_samples ORDER BY ts_ms DESC LIMIT 1')
    .get();
  const collectionStartedAtMs = Number(readMeta('collectionStartedAt')) || null;

  return {
    serverTimeMs: nowMs(),
    bootedAtMs: bootedAtMs || (nowMs() - process.uptime() * 1000),
    uptimeSec: Math.round(process.uptime()),
    socketCount: socketCountProvider() || 0,
    requestsLastMinute: Number(minuteRow && minuteRow.requests) || 0,
    errorsLastMinute: Number(minuteRow && minuteRow.errors) || 0,
    rssMb: lastSample ? lastSample.rss_mb : lastSampleRssMb,
    heapMb: lastSample ? lastSample.heap_mb : 0,
    lagMs: lastSample ? lastSample.lag_ms : Math.round(lastSampleLagMs * 10) / 10,
    dbMs: lastSample ? lastSample.db_ms : Math.round(lastSampleDbMs * 10) / 10,
    sampleAgeSec: lastSample ? Math.round((nowMs() - lastSample.ts_ms) / 1000) : null,
    collectionStartedAtMs
  };
};

// ---------------------------------------------------------------------------
// 存储占用与清理
// ---------------------------------------------------------------------------
// 监测数据和业务数据同库（data.db），所以「监测数据会不会把库撑大」必须能在页面上看到。
// 两个容易被忽略的事实：
// 1) SQLite 的 DELETE 只是把页标记为空闲（freelist），文件并不会变小，必须 VACUUM 才真正归还磁盘；
// 2) WAL 模式下还有一个 data.db-wal 会跟着写量增长，清理后要 checkpoint(TRUNCATE) 才能收回去。
const MONITOR_TABLES = [
  { key: 'samples', table: 'monitor_samples', tsColumn: 'ts_ms', retentionDays: RETENTION_DAYS, label: '心跳样本', note: '30 秒一条，可用率与资源曲线的原始数据' },
  { key: 'samplesHour', table: 'monitor_samples_hour', tsColumn: 'hour_ms', retentionDays: RETENTION_DAYS, label: '样本小时汇总', note: '长区间查询只读这张表，体积远小于原始样本' },
  { key: 'trafficMin', table: 'monitor_traffic_min', tsColumn: 'bucket_ms', retentionDays: MINUTE_RETENTION_DAYS, label: '流量分钟明细', note: '只用于近 1 分钟统计与 5xx 取证，过期时段由小时汇总接管，不影响近半年图' },
  { key: 'trafficHour', table: 'monitor_traffic_hour', tsColumn: 'hour_ms', retentionDays: RETENTION_DAYS, label: '流量小时汇总', note: '流量曲线与热力图的数据源' },
  { key: 'trafficPath', table: 'monitor_traffic_path', tsColumn: 'hour_ms', retentionDays: RETENTION_DAYS, label: '接口路径聚合', note: '行数随「接口数 × 小时数」增长，通常是最大的表' }
];

const MONITOR_EVENTS_TABLE = { key: 'events', table: 'monitor_events', tsColumn: 'ts_ms', retentionDays: null, label: '生命周期事件', note: '数量极少，默认长期保留，用于追溯历史断开' };

const fileSizeOf = (filePath) => {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
};

/**
 * 用 dbstat 虚拟表取每张表（含其索引）实际占用的字节。
 * 比「行数 × 估算行宽」准确，且能看出索引占了多少。未启用 dbstat 时返回 null，前端降级为只显示行数。
 */
const readTableSizes = (raw) => {
  let rows;
  try {
    rows = raw.prepare('SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name').all();
  } catch {
    return null;
  }
  const indexRows = raw
    .prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND tbl_name IS NOT NULL")
    .all();
  const tableOfObject = new Map(indexRows.map((row) => [String(row.name), String(row.tbl_name)]));
  const sizes = new Map();
  for (const row of rows) {
    const objectName = String(row.name);
    // dbstat 里索引以自身名字出现，这里归并到所属表，避免把索引体积漏算
    const table = tableOfObject.get(objectName) || objectName;
    sizes.set(table, (sizes.get(table) || 0) + (Number(row.bytes) || 0));
  }
  return sizes;
};

const readDbFootprint = (raw) => {
  const dbPath = db.getDbPath();
  const pageSize = Number(raw.pragma('page_size', { simple: true })) || 0;
  const pageCount = Number(raw.pragma('page_count', { simple: true })) || 0;
  const freelistCount = Number(raw.pragma('freelist_count', { simple: true })) || 0;
  const mainBytes = fileSizeOf(dbPath);
  const walBytes = fileSizeOf(`${dbPath}-wal`);
  const shmBytes = fileSizeOf(`${dbPath}-shm`);
  return {
    fileName: path.basename(dbPath),
    mainBytes,
    walBytes,
    shmBytes,
    totalBytes: mainBytes + walBytes + shmBytes,
    pageSize,
    pageCount,
    freelistCount,
    // 可回收碎片：删过数据但还没 VACUUM 时这部分会一直占着磁盘
    reclaimableBytes: freelistCount * pageSize,
    journalMode: String(raw.pragma('journal_mode', { simple: true }) || '')
  };
};

let storageCache = { at: 0, data: null };
const STORAGE_CACHE_TTL = 30 * 1000;

const collectStorage = () => {
  const raw = ensureTables();
  const footprint = readDbFootprint(raw);
  const sizes = readTableSizes(raw);

  const tables = [...MONITOR_TABLES, MONITOR_EVENTS_TABLE].map((item) => {
    let rows = 0;
    let oldestMs = null;
    let newestMs = null;
    try {
      rows = Number(raw.prepare(`SELECT COUNT(*) AS c FROM ${item.table}`).get().c) || 0;
      const range = raw
        .prepare(`SELECT MIN(${item.tsColumn}) AS minTs, MAX(${item.tsColumn}) AS maxTs FROM ${item.table}`)
        .get();
      oldestMs = range && range.minTs !== null ? Number(range.minTs) : null;
      newestMs = range && range.maxTs !== null ? Number(range.maxTs) : null;
    } catch {
      // 表还没建好时按空表处理
    }
    return {
      key: item.key,
      table: item.table,
      label: item.label,
      note: item.note,
      retentionDays: item.retentionDays,
      rows,
      // dbstat 不可用时为 null：前端只显示行数，不编造体积
      bytes: sizes ? sizes.get(item.table) || 0 : null,
      oldestMs,
      newestMs
    };
  });

  const monitorBytes = sizes
    ? tables.reduce((sum, item) => sum + (item.bytes || 0), 0)
    : null;
  const monitorRows = tables.reduce((sum, item) => sum + item.rows, 0);

  // 按实测生成速度外推「保留期满时的体积」。
  // 采集不足 1 天时不能外推：几小时的增量放大成「每天」会得出几 MB/天这种吓人的错数。
  const collectionStartedAtMs = Number(readMeta('collectionStartedAt')) || null;
  const collectedDays = collectionStartedAtMs
    ? Math.max((nowMs() - collectionStartedAtMs) / DAY, 0)
    : null;
  const bytesPerDay = monitorBytes !== null && collectedDays !== null && collectedDays >= 1
    ? monitorBytes / collectedDays
    : null;

  const lastCleanupAtMs = Number(readMeta('lastCleanupAt')) || null;

  return {
    serverTimeMs: nowMs(),
    db: footprint,
    monitor: {
      bytes: monitorBytes,
      rows: monitorRows,
      tables,
      // 监测表占整个库的比例（按估算字节算，含索引）
      share: monitorBytes !== null && footprint.mainBytes > 0 ? monitorBytes / footprint.mainBytes : null
    },
    policy: {
      retentionDays: RETENTION_DAYS,
      minuteRetentionDays: MINUTE_RETENTION_DAYS,
      cleanupIntervalHours: CLEANUP_INTERVAL_HOURS,
      autoCleanup: true,
      lastCleanupAtMs,
      lastCleanupMode: readMeta('lastCleanupMode') || null,
      lastCleanupDeleted: Number(readMeta('lastCleanupDeleted')) || 0,
      lastCleanupFreedBytes: Number(readMeta('lastCleanupFreedBytes')) || 0,
      lastCleanupDurationMs: Number(readMeta('lastCleanupDurationMs')) || 0,
      lastCleanupSource: readMeta('lastCleanupSource') || null,
      cleanupCount: Number(readMeta('cleanupCount')) || 0,
      totalDeleted: Number(readMeta('cleanupTotalDeleted')) || 0,
      lastVacuumAtMs: Number(readMeta('lastVacuumAt')) || null,
      lastVacuumFreedBytes: Number(readMeta('lastVacuumFreedBytes')) || 0,
      nextCleanupAtMs: lastCleanupAtMs ? lastCleanupAtMs + CLEANUP_INTERVAL_HOURS * HOUR : null
    },
    estimate: {
      collectedDays: collectedDays === null ? null : Math.round(collectedDays * 100) / 100,
      bytesPerDay: bytesPerDay === null ? null : Math.round(bytesPerDay),
      // 满保留期估算：日增 × 保留天数（索引开销已包含在实测值里）
      projectedFullBytes: bytesPerDay === null ? null : Math.round(bytesPerDay * RETENTION_DAYS)
    }
  };
};

/** 缓存 30 秒：汇总接口会跟自动刷新一起被频繁调用，COUNT(*) 不能每次都跑 */
const getStorage = ({ force = false } = {}) => {
  const now = nowMs();
  if (!force && now - storageCache.at < STORAGE_CACHE_TTL && storageCache.data) return storageCache.data;
  const data = collectStorage();
  storageCache = { at: now, data };
  return data;
};

/**
 * 执行清理。
 *
 * mode='retention' 按各自保留期删（自动清理用的就是这个）
 * mode='days'      删除 N 天之前的全部监测数据（保留期内的也删，需用户明确确认）
 * mode='all'       清空全部监测数据（样本、流量、事件一起清，不看时间），用于重置监测基线
 * vacuum=true      清理后重建数据库文件，把 freelist 真正还给磁盘
 */
const runCleanup = ({ mode = 'retention', days = 0, vacuum = false, includeEvents = false, source = 'manual' } = {}) => {
  const raw = ensureTables();
  const startedAt = nowMs();
  const before = readDbFootprint(raw);

  const purgeAll = mode === 'all';
  const targetMs = mode === 'days'
    ? startedAt - Math.max(1, Math.min(RETENTION_DAYS, Number(days) || 7)) * DAY
    : null;

  const deleted = {};
  let totalDeleted = 0;

  // 单事务删除：避免中途失败留下「删了一半」的数据
  const tx = raw.transaction(() => {
    for (const item of MONITOR_TABLES) {
      let info;
      if (purgeAll) {
        info = raw.prepare(`DELETE FROM ${item.table}`).run();
      } else {
        const cutoff = targetMs === null ? startedAt - item.retentionDays * DAY : targetMs;
        info = raw.prepare(`DELETE FROM ${item.table} WHERE ${item.tsColumn} < ?`).run(cutoff);
      }
      deleted[item.key] = info.changes;
      totalDeleted += info.changes;
    }
    // mode=all 时事件表也一起清：监测页若只剩「事件」而没有样本，时间线会自相矛盾
    if (includeEvents || purgeAll) {
      const info = purgeAll
        ? raw.prepare('DELETE FROM monitor_events').run()
        : raw.prepare('DELETE FROM monitor_events WHERE ts_ms < ?').run(targetMs === null ? startedAt - RETENTION_DAYS * DAY : targetMs);
      deleted.events = info.changes;
      totalDeleted += info.changes;
    }
  });
  tx();

  // 清空后采集基线要从零重算：否则「已采集 N 天 / 日均增量」会把清空前的时间算进来，
  // 监测页就会出现「采集了 30 天却只有 0 字节」这种自相矛盾的估算
  if (purgeAll) {
    writeMeta('collectionStartedAt', startedAt);
  }
  // WAL 只有 checkpoint 之后才会收缩到 0；不做这一步，删多少 WAL 都还是原来那么大
  let checkpointed = false;
  try {
    raw.pragma('wal_checkpoint(TRUNCATE)');
    checkpointed = true;
  } catch {
    // WAL 收缩失败不影响删除结果
  }

  let vacuumed = false;
  let vacuumMs = 0;
  if (vacuum) {
    const vacuumStart = nowMs();
    try {
      // 必须在事务外执行；大库会阻塞事件循环，因此只允许用户显式触发
      raw.exec('VACUUM');
      vacuumed = true;
    } catch {
      vacuumed = false;
    }
    vacuumMs = nowMs() - vacuumStart;
    // VACUUM 会把整库重写一遍，写入过程全落在 WAL 里（实测能涨到几 MB）；
    // 不紧接着 checkpoint，主文件反而看起来「更大」，所以这里必须再收一次
    try {
      raw.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // 忽略：下一次清理还会再收
    }
  }

  const after = readDbFootprint(raw);
  const durationMs = nowMs() - startedAt;
  const freedBytes = Math.max(0, before.totalBytes - after.totalBytes);

  writeMeta('lastCleanupAt', startedAt);
  writeMeta('lastCleanupMode', mode);
  writeMeta('lastCleanupSource', source);
  writeMeta('lastCleanupDeleted', totalDeleted);
  writeMeta('lastCleanupFreedBytes', freedBytes);
  writeMeta('lastCleanupDurationMs', durationMs);
  writeMeta('cleanupCount', (Number(readMeta('cleanupCount')) || 0) + 1);
  writeMeta('cleanupTotalDeleted', (Number(readMeta('cleanupTotalDeleted')) || 0) + totalDeleted);
  if (vacuumed) {
    writeMeta('lastVacuumAt', nowMs());
    writeMeta('lastVacuumFreedBytes', freedBytes);
  }

  // 体积已变化，缓存必须作废
  storageCache = { at: 0, data: null };

  return {
    mode,
    source,
    durationMs,
    vacuumed,
    vacuumMs,
    checkpointed,
    deleted,
    totalDeleted,
    before,
    after,
    freedBytes
  };
};

module.exports = {
  recordBoot,
  recordGracefulStop,
  recordExit,
  setSocketCountProvider,
  trafficMiddleware,
  getOverview,
  getLive,
  getStorage,
  runCleanup,
  ensureTables,
  // 便于测试与手工取证
  inferCause,
  readLogTail,
  readWatchdogKills,
  parseWindowsLogTimestamp
};
