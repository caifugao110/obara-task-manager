const test = require('node:test');
const assert = require('node:assert');

const {
  isSelfPasswordChangeEnabled,
  canChangeOwnPassword,
  shouldForcePasswordChange
} = require('../../utils/passwordPolicy');

// 「允许用户自主改密」策略的回归测试。
// 背景：该开关默认开启，但可被显式关闭；关闭后若仍给账号置强制改密，
// 账号会被押在改密页而改密接口返回 403，形成无法自救的死锁
// （全新库首次启动的超级管理员即如此）。

test('开关缺省视为开启，仅显式 false 才关闭', () => {
  assert.strictEqual(isSelfPasswordChangeEnabled(undefined), true);
  assert.strictEqual(isSelfPasswordChangeEnabled({}), true);
  assert.strictEqual(isSelfPasswordChangeEnabled({ allowMultiDevice: true }), true);
  assert.strictEqual(isSelfPasswordChangeEnabled({ allowUserChangePassword: true }), true);
  assert.strictEqual(isSelfPasswordChangeEnabled({ allowUserChangePassword: false }), false);
});

test('强制改密账号在开关关闭时仍可改密（死锁豁免）', () => {
  const forced = { forcePasswordChange: true };
  const normal = { forcePasswordChange: false };
  const off = { allowUserChangePassword: false };
  const on = { allowUserChangePassword: true };

  assert.strictEqual(canChangeOwnPassword(forced, off), true, '开关关闭 + 强制改密 -> 放行');
  assert.strictEqual(canChangeOwnPassword(forced, on), true);
  assert.strictEqual(canChangeOwnPassword(forced, undefined), true);
  assert.strictEqual(canChangeOwnPassword(normal, off), false, '开关关闭 + 普通账号 -> 拒绝');
  assert.strictEqual(canChangeOwnPassword(normal, on), true);
  assert.strictEqual(canChangeOwnPassword(normal, undefined), true, '缺省视为开启');
});

test('开关关闭时不再给新账号置强制改密', () => {
  assert.strictEqual(shouldForcePasswordChange(undefined), true);
  assert.strictEqual(shouldForcePasswordChange({ allowUserChangePassword: true }), true);
  assert.strictEqual(shouldForcePasswordChange({ allowUserChangePassword: false }), false);
});

test('首启默认设置开自主改密，与强制改密流程不冲突', () => {
  // 与 backend/db.js 的初始化默认值保持一致：默认开启 + 首启超管强制改密，
  // 此时 canChangeOwnPassword 必须为 true，否则新装系统登录即死锁
  const freshDefaults = { allowMultiDevice: true, allowUserChangePassword: true };
  assert.strictEqual(shouldForcePasswordChange(freshDefaults), true);
  assert.strictEqual(canChangeOwnPassword({ forcePasswordChange: true }, freshDefaults), true);
});
