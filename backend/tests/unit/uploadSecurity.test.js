const test = require('node:test');
const assert = require('node:assert');

const {
  validateFileType,
  sanitizeCellValue,
  escapeFormulaCell,
  sanitizeAoaRows
} = require('../../utils/fileUploadSecurity');

test('validateFileType 只允许 xls / xlsx', () => {
  assert.strictEqual(validateFileType('a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').valid, true);
  assert.strictEqual(validateFileType('a.xls', 'application/vnd.ms-excel').valid, true);
  assert.strictEqual(validateFileType('a.exe', 'application/octet-stream').valid, false);
  assert.strictEqual(validateFileType('a.pdf', 'application/pdf').valid, false);
});

test('validateFileType 拒绝不受信任的 content-type', () => {
  assert.strictEqual(validateFileType('a.xlsx', 'text/html').valid, false);
});

test('sanitizeCellValue 为公式型内容加前导单引号', () => {
  assert.strictEqual(sanitizeCellValue('=1+1'), "'=1+1");
  assert.strictEqual(sanitizeCellValue('+1+1'), "'+1+1");
  assert.strictEqual(sanitizeCellValue('-1'), "'-1");
  assert.strictEqual(sanitizeCellValue('@SUM(A1)'), "'@SUM(A1)");
  assert.strictEqual(sanitizeCellValue('=cmd|\'/c calc\'!A1'), "'=cmd|'/c calc'!A1");
});

test('sanitizeCellValue 不影响普通文本', () => {
  assert.strictEqual(sanitizeCellValue('正常任务名'), '正常任务名');
  assert.strictEqual(sanitizeCellValue('A-1'), 'A-1');
});

test('escapeFormulaCell 空串与非字符串原样返回', () => {
  assert.strictEqual(escapeFormulaCell(''), '');
  assert.strictEqual(escapeFormulaCell(123), 123);
  assert.strictEqual(escapeFormulaCell(null), null);
});

test('sanitizeAoaRows 逐行逐列转义', () => {
  const rows = [['任务A', '=HYPERLINK("http://evil")'], ['=1+1', 2]];
  assert.deepStrictEqual(sanitizeAoaRows(rows), [
    ['任务A', '\'=HYPERLINK("http://evil")'],
    ["'=1+1", 2]
  ]);
});

test('sanitizeAoaRows 对非数组输入原样返回', () => {
  assert.strictEqual(sanitizeAoaRows(null), null);
});
