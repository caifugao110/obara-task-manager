/**
 * useSocket Hook
 * 管理 Socket.IO 连接和事件
 */

import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

export interface SocketEventData {
  designerId: string;
  date: string;
  userId: string;
  username: string;
  name: string;
}

export interface UseSocketOptions {
  onTaskRefresh?: () => void;
  onUserEditing?: (data: SocketEventData) => void;
  onUserStoppedEditing?: () => void;
  onDisconnect?: () => void;
  onConnect?: () => void;
}

export interface UseSocketReturn {
  socket: Socket | null;
  isConnected: boolean;
  emitTaskUpdated: () => void;
  emitStartEditing: (data: SocketEventData) => void;
  emitStopEditing: () => void;
  disconnect: () => void;
}

/**
 * Socket.IO 连接 Hook
 */
export const useSocket = (options: UseSocketOptions = {}): UseSocketReturn => {
  const {
    onTaskRefresh,
    onUserEditing,
    onUserStoppedEditing,
    onDisconnect,
    onConnect,
  } = options;

  const socketRef = useRef<Socket | null>(null);
  const isConnectedRef = useRef(false);

  /**
   * 连接 Socket.IO
   */
  useEffect(() => {
    // 创建连接
    socketRef.current = io('/', {
      path: '/socket.io',
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000,
    });

    const socket = socketRef.current;

    // 连接成功
    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
      isConnectedRef.current = true;
      onConnect?.();
    });

    // 连接断开
    socket.on('disconnect', () => {
      console.log('Socket disconnected');
      isConnectedRef.current = false;
      onDisconnect?.();
    });

    // 任务刷新事件
    socket.on('task_refreshed', () => {
      console.log('Task refreshed');
      onTaskRefresh?.();
    });

    // 用户开始编辑
    socket.on('user_editing', (data: SocketEventData) => {
      console.log('User editing:', data);
      onUserEditing?.(data);
    });

    // 用户停止编辑
    socket.on('user_stopped_editing', () => {
      console.log('User stopped editing');
      onUserStoppedEditing?.();
    });

    // 连接错误
    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });

    // 清理
    return () => {
      socket.disconnect();
      socketRef.current = null;
      isConnectedRef.current = false;
    };
  }, [onTaskRefresh, onUserEditing, onUserStoppedEditing, onDisconnect, onConnect]);

  /**
   * 发送任务更新事件
   */
  const emitTaskUpdated = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('task_updated');
    }
  }, []);

  /**
   * 发送开始编辑事件
   */
  const emitStartEditing = useCallback((data: SocketEventData) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('start_editing', data);
    }
  }, []);

  /**
   * 发送停止编辑事件
   */
  const emitStopEditing = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('stop_editing');
    }
  }, []);

  /**
   * 手动断开连接
   */
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      isConnectedRef.current = false;
    }
  }, []);

  return {
    socket: socketRef.current,
    isConnected: isConnectedRef.current,
    emitTaskUpdated,
    emitStartEditing,
    emitStopEditing,
    disconnect,
  };
};

export default useSocket;
