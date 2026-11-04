'use strict';

// PDF 解析线程池
//
// 背景：pdf-parse 的 getText() 是纯 CPU 计算，几 MB 的仕样书要跑几百毫秒到一秒。
// 它跑在主线程上时，Node 的事件循环被整段占住——录入的人一多，别人的页面加载、
// 保存、查询就一起排队（实测 1 秒级；几个人同时查会叠加）。
//
// 这里用 worker_threads 开少量常驻线程专门做解析，主线程只负责派发与收结果：
//   - 池大小 MAX_WORKERS：留一个核给主线程，最多 3 个（worker 各自有一份 pdfjs 内存）
//   - 空闲 5 分钟后回收线程，避免长期占用内存
//   - 队列上限 MAX_QUEUE：超出直接失败，防止批量刷新把队列堆爆
//   - worker 起不来或反复崩溃时，自动降级为主线程解析（保证功能不失效，只是重新变慢）
//
// 对外只暴露读文本/读行的 Promise 接口，调用方不需要感知线程细节。

const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const { readPdfText, toLines } = require('./pdfText');

const WORKER_FILE = path.join(__dirname, 'pdfTextWorker.js');
const CPU_COUNT = (os.cpus() || []).length || 2;
const MAX_WORKERS = Math.max(1, Math.min(3, CPU_COUNT - 1));
const MAX_QUEUE = 16;
const JOB_TIMEOUT_MS = 60 * 1000;
const IDLE_TERMINATE_MS = 5 * 60 * 1000;
const MAX_CRASHES_BEFORE_DEGRADE = 3;

/** @type {{ worker: Worker, busy: boolean, current: any, idleTimer: any, terminating: boolean }[]} */
const slots = [];
const queue = [];

let seq = 0;
let degraded = false;
let degradeReason = '';
const stats = { jobs: 0, offloaded: 0, fallback: 0, failed: 0, timeouts: 0, crashes: 0, rejectedByQueueLimit: 0 };

function degrade(reason) {
  if (degraded) return;
  degraded = true;
  degradeReason = reason;
  console.warn(`[pdfTextPool] worker 线程不可用，已降级为主线程解析（${reason}）。` +
    '功能正常，但解析期间主线程会被短暂占用；请检查 worker_threads 是否被运行环境禁用。');
}

function releaseSlot(slot) {
  slot.busy = false;
  slot.current = null;
  if (typeof slot.worker.unref === 'function') slot.worker.unref();
  if (!slot.idleTimer) {
    slot.idleTimer = setTimeout(() => {
      const index = slots.indexOf(slot);
      if (index === -1 || slot.busy) return;
      slots.splice(index, 1);
      slot.terminating = true;
      slot.worker.terminate().catch(() => {});
    }, IDLE_TERMINATE_MS);
    // 空闲回收不该阻止进程退出（测试/脚本场景）
    if (typeof slot.idleTimer.unref === 'function') slot.idleTimer.unref();
  }
  pump();
}

function spawnSlot() {
  const worker = new Worker(WORKER_FILE);
  const slot = { worker, busy: false, current: null, idleTimer: null, terminating: false };
  slots.push(slot);

  worker.on('message', (message) => {
    const job = slot.current;
    if (!job || !message || message.id !== job.id) return;
    if (slot.idleTimer) { clearTimeout(slot.idleTimer); slot.idleTimer = null; }
    if (job.timer) clearTimeout(job.timer);
    if (message.ok) {
      stats.offloaded += 1;
      job.resolve(message.text || '');
    } else {
      stats.failed += 1;
      job.reject(Object.assign(new Error(message.message || 'PDF 解析失败'), { code: message.code || 'PDF_PARSE_FAILED' }));
    }
    releaseSlot(slot);
  });

  worker.on('error', (error) => {
    stats.crashes += 1;
    const job = slot.current;
    if (slot.idleTimer) { clearTimeout(slot.idleTimer); slot.idleTimer = null; }
    if (job) {
      if (job.timer) clearTimeout(job.timer);
      job.reject(Object.assign(new Error(`PDF 解析线程异常：${error.message}`), { code: 'PDF_WORKER_ERROR' }));
    }
    const index = slots.indexOf(slot);
    if (index !== -1) slots.splice(index, 1);
    slot.terminating = true;
    slot.worker.terminate().catch(() => {});
    if (stats.crashes >= MAX_CRASHES_BEFORE_DEGRADE) degrade(`worker 连续异常 ${stats.crashes} 次`);
    else pump();
  });

  worker.on('exit', (code) => {
    const index = slots.indexOf(slot);
    if (index !== -1) slots.splice(index, 1);
    if (slot.terminating || code === 0) return;
    stats.crashes += 1;
    const job = slot.current;
    if (job) {
      if (job.timer) clearTimeout(job.timer);
      job.reject(Object.assign(new Error(`PDF 解析线程退出（code=${code}）`), { code: 'PDF_WORKER_EXIT' }));
    }
    if (stats.crashes >= MAX_CRASHES_BEFORE_DEGRADE) degrade(`worker 异常退出，code=${code}`);
    else pump();
  });

  // 空闲时不阻止进程退出；派发任务时再 ref
  if (typeof worker.unref === 'function') worker.unref();
  return slot;
}

// 降级路径：主线程直接解析（与 worker 产出一致，只是会占用事件循环）
async function runInProcess(job) {
  stats.fallback += 1;
  try {
    job.resolve(await readPdfText(job.filePath));
  } catch (error) {
    stats.failed += 1;
    job.reject(error);
  }
}

function pump() {
  while (queue.length > 0) {
    if (degraded) {
      runInProcess(queue.shift());
      continue;
    }
    let slot = slots.find(item => !item.busy);
    if (!slot && slots.length < MAX_WORKERS) {
      try {
        slot = spawnSlot();
      } catch (error) {
        degrade(`创建 worker 失败：${error.message}`);
        continue;
      }
    }
    if (!slot) return;

    const job = queue.shift();
    slot.busy = true;
    slot.current = job;
    if (slot.idleTimer) { clearTimeout(slot.idleTimer); slot.idleTimer = null; }
    if (typeof slot.worker.ref === 'function') slot.worker.ref();

    job.timer = setTimeout(() => {
      stats.timeouts += 1;
      const index = slots.indexOf(slot);
      if (index !== -1) slots.splice(index, 1);
      slot.terminating = true;
      slot.worker.terminate().catch(() => {});
      job.reject(Object.assign(new Error('PDF 解析超时'), { code: 'PDF_PARSE_TIMEOUT' }));
      pump();
    }, JOB_TIMEOUT_MS);
    if (typeof job.timer.unref === 'function') job.timer.unref();

    try {
      slot.worker.postMessage({ id: job.id, filePath: job.filePath });
    } catch (error) {
      if (job.timer) clearTimeout(job.timer);
      slot.busy = false; slot.current = null;
      job.reject(Object.assign(new Error(`派发解析任务失败：${error.message}`), { code: 'PDF_WORKER_POST_FAILED' }));
    }
  }
}

/**
 * 在 worker 线程里读取 PDF 全文。
 * @param {string} filePath
 * @returns {Promise<string>} 解析出的纯文本
 */
function readPdfTextOffThread(filePath) {
  stats.jobs += 1;
  if (degraded) return readPdfText(filePath);
  if (queue.length >= MAX_QUEUE) {
    stats.rejectedByQueueLimit += 1;
    return Promise.reject(Object.assign(
      new Error('PDF 解析任务排队过多，请稍后重试'),
      { code: 'PDF_QUEUE_FULL' }
    ));
  }
  return new Promise((resolve, reject) => {
    seq += 1;
    queue.push({ id: seq, filePath, resolve, reject, timer: null });
    pump();
  });
}

/**
 * 在 worker 线程里读取 PDF 并按行切分。
 * @param {string} filePath
 * @returns {Promise<string[]>}
 */
async function readPdfLinesOffThread(filePath) {
  return toLines(await readPdfTextOffThread(filePath));
}

function getPoolStats() {
  return {
    ...stats,
    maxWorkers: MAX_WORKERS,
    activeWorkers: slots.length,
    busyWorkers: slots.filter(item => item.busy).length,
    queued: queue.length,
    degraded,
    degradeReason
  };
}

module.exports = {
  readPdfTextOffThread,
  readPdfLinesOffThread,
  getPoolStats,
  _private: { MAX_WORKERS, MAX_QUEUE, JOB_TIMEOUT_MS }
};
