import { describe, expect, it } from 'vitest'
import {
  buildGunName,
  normalizeGunNameNumber,
  splitGunNameByRule,
  applyContiguousSerials,
  renumberRows,
  getEffectiveGunNameRule,
} from '../rules'
import type { GunNameRule, GunRow, GunTable } from '../types'

/**
 * 从 GunLedger.tsx 拆出来的规则块，锁住的是「编号由规则决定」这条核心约定：
 * 序号一变，枪名里的编号必须跟着变；反过来，用户改前缀/后缀不能把编号改掉。
 * 这类规则出错的表现是「台账编号与图纸对不上」，属于业务事故，所以拆出来就补上测试。
 */
const rule = (over: Partial<GunNameRule> = {}): GunNameRule => ({
  enabled: true,
  prefix: 'SRTC-2C',
  start: 15000,
  pad: 5,
  ...over,
})

const row = (serialNumber: number, gunName: string): GunRow => ({
  id: `r${serialNumber}`,
  serialNumber,
  gunName,
  customer: '',
  time: '',
  responsiblePerson: '',
  spec: '',
  remarks: '',
})

describe('buildGunName', () => {
  it('按「起始编号 + 序号 - 1」生成，位数按 pad 补零', () => {
    expect(buildGunName(rule(), 1)).toBe('SRTC-2C15000')
    expect(buildGunName(rule(), 16)).toBe('SRTC-2C15015')
    expect(buildGunName(rule({ pad: 4, start: 150 }), 1)).toBe('SRTC-2C0150')
  })

  it('规则未启用或为空时返回空串（调用方据此不做自动填充）', () => {
    expect(buildGunName(null, 1)).toBe('')
    expect(buildGunName(rule({ enabled: false }), 1)).toBe('')
  })
})

describe('normalizeGunNameNumber', () => {
  it('编号位置被改错时校正回规则值，前后文字原样保留', () => {
    expect(normalizeGunNameNumber(rule(), 16, 'SRTC-2C15099L')).toBe('SRTC-2C15015L')
    expect(normalizeGunNameNumber(rule(), 16, 'SRTC-2C15099-EL')).toBe('SRTC-2C15015-EL')
  })

  it('编号已正确时原样返回（含后缀）', () => {
    expect(normalizeGunNameNumber(rule(), 16, 'SRTC-2C15015L-WL')).toBe('SRTC-2C15015L-WL')
  })

  it('编号被删空时补回前缀之后', () => {
    expect(normalizeGunNameNumber(rule(), 16, 'SRTC-2C')).toBe('SRTC-2C15015')
    expect(normalizeGunNameNumber(rule(), 16, 'SRTC-2CL')).toBe('SRTC-2C15015L')
  })

  it('规则未启用时不做任何改动', () => {
    expect(normalizeGunNameNumber(rule({ enabled: false }), 16, '随便写的')).toBe('随便写的')
  })
})

describe('splitGunNameByRule', () => {
  it('拆出编号前后的文字', () => {
    expect(splitGunNameByRule(rule(), 16, 'SRTC-2C15015L-WL')).toEqual({ prefix: 'SRTC-2C', suffix: 'L-WL' })
  })

  it('整串不含数字时返回 null', () => {
    expect(splitGunNameByRule(rule(), 16, 'SRTC-2C')).toBeNull()
    expect(splitGunNameByRule(rule(), 16, '')).toBeNull()
  })
})

describe('序号连续化', () => {
  it('renumberRows 先按序号排序再重编号 1..N', () => {
    const rows = [row(5, 'c'), row(1, 'a'), row(9, 'b')]
    expect(renumberRows(rows).map(r => [r.serialNumber, r.gunName])).toEqual([[1, 'a'], [2, 'c'], [3, 'b']])
  })

  it('applyContiguousSerials 不排序，只把行位置写回序号', () => {
    const rows = [row(9, 'a'), row(3, 'b')]
    expect(applyContiguousSerials(rows).map(r => r.serialNumber)).toEqual([1, 2])
  })

  it('序号已经连续时返回同一批对象引用（避免无意义重渲染）', () => {
    const rows = [row(1, 'a'), row(2, 'b')]
    const next = applyContiguousSerials(rows)
    expect(next[0]).toBe(rows[0])
    expect(next[1]).toBe(rows[1])
  })
})

describe('getEffectiveGunNameRule', () => {
  const table = (over: Partial<GunTable> = {}): GunTable => ({ id: 't1', name: 'SRTC', rows: [], ...over })

  it('表上显式配置的规则优先', () => {
    const custom: GunNameRule = { enabled: true, prefix: 'CUSTOM', start: 1, pad: 3 }
    expect(getEffectiveGunNameRule('X2C', table({ gunNameRule: custom }))).toEqual(custom)
  })

  it('表上显式关闭时返回 null，且不回退到内置规则', () => {
    const off: GunNameRule = { enabled: false, prefix: 'X', start: 1, pad: 3 }
    expect(getEffectiveGunNameRule('X2C', table({ gunNameRule: off }))).toBeNull()
  })

  it('未配置时按「分类 + 表名」查内置规则表', () => {
    expect(getEffectiveGunNameRule('X2C', table({ name: 'SRTC' }))?.prefix).toBe('SRTC-2C')
    // 内置表里没有这个组合 → 没有规则，不瞎猜一个
    expect(getEffectiveGunNameRule('X2C', table({ name: '不存在的表' }))).toBeNull()
  })
})
