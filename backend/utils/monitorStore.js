/**
 * 监测模块的建表与元数据读写
 *
 * 从 utils/systemMonitor.js 拆出的第二块：**只管 schema 与 monitor_meta**，不持有采样状态。
 * 拆它的原因：建表/回填/元数据与采集、查询逻辑混在一个 2000 行文件里时，
 * 改一次表结构要钻进采集代码中间动刀。
 *
 * 建表幂等，用模块内开关缓存「已就绪」，避免每次采样都重复执行 DDL。
 */
const db = require('../db');

const nowMs = () => Date.now();

let tablesReady = false;

const ensureTables = () => {
  if (tablesReady) return db.getRawDb();
  const raw = db.getRawDb();
  raw.exec(`
    CREATE TABLE IF NOT EXISTS monitor_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts_ms INTEGER NOT NULL,
      ts TEXT NOT NULL,
      boot_id TEXT,
      uptime_sec INTEGER,
      rss_mb REAL,
      heap_mb REAL,
      lag_ms REAL,
      db_ms REAL,
      sockets INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_samples_ms ON monitor_samples(ts_ms);

    CREATE TABLE IF NOT EXISTS monitor_events (
      id TEXT PRIMARY KEY,
      ts_ms INTEGER NOT NULL,
      ts TEXT NOT NULL,
      type TEXT NOT NULL,
      boot_id TEXT,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_events_ms ON monitor_events(ts_ms);

    CREATE TABLE IF NOT EXISTS monitor_traffic_min (
      bucket_ms INTEGER PRIMARY KEY,
      requests INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0,
      slow INTEGER NOT NULL DEFAULT 0,
      duration_sum INTEGER NOT NULL DEFAULT 0,
      duration_max INTEGER NOT NULL DEFAULT 0,
      clients INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS monitor_traffic_path (
      hour_ms INTEGER NOT NULL,
      path TEXT NOT NULL,
      method TEXT NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0,
      duration_sum INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (hour_ms, path, method)
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_traffic_path_ms ON monitor_traffic_path(hour_ms);

    CREATE TABLE IF NOT EXISTS monitor_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- 小时级汇总：图表只读这张表，避免「近半年」查询扫描 50 万行原始样本。
    -- 每 30 秒一次 upsert（累加），代价与写一条采样相当。
    CREATE TABLE IF NOT EXISTS monitor_samples_hour (
      hour_ms INTEGER PRIMARY KEY,
      samples INTEGER NOT NULL DEFAULT 0,
      rss_sum REAL NOT NULL DEFAULT 0,
      rss_max REAL NOT NULL DEFAULT 0,
      heap_sum REAL NOT NULL DEFAULT 0,
      lag_sum REAL NOT NULL DEFAULT 0,
      lag_max REAL NOT NULL DEFAULT 0,
      db_sum REAL NOT NULL DEFAULT 0,
      sockets_max INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS monitor_traffic_hour (
      hour_ms INTEGER PRIMARY KEY,
      requests INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0,
      slow INTEGER NOT NULL DEFAULT 0,
      duration_sum INTEGER NOT NULL DEFAULT 0,
      duration_max INTEGER NOT NULL DEFAULT 0,
      clients INTEGER NOT NULL DEFAULT 0
    );
  `);
  tablesReady = true;
  backfillHourRollups(raw);
  return raw;
};

/**
 * 一次性把已有的分钟/样本数据汇总进小时表。
 * 只在升级后的首次启动执行一次（marker 写入 monitor_meta）。
 */
const backfillHourRollups = (raw) => {
  try {
    const done = raw.prepare("SELECT value FROM monitor_meta WHERE key = 'hourRollupBackfilled'").get();
    if (done) return;
    raw.exec(`
      INSERT INTO monitor_samples_hour (hour_ms, samples, rss_sum, rss_max, heap_sum, lag_sum, lag_max, db_sum, sockets_max)
      SELECT (ts_ms / 3600000) * 3600000 AS h, COUNT(*), SUM(rss_mb), MAX(rss_mb), SUM(heap_mb),
             SUM(lag_ms), MAX(lag_ms), SUM(db_ms), MAX(sockets)
      FROM monitor_samples GROUP BY h
      ON CONFLICT(hour_ms) DO UPDATE SET
        samples = excluded.samples, rss_sum = excluded.rss_sum, rss_max = excluded.rss_max,
        heap_sum = excluded.heap_sum, lag_sum = excluded.lag_sum, lag_max = excluded.lag_max,
        db_sum = excluded.db_sum, sockets_max = excluded.sockets_max;

      INSERT INTO monitor_traffic_hour (hour_ms, requests, errors, slow, duration_sum, duration_max, clients)
      SELECT (bucket_ms / 3600000) * 3600000 AS h, SUM(requests), SUM(errors), SUM(slow),
             SUM(duration_sum), MAX(duration_max), MAX(clients)
      FROM monitor_traffic_min GROUP BY h
      ON CONFLICT(hour_ms) DO UPDATE SET
        requests = excluded.requests, errors = excluded.errors, slow = excluded.slow,
        duration_sum = excluded.duration_sum, duration_max = excluded.duration_max, clients = excluded.clients;
    `);
    raw.prepare("INSERT INTO monitor_meta (key, value) VALUES ('hourRollupBackfilled', ?) ON CONFLICT(key) DO NOTHING")
      .run(String(nowMs()));
  } catch (error) {
    // 回填失败不影响新数据（新数据会实时写入小时表），下次启动再试
    tablesReady = true;
  }
};

const readMeta = (key) => {
  try {
    const row = ensureTables().prepare('SELECT value FROM monitor_meta WHERE key = ?').get(key);
    return row ? row.value : null;
  } catch {
    return null;
  }
};

const writeMeta = (key, value) => {
  try {
    ensureTables()
      .prepare('INSERT INTO monitor_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, String(value));
  } catch {
    // 元数据写入失败不影响主流程
  }
};

module.exports = {
  ensureTables,
  readMeta,
  writeMeta,
};
