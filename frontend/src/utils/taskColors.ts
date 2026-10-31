/**
 * 任务内容配色体系（全项目唯一颜色来源）
 *
 * 规则：
 * 1. 任务单元格（含枪名行）底色 = 任务内容对应的颜色；
 * 2. 未勾选任务内容（无类型后缀）= 深紫；
 * 3. 任务文字统一黑色（固定，不参与配置）；
 * 4. 只有「确认图 / 设计 / 确认图修改」支持「任务加急」：勾选后底色改用加急配色、整行文字变红；
 *    「设计变更 / 既制审图 / 暂停/取消」没有加急状态；
 * 5. 任务被标记为「已完成」（白色）时保留白色底，不参与配色派生；
 * 6. 「暂停/取消」是与上述五个任务内容并列的独立选项（不是既制审图的子状态）：
 *    任务名后缀为「暂停/取消」，整行使用更深的红色底 + 黑字。工时沿用切换前的内容
 *    （新增时默认 0），0 也能保存，不为 0 时与普通任务一样计入工时统计。
 *
 * 超管可在「系统设置 → 计划管理」中修改全部色值，并可一键恢复默认。
 */

export type TaskContentType =
  | 'none'
  | 'confirm'
  | 'design'
  | 'confirmModify'
  | 'designChange'
  | 'drawingReview'
  | 'paused';

/** 普通任务文字色（固定） */
export const TASK_TEXT_COLOR = '#000000';
/** 加急任务文字色（固定） */
export const TASK_URGENT_TEXT_COLOR = '#dc2626';

/** 「暂停/取消」任务名后缀（勾选后拼在任务内容后面） */
export const PAUSED_TASK_SUFFIX = '暂停/取消';
/** 「暂停/取消」的默认底色（纯红，辨识度最高） */
export const PAUSED_TASK_COLOR = '#ff0000';
export const PAUSED_TASK_TEXT_COLOR = TASK_TEXT_COLOR;

/**
 * 出差任务的固定配色（与任务内容配色体系无关，避免和其它任务内容撞色）
 * 湖水青：在「设计」浅黄与「天蓝」之间空出的青绿色区间取饱和一档，
 * 既不像灰色那样淡到看不出，也不会和确认图淡绿 / 既制审图天蓝混淆
 */
export const TRIP_TASK_COLOR = '#5eead4';
export const TRIP_TASK_TEXT_COLOR = '#115e59';

/** 请假/出差行的固定配色（不参与任务内容配色体系） */
export const LEAVE_ROW_COLORS: Record<'sick' | 'vacation' | 'illness' | 'trip', { bg: string; text?: string }> = {
  sick: { bg: '#fee2e2' },
  vacation: { bg: '#dbeafe' },
  illness: { bg: '#fce7f3' },
  trip: { bg: TRIP_TASK_COLOR, text: TRIP_TASK_TEXT_COLOR },
};

/** 非请假/出差返回 null，调用方回退到任务内容配色 */
export const getLeaveRowColors = (leaveType?: string | null) =>
  leaveType && (leaveType in LEAVE_ROW_COLORS)
    ? LEAVE_ROW_COLORS[leaveType as keyof typeof LEAVE_ROW_COLORS]
    : null;

export interface TaskColorConfig {
  /** 未勾选任务内容：深紫 */
  default: string;
  /** 确认图：淡绿 */
  confirm: string;
  /** 设计：浅黄 */
  design: string;
  /** 确认图修改：浅蓝 */
  confirmModify: string;
  /** 设计变更：橙红 */
  designChange: string;
  /** 既制审图：粉色 */
  drawingReview: string;
  /** 暂停/取消：纯红（工时沿用当前值，0 也能保存；不为 0 时计入统计） */
  paused: string;
  /** 加急 + 确认图：亮黄 */
  urgentConfirm: string;
  /** 加急 + 设计：亮黄 */
  urgentDesign: string;
  /** 加急 + 确认图修改：亮黄 */
  urgentConfirmModify: string;
}

export const DEFAULT_TASK_COLOR_CONFIG: TaskColorConfig = {
  default: '#d8b4fe',
  confirm: '#bbf7d0',
  design: '#fef9c3',
  // 确认图修改：浅蓝
  confirmModify: '#bae6fd',
  designChange: '#fdba74',
  // 既制审图：粉
  drawingReview: '#fbcfe8',
  // 暂停/取消：纯红（比普通红底更深，加强辨识度）
  paused: PAUSED_TASK_COLOR,
  // 确认图 / 确认图修改 加急统一用亮黄，与加急设计保持一致
  urgentConfirm: '#ffff00',
  urgentDesign: '#ffff00',
  urgentConfirmModify: '#ffff00',
};

export interface TaskColorFieldMeta {
  key: keyof TaskColorConfig;
  label: string;
  hint: string;
  group: 'normal' | 'urgent';
}

/** 系统设置界面按此顺序渲染配色卡片 */
export const TASK_COLOR_FIELDS: TaskColorFieldMeta[] = [
  { key: 'default', label: '未勾选任务内容', hint: '未勾选任何任务内容时的表格底色', group: 'normal' },
  { key: 'confirm', label: '确认图', hint: '勾选「确认图」时的表格底色', group: 'normal' },
  { key: 'design', label: '设计', hint: '勾选「设计」时的表格底色', group: 'normal' },
  { key: 'confirmModify', label: '确认图修改', hint: '勾选「确认图修改」时的表格底色（默认浅蓝）', group: 'normal' },
  { key: 'designChange', label: '设计变更', hint: '勾选「设计变更」时的表格底色（无加急状态）', group: 'normal' },
  { key: 'drawingReview', label: '既制审图', hint: '勾选「既制审图」时的表格底色（无加急状态，默认粉）', group: 'normal' },
  { key: 'paused', label: '暂停/取消', hint: '勾选「暂停/取消」时的表格底色（默认纯红；工时沿用切换前的值，0 也能保存，不为 0 时计入统计）', group: 'normal' },
  { key: 'urgentConfirm', label: '加急 · 确认图', hint: '加急任务的确认图底色，默认与加急设计同为亮黄（文字同时变红）', group: 'urgent' },
  { key: 'urgentDesign', label: '加急 · 设计', hint: '加急任务的设计底色，默认亮黄（文字同时变红）', group: 'urgent' },
  { key: 'urgentConfirmModify', label: '加急 · 确认图修改', hint: '加急任务的确认图修改底色，默认与加急设计同为亮黄（文字同时变红）', group: 'urgent' },
];

/** 任务内容类型（用于勾选框/筛选展示，6 个并列选项） */
export const TASK_CONTENT_TYPES: { key: Exclude<TaskContentType, 'none'>; label: string }[] = [
  { key: 'confirm', label: '确认图' },
  { key: 'design', label: '设计' },
  { key: 'confirmModify', label: '确认图修改' },
  { key: 'designChange', label: '设计变更' },
  { key: 'drawingReview', label: '既制审图' },
  { key: 'paused', label: PAUSED_TASK_SUFFIX },
];

/** 是否已勾选任务内容 */
export const hasTaskContent = (type: TaskContentType) => type !== 'none';

/**
 * 是否支持「任务加急」：只有确认图 / 设计 / 确认图修改 有加急状态，
 * 设计变更 / 既制审图 / 暂停/取消 没有加急状态。
 */
export const supportsUrgent = (type: TaskContentType) =>
  type === 'confirm' || type === 'design' || type === 'confirmModify';

/** 加急后整行文字变红的任务内容（与 supportsUrgent 保持同一批） */
export const isUrgentRestyleType = (type: TaskContentType) => supportsUrgent(type);

const URGENT_KEY: Partial<Record<TaskContentType, keyof TaskColorConfig>> = {
  confirm: 'urgentConfirm',
  design: 'urgentDesign',
  confirmModify: 'urgentConfirmModify',
};

const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const normalizeHexColor = (value: unknown, fallback: string): string => {
  const raw = String(value ?? '').trim();
  if (!HEX_PATTERN.test(raw)) return fallback;
  if (raw.length === 4) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase();
  }
  return raw.toLowerCase();
};

/** 合并服务端配置与默认值：任何缺失/非法字段都回退到默认值 */
export const mergeTaskColorConfig = (raw: unknown): TaskColorConfig => {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const result = { ...DEFAULT_TASK_COLOR_CONFIG };
  (Object.keys(DEFAULT_TASK_COLOR_CONFIG) as (keyof TaskColorConfig)[]).forEach(key => {
    const fallback = DEFAULT_TASK_COLOR_CONFIG[key];
    const value = source[key];
    // 兼容旧结构 { bg, text }：只取其中的 bg
    const candidate = value && typeof value === 'object' ? (value as { bg?: unknown }).bg : value;
    result[key] = normalizeHexColor(candidate, fallback);
  });
  return result;
};

/** 从任务名后缀反推任务内容类型（「暂停/取消」优先级最高） */
export const detectTaskContentType = (taskName?: string | null): TaskContentType => {
  const name = String(taskName || '');
  if (!name) return 'none';
  if (name.includes(PAUSED_TASK_SUFFIX) || name.includes('暂停')) return 'paused';
  if (name.includes('设计变更')) return 'designChange';
  if (name.includes('既制审图')) return 'drawingReview';
  if (name.includes('确认图修改')) return 'confirmModify';
  if (name.includes('确认图')) return 'confirm';
  if (name.includes('设计')) return 'design';
  return 'none';
};

export const isWhiteColor = (value?: string | null) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '#ffffff' || normalized === '#fff' || normalized === 'white';
};

/** 任务内容对应的（非加急）底色 */
const getBaseColor = (config: TaskColorConfig, type: TaskContentType): string => {
  if (type === 'none') return config.default;
  return config[type] || config.default;
};

/**
 * 按「任务内容 + 是否加急」解析配色。
 * 底色来自配置；文字色固定——普通黑色，支持加急的类型加急后为红色。
 */
export const resolveTaskColors = (
  config: TaskColorConfig,
  type: TaskContentType,
  urgent?: boolean
): { bg: string; text: string; urgent: boolean } => {
  // 设计变更 / 既制审图 / 暂停/取消 没有加急状态，传入的 urgent 直接忽略
  if (!urgent || !supportsUrgent(type)) {
    return { bg: getBaseColor(config, type), text: TASK_TEXT_COLOR, urgent: false };
  }
  const bg = config[URGENT_KEY[type] as keyof TaskColorConfig] || getBaseColor(config, type);
  return { bg, text: TASK_URGENT_TEXT_COLOR, urgent: true };
};

export interface TaskDisplayColors {
  /** 单元格底色（已完成任务为白色） */
  bg: string;
  /** 文字颜色（普通黑色，加急红色） */
  text: string;
  /** 是否处于「已完成」白色状态 */
  completed: boolean;
  /** 是否加急任务 */
  urgent: boolean;
  /** 是否「暂停/取消」任务（工时沿用当前值、0 也能保存；不为 0 时计入统计） */
  paused: boolean;
  /** 任务内容类型 */
  type: TaskContentType;
}

/**
 * 是否为「暂停/取消」任务：
 * 任务名带「暂停/取消」后缀（新数据）或持久化了 paused 标记（历史数据）都算。
 */
export const isTaskPaused = (item?: { taskName?: string | null; paused?: boolean } | null) => {
  if (!item) return false;
  if (item.paused) return true;
  return detectTaskContentType(item.taskName) === 'paused';
};

/** 表格渲染用：任务单元格最终显示色（暂停红底 > 已完成白 > 配色体系） */
export const getTaskDisplayColors = (
  config: TaskColorConfig,
  item?: { taskName?: string | null; urgent?: boolean; paused?: boolean; color?: string | null } | null
): TaskDisplayColors => {
  const type = detectTaskContentType(item?.taskName);
  const paused = isTaskPaused(item);
  const urgent = Boolean(item?.urgent) && supportsUrgent(type) && !paused;
  const resolved = resolveTaskColors(config, type, urgent);
  if (paused) {
    return {
      bg: normalizeHexColor(config?.paused, PAUSED_TASK_COLOR),
      text: PAUSED_TASK_TEXT_COLOR,
      completed: false,
      urgent: false,
      paused: true,
      type,
    };
  }
  const completed = isWhiteColor(item?.color);
  if (completed) {
    return { bg: '#ffffff', text: resolved.text, completed: true, urgent, paused: false, type };
  }
  return { bg: resolved.bg, text: resolved.text, completed: false, urgent, paused: false, type };
};

/** 新建任务时写入的颜色（与表格显示一致，保证导出等场景同样正确） */
export const getTaskBaseColor = (config: TaskColorConfig, type: TaskContentType, urgent?: boolean) =>
  type === 'paused'
    ? normalizeHexColor(config?.paused, PAUSED_TASK_COLOR)
    : resolveTaskColors(config, type, urgent).bg;
