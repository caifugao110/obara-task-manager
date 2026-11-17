const express = require('express');
const router = express.Router();
const path = require('path');
const fs2 = require('fs');
const asyncHandler = require('express-async-handler');
const { authMiddleware, adminMiddleware, superAdminMiddleware, hasAccessSettings } = require('../middleware/auth');
const securityConfig = require('../config/security');
const db = require('../db');
const taskStore = require('../taskStore');
const specPdfParser = require('../utils/specPdfParser');
const productionSchedule = require('../utils/productionSchedule');
const gunTableLocks = require('../utils/gunTableLocks');
const { emitToPage } = require('../utils/socketRooms');
const { readPdfTextOffThread } = require('../utils/pdfTextPool');
const { buildGunHealSpecEntry, collapseSpace } = require('../utils/gunHealEntry');
const { hasNamedGunRows, hasUnparsedTypeSuffix, buildSkippedSpecEntry, describeTaskNameDiff, splitHealTaskName, buildHealTaskName } = require('../utils/specHealEntry');

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

// ============================================================================
// 仕样自愈：扫描某月任务里的仕样号，按仕样书校正任务名中的「客户名」与「纳期」
//
// 为什么不做成一次同步请求：
// - 校正依据是共享盘上的仕样书 PDF，每份都要 stat + 取文本 + 解析，单份几十一百毫秒，
//   一个月通常有几十个仕样号，再加上共享盘抖动，同步接口必然撞上前端超时，
//   而超时会让前端判定「后端不可用」直接进离线模式；
// - 所以扫描做成服务端 job：POST 建任务立刻返回 jobId，前端轮询进度，
//   扫描结果留在服务端，一键更新只传 jobId + 勾选的仕样号。
//
// 更新时重新读当月任务再比对（扫描到点击之间可能有人改过任务），只改确实不一致的条目。
//
// 范围限定：只有**含枪名行**的任务参与自愈（真实排产单位是枪名行）。
// 不含枪名行的主任务属于计划占位，客户名/纳期由人工维护——
// 扫描阶段把它们排除在比对之外，更新阶段同样不碰；
// 只在这类任务里出现过的仕样号状态为 skipped（已跳过），不解析仕样书、不可选中更新。
// ============================================================================

const HEAL_JOB_TTL_MS = 30 * 60 * 1000;   // 扫描结果保留时长
const HEAL_SPEC_CONCURRENCY = 3;          // 同时解析的仕样书份数（低于全局 12 份上限，避免挤占正常查询）
const HEAL_SPEC_TIMEOUT_MS = 20000;       // 单个仕样号「找文件 + 解析」的总时限
const HEAL_MAX_ITEMS_PER_SPEC = 200;      // 单个仕样号回传的明细条数上限（UI 只用于预览）
const selfHealJobs = new Map();

// 从任务名取仕样号：只认「与系统设置位数一致」的数字段。
// 与前端 extractSpecNumber 的差别：这里优先取位数正确的那个，避免
// 「G2621 58645」这类任务名把项目代码当成仕样号去做无意义的仕样书查询。
function extractSelfHealSpecNumber(taskName, digits) {
  const text = String(taskName || '');
  const re = /\b(?:[A-Za-z]-?)?(\d{4,6})\b/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match[1].length === digits) return match[1];
  }
  return null;
}

// 拆分任务名与拼装的实现在 utils/specHealEntry.js（纯函数，便于单测）：
// 主体（客户名） + 尾部任务类型（含「设计变更 更改通知单号」） + 尾部纳期 [M/D]

// 客户名组合规则与 /spec-info 保持一致（仕样号>中间商_终端客户-项目名）
function composeSelfHealClientName(specNumber, info) {
  if (!info) return '';
  if (info.middleMan && info.finalClient && info.projectName) {
    return `${specNumber}>${info.middleMan}_${info.finalClient}-${info.projectName}`;
  }
  if (info.middleMan && info.finalClient) {
    return `${specNumber}>${info.middleMan}_${info.finalClient}`;
  }
  if (info.middleMan && info.projectName) {
    return `${specNumber}>${info.middleMan}-${info.projectName}`;
  }
  if (info.middleMan) {
    return `${specNumber}>${info.middleMan}`;
  }
  if (info.finalClient && info.projectName) {
    return `${specNumber}>${info.finalClient}-${info.projectName}`;
  }
  if (info.finalClient) {
    return `${specNumber}>${info.finalClient}`;
  }
  return '';
}

// 「修改仕样书」的任务名要带 M 前缀，与前端 getDesignPlanClientName 一致
function applySelfHealModificationPrefix(clientName, info, fallbackSpecNumber) {
  const name = String(clientName || '').trim();
  if (!name) return '';
  if (!info || !info.isModification || name.startsWith('M')) return name;
  const specNumber = info.specNumber || fallbackSpecNumber;
  if (name.startsWith(`${specNumber}>`)) return `M${name}`;
  return `M${specNumber}>${name}`;
}

function composeSelfHealDeliverySuffix(info) {
  const d = info && info.deliveryDate;
  if (!d || !d.year || !d.month || !d.day) return '';
  return `[${Number(d.month)}/${Number(d.day)}]`;
}

// 拼装同样在 utils/specHealEntry.js（buildHealTaskName）

// 解析单个仕样号 → 期望的客户名与纳期。任何一步失败都返回可展示的原因，
// 而不是抛错：一个仕样书解析不了不该让整次扫描失败。
// modificationPrefix=false 时「修改仕样书」不加 M 前缀——焊枪台账的客户列取自
// /spec/spec-info 的 clientName（本就无 M 前缀），加了会与真实客户名永久对不上。
async function resolveSelfHealSpec(specNumber, options = {}) {
  const useModificationPrefix = options.modificationPrefix !== false;
  const share = await checkSpecShare();
  if (!share.ok) {
    return { resolved: false, code: 'SHARE_UNREACHABLE', message: SPEC_SHARE_UNAVAILABLE_MESSAGE };
  }

  const lookup = await withDeadline(findLatestSpecPdf(specNumber), HEAL_SPEC_TIMEOUT_MS);
  if (lookup.timedOut) return { resolved: false, code: 'TIMEOUT', message: '读取仕样书超时' };
  const pdfPath = lookup.value;
  if (!pdfPath) return { resolved: false, code: 'PDF_MISSING', message: '共享目录中没有该仕样号的仕样书' };

  const parsed = await withDeadline(extractSpecInfoFromPdf(pdfPath), HEAL_SPEC_TIMEOUT_MS);
  if (parsed.timedOut) return { resolved: false, code: 'TIMEOUT', message: '解析仕样书超时' };
  const info = parsed.value;
  if (!info) return { resolved: false, code: 'PARSE_FAILED', message: '仕样书解析失败' };

  const composed = composeSelfHealClientName(specNumber, info);
  const clientName = useModificationPrefix
    ? applySelfHealModificationPrefix(composed, info, specNumber)
    : composed;
  const deliverySuffix = composeSelfHealDeliverySuffix(info);

  if (!clientName && !deliverySuffix) {
    return { resolved: false, code: 'NO_DATA', message: '仕样书中未找到客户名与纳期' };
  }
  return { resolved: true, clientName, deliverySuffix };
}

// 单个仕样号的扫描结果：期望值 + 需要改动的明细（已最新时明细为空）
function buildSelfHealSpecEntry(specNumber, entries, resolution, designerNames) {
  const entry = {
    specNumber,
    status: resolution.resolved ? 'ok' : 'unresolved',
    resolved: Boolean(resolution.resolved),
    expectedClient: resolution.clientName || '',
    expectedDelivery: resolution.deliverySuffix || '',
    code: resolution.code || '',
    message: resolution.message || '',
    itemCount: 0,
    changes: [],
    items: [],
    itemsTruncated: false
  };
  if (!resolution.resolved) return entry;

  const changeFlags = new Set();
  for (const item of entries) {
    const parts = splitHealTaskName(item.taskName);
    const diff = describeTaskNameDiff(parts, entry.expectedClient, entry.expectedDelivery);
    if (!diff.clientChanged && !diff.deliveryChanged) continue;

    const newTaskName = buildHealTaskName(item.taskName, entry.expectedClient, entry.expectedDelivery);
    if (!newTaskName || collapseSpace(newTaskName) === collapseSpace(item.taskName)) continue;

    entry.itemCount += 1;
    diff.flags.forEach(flag => changeFlags.add(flag));
    if (entry.items.length >= HEAL_MAX_ITEMS_PER_SPEC) {
      entry.itemsTruncated = true;
      continue;
    }
    entry.items.push({
      itemId: item.itemId,
      designerId: item.designerId,
      designerName: designerNames.get(item.designerId) || '',
      date: item.date,
      taskName: item.taskName,
      newTaskName,
      changes: diff.flags,
      currentClient: parts.baseName,
      currentDelivery: parts.deliverySuffix
    });
  }

  entry.status = entry.itemCount > 0 ? 'outdated' : 'ok';
  // 固定顺序输出，前端按标签渲染；同一仕样号下「纳期」与「增加纳期」并存时由前端收窄为「纳期」
  entry.changes = ['client', 'delivery', 'delivery-add'].filter(flag => changeFlags.has(flag));
  return entry;
}

// 并发受限的批量执行：仕样书解析是重活，串行太慢、全并发会把共享盘和 CPU 一起压垮
async function forEachWithConcurrency(list, limit, worker) {
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, list.length));
  const runners = Array.from({ length: size }, async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      await worker(list[index], index);
    }
  });
  await Promise.all(runners);
}

function pruneSelfHealJobs() {
  const now = Date.now();
  for (const [id, job] of selfHealJobs) {
    if (now - job.createdAt > HEAL_JOB_TTL_MS) selfHealJobs.delete(id);
  }
}

function getSelfHealJobSnapshot(job) {
  return {
    jobId: job.id,
    year: job.year,
    month: job.month,
    status: job.status,
    message: job.message || '',
    total: job.total,
    done: job.done,
    current: job.current,
    totalItems: job.totalItems,
    skippedItems: job.skippedItems,
    noGunItems: job.noGunItems,
    unparsedItems: job.unparsedItems,
    summary: job.summary,
    specs: job.specs,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt
  };
}

async function runSelfHealScan(job) {
  try {
    const share = await checkSpecShare();
    if (!share.ok) {
      job.status = 'failed';
      job.message = SPEC_SHARE_UNAVAILABLE_MESSAGE;
      job.finishedAt = Date.now();
      return;
    }

    const digits = getConfiguredSpecDigits();
    const designerNames = new Map((db.readDesigners() || []).map(designer => [designer.id, designer.name]));
    const sheets = taskStore.listSheets({ month: job.month, year: job.year });

    // 先按仕样号归并当月任务：扫描以仕样号为单位，同一仕样号的所有任务共用一次解析结果
    const groups = new Map();
    // 只在不含枪名行的任务里出现的仕样号：记次数，稍后直接标为「已跳过」
    const noGunSpecCounts = new Map();
    // 只在「任务内容后缀认不出来」的任务里出现的仕样号：同样标为「已跳过」
    const unparsedSpecCounts = new Map();
    let totalItems = 0;
    let skippedItems = 0;
    let noGunItems = 0;
    let unparsedItems = 0;

    sheets.forEach(sheet => {
      Object.entries(sheet.days || {}).forEach(([date, items]) => {
        if (!Array.isArray(items)) return;
        items.forEach(item => {
          if (!item || item.leaveType) return;            // 请假/出差行没有仕样号
          const taskName = String(item.taskName || '').trim();
          if (!taskName) return;
          totalItems += 1;
          const specNumber = extractSelfHealSpecNumber(taskName, digits);
          if (!specNumber) {
            skippedItems += 1;                            // 认不出仕样号的任务，只在汇总里计数
            return;
          }
          // 没有枪名行的主任务属于计划占位，真实排产单位是枪名行：
          // 不比对、不写回，连仕样书都不必解析，只在汇总里计一条「已跳过」
          if (!hasNamedGunRows(item)) {
            noGunItems += 1;
            noGunSpecCounts.set(specNumber, (noGunSpecCounts.get(specNumber) || 0) + 1);
            return;
          }
          // 任务名里有任务内容后缀但认不出来（典型：更改通知单号不是 FY 开头）：
          // 按客户名比对必然「不一致」，写回就会把这段删掉，所以整条任务不参与自愈
          if (hasUnparsedTypeSuffix(splitHealTaskName(taskName))) {
            unparsedItems += 1;
            unparsedSpecCounts.set(specNumber, (unparsedSpecCounts.get(specNumber) || 0) + 1);
            return;
          }
          if (!groups.has(specNumber)) groups.set(specNumber, []);
          groups.get(specNumber).push({
            itemId: item.id,
            designerId: sheet.designerId,
            date,
            taskName
          });
        });
      });
    });

    job.totalItems = totalItems;
    job.skippedItems = skippedItems;
    job.noGunItems = noGunItems;
    job.unparsedItems = unparsedItems;
    job.total = groups.size;

    // 只在「不含枪名行」或「后缀认不出来」的任务里出现过的仕样号：直接标为已跳过，不进解析队列
    const skippedSpecNumbers = new Set([...noGunSpecCounts.keys(), ...unparsedSpecCounts.keys()]);
    [...skippedSpecNumbers].forEach(specNumber => {
      if (groups.has(specNumber)) return;   // 同一仕样号还有可核对的任务，照常核对
      job.specs.push(buildSkippedSpecEntry(specNumber, {
        noGunItemCount: noGunSpecCounts.get(specNumber) || 0,
        unparsedItemCount: unparsedSpecCounts.get(specNumber) || 0
      }));
    });

    const specNumbers = [...groups.keys()].sort();
    await forEachWithConcurrency(specNumbers, HEAL_SPEC_CONCURRENCY, async (specNumber) => {
      job.current = specNumber;
      let resolution;
      try {
        resolution = await resolveSelfHealSpec(specNumber);
      } catch (e) {
        console.warn('[spec] 仕样自愈解析失败:', specNumber, e.message);
        resolution = { resolved: false, code: 'ERROR', message: '解析仕样书失败' };
      }
      job.specs.push(buildSelfHealSpecEntry(specNumber, groups.get(specNumber), resolution, designerNames));
      job.done += 1;
    });

    job.specs.sort((a, b) => a.specNumber.localeCompare(b.specNumber));
    job.summary = {
      specCount: job.specs.length,
      outdatedSpecs: job.specs.filter(s => s.status === 'outdated').length,
      okSpecs: job.specs.filter(s => s.status === 'ok').length,
      skippedSpecs: job.specs.filter(s => s.status === 'skipped').length,
      unresolvedSpecs: job.specs.filter(s => s.status === 'unresolved').length,
      outdatedItems: job.specs.reduce((sum, s) => sum + (s.status === 'outdated' ? s.itemCount : 0), 0),
      totalItems,
      skippedItems,
      noGunItems,
      unparsedItems
    };
    job.status = 'completed';
    job.current = '';
    job.finishedAt = Date.now();

    console.log(
      `[spec] 仕样自愈扫描完成 ${job.year}-${String(job.month).padStart(2, '0')}：`
      + `${job.summary.specCount} 个仕样号，需更新 ${job.summary.outdatedSpecs} 个 / ${job.summary.outdatedItems} 条任务，`
      + `已跳过 ${job.summary.skippedSpecs} 个（任务不含枪名行 ${noGunItems} 条、任务内容后缀认不出 ${unparsedItems} 条），`
      + `无仕样书 ${job.summary.unresolvedSpecs} 个`
    );
  } catch (e) {
    job.status = 'failed';
    job.message = '扫描失败，请稍后重试或检查仕样书共享连接';
    job.finishedAt = Date.now();
    console.warn('[spec] 仕样自愈扫描失败:', e.message);
  }
}

router.post('/self-heal/scan', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  const year = Number(req.body && req.body.year);
  const month = Number(req.body && req.body.month);
  if (!Number.isInteger(year) || year < 1900 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ success: false, message: '月份参数不正确' });
  }

  pruneSelfHealJobs();

  const job = {
    id: `heal-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    year,
    month,
    status: 'running',
    message: '',
    total: 0,
    done: 0,
    current: '',
    totalItems: 0,
    skippedItems: 0,
    noGunItems: 0,
    unparsedItems: 0,
    summary: null,
    specs: [],
    createdAt: Date.now(),
    startedAt: Date.now(),
    finishedAt: null
  };
  selfHealJobs.set(job.id, job);

  // 后台执行，立刻把 jobId 交给前端去轮询进度
  runSelfHealScan(job);

  res.status(202).json({ success: true, ...getSelfHealJobSnapshot(job) });
}));

router.get('/self-heal/scan/:jobId', [authMiddleware, adminMiddleware], (req, res) => {
  const job = selfHealJobs.get(String(req.params.jobId || ''));
  if (!job) {
    return res.status(404).json({ success: false, message: '扫描结果不存在或已过期，请重新检测' });
  }
  res.json({ success: true, ...getSelfHealJobSnapshot(job) });
});

router.post('/self-heal/apply', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  const jobId = String((req.body && req.body.jobId) || '');
  const job = selfHealJobs.get(jobId);
  if (!job) {
    return res.status(404).json({ success: false, message: '扫描结果不存在或已过期，请重新检测' });
  }
  if (job.status !== 'completed') {
    return res.status(409).json({ success: false, message: '扫描尚未完成，请稍候再试' });
  }

  const applyStartedAt = Date.now();

  const outdated = job.specs.filter(s => s.status === 'outdated' && s.resolved);
  const requested = Array.isArray(req.body.specNumbers)
    ? req.body.specNumbers.map(value => String(value || '').trim()).filter(Boolean)
    : null;
  // 未传 specNumbers 时更新全部「需更新」的仕样号（一键更新）；传了就只更新勾选的那些
  const targets = requested && requested.length > 0
    ? outdated.filter(s => requested.includes(s.specNumber))
    : outdated;

  if (targets.length === 0) {
    return res.json({
      success: true,
      updatedItems: 0,
      updatedSpecs: [],
      designerIds: [],
      message: '没有需要更新的仕样号'
    });
  }

  const bySpec = new Map(targets.map(s => [s.specNumber, s]));
  const digits = getConfiguredSpecDigits();
  const sheets = taskStore.listSheets({ month: job.month, year: job.year });
  const userMeta = { id: req.user.id, username: req.user.username, name: req.user.name || req.user.username };
  const changedSheets = new Map();
  const updatedSpecs = new Set();
  const designerIds = new Set();
  let updatedItems = 0;
  let skippedNoGunItems = 0;
  let skippedUnparsedItems = 0;

  sheets.forEach(sheet => {
    Object.entries(sheet.days || {}).forEach(([date, items]) => {
      if (!Array.isArray(items)) return;
      items.forEach(item => {
        if (!item || item.leaveType) return;
        const taskName = String(item.taskName || '').trim();
        if (!taskName) return;
        const specNumber = extractSelfHealSpecNumber(taskName, digits);
        if (!specNumber) return;
        const expected = bySpec.get(specNumber);
        if (!expected) return;

        // 与扫描口径一致：不含枪名行的主任务不参与自愈（扫描到点击之间可能有人删光了枪名行）
        if (!hasNamedGunRows(item)) {
          skippedNoGunItems += 1;
          return;
        }
        // 同口径：任务内容后缀认不出来（如单号不是 FY 开头）就不改写，避免把这段内容删掉
        if (hasUnparsedTypeSuffix(splitHealTaskName(item.taskName))) {
          skippedUnparsedItems += 1;
          return;
        }

        const newTaskName = buildHealTaskName(item.taskName, expected.expectedClient, expected.expectedDelivery);
        if (!newTaskName || collapseSpace(newTaskName) === collapseSpace(item.taskName)) return;

        item.taskName = newTaskName;
        item.updatedAt = new Date().toISOString();
        item.updatedBy = userMeta;

        updatedItems += 1;
        updatedSpecs.add(specNumber);
        designerIds.add(sheet.designerId);
        changedSheets.set(sheet.id, sheet);
      });
    });
  });

  if (changedSheets.size > 0) {
    taskStore.saveSheets([...changedSheets.values()]);
  }

  const updatedSpecList = [...updatedSpecs].sort();

  // 只在真的改了任务时留一条自愈记录（点一次什么都没改，不算一次操作）
  if (updatedItems > 0) {
    try {
      db.appendSelfHealLog({
        year: job.year,
        month: job.month,
        userId: userMeta.id,
        username: userMeta.username,
        name: userMeta.name,
        specCount: job.specs.length,
        requestedSpecs: targets.map(s => s.specNumber),
        updatedSpecs: updatedSpecList,
        updatedItems,
        sheetCount: changedSheets.size,
        durationMs: Date.now() - applyStartedAt
      });
    } catch (e) {
      console.warn('[spec] 仕样自愈记录写入失败:', e.message);
    }
  }

  console.log(
    `[spec] 仕样自愈更新 ${job.year}-${String(job.month).padStart(2, '0')}：`
    + `${updatedSpecs.size} 个仕样号 / ${updatedItems} 条任务（操作人 ${userMeta.username}`
    + `${skippedNoGunItems > 0 ? `，跳过不含枪名行 ${skippedNoGunItems} 条` : ''}`
    + `${skippedUnparsedItems > 0 ? `，跳过后缀认不出 ${skippedUnparsedItems} 条` : ''}）`
  );

  res.json({
    success: true,
    updatedItems,
    updatedSpecs: updatedSpecList,
    designerIds: [...designerIds],
    sheetCount: changedSheets.size,
    skippedNoGunItems,
    skippedUnparsedItems,
    message: `已更新 ${updatedItems} 条任务`
  });
}));

// 仕样自愈操作记录：谁在什么时候把哪个月的哪些仕样号改成了什么结果
// 敏感信息（人名 + 改动明细）只对超级管理员开放，普通管理员连列表都读不到
router.get('/self-heal/logs', [authMiddleware, superAdminMiddleware], (req, res) => {
  const limit = Number(req.query.limit);
  const logs = db.listSelfHealLogs(Number.isFinite(limit) && limit > 0 ? limit : 30);
  res.json({ success: true, logs });
});

// ============================================================================
// 焊枪编号台账 · 仕样自愈（只校准「客户」列，不校验纳期）
//
// 与主页面仕样自愈的两点本质差异，决定了这里的接口形态：
// 1. 台账没有「月份 / 任务名」，比对对象是每行的客户列，产物是「现客户名 → 仕样书客户名」；
// 2. 台账里累计的仕样号可达几万个（一行一个枪名），扫描一轮要十几分钟。
//    因此扫描结果**不进轮询响应**：进度接口只回计数与当前仕样号，明细走分页接口，
//    否则每 1 秒推几 MB JSON，浏览器会被自己的重渲染拖死。
//
// 另外：扫描全程打的是共享盘上的仕样书，属于重活，所以支持「停止」——已扫完的部分仍可更新；
// 同一仕样号 30 分钟内只解析一次（模块级缓存），重复检测与多张表共用同一份结果。
// ============================================================================

const GUN_HEAL_JOB_TTL_MS = 45 * 60 * 1000;
// 低于全局 PDF 解析上限（12），避免把正常查仕样号的请求挤掉
const GUN_HEAL_SPEC_CONCURRENCY = 5;
const GUN_HEAL_CACHE_TTL_MS = 30 * 60 * 1000;
const gunHealJobs = new Map();
/** specNumber -> { clientName, at }：跨 job 的解析结果缓存 */
const gunHealClientCache = new Map();

// 台账页本身受 gunLedger 访问设置约束，自愈会真实改写台账数据，必须用同一把尺子
const requireGunLedgerAccess = (req, res, next) => {
  if (hasAccessSettings(req.user, 'gunLedger')) return next();
  return res.status(403).json({ success: false, message: '无权访问焊枪编号台账' });
};

function pruneGunHealJobs() {
  const now = Date.now();
  for (const [id, job] of gunHealJobs) {
    if (now - job.createdAt > GUN_HEAL_JOB_TTL_MS) gunHealJobs.delete(id);
  }
  if (gunHealClientCache.size > 60000) gunHealClientCache.clear();
}

// 按检测范围收集「仕样号 → 台账行」分组。同步执行（几万行也只是遍历），
// 这样 202 响应里就能带上总数，用户点下「开始检测」立刻看到分母。
function collectGunHealGroups(scope) {
  const ledger = db.readGunLedger();
  const categories = ledger && ledger.categories && typeof ledger.categories === 'object'
    ? ledger.categories
    : {};
  const digits = getConfiguredSpecDigits();
  const groups = new Map();
  const tableNames = [];
  let totalRows = 0;
  let skippedRows = 0;

  Object.keys(categories).forEach(category => {
    if (scope.type === 'category' && category !== scope.category) return;
    const tables = Array.isArray(categories[category]) ? categories[category] : [];
    tables.forEach(table => {
      if (!table) return;
      if (scope.type === 'table' && table.id !== scope.tableId) return;
      tableNames.push(`${category} / ${table.name}`);
      const rows = Array.isArray(table.rows) ? table.rows : [];
      rows.forEach(row => {
        if (!row) return;
        const customer = String(row.customer || '').trim();
        if (!customer) return;
        totalRows += 1;
        const specNumber = extractSelfHealSpecNumber(customer, digits);
        if (!specNumber) {
          skippedRows += 1;   // 手写客户名，认不出仕样号：只在汇总里计数
          return;
        }
        if (!groups.has(specNumber)) groups.set(specNumber, []);
        groups.get(specNumber).push({
          tableId: table.id,
          tableName: table.name,
          category,
          serialNumber: row.serialNumber,
          gunName: String(row.gunName || '').trim(),
          customer
        });
      });
    });
  });

  return { groups, tableNames, totalRows, skippedRows };
}

async function resolveGunHealSpec(specNumber) {
  const cached = gunHealClientCache.get(specNumber);
  if (cached && Date.now() - cached.at < GUN_HEAL_CACHE_TTL_MS) {
    return { resolved: true, clientName: cached.clientName };
  }
  const resolution = await resolveSelfHealSpec(specNumber, { modificationPrefix: false });
  if (resolution && resolution.resolved && resolution.clientName) {
    gunHealClientCache.set(specNumber, { clientName: resolution.clientName, at: Date.now() });
  }
  return resolution;
}

function recomputeGunHealSummary(job) {
  const specs = job.specs;
  job.summary = {
    specCount: specs.length,
    outdatedSpecs: specs.filter(s => s.status === 'outdated').length,
    okSpecs: specs.filter(s => s.status === 'ok').length,
    unresolvedSpecs: specs.filter(s => s.status === 'unresolved').length,
    outdatedItems: specs.reduce((sum, s) => sum + (s.status === 'outdated' ? s.itemCount : 0), 0),
    totalSpecs: job.total,
    totalRows: job.totalRows,
    skippedRows: job.skippedRows
  };
  return job.summary;
}

function getGunHealCounts(job) {
  let outdated = 0;
  let ok = 0;
  let unresolved = 0;
  for (const entry of job.specs) {
    if (entry.status === 'outdated') outdated += 1;
    else if (entry.status === 'ok') ok += 1;
    else unresolved += 1;
  }
  return { all: job.specs.length, outdated, ok, unresolved };
}

function getGunHealJobSnapshot(job) {
  return {
    jobId: job.id,
    scope: job.scope,
    scopeLabel: job.scopeLabel,
    status: job.status,
    message: job.message || '',
    total: job.total,
    done: job.done,
    current: job.current,
    totalRows: job.totalRows,
    skippedRows: job.skippedRows,
    summary: job.summary,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    cancelRequested: job.cancelRequested
  };
}

async function runGunHealScan(job, groups) {
  try {
    const share = await checkSpecShare();
    if (!share.ok) {
      job.status = 'failed';
      job.message = SPEC_SHARE_UNAVAILABLE_MESSAGE;
      job.finishedAt = Date.now();
      return;
    }

    const specNumbers = [...groups.keys()].sort();
    await forEachWithConcurrency(specNumbers, GUN_HEAL_SPEC_CONCURRENCY, async (specNumber) => {
      if (job.cancelRequested) return;
      job.current = specNumber;
      let resolution;
      try {
        resolution = await resolveGunHealSpec(specNumber);
      } catch (e) {
        console.warn('[spec] 台账仕样自愈解析失败:', specNumber, e.message);
        resolution = { resolved: false, code: 'ERROR', message: '解析仕样书失败' };
      }
      job.specs.push(buildGunHealSpecEntry(specNumber, groups.get(specNumber), resolution));
      job.done += 1;
    });

    job.specs.sort((a, b) => a.specNumber.localeCompare(b.specNumber));
    recomputeGunHealSummary(job);
    job.status = job.cancelRequested ? 'cancelled' : 'completed';
    job.current = '';
    job.finishedAt = Date.now();

    console.log(
      `[spec] 台账仕样自愈扫描${job.status === 'cancelled' ? '（已停止）' : '完成'}（${job.scopeLabel}）：`
      + `${job.summary.specCount}/${job.total} 个仕样号，需更新 ${job.summary.outdatedSpecs} 个 / ${job.summary.outdatedItems} 行，`
      + `无仕样书 ${job.summary.unresolvedSpecs} 个`
    );
  } catch (e) {
    job.status = 'failed';
    job.message = '检测失败，请稍后重试或检查仕样书共享连接';
    job.finishedAt = Date.now();
    console.warn('[spec] 台账仕样自愈扫描失败:', e.message);
  }
}

// 开始检测。scope: { type: 'all' } | { type: 'category', category } | { type: 'table', tableId }
router.post('/self-heal/gun-ledger/scan', [authMiddleware, adminMiddleware, requireGunLedgerAccess], asyncHandler(async (req, res) => {
  const raw = (req.body && req.body.scope) || {};
  const type = ['all', 'category', 'table'].includes(raw.type) ? raw.type : 'all';
  const scope = { type, category: String(raw.category || '').trim(), tableId: String(raw.tableId || '') };
  if (type === 'category' && !scope.category) {
    return res.status(400).json({ success: false, message: '请指定要检测的分类' });
  }
  if (type === 'table' && !scope.tableId) {
    return res.status(400).json({ success: false, message: '请指定要检测的台账表' });
  }

  pruneGunHealJobs();

  const collected = collectGunHealGroups(scope);
  if (collected.groups.size === 0) {
    return res.status(400).json({
      success: false,
      message: collected.totalRows === 0
        ? '该范围内还没有填写客户名的台账行'
        : '该范围内的客户名都认不出仕样号，无法按仕样书比对'
    });
  }

  const scopeLabel = type === 'all'
    ? `全部台账（${collected.tableNames.length} 张表）`
    : type === 'category'
      ? `${scope.category}（${collected.tableNames.length} 张表）`
      : collected.tableNames[0] || '当前表';

  const job = {
    id: `gunheal-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    scope,
    scopeLabel,
    status: 'running',
    message: '',
    total: collected.groups.size,
    done: 0,
    current: '',
    totalRows: collected.totalRows,
    skippedRows: collected.skippedRows,
    summary: null,
    specs: [],
    cancelRequested: false,
    createdAt: Date.now(),
    startedAt: Date.now(),
    finishedAt: null
  };
  gunHealJobs.set(job.id, job);

  // 后台跑，立刻把 jobId 与总数交给前端去轮询
  runGunHealScan(job, collected.groups);

  res.status(202).json({ success: true, ...getGunHealJobSnapshot(job) });
}));

// 进度（刻意只回计数，不回明细）
router.get('/self-heal/gun-ledger/scan/:jobId', [authMiddleware, adminMiddleware, requireGunLedgerAccess], (req, res) => {
  const job = gunHealJobs.get(String(req.params.jobId || ''));
  if (!job) return res.status(404).json({ success: false, message: '检测结果不存在或已过期，请重新检测' });
  res.json({ success: true, ...getGunHealJobSnapshot(job) });
});

// 停止检测：已扫完的仕样号保留，可继续执行更新
// （jobId 走请求体而不是路径，这样是一条固定路径，审计侧更容易按「只读请求」处理）
router.post('/self-heal/gun-ledger/stop', [authMiddleware, adminMiddleware, requireGunLedgerAccess], (req, res) => {
  const job = gunHealJobs.get(String((req.body && req.body.jobId) || ''));
  if (!job) return res.status(404).json({ success: false, message: '检测结果不存在或已过期，请重新检测' });
  if (job.status === 'running') {
    job.cancelRequested = true;
    return res.json({ success: true, message: '已请求停止，正在收尾' });
  }
  res.json({ success: true, message: '检测已结束' });
});

// 分页明细：几万个仕样号必须让后端分页，前端只拿当前页
router.get('/self-heal/gun-ledger/scan/:jobId/specs', [authMiddleware, adminMiddleware, requireGunLedgerAccess], (req, res) => {
  const job = gunHealJobs.get(String(req.params.jobId || ''));
  if (!job) return res.status(404).json({ success: false, message: '检测结果不存在或已过期，请重新检测' });

  const filterValues = ['all', 'outdated', 'ok', 'unresolved'];
  const filter = filterValues.includes(String(req.query.filter || '')) ? String(req.query.filter) : 'all';
  const q = String(req.query.q || '').trim().toLowerCase();
  const pageSize = Math.min(200, Math.max(20, Number(req.query.pageSize) || 50));
  const counts = getGunHealCounts(job);

  let list = job.specs;
  if (filter !== 'all') list = list.filter(entry => entry.status === filter);
  if (q) {
    list = list.filter(entry =>
      entry.specNumber.includes(q)
      || entry.expectedClient.toLowerCase().includes(q)
      || entry.message.toLowerCase().includes(q)
      || entry.samples.some(sample => sample.from.toLowerCase().includes(q))
      || entry.gunNames.some(name => name.toLowerCase().includes(q))
    );
  }

  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number(req.query.page) || 1));
  const start = (page - 1) * pageSize;

  res.json({
    success: true,
    jobId: job.id,
    status: job.status,
    counts,
    filter,
    total,
    page,
    pageSize,
    totalPages,
    items: list.slice(start, start + pageSize)
  });
});

// 写回台账客户列。重新读一遍台账再比对（检测到点击之间可能有人改过客户名），
// 只改确实不一致的行；被别人锁着编辑的表跳过，避免把编辑中的本地状态冲掉。
router.post('/self-heal/gun-ledger/apply', [authMiddleware, adminMiddleware, requireGunLedgerAccess], asyncHandler(async (req, res) => {
  const job = gunHealJobs.get(String((req.body && req.body.jobId) || ''));
  if (!job) return res.status(404).json({ success: false, message: '检测结果不存在或已过期，请重新检测' });
  if (job.status === 'failed') {
    return res.status(409).json({ success: false, message: job.message || '检测失败，请重新检测后再更新' });
  }
  if (job.status !== 'completed' && job.status !== 'cancelled') {
    return res.status(409).json({ success: false, message: '检测尚未结束，请稍候再试' });
  }

  const outdated = job.specs.filter(s => s.status === 'outdated' && s.resolved && s.expectedClient);
  const requested = Array.isArray(req.body && req.body.specNumbers)
    ? req.body.specNumbers.map(value => String(value || '').trim()).filter(Boolean)
    : [];
  const excluded = new Set(Array.isArray(req.body && req.body.excludeSpecs)
    ? req.body.excludeSpecs.map(value => String(value || '').trim()).filter(Boolean)
    : []);

  // all=true：全选「需更新」再减去用户取消勾选的；否则只处理显式勾选的仕样号
  let targets;
  if (req.body && req.body.all === true) {
    targets = outdated.filter(entry => !excluded.has(entry.specNumber));
  } else if (requested.length > 0) {
    const requestedSet = new Set(requested);
    targets = outdated.filter(entry => requestedSet.has(entry.specNumber));
  } else {
    return res.status(400).json({ success: false, message: '请先选择需要更新的仕样号' });
  }

  if (targets.length === 0) {
    return res.json({ success: true, updatedItems: 0, updatedSpecs: [], tableCount: 0, skippedTables: [], message: '没有需要更新的仕样号' });
  }

  const expectedBySpec = new Map(targets.map(entry => [entry.specNumber, entry.expectedClient]));
  const data = db.readDb();
  if (!data.gunLedger || !data.gunLedger.categories) {
    return res.status(404).json({ success: false, message: '焊枪台账数据未找到' });
  }

  const startedAt = Date.now();
  const digits = getConfiguredSpecDigits();
  const meta = req.user ? { id: req.user.id, username: req.user.username, name: req.user.name || req.user.username } : null;
  const nowIso = new Date().toISOString();
  const updatedSpecs = new Set();
  const changedTables = new Set();
  const skippedTables = [];
  let updatedItems = 0;

  Object.keys(data.gunLedger.categories).forEach(category => {
    const tables = Array.isArray(data.gunLedger.categories[category]) ? data.gunLedger.categories[category] : [];
    tables.forEach(table => {
      if (!table || !Array.isArray(table.rows)) return;
      const holder = gunTableLocks.get(table.id);
      const lockedByOther = holder && (!req.user || holder.userId !== req.user.id);
      let tableChanged = 0;
      table.rows.forEach(row => {
        if (!row) return;
        const customer = String(row.customer || '').trim();
        if (!customer) return;
        const specNumber = extractSelfHealSpecNumber(customer, digits);
        if (!specNumber) return;
        const expected = expectedBySpec.get(specNumber);
        if (!expected) return;
        if (collapseSpace(customer) === collapseSpace(expected)) return;
        tableChanged += 1;
        if (lockedByOther) return;   // 锁在别人手上：只统计，不写入
        row.customer = expected;
        row.updatedAt = nowIso;
        row.updatedBy = meta;
        updatedItems += 1;
        updatedSpecs.add(specNumber);
      });
      if (tableChanged > 0) {
        if (lockedByOther) {
          skippedTables.push({
            category,
            tableName: table.name,
            rows: tableChanged,
            holder: holder.name || holder.username || ''
          });
        } else {
          changedTables.add(table.id);
        }
      }
    });
  });

  if (updatedItems > 0) {
    await db.writeDb(data);
  }

  // 已写回的仕样号在服务端也标记为「已最新」：同一个检测结果反复点击更新时不会重复统计
  if (updatedSpecs.size > 0) {
    job.specs.forEach(entry => {
      if (!updatedSpecs.has(entry.specNumber)) return;
      entry.status = 'ok';
      entry.itemCount = 0;
      entry.distinctCurrent = 0;
      entry.samples = [];
      entry.gunNames = [];
      entry.tableNames = [];
    });
    recomputeGunHealSummary(job);
  }

  const io = req.app.get('io');
  if (io && updatedItems > 0) {
    // 台账数据量很大，不把整表塞进广播：通知持有台账页面的连接自行刷新
    emitToPage(io, 'gunLedger', 'gun_ledger_updated', {
      action: 'customer_heal',
      updatedItems,
      specCount: updatedSpecs.size,
      tableCount: changedTables.size,
      by: meta ? meta.name : ''
    });
  }

  console.log(
    `[spec] 台账仕样自愈更新（${job.scopeLabel}）：${updatedSpecs.size} 个仕样号 / ${updatedItems} 行`
    + `（操作人 ${meta ? meta.username : '未知'}，跳过锁定表 ${skippedTables.length} 张，耗时 ${Date.now() - startedAt}ms）`
  );

  res.json({
    success: true,
    updatedItems,
    updatedSpecs: [...updatedSpecs].sort(),
    tableCount: changedTables.size,
    skippedTables,
    summary: job.summary,
    message: `已更新 ${updatedItems} 行台账的客户名`
  });
}));

module.exports = router;
