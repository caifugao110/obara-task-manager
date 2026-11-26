/**
 * 监测模块的日志取证
 *
 * 从 utils/systemMonitor.js 拆出来的第一块：**只读、无状态**的那部分——
 * 读日志尾部、解析 Windows 批处理日志的时间戳、抓看门狗强杀记录。
 *
 * 为什么先拆它：systemMonitor.js 里剩下的采集器与查询共享大量可变状态
 * （采样缓存、分钟桶、boot 信息），整体拆分要先把这些状态搬进独立模块，
 * 属于另一次有风险的改动；而这几段是纯函数 + 一个 5 秒缓存，搬出来零风险。
 */
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const WATCHDOG_LOG_PATH = path.join(LOG_DIR, 'backend-watchdog.log');
const LOG_TAIL_BYTES = 2 * 1024 * 1024;
const nowMs = () => Date.now();

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

module.exports = {
  readLogTail,
  readLogTailText,
  WIN_LOG_TS,
  parseWindowsLogTimestamp,
  clockOf,
  readWatchdogKills,
};
