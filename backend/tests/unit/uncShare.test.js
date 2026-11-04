const test = require('node:test');
const assert = require('node:assert');

const uncShare = require('../../utils/uncShare');

// 共享盘读取兜底逻辑的回归测试。
// 背景：后端以服务/计划任务自启时运行在 Session 0，没有登录用户的 SMB 认证，
// 读共享文件报 EPERM；uncShare 负责按配置的凭据 net use 后让调用方重试。
// 这里只覆盖纯逻辑（路径解析、凭据映射、重试判定），不真连共享盘。

test('getShareRoot 从 UNC 文件路径取出共享根', () => {
  assert.strictEqual(
    uncShare.getShareRoot('\\\\192.168.160.70\\各产品大日程\\各产品大日程.xls'),
    '\\\\192.168.160.70\\各产品大日程'
  );
  assert.strictEqual(uncShare.getShareRoot('\\\\server\\share'), '\\\\server\\share');
  assert.strictEqual(uncShare.getShareRoot('\\\\server\\share\\'), '\\\\server\\share');
  // 正斜杠写法（配置里偶尔会这么写）同样识别
  assert.strictEqual(uncShare.getShareRoot('//server/share/a.xls'), '\\\\server\\share');
});

test('getShareRoot 对本地路径返回空串', () => {
  assert.strictEqual(uncShare.getShareRoot('F:\\GUNtools\\a.xls'), '');
  assert.strictEqual(uncShare.getShareRoot('./data.db'), '');
  assert.strictEqual(uncShare.getShareRoot(''), '');
  assert.strictEqual(uncShare.getShareRoot(null), '');
});

test('parseCredentialMap 支持多项、英文分号与换行分隔', () => {
  const map = uncShare.parseCredentialMap(
    '\\\\10.0.0.1\\share1=u1:p1;\\\\10.0.0.2\\share2=u2:p2\n\\\\10.0.0.3\\share3=u3:p3'
  );
  assert.strictEqual(map.size, 3);
  assert.deepStrictEqual(map.get('\\\\10.0.0.1\\share1'), { user: 'u1', password: 'p1' });
  assert.deepStrictEqual(map.get('\\\\10.0.0.3\\share3'), { user: 'u3', password: 'p3' });
});

test('parseCredentialMap 密码里允许出现冒号与等号', () => {
  const map = uncShare.parseCredentialMap('\\\\10.0.0.1\\share=a\\b:p:a=ss');
  assert.deepStrictEqual(map.get('\\\\10.0.0.1\\share'), { user: 'a\\b', password: 'p:a=ss' });
});

test('parseCredentialMap 忽略非法项', () => {
  const map = uncShare.parseCredentialMap('没有等号;=没有共享;;\\\\10.0.0.1\\share=');
  assert.strictEqual(map.size, 0);
});

test('resolveCredentials 共享根大小写不敏感', () => {
  const env = { UNC_CREDENTIALS: '\\\\SERVER\\Share=svc:pwd' };
  assert.deepStrictEqual(
    uncShare.resolveCredentials('\\\\server\\share', env),
    { user: 'svc', password: 'pwd' }
  );
  assert.strictEqual(uncShare.resolveCredentials('\\\\server\\other', env), null);
});

test('非 UNC 路径不触发 net use', () => {
  const result = uncShare.ensureShareAccess('F:\\tmp\\a.xls', { user: 'u', password: 'p' });
  assert.strictEqual(result.attempted, false);
  assert.strictEqual(result.ok, false);
});

test('没配凭据且禁用当前凭据尝试时，不执行 net use', () => {
  const saved = process.env.UNC_CREDENTIALS;
  delete process.env.UNC_CREDENTIALS;
  try {
    const result = uncShare.ensureShareAccess('\\\\10.0.0.9\\share\\a.xls', { allowCurrentCredentials: false });
    assert.strictEqual(result.attempted, false);
    assert.strictEqual(result.credsConfigured, false);
    assert.strictEqual(result.shareRoot, '\\\\10.0.0.9\\share');
  } finally {
    if (saved !== undefined) process.env.UNC_CREDENTIALS = saved;
  }
});

test('withShareRetry：成功时直接返回，不碰共享连接', () => {
  const outcome = uncShare.withShareRetry('\\\\10.0.0.9\\share\\a.xls', () => 'ok');
  assert.strictEqual(outcome.ok, true);
  assert.strictEqual(outcome.value, 'ok');
  assert.strictEqual(outcome.ensure, undefined);
});

test('withShareRetry：EBUSY（Excel 独占）不重试、不 net use', () => {
  const error = Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
  const outcome = uncShare.withShareRetry('\\\\10.0.0.9\\share\\a.xls', () => { throw error; });
  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.error.code, 'EBUSY');
  assert.strictEqual(outcome.ensure, undefined);
});

test('withShareRetry：EPERM 但禁用当前凭据尝试时不重试，保留原始错误', () => {
  const saved = process.env.UNC_CREDENTIALS;
  delete process.env.UNC_CREDENTIALS;
  try {
    let calls = 0;
    const error = Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    const outcome = uncShare.withShareRetry('\\\\10.0.0.8\\share\\a.xls', () => {
      calls += 1;
      throw error;
    }, { allowCurrentCredentials: false });
    assert.strictEqual(outcome.ok, false);
    assert.strictEqual(outcome.error, error);
    assert.strictEqual(calls, 1);
    assert.strictEqual(outcome.ensure.attempted, false);
  } finally {
    if (saved !== undefined) process.env.UNC_CREDENTIALS = saved;
  }
});

test('getShareStatus：调用方自带凭据时也能反映为已配置', () => {
  const filePath = '\\\\10.0.0.7\\share\\a.xls';
  // 只配了 PRODUCTION_SCHEDULE_UNC_USER（不走 UNC_CREDENTIALS）时不能误报未配置，
  // 否则诊断接口会让管理员以为凭据没生效。
  const withOptions = uncShare.getShareStatus(filePath, { user: 'gaoj@obaranj.com' });
  assert.strictEqual(withOptions.credentialConfigured, true);
  assert.strictEqual(withOptions.shareRoot, '\\\\10.0.0.7\\share');
  assert.strictEqual(withOptions.lastEnsure, null);

  const withoutOptions = uncShare.getShareStatus(filePath);
  assert.strictEqual(withoutOptions.credentialConfigured, false);
});
