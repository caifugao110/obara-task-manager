import { useCallback, useRef, useState } from 'react';
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
  // 双击主任务时 click/click/dblclick 会连续三次请求开启同一个编辑会话。
  // 每次 setEditingSessions 都会换引用，而 editingSessions 是整张表格的 props，
  // 于是弹窗挂载前先被 2~3 次全表重渲 + socket 广播堵住。这里做短时幂等。
  const lastStartedRef = useRef<{ key: string; at: number } | null>(null);

  // 返回指定单元格内的全部编辑会话（同一单元格可同时存在多人编辑不同主任务）
  const getCellSessions = useCallback(
    (designerId: string, date: string) =>
      Object.values(editingSessions).filter(session => session.designerId === designerId && session.date === date),
    [editingSessions]
  );

  // 锁定判断精确到主任务：
  // - 传入 itemId：他人编辑/标记该主任务、或存在旧版整格会话（itemId 为空）时视为锁定
  // - 不传 itemId（粘贴等新增类整格操作）：仅旧版整格会话会锁定，主任务级会话不影响
  const getBlockingEditingSession = useCallback(
    (designerId: string, date: string, itemId?: string | null) => {
      const session = getCellSessions(designerId, date).find(s => {
        if (s.userId === user?.id) return false;
        if (itemId) return s.itemId == null || s.itemId === itemId;
        return s.itemId == null;
      });
      return session || null;
    },
    [getCellSessions, user?.id]
  );

  const warnIfCellLocked = useCallback(
    (designerId: string, date: string, itemId?: string | null) => {
      const session = getBlockingEditingSession(designerId, date, itemId);
      if (!session) return false;
      const target = itemId ? '该任务' : '该区域';
      addToast(`${session.name || session.username} ${session.mode === 'colorMark' ? `正在修改${target}的完成状态` : `正在编辑${target}`}，暂无法操作`, 'error');
      return true;
    },
    [getBlockingEditingSession]
  );

  const startEditingCell = useCallback(
    (designerId: string, date: string, itemId?: string | null) => {
      if (!user) return;
      const key = editingSessionKey(designerId, date, itemId);
      const now = Date.now();
      const last = lastStartedRef.current;
      if (last && last.key === key && now - last.at < 2000) return;
      lastStartedRef.current = { key, at: now };
      setEditingSessions(prev => {
        const next = { ...prev };
        Object.entries(next).forEach(([k, session]) => {
          if (session.userId === user.id && k !== key) {
            delete next[k];
          }
        });
        next[key] = {
          designerId,
          date,
          userId: user.id,
          username: user.username,
          name: user.name,
          itemId: itemId ?? null,
          gunIndex: null
        };
        return next;
      });
      socketRef.current?.emit('start_editing', { designerId, date, userId: user.id, username: user.username, name: user.name, itemId: itemId ?? null });
    },
    [user]
  );

  const stopEditingCell = useCallback((designerId?: string | null, date?: string | null) => {
    // 关掉会话后允许再次开启同一单元格（例如关闭弹窗后立刻重新双击同一任务）
    lastStartedRef.current = null;
    if (designerId && date) {
      socketRef.current?.emit('stop_editing', { designerId, date });
      return;
    }
    socketRef.current?.emit('stop_editing');
  }, []);

  return {
    editingSessions,
    setEditingSessions,
    getCellSessions,
    getBlockingEditingSession,
    warnIfCellLocked,
    startEditingCell,
    stopEditingCell,
  };
};
