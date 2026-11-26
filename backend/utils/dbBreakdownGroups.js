'use strict';
/**
 * 维护页「主文件体积构成」的分组配置
 *
 * 为什么单独一个文件：这张表每加一张表就要加一行，属于**会持续增长的数据**
 * （2026-11 已经因为存储迁移连加了账号、系统设置、自愈日志等分组）。
 * 留在 1300 行的 dbMaintenance.js 里，每加一行都要在那个文件里翻找位置；
 * 抽出来以后「新增一张表要归到哪一组」只需改这个文件。
 *
 * 规则：`tables` 精确匹配表名，`prefixes` 匹配前缀（用于 monitor_* 这类成组出现的表）；
 * 顺序即页面展示顺序（实际展示还会按体积从大到小排）。
 * 没登记的表会以「未分类对象」出现在页面上——看到它说明该在这里补一行。
 */

const DB_BREAKDOWN_GROUPS = [
  { key: 'audit', label: '审计日志', note: '账号与数据变更留痕', tables: ['audit_logs'] },
  // kv_store 已不承载任何集合（全部迁到行表），只剩老库升级时的迁移残留，单独标出来，
  // 免得维护页上一个几乎空的表占着「业务数据」这个名字
  { key: 'kv', label: '键值残留', note: '已迁出的旧集合（仅老库升级时读取）', tables: ['kv_store'] },
  { key: 'accounts', label: '账号与人员', note: '用户账号与设计人员（行级存储）', tables: ['users', 'designers'] },
  { key: 'settings', label: '系统设置', note: '按顶层键分行存储', tables: ['settings_entries'] },
  // 台账/状态跟踪同样是行存储，体积单独成组，否则会掉进「未分类对象」里
  { key: 'ledger', label: '编号台账', note: '焊枪台账（表级行存储）', tables: ['gun_ledger_tables', 'gun_ledger_meta'] },
  { key: 'statusTracking', label: '状态跟踪', note: '状态跟踪明细（行级存储）', tables: ['status_tracking_items'] },
  { key: 'tasks', label: '任务数据', note: '工作表与任务条目', tables: ['task_sheets', 'task_entries'] },
  { key: 'monitor', label: '运行监测', note: '心跳样本、流量聚合、生命周期事件', prefixes: ['monitor_'] },
  { key: 'login', label: '登录日志', note: '登录成功与失败记录', tables: ['login_logs'] },
  // 自愈日志（仕样/枪名自动修复的执行记录）原先掉进「未分类对象」，读者看不出是什么
  { key: 'selfHeal', label: '自愈日志', note: '自动修复执行记录', tables: ['self_heal_logs'] },
  { key: 'schema', label: '库结构', note: '表定义、自增序列等系统目录', tables: ['sqlite_schema', 'sqlite_sequence'] },
];

/** 分组内条数/说明的展示规则：返回 null 表示用分组自带的 note */
const BREAKDOWN_NOTES = {
  tasks: (item, ctx) => `${ctx.tasksCount} 个工作表，${ctx.taskItemsCount} 条任务记录`,
  ledger: (item, ctx) => {
    const tables = ctx.safeCount('gun_ledger_tables');
    return tables === null ? null : `焊枪台账 ${tables} 张表`;
  },
  statusTracking: (item) => `${item.rows} 条跟踪记录`,
  accounts: (item) => `${item.rows} 个账号与人员`,
  settings: (item) => `${item.rows} 个配置块`,
  login: (item) => `${item.rows} 条记录`,
  audit: (item) => `${item.rows} 条记录`,
  monitor: (item) => `${item.rows} 行样本与聚合`,
};

module.exports = { DB_BREAKDOWN_GROUPS, BREAKDOWN_NOTES };
