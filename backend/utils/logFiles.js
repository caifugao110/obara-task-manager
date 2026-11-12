/**
 * 日志文件占用统计与自动截断（系统设置 → 日志管理）
 *
 * 目标：回答「日志到底占了多少磁盘、是谁在长、哪些能删、超过阈值怎么办」。
 *
 * 背景：logs/ 下的文件由启动脚本以**追加方式**写入（start-process-hidden.vbs 用
 * `>>`、start.bat 与 watchdog 用 `>>`、后端自己用 appendFileSync），node/nodemon
 * 不会自己截断，backend-crash.log 历史上曾涨到 248MB。数据库里的 audit_logs /
 * login_logs 有保留条数兜底，磁盘日志却没有任何上限。
 *
 * 两条底线：
 * 1) 只做 stat，不读整份文件：单文件可能几百 MB，读进来只会把后端拖死。
 * 2) 截断是「就地重写」而不是删除文件：backend.log / frontend.log 这类文件在服务
 *    运行期间被隐藏 cmd 窗口持有句柄，删除必然失败（Windows 占用），删掉后写入方
 *    也不会重建文件。因为是追加写（FILE_APPEND_DATA），重写后下一次写入直接落在
 *    新的文件末尾，不会出现「空洞 + NUL 填充」。
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');

const MB = 1024 * 1024;

// 自动截断默认值：单文件超过 50MB 就保留末尾、清掉前面
const DEFAULT_TRIM_SETTINGS = { enabled: true, maxSizeMb: 50 };
const MAX_SIZE_MB_MIN = 5;
const MAX_SIZE_MB_MAX = 2048;
// 自动截断保留的末尾内容：阈值的 10%，夹在 64KB ~ 512KB 之间。
// 太小会把「崩溃前最后几屏」一并删掉，太大则截断收益不明显。
const KEEP_TAIL_MIN_BYTES = 64 * 1024;
const KEEP_TAIL_MAX_BYTES = 512 * 1024;
const KEEP_TAIL_RATIO = 0.1;
// 每 30 分钟检查一次；启动后先等 2 分钟，避开启动高峰与 nodemon 连续重启
const TRIM_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const TRIM_FIRST_DELAY_MS = 2 * 60 * 1000;

/**
 * 已知日志文件的说明与清理建议。
 *
 * cleanup: truncate → 可清空（文件被运行中的进程占用，不能删）
 *          delete   → 可删除（没有进程持有句柄）
 *          forbid   → 不要动（运行时文件，删了会让脚本失效）
 */
const FILE_META = {
  'backend.log': {
    label: '后端运行输出',
    note: '后端标准输出，nodemon 重启提示也在这里',
    isLog: true,
    cleanup: 'truncate',
    advice: '可清空',
    caution: '服务运行期间被隐藏 cmd 窗口占用，删除会失败；清空是安全的，但会丢失当前排障上下文'
  },
  'backend.err.log': {
    label: '后端错误输出',
    note: '后端标准错误（含未捕获告警）',
    isLog: true,
    cleanup: 'truncate',
    advice: '可清空',
    caution: '服务运行期间被占用，不能删除；排查启动失败/端口占用时要先看这个文件'
  },
  'frontend.log': {
    label: '前端运行输出',
    note: 'Vite 开发服务器输出',
    isLog: true,
    cleanup: 'truncate',
    advice: '可清空',
    caution: '服务运行期间被占用，不能删除；清空后新输出会继续追加'
  },
  'frontend.err.log': {
    label: '前端错误输出',
    note: '前端构建/运行错误',
    isLog: true,
    cleanup: 'truncate',
    advice: '可清空',
    caution: '服务运行期间被占用，不能删除；Vite 热更新报错会持续堆积，通常是这里涨得最快'
  },
  'backend-crash.log': {
    label: '崩溃堆栈',
    note: '未捕获异常堆栈，历史上曾异常膨胀',
    isLog: true,
    cleanup: 'delete',
    advice: '可删除',
    caution: '删掉就失去历史崩溃堆栈证据，建议先在「状态监测」确认断开原因，或先备份再删'
  },
  'backend-exit.log': {
    label: '进程退出记录',
    note: '退出码与停止方式',
    isLog: true,
    cleanup: 'delete',
    advice: '可删除',
    caution: '排查「为什么反复重启」时需要它（退出码 + 停止信号），确认无异常后再删'
  },
  'backend-watchdog.log': {
    label: '后端守护日志',
    note: 'watchdog 探活与自动拉起记录',
    isLog: true,
    cleanup: 'delete',
    advice: '可删除',
    caution: '记录每次重启与假死强杀，保留最近记录更利于回溯；删除不影响运行'
  },
  'startup.log': {
    label: '启动脚本输出',
    note: 'start.bat 启动过程记录',
    isLog: true,
    cleanup: 'delete',
    advice: '可删除',
    caution: '仅在启动时写入，启动完成后没有进程占用，删除安全'
  },
  'startup.err.log': {
    label: '启动脚本错误',
    note: 'start.bat 启动失败信息',
    isLog: true,
    cleanup: 'delete',
    advice: '可删除',
    caution: '若启动失败过，先看这里；确认无问题后可删'
  }
};

const RUNTIME_META = {
  'backend.pid': {
    label: '后端进程号',
    note: '停止脚本据此结束进程',
    cleanup: 'forbid',
    advice: '禁止删除',
    caution: 'stop.bat 依赖它找到后端进程，删除后只能手动 taskkill 结束'
  },
  'frontend.pid': {
    label: '前端进程号',
    note: '停止脚本据此结束进程',
    cleanup: 'forbid',
    advice: '禁止删除',
    caution: 'stop.bat 依赖它找到前端进程，删除后只能手动 taskkill 结束'
  },
  'offline-backup.token': {
    label: '关机备份令牌',
    note: '后端写入，供关机备份脚本校验',
    cleanup: 'forbid',
    advice: '禁止删除',
    caution: '关机备份脚本靠它通过校验，删除后本次关机备份会被拒绝（后端重启才会重建）'
  },
  'manual-stop.json': {
    label: '手动停止标记',
    note: 'stop.bat 停机前写入，供状态监测识别计划内停机',
    cleanup: 'forbid',
    advice: '禁止删除',
    caution: '删除后最近一次手动停机在 /system-settings 里会被判成「进程被外部强制结束」，下次执行 stop.bat 会重新生成'
  },
  '.probe.token': {
    label: '探活令牌',
    note: 'watchdog 探活使用',
    cleanup: 'forbid',
    advice: '禁止删除',
    caution: '假死探测校验用，删除会让探活失败并误判后端异常'
  },
  'backend-health-probe.gen': {
    label: '探活代数',
    note: 'watchdog 探活计数',
    cleanup: 'forbid',
    advice: '禁止删除',
    caution: '代号用于让旧探测器退休，删除可能导致旧探测器误杀新后端实例'
  }
};

/** 归类：已知日志 → 已知运行时文件 → 按扩展名兜底 */
const classify = (name) => {
  if (FILE_META[name]) return { ...FILE_META[name], isLog: true };
  if (RUNTIME_META[name]) return { ...RUNTIME_META[name], isLog: false };
  const isLog = /\.log$/i.test(name);
  return isLog
    ? {
        label: '其他日志',
        note: '未在清单中登记的日志文件',
        isLog: true,
        cleanup: 'delete',
        advice: '可删除',
        caution: '未登记的日志文件，确认没有程序在使用后再删'
      }
    : {
        label: '其他文件',
        note: '非日志的运行时文件',
        isLog: false,
        cleanup: 'forbid',
        advice: '不要删除',
        caution: '未登记的文件，不确定用途时不要动'
      };
};

const statSafe = (filePath) => {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
};

/**
 * 文件是否被其它进程独占。
 *
 * backend.log / backend.err.log / frontend.log / frontend.err.log 在服务运行期间由
 * 隐藏 cmd 窗口以重定向方式持有，Windows 上再打开写入会得到 EBUSY/EPERM。
 * 这里用「只读+写权限的方式打开但不写」来探测：不截断、不改内容，失败即视为占用。
 * 占用中的文件不能就地截断，只能等服务停止后由启动脚本（tools/trim-logs.js）轮转。
 */
const isFileLocked = (filePath) => {
  let fd = -1;
  try {
    fd = fs.openSync(filePath, 'r+');
    return false;
  } catch (err) {
    return err && ['EBUSY', 'EPERM', 'EACCES'].includes(err.code);
  } finally {
    if (fd >= 0) {
      try {
        fs.closeSync(fd);
      } catch {
        // 关闭失败不影响探测结果
      }
    }
  }
};

/** 列出 logs 目录下的全部文件（不递归，不读内容） */
const listLogFiles = () => {
  let entries;
  try {
    entries = fs.readdirSync(LOG_DIR, { withFileTypes: true });
  } catch {
    // 目录还不存在：按「没有磁盘日志」返回，不当作错误
    return { dir: LOG_DIR, exists: false, files: [] };
  }

  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(LOG_DIR, entry.name);
    const stat = statSafe(fullPath);
    if (!stat) continue;
    const meta = classify(entry.name);
    files.push({
      name: entry.name,
      label: meta.label,
      note: meta.note,
      isLog: meta.isLog,
      cleanup: meta.cleanup,
      advice: meta.advice,
      caution: meta.caution,
      bytes: stat.size,
      modifiedAtMs: stat.mtimeMs,
      // 被运行中的进程占用：现在清不掉，只能等重启时由启动脚本轮转
      locked: isFileLocked(fullPath)
    });
  }

  // 日志在前、体积大的在前：一眼能看到是谁占的空间
  files.sort((a, b) => {
    if (a.isLog !== b.isLog) return a.isLog ? -1 : 1;
    if (b.bytes !== a.bytes) return b.bytes - a.bytes;
    return a.name.localeCompare(b.name);
  });

  return { dir: LOG_DIR, exists: true, files };
};

/**
 * 数据库内日志表的占用（行数 + dbstat 实测字节，含索引）。
 * dbstat 不可用时 bytes 为 null，前端只显示行数，不编造体积。
 */
const readLogTables = () => {
  let rows = { auditLogs: 0, loginLogs: 0 };
  try {
    rows = { auditLogs: db.countAuditLogs(), loginLogs: db.countLoginLogs() };
  } catch {
    // 表还没建好时按 0 条处理
  }

  let sizes = null;
  try {
    const raw = db.getRawDb();
    const all = raw.prepare('SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name').all();
    const indexRows = raw.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND tbl_name IS NOT NULL").all();
    const tableOfObject = new Map(indexRows.map((row) => [String(row.name), String(row.tbl_name)]));
    sizes = new Map();
    for (const row of all) {
      const objectName = String(row.name);
      const table = tableOfObject.get(objectName) || objectName;
      sizes.set(table, (sizes.get(table) || 0) + (Number(row.bytes) || 0));
    }
  } catch {
    sizes = null;
  }

  return {
    auditLogs: { rows: rows.auditLogs, bytes: sizes ? sizes.get('audit_logs') || 0 : null },
    loginLogs: { rows: rows.loginLogs, bytes: sizes ? sizes.get('login_logs') || 0 : null }
  };
};

/** 操作日志保留条数：让页面能解释「库里为什么只有这么点日志」 */
const readAuditRetentionRows = () => {
  try {
    const rows = Number(db.readSettings()?.system?.auditLogMaxRows);
    return Number.isFinite(rows) && rows > 0 ? rows : null;
  } catch {
    return null;
  }
};

/** 截断时保留的末尾字节数：阈值的 10%，夹在 64KB ~ 512KB */
const computeKeepTailBytes = (thresholdBytes) => {
  const raw = Math.floor(thresholdBytes * KEEP_TAIL_RATIO);
  return Math.min(KEEP_TAIL_MAX_BYTES, Math.max(KEEP_TAIL_MIN_BYTES, raw));
};

/**
 * 自动截断配置：以 settings.system 为准，缺失或非法时回到默认值。
 * 读取失败（例如数据库还没初始化）时也要给出可用默认值，避免调度器空转。
 */
const readTrimSettings = () => {
  let stored = {};
  try {
    stored = db.readSettings()?.system || {};
  } catch {
    stored = {};
  }
  const maxSizeMb = Number(stored.logMaxSizeMb);
  const normalizedMb = Number.isFinite(maxSizeMb) && maxSizeMb >= MAX_SIZE_MB_MIN && maxSizeMb <= MAX_SIZE_MB_MAX
    ? Math.round(maxSizeMb)
    : DEFAULT_TRIM_SETTINGS.maxSizeMb;
  return {
    // 未配置时默认开启：磁盘日志本来就没有上限，不设默认值等于没人管
    enabled: stored.logAutoTrimEnabled !== false,
    maxSizeMb: normalizedMb,
    thresholdBytes: normalizedMb * MB,
    keepTailBytes: computeKeepTailBytes(normalizedMb * MB)
  };
};

const formatLocalTime = (ms = Date.now()) => {
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const formatMb = (bytes) => `${(bytes / MB).toFixed(2)} MB`;

/** 从文件末尾读 keepBytes 字节（不读整份文件） */
const readTailBytes = (filePath, keepBytes) => {
  const stat = fs.statSync(filePath);
  if (keepBytes <= 0 || stat.size === 0) return { tail: Buffer.alloc(0), cutBytes: stat.size };
  const start = Math.max(0, stat.size - keepBytes);
  const length = stat.size - start;
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buffer, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }
  return { tail: buffer, cutBytes: start };
};

/**
 * 截断单个日志文件：保留末尾 keepBytes（0 表示全部清空），前面换成一行说明。
 *
 * 为什么不是直接 fs.truncateSync(path)：那样保留不下「崩溃前的最后几屏」，
 * 排障时等于把最有用的一段删掉了。这里读尾部再整体重写；写入方是追加模式，
 * 下一次写入会落在新末尾，不会把文件撑回去。
 */
const trimOneFile = (fileName, { keepBytes, reason }) => {
  const filePath = path.join(LOG_DIR, fileName);
  const before = statSafe(filePath)?.size ?? 0;
  if (before === 0) return { name: fileName, skipped: true, reason: '文件为空', beforeBytes: 0, afterBytes: 0 };

  const { tail, cutBytes } = readTailBytes(filePath, keepBytes);
  // 丢掉被截断的半行，避免日志第一行是半截内容
  let body = tail;
  if (cutBytes > 0 && body.length > 0) {
    const newlineAt = body.indexOf(0x0a);
    if (newlineAt >= 0 && newlineAt < body.length - 1) body = body.subarray(newlineAt + 1);
  }

  // 留一行说明：以后翻日志时能知道「这里为什么突然少了一段」
  const banner = keepBytes > 0
    ? `[log-trim] ${formatLocalTime()} ${reason}，原 ${formatMb(before)}，已保留最后 ${formatMb(body.length)}\n`
    : `[log-trim] ${formatLocalTime()} ${reason}，原 ${formatMb(before)}，已清空\n`;

  fs.writeFileSync(filePath, Buffer.concat([Buffer.from(banner, 'utf8'), body]));
  const after = statSafe(filePath)?.size ?? 0;
  return { name: fileName, skipped: false, beforeBytes: before, afterBytes: after, keptBytes: body.length };
};

/** 最近一次截断结果：内存里留一份，页面刷新即可看到（重启后从设置里回读） */
let lastTrimResult = null;

const persistLastTrim = (record) => {
  try {
    const data = db.readDb();
    if (!data.settings) data.settings = {};
    data.settings.logMaintenance = record;
    // 截断本身已完成，这里的落库失败不应影响调用方，仅记录日志
    Promise.resolve(db.writeDb(data)).catch((err) => {
      console.error('[logFiles] 记录截断结果失败:', err && err.message ? err.message : err);
    });
  } catch (err) {
    console.error('[logFiles] 记录截断结果失败:', err && err.message ? err.message : err);
  }
};

const readLastTrimResult = () => {
  if (lastTrimResult) return lastTrimResult;
  try {
    const stored = db.readSettings()?.logMaintenance;
    return stored && typeof stored === 'object' ? stored : null;
  } catch {
    return null;
  }
};

/**
 * 执行截断。
 *
 * mode='oversized' 只处理达到阈值的日志文件（自动截断就调这个）
 * mode='all'       清空全部日志文件（保留一行说明，运行时文件一律不动）
 * files            指定文件名（仅限 *.log 且存在于 logs 目录），用于页面单文件清理
 */
const trimLogFiles = ({ mode = 'oversized', files = null, source = 'manual', settings = null, keepTail = true } = {}) => {
  const config = settings || readTrimSettings();
  const { exists, files: listed } = listLogFiles();
  const startedAt = Date.now();

  if (!exists) {
    return { at: startedAt, source, mode, trimmed: [], failed: [], skipped: true, reason: 'logs 目录不存在' };
  }

  const wanted = Array.isArray(files) && files.length > 0 ? new Set(files.map(String)) : null;
  const keepBytes = keepTail ? (mode === 'all' ? 0 : config.keepTailBytes) : 0;
  // 写进日志首行的原因说明：自动截断说明阈值，手动清理说明是人工操作
  const reason = wanted
    ? '手动清理日志文件'
    : (mode === 'all'
      ? '手动清空日志文件'
      : `超过 ${formatMb(config.thresholdBytes)} 上限${source === 'auto' ? '，自动截断' : '，手动清理'}`);
  // mode=all 时不需要阈值；其它模式只挑超过阈值的文件
  const pick = listed.filter((file) => {
    if (!file.isLog) return false;                 // 运行时文件（pid/token/gen）永不截断
    if (wanted) return wanted.has(file.name);       // 指定文件时不受阈值限制
    if (mode === 'all') return file.bytes > 0;
    return file.bytes >= config.thresholdBytes;
  });

  const trimmed = [];
  const failed = [];

  for (const file of pick) {
    // 双保险：文件名必须来自目录列表，且解析后的路径仍在 logs 目录内
    const target = path.resolve(LOG_DIR, file.name);
    if (path.dirname(target) !== path.resolve(LOG_DIR)) {
      failed.push({ name: file.name, message: '路径非法，已跳过' });
      continue;
    }
    // 被运行中的服务占用时写不进去：直接说明原因，不要抛出 EBUSY 让用户猜
    if (file.locked) {
      failed.push({
        name: file.name,
        message: '文件正被运行中的进程占用，现在无法清空；停止服务后重新启动时会自动轮转',
        beforeBytes: file.bytes,
        locked: true
      });
      continue;
    }
    try {
      const result = trimOneFile(file.name, {
        keepBytes,
        reason
      });
      if (result.skipped) {
        failed.push({ name: file.name, message: result.reason || '已跳过' });
      } else {
        trimmed.push(result);
      }
    } catch (err) {
      // 常见原因：文件被独占锁定（杀毒软件）、磁盘满；单文件失败不影响其它文件
      failed.push({
        name: file.name,
        message: err && err.message ? err.message : String(err),
        beforeBytes: file.bytes
      });
    }
  }

  const record = {
    at: startedAt,
    source,
    mode,
    thresholdBytes: config.thresholdBytes,
    keepTailBytes: keepBytes,
    trimmed,
    failed
  };

  if (trimmed.length > 0) {
    lastTrimResult = record;
    persistLastTrim(record);
    for (const item of trimmed) {
      console.log(`[logFiles] ${source === 'auto' ? '自动' : '手动'}截断 ${item.name}：`
        + `${formatMb(item.beforeBytes)} → ${formatMb(item.afterBytes)}`);
    }
  }
  if (failed.length > 0) {
    // 被占用的文件是预期内跳过（重启时轮转），不算故障，只在有真正失败时告警，
    // 否则每 30 分钟自动检查都会往 backend.log 里刷一条同样的警告
    const realFailed = failed.filter((item) => !item.locked);
    if (realFailed.length > 0) {
      console.warn(`[logFiles] ${realFailed.length} 个日志文件截断失败：`, realFailed.map((item) => `${item.name}(${item.message})`).join(', '));
    }
  }

  return record;
};

let autoTrimTimer = null;
let autoTrimRunning = false;

/** 调度器单次检查：配置关闭、无超限文件时什么都不做 */
const autoTrimNow = () => {
  if (autoTrimRunning) return { skipped: true, reason: '上一次检查尚未完成' };
  autoTrimRunning = true;
  try {
    const config = readTrimSettings();
    if (!config.enabled) return { skipped: true, reason: '自动截断已关闭' };
    return trimLogFiles({ mode: 'oversized', source: 'auto', settings: config });
  } finally {
    autoTrimRunning = false;
  }
};

/**
 * 启动自动截断调度。只在 server.js 里调用，测试环境不会启动。
 * 定时器 unref：不阻止进程退出。
 */
const startAutoTrim = () => {
  if (autoTrimTimer) return;
  const run = () => {
    try {
      const result = autoTrimNow();
      if (result && !result.skipped && result.trimmed && result.trimmed.length > 0) {
        console.log(`[logFiles] 自动截断完成，处理 ${result.trimmed.length} 个文件`);
      }
    } catch (err) {
      console.error('[logFiles] 自动截断异常:', err && err.message ? err.message : err);
    }
  };
  const firstTimer = setTimeout(run, TRIM_FIRST_DELAY_MS);
  if (typeof firstTimer.unref === 'function') firstTimer.unref();
  autoTrimTimer = setInterval(run, TRIM_CHECK_INTERVAL_MS);
  if (typeof autoTrimTimer.unref === 'function') autoTrimTimer.unref();
  console.log(`[logFiles] 自动截断已启动：每 ${TRIM_CHECK_INTERVAL_MS / 60000} 分钟检查一次，`
    + `首次 ${TRIM_FIRST_DELAY_MS / 60000} 分钟后`);
};

const getLogSummary = () => {
  const { dir, exists, files } = listLogFiles();
  const logFiles = files.filter((file) => file.isLog);
  const config = readTrimSettings();

  const sum = (list) => list.reduce((total, file) => total + file.bytes, 0);
  const lastModifiedMs = files.reduce((latest, file) => Math.max(latest, file.modifiedAtMs || 0), 0);

  const database = readLogTables();
  const databaseBytes = database.auditLogs.bytes === null || database.loginLogs.bytes === null
    ? null
    : database.auditLogs.bytes + database.loginLogs.bytes;

  const enriched = files.map((file) => ({
    ...file,
    // 前端据此标「偏大」：只对真正的日志文件有意义
    oversized: file.isLog && file.bytes >= config.thresholdBytes,
    // 是否参与自动截断：运行时文件一律不参与
    trimmable: file.isLog,
    // 超出阈值的部分，用于提示「清掉能省多少」
    overflowBytes: file.isLog && file.bytes > config.thresholdBytes ? file.bytes - config.thresholdBytes : 0
  }));

  return {
    dir,
    exists,
    scannedAtMs: Date.now(),
    files: enriched,
    logFileCount: logFiles.length,
    logBytes: sum(logFiles),
    runtimeFileCount: files.length - logFiles.length,
    runtimeBytes: sum(files.filter((file) => !file.isLog)),
    totalBytes: sum(files),
    lastModifiedMs: lastModifiedMs || null,
    oversizeCount: enriched.filter((file) => file.oversized).length,
    // 自动截断配置与最近一次执行结果，页面直接展示，不需要再单独请求
    settings: {
      autoTrimEnabled: config.enabled,
      maxSizeMb: config.maxSizeMb,
      thresholdBytes: config.thresholdBytes,
      keepTailBytes: config.keepTailBytes,
      checkIntervalMinutes: TRIM_CHECK_INTERVAL_MS / 60000
    },
    lastTrim: readLastTrimResult(),
    database: {
      ...database,
      totalBytes: databaseBytes,
      auditRetentionRows: readAuditRetentionRows()
    }
  };
};

module.exports = {
  getLogSummary,
  trimLogFiles,
  // 启动前轮转脚本（tools/trim-logs.js）复用同一套截断逻辑，保证说明文案一致
  trimOneFile,
  autoTrimNow,
  startAutoTrim,
  readTrimSettings,
  computeKeepTailBytes,
  isFileLocked,
  LOG_DIR,
  DEFAULT_TRIM_SETTINGS,
  MAX_SIZE_MB_MIN,
  MAX_SIZE_MB_MAX,
  TRIM_CHECK_INTERVAL_MS
};
