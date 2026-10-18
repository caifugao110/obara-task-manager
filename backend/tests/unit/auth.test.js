// config/security.js 在被 require 时若发现 JWT_SECRET 缺失会直接 process.exit(1)。
// 测试环境通常没有生产 .env，这里先补一个一次性值
// （dotenv 不会覆盖已存在的环境变量，所以有真实配置时仍以真实配置为准）。
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production';

const test = require('node:test');
const assert = require('node:assert');

const {
  normalizeAccessSettings,
  isSessionValid,
  isSessionEntryExpired,
  getSessionEntryId,
  getSessionInvalidationMessage
} = require('../../middleware/auth');

test('normalizeAccessSettings 补齐默认值', () => {
  assert.deepStrictEqual(normalizeAccessSettings(), {
    enabled: true,
    allowAdmins: true,
    allowViewers: false
  });
});

test('normalizeAccessSettings 开放访客时隐式开放管理员', () => {
  const result = normalizeAccessSettings({ enabled: true, allowAdmins: false, allowViewers: true });
  assert.strictEqual(result.allowViewers, true);
  assert.strictEqual(result.allowAdmins, true);
});

test('isSessionValid 多设备模式认可列表内任一未过期会话', () => {
  const now = Date.now();
  const user = {
    sessionToken: 'latest',
    sessionTokens: [
      { id: 's1', expiresAt: now + 10000 },
      { id: 's2', expiresAt: now + 10000 }
    ]
  };
  assert.strictEqual(isSessionValid(user, 's1', true, now), true);
  assert.strictEqual(isSessionValid(user, 's2', true, now), true);
  assert.strictEqual(isSessionValid(user, 's3', true, now), false);
});

test('isSessionValid 多设备模式下已过期会话不通过', () => {
  const now = Date.now();
  const user = {
    sessionToken: 'latest',
    sessionTokens: [{ id: 'old', expiresAt: now - 1 }]
  };
  assert.strictEqual(isSessionValid(user, 'old', true, now), false);
});

test('isSessionValid 多设备模式下空列表回退到单 token 校验', () => {
  const user = { sessionToken: 'latest', sessionTokens: [] };
  assert.strictEqual(isSessionValid(user, 'latest', true), true);
  assert.strictEqual(isSessionValid(user, 'other', true), false);
});

test('isSessionValid 单设备模式仅认可最新会话', () => {
  const now = Date.now();
  const user = {
    sessionToken: 'latest',
    sessionTokens: [
      { id: 's1', expiresAt: now + 10000 },
      { id: 'latest', expiresAt: now + 10000 }
    ]
  };
  assert.strictEqual(isSessionValid(user, 'latest', false, now), true);
  assert.strictEqual(isSessionValid(user, 's1', false, now), false);
});

test('isSessionValid 未启用会话校验的历史账号按放行处理', () => {
  const user = { sessionToken: '' };
  assert.strictEqual(isSessionValid(user, 'anything', false), true);
});

test('getSessionEntryId 兼容新旧两种条目格式', () => {
  assert.strictEqual(getSessionEntryId('legacy-string-id'), 'legacy-string-id');
  assert.strictEqual(getSessionEntryId({ id: 'obj-id' }), 'obj-id');
  assert.strictEqual(getSessionEntryId(null), undefined);
});

test('isSessionEntryExpired 旧格式字符串永不过期，新格式按 expiresAt 判断', () => {
  const now = Date.now();
  assert.strictEqual(isSessionEntryExpired('legacy', now), false);
  assert.strictEqual(isSessionEntryExpired({ id: 'a', expiresAt: now - 1 }, now), true);
  assert.strictEqual(isSessionEntryExpired({ id: 'a', expiresAt: now + 1 }, now), false);
  // 无 expiresAt 的新格式条目视为有效（与历史行为一致）
  assert.strictEqual(isSessionEntryExpired({ id: 'a' }, now), false);
});

test('getSessionInvalidationMessage 返回一次性失效原因', () => {
  assert.strictEqual(
    getSessionInvalidationMessage({ sessionInvalidationReason: 'password_reset' }, true),
    '密码已被管理员重置，请使用新密码重新登录'
  );
  assert.strictEqual(
    getSessionInvalidationMessage({ sessionInvalidationReason: 'password_changed' }, false),
    '密码已修改，请使用新密码重新登录'
  );
});

test('getSessionInvalidationMessage 无原因时按多设备开关给出默认文案', () => {
  assert.strictEqual(getSessionInvalidationMessage({}, true), '会话已过期，请重新登录');
  assert.strictEqual(getSessionInvalidationMessage({}, false), '您的账号已在其他设备登录');
});
