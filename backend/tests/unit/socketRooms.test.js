const test = require('node:test');
const assert = require('node:assert');

// 在加载被测模块之前替换 db.readSettings：hasAccessSettings 在调用时才读取 settings，
// 因此这里注入的权限配置会直接决定房间成员判定，不需要真实数据库。
const db = require('../../db');
let settings = {};
db.readSettings = () => settings;

const {
  PAGE_ROOMS,
  syncSocketRooms,
  emitToPage,
  emitToPageExcept,
  disconnectUserSockets
} = require('../../utils/socketRooms');

const makeSocket = (user, extra = {}) => {
  const rooms = new Set(['socket:self']);
  return {
    id: extra.id || 'sock-1',
    data: { user, userId: user?.id, sessionId: extra.sessionId || 'sess-1' },
    rooms,
    joined: [],
    left: [],
    emitted: [],
    disconnected: false,
    connected: true,
    join(room) { rooms.add(room); this.joined.push(room); },
    leave(room) { rooms.delete(room); this.left.push(room); },
    emit(ev, payload) { this.emitted.push({ ev, payload }); },
    disconnect() { this.disconnected = true; this.connected = false; }
  };
};

const setAccess = ({ gunAdmins = true, gunViewers = false, stAdmins = true, stViewers = false } = {}) => {
  settings = {
    gunLedger: { enabled: true, allowAdmins: gunAdmins, allowViewers: gunViewers },
    statusTracking: { enabled: true, allowAdmins: stAdmins, allowViewers: stViewers }
  };
};

test('普通用户默认不进任何业务页面房间', () => {
  setAccess();
  const socket = makeSocket({ id: 'u1', username: 'u1', role: 'user' });
  syncSocketRooms(socket);
  assert.strictEqual(socket.rooms.has(PAGE_ROOMS.gunLedger), false);
  assert.strictEqual(socket.rooms.has(PAGE_ROOMS.statusTracking), false);
});

test('管理员按 allowAdmins 进入对应房间', () => {
  setAccess({ gunAdmins: true, stAdmins: false });
  const socket = makeSocket({ id: 'a1', username: 'a1', role: 'admin' });
  syncSocketRooms(socket);
  assert.strictEqual(socket.rooms.has(PAGE_ROOMS.gunLedger), true);
  assert.strictEqual(socket.rooms.has(PAGE_ROOMS.statusTracking), false);
});

test('allowViewers 打开后普通用户进入房间', () => {
  setAccess({ gunViewers: true });
  const socket = makeSocket({ id: 'u2', username: 'u2', role: 'user' });
  syncSocketRooms(socket);
  assert.strictEqual(socket.rooms.has(PAGE_ROOMS.gunLedger), true);
});

test('超管恒有权限（不受 allowAdmins/allowViewers 限制）', () => {
  settings = {
    gunLedger: { enabled: false, allowAdmins: false, allowViewers: false },
    statusTracking: { enabled: false, allowAdmins: false, allowViewers: false }
  };
  const superSocket = makeSocket({ id: 's1', username: 's1', role: 'superadmin' });
  syncSocketRooms(superSocket);
  assert.strictEqual(superSocket.rooms.has(PAGE_ROOMS.gunLedger), true);

  settings.gunLedger = { enabled: true, allowAdmins: true, allowViewers: false };
  const userSocket = makeSocket({ id: 'u3', username: 'u3', role: 'user' });
  syncSocketRooms(userSocket);
  assert.strictEqual(userSocket.rooms.has(PAGE_ROOMS.gunLedger), false);
});

test('权限被收回后 leave 房间（广播立即收不到）', () => {
  setAccess({ gunViewers: true });
  const socket = makeSocket({ id: 'u4', username: 'u4', role: 'user' });
  syncSocketRooms(socket);
  assert.strictEqual(socket.rooms.has(PAGE_ROOMS.gunLedger), true);

  setAccess({ gunViewers: false });
  syncSocketRooms(socket);
  assert.strictEqual(socket.rooms.has(PAGE_ROOMS.gunLedger), false);
  assert.ok(socket.left.includes(PAGE_ROOMS.gunLedger));
});

test('emitToPage 只发往对应房间，不再全连接广播', () => {
  const calls = [];
  const io = {
    to(room) {
      return {
        except(id) {
          return { emit: (ev, payload) => calls.push({ room, except: id, ev, payload }) };
        },
        emit: (ev, payload) => calls.push({ room, ev, payload })
      };
    }
  };
  emitToPage(io, 'gunLedger', 'gun_ledger_updated', { action: 'update_rows' });
  emitToPageExcept(io, 'statusTracking', 'status_tracking_updated', { action: 'add' }, 'sock-9');

  assert.deepStrictEqual(calls[0], {
    room: PAGE_ROOMS.gunLedger,
    ev: 'gun_ledger_updated',
    payload: { action: 'update_rows' }
  });
  assert.strictEqual(calls[1].room, PAGE_ROOMS.statusTracking);
  assert.strictEqual(calls[1].except, 'sock-9');
});

test('disconnectUserSockets 只断目标用户，且可保留指定会话', async () => {
  const keep = makeSocket({ id: 'k1', username: 'k1', role: 'user' }, { id: 'sock-keep', sessionId: 'new-session' });
  const kick = makeSocket({ id: 'k1', username: 'k1', role: 'user' }, { id: 'sock-kick', sessionId: 'old-session' });
  const other = makeSocket({ id: 'k2', username: 'k2', role: 'user' }, { id: 'sock-other' });
  const io = { of: () => ({ sockets: new Map([['a', keep], ['b', kick], ['c', other]]) }) };

  const count = disconnectUserSockets(io, 'k1', { reason: '密码已修改', exceptSessionId: 'new-session' });
  assert.strictEqual(count, 1);

  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(keep.disconnected, false);
  assert.strictEqual(kick.disconnected, true, '被踢连接应已断开');
  assert.strictEqual(other.disconnected, false, '其他用户不受影响');
  assert.strictEqual(kick.emitted[0].ev, 'session_invalidated');
  assert.strictEqual(kick.emitted[0].payload.reason, '密码已修改');
});
