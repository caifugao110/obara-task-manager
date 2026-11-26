import { describe, expect, it } from 'vitest'
import {
  BUILTIN_TABLE_GUN_HOURS,
  DEFAULT_EXTRA_TASK_HOURS,
  FALLBACK_GUN_HOURS,
  getBuiltinTableGunHours,
  getEffectiveTableGunHours,
  getGunTypeFromName,
  resolveAutoFillHours,
  resolveExtraTaskHours,
  resolveGunHours,
  type GunHoursCell,
} from '../gunHoursRules'

/**
 * 工时规则是「算错直接影响工资」的那类纯函数，优先级高于一切 UI 测试。
 * 这里锁的行为全部来自 gunHoursRules.ts 的取值优先级：
 * 表专用规则 → C/X 机型回退 → 固定兜底。
 */

const CELL_KEYS: (keyof GunHoursCell)[] = ['confirm', 'confirmModify', 'design']

describe('getGunTypeFromName', () => {
  it('取首个「-」前一个字符作为机型', () => {
    expect(getGunTypeFromName('SRTC-01')).toBe('C')
    expect(getGunTypeFromName('SRTX-01-A')).toBe('X')
  })

  it('机型判断不区分大小写', () => {
    expect(getGunTypeFromName('srtc-01')).toBe('C')
    expect(getGunTypeFromName('srtx-01')).toBe('X')
  })

  it('首个「-」前的字符不是 C/X 时返回 null（SRTV 是 V）', () => {
    expect(getGunTypeFromName('SRTV-01')).toBeNull()
    expect(getGunTypeFromName('PE1-01')).toBeNull()
    expect(getGunTypeFromName('STUD-01')).toBeNull()
  })

  it('取的是短横线前一个字符，不是首字母（RTC 会被判成 C 机型）', () => {
    // 记录这个容易误判的行为：判断依据是「-」前的字符，不是名称首字母
    expect(getGunTypeFromName('RTC-01')).toBe('C')
    expect(getGunTypeFromName('RC-01')).toBe('C')
  })

  it('没有「-」或以「-」开头时返回 null', () => {
    expect(getGunTypeFromName('SRTC01')).toBeNull()
    expect(getGunTypeFromName('-SRTC')).toBeNull()
  })

  it('空值与前后空格不会抛错', () => {
    expect(getGunTypeFromName('')).toBeNull()
    expect(getGunTypeFromName('  SRTC-01  ')).toBe('C')
    // @ts-expect-error 故意传 null，验证运行期兜底
    expect(getGunTypeFromName(null)).toBeNull()
  })

  it('首字符就是机型也能识别（C-1 / X-1）', () => {
    expect(getGunTypeFromName('C-1')).toBe('C')
    expect(getGunTypeFromName('X-1')).toBe('X')
  })
})

describe('内置表专用工时表', () => {
  it('每个分类的每张表都配齐三种任务类型，且都是有限正数', () => {
    for (const [category, tables] of Object.entries(BUILTIN_TABLE_GUN_HOURS)) {
      for (const [tableName, cell] of Object.entries(tables)) {
        for (const key of CELL_KEYS) {
          expect(Number.isFinite(cell[key]), `${category}/${tableName}.${key}`).toBe(true)
          expect(cell[key], `${category}/${tableName}.${key} 应为正数`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('TOYOTA 分类 C01~C10 / X01~X12 齐全且按机型区分设计工时', () => {
    const toyota = BUILTIN_TABLE_GUN_HOURS.TOYOTA
    expect(Object.keys(toyota)).toHaveLength(22)
    expect(toyota.C01).toEqual({ confirm: 1, confirmModify: 1, design: 2 })
    expect(toyota.C10.design).toBe(2)
    expect(toyota.X01).toEqual({ confirm: 1, confirmModify: 1, design: 2.5 })
    expect(toyota.X12.design).toBe(2.5)
  })

  it('getBuiltinTableGunHours 命中返回副本，未命中返回 null', () => {
    const cell = getBuiltinTableGunHours('X2C', 'SRTC')
    expect(cell).toEqual({ confirm: 1.5, confirmModify: 0.5, design: 2.5 })
    // 返回副本：调用方改了不能污染内置常量
    cell!.confirm = 99
    expect(BUILTIN_TABLE_GUN_HOURS.X2C.SRTC.confirm).toBe(1.5)

    expect(getBuiltinTableGunHours('X2C', '不存在的表')).toBeNull()
    expect(getBuiltinTableGunHours('不存在的分类', 'SRTC')).toBeNull()
  })
})

describe('getEffectiveTableGunHours', () => {
  it('超管配置完整时覆盖内置值', () => {
    const configured = { X2C: { SRTC: { confirm: 9, confirmModify: 8, design: 7 } } }
    expect(getEffectiveTableGunHours(configured, 'X2C', 'SRTC')).toEqual({
      confirm: 9,
      confirmModify: 8,
      design: 7,
    })
  })

  it('配置缺字段（非法）时回退内置值，而不是拿半截配置凑数', () => {
    const configured = { X2C: { SRTC: { confirm: 9 } } } as any
    expect(getEffectiveTableGunHours(configured, 'X2C', 'SRTC')).toEqual({
      confirm: 1.5,
      confirmModify: 0.5,
      design: 2.5,
    })
  })

  it('配置里塞了字符串/NaN 也回退内置值', () => {
    const configured = { X2C: { SRTC: { confirm: '9', confirmModify: Number.NaN, design: 7 } } } as any
    expect(getEffectiveTableGunHours(configured, 'X2C', 'SRTC')).toEqual(BUILTIN_TABLE_GUN_HOURS.X2C.SRTC)
  })

  it('既无配置也无内置规则时返回 null', () => {
    expect(getEffectiveTableGunHours(undefined, 'X2C', 'SRTC')).toEqual(BUILTIN_TABLE_GUN_HOURS.X2C.SRTC)
    expect(getEffectiveTableGunHours(undefined, 'PSW', '不存在的表')).toBeNull()
  })
})

describe('resolveGunHours：表规则 → C/X 回退 → 兜底', () => {
  const location = { category: 'X2C', tableName: 'SRTC' }

  it('表专用规则优先级最高（即使机型回退也配了别的值）', () => {
    const settings = {
      tableGunHours: { X2C: { SRTC: { confirm: 4, confirmModify: 3, design: 2 } } },
      defaultGunHours: { confirm: { C: 1, X: 1 } },
    }
    expect(resolveGunHours('confirm', 'SRTC-01', location, settings)).toBe(4)
    expect(resolveGunHours('design', 'SRTC-01', location, settings)).toBe(2)
  })

  it('没有表规则时按机型走 defaultGunHours', () => {
    const settings = { defaultGunHours: { confirm: { C: 1.25, X: 2.5 } } }
    expect(resolveGunHours('confirm', 'SRTC-01', { category: 'X2C', tableName: '未配置表' }, settings)).toBe(1.25)
    expect(resolveGunHours('confirm', 'SRTX-01', { category: 'X2C', tableName: '未配置表' }, settings)).toBe(2.5)
  })

  it('location 为空时直接走机型回退', () => {
    const settings = { defaultGunHours: { design: { C: 2, X: 3.5 } } }
    expect(resolveGunHours('design', 'SRTC-01', null, settings)).toBe(2)
    expect(resolveGunHours('design', 'SRTX-01', undefined, settings)).toBe(3.5)
  })

  it('机型识别不出、也没有表规则时用固定兜底', () => {
    expect(resolveGunHours('confirm', 'SRTV-01', null, {})).toBe(FALLBACK_GUN_HOURS.confirm)
    expect(resolveGunHours('confirmModify', '无名枪', null, {})).toBe(FALLBACK_GUN_HOURS.confirmModify)
    expect(resolveGunHours('design', '', null, {})).toBe(FALLBACK_GUN_HOURS.design)
  })

  it('机型回退值非法时继续落到兜底', () => {
    const settings = { defaultGunHours: { confirm: { C: Number.NaN } } }
    expect(resolveGunHours('confirm', 'SRTC-01', null, settings)).toBe(FALLBACK_GUN_HOURS.confirm)
    // @ts-expect-error 故意传字符串，模拟历史脏数据
    expect(resolveGunHours('confirm', 'SRTC-01', null, { defaultGunHours: { confirm: { C: '1.5' } } }))
      .toBe(FALLBACK_GUN_HOURS.confirm)
  })

  it('非三类工时任务返回 null（不自动填充）', () => {
    for (const taskType of ['paused', 'designChange', 'drawingReview', 'none', '', 'unknown']) {
      expect(resolveGunHours(taskType, 'SRTC-01', location, {})).toBeNull()
    }
  })

  it('表规则只对确切的分类+表名生效，不跨分类误命中', () => {
    const settings = { tableGunHours: { X2C: { SRTC: { confirm: 9, confirmModify: 9, design: 9 } } } }
    // PSW 分类下同名表不应命中 X2C 的配置
    expect(resolveGunHours('confirm', 'SRTC-01', { category: 'PSW', tableName: 'SRTC' }, settings))
      .toBe(FALLBACK_GUN_HOURS.confirm)
  })
})

describe('resolveExtraTaskHours', () => {
  it('有配置取配置值（0 也是合法值，不能被当成缺省）', () => {
    expect(resolveExtraTaskHours('designChange', { extraTaskHours: { designChange: 2.5 } })).toBe(2.5)
    expect(resolveExtraTaskHours('designChange', { extraTaskHours: { designChange: 0 } })).toBe(0)
  })

  it('无配置或配置非法时用默认值', () => {
    expect(resolveExtraTaskHours('designChange', {})).toBe(DEFAULT_EXTRA_TASK_HOURS.designChange)
    expect(resolveExtraTaskHours('drawingReview', {})).toBe(DEFAULT_EXTRA_TASK_HOURS.drawingReview)
    expect(resolveExtraTaskHours('drawingReview', { extraTaskHours: { drawingReview: Number.NaN } }))
      .toBe(DEFAULT_EXTRA_TASK_HOURS.drawingReview)
  })

  it('非固定工时任务返回 null', () => {
    expect(resolveExtraTaskHours('confirm', {})).toBeNull()
    expect(resolveExtraTaskHours('paused', {})).toBeNull()
  })
})

describe('resolveAutoFillHours', () => {
  it('设计变更/既制审图走固定工时，不套表规则也不区分 C/X', () => {
    const settings = {
      tableGunHours: { X2C: { SRTC: { confirm: 9, confirmModify: 9, design: 9 } } },
      extraTaskHours: { designChange: 1.75 },
    }
    expect(resolveAutoFillHours('designChange', 'SRTC-01', { category: 'X2C', tableName: 'SRTC' }, settings)).toBe(1.75)
    expect(resolveAutoFillHours('drawingReview', 'SRTX-01', null, settings))
      .toBe(DEFAULT_EXTRA_TASK_HOURS.drawingReview)
  })

  it('三类工时任务仍走「表规则 → C/X → 兜底」', () => {
    const settings = { defaultGunHours: { confirm: { C: 1.25 } } }
    expect(resolveAutoFillHours('confirm', 'SRTC-01', null, settings)).toBe(1.25)
    expect(resolveAutoFillHours('confirm', 'SRTV-01', null, settings)).toBe(FALLBACK_GUN_HOURS.confirm)
  })

  it('非工时任务仍然返回 null', () => {
    expect(resolveAutoFillHours('paused', 'SRTC-01', null, {})).toBeNull()
  })
})
