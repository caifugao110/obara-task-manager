/**
 * 「允许用户自主改密」策略的唯一判定口径
 *
 * 背景：该开关默认开启，但管理上允许显式关闭（密码统一由管理员掌握）。
 * 强制改密（forcePasswordChange）与它是两条独立机制，组合不当会互斥锁死：
 * 「下次登录必须先改密」把用户押到改密页，而「禁止自主改密」又把改密页的
 * 提交接口堵死，账号既改不了密也做不了别的——全新库首次启动的超管正是这种
 * 处境（此时唯一能去系统设置里开开关的账号，就是它自己）。
 *
 * 口径：
 *   1. 默认开启；只有 settings.system.allowUserChangePassword 显式为 false 才算关闭
 *      （历史库里缺这个字段的，按开启处理，与 GET /api/system/settings 的归一化一致）。
 *   2. 处于强制改密流程的账号一律放行改密——否则强制改密无法完成，账号被锁死。
 *   3. 开关关闭时不再给新账号设置强制改密：管理员设定的密码本就是交付给用户使用的，
 *      此时再要求改密只会把用户挡在门外（见 shouldForcePasswordChange）。
 */

/** 开关是否开启（缺省视为开启） */
const isSelfPasswordChangeEnabled = (systemSettings) =>
  systemSettings?.allowUserChangePassword !== false;

/**
 * 该账号此刻能否自主改密
 * @param {{ forcePasswordChange?: boolean }} user 目标账号
 * @param {object} systemSettings settings.system
 */
const canChangeOwnPassword = (user, systemSettings) =>
  Boolean(user?.forcePasswordChange) || isSelfPasswordChangeEnabled(systemSettings);

/**
 * 是否给账号置「下次登录必须改密」
 * 开关关闭时不置：否则账号登录即进改密页，而改密入口已被禁用。
 */
const shouldForcePasswordChange = (systemSettings) => isSelfPasswordChangeEnabled(systemSettings);

module.exports = {
  isSelfPasswordChangeEnabled,
  canChangeOwnPassword,
  shouldForcePasswordChange
};
