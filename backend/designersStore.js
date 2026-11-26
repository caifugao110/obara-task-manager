'use strict';
/**
 * 设计人员（designers）的行级存储
 *
 * 为什么迁：只有 20 来个设计员 / 2 KB，但「隐藏某个设计员」「调整顺序」这类操作
 * 都会整段重写数组；而且设计员列表每次登录、每次权限校验都会被读到，
 * 留着整段 JSON 只是让写路径承担无意义的体量。
 *
 * 形状：一维数组，元素带唯一 id，`order` 字段表示展示顺序（与数组顺序一致）。
 */
const { createArrayStore } = require('./rowCollectionStore');

module.exports = createArrayStore({
  table: 'designers',
  kvKey: 'designers',
  label: '设计人员',
});
