/**
 * 共享 Socket.IO 单例
 *
 * 历史问题：AuthContext / Dashboard / StatusTracking / GunLedger / DesignStandards
 * 各建一条连接，单个标签页会开 5 条 WebSocket，服务端同时维护 5 个 socket、
 * 5 份重连状态，且各处的重连参数（reconnectionAttempts / DelayMax）还不一致。
 *
 * 改为引用计数的共享连接：
 *   - acquireSocket(token) 返回句柄，同一 token 复用同一条连接
 *   - release() 归还引用；引用归零后延迟回收，避免页面切换时立刻断开又重连
 *   - token 变化（重新登录 / 退出）时重建连接
 *
 * 快照事件回放：服务端只在「连接建立」时下发一次 editing_state /
 * gun_ledger_editing_state / gun_ledger_table_locks_state。共享连接后，
 * 晚挂载的页面收不到这些事件，因此本模块统一缓存最近一次载荷，
 * 供新订阅者通过 getSnapshot() 补一次初始状态。
 */

import { io, type Socket } from 'socket.io-client';

/** 服务端仅在连接建立时下发一次的状态快照事件 */
export const SNAPSHOT_EVENTS = [
  'editing_state',
  'gun_ledger_editing_state',
  'gun_ledger_table_locks_state',
  'status_tracking_editing_state'
] as const;

export type SnapshotEvent = typeof SNAPSHOT_EVENTS[number];

/** 各页面原先的连接参数并不一致，这里统一为最完整的一份 */
const SOCKET_OPTIONS = {
  path: '/socket.io',
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 3000,
  reconnectionDelayMax: 10000,
  timeout: 10000
};

// 引用归零后的回收延迟：页面切换时旧页面卸载与新页面挂载几乎同时发生
const TEARDOWN_DELAY_MS = 1000;

let currentSocket: Socket | null = null;
let currentToken: string | null = null;
const holders = new Set<symbol>();
const snapshots = new Map<string, unknown>();
let teardownTimer: ReturnType<typeof setTimeout> | null = null;

const destroySocket = () => {
  if (!currentSocket) return;
  currentSocket.removeAllListeners();
  currentSocket.disconnect();
  currentSocket = null;
  currentToken = null;
  snapshots.clear();
};

const scheduleTeardown = () => {
  if (holders.size > 0) return;
  if (teardownTimer) clearTimeout(teardownTimer);
  teardownTimer = setTimeout(() => {
    teardownTimer = null;
    destroySocket();
  }, TEARDOWN_DELAY_MS);
};

export interface SocketHandle {
  /** 共享的 socket 实例（用于 emit 与读取 connected 等属性） */
  socket: Socket;
  /**
   * 注册事件监听。与原生 socket.on 的区别：句柄会记住这些监听器，
   * release() 时自动全部摘除，避免共享连接上残留监听器导致重复处理。
   */
  on: (event: string, listener: (...args: any[]) => void) => void;
  /** 读取已缓存的快照事件载荷（连接早于页面挂载时用于补初始状态） */
  getSnapshot: <T = unknown>(event: SnapshotEvent) => T | undefined;
  /** 归还引用；请勿直接调用 socket.disconnect() */
  release: () => void;
}

/**
 * 当前共享连接的 socket.id（未连接时为 undefined）。
 * 写接口把它放在 x-socket-id 头里，服务端据此判断「这把行锁是不是本窗口持有的」，
 * 避免同一账号的另一个窗口绕过前端锁定直接改动别人正在编辑的行。
 */
export const getCurrentSocketId = (): string | undefined => currentSocket?.id;

export const acquireSocket = (token: string): SocketHandle => {
  const holder = Symbol('socket-holder');
  holders.add(holder);
  if (teardownTimer) {
    clearTimeout(teardownTimer);
    teardownTimer = null;
  }

  if (!currentSocket || currentToken !== token) {
    if (currentSocket) destroySocket();
    currentSocket = io('/', { ...SOCKET_OPTIONS, auth: { token } });
    currentToken = token;
    snapshots.clear();
    // 内部监听：只做缓存，不影响业务监听器
    for (const event of SNAPSHOT_EVENTS) {
      currentSocket.on(event, (payload: unknown) => {
        snapshots.set(event, payload);
      });
    }
  }

  const socket = currentSocket;
  const registered: Array<[string, (...args: any[]) => void]> = [];

  return {
    socket,
    on: (event, listener) => {
      registered.push([event, listener]);
      socket.on(event, listener);
    },
    getSnapshot: <T = unknown>(event: SnapshotEvent): T | undefined =>
      snapshots.get(event) as T | undefined,
    release: () => {
      registered.forEach(([event, listener]) => {
        socket.off(event, listener);
      });
      registered.length = 0;
      holders.delete(holder);
      scheduleTeardown();
    }
  };
};
