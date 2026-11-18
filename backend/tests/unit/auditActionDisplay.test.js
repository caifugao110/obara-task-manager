process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production';

const test = require('node:test');
const assert = require('node:assert');

const { getAuditActionDisplay, getTaskItemUpdateDisplay } = require('../../utils/auditLogDisplay');

// 任务完成状态的审计文案回归测试。
// 背景：PUT /api/tasks/item 同时承载改内容、改工时、改完成状态，
// 早期日志一律记成「更新任务 / 修改任务内容或工时」，
// 导致「谁把哪条任务标成已完成」在日志里查不出来。

const withBody = (body) => ({
  method: 'PUT',
  path: '/api/tasks/item',
  requestBody: JSON.stringify(body)
});

test('主任务标白记为「标记任务完成」', () => {
  const display = getAuditActionDisplay(withBody({ field: 'color', value: '#ffffff' }));
  assert.strictEqual(display.label, '标记任务完成');
  assert.ok(!display.description.includes('工时'));
});

test('主任务恢复原色记为「取消任务完成标记」', () => {
  const display = getAuditActionDisplay(withBody({ field: 'color', value: '__restore__' }));
  assert.strictEqual(display.label, '取消任务完成标记');
});

test('枪名标白与恢复走独立的枪名文案', () => {
  assert.strictEqual(
    getAuditActionDisplay(withBody({ field: 'gunColor', value: '#ffffff', gunIndex: 0 })).label,
    '标记枪名完成'
  );
  assert.strictEqual(
    getAuditActionDisplay(withBody({ field: 'gunColor', value: '__restore__', gunIndex: 0 })).label,
    '取消枪名完成标记'
  );
});

test('完成状态以外的字段不再被笼统归为「修改任务内容或工时」', () => {
  assert.strictEqual(getAuditActionDisplay(withBody({ field: 'hours', value: 8 })).label, '修改任务工时');
  assert.strictEqual(getAuditActionDisplay(withBody({ field: 'taskName', value: '确认图' })).label, '修改任务名称');
  assert.strictEqual(getAuditActionDisplay(withBody({ field: 'guns', value: [] })).label, '修改枪名工时');
  assert.strictEqual(getAuditActionDisplay(withBody({ field: 'leaveType', value: 'trip' })).label, '修改任务类型');
});

test('请求体缺失或不可解析时退回通用文案，且描述涵盖完成状态', () => {
  const noBody = getAuditActionDisplay({ method: 'PUT', path: '/api/tasks/item' });
  assert.strictEqual(noBody.label, '更新任务');
  assert.ok(noBody.description.includes('完成状态'));

  const truncated = getAuditActionDisplay({
    method: 'PUT',
    path: '/api/tasks/item',
    requestBody: '{"field":"color","value":"#ffffff"... [truncated 10 chars]'
  });
  assert.strictEqual(truncated.label, '更新任务');
});

test('只对任务更新的 PUT 生效，其他方法与路径不受影响', () => {
  assert.strictEqual(getTaskItemUpdateDisplay('POST', '/api/tasks/item', { field: 'color', value: '#ffffff' }), null);
  assert.strictEqual(getTaskItemUpdateDisplay('PUT', '/api/designers', { field: 'color', value: '#ffffff' }), null);
  assert.strictEqual(getAuditActionDisplay({ method: 'POST', path: '/api/tasks/item', requestBody: '{}' }).label, '添加任务');
});
