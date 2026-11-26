import { describe, expect, it } from 'vitest'
import {
  getEffectiveIsWeekend,
  getWorkdayOverrideLabel,
  normalizeWorkdayOverrides,
  type WorkdayOverrides,
} from '../workdayOverrides'

/**
 * 工作日覆盖决定「某天算不算加班」，直接影响工时统计与报表，
 * 所以脏数据必须被拦在入口，而不是带进统计。
 */
describe('normalizeWorkdayOverrides', () => {
  it('只保留「YYYY-MM-DD → workday/weekend」的合法条目', () => {
    const raw = {
      '2026-01-01': 'workday',
      '2026-01-02': 'weekend',
    }
    expect(normalizeWorkdayOverrides(raw)).toEqual(raw)
  })

  it('丢弃日期格式不对的键', () => {
    expect(normalizeWorkdayOverrides({
      '2026-1-1': 'workday',
      '26-01-01': 'workday',
      '2026/01/01': 'workday',
      '2026-01-01T00:00:00Z': 'workday',
      '': 'workday',
    })).toEqual({})
  })

  it('丢弃取值不在枚举内的条目（含历史拼写错误、布尔值）', () => {
    expect(normalizeWorkdayOverrides({
      '2026-01-01': 'holiday',
      '2026-01-02': true,
      '2026-01-03': null,
      '2026-01-04': 'WORKDAY',
    } as any)).toEqual({})
  })

  it('非对象输入统一返回空对象，不抛错', () => {
    expect(normalizeWorkdayOverrides(null)).toEqual({})
    expect(normalizeWorkdayOverrides(undefined)).toEqual({})
    expect(normalizeWorkdayOverrides('2026-01-01')).toEqual({})
    expect(normalizeWorkdayOverrides(['2026-01-01'])).toEqual({})
    expect(normalizeWorkdayOverrides(42)).toEqual({})
  })

  it('合法与非法混在一起时只留合法的', () => {
    expect(normalizeWorkdayOverrides({
      '2026-01-01': 'workday',
      'bad-key': 'weekend',
      '2026-01-02': 'nope',
    } as any)).toEqual({ '2026-01-01': 'workday' })
  })
})

describe('getEffectiveIsWeekend', () => {
  const overrides: WorkdayOverrides = {
    '2026-01-01': 'workday', // 法定节假日调休上班
    '2026-01-04': 'weekend', // 周日补班之外的调休
  }

  it('设为 workday 时，自然周末也按工作日算', () => {
    expect(getEffectiveIsWeekend('2026-01-01', true, overrides)).toBe(false)
  })

  it('设为 weekend 时，工作日也按周末算', () => {
    expect(getEffectiveIsWeekend('2026-01-04', false, overrides)).toBe(true)
  })

  it('没有覆盖时完全跟随自然星期', () => {
    expect(getEffectiveIsWeekend('2026-01-05', false, overrides)).toBe(false)
    expect(getEffectiveIsWeekend('2026-01-06', true, overrides)).toBe(true)
  })

  it('覆盖表为空时跟随自然星期', () => {
    expect(getEffectiveIsWeekend('2026-01-01', true, {})).toBe(true)
  })
})

describe('getWorkdayOverrideLabel', () => {
  it('按当天自然状态给出「改为另一种」的文案', () => {
    expect(getWorkdayOverrideLabel(true)).toBe('将今日设为普通工作日')
    expect(getWorkdayOverrideLabel(false)).toBe('将今日设为周末加班日')
  })
})
