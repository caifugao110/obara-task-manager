import { useCallback, useEffect, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Socket } from 'socket.io-client';
import { axiosInstance } from '../../../services/api';
import type { TaskSheet } from '../types';

type HistoryOperation = { operation: string; data: any; timestamp: number };

interface UseTaskHistoryParams {
  token: string | null;
  upsertSheet: (incoming: TaskSheet) => void;
  fetchSheets: () => Promise<void>;
  canEditTasks: boolean;
  isOfflineMode: boolean;
  addToast: (message: string, type: 'success' | 'error') => void;
  socketRef: MutableRefObject<Socket | null>;
}

export const useTaskHistory = ({ token, upsertSheet, fetchSheets, canEditTasks, isOfflineMode, addToast, socketRef }: UseTaskHistoryParams) => {
  const [history, setHistory] = useState<HistoryOperation[]>([]);
  const [redoHistory, setRedoHistory] = useState<HistoryOperation[]>([]);

  // 添加操作到历史记录，最多保留 10 步
  // 新操作会清空重做栈，因为重做分支已失效
  const addToHistory = (operation: string, data: any) => {
    setHistory(prev => [...prev, { operation, data, timestamp: Date.now() }].slice(-10));
    setRedoHistory([]);
  };

  const performUndo = useCallback(async (operation: {operation: string, data: any, timestamp: number}): Promise<{operation: string, data: any, timestamp: number} | null> => {
    if (!canEditTasks) {
      if (isOfflineMode) addToast('当前离线，禁止编辑', 'error');
      return null;
    }
    try {
      const op: any = { ...operation, data: { ...operation.data } };

      switch (op.operation) {
        case 'delete':
          // Restore deleted task
          {
            const { designerId, date, item } = op.data;
            const res = await axiosInstance.post('/tasks/item', {
              designerId,
              date,
              taskName: item.taskName || '',
              hours: item.hours || 0,
              color: item.color || '',
              guns: item.guns || [],
              leaveType: item.leaveType || null
            });
            // 记录恢复后的新 itemId，供重做（再次删除）使用
            op.data.restoredItemId = res.data.item?.id;
            upsertSheet(res.data.sheet);
          }
          socketRef.current?.emit('task_updated');
          addToast('操作已撤销', 'success');
          break;

        case 'add':
          // Remove added task
          {
            const { designerId: addDesignerId, date: addDate, itemId } = op.data;
            await axiosInstance.delete('/tasks/item', { data: { designerId: addDesignerId, date: addDate, itemId } });
          }
          fetchSheets();
          socketRef.current?.emit('task_updated');
          addToast('操作已撤销', 'success');
          break;

        case 'batchAdd':
          {
            const { items } = op.data;
            for (const added of items || []) {
              await axiosInstance.delete('/tasks/item', { data: { designerId: added.designerId, date: added.date, itemId: added.itemId }
              });
            }
          }
          fetchSheets();
          socketRef.current?.emit('task_updated');
          addToast('操作已撤销', 'success');
          break;

        case 'batchDelete':
          {
            const restoredItems: { designerId: string; date: string; itemId: string }[] = [];
            for (const deleted of op.data.items || []) {
              const res = await axiosInstance.post('/tasks/item', {
                designerId: deleted.designerId,
                date: deleted.date,
                taskName: deleted.item.taskName || '',
                hours: deleted.item.hours || 0,
                color: deleted.item.color || '',
                guns: deleted.item.guns || [],
                leaveType: deleted.item.leaveType || null
              });
              if (res.data.item?.id) {
                restoredItems.push({ designerId: deleted.designerId, date: deleted.date, itemId: res.data.item.id });
              }
            }
            // 记录恢复后的新 itemId 列表，供重做（再次删除）使用
            op.data.restoredItems = restoredItems;
          }
          fetchSheets();
          socketRef.current?.emit('task_updated');
          addToast('操作已撤销', 'success');
          break;

        case 'move':
          // Reverse move operation
          {
            const { sourceDesignerId, sourceDate, targetDesignerId, targetDate, itemId: moveItemId } = op.data;
            await axiosInstance.post('/tasks/move', {
              sourceDesignerId: targetDesignerId,
              sourceDate: targetDate,
              itemId: moveItemId,
              targetDesignerId: sourceDesignerId,
              targetDate: sourceDate
            });
          }
          fetchSheets();
          socketRef.current?.emit('task_updated');
          addToast('操作已撤销', 'success');
          break;

        case 'batchMove':
          for (const moved of op.data.items || []) {
            await axiosInstance.post('/tasks/move', {
              sourceDesignerId: moved.targetDesignerId,
              sourceDate: moved.targetDate,
              itemId: moved.itemId,
              targetDesignerId: moved.sourceDesignerId,
              targetDate: moved.sourceDate
            });
          }
          fetchSheets();
          socketRef.current?.emit('task_updated');
          addToast('操作已撤销', 'success');
          break;

        case 'deleteGun':
          // 撤销删除枪名操作，恢复原始枪名数组
          {
            const { designerId: gunDesignerId, date: gunDate, itemId: gunItemId, originalGuns } = op.data;
            await axiosInstance.put('/tasks/item', {
              designerId: gunDesignerId,
              date: gunDate,
              itemId: gunItemId,
              field: 'guns',
              value: originalGuns
            });
          }
          fetchSheets();
          socketRef.current?.emit('task_updated');
          addToast('操作已撤销', 'success');
          break;

        case 'moveGunBetweenItems':
          // 撤销跨主任务移动枪名：把枪名从目标主任务移回源主任务原位置；
          // 若源主任务因最后一个枪名被移走而被删除，则先按快照重建（空 guns）再移回；
          // 目标主任务是「落点空白单元格自动新建」的，移回后它已无枪名，后端会自动删除，无需额外处理
          {
            const d = op.data;
            let restoredSourceItemId = d.sourceItemId;
            if (d.sourceItemDeleted && d.sourceItemSnapshot) {
              const snap = d.sourceItemSnapshot;
              const res = await axiosInstance.post('/tasks/item', {
                designerId: d.sourceDesignerId,
                date: d.sourceDate,
                taskName: snap.taskName || '',
                hours: snap.hours || 0,
                color: snap.color || '',
                guns: [],
                leaveType: snap.leaveType || null
              });
              if (res.data.item?.id) {
                restoredSourceItemId = res.data.item.id;
                // 更新历史记录中的源任务 id，保证重做指向重建后的任务
                d.sourceItemId = restoredSourceItemId;
              }
            }
            await axiosInstance.post('/tasks/move-gun', {
              sourceDesignerId: d.targetDesignerId,
              sourceDate: d.targetDate,
              sourceItemId: d.targetItemId,
              gunId: d.gunId,
              targetDesignerId: d.sourceDesignerId,
              targetDate: d.sourceDate,
              targetItemId: restoredSourceItemId,
              // 源主任务可能是刚按快照重建的（guns 为空），撤销必须允许把枪名移回去
              allowEmptyTarget: true,
              newIndex: d.sourceGunIndex
            });
          }
          fetchSheets();
          socketRef.current?.emit('task_updated');
          addToast('操作已撤销', 'success');
          break;

        case 'fieldChange':
          // 撤销字段变更操作，恢复原始值
          {
            const { designerId: fieldDesignerId, date: fieldDate, itemId: fieldItemId, field: fieldName, originalValue: fieldOriginalValue } = op.data;
            await axiosInstance.put('/tasks/item', {
              designerId: fieldDesignerId,
              date: fieldDate,
              itemId: fieldItemId,
              field: fieldName,
              value: fieldOriginalValue
            });
          }
          fetchSheets();
          socketRef.current?.emit('task_updated');
          addToast('操作已撤销', 'success');
          break;

        default:
          addToast('无法撤销此操作', 'error');
          return null;
      }
      return op;
    } catch (err) {
      addToast('撤销失败', 'error');
      return null;
    }
  }, [token, upsertSheet, fetchSheets, canEditTasks, isOfflineMode]);

  // 重做被撤销的操作，返回更新后的操作对象（用于推回 history）
  const performRedo = useCallback(async (operation: {operation: string, data: any, timestamp: number}): Promise<{operation: string, data: any, timestamp: number} | null> => {
    if (!canEditTasks) {
      if (isOfflineMode) addToast('当前离线，禁止编辑', 'error');
      return null;
    }
    try {
      const op: any = { ...operation, data: { ...operation.data } };

      switch (op.operation) {
        case 'delete':
          // 重做删除操作：删除撤销时恢复的任务
          {
            const { designerId, date, restoredItemId } = op.data;
            await axiosInstance.delete('/tasks/item', { data: { designerId, date, itemId: restoredItemId } });
          }
          fetchSheets();
          socketRef.current?.emit('task_updated');
          addToast('操作已重做', 'success');
          break;

        case 'add':
          // 重做添加操作：重新创建任务，并更新 itemId
          {
            const { designerId, date, taskName, leaveType } = op.data;
            const res = await axiosInstance.post('/tasks/item', {
              designerId,
              date,
              taskName: taskName || '',
              leaveType: leaveType || null,
              hours: ''
            });
            op.data.itemId = res.data.item?.id;
            upsertSheet(res.data.sheet);
          }
          socketRef.current?.emit('task_updated');
          addToast('操作已重做', 'success');
          break;

        case 'batchAdd':
          // 重做批量添加操作：重新创建所有任务，并更新 itemId
          {
            const items = op.data.items || [];
            if (items.length > 0) {
              const { designerId, date } = items[0];
              const res = await axiosInstance.post('/tasks/item/batch', {
                designerId,
                date,
                items: items.map((it: any) => it.item)
              });
              const createdItems = res.data.items || [];
              op.data.items = items.map((it: any, idx: number) => ({
                ...it,
                itemId: createdItems[idx]?.id || it.itemId
              }));
              upsertSheet(res.data.sheet);
            }
          }
          socketRef.current?.emit('task_updated');
          addToast('操作已重做', 'success');
          break;

        case 'batchDelete':
          // 重做批量删除操作：删除撤销时恢复的所有任务
          {
            const restoredItems = op.data.restoredItems || [];
            for (const restored of restoredItems) {
              await axiosInstance.delete('/tasks/item', { data: { designerId: restored.designerId, date: restored.date, itemId: restored.itemId }
              });
            }
          }
          fetchSheets();
          socketRef.current?.emit('task_updated');
          addToast('操作已重做', 'success');
          break;

        case 'move':
          // 重做移动操作
          {
            const { sourceDesignerId, sourceDate, targetDesignerId, targetDate, itemId: moveItemId } = op.data;
            await axiosInstance.post('/tasks/move', {
              sourceDesignerId,
              sourceDate,
              targetDesignerId,
              targetDate,
              itemId: moveItemId
            });
          }
          fetchSheets();
          socketRef.current?.emit('task_updated');
          addToast('操作已重做', 'success');
          break;

        case 'batchMove':
          // 重做批量移动操作
          for (const moved of op.data.items || []) {
            await axiosInstance.post('/tasks/move', {
              sourceDesignerId: moved.sourceDesignerId,
              sourceDate: moved.sourceDate,
              itemId: moved.itemId,
              targetDesignerId: moved.targetDesignerId,
              targetDate: moved.targetDate
            });
          }
          fetchSheets();
          socketRef.current?.emit('task_updated');
          addToast('操作已重做', 'success');
          break;

        case 'deleteGun':
          // 重做删除枪名操作：再次移除指定索引的枪名
          {
            const { designerId, date, itemId, originalGuns, gunIndex } = op.data;
            const newGuns = (originalGuns || []).filter((_: any, i: number) => i !== gunIndex);
            await axiosInstance.put('/tasks/item', {
              designerId,
              date,
              itemId,
              field: 'guns',
              value: newGuns
            });
          }
          fetchSheets();
          socketRef.current?.emit('task_updated');
          addToast('操作已重做', 'success');
          break;

        case 'moveGunBetweenItems':
          // 重做跨主任务移动枪名
          {
            const d = op.data;
            // 目标主任务是本次移动时新建的：撤销移回后它会因枪名为空被自动删除，
            // 重做需按记录的名称重新新建，并回写新的目标主任务 id
            const res = await axiosInstance.post('/tasks/move-gun', {
              sourceDesignerId: d.sourceDesignerId,
              sourceDate: d.sourceDate,
              sourceItemId: d.sourceItemId,
              gunId: d.gunId,
              targetDesignerId: d.targetDesignerId,
              targetDate: d.targetDate,
              targetItemId: d.targetItemCreated ? '' : d.targetItemId,
              ...(d.targetItemCreated ? { createTaskName: d.createdTaskName ?? '' } : {}),
              newIndex: d.targetItemCreated ? undefined : d.newIndex
            });
            if (d.targetItemCreated && res.data.targetItemId) {
              d.targetItemId = res.data.targetItemId;
            }
          }
          fetchSheets();
          socketRef.current?.emit('task_updated');
          addToast('操作已重做', 'success');
          break;

        case 'fieldChange':
          // 重做字段变更操作：设置为新值
          {
            const { designerId, date, itemId, field, newValue } = op.data;
            await axiosInstance.put('/tasks/item', {
              designerId,
              date,
              itemId,
              field,
              value: newValue
            });
          }
          fetchSheets();
          socketRef.current?.emit('task_updated');
          addToast('操作已重做', 'success');
          break;

        default:
          addToast('无法重做此操作', 'error');
          return null;
      }
      return op;
    } catch (err) {
      addToast('重做失败', 'error');
      return null;
    }
  }, [token, upsertSheet, fetchSheets, canEditTasks, isOfflineMode]);

  useEffect(() => {
    const handleUndo = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (!canEditTasks) {
          if (isOfflineMode) addToast('当前离线，禁止编辑', 'error');
          return;
        }
        if (history.length > 0) {
          const lastOperation = history[history.length - 1];
          const undoneOp = await performUndo(lastOperation);
          // 仅在撤销成功时才从 history 移除并推入 redoHistory
          if (undoneOp) {
            setHistory(prev => prev.slice(0, -1));
            setRedoHistory(prev => [...prev, undoneOp].slice(-10));
          }
        } else {
          addToast('暂无可撤销操作', 'error');
        }
      }
    };

    const handleRedo = async (e: KeyboardEvent) => {
      // Ctrl+Y 或 Ctrl+Shift+Z 触发重做
      const isCtrlY = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y';
      const isCtrlShiftZ = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z';
      if (!isCtrlY && !isCtrlShiftZ) return;
      e.preventDefault();
      if (!canEditTasks) {
        if (isOfflineMode) addToast('当前离线，禁止编辑', 'error');
        return;
      }
      if (redoHistory.length > 0) {
        const lastRedoOperation = redoHistory[redoHistory.length - 1];
        const redoneOp = await performRedo(lastRedoOperation);
        // 仅在重做成功时才从 redoHistory 移除并推回 history
        if (redoneOp) {
          setRedoHistory(prev => prev.slice(0, -1));
          setHistory(prev => [...prev, redoneOp].slice(-10));
        }
      } else {
        addToast('暂无可重做操作', 'error');
      }
    };

    window.addEventListener('keydown', handleUndo);
    window.addEventListener('keydown', handleRedo);
    return () => {
      window.removeEventListener('keydown', handleUndo);
      window.removeEventListener('keydown', handleRedo);
    };
  }, [history, redoHistory, performUndo, performRedo, canEditTasks, isOfflineMode]);

  return { addToHistory };
};
