/**
 * 冒烟测试：枪名搜索（含任务归属）与「确认图修改」快速添加
 * 用法：SMOKE_DB_PATH=<快照副本路径> node tests/gun-search-relational.js
 * 注意：必须在数据库「快照副本」上运行（run-all.js 会自动生成快照）
 *
 * 覆盖：
 * - GET /api/tasks/gun-name-search 仅管理员可用（普通用户 403）
 * - 命中枪名时回传该枪名所在任务的设计员（默认设计人员来源）
 * - q 为空时被拒绝（400）：接口不支持空查询
 * - 搜索范围：默认只看指定月份（弹窗「全表搜索」关闭），allMonths=true 时搜所有月份
 * - 按快捷键的写入路径（POST /api/tasks/item/batch）可创建「确认图修改」任务
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

const ADMIN_ID = 'test-admin-gun-search';
const ADMIN_SESSION = 'test-session-gun-search-admin';
const USER_ID = 'test-user-gun-search';
const USER_SESSION = 'test-session-gun-search-user';
const DESIGNER_ID = 'designer-gun-search';
const DATE = '2026-10-29';
const GUN_NAME = 'SRTC-TEST-GUN-0001';
const GUN_NAME_OTHER = 'SRTC-TEST-GUN-0002';

const setupUsers = async () => {
  db.init();
  const data = db.readDb();
  data.users = (data.users || []).filter(u => u.id !== ADMIN_ID && u.id !== USER_ID);
  data.users.push(
    {
      id: ADMIN_ID,
      username: 'test-admin-gun-search',
      name: '枪名搜索测试管理员',
      role: 'admin',
      password: 'x',
      sessionToken: ADMIN_SESSION,
      sessionTokens: [ADMIN_SESSION],
      disabled: false,
      forcePasswordChange: false
    },
    {
      id: USER_ID,
      username: 'test-user-gun-search',
      name: '枪名搜索测试普通用户',
      role: 'user',
      password: 'x',
      sessionToken: USER_SESSION,
      sessionTokens: [USER_SESSION],
      disabled: false,
      forcePasswordChange: false
    }
  );
  await db.writeDb(data);
};

const signToken = (userId, username, sessionId) => jwt.sign(
  { id: userId, username, sessionId },
  securityConfig.jwt.secret,
  { algorithm: 'HS256', issuer: securityConfig.jwt.issuer, audience: securityConfig.jwt.audience, expiresIn: '1h' }
);

const main = async () => {
  await setupUsers();

  const app = express();
  app.use(express.json());
  app.use('/api/tasks', tasksRouter);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken(ADMIN_ID, 'test-admin-gun-search', ADMIN_SESSION)}` };
  const userHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken(USER_ID, 'test-user-gun-search', USER_SESSION)}` };

  let createdSheetId = null;
  let otherSheetId = null;
  try {
    // 先造一条含目标枪名的确认图任务，作为「枪名归属」的数据源
    const createRes = await fetch(`${base}/api/tasks/item`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        designerId: DESIGNER_ID,
        date: DATE,
        taskName: '19999>测试客户 确认图',
        hours: 1.5,
        color: '#86efac',
        guns: [{ id: 'g-gun-search-1', name: GUN_NAME, hours: 1.5, color: '#86efac' }]
      })
    });
    const created = await createRes.json();
    createdSheetId = created.sheetId || null;
    assert(createRes.status === 201 && created.item?.id, '创建含枪名的确认图任务成功');

    // 1. 权限：普通用户不可用
    const forbidden = await fetch(`${base}/api/tasks/gun-name-search?q=${encodeURIComponent(GUN_NAME)}`, { headers: userHeaders });
    assert(forbidden.status === 403, '普通用户调用枪名搜索返回 403');

    // 2. 命中枪名 + 归属设计员（显式限定月份，默认范围就是「当前月份」）
    const searchRes = await fetch(`${base}/api/tasks/gun-name-search?q=${encodeURIComponent(GUN_NAME)}&year=2026&month=10`, { headers: adminHeaders });
    const searchBody = await searchRes.json();
    const hit = (searchBody.results || []).find(r => r.gunName === GUN_NAME);
    assert(searchRes.status === 200, '管理员枪名搜索返回 200');
    assert(Boolean(hit), '搜索结果命中目标枪名');
    assert(hit?.owners?.[0]?.designerId === DESIGNER_ID, '枪名归属回传了所在任务的设计员');
    assert(hit?.owners?.[0]?.taskName === '19999>测试客户 确认图', '枪名归属回传了所在任务名');

    // 3. 搜索范围：默认只看指定月份，allMonths=true 才搜全表
    const otherRes = await fetch(`${base}/api/tasks/item`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        designerId: DESIGNER_ID,
        date: '2026-08-12',
        taskName: '19998>历史客户 确认图',
        hours: 1,
        color: '#86efac',
        guns: [{ id: 'g-gun-search-2', name: GUN_NAME_OTHER, hours: 1 }]
      })
    });
    const otherCreated = await otherRes.json();
    otherSheetId = otherCreated.sheetId || null;
    assert(otherRes.status === 201, '创建另一月份的枪名任务成功');

    const SCOPE_KEYWORD = 'SRTC-TEST-GUN';
    const monthScopeRes = await fetch(`${base}/api/tasks/gun-name-search?q=${SCOPE_KEYWORD}&year=2026&month=10&limit=50`, { headers: adminHeaders });
    const monthScopeNames = ((await monthScopeRes.json()).results || []).map(r => r.gunName);
    assert(monthScopeNames.includes(GUN_NAME), '限定月份时命中当月的枪名');
    assert(!monthScopeNames.includes(GUN_NAME_OTHER), '限定月份时不返回其他月份的枪名');

    const otherMonthRes = await fetch(`${base}/api/tasks/gun-name-search?q=${SCOPE_KEYWORD}&year=2026&month=8&limit=50`, { headers: adminHeaders });
    const otherMonthNames = ((await otherMonthRes.json()).results || []).map(r => r.gunName);
    assert(otherMonthNames.includes(GUN_NAME_OTHER), '切换到 8 月时命中 8 月的枪名');
    assert(!otherMonthNames.includes(GUN_NAME), '切换到 8 月时不返回 10 月的枪名');

    const allScopeRes = await fetch(`${base}/api/tasks/gun-name-search?q=${SCOPE_KEYWORD}&allMonths=true&limit=50`, { headers: adminHeaders });
    const allScopeNames = ((await allScopeRes.json()).results || []).map(r => r.gunName);
    assert(allScopeNames.includes(GUN_NAME) && allScopeNames.includes(GUN_NAME_OTHER), '开启全表搜索后命中所有月份的枪名');

    // 4. 空查询（或纯空格）被拒绝：接口不支持「最近安排过的枪名」
    const emptyRes = await fetch(`${base}/api/tasks/gun-name-search`, { headers: adminHeaders });
    assert(emptyRes.status === 400, '空查询枪名搜索返回 400');
    const blankRes = await fetch(`${base}/api/tasks/gun-name-search?q=%20%20`, { headers: adminHeaders });
    assert(blankRes.status === 400, '纯空格查询枪名搜索返回 400');

    // 5. 快捷键的写入路径：批量接口创建「确认图修改」任务
    const quickRes = await fetch(`${base}/api/tasks/item/batch`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        designerId: DESIGNER_ID,
        date: DATE,
        items: [{
          taskName: '19999>测试客户 确认图修改',
          hours: 0.75,
          color: '#86efac',
          guns: [{ id: 'g-quick-1', name: GUN_NAME, hours: 0.75 }],
          leaveType: null
        }]
      })
    });
    const quickBody = await quickRes.json();
    assert(quickRes.status === 201, '快捷添加（批量创建）返回 201');
    const dayItems = quickBody.sheet?.days?.[DATE] || [];
    assert(
      dayItems.some(i => i.taskName === '19999>测试客户 确认图修改' && i.guns?.[0]?.name === GUN_NAME && i.hours === 0.75),
      '确认图修改任务已写入目标设计员当天'
    );

    // 6. 重复枪名（同一任务内）应被拒绝，避免快捷键写入脏数据
    const dupRes = await fetch(`${base}/api/tasks/item/batch`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        designerId: DESIGNER_ID,
        date: DATE,
        items: [{ taskName: '19999>测试客户 确认图修改', hours: 0.75, guns: [
          { id: 'g-dup-1', name: GUN_NAME, hours: 0.75 },
          { id: 'g-dup-2', name: GUN_NAME, hours: 0.75 }
        ] }]
      })
    });
    assert(dupRes.status === 400, '同一任务内重复枪名被拒绝');
  } finally {
    server.close();
    const sheetIds = [createdSheetId, otherSheetId].filter(Boolean);
    if (sheetIds.length > 0) taskStore.deleteSheetsByIds?.(sheetIds);
  }
};

main().catch(err => {
  console.error('FAIL: 测试执行异常', err);
  process.exitCode = 1;
});
