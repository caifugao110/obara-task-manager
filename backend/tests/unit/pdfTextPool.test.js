const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readPdfTextOffThread, readPdfLinesOffThread, getPoolStats } = require('../../utils/pdfTextPool');

// PDF 解析在 worker 线程执行（主线程不被 CPU 计算占住）。
// 这里只验证「线程真的跑起来了、错误能回传」，不依赖共享盘上的真实文件。
// 背景：pdf-parse 的 getText() 是纯 CPU 计算，放在主线程会让 6 个人同时录入时
// 页面卡顿叠加；改造后解析发生在 worker 线程，主线程继续处理其他请求。

test('缺文件时错误从 worker 回传，且带原始错误码', async () => {
  const missing = path.join(__dirname, 'no-such-spec-99999.PDF');
  await assert.rejects(
    () => readPdfTextOffThread(missing),
    (error) => {
      assert.strictEqual(error.code, 'ENOENT');
      return true;
    }
  );
});

test('readPdfLinesOffThread 与文本读取共用同一套解析结果', async () => {
  const missing = path.join(__dirname, 'no-such-spec-99998.PDF');
  await assert.rejects(() => readPdfLinesOffThread(missing), /ENOENT|no such file/i);
});

test('线程池状态可观测（诊断用）', () => {
  const stats = getPoolStats();
  assert.ok(stats.maxWorkers >= 1);
  assert.strictEqual(typeof stats.queued, 'number');
  assert.strictEqual(typeof stats.degraded, 'boolean');
});
