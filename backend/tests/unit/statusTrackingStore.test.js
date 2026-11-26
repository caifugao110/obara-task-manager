'use strict';
/**
 * 状态跟踪行级存储（statusTrackingStore）的单元测试
 *
 * 守四件事：
 *   1. 迁移前后内容与顺序完全一致；
 *   2. 改一条只写一行（这是迁移的唯一目的）；
 *   3. 只调顺序也要落库（顺序就是展示顺序）；
 *   4. 迁移失败时 kv_store 里的旧数据必须留着。
 * 用内存数据库，不碰 data.db。
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const store = require('../../statusTrackingStore');

// 迁移会写一份 JSON 备份，测试必须指向临时目录，否则会污染真实的 backend/backups/database
const TEST_BACKUP_DIR = path.join(os.tmpdir(), 'obara-test-backups');

const freshDb = () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  store.resetCache();
  return db;
};

const item = (id, over = {}) => ({ id, sheetName: `表-${id}`, specNumber: id.toUpperCase(), quantity: '8', ...over });

const sample = () => [item('a'), item('b', { shippedCount: 3 }), item('c')];

const rowCount = (db) => Number(db.prepare(`SELECT COUNT(*) AS c FROM ${store.ROW_TABLE}`).get().c);
const payloadOf = (db, key) => {
  const row = db.prepare(`SELECT payload FROM ${store.ROW_TABLE} WHERE key = ?`).get(key);
  return row ? JSON.parse(row.payload) : null;
};
const positionOf = (db, key) => db.prepare(`SELECT position FROM ${store.ROW_TABLE} WHERE key = ?`).get(key)?.position;

test('空表 load 返回 null（调用方据此决定用默认值还是迁移）', () => {
  const db = freshDb();
  assert.equal(store.isEmpty(db), true);
  assert.equal(store.load(db), null);
});

test('persist 后 load 还原出完全一致的内容与顺序', () => {
  const db = freshDb();
  const items = sample();
  assert.equal(store.persist(db, items).written, 3);
  store.resetCache();
  assert.deepEqual(store.load(db), items);
});

test('改一条只写一行', () => {
  const db = freshDb();
  const items = sample();
  store.persist(db, items);

  items[1].shippedCount = 9;
  const result = store.persist(db, items);
  assert.equal(result.written, 1);
  assert.equal(result.unchanged, 2);
  assert.equal(payloadOf(db, 'b').shippedCount, 9);
  assert.equal(payloadOf(db, 'a').shippedCount, undefined);
});

test('内容完全没变时不写库', () => {
  const db = freshDb();
  const items = sample();
  store.persist(db, items);
  const again = store.persist(db, items);
  assert.equal(again.written, 0);
  assert.equal(again.deleted, 0);
});

test('只调整顺序也要落库（拖动排序）', () => {
  const db = freshDb();
  const items = sample();
  store.persist(db, items);

  const reordered = [items[2], items[0], items[1]];
  const result = store.persist(db, reordered);
  assert.equal(result.written, 3, '三条位置都变了，三条都要写');
  assert.equal(positionOf(db, 'c'), 0);
  assert.equal(positionOf(db, 'a'), 1);

  store.resetCache();
  assert.deepEqual(store.load(db).map(x => x.id), ['c', 'a', 'b']);
});

test('新增一条只写一行', () => {
  const db = freshDb();
  const items = sample();
  store.persist(db, items);
  items.push(item('d'));
  assert.equal(store.persist(db, items).written, 1);
  assert.equal(rowCount(db), 4);
});

test('删除一条要真的删行，且后面的位置前移', () => {
  const db = freshDb();
  const items = sample();
  store.persist(db, items);

  const remaining = items.filter(x => x.id !== 'b');
  const result = store.persist(db, remaining);
  assert.equal(result.deleted, 1);
  assert.equal(rowCount(db), 2);
  assert.equal(payloadOf(db, 'b'), null);
  assert.equal(positionOf(db, 'c'), 1, '删掉 b 后 c 从 2 前移到 1');

  store.resetCache();
  assert.deepEqual(store.load(db).map(x => x.id), ['a', 'c']);
});

test('没有 id 的条目按位置建 key，不会互相覆盖', () => {
  const db = freshDb();
  store.persist(db, [{ sheetName: 'X' }, { sheetName: 'Y' }]);
  assert.equal(rowCount(db), 2);
  store.resetCache();
  assert.deepEqual(store.load(db).map(x => x.sheetName), ['X', 'Y']);
});

test('非数组输入按空数组处理', () => {
  const db = freshDb();
  store.persist(db, null);
  assert.equal(rowCount(db), 0);
  store.persist(db, { not: 'array' });
  assert.equal(rowCount(db), 0);
});

test('migrateFromKv：写进行表并删除 kv_store 里的旧 key', () => {
  const db = freshDb();
  const items = sample();
  db.prepare('INSERT INTO kv_store (key, value) VALUES (?, ?)').run('statusTrackingItems', JSON.stringify(items));

  const result = store.migrateFromKv(db, items);
  assert.equal(result.items, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM kv_store WHERE key = ?').get('statusTrackingItems').c, 0);
  assert.equal(rowCount(db), 3);

  store.resetCache();
  assert.deepEqual(store.load(db), items);
});

test('migrateFromKv：行表写不进去时保留 kv 数据（不丢数据）', () => {
  const db = freshDb();
  const items = sample();
  db.prepare('INSERT INTO kv_store (key, value) VALUES (?, ?)').run('statusTrackingItems', JSON.stringify(items));

  db.exec(`DROP TABLE IF EXISTS ${store.ROW_TABLE}; CREATE VIEW ${store.ROW_TABLE} AS SELECT 1 AS key;`);
  assert.throws(() => store.migrateFromKv(db, items));
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM kv_store WHERE key = ?').get('statusTrackingItems').c, 1);
});

test('resolveItemsForLoad：行表优先，其次 kv，最后 null', () => {
  const db = freshDb();
  assert.deepEqual(store.resolveItemsForLoad(db, {}, { backupDir: TEST_BACKUP_DIR }), { items: null, migrated: false });

  const kvData = { statusTrackingItems: sample() };
  const migrated = store.resolveItemsForLoad(db, kvData, { backupDir: TEST_BACKUP_DIR });
  assert.equal(migrated.migrated, true);
  assert.deepEqual(migrated.items, kvData.statusTrackingItems);

  // 第二次启动：行表已有数据，不再迁移，也不再读 kv
  store.resetCache();
  const again = store.resolveItemsForLoad(db, { statusTrackingItems: [item('zzz')] }, { backupDir: TEST_BACKUP_DIR });
  assert.equal(again.migrated, false);
  assert.deepEqual(again.items.map(x => x.id), ['a', 'b', 'c']);
});
