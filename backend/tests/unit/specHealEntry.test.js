const test = require('node:test');
const assert = require('node:assert');

const {
  hasNamedGunRows,
  buildSkippedSpecEntry,
  describeTaskNameDiff,
  splitHealTaskName,
  buildHealTaskName,
  isChangeNoticeNo,
  hasUnparsedTypeSuffix,
  NO_GUN_ROWS_MESSAGE,
  UNPARSED_SUFFIX_MESSAGE,
  MIXED_SKIP_MESSAGE
} = require('../../utils/specHealEntry');

const task = (guns) => ({ id: 'item-1', taskName: '57475>客户A 确认图 [11/10]', guns });

test('枪名行判定：没有 guns 字段或空数组都不算含枪名行', () => {
  assert.strictEqual(hasNamedGunRows({ id: 'a' }), false);
  assert.strictEqual(hasNamedGunRows(task([])), false);
  assert.strictEqual(hasNamedGunRows(task(undefined)), false);
  assert.strictEqual(hasNamedGunRows(null), false);
});

test('枪名行判定：空名字与占位名「未命名」都不算', () => {
  assert.strictEqual(hasNamedGunRows(task([{ name: '' }, { name: '   ' }])), false);
  assert.strictEqual(hasNamedGunRows(task([{ name: '未命名' }])), false);
  assert.strictEqual(hasNamedGunRows(task([{ name: ' 未命名 ' }, { name: '' }])), false);
});

test('枪名行判定：只要有一条真实枪名就参与自愈', () => {
  assert.strictEqual(hasNamedGunRows(task([{ name: 'SRTC-2C14544' }])), true);
  assert.strictEqual(hasNamedGunRows(task([{ name: '未命名' }, { name: 'SRTX-2C24110' }])), true);
});

test('已跳过条目：状态为 skipped，不进入需更新统计', () => {
  const entry = buildSkippedSpecEntry('57475', 2);
  assert.strictEqual(entry.status, 'skipped');
  assert.strictEqual(entry.resolved, false);
  assert.strictEqual(entry.code, 'NO_GUN_ROWS');
  assert.strictEqual(entry.message, NO_GUN_ROWS_MESSAGE);
  // itemCount 恒为 0：不会被「一键更新」选中，也不影响「需更新任务」合计
  assert.strictEqual(entry.itemCount, 0);
  assert.strictEqual(entry.noGunItemCount, 2);
  assert.deepStrictEqual(entry.items, []);
  assert.deepStrictEqual(entry.changes, []);
});

test('已跳过条目：任务条数缺失或非法时兜底为 0', () => {
  assert.strictEqual(buildSkippedSpecEntry('57475').noGunItemCount, 0);
  assert.strictEqual(buildSkippedSpecEntry('57475', NaN).noGunItemCount, 0);
  assert.strictEqual(buildSkippedSpecEntry('57475', -3).noGunItemCount, 0);
  assert.strictEqual(buildSkippedSpecEntry(null, 1).specNumber, '');
});

// ===== 差异标签：纳期「从无到有」应标增加纳期，而不是与「纳期」混用 =====

test('差异判定：客户名与纳期都一致时没有任何标签', () => {
  const diff = describeTaskNameDiff({ baseName: '58725>广州中谷_广汽埃安', deliverySuffix: '[12/18]' },
    '58725>广州中谷_广汽埃安', '[12/18]');
  assert.deepStrictEqual(diff.flags, []);
  assert.strictEqual(diff.clientChanged, false);
  assert.strictEqual(diff.deliveryChanged, false);
});

test('差异判定：原来没有纳期 → 标「增加纳期」', () => {
  const diff = describeTaskNameDiff({ baseName: '58725>广州中谷_广汽埃安', deliverySuffix: '' },
    '58725>广州中谷_广汽埃安', '[12/18]');
  assert.deepStrictEqual(diff.flags, ['delivery-add']);
  assert.strictEqual(diff.deliveryAdded, true);
  assert.strictEqual(diff.deliveryChanged, true);
});

test('差异判定：纳期被改写 → 标「纳期」', () => {
  const diff = describeTaskNameDiff({ baseName: '58725>广州中谷_广汽埃安', deliverySuffix: '[1/1]' },
    '58725>广州中谷_广汽埃安', '[12/18]');
  assert.deepStrictEqual(diff.flags, ['delivery']);
});

test('差异判定：客户名分隔符不同 + 增加纳期 → 客户名与增加纳期两个标签', () => {
  // 真实案例：任务名写成 58725>广州中谷-广汽埃安，仕样书规范名是 58725>广州中谷_广汽埃安
  const diff = describeTaskNameDiff({ baseName: '58725>广州中谷-广汽埃安', deliverySuffix: '' },
    '58725>广州中谷_广汽埃安', '[12/18]');
  assert.deepStrictEqual(diff.flags, ['client', 'delivery-add']);
});

test('差异判定：多余空格不算客户名差异', () => {
  const diff = describeTaskNameDiff({ baseName: '  58725>广州中谷_广汽埃安  ', deliverySuffix: '' },
    '58725>广州中谷_广汽埃安', '[12/18]');
  assert.deepStrictEqual(diff.flags, ['delivery-add']);
});

test('差异判定：仕样书没有纳期时不动任务里的纳期', () => {
  const withDelivery = describeTaskNameDiff({ baseName: '58725>客户', deliverySuffix: '[1/1]' }, '58725>客户', '');
  assert.deepStrictEqual(withDelivery.flags, []);
  const withoutDelivery = describeTaskNameDiff({ baseName: '58725>客户', deliverySuffix: '' }, '58725>客户', '');
  assert.deepStrictEqual(withoutDelivery.flags, []);
});

test('差异判定：仕样书没有客户名时只比纳期', () => {
  const diff = describeTaskNameDiff({ baseName: '手写客户名', deliverySuffix: '' }, '', '[12/18]');
  assert.deepStrictEqual(diff.flags, ['delivery-add']);
});

// ===== 带更改通知单号的「设计变更」：单号必须跟着走，不能当客户名差异 =====

test('拆分：设计变更带更改通知单号时，单号归入任务类型后缀', () => {
  const parts = splitHealTaskName('58519>浙江道衡_浙江博汇-L243 设计变更 FY26-0035 [11/26]');
  assert.strictEqual(parts.baseName, '58519>浙江道衡_浙江博汇-L243');
  assert.strictEqual(parts.typeSuffix, ' 设计变更 FY26-0035');
  assert.strictEqual(parts.deliverySuffix, '[11/26]');
});

test('拆分：设计变更不带单号、或单号没有纳期时同样正确', () => {
  assert.deepStrictEqual(splitHealTaskName('58519>浙江道衡 设计变更 [11/26]'), {
    baseName: '58519>浙江道衡',
    typeSuffix: ' 设计变更',
    deliverySuffix: '[11/26]'
  });
  assert.deepStrictEqual(splitHealTaskName('58519>浙江道衡 设计变更 FY26-0035'), {
    baseName: '58519>浙江道衡',
    typeSuffix: ' 设计变更 FY26-0035',
    deliverySuffix: ''
  });
});

test('拆分：不是单号的尾串（含空格/中文）不被拆走', () => {
  assert.strictEqual(isChangeNoticeNo('FY26-0035'), true);
  assert.strictEqual(isChangeNoticeNo('FY26-0035-01'), true);
  assert.strictEqual(isChangeNoticeNo('fy26-0035'), true);
  assert.strictEqual(isChangeNoticeNo('讨论 L243'), false);
  assert.strictEqual(isChangeNoticeNo('确认图'), false);
  // 必须以 FY 开头：其它格式（ECO / A-12 / 纯数字）一律不认
  assert.strictEqual(isChangeNoticeNo('ECO1234'), false);
  assert.strictEqual(isChangeNoticeNo('A-12'), false);
  assert.strictEqual(isChangeNoticeNo('260035'), false);
  assert.strictEqual(isChangeNoticeNo('FY-0035'), false);
  const parts = splitHealTaskName('58519>浙江道衡 设计变更讨论 L243 [11/26]');
  assert.strictEqual(parts.baseName, '58519>浙江道衡 设计变更讨论 L243');
  assert.strictEqual(parts.typeSuffix, '');
});

test('拆分：非 FY 单号不被识别为单号（整段留在主体里）', () => {
  const parts = splitHealTaskName('58519>浙江道衡 设计变更 ECO1234 [11/26]');
  assert.strictEqual(parts.baseName, '58519>浙江道衡 设计变更 ECO1234');
  assert.strictEqual(parts.typeSuffix, '');
});

test('带单号的设计变更：客户名与纳期都一致时判为无需更新', () => {
  const name = '58519>浙江道衡_浙江博汇-L243 设计变更 FY26-0035 [11/26]';
  const diff = describeTaskNameDiff(splitHealTaskName(name), '58519>浙江道衡_浙江博汇-L243', '[11/26]');
  assert.deepStrictEqual(diff.flags, []);
});

test('带单号的设计变更：只改纳期时保留单号', () => {
  const name = '58519>浙江道衡_浙江博汇-L243 设计变更 FY26-0035 [11/26]';
  assert.strictEqual(
    buildHealTaskName(name, '', '[12/1]'),
    '58519>浙江道衡_浙江博汇-L243 设计变更 FY26-0035 [12/1]'
  );
});

test('带单号的设计变更：客户名真的变了也只替换主体，单号原样保留', () => {
  const name = '58519>浙江道衡_浙江博汇-L243 设计变更 FY26-0035 [11/26]';
  assert.strictEqual(
    buildHealTaskName(name, '58519>浙江道衡_浙江博汇-L260', ''),
    '58519>浙江道衡_浙江博汇-L260 设计变更 FY26-0035 [11/26]'
  );
});

test('拼装：仕样书没给客户名/纳期时沿用原值，不产生多余空格', () => {
  assert.strictEqual(buildHealTaskName('58519>客户 确认图', '', ''), '58519>客户 确认图');
  assert.strictEqual(buildHealTaskName('58519>客户 [1/2]', '', ''), '58519>客户 [1/2]');
});

// ===== 后缀认不出来：不参与自愈，避免写回时把这段内容删掉 =====

test('后缀保护：认不出单号的设计变更 → 判为需跳过', () => {
  assert.strictEqual(hasUnparsedTypeSuffix(splitHealTaskName('58519>浙江道衡 设计变更 ECO1234 [11/26]')), true);
  assert.strictEqual(hasUnparsedTypeSuffix(splitHealTaskName('58519>浙江道衡 设计变更讨论 L243 [11/26]')), true);
});

test('后缀保护：正常任务名不受影响', () => {
  const normal = [
    '58519>浙江道衡_浙江博汇-L243 设计变更 FY26-0035 [11/26]',
    '58519>浙江道衡 确认图 [11/26]',
    '58519>浙江道衡 暂停/取消',
    '58519>浙江道衡 [11/26]',
  ];
  normal.forEach(name => {
    assert.strictEqual(hasUnparsedTypeSuffix(splitHealTaskName(name)), false, name);
  });
});

test('后缀保护：客户名里带「设计院」「项目设计」不会被误判', () => {
  assert.strictEqual(hasUnparsedTypeSuffix(splitHealTaskName('58519>某设计院 [11/26]')), false);
  assert.strictEqual(hasUnparsedTypeSuffix(splitHealTaskName('58519>某 设计院 项目 [11/26]')), false);
});

test('后缀保护：认不出后缀时 buildHealTaskName 返回空串（调用方据此跳过）', () => {
  assert.strictEqual(buildHealTaskName('58519>浙江道衡 设计变更 ECO1234 [11/26]', '58519>新客户', '[12/1]'), '');
  assert.strictEqual(
    buildHealTaskName('58519>浙江道衡 设计变更 FY26-0035 [11/26]', '58519>新客户', '[12/1]'),
    '58519>新客户 设计变更 FY26-0035 [12/1]'
  );
});

test('跳过条目：两种原因的文案与计数分开给', () => {
  const onlyNoGun = buildSkippedSpecEntry('12345', 2);
  assert.strictEqual(onlyNoGun.code, 'NO_GUN_ROWS');
  assert.strictEqual(onlyNoGun.message, NO_GUN_ROWS_MESSAGE);
  assert.strictEqual(onlyNoGun.noGunItemCount, 2);
  assert.strictEqual(onlyNoGun.unparsedItemCount, 0);

  const onlyUnparsed = buildSkippedSpecEntry('12345', { unparsedItemCount: 3 });
  assert.strictEqual(onlyUnparsed.code, 'UNPARSED_TYPE_SUFFIX');
  assert.strictEqual(onlyUnparsed.message, UNPARSED_SUFFIX_MESSAGE);
  assert.strictEqual(onlyUnparsed.noGunItemCount, 0);
  assert.strictEqual(onlyUnparsed.unparsedItemCount, 3);
  assert.strictEqual(onlyUnparsed.itemCount, 0);

  const mixed = buildSkippedSpecEntry('12345', { noGunItemCount: 1, unparsedItemCount: 2 });
  assert.strictEqual(mixed.code, 'NO_GUN_ROWS_AND_UNPARSED');
  assert.strictEqual(mixed.message, MIXED_SKIP_MESSAGE);
});
