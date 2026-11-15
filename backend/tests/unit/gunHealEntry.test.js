const test = require('node:test');
const assert = require('node:assert');

const { buildGunHealSpecEntry } = require('../../utils/gunHealEntry');

const row = (overrides = {}) => ({
  category: 'X2C',
  tableName: 'SRTC',
  gunName: 'SRTC-2C15015',
  customer: '58249>O/IND_客户A-项目一',
  ...overrides
});

test('台账仕样自愈：客户名与仕样书一致时判为已最新', () => {
  const entry = buildGunHealSpecEntry('58249', [row()], {
    resolved: true,
    clientName: '58249>O/IND_客户A-项目一'
  });
  assert.strictEqual(entry.status, 'ok');
  assert.strictEqual(entry.itemCount, 0);
  assert.strictEqual(entry.resolved, true);
  assert.deepStrictEqual(entry.samples, []);
});

test('台账仕样自愈：多余空白不算差异', () => {
  const entry = buildGunHealSpecEntry('58249', [row({ customer: '  58249>O/IND_客户A-项目一  ' })], {
    resolved: true,
    clientName: '58249>O/IND_客户A-项目一'
  });
  assert.strictEqual(entry.status, 'ok');
  assert.strictEqual(entry.itemCount, 0);
});

test('台账仕样自愈：只统计不一致的行，并按现客户名归并样本', () => {
  const rows = [
    row(),
    row({ gunName: 'SRTC-2C15016' }),
    row({ customer: '58249>O/IND_旧客户', gunName: 'SRTC-2C15017' }),
    row({ customer: '58249>O/IND_旧客户', gunName: 'SRTC-2C15018', tableName: 'SRTX' })
  ];
  const entry = buildGunHealSpecEntry('58249', rows, {
    resolved: true,
    clientName: '58249>O/IND_客户A-项目一'
  });

  assert.strictEqual(entry.status, 'outdated');
  assert.strictEqual(entry.rowCount, 4);
  assert.strictEqual(entry.itemCount, 2);
  assert.strictEqual(entry.distinctCurrent, 1);
  assert.deepStrictEqual(entry.samples, [{ from: '58249>O/IND_旧客户', count: 2 }]);
  // 涉及表按「分类 / 表名」去重（同一张表出现多次只记一次，顺序按行出现先后）
  assert.deepStrictEqual(entry.tableNames, ['X2C / SRTC', 'X2C / SRTX']);
  assert.deepStrictEqual(entry.gunNames, ['SRTC-2C15017', 'SRTC-2C15018']);
});

test('台账仕样自愈：样本枪名与旧写法数量有上限，但行数全量统计', () => {
  const rows = Array.from({ length: 12 }, (_, index) => row({
    gunName: `SRTC-2C15${String(100 + index)}`,
    customer: `58249>O/IND_旧客户${index}`
  }));
  const entry = buildGunHealSpecEntry('58249', rows, {
    resolved: true,
    clientName: '58249>O/IND_客户A'
  });

  assert.strictEqual(entry.itemCount, 12);
  assert.strictEqual(entry.distinctCurrent, 12);
  assert.strictEqual(entry.gunNames.length, 6);
  assert.strictEqual(entry.samples.length, 3);
  assert.strictEqual(entry.samples[0].count, 1);
});

test('台账仕样自愈：解析失败归入无法核对，并带可展示原因', () => {
  const entry = buildGunHealSpecEntry('58249', [row()], {
    resolved: false,
    code: 'PDF_MISSING',
    message: '共享目录中没有该仕样号的仕样书'
  });
  assert.strictEqual(entry.status, 'unresolved');
  assert.strictEqual(entry.resolved, false);
  assert.strictEqual(entry.code, 'PDF_MISSING');
  assert.strictEqual(entry.message, '共享目录中没有该仕样号的仕样书');
});

test('台账仕样自愈：解析成功但无客户名时给出专门提示', () => {
  const entry = buildGunHealSpecEntry('58249', [row()], { resolved: true, clientName: '' });
  assert.strictEqual(entry.status, 'unresolved');
  assert.strictEqual(entry.code, 'NO_CLIENT');
  assert.strictEqual(entry.message, '仕样书中未找到客户名');
});
