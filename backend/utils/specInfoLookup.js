'use strict';

// 仕样书 PDF → 营业担当 / 最终客户
//
// 状态跟踪同步「各产品大日程」时，表格里只有客户、数量、纳期、已发图，没有营业担当；
// 营业担当与组长原本只能靠人工在行内手动点「刷新」触发 /api/spec/info 才填上。
// 这里把「按仕样号找到最新版仕样书 → 解析出营业担当」抽成服务端可复用的能力，
// 供按钮同步与「数据库维护」的定时任务共用。
//
// 两点设计取舍：
//   1. 目录索引：仕样书共享目录有 8 万多份文件，逐份 existsSync 判断 10 个版本号
//      代价高；改为 readdir 建索引（约 40ms）并在内存缓存 10 分钟。
//   2. 结果缓存：按「文件 + 大小 + 修改时间」做签名缓存，PDF 被替换后会自然失效；
//      命中缓存时重复同步几乎不耗时。

const fs = require('fs');
const path = require('path');
const securityConfig = require('../config/security');
const specPdfParser = require('./specPdfParser');
const { readPdfLinesOffThread } = require('./pdfTextPool');

const SHARE_DIR = securityConfig.spec.sharePath;
const INDEX_TTL_MS = 10 * 60 * 1000;
const INFO_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_INFO_CACHE = 5000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const PARSE_CONCURRENCY = 4;

// 表单字段标签：避免把「营业担当」「技术审核」这类标签误判成人名
const FORM_LABEL_PATTERN = /审核|设计|图号|品号|工时|类型|担当|内勤|仕样|纳期|数量|客户|中间商|联系人|电话|认证|出口|项目|状态|版本|变更|追记|日期|单位|备注/;

let indexCache = null; // { at, map }
const infoCache = new Map(); // specNumber -> { file, size, mtimeMs, salesPerson, finalClient, at }

const toText = (value) => (value === undefined || value === null ? '' : String(value));

const splitParts = (line) => String(line || '')
  .split(/\t|\s{2,}/)
  .map(part => part.trim())
  .filter(Boolean);

const isPersonName = (text) => {
  const value = String(text || '').trim();
  if (!value || value.length > 4) return false;
  if (!/^[\u4e00-\u9fa5]{2,}$/.test(value)) return false;
  return !FORM_LABEL_PATTERN.test(value);
};

// 专用规则未命中时的兜底：按签核区「最终客户 \t 营业担当」值行取人
const extractFromSignatureBlock = (lines) => {
  let labelIndex = -1;
  let fallbackLabelIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('营业担当')) continue;
    if (line.includes('营业审核')) { labelIndex = i; break; }
    if (fallbackLabelIndex < 0) fallbackLabelIndex = i;
  }
  if (labelIndex < 0) labelIndex = fallbackLabelIndex;
  if (labelIndex < 0) return { salesPerson: '', finalClient: '' };

  // 标签行的上一行通常是「最终客户 \t 营业担当」的值行
  for (let i = labelIndex - 1; i >= 0 && i >= labelIndex - 3; i--) {
    const parts = splitParts(lines[i]);
    if (parts.length === 0) continue;
    const person = parts[parts.length - 1];
    if (parts.length >= 2 && isPersonName(person)) {
      return { salesPerson: person, finalClient: parts[0] === person ? '' : parts[0] };
    }
    if (parts.length === 1 && isPersonName(person)) {
      return { salesPerson: person, finalClient: '' };
    }
  }

  // 少数版式把签名放在标签行之后
  for (let i = labelIndex + 1; i < Math.min(lines.length, labelIndex + 4); i++) {
    const person = splitParts(lines[i]).find(isPersonName);
    if (person) return { salesPerson: person, finalClient: '' };
  }
  return { salesPerson: '', finalClient: '' };
};

// 解析单份仕样书：先用分类专用规则（覆盖 7 类客户仕样书），失败再走签核区兜底
// 文本提取在 worker 线程（utils/pdfTextPool.js）执行，批量同步几十份也不会卡住主线程
const parseSpecPdf = async (filePath) => {
  const lines = await readPdfLinesOffThread(filePath);
  const category = specPdfParser.detectSpecCategory(lines);
  if (category) {
    const info = specPdfParser.extractSpecInfoByCategory(lines, category);
    if (info && toText(info.salesPerson).trim()) {
      return {
        salesPerson: toText(info.salesPerson).trim(),
        finalClient: toText(info.finalClient).trim(),
        category,
        matchedBy: 'category'
      };
    }
  }
  const fallback = extractFromSignatureBlock(lines);
  return {
    salesPerson: fallback.salesPerson,
    finalClient: fallback.finalClient,
    category: category || '',
    matchedBy: fallback.salesPerson ? 'signature' : ''
  };
};

// 仕样号 → 最新版 PDF 文件名（58249.08.PDF 优先于 58249.PDF）
// 8 万多份文件的 readdir 走异步：共享盘抖动时不会卡住事件循环
const buildPdfIndex = async () => {
  const files = await fs.promises.readdir(SHARE_DIR);
  const map = new Map();
  for (const file of files) {
    const matched = /^(\d{5,6})(?:\.(\d{2}))?\.PDF$/i.exec(file);
    if (!matched) continue;
    const version = matched[2] ? parseInt(matched[2], 10) : 0;
    const previous = map.get(matched[1]);
    if (!previous || version > previous.version) {
      map.set(matched[1], { file, version });
    }
  }
  return map;
};

const getPdfIndex = async ({ forceReload = false } = {}) => {
  const now = Date.now();
  if (!forceReload && indexCache && now - indexCache.at < INDEX_TTL_MS) {
    return indexCache.map;
  }
  try {
    const map = await buildPdfIndex();
    indexCache = { at: now, map };
    return map;
  } catch (error) {
    console.warn('[specInfoLookup] 读取仕样书共享目录失败:', error.message);
    // 复用上一次成功建立的索引，总比整批解析失败好
    return indexCache ? indexCache.map : null;
  }
};

const pruneCache = () => {
  if (infoCache.size <= MAX_INFO_CACHE) return;
  const overflow = infoCache.size - MAX_INFO_CACHE;
  let removed = 0;
  for (const key of infoCache.keys()) {
    infoCache.delete(key);
    if (++removed >= overflow) break;
  }
};

/**
 * 批量解析仕样号对应的营业担当。
 * @param {string[]} specNumbers 仕样号列表（自动去重）
 * @param {Object} [options]
 * @param {boolean} [options.forceReload] 忽略目录索引缓存
 * @returns {Promise<{responsibles: Map<string, {salesPerson: string, finalClient: string}>, stats: Object}>}
 */
async function resolveSalesPersons(specNumbers, { forceReload = false } = {}) {
  const unique = Array.from(new Set((specNumbers || []).map(value => toText(value).trim()).filter(Boolean)));
  const stats = {
    requested: unique.length,
    resolved: 0,
    fromCache: 0,
    parsed: 0,
    missingPdf: 0,
    noSalesPerson: 0,
    failed: 0,
    shareAvailable: true
  };
  const responsibles = new Map();
  if (unique.length === 0) return { responsibles, stats };

  const index = await getPdfIndex({ forceReload });
  if (!index) {
    stats.shareAvailable = false;
    return { responsibles, stats };
  }

  const pending = [];
  const now = Date.now();
  for (const specNumber of unique) {
    const hit = index.get(specNumber);
    if (!hit) { stats.missingPdf++; continue; }
    const filePath = path.join(SHARE_DIR, hit.file);
    let signature;
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_PDF_BYTES) { stats.failed++; continue; }
      signature = { file: hit.file, size: stat.size, mtimeMs: stat.mtimeMs };
    } catch (error) {
      stats.failed++;
      continue;
    }

    const cached = infoCache.get(specNumber);
    if (cached && cached.file === signature.file && cached.size === signature.size
      && cached.mtimeMs === signature.mtimeMs && now - cached.at < INFO_TTL_MS) {
      responsibles.set(specNumber, { salesPerson: cached.salesPerson, finalClient: cached.finalClient });
      stats.fromCache++;
      continue;
    }
    pending.push({ specNumber, filePath, signature });
  }

  // 解析按固定并发跑，避免一次同步把共享盘和 CPU 打满
  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const task = pending[cursor++];
      try {
        const info = await parseSpecPdf(task.filePath);
        const salesPerson = toText(info.salesPerson).trim();
        const finalClient = toText(info.finalClient).trim();
        infoCache.set(task.specNumber, { ...task.signature, salesPerson, finalClient, at: Date.now() });
        if (salesPerson) {
          responsibles.set(task.specNumber, { salesPerson, finalClient });
          stats.parsed++;
        } else {
          stats.noSalesPerson++;
        }
      } catch (error) {
        stats.failed++;
        console.warn(`[specInfoLookup] 解析仕样书失败 ${task.signature.file}:`, error.message);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARSE_CONCURRENCY, pending.length) }, worker));

  stats.resolved = responsibles.size;
  pruneCache();
  return { responsibles, stats };
}

// 供测试与排查：清空两份缓存
const clearCaches = () => {
  indexCache = null;
  infoCache.clear();
};

module.exports = {
  resolveSalesPersons,
  clearCaches,
  _private: {
    buildPdfIndex,
    extractFromSignatureBlock,
    parseSpecPdf,
    isPersonName
  }
};
