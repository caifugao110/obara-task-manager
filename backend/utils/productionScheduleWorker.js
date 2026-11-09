'use strict';

// 大日程共享读取子进程（方案 2：子进程隔离）
// ------------------------------------------------------------
// 只由 utils/productionSchedule.js 通过 child_process.fork 启动，
// 不要在常驻主进程里 require 它。
//
// 为什么需要独立进程：
//   2026-11 的生产故障中，160.70 的 SMB 会话在闲置十余小时后被服务端断开，
//   之后的 UNC 调用并不立即返回错误，而是在 Windows 内核里挂住。
//   Node 的 libuv 线程池默认只有 4 个线程，几个挂死的 fs 调用就能把线程池占满，
//   所有依赖线程池的异步操作随之排队，进程活着却不再响应 HTTP——
//   所以 watchdog 只看进程退出码完全察觉不到（本次故障就是这样）。
//
//   把这些调用放进子进程后，主进程只损失「一次等待」，硬超时到了直接杀子进程：
//   挂起的内核调用随子进程一起消失，主进程的事件循环与线程池不受影响。
//
// 协议：父进程 process.send 一个任务，子进程回一条消息后立即退出。
//   { type: 'load', filePath, nowMs, expectedMtimeMs, credentials }
//     → { ok, value: { mtimeMs, size, entries, entryCount, reused }, ensure }
//     → { ok: false, error: { code, message }, ensure }
//   { type: 'probeFs', filePath }
//     → { ok, value: { stat, read, readdir } }

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const uncShare = require('./uncShare');
const productionSchedule = require('./productionSchedule');

// 兜底自毁：父进程万一异常消失（被杀/崩溃），子进程不能永久挂在 SMB 上。
// 正常情况下父进程 20 秒硬超时就会结束我们，这条只是保险。
const SELF_TIMEOUT_MS = 120 * 1000;
const selfTimer = setTimeout(() => process.exit(3), SELF_TIMEOUT_MS);
if (typeof selfTimer.unref === 'function') selfTimer.unref();

let replied = false;

function reply(payload) {
  if (replied) return;
  replied = true;
  try {
    process.send(payload, () => process.exit(0));
  } catch (error) {
    process.exit(1);
  }
}

function toSerializableError(error) {
  if (!error) return { code: 'ERROR', message: '' };
  return {
    code: error.code || 'ERROR',
    message: error.message || String(error)
  };
}

// 读取并解析大日程。expectedMtimeMs 命中时只做一次 stat，复用父进程已解析的缓存，
// 避免缓存到期后为了一个没变的文件反复整本读取共享盘。
async function handleLoad(job) {
  const filePath = String(job.filePath || '');
  const nowMs = Number(job.nowMs) || Date.now();
  const expectedMtimeMs = Number(job.expectedMtimeMs) || 0;
  const credentials = job.credentials || {};

  let outcome;
  try {
    outcome = await uncShare.withShareRetryAsync(filePath, async () => {
      const stat = await fs.promises.stat(filePath);
      if (expectedMtimeMs && stat.mtimeMs === expectedMtimeMs) {
        return { mtimeMs: stat.mtimeMs, size: stat.size, entries: null, entryCount: 0, reused: true };
      }
      const buffer = await fs.promises.readFile(filePath);
      const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
      const index = productionSchedule._private.buildIndex(workbook, new Date(nowMs));
      const entries = [];
      let entryCount = 0;
      for (const list of index.values()) {
        entryCount += list.length;
        for (const entry of list) entries.push(entry);
      }
      return { mtimeMs: stat.mtimeMs, size: stat.size, entries, entryCount, reused: false };
    }, credentials);
  } catch (error) {
    outcome = { ok: false, error };
  }

  reply({
    ok: outcome.ok === true,
    value: outcome.ok ? outcome.value : undefined,
    error: outcome.ok ? undefined : toSerializableError(outcome.error),
    ensure: outcome.ensure || null
  });
}

// 管理员诊断用的裸文件系统探针：绕过 XLSX 解析，分别试 stat / readFile / readdir。
// 与原来一样不触发 net use 重连，只是把调用挪进子进程，避免诊断本身把主进程卡住。
async function handleProbeFs(job) {
  const filePath = String(job.filePath || '');
  const result = { stat: { ok: false }, read: { ok: false }, readdir: { ok: false } };

  try {
    const stat = await fs.promises.stat(filePath);
    result.stat = { ok: true, size: stat.size, mtime: new Date(stat.mtimeMs).toISOString(), isFile: stat.isFile() };
  } catch (error) {
    result.stat = { ok: false, code: error.code || '', message: error.message };
  }
  try {
    const buffer = await fs.promises.readFile(filePath);
    result.read = { ok: true, bytes: buffer.length };
  } catch (error) {
    result.read = { ok: false, code: error.code || '', message: error.message };
  }
  try {
    const dir = path.dirname(filePath);
    const files = await fs.promises.readdir(dir);
    result.readdir = { ok: true, dir, count: files.length, files: files.slice(0, 10) };
  } catch (error) {
    result.readdir = { ok: false, code: error.code || '', message: error.message };
  }

  reply({ ok: true, value: result });
}

if (!process.send) {
  // 不是通过 fork 启动（例如误require），直接退出，避免留下无主进程
  process.exit(0);
}

process.once('message', (job) => {
  const handler = job && job.type === 'probeFs' ? handleProbeFs : handleLoad;
  handler(job || {}).catch((error) => {
    reply({ ok: false, error: toSerializableError(error) });
  });
});
