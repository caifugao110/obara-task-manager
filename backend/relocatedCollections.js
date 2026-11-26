'use strict';
/**
 * 已迁出 kv_store 的集合：读写两侧的统一接线
 *
 * 背景：tasks / audit_logs / login_logs / gunLedger / statusTrackingItems / users / designers /
 * settings 先后从 kv_store（一个 key 一整段 JSON）迁到各自的表。每迁一个，db.js 里就要多一段
 * 「读行表，没有就迁移旧 JSON，失败就用旧数据」和「落库时调一次 store」的代码。
 * 几轮之后这些重复逻辑已经开始漂移（有的忘打日志、有的忘了保留旧数据），所以集中到这里：
 * **存储细节仍归各自的 store**，这里只管按表描述逐个调用。
 *
 * 新增一个迁出的集合 = 在 RELOCATED_COLLECTIONS 里加一行 + 写一个 store，db.js 不用改。
 *
 * 到 2026-11 为止 kv_store 已不再承载任何集合：它只作为**旧版本的迁移来源**保留，
 * 集合迁完后里面的行会被逐个删除；表本身留着（老库升级时还要靠它读旧数据）。
 */

const gunLedgerStore = require('./gunLedgerStore');
const statusTrackingStore = require('./statusTrackingStore');
const usersStore = require('./usersStore');
const designersStore = require('./designersStore');
const settingsStore = require('./settingsStore');

/**
 * @property key        内存缓存里的字段名（也是 kv_store 旧 key）
 * @property label      日志里的中文名
 * @property store      提供 resolve/persist/ROW_TABLE 的模块
 * @property resolve    由 store 提供：决定读行表还是迁移旧 JSON
 * @property field      resolve 返回值里承载数据本身的字段
 * @property countField resolve 返回值里承载条数/表数的字段
 * @property unit       日志里的量词
 */
const RELOCATED_COLLECTIONS = [
  { key: 'users', label: '用户账号', store: usersStore, resolve: 'resolveForLoad', field: 'items', countField: 'count', unit: '个账号' },
  { key: 'designers', label: '设计人员', store: designersStore, resolve: 'resolveForLoad', field: 'items', countField: 'count', unit: '名设计员' },
  { key: 'settings', label: '系统设置', store: settingsStore, resolve: 'resolveForLoad', field: 'settings', countField: 'count', unit: '个配置块' },
  { key: 'gunLedger', label: '焊枪台账', store: gunLedgerStore, resolve: 'resolveLedgerForLoad', field: 'ledger', countField: 'tables', unit: '张表' },
  { key: 'statusTrackingItems', label: '状态跟踪', store: statusTrackingStore, resolve: 'resolveItemsForLoad', field: 'items', countField: 'count', unit: '条' },
];

const RELOCATED_KEYS = new Set(RELOCATED_COLLECTIONS.map(item => item.key));

/**
 * 就地填充 data：行表有数据就用行表；没有但 kv 里有旧 JSON 就迁移（store 内部完成备份与事务）。
 * 迁移失败时 store 不会动 kvData，data 里的旧值继续生效，本次启动照常服务，下次启动重试。
 */
const loadRelocated = (database, data) => {
  for (const item of RELOCATED_COLLECTIONS) {
    try {
      const resolved = item.store[item.resolve](database, data);
      if (resolved[item.field]) data[item.key] = resolved[item.field];
      if (resolved.migrated) {
        console.log(
          `[db] ${item.label}已从 kv_store 迁移到 ${item.store.ROW_TABLE}：` +
          `${resolved[item.countField]} ${item.unit}${resolved.backupPath ? `，迁移前快照 ${resolved.backupPath}` : ''}`
        );
      }
    } catch (err) {
      console.error(`[db] ${item.label}迁移失败，继续使用 kv_store 中的旧数据：`, err.message);
    }
  }
  return data;
};

/**
 * 把内存缓存里的这些集合落库。必须在调用方事务里执行：
 * 「改设置 + 改用户」这类复合写要么全成要么全不成。
 */
const persistRelocated = (database, cache) => {
  for (const item of RELOCATED_COLLECTIONS) {
    if (cache[item.key] === undefined) continue;
    item.store.persist(database, cache[item.key]);
  }
};

/** 已迁出集合在行表里的总行数：判断「库是不是空的」时要把它们算进去 */
const relocatedRowCount = (database) =>
  RELOCATED_COLLECTIONS.reduce((sum, item) => sum + item.store.countRows(database), 0);

module.exports = { RELOCATED_COLLECTIONS, RELOCATED_KEYS, loadRelocated, persistRelocated, relocatedRowCount };
