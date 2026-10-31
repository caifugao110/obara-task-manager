/**
 * 任务内容配色体系（后端副本：与前端 src/utils/taskColors.ts 保持一致的默认值）
 *
 * 用于系统设置默认值/归一化，以及导出（Excel/HTML）时按任务内容派生单元格底色，
 * 保证「页面看到的颜色」与「导出的颜色」一致。
 *
 * 文字色固定：普通任务黑色；只有确认图 / 设计 / 确认图修改 支持加急，加急后文字变红。
 * 「设计变更 / 既制审图 / 暂停/取消」没有加急状态。
 * 「暂停/取消」任务名后缀为「暂停/取消」，纯红底、黑字；
 * 工时沿用切换前任务内容的工时（新增时默认 0）、可为 0 保存，不为 0 时与普通任务一样计入工时统计。
 */

const TASK_TEXT_COLOR = '#000000';
const TASK_URGENT_TEXT_COLOR = '#dc2626';
// 「暂停/取消」任务名后缀与默认底色（纯红，不参与加急）
const PAUSED_TASK_SUFFIX = '暂停/取消';
const PAUSED_TASK_COLOR = '#ff0000';
const PAUSED_TASK_TEXT_COLOR = TASK_TEXT_COLOR;
// 出差任务的固定配色（湖水青）：和设计相关配色区分开，避免撞色
const TRIP_TASK_COLOR = '#5eead4';
const TRIP_TASK_TEXT_COLOR = '#115e59';

const DEFAULT_TASK_COLOR_CONFIG = {
  default: '#d8b4fe',
  confirm: '#bbf7d0',
  design: '#fef9c3',
  confirmModify: '#bae6fd',
  designChange: '#fdba74',
  drawingReview: '#fbcfe8',
  paused: PAUSED_TASK_COLOR,
  urgentConfirm: '#ffff00',
  urgentDesign: '#ffff00',
  urgentConfirmModify: '#ffff00'
};

const CONFIG_KEYS = Object.keys(DEFAULT_TASK_COLOR_CONFIG);

const URGENT_KEY = {
  confirm: 'urgentConfirm',
  design: 'urgentDesign',
  confirmModify: 'urgentConfirmModify'
};

const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const normalizeHexColor = (value, fallback) => {
  const raw = String(value == null ? '' : value).trim();
  if (!HEX_PATTERN.test(raw)) return fallback;
  if (raw.length === 4) return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase();
  return raw.toLowerCase();
};

/** 合并默认值：缺失/非法字段一律回退默认色；兼容旧结构 { bg, text } */
const normalizeTaskColorConfig = (raw) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const result = {};
  CONFIG_KEYS.forEach(key => {
    const value = source[key];
    const candidate = value && typeof value === 'object' ? value.bg : value;
    result[key] = normalizeHexColor(candidate, DEFAULT_TASK_COLOR_CONFIG[key]);
  });
  return result;
};

/** 从任务名后缀反推任务内容类型（「暂停/取消」优先级最高） */
const detectTaskContentType = (taskName) => {
  const name = String(taskName == null ? '' : taskName);
  if (!name) return 'none';
  if (name.includes(PAUSED_TASK_SUFFIX) || name.includes('暂停')) return 'paused';
  if (name.includes('设计变更')) return 'designChange';
  if (name.includes('既制审图')) return 'drawingReview';
  if (name.includes('确认图修改')) return 'confirmModify';
  if (name.includes('确认图')) return 'confirm';
  if (name.includes('设计')) return 'design';
  return 'none';
};

/** 是否已勾选任务内容 */
const hasTaskContent = (type) => type !== 'none';

/** 是否支持「任务加急」：设计变更 / 既制审图 / 暂停/取消 没有加急状态 */
const supportsUrgent = (type) => type === 'confirm' || type === 'design' || type === 'confirmModify';

/** 加急后整行文字变红的任务内容（与 supportsUrgent 同一批） */
const isUrgentRestyleType = (type) => supportsUrgent(type);

const isWhiteColor = (value) => {
  const normalized = String(value == null ? '' : value).trim().toLowerCase();
  return normalized === '#ffffff' || normalized === '#fff' || normalized === 'white';
};

const getBaseColor = (config, type) => {
  if (type === 'none') return config.default;
  return config[type] || config.default;
};

/** 是否为「暂停/取消」任务：任务名后缀优先，兼容历史 paused 标记 */
const isTaskPaused = (item) => {
  if (!item) return false;
  if (item.paused) return true;
  return detectTaskContentType(item.taskName) === 'paused';
};

const resolveTaskColors = (config, type, urgent) => {
  const safe = normalizeTaskColorConfig(config);
  const urgentEnabled = Boolean(urgent) && supportsUrgent(type);
  if (!urgentEnabled) return { bg: getBaseColor(safe, type), text: TASK_TEXT_COLOR, urgent: false };
  const bg = safe[URGENT_KEY[type]] || getBaseColor(safe, type);
  return { bg, text: TASK_URGENT_TEXT_COLOR, urgent: true };
};

/**
 * 任务条目在表格中的最终底色：
 * 暂停（纯红）优先；其次白色（已完成）；否则按任务内容 + 加急派生，忽略历史随机色。
 */
const getTaskCellColor = (item, config) => {
  if (!item) return '';
  const safe = normalizeTaskColorConfig(config);
  if (isTaskPaused(item)) return safe.paused;
  if (isWhiteColor(item.color)) return '#ffffff';
  const type = detectTaskContentType(item.taskName);
  const urgent = Boolean(item.urgent) && supportsUrgent(type);
  return resolveTaskColors(safe, type, urgent).bg;
};

module.exports = {
  TASK_TEXT_COLOR,
  TASK_URGENT_TEXT_COLOR,
  PAUSED_TASK_SUFFIX,
  PAUSED_TASK_COLOR,
  PAUSED_TASK_TEXT_COLOR,
  TRIP_TASK_COLOR,
  TRIP_TASK_TEXT_COLOR,
  DEFAULT_TASK_COLOR_CONFIG,
  CONFIG_KEYS,
  normalizeTaskColorConfig,
  normalizeHexColor,
  detectTaskContentType,
  hasTaskContent,
  supportsUrgent,
  isUrgentRestyleType,
  isTaskPaused,
  resolveTaskColors,
  getTaskCellColor,
  isWhiteColor
};
