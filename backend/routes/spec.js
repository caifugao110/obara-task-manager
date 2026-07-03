const express = require('express');
const router = express.Router();
const path = require('path');
const fs2 = require('fs');
const asyncHandler = require('express-async-handler');

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

function makePath(specNumber, suffix) {
  var fp = SPEC_SHARE_PATH + specNumber + suffix;
  var bp = SPEC_SHARE_PATH_BS + specNumber + suffix;
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

  for (var i = 1; i <= 99; i++) {
    var v = (i < 10 ? '0' : '') + i;
    var fp = makePath(n, '.' + v + '.PDF');
    if (fp) { latest = fp; bestVer = i; }
    else break;
  }
  return latest;
}

function isValidDate(yy, mo, dd) {
  return yy >= 2000 && yy <= 2100 && mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31;
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
      salesPerson: ''
    };

    var lines = t.split('\n').map(l => l.trim()).filter(l => l);

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
          var middleManLine = lines[i + 1].trim();
          var middleManParts = middleManLine.split(/\s{2,}/);
          if (middleManParts.length >= 2) {
            info.middleMan = middleManParts[1].trim();
            if (middleManParts.length >= 4) {
              info.finalClient = middleManParts[3].trim();
            }
          }
        }
        if (lines[i + 2]) {
          var projectLine = lines[i + 2].trim();
          var projectParts = projectLine.split(/\s{2,}/);
          if (projectParts.length >= 2) {
            info.projectName = projectParts[1].trim();
          }
        }
        if (lines[i + 3]) {
          var detailLine = lines[i + 3].trim();
          var detailParts = detailLine.split(/\s{2,}/);
          for (var di = 0; di < detailParts.length; di++) {
            if (detailParts[di].includes('数量')) {
              info.quantity = detailParts[di + 1]?.trim() || '';
            }
            if (detailParts[di].includes('纳期')) {
              var dateMatch = detailParts[di + 1]?.match(/(\d{4}-\d{2}-\d{2})/);
              if (dateMatch) {
                info.deliveryDate = {
                  year: parseInt(dateMatch[1].split('-')[0], 10),
                  month: parseInt(dateMatch[1].split('-')[1], 10),
                  day: parseInt(dateMatch[1].split('-')[2], 10)
                };
              }
            }
          }
        }
      }

      if (line.includes('营业担当') && !info.salesPerson) {
        var salesColumns = line.split(/\s{2,}/);
        var salesIndex = -1;
        for (var ci = 0; ci < salesColumns.length; ci++) {
          if (salesColumns[ci].trim().includes('营业担当')) {
            salesIndex = ci;
            break;
          }
        }
        
        if (salesIndex >= 0) {
          for (var j = i + 1; j < lines.length; j++) {
            var nextLine = lines[j];
            if (nextLine && nextLine.trim()) {
              var nextParts = nextLine.split(/\s{2,}/);
              if (nextParts[salesIndex]) {
                var nameValue = nextParts[salesIndex].trim();
                if (nameValue && !nameValue.includes('营业') && !nameValue.includes('审核')) {
                  info.salesPerson = nameValue;
                  break;
                }
              }
            }
          }
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

router.post('/delivery-date', asyncHandler(async (req, res) => {

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

router.post('/spec-raw-text', asyncHandler(async (req, res) => {
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

router.post('/spec-info', asyncHandler(async (req, res) => {

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

        } else if (info.middleMan) {

          clientName = `${n}>${info.middleMan}`;

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

          salesPerson: info.salesPerson

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
