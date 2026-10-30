process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production';

const test = require('node:test');
const assert = require('node:assert');

const { shouldAudit } = require('../../middleware/auditLog');

// 审计范围收敛的回归测试。
// 背景：浏览器每刷新一次工作台会并发十几个初始化 GET，
// 若全量记录，audit_logs 会被「查看列表」类请求淹没，真正的增删改反而沉底。

test('shouldAudit 不记录前端初始化时的配置类 GET', () => {
  const paths = [
    '/api/system/settings',
    '/api/settings/leaderboard',
    '/api/settings/work-hours',
    '/api/settings/status-tracking',
    '/api/settings/system-settings',
    '/api/settings/design-standards',
    '/api/settings/gun-ledger',
    '/api/settings/workday-overrides',
    '/api/system/version',
    '/api/auth/client-info',
    '/api/designers',
    '/api/tasks?month=10&year=2026'
  ];
  for (const path of paths) {
    assert.strictEqual(shouldAudit('GET', path), false, `${path} 不应记录`);
  }
});

test('shouldAudit 不记录会话心跳', () => {
  assert.strictEqual(shouldAudit('GET', '/api/auth/validate'), false);
});

test('shouldAudit 不记录日志自身的查询', () => {
  assert.strictEqual(shouldAudit('GET', '/api/system/audit-logs?page=1&limit=20'), false);
  assert.strictEqual(shouldAudit('GET', '/api/system/audit-logs/filter-options'), false);
  assert.strictEqual(shouldAudit('GET', '/api/system/login-logs'), false);
});

test('shouldAudit 记录所有写操作', () => {
  const cases = [
    ['POST', '/api/auth/login'],
    ['POST', '/api/auth/logout'],
    ['POST', '/api/tasks/item'],
    ['PUT', '/api/tasks/item'],
    ['DELETE', '/api/tasks/item'],
    ['POST', '/api/users/batch-delete'],
    ['PUT', '/api/system/settings'],
    ['POST', '/api/system/maintenance/backup']
  ];
  for (const [method, path] of cases) {
    assert.strictEqual(shouldAudit(method, path), true, `${method} ${path} 应记录`);
  }
});

test('shouldAudit 不记录语义为只读的 POST 查询', () => {
  assert.strictEqual(shouldAudit('POST', '/api/spec/spec-info'), false);
  assert.strictEqual(shouldAudit('POST', '/api/tasks/batch-replace/search'), false);
  assert.strictEqual(shouldAudit('POST', '/api/design-standards/chat'), false);
});

test('shouldAudit 保留导出类与敏感读取的留痕', () => {
  assert.strictEqual(shouldAudit('GET', '/api/gun-ledger/export-all'), true);
  assert.strictEqual(shouldAudit('GET', '/api/system/export-xls?month=2026-10'), true);
  assert.strictEqual(shouldAudit('GET', '/api/system/audit-logs/export'), true);
  assert.strictEqual(shouldAudit('GET', '/api/system/db-stats'), true);
});

test('shouldAudit 忽略查询串与尾部斜杠差异', () => {
  assert.strictEqual(shouldAudit('GET', '/api/auth/validate?ts=1'), false);
  assert.strictEqual(shouldAudit('GET', '/api/system/audit-logs/'), false);
});

test('shouldAudit 不记录未声明方法', () => {
  assert.strictEqual(shouldAudit('OPTIONS', '/api/tasks'), false);
  assert.strictEqual(shouldAudit('HEAD', '/api/tasks'), false);
});
