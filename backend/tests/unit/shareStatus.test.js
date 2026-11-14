const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const shareStatus = require('../../utils/shareStatus');
const uncShare = require('../../utils/uncShare');

// 状态监测「共享路径访问」卡片的回归测试。
// 这里只覆盖纯逻辑（错误归因、密码遮蔽、本地路径探测），
// 不真连共享盘——CI 上没有 192.168.x 网段，也不能依赖 SMB 超时。

test('classifyError 把权限类错误归为 access-denied', () => {
  const needsCredentials = shareStatus._private.classifyError({ code: 'EPERM', message: 'EPERM: operation not permitted' });
  assert.strictEqual(needsCredentials.reason, 'access-denied');
  assert.match(needsCredentials.hint, /UNC_CREDENTIALS/);

  const denied = shareStatus._private.classifyError({ code: 'EACCES', message: 'access denied' });
  assert.strictEqual(denied.reason, 'access-denied');
});

test('classifyError 区分文件被独占、路径不存在与主机不可达', () => {
  assert.strictEqual(shareStatus._private.classifyError({ code: 'EBUSY' }).reason, 'locked');
  assert.strictEqual(shareStatus._private.classifyError({ code: 'ENOENT' }).reason, 'not-found');
  assert.strictEqual(shareStatus._private.classifyError({ code: 'ENOTDIR' }).reason, 'not-directory');
  assert.strictEqual(shareStatus._private.classifyError({ code: 'UNKNOWN' }).reason, 'unreachable');
  assert.strictEqual(shareStatus._private.classifyError({ code: 'ETIMEDOUT' }).reason, 'timeout');
  // 未识别错误也要给得出可渲染的结论，前端不能出现空白提示
  const fallback = shareStatus._private.classifyError({ code: 'EWEIRD' });
  assert.strictEqual(fallback.reason, 'error');
  assert.ok(fallback.hint.length > 0);
});

test('maskNetUsePassword 抹掉命令行里的明文密码', () => {
  const masked = uncShare._private.maskNetUsePassword(
    'Command failed: net.exe use \\\\192.168.160.70\\各产品大日程 /user:gaoj@obaranj.com gjgj.3010 /persistent:no'
  );
  assert.ok(!masked.includes('gjgj.3010'), '密码不应出现在输出里');
  assert.match(masked, /\/user:gaoj@obaranj\.com \*\*\*/);
});

test('sanitizeNetUseMessage 不再回显整条命令行', () => {
  const message = uncShare._private.sanitizeNetUseMessage(
    'Command failed: net.exe use \\\\192.168.160.6\\仕样书$ /user:u p@ss /persistent:no'
  );
  assert.ok(!/p@ss/.test(message));
  assert.match(message, /net use 执行失败/);
  // 普通错误文本（不含命令行）保持原样，便于排查
  assert.strictEqual(uncShare._private.sanitizeNetUseMessage('EBUSY: resource busy'), 'EBUSY: resource busy');
});

test('getShareAccess 对未配置路径返回 unconfigured 而不是报错', async () => {
  const securityConfig = require('../../config/security');
  const originalSpec = securityConfig.spec.sharePath;
  const originalSchedule = securityConfig.schedule.filePath;
  securityConfig.spec.sharePath = '';
  securityConfig.schedule.filePath = '';
  shareStatus._private.state.clear();
  try {
    const result = await shareStatus.getShareAccess({ force: true });
    assert.strictEqual(result.paths.length, 2);
    for (const item of result.paths) {
      assert.strictEqual(item.state, 'unconfigured');
      assert.strictEqual(item.ok, null);
      assert.match(item.hint, /未配置/);
    }
  } finally {
    securityConfig.spec.sharePath = originalSpec;
    securityConfig.schedule.filePath = originalSchedule;
    shareStatus._private.state.clear();
  }
});

test('getShareAccess 能识别本地目录与本地文件（不依赖共享盘）', async () => {
  const securityConfig = require('../../config/security');
  const originalSpec = securityConfig.spec.sharePath;
  const originalSchedule = securityConfig.schedule.filePath;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'share-status-'));
  const file = path.join(dir, '大日程.xls');
  fs.writeFileSync(file, 'x');
  securityConfig.spec.sharePath = dir;
  securityConfig.schedule.filePath = file;
  shareStatus._private.state.clear();

  try {
    const result = await shareStatus.getShareAccess({ force: true });
    const spec = result.paths.find((item) => item.key === 'specShare');
    const schedule = result.paths.find((item) => item.key === 'productionSchedule');
    assert.strictEqual(spec.state, 'ok');
    assert.strictEqual(spec.detail.isDirectory, true);
    assert.strictEqual(schedule.state, 'ok');
    assert.strictEqual(schedule.detail.isFile, true);
    assert.strictEqual(schedule.detail.sizeBytes, 1);
    // 本地路径没有共享根，不应报「主机不可达」
    assert.strictEqual(schedule.shareRoot, '');
    assert.strictEqual(schedule.hostProbe, null);

    // 第二次调用应命中缓存，且不刷新「最近探测时间」
    const cached = await shareStatus.getShareAccess();
    const cachedSpec = cached.paths.find((item) => item.key === 'specShare');
    assert.strictEqual(cachedSpec.cached, true);
    assert.strictEqual(cachedSpec.checkedAtMs, spec.checkedAtMs);
  } finally {
    securityConfig.spec.sharePath = originalSpec;
    securityConfig.schedule.filePath = originalSchedule;
    shareStatus._private.state.clear();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getShareAccess 对不存在的路径报 not-found 并累计连续失败次数', async () => {
  const securityConfig = require('../../config/security');
  const originalSpec = securityConfig.spec.sharePath;
  securityConfig.spec.sharePath = path.join(os.tmpdir(), 'definitely-not-exists-share-status');
  shareStatus._private.state.clear();
  try {
    const first = await shareStatus.getShareAccess({ force: true });
    const spec = first.paths.find((item) => item.key === 'specShare');
    assert.strictEqual(spec.ok, false);
    assert.strictEqual(spec.reason, 'not-found');
    assert.strictEqual(spec.failStreak, 1);
    assert.ok(spec.lastFailAtMs && !spec.lastOkAtMs);

    const second = await shareStatus.getShareAccess({ force: true });
    assert.strictEqual(second.paths.find((item) => item.key === 'specShare').failStreak, 2);
  } finally {
    securityConfig.spec.sharePath = originalSpec;
    shareStatus._private.state.clear();
  }
});
