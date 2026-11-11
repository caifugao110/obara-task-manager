process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production';

const test = require('node:test');
const assert = require('node:assert');

const { __testables } = require('../../routes/gunLedger');

const { enforceSerialNumberBinding, bindRowsToSerials, normalizeGunNameNumber } = __testables;

// 「序号 ↔ 焊枪名编号」强绑定的回归测试。
// 背景：旧版让占位行按任意序号提升（如已有 4 行时直接编辑第 6 个未取号行），
// 行内序号出现空洞 1,2,3,6；展示层按位置重排成 1..4 后，第 4 行仍挂着 6 号的编号 0355，
// 表现为「上一行的未用枪名被强制改名（向后加一位）」+ 同表重号，
// 主页面快速取号算出已存在的编号后一直 409，台账整张表也存不进去。

const RULE = { enabled: true, prefix: 'SRTC-ALDC', start: 350, pad: 4 };

test('序号空洞被压实为 1..N，编号跟着序号走', () => {
  const rows = [
    { id: 'a', serialNumber: 1, gunName: 'SRTC-ALDC0350' },
    { id: 'b', serialNumber: 2, gunName: 'SRTC-ALDC0351' },
    { id: 'c', serialNumber: 3, gunName: 'SRTC-ALDC0352' },
    { id: 'd', serialNumber: 6, gunName: 'SRTC-ALDC0355' }
  ];
  const { rows: bound, renamed } = bindRowsToSerials(RULE, rows);
  assert.deepStrictEqual(bound.map(r => r.serialNumber), [1, 2, 3, 4]);
  assert.deepStrictEqual(bound.map(r => r.gunName), [
    'SRTC-ALDC0350', 'SRTC-ALDC0351', 'SRTC-ALDC0352', 'SRTC-ALDC0353'
  ]);
  assert.deepStrictEqual(renamed, [{ serialNumber: 4, from: 'SRTC-ALDC0355', to: 'SRTC-ALDC0353' }]);
});

test('编号之后的后缀与自定义前缀原样保留，只替换编号数字段', () => {
  const rows = [
    { serialNumber: 1, gunName: 'SRTC-ALDC0350L' },
    { serialNumber: 2, gunName: 'SRTB-X0351-EL' },
    { serialNumber: 3, gunName: 'FOO-9-0352L-WL' }
  ];
  const { rows: bound } = bindRowsToSerials(RULE, rows);
  assert.deepStrictEqual(bound.map(r => r.gunName), [
    'SRTC-ALDC0350L', 'SRTB-X0351-EL', 'FOO-9-0352L-WL'
  ]);
});

test('同表历史重号会被拆开：各自回到自己序号对应的编号', () => {
  const rows = [
    { serialNumber: 1, gunName: 'SRTC-ALDC0351' }, // 序号 1 应为 0350，与下一行撞号
    { serialNumber: 2, gunName: 'SRTC-ALDC0351' }
  ];
  const { rows: bound } = bindRowsToSerials(RULE, rows);
  assert.deepStrictEqual(bound.map(r => r.gunName), ['SRTC-ALDC0350', 'SRTC-ALDC0351']);
});

test('校正后会抢走其它行正在使用的名字时保留原名，绝不制造新的重号', () => {
  const rows = [
    { serialNumber: 1, gunName: 'A-9999' },  // 应为 A-0350，但该名字正被下一行使用
    { serialNumber: 2, gunName: 'A-0350' }   // 应为 A-0351
  ];
  const { rows: bound } = bindRowsToSerials(RULE, rows);
  assert.strictEqual(bound[0].gunName, 'A-9999');
  assert.strictEqual(bound[1].gunName, 'A-0351');
  assert.deepStrictEqual(bound.map(r => r.serialNumber), [1, 2]);
});

test('按提交序号排序后再压实：中间插入的新行不会抢走已有行的序号', () => {
  const rows = [
    { id: 'x', serialNumber: 2, gunName: 'SRTC-ALDC0351' },
    { id: 'n', serialNumber: 9, gunName: 'SRTC-ALDC0360' },
    { id: 'y', serialNumber: 1, gunName: 'SRTC-ALDC0350' }
  ];
  const { rows: bound } = bindRowsToSerials(RULE, rows);
  assert.deepStrictEqual(bound.map(r => r.id), ['y', 'x', 'n']);
  assert.deepStrictEqual(bound.map(r => r.serialNumber), [1, 2, 3]);
  assert.deepStrictEqual(bound.map(r => r.gunName), [
    'SRTC-ALDC0350', 'SRTC-ALDC0351', 'SRTC-ALDC0352'
  ]);
});

test('无规则的表只压实序号、不改焊枪名', () => {
  const rows = [
    { serialNumber: 4, gunName: 'ANY-NAME' },
    { serialNumber: 9, gunName: '' }
  ];
  const { rows: bound, renamed } = bindRowsToSerials(null, rows);
  assert.deepStrictEqual(bound.map(r => r.serialNumber), [1, 2]);
  assert.deepStrictEqual(bound.map(r => r.gunName), ['ANY-NAME', '']);
  assert.deepStrictEqual(renamed, []);
});

test('normalizeGunNameNumber 在退格删掉编号后把编号补回原位', () => {
  // 未取号行「在焊枪名后面按退格」：删掉末位后被自动补回，值不变 → 前端据此判定为无效编辑
  assert.strictEqual(normalizeGunNameNumber(RULE, 5, 'SRTC-ALDC0354'), 'SRTC-ALDC0354');
  assert.strictEqual(normalizeGunNameNumber(RULE, 5, 'SRTC-ALDC035'), 'SRTC-ALDC0354');
  assert.strictEqual(normalizeGunNameNumber(RULE, 5, 'SRTC-ALDC0354L'), 'SRTC-ALDC0354L');
});
