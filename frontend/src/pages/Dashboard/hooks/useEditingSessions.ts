import { useCallback, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Socket } from 'socket.io-client';
import { editingSessionKey } from '../utils';
import type { EditingSession, User } from '../types';

interface UseEditingSessionsParams {
  user: User | null;
  socketRef: MutableRefObject<Socket | null>;
  addToast: (message: string, type: 'success' | 'error') => void;
}

export const useEditingSessions = ({ user, socketRef, addToast }: UseEditingSessionsParams) => {
  const [editingSessions, setEditingSessions] = useState<Record<string, EditingSession>>({});

  const getEditingSession = useCallback(
    (designerId: string, date: string) => editingSessions[editingSessionKey(designerId, date)],
    [editingSessions]
  );

  const getBlockingEditingSession = useCallback(
    (designerId: string, date: string) => {
      const session = getEditingSession(designerId, date);
      if (!session || session.userId === user?.id) return null;
      return session;
    },
    [getEditingSession, user?.id]
  );

  const warnIfCellLocked = useCallback(
    (designerId: string, date: string) => {
      const session = getBlockingEditingSession(designerId, date);
      if (!session) return false;
      addToast(`${session.name || session.username} ${session.mode === 'colorMark' ? '正在修改任务完成状态' : '正在编辑该区域，暂无法修改任务完成状态'}`, 'error');
      return true;
    },
    [getBlockingEditingSession]
  );

  const startEditingCell = useCallback(
    (designerId: string, date: string) => {
      if (!user) return;
      setEditingSessions(prev => {
        const next = { ...prev };
        Object.entries(next).forEach(([key, session]) => {
          if (session.userId === user.id && key !== editingSessionKey(designerId, date)) {
            delete next[key];
          }
        });
        next[editingSessionKey(designerId, date)] = {
          designerId,
          date,
          userId: user.id,
          username: user.username,
          name: user.name
        };
        return next;
      });
      socketRef.current?.emit('start_editing', { designerId, date, userId: user.id, username: user.username, name: user.name });
    },
    [user]
  );

  const stopEditingCell = useCallback((designerId?: string | null, date?: string | null) => {
    if (designerId && date) {
      socketRef.current?.emit('stop_editing', { designerId, date });
      return;
    }
    socketRef.current?.emit('stop_editing');
  }, []);

  return {
    editingSessions,
    setEditingSessions,
    getEditingSession,
    getBlockingEditingSession,
    warnIfCellLocked,
    startEditingCell,
    stopEditingCell,
  };
};
