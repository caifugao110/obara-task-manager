'use strict';
/**
 * 焊枪台账行级存储（gunLedgerStore）的单元测试
 *
 * 这里守的是三件事：
 *   1. 迁移前后台账内容完全一致（分类顺序、空分类、附加字段都不能丢）；
 *   2. 改一张表只写一行（这是整个迁移的目的，回去就白做了）；
 *   3. 删表要真的把行删掉，不能留孤儿数据。
 * 用内存数据库，不碰 data.db。
 */
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const store = require('../../gunLedgerStore');

const freshDb = () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  store.resetCache();
  return db;
};

const sampleLedger = () => ({
  categories: {
    X2C: [
      { id: 't1', name: 'SRTC', rows: [{ id: 'r1', serialNumber: 1, gunName: 'SRTC-01' }] },
      { id: 't2', name: 'SRTX', rows: [] },
    ],
    // 空分类：前端会显示成空表分组，迁移时必须保留，否则「新增分类还没建表」会凭空消失
    PSW: [],
    GLOBAL: [{ id: 't3', name: 'RBC', rows: [] }],
  },
  defaultResponsiblePersons: ['张啸', '张明'],
});

const rowCount = (db) => Number(db.prepare(`SELECT COUNT(*) AS c FROM ${store.ROW_TABLE}`).get().c);
const payloadOf = (db, key) => {
  const row = db.prepare(`SELECT payload FROM ${store.ROW_TABLE} WHERE key = ?`).get(key);
  return row ? JSON.parse(row.payload) : null;
};

test('空库 load 返回 null（调用方据此决定用默认值还是迁移）', () => {
  const db = freshDb();
  assert.equal(store.isEmpty(db), true);
  assert.equal(store.load(db), null);
});

test('persist 后 load 能还原出完全一致的结构', () => {
  const db = freshDb();
  const ledger = sampleLedger();
  const result = store.persist(db, ledger);
  assert.equal(result.written, 3);
  assert.equal(rowCount(db), 3);

  store.resetCache();
  assert.deepEqual(store.load(db), ledger);
});

test('分类顺序与空分类都被保留', () => {
  const db = freshDb();
  store.persist(db, sampleLedger());

  store.resetCache();
  const loaded = store.load(db);
  assert.deepEqual(Object.keys(loaded.categories), ['X2C', 'PSW', 'GLOBAL']);
  assert.deepEqual(loaded.categories.PSW, []);
});

test('只改一张表时只重写那一行（行级脏检查的核心）', () => {
  const db = freshDb();
  const ledger = sampleLedger();
  store.persist(db, ledger);

  // 模拟「改了一个枪名」：只有 t1 的 payload 变了
  ledger.categories.X2C[0].rows[0].gunName = 'SRTC-01A';
  const result = store.persist(db, ledger);
  assert.equal(result.written, 1, '应当只写 1 张表');
  assert.equal(result.unchanged, 2);
  assert.equal(result.deleted, 0);

  assert.equal(payloadOf(db, 'X2C\u0001t1').rows[0].gunName, 'SRTC-01A');
  assert.equal(payloadOf(db, 'X2C\u0001t2').name, 'SRTX');
});

test('内容没变时完全不写库', () => {
  const db = freshDb();
  const ledger = sampleLedger();
  store.persist(db, ledger);
  const again = store.persist(db, ledger);
  assert.equal(again.written, 0);
  assert.equal(again.deleted, 0);
});

test('新增表只写一张，删除表要删掉对应的行', () => {
  const db = freshDb();
  const ledger = sampleLedger();
  store.persist(db, ledger);

  ledger.categories.X2C.push({ id: 't4', name: 'SRTD', rows: [] });
  assert.equal(store.persist(db, ledger).written, 1);
  assert.equal(rowCount(db), 4);

  ledger.categories.X2C = ledger.categories.X2C.filter(t => t.id !== 't2');
  const removed = store.persist(db, ledger);
  assert.equal(removed.deleted, 1);
  assert.equal(rowCount(db), 3);
  assert.equal(payloadOf(db, 'X2C\u0001t2'), null);
});

test('删除整个分类会连带删掉它的表行', () => {
  const db = freshDb();
  const ledger = sampleLedger();
  store.persist(db, ledger);

  delete ledger.categories.GLOBAL;
  const result = store.persist(db, ledger);
  assert.equal(result.deleted, 1);
  assert.equal(rowCount(db), 2);

  store.resetCache();
  assert.deepEqual(Object.keys(store.load(db).categories), ['X2C', 'PSW']);
});

test('台账附加字段（默认负责人名单）随元数据一起保存', () => {
  const db = freshDb();
  store.persist(db, sampleLedger());
  store.resetCache();
  assert.deepEqual(store.load(db).defaultResponsiblePersons, ['张啸', '张明']);
});

test('表 id 缺失时按位置生成 key，不会互相覆盖', () => {
  const db = freshDb();
  const ledger = { categories: { X2C: [{ name: 'A', rows: [] }, { name: 'B', rows: [] }] } };
  store.persist(db, ledger);
  assert.equal(rowCount(db), 2);

  store.resetCache();
  assert.deepEqual(store.load(db).categories.X2C.map(t => t.name), ['A', 'B']);
});

test('migrateFromKv：写进行表并删除 kv_store 里的旧 key', () => {
  const db = freshDb();
  const ledger = sampleLedger();
  db.prepare('INSERT INTO kv_store (key, value) VALUES (?, ?)').run('gunLedger', JSON.stringify(ledger));

  const result = store.migrateFromKv(db, ledger);
  assert.equal(result.tables, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM kv_store WHERE key = ?').get('gunLedger').c, 0);
  assert.equal(rowCount(db), 3);

  store.resetCache();
  assert.deepEqual(store.load(db), ledger);
});

test('migrateFromKv：行表写入失败时保留 kv_store 数据（不丢台账）', () => {
  const db = freshDb();
  const ledger = sampleLedger();
  db.prepare('INSERT INTO kv_store (key, value) VALUES (?, ?)').run('gunLedger', JSON.stringify(ledger));

  // 故意让行表不可写：删掉表并阻止重建（同名视图占位会让 CREATE TABLE 失败）
  db.exec(`DROP TABLE IF EXISTS ${store.ROW_TABLE}; CREATE VIEW ${store.ROW_TABLE} AS SELECT 1 AS key;`);
  assert.throws(() => store.migrateFromKv(db, ledger));
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM kv_store WHERE key = ?').get('gunLedger').c, 1);
});

test('分类值不是数组时按空分类处理，不抛错', () => {
  const db = freshDb();
  store.persist(db, { categories: { X2C: null, PSW: 'bad' } });
  store.resetCache();
  const loaded = store.load(db);
  assert.deepEqual(loaded.categories, { X2C: [], PSW: [] });
});
