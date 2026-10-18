// 状态跟踪行锁存储：进程内共享单例。
// server.js 的 socket 事件（占用/释放/断开清理）与 routes/statusTracking.js 的
// HTTP 写接口（PUT/DELETE 行锁校验）必须读写同一份锁状态，因此抽成独立模块。
// 广播（需要 io/socket 实例）仍留在 server.js，这里只负责纯状态。

const statusTrackingSessions = new Map();

const statusTrackingKey = (itemId) => String(itemId);

const publicStatusTrackingSessions = () => Array.from(statusTrackingSessions.values());

// 查询某行当前持有的锁；无锁返回 undefined
const getStatusTrackingLock = (itemId) => statusTrackingSessions.get(statusTrackingKey(itemId));

const removeStatusTrackingSessions = (predicate) => {
  const removed = [];
  for (const [key, session] of statusTrackingSessions.entries()) {
    if (predicate(session)) {
      statusTrackingSessions.delete(key);
      removed.push(session);
    }
  }
  return removed;
};

module.exports = {
  statusTrackingSessions,
  statusTrackingKey,
  publicStatusTrackingSessions,
  getStatusTrackingLock,
  removeStatusTrackingSessions
};
