/**
 * 冒烟测试：tasks 关系表 CRUD + loginLogs 独立表读写
 * 用法：SQLITE_DB_PATH=<副本路径> node tests/smoke-relational.js
 * 注意：必须在数据库「副本」上运行，测试会写入并删除数据
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

// 触发 init（加载缓存）
db.init();

// 1. 写入路径：saveSheet / getOrCreateSheet / 删除
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

// 2. 登录日志写入
db.appendLoginLogEntry({ username: 'smoke', success: true, action: 'login', ip: '127.0.0.1' });
const logs = db.listLoginLogs();
assert(logs[0].username === 'smoke' && logs[0].success === true, 'appendLoginLogEntry 写入且布尔还原');

// 3. 缓存不含 tasks/loginLogs（分别由关系表/独立表承载）
const cache = db.readDb();
assert(cache.tasks === undefined, 'readDb 缓存不含 tasks');
assert(cache.loginLogs === undefined, 'readDb 缓存不含 loginLogs');

console.log(process.exitCode ? '\n[smoke] 存在失败项' : '\n[smoke] 全部通过');
