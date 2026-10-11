// 客户仕样书专用类别解析规则
//
// 目前支持7类客户仕样书（依据仕样书标题行识别）：
//   1. PSW GUN 客户仕样书        例: 57475.04.PDF / 57597.01.PDF
//   2. SERVO GUN 客户仕样书      例: 55526.03.PDF / 56750.03.PDF / 56956.02.PDF / 56985.03.PDF / 57048.01.PDF / 57157.01.PDF / 57195.03.PDF
//   3. GM Lean Series GUN        例: 55606.03.PDF
//   4. GM GLOBAL GUN 客户仕样书   例: 57908.02.PDF
//   5. 焊钳修改 客户仕样书        例: 55862.03.PDF / 56735.02.PDF / 57153.01.PDF
//   6. IT GUN 客户仕样书          例: 57868.02.PDF
//   7. EQ GUN 客户仕样书          例: 57278.03.PDF
//
// 这7类仕样书的文本提取顺序与表格标签不完全对应（值单元格的提取顺序与标签列顺序无关），
// 无法用通用规则按标签取值，因此单独提炼解析规则：
//   - 仕样号: "状态标记\t<仕样号> <版本> 1N" 行
//   - 中间商: 状态标记行之后、纳期行之前的值行（纳期行以11位以上电话号码开头时该行为联系人，无中间商）
//   - 纳期+数量: 状态标记行之后的第一个 yyyy-mm-dd 行
//   - 最终客户/营业担当: 各类别按各自的锚点行定位
//
// 未命中类别、或专用规则解析不到仕样号时，由调用方回退到通用解析规则。

// 表单标签停用词：用于避免把表单字段标签误判为人名或客户名
var FORM_LABEL_PATTERN = /审核|设计|图号|品号|工时|类型|担当|内勤|仕样|纳期|数量|客户|中间商|联系人|电话|认证|出口|项目|状态|手柄|支座|护罩|螺母|端子|吊具|绝缘|电缆|插头|气管|水管|螺钉|电极|刻印|版本|编号|变更|追记|行程|气缸|马达|机器人|变压器|齿轮|涂装|控制箱|颜色|规格|规范|行程|格式|联接|联调|限位|包装|标贴|图|代码/;

function detectSpecCategory(lines) {
  for (var i = 0; i < lines.length; i++) {
    var line = String(lines[i] || '').trim();
    if (!line || line.length > 40) continue;
    if (/PSW\s*GUN/i.test(line)) return 'psw';
    if (/SERVO\s*GUN/i.test(line)) return 'servo';
    if (/GM\s*Lean\s*Series\s*GUN/i.test(line)) return 'gmlean';
    if (/GM\s*Global\s*GUN/i.test(line)) return 'gmglobal';
    if (line.indexOf('焊钳修改') >= 0 && line.indexOf('客户仕样书') >= 0) return 'modification';
    if (/IT\s*GUN/i.test(line)) return 'itgun';
    if (/EQ\s*GUN/i.test(line)) return 'eqgun';
  }
  return '';
}

function isValidDate(yy, mo, dd) {
  return yy >= 2000 && yy <= 2100 && mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31;
}

// 按 \t 或连续2个以上空格拆分（用于"最终客户\t营业担当"等值行，保留公司名中的单个空格）
function splitParts(line) {
  return String(line || '').split(/\t|\s{2,}/).map(function(p) { return p.trim(); }).filter(function(p) { return p; });
}

// 2~maxLen 位纯中文名（排除表单标签），如 茅舒 / 梁科研 / 熊飞
function isPersonName(text, maxLen) {
  var s = String(text || '').trim();
  if (!s || s.length > maxLen) return false;
  if (!/^[\u4e00-\u9fa5]{2,}$/.test(s)) return false;
  if (FORM_LABEL_PATTERN.test(s)) return false;
  return true;
}

function isFormLabel(text) {
  return FORM_LABEL_PATTERN.test(String(text || ''));
}

// 解析"纳期+数量"行，如 "2026-11-10\t80"、"18156510518\t2026-05-06\t22"
function parseDateQtyLine(line) {
  var date = null;
  var quantity = '';
  var dm = String(line || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (dm && isValidDate(parseInt(dm[1], 10), parseInt(dm[2], 10), parseInt(dm[3], 10))) {
    date = { year: parseInt(dm[1], 10), month: parseInt(dm[2], 10), day: parseInt(dm[3], 10) };
  }
  var parts = splitParts(line);
  if (parts.length === 1) {
    // 兼容 "2026-11-10 80"（单空格分隔纳期与数量）的场景
    parts = String(line || '').split(/\s+/).map(function(p) { return p.trim(); }).filter(function(p) { return p; });
  }
  for (var i = parts.length - 1; i >= 0; i--) {
    // 数量为1~4位纯数字（排除电话号码等长数字串）
    if (/^\d{1,4}$/.test(parts[i])) { quantity = parts[i]; break; }
  }
  return { date: date, quantity: quantity };
}

function extractSpecInfoByCategory(lines, category) {
  var info = {
    specNumber: '',
    middleMan: '',
    finalClient: '',
    projectName: '',
    quantity: '',
    deliveryDate: null,
    salesPerson: '',
    isModification: category === 'modification'
  };

  // 仕样号: "状态标记\t57475 04 1N"
  var stateIdx = -1;
  for (var i = 0; i < lines.length; i++) {
    var m = String(lines[i] || '').match(/状态标记\s*\t?\s*(\d{5,6})\s+(\d{1,2})/);
    if (m) { info.specNumber = m[1]; stateIdx = i; break; }
  }
  if (stateIdx < 0) return null;

  // 项目名称
  for (var i = 0; i < lines.length; i++) {
    var pm = String(lines[i] || '').match(/项目名称\s+(.+)/);
    if (pm) { info.projectName = pm[1].trim(); break; }
  }

  // 纳期+数量行: 状态标记行之后的第一个 yyyy-mm-dd 行
  var dateQtyIdx = -1;
  for (var i = stateIdx + 1; i < lines.length && i <= stateIdx + 4; i++) {
    if (/\d{4}-\d{2}-\d{2}/.test(String(lines[i] || ''))) { dateQtyIdx = i; break; }
  }
  if (dateQtyIdx < 0) return null;

  var dq = parseDateQtyLine(lines[dateQtyIdx]);
  info.deliveryDate = dq.date;
  info.quantity = dq.quantity;

  // "技术审核 营业担当 营业审核" 标签行
  var labelIdx = -1;
  for (var i = dateQtyIdx + 1; i < lines.length; i++) {
    var li = String(lines[i] || '');
    if (li.indexOf('技术审核') >= 0 && li.indexOf('营业担当') >= 0) { labelIdx = i; break; }
  }

  // 中间商: 纳期行的前一行。
  // 纳期行以11位以上数字（电话）开头时，前一行是联系人，无中间商。
  if (dateQtyIdx - 1 > stateIdx) {
    var phoneLeading = /^\d{11,}/.test(String(lines[dateQtyIdx] || ''));
    if (!phoneLeading) {
      info.middleMan = String(lines[dateQtyIdx - 1] || '').trim();
    }
  }

  // 营业担当: 标签行之前、最近的值行。
  // 形如 "最终客户\t营业担当" 时取末位人名；单独一行2~3位中文名时直接取。
  if (labelIdx > 0) {
    for (var i = labelIdx - 1; i > dateQtyIdx; i--) {
      var parts = splitParts(lines[i]);
      if (parts.length >= 2 && isPersonName(parts[parts.length - 1], 4)) {
        info.salesPerson = parts[parts.length - 1];
        break;
      }
      if (parts.length === 1 && isPersonName(parts[0], 3)) {
        info.salesPerson = parts[0];
        break;
      }
    }
  }

  // 最终客户: 各类别按各自的锚点定位
  if (category === 'psw') {
    // PSW GUN: 纳期行之后是变更追记内容，最终客户在"手柄支座"行之前
    for (var i = dateQtyIdx + 1; i < lines.length; i++) {
      if (String(lines[i] || '').indexOf('手柄支座') >= 0) {
        if (i - 1 > dateQtyIdx) {
          info.finalClient = String(lines[i - 1] || '').trim();
        }
        break;
      }
    }
  } else if (category === 'servo' || category === 'itgun' || category === 'eqgun') {
    // SERVO GUN / IT GUN / EQ GUN: 纳期行之后到标签行之前，
    // "最终客户\t营业担当" 取首位；单独非人名行取整行（如 JBM SANAND-NEEL METAL-TATA）
    var scanEnd = labelIdx > 0 ? labelIdx : lines.length;
    for (var i = dateQtyIdx + 1; i < scanEnd; i++) {
      var parts = splitParts(lines[i]);
      if (parts.length === 0) continue;
      if (parts.length >= 2) {
        if (isPersonName(parts[parts.length - 1], 4)) {
          info.finalClient = parts[0];
          break;
        }
      } else if (!isPersonName(parts[0], 3) && !isFormLabel(parts[0])) {
        info.finalClient = parts[0];
        break;
      }
    }
  } else {
    // GM Lean Series / GM GLOBAL / 焊钳修改: 纳期行之后的第一个非标签行即最终客户
    if (dateQtyIdx + 1 < lines.length) {
      var nextLine = String(lines[dateQtyIdx + 1] || '').trim();
      if (nextLine && !isFormLabel(nextLine)) {
        info.finalClient = nextLine;
      }
    }
  }

  return info;
}

module.exports = {
  detectSpecCategory: detectSpecCategory,
  extractSpecInfoByCategory: extractSpecInfoByCategory
};
