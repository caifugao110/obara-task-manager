'use strict';

// PDF 文本提取（含 pdf-parse 在 Node 环境需要的浏览器 API 垫片）。
//
// 仕样信息搜索（routes/spec.js）与状态跟踪的「营业担当」自动补全
// （utils/specInfoLookup.js）都要读仕样书 PDF，之前垫片只写在路由里，
// 抽到此处后两边共用同一份加载逻辑，避免两套实现解析结果不一致。

const fs = require('fs');

let PDFParse = null;

async function getPdfParse() {
  if (!PDFParse) {
    if (typeof DOMMatrix === 'undefined') {
      global.DOMMatrix = class {
        constructor(init) {
          this.m11 = 1; this.m12 = 0; this.m21 = 0; this.m22 = 1; this.m41 = 0; this.m42 = 0;
          if (init && typeof init === 'object' && 'm11' in init) {
            Object.assign(this, init);
          }
        }
        multiply(other) { return this; }
        transformPoint(point) { return point; }
        inverse() { return this; }
      };
    }
    if (typeof ImageData === 'undefined') {
      global.ImageData = class {
        constructor(data, width, height) {
          this.data = data; this.width = width; this.height = height;
        }
      };
    }
    if (typeof Path2D === 'undefined') {
      global.Path2D = class {
        constructor() {}
        moveTo() {}
        lineTo() {}
        arc() {}
        rect() {}
        closePath() {}
        addPath() {}
      };
    }
    if (typeof process.getBuiltinModule === 'undefined') {
      process.getBuiltinModule = () => ({});
    }
    const module = require('pdf-parse');
    PDFParse = module.PDFParse;
  }
  return PDFParse;
}

// 读取 PDF 全文，返回原始文本字符串。
// 注意：`pdf.getText()` 是纯 CPU 计算，几 MB 的仕样书要跑几百毫秒到一秒，
// 在主线程上执行会整段占住事件循环（多人同时录入时叠加成连续卡顿）。
// 请求路径请走 utils/pdfTextPool.js 的 readPdfTextOffThread，把它交给 worker 线程。
const readPdfText = async (filePath) => {
  const buffer = await fs.promises.readFile(filePath);
  const ParseClass = await getPdfParse();
  const pdf = new ParseClass({ data: buffer });
  const textResult = await pdf.getText();
  return (textResult && textResult.text) || '';
};

const toLines = (text) => String(text || '')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line);

// 读取 PDF 全文并返回按行切分后的文本数组（去空行）。
const readPdfLines = async (filePath) => toLines(await readPdfText(filePath));

module.exports = {
  getPdfParse,
  readPdfText,
  readPdfLines,
  toLines
};
