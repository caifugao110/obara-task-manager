const express = require('express');
const router = express.Router();
const path = require('path');
const fs2 = require('fs');
const asyncHandler = require('express-async-handler');

let pdfParse = null;
async function getPdfParse() {
  if (!pdfParse) pdfParse = require('pdf-parse');
  return pdfParse;
}

// Network share for spec PDFs
// Using forward-slash UNC for better Node.js Windows compatibility
var SPEC_SHARE_PATH = '//192.168.160.6/仕样书$/';

// Fallback: also try backslash UNC if forward slash fails
var SPEC_SHARE_PATH_BS = '\\\\192.168.160.6\\仕样书$\\';

function makePath(specNumber, suffix) {
  // Try forward-slash path first, then backslash
  var fp = SPEC_SHARE_PATH + specNumber + suffix;
  var bp = SPEC_SHARE_PATH_BS + specNumber + suffix;
  if (fs2.existsSync(fp)) return fp;
  if (fs2.existsSync(bp)) return bp;
  return null;
}

function findLatestSpecPdf(n) {
  // First check if the share is accessible via either format
  var shareAccessible = fs2.existsSync(SPEC_SHARE_PATH) || fs2.existsSync(SPEC_SHARE_PATH_BS);
  if (!shareAccessible) return null;

  var latest = null;
  var bestVer = -1;

  // Check base file
  var base = makePath(n, '.PDF');
  if (base) { latest = base; bestVer = 0; }

  // Check versioned files 01..99 (sequential, break on gap)
  for (var i = 1; i <= 99; i++) {
    var v = (i < 10 ? '0' : '') + i;
    var fp = makePath(n, '.' + v + '.PDF');
    if (fp) { latest = fp; bestVer = i; }
    else break;
  }
  return latest;
}

async function extractDeliveryDateFromPdf(p) {
  try {
    var buf = fs2.readFileSync(p);
    var parse = await getPdfParse();
    var data = await parse(buf);
    var t = (data && data.text) || '';

    // Priority: find date after keyword 纳期
    var nqPats = [
      /纳期\s*(\d{4})[-年\.](\d{1,2})[-月\.](\d{1,2})/,
      /纳期\s*(\d{4})(\d{2})(\d{2})/
    ];
    for (var ni = 0; ni < nqPats.length; ni++) {
      var nm = t.match(nqPats[ni]);
      if (nm) {
        var nmo = parseInt(nm[2], 10);
        var ndd = parseInt(nm[3], 10);
        if (nmo >= 1 && nmo <= 12 && ndd >= 1 && ndd <= 31) return {month: nmo, day: ndd};
      }
    }

    // Fallback: normalized and stripped texts
    var cd = t.replace(/(\d)\s+(?=\d)/g, '$1').replace(/(\d)\s+([-\/\.\u5e74]|\u6708)/g, '$1$2').replace(/([-\/\.\u5e74]|\u6708)\s+(\d)/g, '$1$2');
    var st = t.replace(/\s+/g, '');
    var texts = [t];
    if (cd !== t) texts.push(cd);
    if (st !== t && st !== cd) texts.push(st);
    var pats = [
      /(\d{4})[-\/\u5e74\.](\d{1,2})[-\/\u6708\.](\d{1,2})/,
      /(\d{4})\u5e74(\d{1,2})\u6708(\d{1,2})\u65e5/,
      /(\d{4})\.(\d{1,2})\.(\d{1,2})/,
      /\b(\d{4})(\d{2})(\d{2})\b/
    ];
    for (var ti = 0; ti < texts.length; ti++) {
      var txt = texts[ti]; if (!txt) continue;
      for (var pi = 0; pi < pats.length; pi++) {
        var m = txt.match(pats[pi]);
        if (m) {
          var mo = parseInt(m[2], 10);
          var dd = parseInt(m[3], 10);
          if (mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31) return {month: mo, day: dd};
        }
      }
    }
    return null;
  } catch(e) { return null; }
}router.post('/delivery-date', asyncHandler(async (req, res) => {

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

        return {success: true, date: d.month + '/' + d.day};

      })(),

      new Promise(function(_, rj) { setTimeout(function() { rj(new Error('T')); }, 9000); })

    ]);

    return res.json(r);

  } catch(e) {

    if (e.message === 'T') return res.json({success: false, message: '获取纳期超时(超过9秒)'});

    return res.json({success: false, message: '获取纳期失败: ' + e.message});

  }

}));

module.exports = router;