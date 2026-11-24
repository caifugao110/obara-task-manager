/**
 * 表体积统计缓存（dbstat 共用层）
 *
 * `SELECT name, SUM(pgsize) FROM dbstat GROUP BY name` 会把整个数据库文件逐页走一遍。
 * 本项目的 data.db 已有数十 MB、近 7000 个页，且数据目录位于网络盘（F: 为映射的网络磁盘），
 * 逐页读全部变成 SMB 往返——在生产库上实测单次 **2.6~3.2 秒**，而它同时被两条路径使用：
 *   - /api/system/maintenance      → 数据管理页的「主文件体积构成」
 *   - /api/system/monitor/storage  → 状态监测页的各表体积
 * 于是打开一次系统设置页会扫两遍全库，把首屏拖到 5 秒以上。
 *
 * 策略（三条，都是为了让请求路径上不再出现这次扫描）：
 *   1) 有缓存就直接给（即使已经过了 TTL），过期只在后台补算，绝不让请求等它；
 *   2) 只有 force=true（用户在界面上主动点「刷新」）才同步重扫；
 *   3) 进程启动后由 warmUp() 在后台先算一次，把「冷启动第一次访问」也变成内存命中。
 *
 * 注意：扫描本身是 better-sqlite3 的同步查询，跑起来仍会占用事件循环约 3 秒
 * （这是 SQLite 驱动的固有限制）。因此这里只保证「不排在请求路径上」，
 * 后台补算也只在缓存过期且确实有人访问时才触发，并把 TTL 放宽到 10 分钟以降低频次。
 */

// 默认 10 分钟：体积构成只用于展示，陈旧几分钟没有业务影响；
// TTL 越长，后台补算（会占用事件循环约 3 秒）越少。可用 DBSTAT_CACHE_TTL_MS 覆盖。
const DEFAULT_TTL_MS = Math.max(60 * 1000, Number(process.env.DBSTAT_CACHE_TTL_MS) || 10 * 60 * 1000);

// 启动预热延迟：避开启动自愈、调度器、共享盘预热，等这些先跑完再占用事件循环。
// 设为 0 可关闭预热（仅排查用）。
const WARMUP_DELAY_MS = (() => {
  const raw = process.env.DBSTAT_WARMUP_DELAY_MS;
  if (raw === undefined || raw === '') return 8000;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, value) : 8000;
})();

let cache = { at: 0, sizes: null };
let scanning = false;
let refreshQueued = false;

/**
 * 真正执行 dbstat 聚合：索引作为独立对象出现在 dbstat 里，
 * 这里按 tbl_name 归并到所属表，否则「表体积」会漏掉索引、并把索引单独列成一行。
 * dbstat 不可用（未编译该模块）时返回 null，调用方降级为不显示字节数。
 */
const collectTableSizes = (raw) => {
  let rows;
  try {
    rows = raw.prepare('SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name').all();
  } catch {
    return null;
  }
  let indexRows;
  try {
    indexRows = raw
      .prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND tbl_name IS NOT NULL")
      .all();
  } catch {
    indexRows = [];
  }
  const tableOfObject = new Map(indexRows.map((row) => [String(row.name), String(row.tbl_name)]));
  const sizes = new Map();
  for (const row of rows) {
    const objectName = String(row.name);
    const table = tableOfObject.get(objectName) || objectName;
    sizes.set(table, (sizes.get(table) || 0) + (Number(row.bytes) || 0));
  }
  return sizes;
};

/** 同步扫描一次并写入缓存（唯一会产生 3 秒事件循环占用的地方） */
const runScan = (raw) => {
  if (scanning) return cache.sizes;
  scanning = true;
  try {
    const sizes = collectTableSizes(raw);
    if (sizes) cache = { at: Date.now(), sizes };
  } catch {
    // 扫描失败保留上一次结果：dbstat 临时不可用不该让体积卡片整块变空
  } finally {
    scanning = false;
  }
  return cache.sizes;
};

/**
 * 排一次「下一轮事件循环」的后台补算。响应已经写出，补算不占本次请求的耗时。
 * unref() 让这个定时器不阻止进程退出（脚本 / 测试里尤为重要）。
 */
const scheduleRefresh = (raw) => {
  if (refreshQueued || scanning) return;
  refreshQueued = true;
  const handle = setImmediate(() => {
    refreshQueued = false;
    runScan(raw);
  });
  if (handle && typeof handle.unref === 'function') handle.unref();
};

/**
 * 取各表（含索引）占用字节。
 *
 * @param {import('better-sqlite3').Database} raw 已打开的连接
 * @param {{ force?: boolean, ttlMs?: number }} [options]
 *   force=true 同步重扫（用户在界面上点「刷新」时用）；ttlMs 可覆盖默认 TTL
 * @returns {Map<string, number>|null} dbstat 不可用且无历史结果时返回 null
 */
const getTableSizes = (raw, options = {}) => {
  const now = Date.now();
  const ttl = Number.isFinite(options.ttlMs) ? Math.max(0, options.ttlMs) : DEFAULT_TTL_MS;

  // 用户主动刷新：必须给最新值，允许同步扫描（界面上有 spinner 兜着）
  if (options.force) {
    const sizes = runScan(raw);
    return sizes ? new Map(sizes) : null;
  }

  if (cache.sizes) {
    // 常态：立即返回旧值；过期了只在后台补算，本次请求不等
    if (now - cache.at >= ttl) scheduleRefresh(raw);
    return new Map(cache.sizes);
  }

  // 冷启动（进程刚起、预热还没跑完或预热失败）：只能同步算这一次，
  // 否则调用方拿到 null 只能显示 "-"，比等 3 秒更难解释。
  // 有 warmUp() 之后这条路径每个进程最多走一次。
  const sizes = runScan(raw);
  return sizes ? new Map(sizes) : null;
};

/**
 * 启动预热：延迟一段时间后在后台算一次，让第一个访问体积页面的用户直接命中内存。
 * @param {import('better-sqlite3').Database} raw
 * @param {{ delayMs?: number }} [options]
 * @returns {boolean} 是否已排入（设置为 0 延迟关闭时不排）
 */
const warmUp = (raw, { delayMs } = {}) => {
  // 环境变量设为 0 = 关闭预热（仅排查用）；显式传 delayMs 时以参数为准
  if (!Number.isFinite(delayMs) && WARMUP_DELAY_MS === 0) return false;
  const delay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : WARMUP_DELAY_MS;
  const timer = setTimeout(() => {
    if (!cache.sizes) runScan(raw);
  }, delay);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return true;
};

/** 体积已确定变化（VACUUM / 清理数据）后调用 */
const invalidate = () => {
  cache = { at: 0, sizes: null };
};

/** 排查用：当前缓存状态 */
const getCacheState = () => ({
  cachedAt: cache.at || null,
  ageMs: cache.at ? Date.now() - cache.at : null,
  stale: cache.at ? Date.now() - cache.at >= DEFAULT_TTL_MS : true,
  hasData: Boolean(cache.sizes),
  ttlMs: DEFAULT_TTL_MS,
  warmupDelayMs: WARMUP_DELAY_MS
});

module.exports = {
  getTableSizes,
  warmUp,
  invalidate,
  getCacheState
};
