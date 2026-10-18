const test = require('node:test');
const assert = require('node:assert');

const {
  OVERRIDE_WORKDAY,
  OVERRIDE_WEEKEND,
  normalizeWorkdayOverrides,
  isNaturalWeekend,
  getEffectiveIsWeekend
} = require('../../utils/workday');

test('isNaturalWeekend 识别周六周日', () => {
  // 2026-09-26 是周六，2026-09-27 是周日，2026-09-28 是周一
  assert.strictEqual(isNaturalWeekend('2026-09-26'), true);
  assert.strictEqual(isNaturalWeekend('2026-09-27'), true);
  assert.strictEqual(isNaturalWeekend('2026-09-28'), false);
});

test('isNaturalWeekend 接受带时间的输入并按日期部分判断', () => {
  assert.strictEqual(isNaturalWeekend('2026-09-26T23:59:59.000Z'), true);
});

test('normalizeWorkdayOverrides 过滤非法键与非法类型', () => {
  const result = normalizeWorkdayOverrides({
    '2026-10-01': OVERRIDE_WORKDAY,
    '2026-10-02': OVERRIDE_WEEKEND,
    'not-a-date': OVERRIDE_WORKDAY,
    '2026-10-03': 'unknown-type',
    '2026-10-04': null
  });
  assert.deepStrictEqual(result, {
    '2026-10-01': OVERRIDE_WORKDAY,
    '2026-10-02': OVERRIDE_WEEKEND
  });
});

test('normalizeWorkdayOverrides 对非对象输入返回空对象', () => {
  assert.deepStrictEqual(normalizeWorkdayOverrides(null), {});
  assert.deepStrictEqual(normalizeWorkdayOverrides(undefined), {});
  assert.deepStrictEqual(normalizeWorkdayOverrides([]), {});
  assert.deepStrictEqual(normalizeWorkdayOverrides('x'), {});
});

test('getEffectiveIsWeekend 覆盖优先于自然周末', () => {
  const overrides = {
    // 周六被调休为工作日
    '2026-09-26': OVERRIDE_WORKDAY,
    // 周一被设为休息日
    '2026-09-28': OVERRIDE_WEEKEND
  };
  assert.strictEqual(getEffectiveIsWeekend('2026-09-26', overrides), false);
  assert.strictEqual(getEffectiveIsWeekend('2026-09-28', overrides), true);
});

test('getEffectiveIsWeekend 无覆盖时回落到自然周末', () => {
  assert.strictEqual(getEffectiveIsWeekend('2026-09-26', {}), true);
  assert.strictEqual(getEffectiveIsWeekend('2026-09-28', {}), false);
  assert.strictEqual(getEffectiveIsWeekend('2026-09-28'), false);
});
