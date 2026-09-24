/**
 * 焊枪编号台账：表级独占编辑锁（内存态）
 *
 * 规则：
 * - 每张表同一时刻只允许一名用户编辑（按 userId 判定，同一用户多标签页共享一把锁）
 * - 锁通过 socket 生命周期 + 心跳维持：
 *   lock 加入 socket 引用计数；unlock / 断开连接移除引用；引用归零即释放
 * - 心跳超过 TTL 且无存活 socket 连接的锁视为僵死锁，由 sweepStale 清理
 * - 进程重启后锁全部清空（内存态），不影响数据本身
 */

const TTL_MS = 60 * 1000;

// tableId -> { tableId, userId, username, name, sockets: Set<socketId>, lockedAt, lastHeartbeat }
const locks = new Map();

const toPublic = (entry) => entry ? {
  tableId: entry.tableId,
  userId: entry.userId,
  username: entry.username,
  name: entry.name,
  lockedAt: entry.lockedAt,
} : null;

/**
 * 申请锁
 * @returns {{status:'acquired'|'held'|'blocked', holder:object|null}}
 *   acquired 新获取；held 同一用户已持有（多标签页，引用计数 +1）；blocked 被他人占用
 */
const lock = (tableId, user, socketId) => {
  if (!tableId || !user || !socketId) return { status: 'blocked', holder: null };
  const key = String(tableId);
  const now = Date.now();
  let entry = locks.get(key);
  if (entry) {
    if (entry.userId !== user.id) return { status: 'blocked', holder: toPublic(entry) };
    entry.sockets.add(socketId);
    entry.lastHeartbeat = now;
    return { status: 'held', holder: toPublic(entry) };
  }
  entry = {
    tableId: key,
    userId: user.id,
    username: user.username,
    name: user.name || user.username,
    sockets: new Set([socketId]),
    lockedAt: now,
    lastHeartbeat: now,
  };
  locks.set(key, entry);
  return { status: 'acquired', holder: toPublic(entry) };
};

/**
 * 释放当前 socket 对锁的引用；引用归零时真正释放
 * @returns {boolean} 锁是否被完全释放
 */
const unlock = (tableId, socketId) => {
  const key = String(tableId);
  const entry = locks.get(key);
  if (!entry || !entry.sockets.has(socketId)) return false;
  entry.sockets.delete(socketId);
  if (entry.sockets.size === 0) {
    locks.delete(key);
    return true;
  }
  return false;
};

/** 续期心跳（仅持有者本人有效） */
const heartbeat = (tableId, userId) => {
  const entry = locks.get(String(tableId));
  if (entry && entry.userId === userId) entry.lastHeartbeat = Date.now();
};

/** 某 socket 断开时移除其全部锁引用，返回被完全释放的 tableId 列表 */
const releaseSocket = (socketId) => {
  const released = [];
  for (const [tableId, entry] of locks.entries()) {
    if (entry.sockets.has(socketId)) {
      entry.sockets.delete(socketId);
      if (entry.sockets.size === 0) {
        locks.delete(tableId);
        released.push(tableId);
      }
    }
  }
  return released;
};

/** 强制释放（表被删除等场景） */
const forceRelease = (tableId) => locks.delete(String(tableId));

/** 查询持有者（公开信息），无锁返回 null */
const get = (tableId) => toPublic(locks.get(String(tableId)) || null);

/** 全部锁的公开快照 */
const snapshot = () => Array.from(locks.values()).map(toPublic);

/**
 * 清理僵死锁：心跳超时且不存在任何存活 socket 连接。
 * 若仍有存活连接（如后台标签页定时器被节流），仅顺延心跳，避免误释放。
 * @returns {string[]} 被释放的 tableId 列表
 */
const sweepStale = (io) => {
  const now = Date.now();
  const staleIds = [];
  for (const [tableId, entry] of locks.entries()) {
    if (now - entry.lastHeartbeat <= TTL_MS) continue;
    let anyConnected = false;
    for (const sid of entry.sockets) {
      const s = io?.sockets?.sockets?.get(sid);
      if (s && s.connected) { anyConnected = true; break; }
    }
    if (anyConnected) {
      entry.lastHeartbeat = now;
      continue;
    }
    staleIds.push(tableId);
  }
  staleIds.forEach(id => locks.delete(id));
  return staleIds;
};

module.exports = {
  TTL_MS,
  lock,
  unlock,
  heartbeat,
  releaseSocket,
  forceRelease,
  get,
  snapshot,
  sweepStale,
};
