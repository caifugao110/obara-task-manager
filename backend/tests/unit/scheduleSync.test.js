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

// ─── 跨月份认领 + 旧月份遗留行清理 ───────────────────────────────────────────
// 现场问题：大日程按月份块组织，订单改期后会从 11 月块挪到 12 月块。
// 若只按「仕样号 + 月份」判等，每次挪动都会新增一行、旧行永远留在原月份，
// 页面上就会出现两行一模一样（同仕样号、同纳期、同数量）的记录。

test('同仕样号同纳期的旧月份记录 → 顺延到新月份，不再新增重复行', () => {
  const items = [{
    id: 'old',
    specNumber: '58073',
    productionPlanMonths: ['2026-09'],
    factory: 'O/SHA',
    sheetName: '上海焊钳',
    clientName: '58073>旧客户名',
    quantity: '12',
    deliveryDate: '2026-11-05',
    shippedCount: 12,
    salesPerson: '吴露鹭',
    leader: '张明'
  }];
  const { changes, stats, cleanup } = buildScheduleSyncPlan({
    entries: [entry({ specNumber: '58073', factory: 'O/SHA', month: '2026-11', quantity: '12', deliveryDate: '2026-11-05', shippedCount: 12 })],
    items,
    specDigits: 5
  });
  assert.strictEqual(stats.added, 0);
  assert.strictEqual(stats.updated, 1);
  assert.strictEqual(stats.moved, 1);
  assert.strictEqual(changes[0].action, 'update');
  assert.strictEqual(changes[0].itemId, 'old');
  assert.strictEqual(changes[0].moveMonth, true);
  // 认领过的记录不能再当遗留行清掉
  assert.strictEqual(cleanup.removals.length, 0);
});

test('纳期也变了的旧记录不认领（保守策略）→ 新增一行，旧行进入清理计划', () => {
  const items = [{
    id: 'old',
    specNumber: '58073',
    productionPlanMonths: ['2026-09'],
    quantity: '12',
    deliveryDate: '2026-11-05',
    salesPerson: '吴露鹭'
  }];
  const { changes, stats, cleanup } = buildScheduleSyncPlan({
    entries: [entry({ specNumber: '58073', month: '2026-11', quantity: '12', deliveryDate: '2026-11-20' })],
    items,
    specDigits: 5
  });
  assert.strictEqual(stats.added, 1);
  assert.strictEqual(stats.moved, 0);
  // 旧行已被新月份记录取代，同仕样号仍在表里 → 清理
  assert.strictEqual(cleanup.removals.length, 1);
  assert.strictEqual(cleanup.removals[0].id, 'old');
  assert.deepStrictEqual(cleanup.removals[0].months, ['2026-09']);
  assert.strictEqual(changes[0].action, 'add');
});

test('清理遗留行时把旧行的人工字段并到保留行', () => {
  const items = [
    {
      id: 'live',
      specNumber: '57639',
      productionPlanMonths: ['2026-11'],
      quantity: '21',
      deliveryDate: '2026-11-16',
      shippedCount: 21,
      salesPerson: '',
      leader: '',
      confirmedQuantity: 0,
      feedbackPlan: ''
    },
    {
      id: 'stale',
      specNumber: '57639',
      productionPlanMonths: ['2026-10'],
      quantity: '21',
      deliveryDate: '2026-11-16',
      shippedCount: 0,
      salesPerson: '许华俊',
      leader: '张明',
      confirmedQuantity: 5,
      feedbackPlan: '3号反馈'
    }
  ];
  const { cleanup } = buildScheduleSyncPlan({
    entries: [entry({ specNumber: '57639', month: '2026-11', quantity: '21', deliveryDate: '2026-11-16', shippedCount: 21 })],
    items,
    specDigits: 5
  });
  assert.strictEqual(cleanup.removals.length, 1);
  assert.strictEqual(cleanup.removals[0].id, 'stale');
  const merge = cleanup.merges.find(m => m.fromId === 'stale');
  assert.ok(merge, '应生成从旧行到保留行的字段合并');
  assert.strictEqual(merge.targetId, 'live');
  assert.strictEqual(merge.fields.salesPerson, '许华俊');
  assert.strictEqual(merge.fields.leader, '张明');
  assert.strictEqual(merge.fields.confirmedQuantity, 5);
  assert.strictEqual(merge.fields.feedbackPlan, '3号反馈');
});

test('保留行已有的人工字段不会被旧行覆盖', () => {
  const items = [
    { id: 'live', specNumber: '58073', productionPlanMonths: ['2026-11'], quantity: '12', deliveryDate: '2026-11-05', salesPerson: '吴露鹭', confirmedQuantity: 8 },
    { id: 'stale', specNumber: '58073', productionPlanMonths: ['2026-09'], quantity: '12', deliveryDate: '2026-11-05', salesPerson: '别人', confirmedQuantity: 3 }
  ];
  const { cleanup } = buildScheduleSyncPlan({
    entries: [entry({ specNumber: '58073', month: '2026-11', quantity: '12', deliveryDate: '2026-11-05' })],
    items,
    specDigits: 5
  });
  assert.strictEqual(cleanup.removals.length, 1);
  const merge = cleanup.merges.find(m => m.fromId === 'stale');
  // 保留行已有值，不做任何合并
  assert.strictEqual(merge, undefined);
});

test('仕样号已完全不在大日程里 → 遗留行保留（历史数据，不清）', () => {
  const items = [
    { id: 'a1', specNumber: '57419', productionPlanMonths: ['2026-07'], quantity: '7', deliveryDate: '2026-08-18', salesPerson: '旧担当' },
    { id: 'a2', specNumber: '57419', productionPlanMonths: ['2026-08'], quantity: '7', deliveryDate: '2026-08-18' }
  ];
  const { cleanup, stats } = buildScheduleSyncPlan({
    entries: [entry({ specNumber: '58249', month: '2026-11' })],
    items,
    specDigits: 5
  });
  assert.strictEqual(cleanup.removals.length, 0);
  assert.strictEqual(cleanup.merges.length, 0);
  assert.strictEqual(stats.cleanupRemoved, 0);
});

test('本次新增行的仕样号有旧行时，旧行人工字段并到新行（targetKey 定位）', () => {
  const items = [{
    id: 'old',
    specNumber: '58249',
    productionPlanMonths: ['2026-09'],
    quantity: '8',
    deliveryDate: '2026-09-30',
    salesPerson: '许华俊',
    leader: '张明'
  }];
  const { changes, cleanup } = buildScheduleSyncPlan({
    entries: [entry({ month: '2026-11', deliveryDate: '2026-11-02' })],
    items,
    specDigits: 5
  });
  assert.strictEqual(changes[0].action, 'add');
  assert.strictEqual(cleanup.removals.length, 1);
  assert.strictEqual(cleanup.removals[0].id, 'old');
  const merge = cleanup.merges.find(m => m.fromId === 'old');
  assert.ok(merge, '应生成到新增行的字段合并');
  assert.strictEqual(merge.targetKey, '58249__2026-11');
  assert.strictEqual(merge.fields.salesPerson, '许华俊');
});

test('保留行被行锁占用时遗留行先留着（人工字段没地方并）', () => {
  const items = [
    { id: 'live', specNumber: '58073', productionPlanMonths: ['2026-11'], quantity: '12', deliveryDate: '2026-11-05', salesPerson: '' },
    { id: 'stale', specNumber: '58073', productionPlanMonths: ['2026-09'], quantity: '12', deliveryDate: '2026-11-05', salesPerson: '吴露鹭' }
  ];
  const { cleanup } = buildScheduleSyncPlan({
    entries: [entry({ specNumber: '58073', month: '2026-11', quantity: '12', deliveryDate: '2026-11-05' })],
    items,
    specDigits: 5,
    isLocked: itemId => itemId === 'live'
  });
  assert.strictEqual(cleanup.removals.length, 0);
});

test('行锁中的遗留行不清（等下次同步再处理）', () => {
  const items = [
    { id: 'live', specNumber: '58073', productionPlanMonths: ['2026-11'], quantity: '12', deliveryDate: '2026-11-05' },
    { id: 'stale', specNumber: '58073', productionPlanMonths: ['2026-09'], quantity: '12', deliveryDate: '2026-11-05' }
  ];
  const { cleanup } = buildScheduleSyncPlan({
    entries: [entry({ specNumber: '58073', month: '2026-11', quantity: '12', deliveryDate: '2026-11-05' })],
    items,
    specDigits: 5,
    isLocked: itemId => itemId === 'stale'
  });
  assert.strictEqual(cleanup.removals.length, 0);
});
