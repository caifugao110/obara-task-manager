'use strict';
/**
 * 用户账号（users）的行级存储
 *
 * 为什么迁：虽然只有 30 来个账号 / 8 KB，但它是**鉴权热路径**上的集合——
 * 每个请求的 authMiddleware 都要读它，而任何一处用户改动（改密、登录时间、会话令牌轮换）
 * 原先都会把整个 users 数组序列化写回 kv_store。登录时写 lastLoginAt 是最典型的例子：
 * 一次登录 = 8 KB 重写 + WAL 增长，而且和并发请求抢同一把写锁。
 *
 * 形状：一维数组，元素带唯一 id。与 statusTrackingItems 同构，直接复用工厂。
 * 注意：payload 里含密码哈希与会话令牌，与原先存在 kv_store 时完全一致，
 * 备份文件（迁移前快照）同样包含这些字段，属于内部文件、不要外发。
 */
const { createArrayStore } = require('./rowCollectionStore');

module.exports = createArrayStore({
  table: 'users',
  kvKey: 'users',
  label: '用户账号',
});
