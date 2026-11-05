const express = require('express');
const router = express.Router();
const path = require('path');
const fs2 = require('fs');
const asyncHandler = require('express-async-handler');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const securityConfig = require('../config/security');
const db = require('../db');
const specPdfParser = require('../utils/specPdfParser');
const productionSchedule = require('../utils/productionSchedule');
const { readPdfTextOffThread } = require('../utils/pdfTextPool');

// 获取系统配置的仕样号位数（默认 5，可配置为 5 或 6）
function getConfiguredSpecDigits() {
  try {
    // 只需要 settings：不必克隆整库
    const digits = db.readSettings()?.system?.specNumberDigits;
    return digits === 6 ? 6 : 5;
  } catch (e) {
    return 5;
  }
}

// 校验仕样号位数是否符合全局配置
function validateSpecNumberDigits(specNumber) {
  const digits = getConfiguredSpecDigits();
  if (!/^\d+$/.test(specNumber)) {
    return { valid: false, message: '仕样号格式不正确' };
  }
  if (specNumber.length !== digits) {
    return { valid: false, message: `仕样号必须为 ${digits} 位数字` };
  }
  return { valid: true };
}


function trimTrailingSeparators(value) {
  return String(value || '').replace(/[\\/]+$/, '');
}

function toForwardSharePath(value) {
  return trimTrailingSeparators(value).replace(/\\/g, '/') + '/';
}

function toBackslashSharePath(value) {
  return trimTrailingSeparators(value).replace(/\//g, '\\') + '\\';
}

var SPEC_SHARE_PATH = toForwardSharePath(securityConfig.spec.sharePath);
var SPEC_SHARE_PATH_BS = toBackslashSharePath(securityConfig.spec.sharePath);

function isPathSafe(specNumber) {
  if (!specNumber || typeof specNumber !== 'string') return false;

  const normalized = specNumber.normalize('NFC');

  if (/\.{2}/.test(normalized)) return false;

  if (/[\\\/:]/.test(normalized)) return false;

  const encodedPathPatterns = [
    /%2e%2e/i,
    /%2e\./i,
    /\.%2e/i,
    /\uFF0E\uFF0E/,
    /\uFEFF\u002e/,
    /\u200E\u002e/,
    /\u200F\u002e/
  ];
  for (const pattern of encodedPathPatterns) {
    if (pattern.test(normalized)) return false;
  }

  if (!/^\d+$/.test(normalized)) return false;

  return true;
}

function buildCandidatePath(specNumber, suffix) {
  if (!isPathSafe(specNumber)) return null;

  if (specNumber.length > 20) return null;

  var basePath1 = path.normalize(SPEC_SHARE_PATH);
  var basePath2 = path.normalize(SPEC_SHARE_PATH_BS);

  var fp = path.normalize(basePath1 + specNumber + suffix);
  var bp = path.normalize(basePath2 + specNumber + suffix);

  if (!fp.startsWith(basePath1) && !fp.startsWith(basePath1.replace(/\/$/, ''))) {
    return null;
  }

  if (!bp.startsWith(basePath2) && !bp.startsWith(basePath2.replace(/\\$/, ''))) {
    return null;
  }

  return { fp, bp };
}

const fileExists = async (target) => {
  try {
    await fs2.promises.access(target);
    return true;
  } catch (e) {
    return false;
  }
};

// 仕样书共享目录是否可访问：结果缓存（可用 30 秒 / 不可用 10 秒），
// 避免每次查询都对共享盘做一轮探测，同时保证共享恢复后能较快重新命中。
//
// 探测必须带时限：共享服务器不可达时，Windows 对 UNC 的 stat 等的是 SMB 自己那套超时
// （30 秒起步），不设上限就谈不上「快速失败」——用户看到的是请求一直转圈，
// 而前端 15 秒超时后还会把这种「无响应」误判成后端离线。
// 走异步 API 的原因见 productionSchedule：同步 API 会把整个事件循环占住。
const SHARE_PROBE_TIMEOUT_MS = 2000;
const SHARE_OK_TTL_MS = 30 * 1000;
const SHARE_FAIL_TTL_MS = 10 * 1000;
let shareState = { ok: true, at: 0, timedOut: false };

// 给任意 Promise 加时限；超时返回 { timedOut: true }，不抛错，由调用方决定怎么降级。
// 注意：超时只是「不再等」，被放弃的内部操作仍会跑完（Promise 无法取消），
// 因此下面每个调用点都必须自己保证不会在后台堆积无意义的共享盘访问。
function withDeadline(promise, ms) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  const settled = Promise.resolve(promise).then(
    (value) => ({ timedOut: false, value }),
    (error) => ({ timedOut: false, error })
  );
  return Promise.race([settled, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * 探测仕样书共享是否可访问（带缓存与硬性时限）。
 * @returns {Promise<{ ok: boolean, timedOut: boolean, cached?: boolean, elapsedMs: number }>}
 */
async function checkSpecShare() {
  const startedAt = Date.now();
  const cachedTtl = shareState.ok ? SHARE_OK_TTL_MS : SHARE_FAIL_TTL_MS;
  if (shareState.at && Date.now() - shareState.at < cachedTtl) {
    return { ok: shareState.ok, timedOut: shareState.timedOut, cached: true, elapsedMs: Date.now() - startedAt };
  }

  const probe = await withDeadline(
    (async () => (await fileExists(SPEC_SHARE_PATH)) || (await fileExists(SPEC_SHARE_PATH_BS)))(),
    SHARE_PROBE_TIMEOUT_MS
  );

  const ok = !probe.timedOut && probe.value === true;
  shareState = { ok, at: Date.now(), timedOut: probe.timedOut === true };
  if (!ok) {
    console.warn(
      `[spec] 仕样书共享不可访问（${probe.timedOut ? `探测超过 ${SHARE_PROBE_TIMEOUT_MS}ms` : '路径不存在'}）：${securityConfig.spec.sharePath}`
    );
  }
  return { ok, timedOut: shareState.timedOut, elapsedMs: Date.now() - startedAt };
}

// 共享不通时给用户看的一句话：必须说清是哪个共享，否则「无法访问共享目录」等于没说
const SPEC_SHARE_UNAVAILABLE_MESSAGE = `无法访问仕样书共享目录（${securityConfig.spec.sharePath}），请检查网络连接或联系管理员`;

// 大日程只服务于状态跟踪页：其他入口（主页面、台账、快速取号）一律只看仕样书共享。
const SCHEDULE_LOOKUP_TIMEOUT_MS = 3000;

// 取该仕样号的最新版 PDF（58249.08.PDF 优先于 58249.PDF）。
// 各候选并行探测：串行 10 次网络 access 会叠加成上百毫秒，且期间占着请求。
async function findLatestSpecPdf(n) {
  var share = await checkSpecShare();
  if (!share.ok) return null;

  var candidates = [{ suffix: '.PDF', version: 0 }];
  for (var i = 1; i <= 9; i++) {
    var v = (i < 10 ? '0' : '') + i;
    candidates.push({ suffix: '.' + v + '.PDF', version: i });
  }

  var found = await Promise.all(candidates.map(async function(item) {
    var built = buildCandidatePath(n, item.suffix);
    if (!built) return null;
    if (await fileExists(built.fp)) return { file: built.fp, version: item.version };
    if (await fileExists(built.bp)) return { file: built.bp, version: item.version };
    return null;
  }));

  var latest = null;
  for (var k = 0; k < found.length; k++) {
    var hit = found[k];
    if (hit && (!latest || hit.version > latest.version)) latest = hit;
  }
  return latest ? latest.file : null;
}

// PDF 未命中时的兜底：大日程里存在、但共享里没有对应 PDF 的仕样号，
// 客户名/数量/纳期只有表格里才有。回退必须零故障面——所以先看可达性缓存，
// 只有「70 当前已知可达」才真去读；不知道或已不可达就直接放弃。
async function lookupScheduleFallback(n) {
  const hint = productionSchedule.getReachabilityHint();
  if (!hint.known || !hint.ok) return null;
  const result = await withDeadline(productionSchedule.findScheduleEntry(n, ''), SCHEDULE_LOOKUP_TIMEOUT_MS);
  return result.timedOut ? null : (result.value || null);
}

function isSkipDataLine(line) {
  var s = (line || '').trim();
  if (!s) return true;
  if (/^[\u2713\u2610\u25a1\u2611\uf0fc\u2705\u270b\s]+$/.test(s)) return true;
  return false;
}

function parseDateQuantityLine(line) {
  var dateStr = null;
  var qtyStr = null;
  var parts = line.split('\t');
  for (var pi = 0; pi < parts.length; pi++) {
    var p = parts[pi].trim();
    var dm = p.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (dm) dateStr = dm[1];
    else if (/^\d+$/.test(p)) qtyStr = p;
  }
  if (!dateStr) {
    var dqm = line.match(/(\d{4}-\d{2}-\d{2})/);
    if (dqm) dateStr = dqm[1];
  }
  if (!qtyStr && parts.length >= 2) {
    var last = parts[parts.length - 1].trim();
    if (/^\d+$/.test(last)) qtyStr = last;
  }
  return {dateStr: dateStr, qtyStr: qtyStr};
}

// PDF 解析资源保护：
// - 共享目录中的 PDF 由人工上传，体积不可控，超大文件解析会占用大量内存与 CPU；
// - 解析本身已移到 worker 线程（utils/pdfTextPool.js），主线程不再被 CPU 计算占住，
//   因此这里的上限只用于限制「同时排队 + 解析」的总量，防止批量刷新把队列堆爆。
const MAX_SPEC_PDF_BYTES = 20 * 1024 * 1024;
const MAX_CONCURRENT_PARSES = 12;
let activePdfParses = 0;

// 解析前先 stat：不是普通文件或超过体积上限时直接跳过，不读入内存。
// 走异步 API——仕样书也在共享盘上，statSync 遇到共享不可达会卡住整个事件循环。
const checkSpecPdfReadable = async (filePath) => {
  try {
    const stat = await fs2.promises.stat(filePath);
    if (!stat.isFile()) return { ok: false, reason: '目标不是普通文件' };
    if (stat.size > MAX_SPEC_PDF_BYTES) {
      return { ok: false, reason: `文件大小 ${(stat.size / 1024 / 1024).toFixed(1)}MB 超过 20MB 上限，已拒绝解析` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: '文件读取失败' };
  }
};

async function extractSpecInfoFromPdf(p) {
  const readable = await checkSpecPdfReadable(p);
  if (!readable.ok) {
    console.warn('[spec] 跳过解析:', readable.reason, p);
    return null;
  }
  if (activePdfParses >= MAX_CONCURRENT_PARSES) return null;
  activePdfParses += 1;
  try {
    // 取文本这一步在 worker 线程执行：getText() 是纯 CPU 计算，
    // 几十份仕样书一起解析也不会把主线程（HTTP/DB）堵住。
    var t = await readPdfTextOffThread(p);

    var info = {
      specNumber: '',
      middleMan: '',
      finalClient: '',
      projectName: '',
      quantity: '',
      deliveryDate: null,
      salesPerson: '',
      isModification: false
    };

    var lines = t.split('\n').map(l => l.trim()).filter(l => l);
    var headerText = lines.slice(0, 3).join('');
    info.isModification = headerText.includes('客户仕样书') && headerText.includes('修改');

    // 优先按5类专用仕样书规则解析（PSW GUN / SERVO GUN / GM Lean Series GUN / 焊钳修改 / IT GUN），
    // 未命中类别或专用规则解析不到仕样号时，回退到下方通用解析规则
    var specCategory = specPdfParser.detectSpecCategory(lines);
    if (specCategory) {
      var catInfo = specPdfParser.extractSpecInfoByCategory(lines, specCategory);
      if (catInfo && catInfo.specNumber) {
        return catInfo;
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      var specNumMatch = line.match(/计划编号.*?(\d{5,})/);
      if (specNumMatch) {
        info.specNumber = specNumMatch[1];
      }

      var projectNameMatch = line.match(/项目名称\s+(.+)/);
      if (projectNameMatch) {
        info.projectName = projectNameMatch[1].trim();
      }

      if (line.includes('最终客户') && line.includes('中间商')) {
        if (lines[i + 1]) {
          var planMatch = lines[i + 1].match(/(\d{5,})/);
          if (planMatch) info.specNumber = planMatch[1];
        }

        var dataLines = [];
        var salesPersonFromPrevLine = '';
        for (var dj = i + 2; dj < lines.length && dj < i + 15; dj++) {
          var dataLine = lines[dj];
          if (!dataLine) continue;
          if (dataLine.includes('营业担当') && dataLine.includes('营业审核')) {
            if (dj > i + 2) {
              var prevLine = lines[dj - 1];
              if (prevLine && !prevLine.includes('技术审核') && !prevLine.includes('营业审核') && !prevLine.includes('营业担当')) {
                salesPersonFromPrevLine = prevLine.trim();
              }
            }
            break;
          }
          if (dataLine.includes('技术审核')) break;
          if (isSkipDataLine(dataLine)) continue;
          dataLines.push(dataLine);
        }

        var dateQtyLineIndex = -1;
        for (var k = 0; k < dataLines.length; k++) {
          var dq = parseDateQuantityLine(dataLines[k]);
          if (dq.dateStr || dq.qtyStr) {
            dateQtyLineIndex = k;
            if (dq.dateStr) {
              info.deliveryDate = {
                year: parseInt(dq.dateStr.split('-')[0], 10),
                month: parseInt(dq.dateStr.split('-')[1], 10),
                day: parseInt(dq.dateStr.split('-')[2], 10)
              };
            }
            if (dq.qtyStr) info.quantity = dq.qtyStr;
            break;
          }
        }

        if (dateQtyLineIndex >= 1) {
          var prevLine = dataLines[dateQtyLineIndex - 1].trim();
          var dateQtyLine = dataLines[dateQtyLineIndex].trim();

          if (!prevLine.includes('')) {
            if (/^\d{11}/.test(dateQtyLine)) {
              if (dateQtyLineIndex >= 2) {
                var twoLinesAbove = dataLines[dateQtyLineIndex - 2].trim();
                if (!/^[\u4e00-\u9fa5]{2,4}$/.test(twoLinesAbove) && !twoLinesAbove.includes('')) {
                  info.middleMan = twoLinesAbove;
                }
              }
            } else {
              info.middleMan = prevLine;
            }
          }
        }

        var finalClientCandidates = [];
        var salesPersonCandidates = [];

        if (dateQtyLineIndex >= 0) {
          for (var k = dateQtyLineIndex + 1; k < dataLines.length; k++) {
            var line = dataLines[k].trim();

            if (line.includes('总图号') || line.includes('总审核') || line.includes('总品号') ||
                line.includes('总工时') || line.includes('总设计类型') || line.includes('控制2设计') || line.includes('控制1设计')) {
              continue;
            }

            if (line.includes('设计') || line.includes('项目')) {
              if (!info.projectName) {
                info.projectName = line;
              }
              continue;
            }

            var parts = line.split(/\s{2,}|\t/).filter(p => p.trim());
            for (var p = 0; p < parts.length; p++) {
              var part = parts[p].trim();
              if (part && !part.includes('')) {
                if (/^[\u4e00-\u9fa5]{2,4}$/.test(part) && !part.includes('技术') && !part.includes('审核')) {
                  salesPersonCandidates.push({ text: part, position: k });
                } else {
                  finalClientCandidates.push({ text: part, position: k });
                }
              }
            }
          }
        }

        if (finalClientCandidates.length > 0) {
          info.finalClient = finalClientCandidates[0].text;
        }

        if (salesPersonCandidates.length > 0) {
          info.salesPerson = salesPersonCandidates[salesPersonCandidates.length - 1].text;
        }

        if (!info.finalClient && salesPersonCandidates.length >= 2) {
          info.finalClient = salesPersonCandidates[0].text;
          info.salesPerson = salesPersonCandidates[salesPersonCandidates.length - 1].text;
        }

        if (info.salesPerson) {
          info.salesPerson = info.salesPerson.replace(/^[A-Za-z]+\s*/, '').trim();
        }
      }

      if (!info.middleMan && !info.finalClient) {
        var combinedMatch = line.match(/(\d{5,})>([^_]+)_([^-]+)-(.+)/);
        if (combinedMatch) {
          info.specNumber = combinedMatch[1];
          info.middleMan = combinedMatch[2];
          info.finalClient = combinedMatch[3];
          info.projectName = combinedMatch[4];
        }
      }

      if (!info.quantity) {
        var quantityMatch = line.match(/数量\s+(\d+)/);
        if (quantityMatch) {
          info.quantity = quantityMatch[1];
        }
      }
    }

    return info;
  } catch(e) {
    console.error('extractSpecInfoFromPdf error:', e);
    return null;
  } finally {
    activePdfParses -= 1;
  }
}

router.post('/delivery-date', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {

  var n = req.body.specNumber;

  if (!n) return res.json({success: false, message: '仕样号不能为空'});

  const digitCheck = validateSpecNumberDigits(n);
  if (!digitCheck.valid) return res.json({success: false, message: digitCheck.message});

  try {

    var r = await Promise.race([

      (async function() {

        var share = await checkSpecShare();

        if (!share.ok) return {success: false, code: 'SPEC_SHARE_UNREACHABLE', message: SPEC_SHARE_UNAVAILABLE_MESSAGE};

        var pdf = await findLatestSpecPdf(n);

        if (!pdf) return {success: false, message: '未找到仕样号 ' + n + ' 的PDF文件'};

        // 使用与 /spec/info 相同的解析逻辑（专用类别规则 + 数据表行），
        // 保证与"相同仕样号同步更新"结果一致
        var info = await extractSpecInfoFromPdf(pdf);

        if (!info || !info.deliveryDate) return {success: false, message: '未在PDF中找到纳期信息'};

        var d = info.deliveryDate;

        return {success: true, date: d.year + '-' + String(d.month).padStart(2, '0') + '-' + String(d.day).padStart(2, '0')};

      })(),

      new Promise(function(_, rj) { setTimeout(function() { rj(new Error('T')); }, 9000); })

    ]);

    return res.json(r);

  } catch(e) {

    if (e.message === 'T') return res.json({success: false, message: '获取纳期超时(超过9秒)'});

    // 不向客户端回传内部错误细节（可能含上游 URL / 文件路径），详细信息仅写服务端日志
    console.warn('[spec] 获取纳期失败:', e.message);
    return res.json({success: false, message: '获取纳期失败，请稍后重试或检查网络后联系管理员'});

  }

}));

router.post('/spec-raw-text', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  var n = req.body.specNumber;
  if (!n) return res.json({success: false, message: '仕样号不能为空'});
  const digitCheck = validateSpecNumberDigits(n);
  if (!digitCheck.valid) return res.json({success: false, message: digitCheck.message});
  try {
    var share = await checkSpecShare();
    if (!share.ok) return res.json({success: false, code: 'SPEC_SHARE_UNREACHABLE', message: SPEC_SHARE_UNAVAILABLE_MESSAGE});
    var pdf = await findLatestSpecPdf(n);
    if (!pdf) return res.json({success: false, message: '未找到仕样号 ' + n + ' 的PDF文件'});

    // 与 extractSpecInfoFromPdf 相同的保护：体积上限 + 并发解析上限
    const readable = await checkSpecPdfReadable(pdf);
    if (!readable.ok) return res.json({success: false, message: readable.reason});
    if (activePdfParses >= MAX_CONCURRENT_PARSES) {
      return res.json({success: false, message: '系统正在解析其他仕样书，请稍后重试'});
    }

    activePdfParses += 1;
    try {
      // 同样是 CPU 密集的解析，统一走 worker 线程
      var t = await readPdfTextOffThread(pdf);

      var lines = t.split('\n').map((l, idx) => ({line: idx + 1, text: l.trim()})).filter(l => l.text);

      return res.json({success: true, lines: lines, rawText: t});
    } finally {
      activePdfParses -= 1;
    }
  } catch(e) {
    console.warn('[spec] 获取原始文本失败:', e.message);
    return res.json({success: false, message: '获取原始文本失败，请确认仕样书存在或联系管理员'});
  }
}));

router.post('/spec-info', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {

  var n = req.body.specNumber;

  if (!n) return res.json({success: false, message: '仕样号不能为空'});

  const digitCheck = validateSpecNumberDigits(n);
  if (!digitCheck.valid) return res.json({success: false, message: digitCheck.message});

  // 大日程（\\192.168.160.70）只服务于「状态跟踪」页：只有该页会传 includeSchedule
  // 或添加时间月份。主页面 / 焊枪台账 / 快速取号查仕样号一律只看仕样书共享，
  // 否则生产大日程那台服务器一挂，这些本不依赖它的入口会被一起拖死。
  var requestedMonth = String(req.body.productionPlanMonth || req.body.month || '').trim();
  var preferredMonth = /^\d{4}-\d{2}$/.test(requestedMonth) ? requestedMonth : '';
  var includeSchedule = req.body.includeSchedule === true || preferredMonth !== '';

  try {

    var r = await Promise.race([

      (async function() {

        // 大日程表格优先：命中时数量/纳期/已发图/工厂以表格为准
        // 注意：这里必须 await —— 大日程在共享盘上，同步读取会占住事件循环，
        // 共享服务器不可达时整个后端会被拖住几十秒（所有接口一起变慢）。
        // 即使需要，也必须限时：状态跟踪页没有理由为一条不可达的共享连接干等 40 秒。
        var scheduleEntry = null;
        var scheduleUnavailable = false;

        if (includeSchedule) {

          var scheduleLookup = await withDeadline(
            productionSchedule.findScheduleEntry(n, preferredMonth),
            SCHEDULE_LOOKUP_TIMEOUT_MS
          );

          if (scheduleLookup.timedOut) {
            scheduleUnavailable = true;
            console.warn(`[spec] 大日程查询超过 ${SCHEDULE_LOOKUP_TIMEOUT_MS}ms（共享不可达），仕样号 ${n} 本次降级为仅解析仕样书`);
          } else {
            scheduleEntry = scheduleLookup.value || null;
            // 未命中要区分两种情况：表里确实没有这个仕样号（lastError 为空），
            // 还是共享读不到（lastError 有值）。后者必须让状态跟踪页知道
            // 「这次的数量/纳期来自仕样书」，否则用户会以为同步成功了。
            if (!scheduleEntry && productionSchedule.getScheduleStatus().lastError) {
              scheduleUnavailable = true;
            }
          }

        }

        // PDF 仍尽量解析，用于补充客户名称、营业担当等信息；
        // PDF 不可用时只要表格命中就继续返回表格数据
        var info = null;
        var pdfState = 'missing';

        try {

          var share = await checkSpecShare();

          if (!share.ok) {
            pdfState = 'share-unavailable';
          } else {
            var pdf = await findLatestSpecPdf(n);
            if (pdf) {
              info = await extractSpecInfoFromPdf(pdf);
              pdfState = info ? 'parsed' : 'parse-failed';
            }
          }

        } catch (e) {
          pdfState = 'error';
          console.warn('[spec] 解析仕样书失败:', e.message);
        }

        var fallbackTried = false;

        // 普通入口的 PDF 没命中（共享里没有该仕样号的文件，或解析失败）时，
        // 再问一次大日程：这类仕样号只在表格里有数据。
        // includeSchedule 的请求上面已经查过了，不重复；共享不通时 lookupScheduleFallback 直接返回 null。
        if (!includeSchedule && !info && !scheduleEntry && (pdfState === 'missing' || pdfState === 'parse-failed')) {
          fallbackTried = productionSchedule.getReachabilityHint().ok;
          scheduleEntry = await lookupScheduleFallback(n);
          if (scheduleEntry) scheduleUnavailable = false;
        }

        if (!scheduleEntry && !info) {
          if (pdfState === 'share-unavailable') {
            return {success: false, code: 'SPEC_SHARE_UNREACHABLE', message: SPEC_SHARE_UNAVAILABLE_MESSAGE};
          }
          if (pdfState === 'parse-failed' || pdfState === 'error') {
            return {success: false, message: '解析PDF信息失败'};
          }
          return {
            success: false,
            message: fallbackTried
              ? '未找到仕样号 ' + n + ' 的仕样书 PDF，大日程中也没有该仕样号'
              : '未找到仕样号 ' + n + ' 的PDF文件'
          };
        }

        var clientName = '';

        if (info) {
          if (info.middleMan && info.finalClient && info.projectName) {
            clientName = `${n}>${info.middleMan}_${info.finalClient}-${info.projectName}`;
          } else if (info.middleMan && info.finalClient) {
            clientName = `${n}>${info.middleMan}_${info.finalClient}`;
          } else if (info.middleMan && info.projectName) {
            clientName = `${n}>${info.middleMan}-${info.projectName}`;
          } else if (info.middleMan) {
            clientName = `${n}>${info.middleMan}`;
          } else if (info.finalClient && info.projectName) {
            clientName = `${n}>${info.finalClient}-${info.projectName}`;
          } else if (info.finalClient) {
            clientName = `${n}>${info.finalClient}`;
          }
        }

        // PDF 解析不到客户时，用大日程客户列的原文（形如「58249>O/IND_...」）
        if (!clientName && scheduleEntry && scheduleEntry.clientText) {
          clientName = /^\d/.test(scheduleEntry.clientText)
            ? scheduleEntry.clientText
            : `${n}>${scheduleEntry.clientText}`;
        }

        var deliveryDateStr = null;

        // 纳期优先取大日程表格
        if (scheduleEntry && scheduleEntry.deliveryDate) {
          deliveryDateStr = scheduleEntry.deliveryDate;
        } else if (info && info.deliveryDate) {
          deliveryDateStr = info.deliveryDate.year + '-' + String(info.deliveryDate.month).padStart(2, '0') + '-' + String(info.deliveryDate.day).padStart(2, '0');
        }

        var quantity = '';

        // 数量优先取大日程表格，取不到再回退 PDF
        if (scheduleEntry && scheduleEntry.quantity !== '') {
          quantity = scheduleEntry.quantity;
        } else if (info && info.quantity) {
          quantity = info.quantity;
        }

        return {

          success: true,

          specNumber: n,

          clientName: clientName,

          middleMan: info ? info.middleMan : '',

          finalClient: info ? info.finalClient : '',

          projectName: info ? info.projectName : '',

          quantity: quantity,

          deliveryDate: deliveryDateStr,

          salesPerson: info ? info.salesPerson : '',

          isModification: info ? info.isModification : false,

          // 表格命中的工作表决定工厂：南京 → O/NJG，上海 → O/SHA
          factory: scheduleEntry ? scheduleEntry.factory : '',

          // 命中的工作表名（南京焊钳/上海焊钳/南京焊钳修改/上海焊钳修改），供按表筛选
          scheduleSheet: scheduleEntry ? scheduleEntry.sheetName : '',

          // 已发图取表格；未命中表格时为 null，由前端按原有记录处理
          shippedCount: scheduleEntry ? scheduleEntry.shippedCount : null,

          scheduleMonth: scheduleEntry ? scheduleEntry.month : '',

          // 大日程本应参与本次查询却没能取到（共享不可达/超过 3 秒）：
          // 前端据此提示「本次数据来自仕样书」，而不是把「取不到工厂/已发图」当成数据缺失
          scheduleUnavailable

        };

      })(),

      // 12 秒必须短于前端的 15 秒：同样的 15 秒摆在一起就是竞速，
      // 客户端几乎总是先超时，于是拿到「无响应」而不是下面这条明确提示，
      // 还会被前端判定为「后端不可达」直接进入离线模式。
      new Promise(function(_, rj) { setTimeout(function() { rj(new Error('T')); }, 12000); })

    ]);

    return res.json(r);

  } catch(e) {

    if (e.message === 'T') return res.json({success: false, code: 'SPEC_TIMEOUT', message: '获取仕样信息超时(超过12秒)'});

    // 不向客户端回传内部错误细节（可能含上游 URL / 文件路径），详细信息仅写服务端日志
    console.warn('[spec] 获取仕样信息失败:', e.message);
    return res.json({success: false, message: '获取仕样信息失败，请稍后重试或检查网络后联系管理员'});

  }

}));

module.exports = router;
