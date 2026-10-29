/**
 * 冒烟测试：主任务改色时子枪名颜色联动
 * 用法：SMOKE_DB_PATH=<快照副本路径> node tests/color-sync-relational.js
 * 注意：必须在数据库「快照副本」上运行（run-all.js 会自动生成快照）
 *
 * 覆盖规则：
 * - 主任务改色 → 整条任务回到「未完成」：所有子枪名（普通/已标白/无色）统一变成新颜色；
 * - 主任务改色 → 各枪名自己的 colorBeforeUserMark / colorMarkedBy 恢复记录一并清掉，
 *   避免后续「取消完成」时枪名跳回旧颜色。
 */
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');

if (!process.env.SMOKE_DB_PATH) {
  console.error('缺少 SMOKE_DB_PATH：本测试会写入数据，必须指向数据库快照副本');
  process.exit(1);
}
process.env.SQLITE_DB_PATH = process.env.SMOKE_DB_PATH;

const backendRoot = path.resolve(__dirname, '..');
const securityConfig = require(path.join(backendRoot, 'config/security'));
const db = require(path.join(backendRoot, 'db'));
const taskStore = require(path.join(backendRoot, 'taskStore'));
const tasksRouter = require(path.join(backendRoot, 'routes/tasks'));

const assert = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`);
  if (!cond) process.exitCode = 1;
};

const ADMIN_ID = 'test-admin-color-sync';
const SESSION_ID = 'test-session-color-sync';
const DESIGNER_ID = 'designer-color-sync';
const DATE = '2026-10-29';

const setupAdmin = async () => {
  db.init();
  const data = db.readDb();
  data.users = (data.users || []).filter(u => u.id !== ADMIN_ID);
  data.users.push({
    id: ADMIN_ID,
    username: 'test-admin-color-sync',
    name: '颜色联动测试管理员',
    role: 'admin',
    password: 'x',
    sessionToken: SESSION_ID,
    sessionTokens: [SESSION_ID],
    disabled: false,
    forcePasswordChange: false
  });
  await db.writeDb(data);
};

const main = async () => {
  await setupAdmin();

  const app = express();
  app.use(express.json());
  app.use('/api/tasks', tasksRouter);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const token = jwt.sign(
    { id: ADMIN_ID, username: 'test-admin-color-sync', name: '颜色联动测试管理员', role: 'admin', sessionId: SESSION_ID },
    securityConfig.jwt.secret,
    { algorithm: 'HS256', issuer: securityConfig.jwt.issuer, audience: securityConfig.jwt.audience, expiresIn: '1h' }
  );
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  try {
    const createRes = await fetch(`${base}/api/tasks/item`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        designerId: DESIGNER_ID,
        date: DATE,
        taskName: '58579>宁波长胜_马来西亚ITSB-AMA05 确认图',
        hours: 3,
        color: '#fca5a5',
        guns: [
          { id: 'g1', name: 'SRTX-5AC24064', hours: 2, color: '#93c5fd' },
          { id: 'g2', name: 'SRTX-XXXXXXX', hours: 1, color: '#ffffff', colorBeforeUserMark: '#93c5fd' },
          { id: 'g3', name: 'SRTX-NOCOLOR01', hours: 1, color: '' }
        ]
      })
    });
    const created = await createRes.json();
    assert(createRes.status === 201 && created.item?.id, '创建测试任务成功');
    const itemId = created.item?.id;
    if (!itemId) return;

    const updRes = await fetch(`${base}/api/tasks/item`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ designerId: DESIGNER_ID, date: DATE, itemId, field: 'color', value: '#fbbf24' })
    });
    const upd = await updRes.json();
    assert(updRes.status === 200, '主任务改色请求成功');
    assert(upd.item?.color === '#fbbf24', '主任务颜色已变更');
    assert(upd.item?.guns?.[0]?.color === '#fbbf24', '普通枪名颜色跟随主任务');
    assert(
      !Object.prototype.hasOwnProperty.call(upd.item?.guns?.[0] || {}, 'colorBeforeUserMark'),
      '普通枪名旧的恢复记录已清理'
    );
    // 原先全白（已完成）的枪名：改主任务颜色后也要变回未完成状态
    assert(upd.item?.guns?.[1]?.color === '#fbbf24', '已标白枪名跟着变为主任务新颜色（回到未完成）');
    assert(
      !Object.prototype.hasOwnProperty.call(upd.item?.guns?.[1] || {}, 'colorBeforeUserMark'),
      '已标白枪名的恢复记录已清理'
    );
    assert(
      !Object.prototype.hasOwnProperty.call(upd.item?.guns?.[1] || {}, 'colorMarkedBy'),
      '已标白枪名的标记来源已清理'
    );
    assert(upd.item?.guns?.[2]?.color === '#fbbf24', '无颜色枪名也统一为新颜色');

    const sheet = taskStore.getSheet(DESIGNER_ID, 10, 2026);
    const savedItem = sheet?.days?.[DATE]?.find(i => i.id === itemId);
    assert(savedItem?.guns?.[0]?.color === '#fbbf24', '子枪名新颜色已持久化');
    assert(savedItem?.guns?.[1]?.color === '#fbbf24', '已标白枪名的新颜色已持久化');
    assert(
      !Object.prototype.hasOwnProperty.call(savedItem?.guns?.[1] || {}, 'colorBeforeUserMark'),
      '已标白枪名的恢复记录已落库清理'
    );
  } finally {
    server.close();
    taskStore.deleteSheetsByIds?.([taskStore.getSheet(DESIGNER_ID, 10, 2026)?.id].filter(Boolean));
  }
};

main().catch(err => {
  console.error('FAIL: 测试执行异常', err);
  process.exitCode = 1;
});
