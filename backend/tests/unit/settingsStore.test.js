'use strict';
/**
 * 系统设置按键行存储（settingsStore）的单元测试
 *
 * settings 与数组集合不同：它是「14 个顶层键的对象」，改一个开关只该写一个键。
 * 这里钉死三件事：键顺序保留、按键脏检查、迁移失败不丢数据。
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const store = require('../../settingsStore');

const TEST_BACKUP_DIR = path.join(os.tmpdir(), 'obara-test-backups');

const freshDb = () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  store.resetCache();
  return db;
};

const sample = () => ({
  leaderboard: { enabled: true, allowAdmins: true },
  workHours: { enabled: true, allowViewers: false },
  system: { allowMultiDevice: true, specNumberDigits: 5 },
});

const keyCount = (db) => Number(db.prepare(`SELECT COUNT(*) AS c FROM ${store.ROW_TABLE}`).get().c);
const payloadOf = (db, key) => {
  const row = db.prepare(`SELECT payload FROM ${store.ROW_TABLE} WHERE key = ?`).get(key);
  return row ? JSON.parse(row.payload) : null;
};

test('空表 load 返回 null', () => {
  const db = freshDb();
  assert.equal(store.isEmpty(db), true);
  assert.equal(store.load(db), null);
});

test('persist 后 load 还原对象，且键顺序保持不变', () => {
  const db = freshDb();
  const settings = sample();
  assert.equal(store.persist(db, settings).written, 3);
  store.resetCache();

  const loaded = store.load(db);
  assert.deepEqual(loaded, settings);
  assert.deepEqual(Object.keys(loaded), ['leaderboard', 'workHours', 'system']);
});

test('改一个键只写一行', () => {
  const db = freshDb();
  const settings = sample();
  store.persist(db, settings);

  settings.system.specNumberDigits = 6;
  const result = store.persist(db, settings);
  assert.equal(result.written, 1);
  assert.equal(result.unchanged, 2);
  assert.equal(payloadOf(db, 'system').specNumberDigits, 6);
  assert.equal(payloadOf(db, 'leaderboard').enabled, true);
});

test('内容没变时不写库', () => {
  const db = freshDb();
  const settings = sample();
  store.persist(db, settings);
  const again = store.persist(db, settings);
  assert.equal(again.written, 0);
  assert.equal(again.deleted, 0);
});

test('新增键只写一行，删除键要删行', () => {
  const db = freshDb();
  const settings = sample();
  store.persist(db, settings);

  settings.ipBlacklist = { enabled: false, entries: [] };
  assert.equal(store.persist(db, settings).written, 1);
  assert.equal(keyCount(db), 4);

  delete settings.workHours;
  const result = store.persist(db, settings);
  assert.equal(result.deleted, 1);
  assert.equal(keyCount(db), 3);
  assert.equal(payloadOf(db, 'workHours'), null);

  store.resetCache();
  assert.deepEqual(Object.keys(store.load(db)), ['leaderboard', 'system', 'ipBlacklist']);
});

test('非对象输入按空对象处理', () => {
  const db = freshDb();
  store.persist(db, null);
  store.persist(db, [1, 2, 3]);
  assert.equal(keyCount(db), 0);
});

test('migrateFromKv：写行表并删掉 kv 旧 key', () => {
  const db = freshDb();
  const settings = sample();
  db.prepare('INSERT INTO kv_store (key, value) VALUES (?, ?)').run('settings', JSON.stringify(settings));

  const result = store.migrateFromKv(db, settings);
  assert.equal(result.keys, 3);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM kv_store WHERE key = ?').get('settings').c, 0);

  store.resetCache();
  assert.deepEqual(store.load(db), settings);
});

test('migrateFromKv：行表写不进去时保留 kv 数据', () => {
  const db = freshDb();
  const settings = sample();
  db.prepare('INSERT INTO kv_store (key, value) VALUES (?, ?)').run('settings', JSON.stringify(settings));

  db.exec(`DROP TABLE IF EXISTS ${store.ROW_TABLE}; CREATE VIEW ${store.ROW_TABLE} AS SELECT 1 AS key;`);
  assert.throws(() => store.migrateFromKv(db, settings));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM kv_store WHERE key = ?').get('settings').c, 1);
});

test('resolveForLoad：行表优先 → kv 迁移 → null', () => {
  const db = freshDb();
  assert.deepEqual(store.resolveForLoad(db, {}, { backupDir: TEST_BACKUP_DIR }), { settings: null, migrated: false });

  const kvData = { settings: sample() };
  const migrated = store.resolveForLoad(db, kvData, { backupDir: TEST_BACKUP_DIR });
  assert.equal(migrated.migrated, true);
  assert.deepEqual(migrated.settings, kvData.settings);

  store.resetCache();
  const again = store.resolveForLoad(db, { settings: { other: 1 } }, { backupDir: TEST_BACKUP_DIR });
  assert.equal(again.migrated, false);
  assert.deepEqual(Object.keys(again.settings), ['leaderboard', 'workHours', 'system']);
});
