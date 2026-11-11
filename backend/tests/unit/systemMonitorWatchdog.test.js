const test = require('node:test');
const assert = require('node:assert');

const monitor = require('../../utils/systemMonitor');

// 看门狗强杀证据的解析回归测试。
// 背景：假死探测脚本（backend-health-probe.bat）连续 N 次探测失败后会 taskkill 整棵树，
// 强杀不执行退出钩子，因此 logs/backend-watchdog.log 的 FATAL 行是唯一书面证据。
// 它写的是 Windows 的 %date% %time%（如「[周三 2026/11/11 23:09:23.08]」），
// 末两位是百分秒而不是毫秒，new Date() 解析不了，必须按字段拼。
// 这里只覆盖纯解析，不读真实日志文件。

test('parseWindowsLogTimestamp 解析 %date% %time% 时间戳', () => {
  const line = '[周三 2026/11/11 23:09:23.08] [probe] [FATAL] backend unresponsive 3 consecutive probes on port 5000 (PID 33652) - killing process tree';
  const ms = monitor.parseWindowsLogTimestamp(line);
  assert.strictEqual(Number.isFinite(ms), true);

  const date = new Date(ms);
  assert.strictEqual(date.getFullYear(), 2026);
  assert.strictEqual(date.getMonth(), 10); // 11 月
  assert.strictEqual(date.getDate(), 11);
  assert.strictEqual(date.getHours(), 23);
  assert.strictEqual(date.getMinutes(), 9);
  assert.strictEqual(date.getSeconds(), 23);
  // 两位小数是百分秒：.08 -> 80ms（不是 8ms）
  assert.strictEqual(date.getMilliseconds(), 80);
});

test('parseWindowsLogTimestamp 兼容无小数、单位数小时与三位毫秒', () => {
  const noFrac = monitor.parseWindowsLogTimestamp('[周三 2026/11/11 23:09:23] x');
  assert.strictEqual(new Date(noFrac).getMilliseconds(), 0);

  const singleDigitHour = monitor.parseWindowsLogTimestamp('[周三 2026/11/11 9:05:01.5] x');
  assert.strictEqual(new Date(singleDigitHour).getHours(), 9);

  const threeDigits = monitor.parseWindowsLogTimestamp('[周三 2026/11/11 23:09:23.456] x');
  assert.strictEqual(new Date(threeDigits).getMilliseconds(), 456);
});

test('parseWindowsLogTimestamp 认不出的格式返回 null 而不是乱猜', () => {
  // 区域设置把日期输出成「月/日/年」时，宁可丢弃证据，也不能算错时间
  assert.strictEqual(monitor.parseWindowsLogTimestamp('[周三 11/11/2026 23:09:23.08] x'), null);
  // 后端自己的 ISO 日志格式不走这个解析器（由 readLogTail 处理）
  assert.strictEqual(monitor.parseWindowsLogTimestamp('[2026-11-11T15:08:57.194Z] uncaughtException'), null);
  assert.strictEqual(monitor.parseWindowsLogTimestamp('没有时间戳的一行'), null);
});

test('readWatchdogKills 只收 FATAL 强杀行，且不因缺少日志而抛错', () => {
  const items = monitor.readWatchdogKills();
  assert.strictEqual(Array.isArray(items), true);
  for (const item of items) {
    assert.match(item.raw, /killing process tree/);
    assert.strictEqual(Number.isFinite(item.tsMs), true);
  }
});
