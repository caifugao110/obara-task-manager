const express = require('express');
const router = express.Router();
const path = require('path');
const fs2 = require('fs');
const asyncHandler = require('express-async-handler');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

let PDFParse = null;
async function getPdfParse() {
  if (!PDFParse) {
    const module = require('pdf-parse');
    PDFParse = module.PDFParse;
  }
  return PDFParse;
}

var SPEC_SHARE_PATH = '//192.168.160.6/仕样书$/';
var SPEC_SHARE_PATH_BS = '\\\\192.168.160.6\\仕样书$\\';

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

function makePath(specNumber, suffix) {
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
  
  if (fs2.existsSync(fp)) return fp;
  if (fs2.existsSync(bp)) return bp;
  return null;
}

function findLatestSpecPdf(n) {
  var shareAccessible = fs2.existsSync(SPEC_SHARE_PATH) || fs2.existsSync(SPEC_SHARE_PATH_BS);
  if (!shareAccessible) return null;

  var latest = null;
  var bestVer = -1;

  var base = makePath(n, '.PDF');
  if (base) { latest = base; bestVer = 0; }

  for (var i = 1; i <= 9; i++) {
    var v = (i < 10 ? '0' : '') + i;
    var fp = makePath(n, '.' + v + '.PDF');
    if (fp) { latest = fp; bestVer = i; }
  }
  return latest;
}

function isValidDate(yy, mo, dd) {
  return yy >= 2000 && yy <= 2100 && mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31;
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

async function extractDeliveryDateFromPdf(p) {
  try {
    var buf = fs2.readFileSync(p);
    var ParseClass = await getPdfParse();
    var pdf = new ParseClass({data: buf});
    var textResult = await pdf.getText();
    var t = (textResult && textResult.text) || '';

    var keywords = ['纳期', '绾虫湡'];
    for (var ki = 0; ki < keywords.length; ki++) {
      var kw = keywords[ki];
      var kwIndex = t.indexOf(kw);
      if (kwIndex >= 0) {
        var afterKw = t.substring(kwIndex + kw.length);
        var nqPats = [
          /^\s*(\d{4})[-年\.](\d{1,2})[-月\.](\d{1,2})/,
          /^\s*(\d{4})(\d{2})(\d{2})/,
          /\s*(\d{4})[-年\.](\d{1,2})[-月\.](\d{1,2})/,
          /\s*(\d{4})(\d{2})(\d{2})/
        ];
        for (var ni = 0; ni < nqPats.length; ni++) {
          var nm = afterKw.match(nqPats[ni]);
          if (nm) {
            var nyy = parseInt(nm[1], 10);
            var nmo = parseInt(nm[2], 10);
            var ndd = parseInt(nm[3], 10);
            if (isValidDate(nyy, nmo, ndd)) {
              return {year: nyy, month: nmo, day: ndd};
            }
          }
        }
      }
    }

    var cd = t.replace(/(\d)\s+(?=\d)/g, '$1').replace(/(\d)\s+([-\/\.\u5e74]|\u6708)/g, '$1$2').replace(/([-\/\.\u5e74]|\u6708)\s+(\d)/g, '$1$2');
    var st = t.replace(/\s+/g, '');
    var texts = [t, cd, st];

    var bestDate = null;
    var bestYear = 0;
    var pats = [
      /(\d{4})[-\/\u5e74\.](\d{1,2})[-\/\u6708\.](\d{1,2})/g,
      /(\d{4})\u5e74(\d{1,2})\u6708(\d{1,2})\u65e5/g,
      /(\d{4})\.(\d{1,2})\.(\d{1,2})/g,
      /\b(\d{4})(\d{2})(\d{2})\b/g
    ];

    for (var ti = 0; ti < texts.length; ti++) {
      var txt = texts[ti]; if (!txt) continue;
      for (var pi = 0; pi < pats.length; pi++) {
        var pat = new RegExp(pats[pi].source, 'g');
        var m;
        while ((m = pat.exec(txt)) !== null) {
          var yy = parseInt(m[1], 10);
          var mo = parseInt(m[2], 10);
          var dd = parseInt(m[3], 10);
          if (isValidDate(yy, mo, dd) && yy > bestYear) {
            bestYear = yy;
            bestDate = {year: yy, month: mo, day: dd};
          }
        }
      }
    }
    return bestDate;
  } catch(e) { return null; }
}

async function extractSpecInfoFromPdf(p) {
  try {
    var buf = fs2.readFileSync(p);
    var ParseClass = await getPdfParse();
    var pdf = new ParseClass({data: buf});
    var textResult = await pdf.getText();
    var t = (textResult && textResult.text) || '';

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

    if (!info.deliveryDate) {
      var deliveryDate = await extractDeliveryDateFromPdf(p);
      if (deliveryDate) {
        info.deliveryDate = deliveryDate;
      }
    }

    return info;
  } catch(e) {
    console.error('extractSpecInfoFromPdf error:', e);
    return null;
  }
}

router.post('/delivery-date', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {

  var n = req.body.specNumber;

  if (!n) return res.json({success: false, message: '仕样号不能为空'});

  if (!/^\d+$/.test(n)) return res.json({success: false, message: '仕样号格式不正确'});

  try {

    var r = await Promise.race([

      (async function() {

        var ok = fs2.existsSync(SPEC_SHARE_PATH) || fs2.existsSync(SPEC_SHARE_PATH_BS);

        if (!ok) return {success: false, message: '无法访问共享目录，请检查网络连接和权限'};

        var pdf = findLatestSpecPdf(n);

        if (!pdf) return {success: false, message: '未找到仕样号 ' + n + ' 的PDF文件'};

        var d = await extractDeliveryDateFromPdf(pdf);

        if (!d) return {success: false, message: '未在PDF中找到纳期信息'};

        return {success: true, date: d.year + '-' + String(d.month).padStart(2, '0') + '-' + String(d.day).padStart(2, '0')};

      })(),

      new Promise(function(_, rj) { setTimeout(function() { rj(new Error('T')); }, 9000); })

    ]);

    return res.json(r);

  } catch(e) {

    if (e.message === 'T') return res.json({success: false, message: '获取纳期超时(超过9秒)'});

    return res.json({success: false, message: '获取纳期失败: ' + e.message});

  }

}));

router.post('/spec-raw-text', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {
  var n = req.body.specNumber;
  if (!n) return res.json({success: false, message: '仕样号不能为空'});
  if (!/^\d+$/.test(n)) return res.json({success: false, message: '仕样号格式不正确'});
  try {
    var ok = fs2.existsSync(SPEC_SHARE_PATH) || fs2.existsSync(SPEC_SHARE_PATH_BS);
    if (!ok) return {success: false, message: '无法访问共享目录，请检查网络连接和权限'};
    var pdf = findLatestSpecPdf(n);
    if (!pdf) return res.json({success: false, message: '未找到仕样号 ' + n + ' 的PDF文件'});
    
    var buf = fs2.readFileSync(pdf);
    var ParseClass = require('pdf-parse/lib/pdf-parse.js');
    var pdfParser = new ParseClass({data: buf});
    var textResult = await pdfParser.getText();
    var t = (textResult && textResult.text) || '';
    
    var lines = t.split('\n').map((l, idx) => ({line: idx + 1, text: l.trim()})).filter(l => l.text);
    
    return res.json({success: true, lines: lines, rawText: t});
  } catch(e) {
    return res.json({success: false, message: '获取原始文本失败: ' + e.message});
  }
}));

router.post('/spec-info', [authMiddleware, adminMiddleware], asyncHandler(async (req, res) => {

  var n = req.body.specNumber;

  if (!n) return res.json({success: false, message: '仕样号不能为空'});

  if (!/^\d+$/.test(n)) return res.json({success: false, message: '仕样号格式不正确'});

  try {

    var r = await Promise.race([

      (async function() {

        var ok = fs2.existsSync(SPEC_SHARE_PATH) || fs2.existsSync(SPEC_SHARE_PATH_BS);

        if (!ok) return {success: false, message: '无法访问共享目录，请检查网络连接和权限'};

        var pdf = findLatestSpecPdf(n);

        if (!pdf) return {success: false, message: '未找到仕样号 ' + n + ' 的PDF文件'};

        var info = await extractSpecInfoFromPdf(pdf);

        if (!info) return {success: false, message: '解析PDF信息失败'};

        var clientName = '';

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

        var deliveryDateStr = null;

        if (info.deliveryDate) {

          deliveryDateStr = info.deliveryDate.year + '-' + String(info.deliveryDate.month).padStart(2, '0') + '-' + String(info.deliveryDate.day).padStart(2, '0');

        }

        return {

          success: true,

          specNumber: n,

          clientName: clientName,

          middleMan: info.middleMan,

          finalClient: info.finalClient,

          projectName: info.projectName,

          quantity: info.quantity,

          deliveryDate: deliveryDateStr,

          salesPerson: info.salesPerson,

          isModification: info.isModification

        };

      })(),

      new Promise(function(_, rj) { setTimeout(function() { rj(new Error('T')); }, 15000); })

    ]);

    return res.json(r);

  } catch(e) {

    if (e.message === 'T') return res.json({success: false, message: '获取仕样信息超时(超过15秒)'});

    return res.json({success: false, message: '获取仕样信息失败: ' + e.message});

  }

}));

module.exports = router;
