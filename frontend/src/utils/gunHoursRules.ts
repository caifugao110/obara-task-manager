// 默认工时规则：台账表专用规则 → C/X 机型回退规则 → 固定兜底值
// 后端 BUILTIN_TABLE_GUN_HOURS（backend/routes/system.js）与本文件保持一致

export type GunHoursTaskType = 'confirm' | 'design' | 'confirmModify';

export interface GunHoursCell {
  confirm: number;
  confirmModify: number;
  design: number;
}

// 分类 → 表名 → 三种任务类型工时
export type TableGunHoursMap = Record<string, Record<string, GunHoursCell>>;

export interface GunLocation {
  category: string;
  tableName: string;
}

// TOYOTA 分类：C01-C10 同 C01，X01-X12 同 X01
const buildToyotaTableGunHours = (): Record<string, GunHoursCell> => {
  const map: Record<string, GunHoursCell> = {};
  for (let i = 1; i <= 10; i += 1) {
    map[`C${String(i).padStart(2, '0')}`] = { confirm: 1, confirmModify: 1, design: 2 };
  }
  for (let i = 1; i <= 12; i += 1) {
    map[`X${String(i).padStart(2, '0')}`] = { confirm: 1, confirmModify: 1, design: 2.5 };
  }
  return map;
};

// 各分类下每张台账表的专用工时（表名需与焊枪台账实际表名一致）
export const BUILTIN_TABLE_GUN_HOURS: TableGunHoursMap = {
  X2C: {
    SRTC: { confirm: 1.5, confirmModify: 0.5, design: 2.5 },
    SRTX: { confirm: 2, confirmModify: 0.75, design: 3 },
    SRTV: { confirm: 2, confirmModify: 0.75, design: 3 },
    'SRTC-ALA-DC': { confirm: 1.5, confirmModify: 0.5, design: 3 },
    'SRTX-ALA-DC': { confirm: 2, confirmModify: 0.75, design: 3.5 },
    SRTD: { confirm: 3, confirmModify: 1, design: 3 },
    SRTS: { confirm: 2.5, confirmModify: 0.75, design: 3 },
  },
  'X2C-V2': {
    C: { confirm: 1.5, confirmModify: 0.5, design: 2.5 },
    X: { confirm: 2, confirmModify: 0.75, design: 3 },
  },
  'X2C-V3': {
    C: { confirm: 1.5, confirmModify: 0.5, design: 2.5 },
    X: { confirm: 2, confirmModify: 0.75, design: 3 },
  },
  GLOBAL: {
    RBC: { confirm: 2, confirmModify: 0.75, design: 3 },
  },
  PSW: {
    UC: { confirm: 1.5, confirmModify: 0.5, design: 2 },
    UX: { confirm: 2, confirmModify: 0.5, design: 2.5 },
    UCR: { confirm: 1.5, confirmModify: 1, design: 2.5 },
    UXR: { confirm: 2, confirmModify: 1, design: 3 },
    NOC: { confirm: 2, confirmModify: 1.5, design: 2.5 },
    NOX: { confirm: 2, confirmModify: 1.5, design: 3 },
  },
  IT: {
    PTC: { confirm: 1.5, confirmModify: 0.5, design: 2 },
    PTX: { confirm: 1.5, confirmModify: 0.5, design: 2.5 },
    'PTC-ALC': { confirm: 1.5, confirmModify: 0.5, design: 2 },
    'PTX-ALC': { confirm: 1.5, confirmModify: 0.5, design: 2.5 },
  },
  ROBOT: {
    RTC: { confirm: 4, confirmModify: 2, design: 4 },
    RTX: { confirm: 6, confirmModify: 2.5, design: 8 },
    RC: { confirm: 4, confirmModify: 2, design: 4 },
    RX: { confirm: 6, confirmModify: 2.5, design: 8 },
  },
  EQ: {
    PE1: { confirm: 2, confirmModify: 1, design: 3 },
    PE2: { confirm: 2.5, confirmModify: 1.5, design: 4 },
    R: { confirm: 2, confirmModify: 1, design: 3 },
    RR: { confirm: 2.5, confirmModify: 1.5, design: 4 },
    SEN: { confirm: 2, confirmModify: 1, design: 3 },
    SEU: { confirm: 2, confirmModify: 1, design: 3 },
    SET: { confirm: 2, confirmModify: 1, design: 3 },
    STUD: { confirm: 2, confirmModify: 1, design: 3 },
  },
  TOYOTA: buildToyotaTableGunHours(),
};

// 专用规则、C/X 回退都未命中时的固定兜底工时
export const FALLBACK_GUN_HOURS: GunHoursCell = {
  confirm: 2,
  confirmModify: 0.75,
  design: 3,
};

export const GUN_HOURS_TASK_LABELS: { key: GunHoursTaskType; label: string }[] = [
  { key: 'confirm', label: '确认图' },
  { key: 'confirmModify', label: '确认图修改' },
  { key: 'design', label: '设计' },
];

// 设计变更 / 既制审图：固定的任务级工时，不区分枪名机型 C/X，也不套用任何表专用规则
export type ExtraTaskHoursType = 'designChange' | 'drawingReview';

export interface ExtraTaskHours {
  designChange: number;
  drawingReview: number;
}

export const DEFAULT_EXTRA_TASK_HOURS: ExtraTaskHours = {
  designChange: 1.5,
  drawingReview: 0.5,
};

export const EXTRA_TASK_HOURS_LABELS: { key: ExtraTaskHoursType; label: string }[] = [
  { key: 'designChange', label: '设计变更' },
  { key: 'drawingReview', label: '既制审图' },
];

// 从枪名提取机型标识：枪名首个「-」前的字符（SRTC->C, SRTX->X, SRTV->V...）
export const getGunTypeFromName = (gunName: string): 'C' | 'X' | null => {
  const name = String(gunName || '').trim();
  const dashIdx = name.indexOf('-');
  if (dashIdx <= 0) return null;
  const ch = name.charAt(dashIdx - 1).toUpperCase();
  return ch === 'C' || ch === 'X' ? ch : null;
};

const isFiniteHours = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

// 某张表的内置专用工时（无内置规则返回 null）
export const getBuiltinTableGunHours = (category: string, tableName: string): GunHoursCell | null => {
  const cell = BUILTIN_TABLE_GUN_HOURS[category]?.[tableName];
  return cell ? { ...cell } : null;
};

// 某张表在「内置值 + 超管覆盖值」合并后的专用工时；未配置返回 null
export const getEffectiveTableGunHours = (
  tableGunHours: TableGunHoursMap | undefined,
  category: string,
  tableName: string
): GunHoursCell | null => {
  const configured = tableGunHours?.[category]?.[tableName];
  if (configured && ['confirm', 'confirmModify', 'design'].every(k => isFiniteHours(configured[k as keyof GunHoursCell]))) {
    return { ...configured };
  }
  return getBuiltinTableGunHours(category, tableName);
};

interface DefaultGunHoursLike {
  confirm?: { C?: number; X?: number };
  design?: { C?: number; X?: number };
  confirmModify?: { C?: number; X?: number };
}

/**
 * 解析某个枪名在指定任务类型下的默认工时，取值优先级：
 * 1. 枪名所在台账表的专用规则；
 * 2. 枪名机型 C/X 的回退规则（defaultGunHours）；
 * 3. 固定兜底（确认图 2 / 确认图修改 0.75 / 设计 3）。
 * 非三类任务返回 null（不自动填充）。
 */
export const resolveGunHours = (
  taskType: string,
  gunName: string,
  location: GunLocation | null | undefined,
  settings: {
    tableGunHours?: TableGunHoursMap;
    defaultGunHours?: DefaultGunHoursLike;
  }
): number | null => {
  if (taskType !== 'confirm' && taskType !== 'design' && taskType !== 'confirmModify') return null;

  if (location) {
    const cell = settings.tableGunHours?.[location.category]?.[location.tableName];
    if (cell && isFiniteHours(cell[taskType])) return cell[taskType];
  }

  const gunType = getGunTypeFromName(gunName);
  if (gunType) {
    const configured = settings.defaultGunHours?.[taskType]?.[gunType];
    if (isFiniteHours(configured)) return configured;
  }

  return FALLBACK_GUN_HOURS[taskType];
};

/**
 * 解析「设计变更 / 既制审图」的固定工时：
 * 只取系统设置中的一个数值，不区分 C/X、不套用任何表专用规则；非这两类返回 null。
 */
export const resolveExtraTaskHours = (
  taskType: string,
  settings: { extraTaskHours?: Partial<ExtraTaskHours> }
): number | null => {
  if (taskType !== 'designChange' && taskType !== 'drawingReview') return null;
  const configured = settings.extraTaskHours?.[taskType];
  return isFiniteHours(configured) ? configured : DEFAULT_EXTRA_TASK_HOURS[taskType];
};

/**
 * 解析某个枪名在指定任务类型下的自动填充工时（按枪名逐个填充时使用）：
 * 设计变更 / 既制审图 → 固定工时；确认图 / 确认图修改 / 设计 → 表专用规则 → C/X 回退 → 兜底。
 */
export const resolveAutoFillHours = (
  taskType: string,
  gunName: string,
  location: GunLocation | null | undefined,
  settings: {
    tableGunHours?: TableGunHoursMap;
    defaultGunHours?: DefaultGunHoursLike;
    extraTaskHours?: Partial<ExtraTaskHours>;
  }
): number | null => {
  const extra = resolveExtraTaskHours(taskType, settings);
  if (extra !== null) return extra;
  return resolveGunHours(taskType, gunName, location, settings);
};
