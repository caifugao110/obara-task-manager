#!/usr/bin/env node
/**
 * 启动前日志轮转（由 start.bat 在拉起服务之前调用）
 *
 * 为什么需要它
 * ------------
 * backend.log / backend.err.log / frontend.log / frontend.err.log 在服务运行期间被
 * 隐藏 cmd 窗口以 `>>` 重定向持有句柄，Windows 上任何其它进程再打开写入都会得到
 * EBUSY，所以后端自己的「自动截断」清不掉这几个文件——而它们恰恰涨得最快。
 * 服务未启动时这些句柄不存在，正好在启动前把它们轮转掉。
 *
 * 阈值与开关直接读数据库里的 settings.system（与页面「日志管理」同一份配置），
 * 避免两处配置不一致；读不到时按默认 50MB 处理，保证不会因为读库失败而完全不管。
 *
 * 用法：
 *   node tools/trim-logs.js              按数据库阈值清理超限日志（start.bat 默认调用）
 *   node tools/trim-logs.js --max-mb 5   临时指定阈值（排障/验证用，不写库）
 *   node tools/trim-logs.js --all        清空全部日志文件（每个只保留一行说明）
 *   node tools/trim-logs.js --dry-run    只报告，不修改任何文件
 *
 * 退出码恒为 0：日志清理失败不应该阻止服务启动，失败信息只打印警告。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');
const MB = 1024 * 1024;

const DEFAULT_MAX_MB = 50;
const MIN_MB = 5;
const MAX_MB = 2048;

const log = (message) => console.log(`[trim-logs] ${message}`);

const parseArgs = (argv) => {
  const options = { maxMb: null, all: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--max-mb') {
      const next = Number(argv[i + 1]);
      if (Number.isFinite(next) && next >= MIN_MB && next <= MAX_MB) {
        options.maxMb = Math.round(next);
        i += 1;
      }
    }
  }
  return options;
};

/** 数据库路径：优先 backend/.env 里的 SQLITE_DB_PATH，相对路径以 backend/ 为基准 */
const resolveDbPath = () => {
  let configured = '';
  try {
    const envText = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
    const line = envText.split(/\r?\n/).find((item) => /^\s*SQLITE_DB_PATH\s*=/.test(item));
    if (line) {
      configured = line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    configured = '';
  }
  if (!configured) return path.join(ROOT, 'backend', 'data.db');
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(ROOT, 'backend', configured);
};

/** 直接只读打开 SQLite，不初始化后端（不需要跑迁移、也不应触发任何写操作） */
const readTrimSettings = () => {
  const fallback = { enabled: true, maxSizeMb: DEFAULT_MAX_MB, source: '默认值' };
  const dbPath = resolveDbPath();
  try {
    const Database = require('better-sqlite3');
    const raw = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = raw.prepare("SELECT value FROM kv_store WHERE key = 'settings'").get();
      if (!row || !row.value) return fallback;
      const parsed = JSON.parse(String(row.value));
      const system = parsed && parsed.system ? parsed.system : {};
      const maxMb = Number(system.logMaxSizeMb);
      return {
        enabled: system.logAutoTrimEnabled !== false,
        maxSizeMb: Number.isFinite(maxMb) && maxMb >= MIN_MB && maxMb <= MAX_MB
          ? Math.round(maxMb)
          : DEFAULT_MAX_MB,
        source: dbPath
      };
    } finally {
      raw.close();
    }
  } catch (err) {
    log(`读取配置失败，按默认 ${DEFAULT_MAX_MB}MB 处理：${err && err.message ? err.message : err}`);
    return fallback;
  }
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const settings = readTrimSettings();
  const maxMb = options.maxMb || settings.maxSizeMb;

  if (!settings.enabled && !options.maxMb && !options.all) {
    log('自动截断已在系统中关闭，跳过（如需强制清理请用 --all 或 --max-mb）');
    return;
  }

  let entries;
  try {
    entries = fs.readdirSync(LOG_DIR, { withFileTypes: true });
  } catch {
    log('logs 目录不存在，跳过');
    return;
  }

  // 延迟 require：只有确实要动文件时才加载后端模块（避免无关场景引入 db 依赖）
  const { trimOneFile, computeKeepTailBytes, isFileLocked } = require('../backend/utils/logFiles');
  const thresholdBytes = maxMb * MB;
  const keepBytes = options.all ? 0 : computeKeepTailBytes(thresholdBytes);

  let scanned = 0;
  let trimmedCount = 0;
  let freedBytes = 0;
  const skipped = [];

  for (const entry of entries) {
    if (!entry.isFile() || !/\.log$/i.test(entry.name)) continue;
    scanned += 1;
    const filePath = path.join(LOG_DIR, entry.name);
    const before = fs.statSync(filePath).size;
    if (!options.all && before < thresholdBytes) continue;

    if (isFileLocked(filePath)) {
      // 理论上服务已被 stop/start 脚本停掉；这里仍保留兜底，避免误判后直接报错
      skipped.push(`${entry.name}(仍被占用)`);
      continue;
    }

    if (options.dryRun) {
      log(`[dry-run] ${entry.name}：${(before / MB).toFixed(2)} MB 超过 ${maxMb} MB`);
      trimmedCount += 1;
      freedBytes += Math.max(0, before - keepBytes);
      continue;
    }

    try {
      const result = trimOneFile(entry.name, {
        keepBytes,
        reason: options.all
          ? '启动前轮转（清空）'
          : `启动前轮转（超过 ${maxMb} MB 上限）`
      });
      if (result.skipped) {
        skipped.push(`${entry.name}(${result.reason})`);
        continue;
      }
      trimmedCount += 1;
      freedBytes += Math.max(0, result.beforeBytes - result.afterBytes);
      log(`${entry.name}：${(result.beforeBytes / MB).toFixed(2)} MB → ${(result.afterBytes / MB).toFixed(2)} MB`);
    } catch (err) {
      skipped.push(`${entry.name}(${err && err.message ? err.message : err})`);
    }
  }

  if (trimmedCount === 0) {
    log(`检查 ${scanned} 个日志文件，没有超过 ${maxMb} MB 的文件`);
  } else {
    log(`${options.dryRun ? '[dry-run] 将处理' : '已处理'} ${trimmedCount} 个文件，`
      + `${options.dryRun ? '预计' : '共'}释放 ${(freedBytes / MB).toFixed(2)} MB`);
  }
  if (skipped.length > 0) {
    log(`跳过 ${skipped.length} 个：${skipped.join('、')}`);
  }
};

try {
  main();
} catch (err) {
  // 清理日志永远不该阻止服务启动
  console.warn(`[trim-logs] 执行异常，已忽略：${err && err.message ? err.message : err}`);
}
process.exit(0);
