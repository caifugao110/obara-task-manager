'use strict';
/**
 * 状态跟踪数据（statusTrackingItems）的行级存储
 *
 * 为什么迁：这是 kv_store 里最大且最常改的集合——线上 268 条 / 167 KB。
 * 原先改一条状态跟踪（勾一个确认数量）要把整个数组序列化后整段写回，
 * 一次点击换来 167 KB 的磁盘写与 WAL 膨胀。
 *
 * 形状：一维数组，元素带唯一 id，顺序即展示顺序。实现复用 rowCollectionStore
 * （一维数组集合的通用行存储）：行级脏检查、位置比较、迁移与失败回退都在工厂里。
 */
const { createArrayStore } = require('./rowCollectionStore');

const store = createArrayStore({
  table: 'status_tracking_items',
  kvKey: 'statusTrackingItems',
  label: '状态跟踪',
});

module.exports = {
  ...store,
  // 历史调用名（db.js 早期就用的名字），改名没有收益，保留别名
  resolveItemsForLoad: store.resolveForLoad,
};
