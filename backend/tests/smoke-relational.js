/**
 * 冒烟测试：tasks 关系化 + loginLogs 独立表迁移
 * 用法：SQLITE_DB_PATH=<副本路径> node tests/smoke-relational.js
 * 注意：必须在数据库「副本」上运行，迁移会修改库内容（删除 kv_store.tasks/loginLogs 行）
 */
process.env.SQLITE_DB_PATH = process.env.SMOKE_DB_PATH || process.env.SQLITE_DB_PATH;

const db = require('../db');
const taskStore = require('../taskStore');

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${msg}`);
  }
};

// 迁移前的原始数据（直接从 kv_store 读，不走缓存）
const Database = require('better-sqlite3');
const path = require('path');
const securityConfig = require('../config/security');
const rawPath = path.resolve(__dirname, '..', securityConfig.database.sqlitePath);
const raw = new Database(rawPath);
const kvTasksRow = raw.prepare("SELECT value FROM kv_store WHERE key = 'tasks'").get();
const kvLoginRow = raw.prepare("SELECT value FROM kv_store WHERE key = 'loginLogs'").get();
const legacyTasks = kvTasksRow ? JSON.parse(kvTasksRow.value) : null;
const legacyLoginLogs = kvLoginRow ? JSON.parse(kvLoginRow.value) : null;
raw.close();

console.log(`[smoke] 迁移前 kv 数据: tasks=${legacyTasks ? legacyTasks.length + ' sheets' : 'N/A'}, loginLogs=${legacyLoginLogs ? legacyLoginLogs.length + ' 条' : 'N/A'}`);

// 触发 init + 迁移
db.init();

// 1. tasks 迁移
if (legacyTasks && legacyTasks.length > 0) {
  const legacyItemCount = legacyTasks.reduce((sum, s) => sum + Object.values(s.days || {}).reduce((d, items) => d + (Array.isArray(items) ? items.length : 0), 0), 0);
  assert(taskStore.countSheets() === legacyTasks.length, `sheets 数量一致 (${taskStore.countSheets()} == ${legacyTasks.length})`);
  assert(taskStore.countEntries() === legacyItemCount, `条目数量一致 (${taskStore.countEntries()} == ${legacyItemCount})`);

  // 抽样深度比对：随机取 5 张表，装配结果与原 JSON 逐项比较
  const sample = legacyTasks.slice(0, 5);
  for (const legacySheet of sample) {
    const designerId = legacySheet.designerId || legacySheet.userId;
    const assembled = taskStore.getSheet(designerId, legacySheet.month, legacySheet.year);
    assert(assembled !== null, `表可装配: ${designerId} ${legacySheet.year}-${legacySheet.month}`);
    if (!assembled) continue;
    const legacyDates = Object.keys(legacySheet.days || {}).sort();
    const assembledDates = Object.keys(assembled.days || {}).sort();
    assert(JSON.stringify(legacyDates) === JSON.stringify(assembledDates), `日期集合一致: ${assembled.id}`);
    let itemsEqual = true;
    for (const date of legacyDates) {
      if (JSON.stringify(legacySheet.days[date]) !== JSON.stringify(assembled.days[date])) {
        itemsEqual = false;
        console.error(`  差异日期: ${date}`);
        break;
      }
    }
    assert(itemsEqual, `条目内容深度一致: ${assembled.id}`);
  }

  // kv 行已删除
  const rawDb = db.getRawDb();
  assert(!rawDb.prepare("SELECT value FROM kv_store WHERE key = 'tasks'").get(), 'kv_store.tasks 已摘除');

  // 幂等：再次 init（模拟重启）数据不变
  const sheetsBefore = taskStore.countSheets();
  const entriesBefore = taskStore.countEntries();
  taskStore.migrateFromCache(undefined);
  assert(taskStore.countSheets() === sheetsBefore && taskStore.countEntries() === entriesBefore, '重复迁移幂等（数量不变）');
}

// 2. loginLogs 迁移
if (legacyLoginLogs && legacyLoginLogs.length > 0) {
  assert(db.countLoginLogs() === legacyLoginLogs.length, `loginLogs 数量一致 (${db.countLoginLogs()} == ${legacyLoginLogs.length})`);
  const first = legacyLoginLogs[legacyLoginLogs.length - 1]; // 最新一条
  const listed = db.listLoginLogs();
  const found = listed.find(l => l.id === first.id);
  assert(found !== undefined, '最新登录日志可查');
  if (found) {
    assert(Boolean(found.success) === Boolean(first.success), `success 布尔还原一致 (${found.success} == ${first.success})`);
  }
  const rawDb = db.getRawDb();
  assert(!rawDb.prepare("SELECT value FROM kv_store WHERE key = 'loginLogs'").get(), 'kv_store.loginLogs 已摘除');
}

// 3. 写入路径：saveSheet / getOrCreateSheet / 删除
const testSheet = taskStore.getOrCreateSheet('smoke-designer', 9, 2026);
testSheet.days['2026-09-26'] = [
  { id: 'smoke-item-1', taskName: '冒烟任务A', hours: 2, color: '', guns: [{ id: 'g1', name: '枪A', hours: 1 }], leaveType: null },
  { id: 'smoke-item-2', taskName: '冒烟任务B', hours: 3.5, color: '#ffffff', guns: [], leaveType: null }
];
taskStore.saveSheet(testSheet);
const reloaded = taskStore.getSheet('smoke-designer', 9, 2026);
assert(reloaded && reloaded.days['2026-09-26'].length === 2, 'saveSheet 后可读回 2 条');
assert(reloaded.days['2026-09-26'][0].guns[0].name === '枪A', '嵌套 guns 结构完整');

// 更新：删一条再保存
reloaded.days['2026-09-26'] = reloaded.days['2026-09-26'].filter(i => i.id !== 'smoke-item-1');
taskStore.saveSheet(reloaded);
const reloaded2 = taskStore.getSheet('smoke-designer', 9, 2026);
assert(reloaded2.days['2026-09-26'].length === 1 && reloaded2.days['2026-09-26'][0].id === 'smoke-item-2', 'saveSheet 覆盖语义正确');

// LIKE 预筛
const candidates = taskStore.findCandidateSheetIds('冒烟任务', { allTable: true });
assert(candidates.includes(reloaded2.id), 'LIKE 预筛命中');
const noHit = taskStore.findCandidateSheetIds('不存在的文本xyz', { allTable: true });
assert(noHit.length === 0, 'LIKE 预筛无误命中');

// 删除（级联删条目）
taskStore.deleteSheetsByIds([reloaded2.id]);
assert(taskStore.getSheet('smoke-designer', 9, 2026) === null, '删除后表不存在');
const orphan = db.getRawDb().prepare("SELECT COUNT(*) AS c FROM task_entries WHERE sheet_id = ?").get(reloaded2.id).c;
assert(Number(orphan) === 0, '条目级联删除');

// 4. 登录日志写入
db.appendLoginLogEntry({ username: 'smoke', success: true, action: 'login', ip: '127.0.0.1' });
const logs = db.listLoginLogs();
assert(logs[0].username === 'smoke' && logs[0].success === true, 'appendLoginLogEntry 写入且布尔还原');

// 5. 缓存不再含 tasks/loginLogs
const cache = db.readDb();
assert(cache.tasks === undefined, 'readDb 缓存不含 tasks');
assert(cache.loginLogs === undefined, 'readDb 缓存不含 loginLogs');

console.log(process.exitCode ? '\n[smoke] 存在失败项' : '\n[smoke] 全部通过');
