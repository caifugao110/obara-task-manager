/**
 * 焊枪台账的规则与常量（纯函数，不碰 React）
 *
 * 分类常量、枪名自动生成规则表、枪名编号的生成/校验/强绑定、序号连续化、表格列定义。
 * 从 pages/GunLedger.tsx 拆出（原文件 4641 行，规则与 4000 行 JSX 混在一处，改规则要翻整份文件）。
 */
import type { GunLedgerData, GunNameRule, GunRow, GunTable } from './types';

// 默认分类（用于排序与删除保护）
export const DEFAULT_CATEGORIES = ['X2C', 'X2C-V2', 'X2C-V3', 'GLOBAL', 'PSW', 'IT', 'ROBOT', 'EQ', 'TOYOTA', 'PROJECTION GUN'];

export const defaultAccessSettings = { enabled: true, allowAdmins: true, allowViewers: false };
export const PLACEHOLDER_COUNT = 10;

export const newRowId = () => `gun-row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// 焊枪名自动生成规则：分类 → 表名 → { prefix, 起始编号, 编号位数 }
export const GUN_NAME_PATTERNS: Record<string, Record<string, { prefix: string; start: number; pad: number }>> = {
  'X2C': {
    'SRTC':         { prefix: 'SRTC-2C',    start: 15000, pad: 5 },
    'SRTX':         { prefix: 'SRTX-2C',    start: 25000, pad: 5 },
    'SRTV':         { prefix: 'SRTV-C',     start: 150,   pad: 4 },
    'SRTC-ALA-DC':  { prefix: 'SRTC-ALDC',  start: 350,   pad: 4 },
    'SRTX-ALA-DC':  { prefix: 'SRTX-ALDC',  start: 300,   pad: 4 },
    'SRTD':         { prefix: 'SRTD-C',     start: 200,   pad: 4 },
    'SRTS':         { prefix: 'SRTS-C',     start: 50,    pad: 4 },
    'BYD-C':        { prefix: 'BRZC-C',     start: 210,   pad: 4 },
    'BYD-X':        { prefix: 'BRXC-X',     start: 540,   pad: 4 },
  },
  'X2C-V2': {
    'C': { prefix: 'SDZC-C', start: 3000, pad: 4 },
    'X': { prefix: 'SDZX-C', start: 4520, pad: 4 },
  },
  'X2C-V3': {
    'C': { prefix: 'SDZC-3C', start: 30450, pad: 5 },
    'X': { prefix: 'SDZX-3C', start: 30500, pad: 5 },
  },
  'GLOBAL': {
    'RBC': { prefix: 'RBC', start: 14050, pad: 5 },
  },
  'TOYOTA': {
    'C01': { prefix: 'C01-C', start: 500,  pad: 4 },
    'C02': { prefix: 'C02-C', start: 1200, pad: 4 },
    'C03': { prefix: 'C03-C', start: 1300, pad: 4 },
    'C04': { prefix: 'C04-C', start: 620,  pad: 4 },
    'C05': { prefix: 'C05-C', start: 180,  pad: 4 },
    'C06': { prefix: 'C06-C', start: 50,   pad: 4 },
    'C07': { prefix: 'C07-C', start: 30,   pad: 4 },
    'C08': { prefix: 'C08-C', start: 10,   pad: 4 },
    'C09': { prefix: 'C09-C', start: 10,   pad: 4 },
    'C10': { prefix: 'C10-C', start: 5,    pad: 4 },
    'X01': { prefix: 'X01-C', start: 30,   pad: 4 },
    'X02': { prefix: 'X02-C', start: 240,  pad: 4 },
    'X03': { prefix: 'X03-C', start: 1420, pad: 4 },
    'X04': { prefix: 'X04-C', start: 700,  pad: 4 },
    'X05': { prefix: 'X05-C', start: 380,  pad: 4 },
    'X06': { prefix: 'X06-C', start: 200,  pad: 4 },
    'X07': { prefix: 'X07-C', start: 180,  pad: 4 },
    'X08': { prefix: 'X08-C', start: 210,  pad: 4 },
    'X09': { prefix: 'X09-C', start: 120,  pad: 4 },
    'X10': { prefix: 'X10-C', start: 50,   pad: 4 },
    'X11': { prefix: 'X11-C', start: 5,    pad: 4 },
    'X12': { prefix: 'X12-C', start: 5,    pad: 4 },
  },
  'PSW': {
    'UC':  { prefix: 'UC-C',  start: 12720, pad: 5 },
    'UX':  { prefix: 'UX-C',  start: 11550, pad: 5 },
    'UCR': { prefix: 'UCR-C', start: 1100,  pad: 4 },
    'UXR': { prefix: 'UXR-C', start: 990,   pad: 4 },
    'NOC': { prefix: 'NOC-C', start: 2170,  pad: 4 },
    'NOX': { prefix: 'NOX-C', start: 2355,  pad: 4 },
  },
  'IT': {
    'PTC':     { prefix: 'PTC-C',   start: 3801,  pad: 4 },
    'PTX':     { prefix: 'PTX-C',   start: 5001,  pad: 4 },
    'PTC-ALC': { prefix: 'PTC-ALC', start: 31,    pad: 4 },
    'PTX-ALC': { prefix: 'PTX-ALC', start: 31,    pad: 4 },
  },
  'ROBOT': {
    'RTC': { prefix: 'RTC-C', start: 2350, pad: 4 },
    'RTX': { prefix: 'RTX-C', start: 2400, pad: 4 },
    'RC':  { prefix: 'RC-C',  start: 25,   pad: 4 },
    'RX':  { prefix: 'RX-C',  start: 35,   pad: 4 },
  },
  'EQ': {
    'PE1':  { prefix: 'PE1-C',  start: 1550, pad: 4 },
    'PE2':  { prefix: 'PE2-C',  start: 250,  pad: 4 },
    'R':    { prefix: 'R-C',    start: 270,  pad: 4 },
    'RR':   { prefix: 'RR-C',   start: 10,   pad: 4 },
    'SEN':  { prefix: 'SEN-C',  start: 150,  pad: 4 },
    'SEU':  { prefix: 'SEU-C',  start: 10,   pad: 4 },
    'SET':  { prefix: 'SET-C',  start: 15,   pad: 4 },
    'STUD': { prefix: 'STUD-C', start: 70,   pad: 4 },
  },
  'PROJECTION GUN': {
    'STEEL': { prefix: 'SRTC-AS', start: 30, pad: 4 },
  },
};

// 表的生效焊枪名规则：优先使用超管在「台账初始化」中保存的表级规则；
// 未配置过的表沿用内置默认规则（按 分类+表名 匹配），无匹配则不自动取号
export const getEffectiveGunNameRule = (category: string, table: GunTable): GunNameRule | null => {
  if (table.gunNameRule) {
    return table.gunNameRule.enabled ? table.gunNameRule : null;
  }
  const pattern = GUN_NAME_PATTERNS[category]?.[table.name];
  return pattern ? { enabled: true, prefix: pattern.prefix, start: pattern.start, pad: pattern.pad } : null;
};

// 根据规则+序号生成焊枪名，无规则（未启用）时返回空串
export const buildGunName = (rule: GunNameRule | null, serialNumber: number): string => {
  if (!rule || !rule.enabled) return '';
  const num = rule.start + (serialNumber - 1);
  return rule.prefix + String(num).padStart(rule.pad, '0');
};

// 焊枪名编号归一化：编号由规则决定（不可修改），前缀与编号之后的后缀都可自由编辑。
// 例：规则编号 15015 时，SRTC-2C15015 / SRTC-2C15015L / SRTC-2C15015-EL / SRTC-2C15015L-WL
// 均视为合法名称——编号位置被自动校正为规则值，前后文字原样保留。
export const normalizeGunNameNumber = (rule: GunNameRule | null, serialNumber: number, rawValue: string): string => {
  const value = String(rawValue ?? '').trim();
  if (!value || !rule || !rule.enabled) return value;
  const expected = String(rule.start + (serialNumber - 1)).padStart(rule.pad, '0');
  const prefix = String(rule.prefix || '');
  // 规则前缀未被改动时，编号必须紧跟在前缀之后；前缀被改过则在整串里定位编号
  const anchored = prefix !== '' && value.startsWith(prefix);
  const from = anchored ? prefix.length : 0;
  const runs = Array.from(value.matchAll(/\d+/g)).filter(m => (m.index ?? 0) >= from);
  if (runs.length) {
    // 优先取位数与规则编号一致的数字段；都没有时取第一个数字段
    const target = runs.find(m => m[0].length === expected.length) || runs[0];
    if (target[0] === expected) return value;
    const start = target.index ?? 0;
    return value.slice(0, start) + expected + value.slice(start + target[0].length);
  }
  // 整串已没有数字（编号被删空）：前缀未变则补回前缀之后，否则追加到末尾
  return anchored ? prefix + expected + value.slice(prefix.length) : value + expected;
};

// 从某行焊枪名中拆出「编号之前的前缀」与「编号之后的后缀」。
// 编号定位逻辑与 normalizeGunNameNumber 完全一致：规则前缀未被改动时编号紧跟其后，
// 前缀被改过则取位数与规则编号一致的数字段（都没有时取第一个数字段）。
// 返回 null 表示无法拆分（焊枪名为空或整串不含数字）。
export const splitGunNameByRule = (rule: GunNameRule, serialNumber: number, name: string): { prefix: string; suffix: string } | null => {
  const value = String(name ?? '').trim();
  if (!value) return null;
  const expected = String(rule.start + (serialNumber - 1)).padStart(rule.pad, '0');
  const rulePrefix = String(rule.prefix || '');
  const anchored = rulePrefix !== '' && value.startsWith(rulePrefix);
  const from = anchored ? rulePrefix.length : 0;
  const runs = Array.from(value.matchAll(/\d+/g)).filter(m => (m.index ?? 0) >= from);
  if (!runs.length) return null;
  const target = runs.find(m => m[0].length === expected.length) || runs[0];
  const start = target.index ?? 0;
  return { prefix: value.slice(0, start), suffix: value.slice(start + target[0].length) };
};

// 打开「台账初始化」弹窗时某张表的规则草稿：已配置的取已配置值，否则预填内置默认
export const buildRuleDraft = (category: string, table: GunTable): GunNameRule => {
  if (table.gunNameRule) return { ...table.gunNameRule };
  const pattern = GUN_NAME_PATTERNS[category]?.[table.name];
  return pattern
    ? { enabled: true, prefix: pattern.prefix, start: pattern.start, pad: pattern.pad }
    : { enabled: false, prefix: '', start: 1, pad: 4 };
};

// 行序号严格按自然顺序连续排列：升序后重新编号为 1..N，杜绝跳号（如 1 直接到 11）
export const renumberRows = (rows: GunRow[]): GunRow[] =>
  [...rows]
    .sort((a, b) => a.serialNumber - b.serialNumber)
    .map((r, i) => ({ ...r, serialNumber: i + 1 }));

// 序号即行位置：不做排序，只把「行在数组里的位置」写回序号（1..N）。
// 焊枪名里的编号由序号决定，所以只要序号不漂移，编号就不会被别的行"顶"走；
// 任何本地改动（新增行、编辑、复制）之后都调用一次，session 内绝不出现序号空洞。
export const applyContiguousSerials = (rows: GunRow[]): GunRow[] =>
  rows.map((r, i) => (r.serialNumber === i + 1 ? r : { ...r, serialNumber: i + 1 }));

// 归一化整份台账：所有表的行序号连续
export const normalizeLedgerSerials = (data: GunLedgerData): GunLedgerData => {
  const categories: GunLedgerData['categories'] = {};
  for (const cat of Object.keys(data.categories || {})) {
    categories[cat] = (data.categories[cat] || []).map(t => ({ ...t, rows: renumberRows(t.rows || []) }));
  }
  return { ...data, categories };
};
export const todayStr = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};

export const COLUMNS: { key: keyof GunRow | 'serialNumber' | 'clear'; label: string; width: string }[] = [
  { key: 'serialNumber', label: '序号', width: 'w-16 min-w-[4rem]' },
  { key: 'gunName', label: '焊枪名', width: 'w-28 min-w-[7rem]' },
  { key: 'customer', label: '客户', width: 'w-[17rem] min-w-[17rem]' },
  { key: 'time', label: '时间', width: 'w-16 min-w-[5rem]' },
  { key: 'responsiblePerson', label: '担当', width: 'w-24 min-w-[6rem]' },
  { key: 'spec', label: '规格', width: 'w-36 min-w-[9rem]' },
  { key: 'remarks', label: '备注', width: 'w-[18rem] min-w-[18rem]' },
  { key: 'clear', label: '操作', width: 'w-20 min-w-[5rem]' },
];
export const EDITABLE_COLS = ['gunName', 'customer', 'time', 'responsiblePerson', 'spec', 'remarks'] as const;
