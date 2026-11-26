import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Socket } from 'socket.io-client';
import { axiosInstance } from '../../../services/api';
import { isEditableKeyboardTarget, taskSelectionKey } from '../utils';
import type { SelectedTask, TaskItem } from '../types';

/**
 * 任务选中状态与批量删除
 *
 * 拆成两个 hook 的原因和剪贴板那一组相同：**依赖就绪时机不同**。
 *   - `useTaskSelection` 只有状态与「点击选中/追加/取消」这一条纯交互，不依赖任何业务回调，
 *     必须在页面很靠前的位置调用（快捷键、拖拽、剪贴板都要读 selectedTasksRef）；
 *   - `useTaskDeletion` 要写库、登记撤销历史、刷新数据，只能等 addToHistory / fetchSheets 就位。
 *
 * 两个 ref 与 state 必须成对存在：快捷键回调在注册时捕获闭包，读 state 会拿到过期快照
 * （典型症状：刚选中就按 Delete，删的是上一次选中的任务）。所以 ref 的同步 effect 也放在这里，
 * 谁也别在页面里另外维护一份。
 */

interface CellRef {
  designerId: string;
  date: string;
}

export const useTaskSelection = () => {
  const [selectedTasks, setSelectedTasks] = useState<SelectedTask[]>([]);
  const selectedTasksRef = useRef<SelectedTask[]>([]);
  useEffect(() => {
    selectedTasksRef.current = selectedTasks;
  }, [selectedTasks]);

  const [selectedCell, setSelectedCell] = useState<CellRef | null>(null);
  const selectedCellRef = useRef<CellRef | null>(null);
  useEffect(() => {
    selectedCellRef.current = selectedCell;
  }, [selectedCell]);

  /**
   * 点击主任务行：append=false 替换选中（普通点击），append=true 切换该行（Ctrl/Shift 点击）。
   * 已选中再点一次会取消，方便误点时自救。
   */
  const handleSelectTask = useCallback((itemId: string, designerId: string, date: string, append: boolean) => {
    const nextSelection = { itemId, designerId, date };
    if (!append) {
      setSelectedTasks([nextSelection]);
      return;
    }
    setSelectedTasks(prev => {
      const key = taskSelectionKey(nextSelection);
      if (prev.some(selection => taskSelectionKey(selection) === key)) {
        return prev.filter(selection => taskSelectionKey(selection) !== key);
      }
      return [...prev, nextSelection];
    });
  }, []);

  /** 清空选中（删除成功、切换月份、拖拽落点等场景共用） */
  const clearSelection = useCallback(() => {
    setSelectedTasks([]);
    setSelectedCell(null);
  }, []);

  return {
    selectedTasks,
    setSelectedTasks,
    selectedTasksRef,
    selectedCell,
    setSelectedCell,
    selectedCellRef,
    handleSelectTask,
    clearSelection,
  };
};

interface UseTaskDeletionParams {
  canEditTasks: boolean;
  isOfflineMode: boolean;
  addToast: (message: string, type: 'success' | 'error') => void;
  warnIfOfflineEdit: () => boolean;
  warnIfCellLocked: (designerId: string, date: string, itemId?: string) => boolean;
  /** 由页面提供：把「点中的那一行」扩展成多选集合 */
  getSelectedTaskPayloads: (fallback: { item: TaskItem; designerId: string; date: string }) => { item: TaskItem; designerId: string; date: string }[];
  /** 取某个单元格里的全部任务（含空任务），用于按 id 定位选中的任务 */
  getAllItems: (designerId: string, date: string) => TaskItem[];
  addToHistory: (operation: string, data: unknown) => void;
  fetchSheets: () => Promise<void> | void;
  stopEditingCell: (designerId?: string, date?: string) => void;
  socketRef: MutableRefObject<Socket | null>;
  selectedTasksRef: MutableRefObject<SelectedTask[]>;
  setSelectedTasks: (value: SelectedTask[]) => void;
  setSelectedCell: (value: CellRef | null) => void;
  /** 弹窗打开时 Delete 键不应生效（键盘事件打到弹窗里） */
  isHotkeyBlocked: boolean;
}

/**
 * 批量删除选中的主任务（Delete 键 / 右键菜单 / 页脚按钮共用）。
 *
 * 逐条 DELETE 而不是走一个批量接口：删除成功后要按实际删掉的顺序登记撤销历史，
 * 批量接口不返回明细；批量删除本身是低频操作，多几个往返可以接受。
 */
export const useTaskDeletion = ({
  canEditTasks,
  isOfflineMode,
  addToast,
  warnIfOfflineEdit,
  warnIfCellLocked,
  getSelectedTaskPayloads,
  getAllItems,
  addToHistory,
  fetchSheets,
  stopEditingCell,
  socketRef,
  selectedTasksRef,
  setSelectedTasks,
  setSelectedCell,
  isHotkeyBlocked,
}: UseTaskDeletionParams) => {
  /** 单条删除传 fallback（右键那条），多选删除不传，读当前选中 */
  const deleteSelectedTasks = useCallback(async (fallback?: { item: TaskItem; designerId: string; date: string }) => {
    if (!canEditTasks) {
      if (isOfflineMode) addToast('当前离线，禁止编辑', 'error');
      return;
    }
    if (warnIfOfflineEdit()) return;

    const selections = fallback
      ? getSelectedTaskPayloads(fallback)
      : selectedTasksRef.current
          .map(selection => {
            const item = getAllItems(selection.designerId, selection.date).find(task => task.id === selection.itemId);
            return item ? { item, designerId: selection.designerId, date: selection.date } : null;
          })
          .filter(Boolean) as { item: TaskItem; designerId: string; date: string }[];

    if (selections.length === 0) return;
    if (selections.some(selection => warnIfCellLocked(selection.designerId, selection.date, selection.item.id))) return;

    try {
      for (const selection of selections) {
        await axiosInstance.delete('/tasks/item', {
          data: { designerId: selection.designerId, date: selection.date, itemId: selection.item.id },
        });
      }

      // 单条与多选在撤销栈里是两种操作：撤销一条 delete 只需复原一条，批量则要整体复原
      if (selections.length === 1) {
        const [selection] = selections;
        addToHistory('delete', { designerId: selection.designerId, date: selection.date, item: selection.item });
      } else {
        addToHistory('batchDelete', {
          items: selections.map(selection => ({ designerId: selection.designerId, date: selection.date, item: selection.item })),
        });
      }

      void fetchSheets();
      socketRef.current?.emit('task_updated');
      stopEditingCell();
      setSelectedTasks([]);
      setSelectedCell(null);
      addToast(selections.length === 1 ? '任务已删除' : `已删除 ${selections.length} 个任务`, 'success');
    } catch {
      addToast('删除任务失败', 'error');
    }
  }, [
    canEditTasks, isOfflineMode, addToast, warnIfOfflineEdit, getSelectedTaskPayloads, getAllItems,
    warnIfCellLocked, addToHistory, fetchSheets, socketRef, stopEditingCell, setSelectedTasks, setSelectedCell,
    selectedTasksRef,
  ]);

  // Delete 键：只在没有弹窗、焦点不在输入框、确实有选中时生效
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isHotkeyBlocked || isEditableKeyboardTarget(e.target)) return;
      if (selectedTasksRef.current.length === 0) return;

      e.preventDefault();
      void deleteSelectedTasks();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteSelectedTasks, isHotkeyBlocked, selectedTasksRef]);

  return { deleteSelectedTasks };
};
