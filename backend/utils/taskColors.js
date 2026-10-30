/**
 * 任务内容配色体系（后端副本：与前端 src/utils/taskColors.ts 保持一致的默认值）
 *
 * 用于系统设置默认值/归一化，以及导出（Excel/HTML）时按任务内容派生单元格底色，
 * 保证「页面看到的颜色」与「导出的颜色」一致。
 *
 * 文字色固定：普通任务黑色，加急任务中确认图/设计/确认图修改为红色，不参与配置。
 */

const TASK_TEXT_COLOR = '#000000';
const TASK_URGENT_TEXT_COLOR = '#dc2626';
// 出差任务的固定配色（湖水青）：和设计相关配色区分开，避免撞色
const TRIP_TASK_COLOR = '#5eead4';
const TRIP_TASK_TEXT_COLOR = '#115e59';

const DEFAULT_TASK_COLOR_CONFIG = {
  default: '#d8b4fe',
  confirm: '#bbf7d0',
  design: '#fef9c3',
  confirmModify: '#fbcfe8',
  designChange: '#fdba74',
  drawingReview: '#bae6fd',
  urgentConfirm: '#34d399',
  urgentDesign: '#fde047',
  urgentConfirmModify: '#f9a8d4',
  urgentDesignChange: '#fdba74',
  urgentDrawingReview: '#bae6fd'
};

const CONFIG_KEYS = Object.keys(DEFAULT_TASK_COLOR_CONFIG);

const URGENT_KEY = {
  confirm: 'urgentConfirm',
  design: 'urgentDesign',
  confirmModify: 'urgentConfirmModify',
  designChange: 'urgentDesignChange',
  drawingReview: 'urgentDrawingReview'
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

const detectTaskContentType = (taskName) => {
  const name = String(taskName == null ? '' : taskName);
  if (!name) return 'none';
  if (name.includes('设计变更')) return 'designChange';
  if (name.includes('既制审图')) return 'drawingReview';
  if (name.includes('确认图修改')) return 'confirmModify';
  if (name.includes('确认图')) return 'confirm';
  if (name.includes('设计')) return 'design';
  return 'none';
};

/** 是否已勾选任务内容（勾选后才允许勾选「任务加急」） */
const hasTaskContent = (type) => type !== 'none';

/** 加急后整行文字变红的任务内容；设计变更 / 既制审图加急仅换底色 */
const isUrgentRestyleType = (type) => type === 'confirm' || type === 'design' || type === 'confirmModify';

const isWhiteColor = (value) => {
  const normalized = String(value == null ? '' : value).trim().toLowerCase();
  return normalized === '#ffffff' || normalized === '#fff' || normalized === 'white';
};

const getBaseColor = (config, type) => {
  if (type === 'none') return config.default;
  return config[type] || config.default;
};

const resolveTaskColors = (config, type, urgent) => {
  const safe = normalizeTaskColorConfig(config);
  if (!urgent) return { bg: getBaseColor(safe, type), text: TASK_TEXT_COLOR, urgent: false };
  const bg = type === 'none' ? safe.default : (safe[URGENT_KEY[type]] || getBaseColor(safe, type));
  const text = isUrgentRestyleType(type) ? TASK_URGENT_TEXT_COLOR : TASK_TEXT_COLOR;
  return { bg, text, urgent: true };
};

/**
 * 任务条目在表格中的最终底色：
 * 白色（已完成）优先；否则按任务内容 + 加急派生，忽略历史随机色。
 */
const getTaskCellColor = (item, config) => {
  if (!item) return '';
  if (isWhiteColor(item.color)) return '#ffffff';
  const type = detectTaskContentType(item.taskName);
  const urgent = Boolean(item.urgent) && hasTaskContent(type);
  return resolveTaskColors(config, type, urgent).bg;
};

module.exports = {
  TASK_TEXT_COLOR,
  TASK_URGENT_TEXT_COLOR,
  TRIP_TASK_COLOR,
  TRIP_TASK_TEXT_COLOR,
  DEFAULT_TASK_COLOR_CONFIG,
  CONFIG_KEYS,
  normalizeTaskColorConfig,
  normalizeHexColor,
  detectTaskContentType,
  hasTaskContent,
  isUrgentRestyleType,
  resolveTaskColors,
  getTaskCellColor,
  isWhiteColor
};
