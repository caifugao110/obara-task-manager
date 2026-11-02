const test = require('node:test');
const assert = require('node:assert');

const { buildScheduleSyncPlan } = require('../../utils/scheduleSync');

// 「同步生产大日程」的比对逻辑回归测试。
// 背景：按钮会把「各产品大日程.xls」四张工作表的有效仕样号写进状态跟踪表，
// 判错「新增/更新」或误清人工字段，都会直接污染生产数据。

const entry = (overrides = {}) => ({
  specNumber: '58249',
  factory: 'O/NJG',
  sheetName: '南京焊钳',
  month: '2026-11',
  clientText: '58249>O/IND_JSW-T2',
  quantity: '8',
  deliveryDate: '2026-11-02',
  shippedCount: 8,
  ...overrides
});

test('表格有、状态跟踪没有 → 新增', () => {
  const { changes, stats } = buildScheduleSyncPlan({
    entries: [entry()],
    items: [],
    specDigits: 5
  });
  assert.strictEqual(stats.added, 1);
  assert.strictEqual(changes[0].action, 'add');
  assert.deepStrictEqual(changes[0].fields, {
    factory: 'O/NJG',
    sheetName: '南京焊钳',
    clientName: '58249>O/IND_JSW-T2',
    quantity: '8',
    deliveryDate: '2026-11-02',
    shippedCount: 8,
    salesPerson: '',
    leader: ''
  });
});

test('两边都有且来源字段一致 → 不变更（不写库）', () => {
  const items = [{
    id: 'a1',
    specNumber: '58249',
    productionPlanMonths: ['2026-11'],
    factory: 'O/NJG',
    sheetName: '南京焊钳',
    clientName: '58249>O/IND_JSW-T2',
    quantity: '8',
    deliveryDate: '2026-11-02',
    shippedCount: 8,
    salesPerson: '李守健'
  }];
  const { stats } = buildScheduleSyncPlan({ entries: [entry()], items, specDigits: 5 });
  assert.strictEqual(stats.unchanged, 1);
  assert.strictEqual(stats.updated, 0);
});

test('来源字段有差异 → 覆盖字段，人工字段保留在原记录上', () => {
  const items = [{
    id: 'a1',
    specNumber: '58249',
    productionPlanMonths: ['2026-11'],
    factory: 'O/NJG',
    sheetName: '南京焊钳',
    clientName: '旧客户名',
    quantity: '5',
    deliveryDate: '2026-11-20',
    shippedCount: 1,
    salesPerson: '李守健',
    leader: '张啸',
    confirmedQuantity: 3
  }];
  const { changes, stats } = buildScheduleSyncPlan({ entries: [entry()], items, specDigits: 5 });
  assert.strictEqual(stats.updated, 1);
  assert.strictEqual(changes[0].action, 'update');
  assert.strictEqual(changes[0].itemId, 'a1');
  // 变更清单只带来源字段（人工字段不会出现在覆盖集合里）
  assert.deepStrictEqual(Object.keys(changes[0].fields).sort(), [
    'clientName', 'deliveryDate', 'factory', 'leader', 'quantity', 'salesPerson', 'sheetName', 'shippedCount'
  ]);
  // 原记录已有营业担当，不会被表格/仕样书值覆盖
  assert.strictEqual(changes[0].fields.salesPerson, '李守健');
  assert.strictEqual(changes[0].fields.leader, '张啸');
});

test('有效仕样号过滤：位数不符、数量为空或 0 的条目都跳过', () => {
  const { stats } = buildScheduleSyncPlan({
    entries: [
      entry({ specNumber: '5824' }),
      entry({ specNumber: '582490' }),
      entry({ specNumber: 'UC/UX' }),
      entry({ quantity: '' }),
      entry({ quantity: '0' })
    ],
    items: [],
    specDigits: 5
  });
  assert.strictEqual(stats.total, 0);
  assert.strictEqual(stats.skipped, 5);
});

test('行锁占用中的记录标记为 locked，不进入更新', () => {
  const items = [{
    id: 'a1',
    specNumber: '58249',
    productionPlanMonths: ['2026-11'],
    quantity: '5'
  }];
  const { changes, stats } = buildScheduleSyncPlan({
    entries: [entry()],
    items,
    specDigits: 5,
    isLocked: itemId => itemId === 'a1'
  });
  assert.strictEqual(stats.locked, 1);
  assert.strictEqual(stats.updated, 0);
  assert.strictEqual(changes[0].action, 'locked');
});

test('同一仕样号同一月份重复出现只处理一次，并按月份统计', () => {
  const { stats } = buildScheduleSyncPlan({
    entries: [
      entry(),
      entry({ month: '2026-12' }),
      entry({ month: '2026-11', factory: 'O/SHA' })
    ],
    items: [],
    specDigits: 5
  });
  assert.strictEqual(stats.total, 2);
  assert.deepStrictEqual(stats.months, [
    { month: '2026-11', count: 1 },
    { month: '2026-12', count: 1 }
  ]);
});

test('表格缺客户/纳期时不清空已有值', () => {
  const items = [{
    id: 'a1',
    specNumber: '58249',
    productionPlanMonths: ['2026-11'],
    factory: 'O/NJG',
    sheetName: '南京焊钳',
    clientName: '人工填的客户',
    quantity: '8',
    deliveryDate: '2026-11-02',
    shippedCount: 8
  }];
  const { changes, stats } = buildScheduleSyncPlan({
    entries: [entry({ clientText: '', deliveryDate: '' })],
    items,
    specDigits: 5
  });
  // 客户与纳期保持原值，数量/已发图一致 → 判为不变更
  assert.strictEqual(stats.unchanged, 1);
  assert.strictEqual(changes[0].fields, undefined);
});

test('6 位仕样号配置下按 6 位过滤', () => {
  const { stats } = buildScheduleSyncPlan({
    entries: [entry({ specNumber: '582490' })],
    items: [],
    specDigits: 6
  });
  assert.strictEqual(stats.added, 1);
});

// ─── 营业担当 / 组长自动补全 ───────────────────────────────────────────────────

const RESPONSIBLES = new Map([['58249', { salesPerson: '茅舒' }]]);
const LEADER_RULES = [
  { leader: '张明', members: ['吴露鹭', '茅舒'] }
];
const resolveLeader = (salesPerson) => {
  const rule = LEADER_RULES.find(item => item.members.includes(salesPerson));
  return rule ? rule.leader : '';
};

test('新增时按仕样书带出营业担当，并按组长规则推出组长', () => {
  const { changes, stats } = buildScheduleSyncPlan({
    entries: [entry()],
    items: [],
    specDigits: 5,
    responsibles: RESPONSIBLES,
    resolveLeader
  });
  assert.strictEqual(changes[0].fields.salesPerson, '茅舒');
  assert.strictEqual(changes[0].fields.leader, '张明');
  assert.strictEqual(stats.salesFilled, 1);
  assert.strictEqual(stats.leaderFilled, 1);
  assert.strictEqual(stats.salesMissing, 0);
});

test('已有记录营业担当为空 → 补全并判为更新（表格字段本身没变）', () => {
  const items = [{
    id: 'a1',
    specNumber: '58249',
    productionPlanMonths: ['2026-11'],
    factory: 'O/NJG',
    sheetName: '南京焊钳',
    clientName: '58249>O/IND_JSW-T2',
    quantity: '8',
    deliveryDate: '2026-11-02',
    shippedCount: 8,
    salesPerson: '',
    leader: ''
  }];
  const { changes, stats } = buildScheduleSyncPlan({
    entries: [entry()],
    items,
    specDigits: 5,
    responsibles: RESPONSIBLES,
    resolveLeader
  });
  assert.strictEqual(stats.updated, 1);
  assert.strictEqual(changes[0].fields.salesPerson, '茅舒');
  assert.strictEqual(changes[0].fields.leader, '张明');
});

test('已有营业担当但缺组长 → 只补组长；两者都有 → 不变更', () => {
  const base = {
    id: 'a1',
    specNumber: '58249',
    productionPlanMonths: ['2026-11'],
    factory: 'O/NJG',
    sheetName: '南京焊钳',
    clientName: '58249>O/IND_JSW-T2',
    quantity: '8',
    deliveryDate: '2026-11-02',
    shippedCount: 8
  };
  const { changes, stats } = buildScheduleSyncPlan({
    entries: [entry()],
    items: [{ ...base, salesPerson: '茅舒', leader: '' }],
    specDigits: 5,
    responsibles: RESPONSIBLES,
    resolveLeader
  });
  assert.strictEqual(stats.updated, 1);
  assert.strictEqual(changes[0].fields.salesPerson, '茅舒');
  assert.strictEqual(changes[0].fields.leader, '张明');

  const second = buildScheduleSyncPlan({
    entries: [entry()],
    items: [{ ...base, salesPerson: '茅舒', leader: '张明' }],
    specDigits: 5,
    responsibles: RESPONSIBLES,
    resolveLeader
  });
  assert.strictEqual(second.stats.unchanged, 1);
  assert.strictEqual(second.changes[0].fields, undefined);
});

test('仕样书里拿不到营业担当时留空并计入 salesMissing，不猜测', () => {
  const { changes, stats } = buildScheduleSyncPlan({
    entries: [entry()],
    items: [],
    specDigits: 5,
    responsibles: new Map(),
    resolveLeader
  });
  assert.strictEqual(changes[0].fields.salesPerson, '');
  assert.strictEqual(changes[0].fields.leader, '');
  assert.strictEqual(stats.salesFilled, 0);
  assert.strictEqual(stats.salesMissing, 1);
});

test('行锁中的记录不参与补全（避免覆盖别人正在编辑的行）', () => {
  const items = [{
    id: 'a1',
    specNumber: '58249',
    productionPlanMonths: ['2026-11'],
    quantity: '8',
    salesPerson: ''
  }];
  const { changes, stats } = buildScheduleSyncPlan({
    entries: [entry()],
    items,
    specDigits: 5,
    isLocked: () => true,
    responsibles: RESPONSIBLES,
    resolveLeader
  });
  assert.strictEqual(stats.locked, 1);
  assert.strictEqual(changes[0].action, 'locked');
  assert.strictEqual(stats.salesFilled, 0);
});

test('老记录没有 sheetName → 同步时补上表名（用于按表筛选）', () => {
  // 历史数据建于加入 sheetName 之前：工厂只有 O/NJG，分不出「南京焊钳」与「南京焊钳修改」
  const items = [{
    id: 'a1',
    specNumber: '58249',
    productionPlanMonths: ['2026-11'],
    factory: 'O/NJG',
    clientName: '58249>O/IND_JSW-T2',
    quantity: '8',
    deliveryDate: '2026-11-02',
    shippedCount: 8,
    salesPerson: '茅舒',
    leader: '张明'
  }];
  const { changes, stats } = buildScheduleSyncPlan({
    entries: [entry({ sheetName: '南京焊钳修改' })],
    items,
    specDigits: 5
  });
  assert.strictEqual(stats.updated, 1);
  assert.strictEqual(changes[0].fields.sheetName, '南京焊钳修改');
  // 表名变化不影响工厂与人工字段
  assert.strictEqual(changes[0].fields.factory, 'O/NJG');
  assert.strictEqual(changes[0].fields.salesPerson, '茅舒');
});
