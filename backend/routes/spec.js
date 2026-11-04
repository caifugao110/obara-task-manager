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

// 仕样书共享目录是否可访问：结果缓存 30 秒，避免每次查询都对共享盘做一轮探测。
// 走异步 API——共享盘不可达时 existsSync 会阻塞整个事件循环（详见 productionSchedule 的同类问题）。
let shareState = { ok: true, at: 0 };
const SHARE_CHECK_TTL_MS = 30 * 1000;

async function shareReachable() {
  const now = Date.now();
  if (now - shareState.at < SHARE_CHECK_TTL_MS) return shareState.ok;
  const ok = (await fileExists(SPEC_SHARE_PATH)) || (await fileExists(SPEC_SHARE_PATH_BS));
  shareState = { ok, at: now };
  return ok;
}

// 取该仕样号的最新版 PDF（58249.08.PDF 优先于 58249.PDF）。
// 各候选并行探测：串行 10 次网络 access 会叠加成上百毫秒，且期间占着请求。
async function findLatestSpecPdf(n) {
  var shareAccessible = await shareReachable();
  if (!shareAccessible) return null;

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

        var ok = await shareReachable();

        if (!ok) return {success: false, message: '无法访问共享目录，请检查网络连接和权限'};

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
    var ok = await shareReachable();
    if (!ok) return res.json({success: false, message: '无法访问共享目录，请检查网络连接和权限'});
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

  // 状态跟踪会传入添加时间月份，用于取「各产品大日程」中对应月份块的数据
  var requestedMonth = String(req.body.productionPlanMonth || req.body.month || '').trim();
  var preferredMonth = /^\d{4}-\d{2}$/.test(requestedMonth) ? requestedMonth : '';

  try {

    var r = await Promise.race([

      (async function() {

        // 大日程表格优先：命中时数量/纳期/已发图/工厂以表格为准
        // 注意：这里必须 await —— 大日程在共享盘上，同步读取会占住事件循环，
        // 共享服务器不可达时整个后端会被拖住几十秒（所有接口一起变慢）。
        var scheduleEntry = await productionSchedule.findScheduleEntry(n, preferredMonth);

        // PDF 仍尽量解析，用于补充客户名称、营业担当等信息；
        // PDF 不可用时只要表格命中就继续返回表格数据
        var info = null;
        var pdfState = 'missing';

        try {

          var ok = await shareReachable();

          if (!ok) {
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

        if (!scheduleEntry && !info) {
          if (pdfState === 'share-unavailable') {
            return {success: false, message: '无法访问共享目录，请检查网络连接和权限'};
          }
          if (pdfState === 'parse-failed' || pdfState === 'error') {
            return {success: false, message: '解析PDF信息失败'};
          }
          return {success: false, message: '未找到仕样号 ' + n + ' 的PDF文件'};
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

          scheduleMonth: scheduleEntry ? scheduleEntry.month : ''

        };

      })(),

      new Promise(function(_, rj) { setTimeout(function() { rj(new Error('T')); }, 15000); })

    ]);

    return res.json(r);

  } catch(e) {

    if (e.message === 'T') return res.json({success: false, message: '获取仕样信息超时(超过15秒)'});

    // 不向客户端回传内部错误细节（可能含上游 URL / 文件路径），详细信息仅写服务端日志
    console.warn('[spec] 获取仕样信息失败:', e.message);
    return res.json({success: false, message: '获取仕样信息失败，请稍后重试或检查网络后联系管理员'});

  }

}));

module.exports = router;
