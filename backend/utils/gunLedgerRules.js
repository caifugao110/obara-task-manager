'use strict';
/**
 * 焊枪台账的校验规则与命名规则（Joi schema、枪名编号生成与强绑定）
 *
 * 从 backend/routes/gunLedger.js 拆分而来，代码为原样搬运（未改逻辑）。
 */
const Joi = require('joi');

// 分类名校称校验：1-30 字符，允许中文/英文/数字/连字符/下划线
const categoryNameSchema = Joi.object({
  name: Joi.string().min(1).max(30).required()
});

// 用户元信息：标准形态是对象；兼容历史脏数据（如 "[Circular Reference]" 字符串）与空值
const userMetaSchema = Joi.alternatives().try(Joi.object(), Joi.string().allow(''), null);

const rowSchema = Joi.object({
  id: Joi.string().allow('', null),
  serialNumber: Joi.number().integer().allow(null),
  gunName: Joi.string().allow(''),
  customer: Joi.string().allow(''),
  time: Joi.string().allow(''),
  responsiblePerson: Joi.string().allow(''),
  spec: Joi.string().allow(''),
  remarks: Joi.string().allow(''),
  createdAt: Joi.string().allow('', null),
  createdBy: userMetaSchema,
  updatedAt: Joi.string().allow('', null),
  updatedBy: userMetaSchema
});

const rowsSchema = Joi.array().items(rowSchema);

const tableNameSchema = Joi.object({
  name: Joi.string().min(1).max(50).required()
});

const defaultPersonsSchema = Joi.array().items(Joi.string().min(1)).min(0);

// 默认担当人员名单（系统初始值，可通过"重置为默认人员"恢复）
const DEFAULT_RESPONSIBLE_PERSONS = ['张啸', '张明', '陈青松', '陈大仪', '翟世学', '朱海洋'];

// 焊枪名自动生成规则（台账初始化设置）
const gunNameRuleSchema = Joi.object({
  enabled: Joi.boolean().required(),
  prefix: Joi.string().allow('').max(20).required(),
  start: Joi.number().integer().min(0).max(99999999).required(),
  pad: Joi.number().integer().min(1).max(10).required()
});

// 在 gunLedger.categories 中查找表，返回 { category, table, index }
// 动态遍历所有分类（支持用户新增的分类）
const findTable = (gunLedger, tableId) => {
  const categories = gunLedger?.categories || {};
  for (const cat of Object.keys(categories)) {
    const list = Array.isArray(categories[cat]) ? categories[cat] : [];
    const index = list.findIndex(t => t && t.id === tableId);
    if (index !== -1) {
      return { category: cat, table: list[index], index, list };
    }
  }
  return null;
};

// 确保分类名校称合法（用于 URL 路径参数）：禁止特殊字符
const isValidCategoryName = (name) => {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 30) return false;
  // 禁止路径分隔符与控制字符
  if (/[/\\]/.test(trimmed)) return false;
  return true;
};

const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// 检查一组行内的焊枪名是否有重复（空值不计入），返回 [{ gunName, serialNumbers }]
const findDuplicateGunNames = (rows) => {
  const seen = new Map();
  rows.forEach(r => {
    const name = String(r.gunName || '').trim();
    if (!name) return;
    if (seen.has(name)) {
      seen.get(name).push(r.serialNumber);
    } else {
      seen.set(name, [r.serialNumber]);
    }
  });
  const duplicates = [];
  for (const [gunName, serialNumbers] of seen) {
    if (serialNumbers.length > 1) {
      duplicates.push({ gunName, serialNumbers });
    }
  }
  return duplicates;
};

// 焊枪名自动生成规则（与前端 GunLedger.tsx 的 GUN_NAME_PATTERNS 保持一致）
const GUN_NAME_PATTERNS = {
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

// 获取表的生效焊枪名规则：优先表级 gunNameRule，其次内置默认模式（与前端一致）
const getEffectiveGunNameRule = (category, table) => {
  if (table.gunNameRule) {
    return table.gunNameRule.enabled ? table.gunNameRule : null;
  }
  const pattern = GUN_NAME_PATTERNS[category]?.[table.name];
  return pattern ? { enabled: true, prefix: pattern.prefix, start: pattern.start, pad: pattern.pad } : null;
};

// 焊枪名初始化时将表的取号规则一并恢复为内置默认号段（前缀 + 起始编号 + 编号位数）。
// 仅对有内置默认规则的表生效；无内置默认的表（如用户自建表）保留原规则不动，返回 null。
const resetRuleToDefault = (category, table) => {
  const pattern = GUN_NAME_PATTERNS[category]?.[table.name];
  if (!pattern) return null;
  const rule = { enabled: true, prefix: pattern.prefix, start: pattern.start, pad: pattern.pad };
  table.gunNameRule = rule;
  return rule;
};

// 根据规则+序号计算焊枪名的编号部分（不含前缀）
const buildGunNumber = (rule, serialNumber) => {
  if (!rule || !rule.enabled) return '';
  const num = rule.start + (serialNumber - 1);
  return String(num).padStart(rule.pad, '0');
};

// 焊枪名编号归一化（与前端 GunLedger.tsx 的 normalizeGunNameNumber 完全一致）：
// 编号由规则决定（不可修改），前缀与编号之后的后缀都可自由编辑。
// 例：规则编号 15015 时，SRTC-2C15015 / SRTC-2C15015L / SRTC-2C15015-EL / SRTC-2C15015L-WL
// 均视为合法名称——编号位置被校正为规则值，前后文字原样保留。
const normalizeGunNameNumber = (rule, serialNumber, rawName) => {
  const value = String(rawName ?? '').trim();
  if (!value || !rule || !rule.enabled) return value;
  const expected = buildGunNumber(rule, serialNumber);
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

// 序号 ↔ 编号强绑定（唯一权威实现）：
// 行序号永远等于该行在表中的位置 + 1（连续 1..N，不允许跳号/乱序/被改写），
// 焊枪名里的编号永远等于规则(序号)，改序号就等于改编号，任何入口都不允许。
// 旧版「占位行按任意序号提升」曾写出错位数据（如序号 4 的行挂着序号 6 的编号），
// 表现为同表重号、主页面快速取号算出已存在的编号而 409 冲突，此处一并自愈。
// 校正时只替换编号数字段，前缀与编号之后的后缀（L / -EL / L-WL 等）原样保留；
// 若校正后的名字会被其它行占用，则保留原名——宁可留下历史错位，也绝不制造新的重号。
const enforceSerialNumberBinding = (rule, rows) => {
  const list = Array.isArray(rows) ? rows : [];
  const nameCount = new Map();
  list.forEach(r => {
    const name = String(r?.gunName || '').trim();
    if (name) nameCount.set(name, (nameCount.get(name) || 0) + 1);
  });
  const renamed = [];
  const bound = list.map((row, index) => {
    const serialNumber = index + 1;
    const gunName = String(row?.gunName || '');
    let fixedName = gunName;
    if (rule && rule.enabled && gunName.trim()) {
      const normalized = normalizeGunNameNumber(rule, serialNumber, gunName);
      const target = normalized.trim();
      // 目标名字被别的行占着（含历史重号）：不校正，避免把一个错位换成一场重号
      const takenByOther = target !== gunName.trim() && (nameCount.get(target) || 0) > 0;
      if (!takenByOther) fixedName = normalized;
    }
    if (fixedName !== gunName) renamed.push({ serialNumber, from: gunName, to: fixedName });
    return row && typeof row === 'object'
      ? { ...row, serialNumber, gunName: fixedName }
      : { serialNumber, gunName: fixedName };
  });
  return { rows: bound, renamed };
};

// 按「提交顺序（= 台账页展示顺序）」重排序号后再做绑定校正：
// 先按提交上来的序号升序排序（兼容把新行夹在中间提交的老客户端），再压实为 1..N。
const bindRowsToSerials = (rule, rows) => {
  const ordered = [...(Array.isArray(rows) ? rows : [])]
    .map((row, i) => ({ row, i, serial: Number(row?.serialNumber) }))
    .sort((a, b) => {
      const sa = Number.isFinite(a.serial) ? a.serial : Number.MAX_SAFE_INTEGER;
      const sb = Number.isFinite(b.serial) ? b.serial : Number.MAX_SAFE_INTEGER;
      return sa === sb ? a.i - b.i : sa - sb;
    })
    .map(item => item.row);
  return enforceSerialNumberBinding(rule, ordered);
};

module.exports = {
  categoryNameSchema,
  userMetaSchema,
  rowSchema,
  rowsSchema,
  tableNameSchema,
  defaultPersonsSchema,
  DEFAULT_RESPONSIBLE_PERSONS,
  gunNameRuleSchema,
  findTable,
  isValidCategoryName,
  newId,
  findDuplicateGunNames,
  GUN_NAME_PATTERNS,
  getEffectiveGunNameRule,
  resetRuleToDefault,
  buildGunNumber,
  normalizeGunNameNumber,
  enforceSerialNumberBinding,
  bindRowsToSerials,
};
