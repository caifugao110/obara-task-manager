const test = require('node:test');
const assert = require('node:assert');

const { resolveLeader, DEFAULT_LEADER_RULES } = require('../../utils/leaderRules');
const { _private: specLookup } = require('../../utils/specInfoLookup');

test('组长规则：命中成员返回组长，未命中返回空串', () => {
  assert.strictEqual(resolveLeader('茅舒', DEFAULT_LEADER_RULES), '张明');
  assert.strictEqual(resolveLeader('熊飞', DEFAULT_LEADER_RULES), '张啸');
  assert.strictEqual(resolveLeader('孙海山', DEFAULT_LEADER_RULES), '张啸');
  assert.strictEqual(resolveLeader('查无此人', DEFAULT_LEADER_RULES), '');
  assert.strictEqual(resolveLeader('', DEFAULT_LEADER_RULES), '');
});

test('组长规则：前后空格不影响匹配', () => {
  assert.strictEqual(resolveLeader('  茅舒 ', DEFAULT_LEADER_RULES), '张明');
});

test('组长规则：配置为空时回退内置规则', () => {
  assert.strictEqual(resolveLeader('郭涛', []), '陈大仪');
  assert.strictEqual(resolveLeader('郭涛', null), '陈大仪');
});

// 仕样书签核区兜底解析：专用规则未命中时用它取营业担当
test('仕样书签核区：取「最终客户 \\t 营业担当」值行', () => {
  const lines = [
    'SERVO GUN 客户仕样书',
    '2026-11-25\t1',
    '成飞吉文\t肖山',
    '技术审核 营业担当\t营业审核',
    '孙晓冉'
  ];
  assert.deepStrictEqual(specLookup.extractFromSignatureBlock(lines), {
    salesPerson: '肖山',
    finalClient: '成飞吉文'
  });
});

test('仕样书签核区：标签行上一行只有人名时也能取到', () => {
  const lines = [
    '最终客户\t中间商',
    '某客户',
    '吴露鹭',
    '技术审核 营业担当\t营业审核'
  ];
  const result = specLookup.extractFromSignatureBlock(lines);
  assert.strictEqual(result.salesPerson, '吴露鹭');
});

test('仕样书签核区：没有签核区时返回空，不做猜测', () => {
  assert.deepStrictEqual(specLookup.extractFromSignatureBlock(['完全无关的文本', '2026-11-25']), {
    salesPerson: '',
    finalClient: ''
  });
});

test('人名判定排除表单标签', () => {
  assert.strictEqual(specLookup.isPersonName('茅舒'), true);
  assert.strictEqual(specLookup.isPersonName('营业担当'), false);
  assert.strictEqual(specLookup.isPersonName('2026-11-25'), false);
});
