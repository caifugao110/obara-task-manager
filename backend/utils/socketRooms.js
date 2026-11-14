/**
 * Socket 广播的页面级权限收敛
 *
 * 背景：业务数据（焊枪台账、状态跟踪）在 HTTP 层都有页面访问校验
 * （accessSettingsMiddleware），但 Socket 广播此前一律 io.emit 全员下发，
 * 只做「已登录」判断，导致无该页面权限的连接也能收到完整业务数据。
 *
 * 方案：连接建立时按 hasAccessSettings 把连接放入 page:<key> 房间，
 * 所有业务广播只发往对应房间；权限变化时重新计算房间成员。
 * 房间只是「首次过滤」，事件处理侧仍由 requireSocketAuth 做实时复核
 * （用户是否被禁用/删除/改密/降权），两层同时存在。
 */
const { hasAccessSettings } = require('../middleware/auth');

// 需要按页面权限收敛广播的业务模块
const PAGE_ROOMS = Object.freeze({
  statusTracking: 'page:statusTracking',
  gunLedger: 'page:gunLedger'
});

const PAGE_KEYS = Object.keys(PAGE_ROOMS);

const pageRoom = (page) => PAGE_ROOMS[page] || null;

/**
 * 按当前权限把单个连接加入/移出页面房间。
 * 每次调用都以最新 settings 为准，因此权限被收回时会 leave。
 */
const syncSocketRooms = (socket) => {
  const user = socket && socket.data ? socket.data.user : null;
  if (!user) return;
  PAGE_KEYS.forEach((page) => {
    const room = PAGE_ROOMS[page];
    if (hasAccessSettings(user, page)) {
      socket.join(room);
    } else if (socket.rooms.has(room)) {
      socket.leave(room);
    }
  });
};

/**
 * 权限设置变更后，重算所有在线连接的房间成员关系。
 * 返回处理的连接数，便于日志观察。
 */
const syncAllSocketRooms = (io) => {
  if (!io) return 0;
  let count = 0;
  io.of('/').sockets.forEach((socket) => {
    syncSocketRooms(socket);
    count += 1;
  });
  return count;
};

/** 仅向具备该页面权限的连接广播 */
const emitToPage = (io, page, event, payload) => {
  const room = pageRoom(page);
  if (!io || !room) return;
  io.to(room).emit(event, payload);
};

/** 向具备该页面权限、且不是发起连接的那些连接广播 */
const emitToPageExcept = (io, page, event, payload, exceptSocketId) => {
  const room = pageRoom(page);
  if (!io || !room) return;
  const exceptId = String(exceptSocketId || '').trim();
  const target = io.to(room);
  if (exceptId && typeof target.except === 'function') {
    target.except(exceptId).emit(event, payload);
  } else {
    target.emit(event, payload);
  }
};

/** 某用户当前的在线连接 */
const userSockets = (io, userId) => {
  const list = [];
  if (!io || !userId) return list;
  io.of('/').sockets.forEach((socket) => {
    if (socket && socket.data && socket.data.userId === userId) list.push(socket);
  });
  return list;
};

/**
 * 带原因地断开一条连接。
 * 先下发 session_invalidated（前端据此提示并清理本地登录态），
 * 留一个极短窗口让事件刷出后再关闭底层连接——直接断开会让提示丢失，
 * 用户只会看到一次莫名其妙的断线。
 */
const disconnectSocketWithReason = (socket, reason, code) => {
  if (!socket) return;
  try {
    if (reason) {
      socket.emit('session_invalidated', {
        reason,
        code: code || 'SESSION_INVALIDATED',
        timestamp: new Date().toLocaleString('zh-CN')
      });
    }
  } catch {
    // 连接已不可写，直接进入断开
  }
  setTimeout(() => {
    try {
      if (socket.connected) socket.disconnect(true);
    } catch {
      // 已断开
    }
  }, 150);
};

/**
 * 断开某用户的在线连接（改密、重置密码、禁用、删除、降权等场景）。
 * exceptSessionId：保留指定会话的连接（例如改密后仍在使用的当前设备）。
 */
const disconnectUserSockets = (io, userId, options = {}) => {
  const { reason = '', code, exceptSessionId = null } = options;
  let count = 0;
  userSockets(io, userId).forEach((socket) => {
    if (exceptSessionId && socket.data.sessionId === exceptSessionId) return;
    disconnectSocketWithReason(socket, reason, code);
    count += 1;
  });
  return count;
};

/** 断开某用户某一会话（登录设备）的连接 */
const disconnectSessionSockets = (io, userId, sessionId, options = {}) => {
  const { reason = '', code } = options;
  let count = 0;
  if (!sessionId) return count;
  userSockets(io, userId).forEach((socket) => {
    if (socket.data.sessionId !== sessionId) return;
    disconnectSocketWithReason(socket, reason, code);
    count += 1;
  });
  return count;
};

module.exports = {
  PAGE_ROOMS,
  pageRoom,
  syncSocketRooms,
  syncAllSocketRooms,
  emitToPage,
  emitToPageExcept,
  userSockets,
  disconnectSocketWithReason,
  disconnectUserSockets,
  disconnectSessionSockets
};
