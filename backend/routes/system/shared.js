'use strict';
/**
 * 系统设置的默认值 / Joi schema / 归一化，以及离线备份的鉴权中间件。
 * info（读写设置）、maintenance（导入）、logs（IP 黑名单）三处共用，放这里避免各写一套默认值。
 *
 * 由 backend/routes/system.js 拆分而来，代码为原样搬运（未改逻辑）。
 */
const { authMiddleware, superAdminMiddleware } = require('../../middleware/auth');
const Joi = require('joi');
const { isSelfPasswordChangeEnabled } = require('../../utils/passwordPolicy');
const logFiles = require('../../utils/logFiles');
const offlineBackupToken = require('../../utils/offlineBackupToken');
const {
  DEFAULT_TASK_COLOR_CONFIG,

  normalizeTaskColorConfig
} = require('../../utils/taskColors');

// X01-X12 同 X01（确认图 1 / 确认图修改 1 / 设计 2.5）
const buildToyotaTableGunHours = () => {
  const map = {};
  for (let i = 1; i <= 10; i += 1) {
    map[`C${String(i).padStart(2, '0')}`] = { confirm: 1, confirmModify: 1, design: 2 };
  }
  for (let i = 1; i <= 12; i += 1) {
    map[`X${String(i).padStart(2, '0')}`] = { confirm: 1, confirmModify: 1, design: 2.5 };
  }
  return map;
};

// 各分类下每张台账表的专用默认工时（确认图 / 确认图修改 / 设计，单位 h）。
// 枪名命中所在表时直接使用该表数值；表名需与焊枪台账中的实际表名一致。
const BUILTIN_TABLE_GUN_HOURS = {
  X2C: {
    SRTC: { confirm: 1.5, confirmModify: 0.5, design: 2.5 },
    SRTX: { confirm: 2, confirmModify: 0.75, design: 3 },
    SRTV: { confirm: 2, confirmModify: 0.75, design: 3 },
    'SRTC-ALA-DC': { confirm: 1.5, confirmModify: 0.5, design: 3 },
    'SRTX-ALA-DC': { confirm: 2, confirmModify: 0.75, design: 3.5 },
    SRTD: { confirm: 3, confirmModify: 1, design: 3 },
    SRTS: { confirm: 2.5, confirmModify: 0.75, design: 3 }
  },
  'X2C-V2': {
    C: { confirm: 1.5, confirmModify: 0.5, design: 2.5 },
    X: { confirm: 2, confirmModify: 0.75, design: 3 }
  },
  'X2C-V3': {
    C: { confirm: 1.5, confirmModify: 0.5, design: 2.5 },
    X: { confirm: 2, confirmModify: 0.75, design: 3 }
  },
  GLOBAL: {
    RBC: { confirm: 2, confirmModify: 0.75, design: 3 }
  },
  PSW: {
    UC: { confirm: 1.5, confirmModify: 0.5, design: 2 },
    UX: { confirm: 2, confirmModify: 0.5, design: 2.5 },
    UCR: { confirm: 1.5, confirmModify: 1, design: 2.5 },
    UXR: { confirm: 2, confirmModify: 1, design: 3 },
    NOC: { confirm: 2, confirmModify: 1.5, design: 2.5 },
    NOX: { confirm: 2, confirmModify: 1.5, design: 3 }
  },
  IT: {
    PTC: { confirm: 1.5, confirmModify: 0.5, design: 2 },
    PTX: { confirm: 1.5, confirmModify: 0.5, design: 2.5 },
    'PTC-ALC': { confirm: 1.5, confirmModify: 0.5, design: 2 },
    'PTX-ALC': { confirm: 1.5, confirmModify: 0.5, design: 2.5 }
  },
  ROBOT: {
    RTC: { confirm: 4, confirmModify: 2, design: 4 },
    RTX: { confirm: 6, confirmModify: 2.5, design: 8 },
    RC: { confirm: 4, confirmModify: 2, design: 4 },
    RX: { confirm: 6, confirmModify: 2.5, design: 8 }
  },
  EQ: {
    PE1: { confirm: 2, confirmModify: 1, design: 3 },
    PE2: { confirm: 2.5, confirmModify: 1.5, design: 4 },
    R: { confirm: 2, confirmModify: 1, design: 3 },
    RR: { confirm: 2.5, confirmModify: 1.5, design: 4 },
    SEN: { confirm: 2, confirmModify: 1, design: 3 },
    SEU: { confirm: 2, confirmModify: 1, design: 3 },
    SET: { confirm: 2, confirmModify: 1, design: 3 },
    STUD: { confirm: 2, confirmModify: 1, design: 3 }
  },
  TOYOTA: buildToyotaTableGunHours()
};

const defaultSystemSettings = {
  allowMultiDevice: true,
  allowUserDesignPlanColorMark: true,
  allowUserEditOwnTask: true,
  allowUserChangePassword: true,
  specNumberDigits: 5,
  // 操作日志保留条数（超限自动清理最旧记录）
  auditLogMaxRows: 5000,
  // 磁盘日志超过阈值自动截断（日志管理）：默认开启，单文件 50MB
  logAutoTrimEnabled: logFiles.DEFAULT_TRIM_SETTINGS.enabled,
  logMaxSizeMb: logFiles.DEFAULT_TRIM_SETTINGS.maxSizeMb,
  // 任务内容 → 单元格配色体系（与前端 utils/taskColors.ts 默认值保持一致）
  taskColorConfig: DEFAULT_TASK_COLOR_CONFIG,
  defaultGunHours: {
    confirm: { C: 1.5, X: 2 },
    design: { C: 2.5, X: 3 },
    confirmModify: { C: 0.5, X: 0.75 }
  },
  // 分类 → 表名 → { confirm, confirmModify, design }，未配置的表回退 defaultGunHours
  tableGunHours: BUILTIN_TABLE_GUN_HOURS,
  // 设计变更 / 既制审图 的固定工时：不区分枪名机型 C/X，也不套用任何表专用规则
  extraTaskHours: {
    designChange: 1.5,
    drawingReview: 0.5
  }
};

const gunHoursTypeSchema = Joi.object({
  C: Joi.number().min(0).max(24).required(),
  X: Joi.number().min(0).max(24).required()
});

// 单张台账表的专用工时：确认图 / 确认图修改 / 设计（h，0-24）
const tableGunHoursCellSchema = Joi.object({
  confirm: Joi.number().min(0).max(24).required(),
  confirmModify: Joi.number().min(0).max(24).required(),
  design: Joi.number().min(0).max(24).required()
});

// 设计变更 / 既制审图的固定工时（h，0-24；不区分 C/X）
const extraTaskHoursSchema = Joi.object({
  designChange: Joi.number().min(0).max(24).required(),
  drawingReview: Joi.number().min(0).max(24).required()
});

// 任务内容配色：每项一个底色 hex（文字色固定黑色/加急红色，不参与配置）
const hexColorSchema = Joi.string().pattern(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
// 兼容历史 { bg, text } 结构：仅取 bg，text 被忽略
const legacyPairSchema = Joi.object({
  bg: hexColorSchema.required(),
  text: hexColorSchema.optional()
});
const taskColorValueSchema = Joi.alternatives().try(hexColorSchema, legacyPairSchema);

// 各字段均为可选：缺失项由 normalizeTaskColorConfig 回退到默认色
// 设计变更 / 既制审图 / 暂停取消 没有加急状态，因此只保留三个加急键
const taskColorConfigSchema = Joi.object({
  default: taskColorValueSchema.optional(),
  confirm: taskColorValueSchema.optional(),
  design: taskColorValueSchema.optional(),
  confirmModify: taskColorValueSchema.optional(),
  designChange: taskColorValueSchema.optional(),
  drawingReview: taskColorValueSchema.optional(),
  paused: taskColorValueSchema.optional(),
  urgentConfirm: taskColorValueSchema.optional(),
  urgentDesign: taskColorValueSchema.optional(),
  urgentConfirmModify: taskColorValueSchema.optional()
});

const systemSettingsSchema = Joi.object({
  allowMultiDevice: Joi.boolean().required(),
  allowUserDesignPlanColorMark: Joi.boolean().optional(),
  allowUserEditOwnTaskColor: Joi.boolean().optional(),
  allowUserChangePassword: Joi.boolean().optional(),
  specNumberDigits: Joi.number().integer().valid(5, 6).optional(),
  auditLogMaxRows: Joi.number().integer().min(100).max(100000).optional(),
  logAutoTrimEnabled: Joi.boolean().optional(),
  logMaxSizeMb: Joi.number().integer().min(logFiles.MAX_SIZE_MB_MIN).max(logFiles.MAX_SIZE_MB_MAX).optional(),
  taskColorConfig: taskColorConfigSchema.optional(),
  defaultGunHours: Joi.object({
    confirm: gunHoursTypeSchema.required(),
    design: gunHoursTypeSchema.required(),
    confirmModify: gunHoursTypeSchema.required()
  }).optional(),
  tableGunHours: Joi.object().pattern(
    Joi.string().trim().min(1).max(30),
    Joi.object().pattern(Joi.string().trim().min(1).max(50), tableGunHoursCellSchema)
  ).optional(),
  extraTaskHours: extraTaskHoursSchema.optional()
});

const maintenanceSettingsSchema = Joi.object({
  enabled: Joi.boolean().required(),
  dailyBackupEnabled: Joi.boolean().required(),
  dailyTaskExportEnabled: Joi.boolean().required(),
  dailyGunLedgerExportEnabled: Joi.boolean().required(),
  // 新字段用 optional：旧前端页面（未重新加载的标签页）保存时不会因为缺字段被整体拒绝，
  // 缺省时沿用数据库中的现值 / 内置默认值
  dailyScheduleSyncEnabled: Joi.boolean().optional(),
  offlineBackupEnabled: Joi.boolean().required(),
  backupRetentionDays: Joi.number().integer().min(1).max(3650).required(),
  offlineBackupRetentionDays: Joi.number().integer().min(1).max(3650).required(),
  taskExportRetentionDays: Joi.number().integer().min(1).max(3650).required(),
  gunLedgerExportRetentionDays: Joi.number().integer().min(1).max(3650).required(),
  scheduleTimes: Joi.array().items(Joi.string().pattern(/^\d{2}:\d{2}$/)).min(1).max(2).required(),
  yearlyCleanupEnabled: Joi.boolean().required(),
  yearlyCleanupMonth: Joi.number().integer().min(1).max(12).required(),
  yearlyCleanupCheckDays: Joi.number().integer().min(1).max(31).required(),
  yearlyTaskRetentionYears: Joi.number().integer().min(1).max(10).required(),
  backupDir: Joi.string().trim().min(1).max(200).required(),
  taskExportDir: Joi.string().trim().min(1).max(200).required(),
  gunLedgerExportDir: Joi.string().trim().min(1).max(200).required(),
  yearlyArchiveDir: Joi.string().trim().min(1).max(200).required(),
  offlineBackupDir: Joi.string().trim().min(1).max(200).required()
});

const normalizeGunHours = (raw, fallback) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    C: typeof src.C === 'number' && Number.isFinite(src.C) ? src.C : fallback.C,
    X: typeof src.X === 'number' && Number.isFinite(src.X) ? src.X : fallback.X
  };
};

// 设计变更 / 既制审图的固定工时归一化：非法/缺失回退内置值
const normalizeExtraTaskHours = (raw) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  const fallback = defaultSystemSettings.extraTaskHours;
  const pick = (key) => {
    const value = src[key];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 24
      ? value
      : fallback[key];
  };
  return { designChange: pick('designChange'), drawingReview: pick('drawingReview') };
};

const isValidHoursCell = (cell) => {
  if (!cell || typeof cell !== 'object') return false;
  return ['confirm', 'confirmModify', 'design'].every(
    key => typeof cell[key] === 'number' && Number.isFinite(cell[key]) && cell[key] >= 0 && cell[key] <= 24
  );
};

// 专用工时归一化：以内置值为底，再覆盖超管已保存的覆盖项（含用户自建表的配置）；
// 非法单元格回退内置值（无内置值则丢弃，不下发）
const normalizeTableGunHours = (raw) => {
  const result = {};
  const mergedCategories = new Set([
    ...Object.keys(BUILTIN_TABLE_GUN_HOURS),
    ...(raw && typeof raw === 'object' ? Object.keys(raw) : [])
  ]);
  mergedCategories.forEach(category => {
    const builtinTables = BUILTIN_TABLE_GUN_HOURS[category] || {};
    const rawTables = raw && typeof raw === 'object' && raw[category] && typeof raw[category] === 'object'
      ? raw[category]
      : {};
    const tableNames = new Set([...Object.keys(builtinTables), ...Object.keys(rawTables)]);
    const categoryMap = {};
    tableNames.forEach(tableName => {
      const rawCell = rawTables[tableName];
      if (isValidHoursCell(rawCell)) {
        categoryMap[tableName] = {
          confirm: rawCell.confirm,
          confirmModify: rawCell.confirmModify,
          design: rawCell.design
        };
      } else if (builtinTables[tableName]) {
        categoryMap[tableName] = { ...builtinTables[tableName] };
      }
    });
    if (Object.keys(categoryMap).length > 0) result[category] = categoryMap;
  });
  return result;
};

const normalizeSystemSettings = (settings = {}) => {
  const merged = { ...defaultSystemSettings, ...settings };
  // 已下线的「设计计划标记颜色随机」「焊枪台账分配任务标记颜色随机」：把历史数据里的残留一并清掉
  delete merged.randomDesignPlanColor;
  delete merged.randomAssignmentColor;
  const hasDesignPlanColorMark = Object.prototype.hasOwnProperty.call(settings, 'allowUserDesignPlanColorMark');
  const hasEditOwnTaskColor = Object.prototype.hasOwnProperty.call(settings, 'allowUserEditOwnTaskColor');
  const allowOwnDesignPlanColor = hasDesignPlanColorMark || hasEditOwnTaskColor
    ? Boolean(settings.allowUserDesignPlanColorMark || settings.allowUserEditOwnTaskColor)
    : true;
  const fallbackGunHours = defaultSystemSettings.defaultGunHours;
  const rawGunHours = merged.defaultGunHours && typeof merged.defaultGunHours === 'object' ? merged.defaultGunHours : {};
  const rawAuditLogMaxRows = Number(merged.auditLogMaxRows);
  const auditLogMaxRows = Number.isInteger(rawAuditLogMaxRows) && rawAuditLogMaxRows >= 100 && rawAuditLogMaxRows <= 100000
    ? rawAuditLogMaxRows
    : defaultSystemSettings.auditLogMaxRows;
  // 磁盘日志自动截断阈值：缺失/越界一律回到默认值，避免 0 或负数导致「每次检查都截断」
  const rawLogMaxSizeMb = Number(merged.logMaxSizeMb);
  const logMaxSizeMb = Number.isFinite(rawLogMaxSizeMb)
    && rawLogMaxSizeMb >= logFiles.MAX_SIZE_MB_MIN
    && rawLogMaxSizeMb <= logFiles.MAX_SIZE_MB_MAX
    ? Math.round(rawLogMaxSizeMb)
    : defaultSystemSettings.logMaxSizeMb;
  return {
    ...merged,
    allowUserDesignPlanColorMark: allowOwnDesignPlanColor,
    auditLogMaxRows,
    logAutoTrimEnabled: merged.logAutoTrimEnabled !== false,
    logMaxSizeMb,
    allowUserEditOwnTaskColor: allowOwnDesignPlanColor,
    // 缺省视为开启（与 change-password 接口口径一致），显式 false 才关闭
    allowUserChangePassword: isSelfPasswordChangeEnabled(merged),
    defaultGunHours: {
      confirm: normalizeGunHours(rawGunHours.confirm, fallbackGunHours.confirm),
      design: normalizeGunHours(rawGunHours.design, fallbackGunHours.design),
      confirmModify: normalizeGunHours(rawGunHours.confirmModify, fallbackGunHours.confirmModify)
    },
    tableGunHours: normalizeTableGunHours(merged.tableGunHours),
    extraTaskHours: normalizeExtraTaskHours(merged.extraTaskHours),
    taskColorConfig: normalizeTaskColorConfig(merged.taskColorConfig)
  };
};

const loginLogQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(500).default(200),
  username: Joi.string().allow('').max(60).default(''),
  role: Joi.string().valid('all', 'superadmin', 'admin', 'user').default('all'),
  success: Joi.string().valid('all', 'true', 'false').default('all'),
  browser: Joi.string().allow('').max(80).default(''),
  ip: Joi.string().allow('').max(80).default(''),
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional()
});

// 本机运维脚本（stop.bat 经 localhost 调用）必须携带后端启动时生成的一次性令牌；
// 其余请求必须是超级管理员。
// 不能用“来源是否为环回地址”匿名放行：前端 Vite / nginx 代理会把所有局域网请求
// 转成 127.0.0.1，等于把备份接口匿名开放给内网，可被反复触发写满磁盘。
// 令牌校验通过后立即轮换，同一令牌只能用一次（见 utils/offlineBackupToken.js）。
const offlineBackupAccess = (req, res, next) => {
  const token = req.get('X-Offline-Backup-Token');
  if (token && offlineBackupToken.consumeToken(token)) return next();
  authMiddleware(req, res, (err) => {
    if (err) return next(err);
    superAdminMiddleware(req, res, next);
  });
};

module.exports = {
  buildToyotaTableGunHours,
  BUILTIN_TABLE_GUN_HOURS,
  defaultSystemSettings,
  gunHoursTypeSchema,
  tableGunHoursCellSchema,
  extraTaskHoursSchema,
  hexColorSchema,
  legacyPairSchema,
  taskColorValueSchema,
  taskColorConfigSchema,
  systemSettingsSchema,
  maintenanceSettingsSchema,
  normalizeGunHours,
  normalizeExtraTaskHours,
  isValidHoursCell,
  normalizeTableGunHours,
  normalizeSystemSettings,
  loginLogQuerySchema,
  offlineBackupAccess,
};
