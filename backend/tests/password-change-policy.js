/**
 * 冒烟测试：「允许用户自主改密」开关 与 强制改密（forcePasswordChange）的组合策略
 * 用法：SMOKE_DB_PATH=<快照副本路径> node tests/password-change-policy.js
 * 注意：必须在数据库「快照副本」上运行（run-all.js 会自动生成快照）
 *
 * 覆盖（回归「新装系统死锁」）：
 * - 设置项缺省（老库/新库都没写该字段）时按开启处理，普通账号可改密
 * - 显式关闭时普通账号改密返回 403，且被要求先改密时仍被拦截（强制改密机制未失效）
 * - 显式关闭时，处于强制改密流程的账号依然能改密（豁免），改完即解锁
 * - 开关关闭时新建账号不置强制改密；开启时仍置（避免账号被锁在改密页）
 */
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

if (!process.env.SMOKE_DB_PATH) {
  console.error('缺少 SMOKE_DB_PATH：本测试会写入数据，必须指向数据库快照副本');
  process.exit(1);
}
process.env.SQLITE_DB_PATH = process.env.SMOKE_DB_PATH;

const backendRoot = path.resolve(__dirname, '..');
const securityConfig = require(path.join(backendRoot, 'config/security'));
const db = require(path.join(backendRoot, 'db'));
const authRouter = require(path.join(backendRoot, 'routes/auth'));
const usersRouter = require(path.join(backendRoot, 'routes/users'));

const assert = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`);
  if (!cond) process.exitCode = 1;
};

const PREFIX = 'test-pwd-policy';
const OLD_PASSWORD = 'OldPass123';
const NEW_PASSWORD = 'NewPass456';

const ACCOUNTS = {
  normalOff: { id: `${PREFIX}-normal-off`, username: 'pwdpolicynormaloff', forcePasswordChange: false },
  forcedOff: { id: `${PREFIX}-forced-off`, username: 'pwdpolicyforcedoff', forcePasswordChange: true },
  normalOn: { id: `${PREFIX}-normal-on`, username: 'pwdpolicynormalon', forcePasswordChange: false },
  normalDefault: { id: `${PREFIX}-normal-default`, username: 'pwdpolicynormaldef', forcePasswordChange: false },
  superadmin: { id: `${PREFIX}-superadmin`, username: 'pwdpolicysuper', role: 'superadmin', forcePasswordChange: false }
};

const sessionOf = (id) => `${PREFIX}-session-${id}`;

const seedUsers = async () => {
  db.init();
  const data = db.readDb();
  const ids = Object.values(ACCOUNTS).map(a => a.id);
  data.users = (data.users || []).filter(u => !ids.includes(u.id));
  // 用低成本哈希：这里只验证策略分支，不验证 bcrypt 强度
  const password = bcrypt.hashSync(OLD_PASSWORD, 4);
  data.users.push(...Object.values(ACCOUNTS).map(a => ({
    id: a.id,
    username: a.username,
    name: `改密策略测试-${a.username}`,
    role: a.role || 'user',
    password,
    sessionToken: sessionOf(a.id),
    sessionTokens: [sessionOf(a.id)],
    disabled: false,
    forcePasswordChange: a.forcePasswordChange
  })));
  await db.writeDb(data);
};

/** 写入 settings.system；allowUserChangePassword 传 undefined 表示「字段缺失」 */
const setSettings = async (allowUserChangePassword, extra = {}) => {
  const data = db.readDb();
  data.settings = data.settings || {};
  const system = { ...(data.settings.system || {}) };
  system.allowMultiDevice = true;
  system.specNumberDigits = system.specNumberDigits || 5;
  delete system.allowUserChangePassword;
  if (allowUserChangePassword !== undefined) system.allowUserChangePassword = allowUserChangePassword;
  data.settings.system = { ...system, ...extra };
  await db.writeDb(data);
};

const signToken = (account, sessionId = sessionOf(account.id)) => jwt.sign(
  { id: account.id, username: account.username, sessionId },
  securityConfig.jwt.secret,
  { algorithm: 'HS256', issuer: securityConfig.jwt.issuer, audience: securityConfig.jwt.audience, expiresIn: '1h' }
);

const main = async () => {
  await seedUsers();

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const headersOf = (account) => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${signToken(account)}`
  });

  const changePassword = (account, oldPassword = OLD_PASSWORD, newPassword = NEW_PASSWORD) =>
    fetch(`${base}/api/auth/change-password`, {
      method: 'POST',
      headers: headersOf(account),
      body: JSON.stringify({ oldPassword, newPassword })
    });

  try {
    // 1. 设置项缺省：按开启处理（老库没有该字段时不应被判为「已禁用」）
    await setSettings(undefined);
    const defaultRes = await changePassword(ACCOUNTS.normalDefault);
    assert(defaultRes.status === 200, '设置项缺失时普通账号可改密（缺省视为开启）');

    // 2. 显式关闭 + 普通账号 → 403
    await setSettings(false);
    const normalRes = await changePassword(ACCOUNTS.normalOff);
    const normalBody = await normalRes.json();
    assert(normalRes.status === 403, '开关关闭时普通账号改密返回 403');
    assert(/已禁用自主修改密码/.test(normalBody.message || ''), '403 文案为「系统已禁用自主修改密码，请联系管理员」');

    // 3. 显式关闭 + 强制改密账号：其他接口仍被拦截，但改密放行（死锁豁免）
    const blockedRes = await fetch(`${base}/api/users`, { headers: headersOf(ACCOUNTS.forcedOff) });
    const blockedBody = await blockedRes.json();
    assert(blockedRes.status === 403 && blockedBody.code === 'FORCE_PASSWORD_CHANGE',
      '强制改密期间其他接口仍被 FORCE_PASSWORD_CHANGE 拦截');

    const forcedRes = await changePassword(ACCOUNTS.forcedOff);
    const forcedBody = await forcedRes.json();
    assert(forcedRes.status === 200, '开关关闭时强制改密账号仍可改密（不会锁死）');
    assert(typeof forcedBody.token === 'string' && forcedBody.token.length > 0, '改密成功返回新令牌');

    // 4. 改密完成后应彻底解锁（forcePasswordChange 清零，新令牌可用）
    const validateRes = await fetch(`${base}/api/auth/validate`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${forcedBody.token}` }
    });
    const validateBody = await validateRes.json();
    assert(validateBody.valid === true && validateBody.forcePasswordChange === false,
      '改密后强制改密标记清除，账号恢复可用');

    // 5. 显式开启 + 普通账号 → 200（回归对照）
    await setSettings(true);
    const enabledRes = await changePassword(ACCOUNTS.normalOn);
    assert(enabledRes.status === 200, '开关开启时普通账号可改密');

    // 6. 新建账号与开关联动：关闭时不置强制改密，开启时仍置
    const superHeaders = headersOf(ACCOUNTS.superadmin);
    const createUser = async (username) => {
      const res = await fetch(`${base}/api/users`, {
        method: 'POST',
        headers: superHeaders,
        body: JSON.stringify({ username, password: 'InitPass789', name: '改密策略新建账号', role: 'user' })
      });
      return { status: res.status, body: await res.json() };
    };

    await setSettings(false);
    const createdWhenOff = await createUser('pwdpolicycreateoff');
    assert(createdWhenOff.status === 201 && createdWhenOff.body.forcePasswordChange === false,
      '开关关闭时新建账号不置强制改密（否则账号会被锁在改密页）');

    await setSettings(true);
    const createdWhenOn = await createUser('pwdpolicycreateon');
    assert(createdWhenOn.status === 201 && createdWhenOn.body.forcePasswordChange === true,
      '开关开启时新建账号仍置强制改密');
  } finally {
    server.close();
  }
};

main().catch((err) => {
  console.error('测试异常终止:', err);
  process.exit(1);
});
