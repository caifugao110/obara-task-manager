'use strict';

// PDF 文本提取的 worker 线程入口。
//
// 只做一件事：收到文件路径 → 读文件 → pdf-parse 取全文 → 把纯文本回传。
// 放在独立线程里执行，主线程在解析期间仍能处理其他请求（录入、查询、页面加载）。
//
// 协议：
//   主线程 → worker: { id: number, filePath: string }
//   worker → 主线程: { id, ok: true, text } | { id, ok: false, code, message }

const { parentPort } = require('worker_threads');
const { readPdfText } = require('./pdfText');

if (!parentPort) {
  throw new Error('pdfTextWorker 必须作为 worker 线程运行');
}

parentPort.on('message', async (message) => {
  const { id, filePath } = message || {};
  try {
    const text = await readPdfText(filePath);
    parentPort.postMessage({ id, ok: true, text });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      code: (error && error.code) || '',
      message: (error && error.message) || String(error)
    });
  }
});
