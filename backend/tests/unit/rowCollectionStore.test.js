'use strict';
/**
 * 一维数组集合行存储工厂（rowCollectionStore）的单元测试
 *
 * users / designers / statusTrackingItems 三个集合共用这套实现，所以这里要把
 * 「行级脏检查、位置变化、删除、迁移、失败回退」逐条钉死：
 * 任何一个语义错，三个集合会一起错。
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createArrayStore } = require('../../rowCollectionStore');

// 迁移会写 JSON 备份，必须指向临时目录，别污染真实的 backend/backups/database
const TEST_BACKUP_DIR = path.join(os.tmpdir(), 'obara-test-backups');

const freshDb = () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  return db;
};

const makeStore = () => createArrayStore({ table: 'demo_items', kvKey: 'demoItems', label: '测试集合' });

const item = (id, over = {}) => ({ id, name: `项-${id}`, ...over });
const sample = () => [item('a'), item('b'), item('c')];

const rowCount = (db, table = 'demo_items') => Number(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c);
const payloadOf = (db, key, table = 'demo_items') => {
  const row = db.prepare(`SELECT payload FROM ${table} WHERE key = ?`).get(key);
  return row ? JSON.parse(row.payload) : null;
};
const positionOf = (db, key) => db.prepare(`SELECT position FROM demo_items WHERE key = ?`).get(key)?.position;

test('空表 load 返回 null，isEmpty 为 true', () => {
  const db = freshDb();
  const store = makeStore();
  assert.equal(store.isEmpty(db), true);
  assert.equal(store.load(db), null);
});

test('persist 后 load 还原出完全一致的内容与顺序', () => {
  const db = freshDb();
  const store = makeStore();
  const items = sample();
  assert.equal(store.persist(db, items).written, 3);
  store.resetCache();
  assert.deepEqual(store.load(db), items);
});

test('改一条只写一行', () => {
  const db = freshDb();
  const store = makeStore();
  const items = sample();
  store.persist(db, items);

  items[1].name = '改过的';
  const result = store.persist(db, items);
  assert.equal(result.written, 1);
  assert.equal(result.unchanged, 2);
  assert.equal(payloadOf(db, 'b').name, '改过的');
  assert.equal(payloadOf(db, 'a').name, '项-a');
});

test('内容没变时不写库', () => {
  const db = freshDb();
  const store = makeStore();
  const items = sample();
  store.persist(db, items);
  const again = store.persist(db, items);
  assert.equal(again.written, 0);
  assert.equal(again.deleted, 0);
});

test('只调顺序也要写库，且 load 按新顺序返回', () => {
  const db = freshDb();
  const store = makeStore();
  const items = sample();
  store.persist(db, items);

  const reordered = [items[2], items[0], items[1]];
  assert.equal(store.persist(db, reordered).written, 3);
  assert.equal(positionOf(db, 'c'), 0);

  store.resetCache();
  assert.deepEqual(store.load(db).map(x => x.id), ['c', 'a', 'b']);
});

test('删除条目会删行，后面的位置前移', () => {
  const db = freshDb();
  const store = makeStore();
  const items = sample();
  store.persist(db, items);

  const result = store.persist(db, items.filter(x => x.id !== 'b'));
  assert.equal(result.deleted, 1);
  assert.equal(rowCount(db), 2);
  assert.equal(payloadOf(db, 'b'), null);
  assert.equal(positionOf(db, 'c'), 1);
});

test('没有主键的条目按位置建 key，不互相覆盖', () => {
  const db = freshDb();
  const store = makeStore();
  store.persist(db, [{ name: 'X' }, { name: 'Y' }]);
  assert.equal(rowCount(db), 2);
  store.resetCache();
  assert.deepEqual(store.load(db).map(x => x.name), ['X', 'Y']);
});

test('非数组输入按空数组处理', () => {
  const db = freshDb();
  const store = makeStore();
  store.persist(db, null);
  store.persist(db, { not: 'array' });
  assert.equal(rowCount(db), 0);
});

test('migrateFromKv：写行表并删掉 kv 旧 key', () => {
  const db = freshDb();
  const store = makeStore();
  const items = sample();
  db.prepare('INSERT INTO kv_store (key, value) VALUES (?, ?)').run('demoItems', JSON.stringify(items));

  const result = store.migrateFromKv(db, items);
  assert.equal(result.items, 3);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM kv_store WHERE key = ?').get('demoItems').c, 0);
  store.resetCache();
  assert.deepEqual(store.load(db), items);
});

test('migrateFromKv：行表写不进去时保留 kv 数据', () => {
  const db = freshDb();
  const store = makeStore();
  const items = sample();
  db.prepare('INSERT INTO kv_store (key, value) VALUES (?, ?)').run('demoItems', JSON.stringify(items));

  db.exec('DROP TABLE IF EXISTS demo_items; CREATE VIEW demo_items AS SELECT 1 AS key;');
  assert.throws(() => store.migrateFromKv(db, items));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM kv_store WHERE key = ?').get('demoItems').c, 1);
});

test('resolveForLoad：行表优先 → kv 迁移 → null', () => {
  const db = freshDb();
  const store = makeStore();
  assert.deepEqual(store.resolveForLoad(db, {}, { backupDir: TEST_BACKUP_DIR }), { items: null, migrated: false });

  const kvData = { demoItems: sample() };
  const migrated = store.resolveForLoad(db, kvData, { backupDir: TEST_BACKUP_DIR });
  assert.equal(migrated.migrated, true);
  assert.deepEqual(migrated.items, kvData.demoItems);

  store.resetCache();
  const again = store.resolveForLoad(db, { demoItems: [item('zzz')] }, { backupDir: TEST_BACKUP_DIR });
  assert.equal(again.migrated, false);
  assert.deepEqual(again.items.map(x => x.id), ['a', 'b', 'c']);
});

test('两个 store 实例互不干扰（各自的表与脏检查基线）', () => {
  const db = freshDb();
  const storeA = createArrayStore({ table: 'table_a', kvKey: 'collectionA', label: 'A' });
  const storeB = createArrayStore({ table: 'table_b', kvKey: 'collectionB', label: 'B' });

  storeA.persist(db, sample());
  storeB.persist(db, [item('x')]);
  assert.equal(rowCount(db, 'table_a'), 3);
  assert.equal(rowCount(db, 'table_b'), 1);
  assert.equal(storeA.load(db).length, 3);
  assert.equal(storeB.load(db).length, 1);
});
