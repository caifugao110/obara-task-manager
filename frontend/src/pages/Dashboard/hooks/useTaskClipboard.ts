import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Socket } from 'socket.io-client';
import { axiosInstance } from '../../../services/api';
import { copyTaskTableToClipboard } from '../../../utils/taskCopy';
import { screenToLocal } from '../../../utils/pageZoom';
import type { TaskColorConfig } from '../../../utils/taskColors';
import { buildBatchAddHistoryItems } from '../utils';
import type { SelectedTask, TaskItem, TaskSheet } from '../types';

/**
 * 主任务剪贴板：两个 hook，按「依赖多少」分开
 *
 * 1. `useTaskTableCopy`：「复制为表格」（Ctrl 双击 C / 页脚按钮）。只依赖「是否管理员 / 配色 /
 *    toast / 选中列表 / 当月数据」五样输入，所以能在页面很靠前的位置调用；
 * 2. `useTaskClipboard`：任务行的复制 / 剪切 / 粘贴（含跨单元格 `task-copy|cut|paste` 事件、
 *    剪贴板状态本身）。依赖写库、历史、socket、编辑会话，只能在页面中段调用。
 *
 * 拆成两个而不是一个大 hook，是因为它们的**依赖就绪时机不同**：复制为表格在快捷键注册处就要用，
 * 而粘贴要等 addToHistory / upsertSheet / emitTaskUpdated 全部就位。硬塞进一个 hook 会让页面
 * 为了「调用顺序」被迫搬动大量代码，那正好是这次拆分要避免的事。
 *
 * 约定（后续继续按这个模式拆 Dashboard）：hook 只接收显式参数、只返回回调/状态，
 * 不读全局、不碰 Context，这样它既能被单测，也能在页面里被替换掉而不惊动别的逻辑。
 */

/** 实测某条主任务在页面上「任务名文本」真正可用的宽度（px），口径统一为**普通用户看到的样子**。
 *
 * 为什么不能直接用列宽：任务内容列的宽度是随视口反算的（见 index.tsx 的 VISIBLE_DAY_COLUMNS），
 * 主任务行里除了任务名，前面还固定有一个「完成状态标记」按钮
 * （完成 / 未完成二选一，hover 才显形，平时 opacity-0 但照样占 18px + 4px 间距），
 * 所以文字实际可用宽度比列宽窄（列宽 288 时约 251px）。
 * 管理员还会额外多出「上移 / 下移」按钮（普通用户没有），这里**不把它们算回去**，
 * 保证不管谁复制，粘出来的表格都按「普通用户看到的宽度」断行。
 */
export const measureTaskNameWidth = (taskId: string): number | undefined => {
  try {
    const root = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(taskId)}"]`);
    const nameEl = root?.querySelector<HTMLElement>('.task-name');
    if (!nameEl) return undefined;

    const nameStyle = window.getComputedStyle(nameEl);
    const ownPadding = (parseFloat(nameStyle.paddingLeft) || 0) + (parseFloat(nameStyle.paddingRight) || 0);
    const flex = nameEl.parentElement;
    // 行内可用宽度：取任务名所在的 flex 容器内容宽度（无 padding，含两侧按钮）
    const flexWidth = flex ? flex.clientWidth : nameEl.getBoundingClientRect().width;

    // 扣掉前面的「完成状态标记」按钮（普通用户固定 1 个：18px + margin-right 4px）。
    // 排在任务名后面的「上移 / 下移」是管理员才有的，**故意不加回去**，这样谁复制宽度都一样。
    let leadingButtonsWidth = 0;
    const markGroup = nameEl.previousElementSibling as HTMLElement | null;
    if (markGroup) {
      const markStyle = window.getComputedStyle(markGroup);
      if (markStyle.position !== 'absolute') {
        // clientWidth 是布局 px，getBoundingClientRect 是屏幕 px：主页面缩放后两者差一个倍率，统一成本地 px
        leadingButtonsWidth = screenToLocal(markGroup.getBoundingClientRect().width) + (parseFloat(markStyle.marginRight) || 0);
      }
    }

    const width = flexWidth - leadingButtonsWidth - ownPadding;
    return width > 60 ? Math.round(width) : undefined;
  } catch {
    return undefined;
  }
};

/** 多选时定一个列宽：同一张表只能有一个宽度，但选中行的排版形态可能不一样——
 * 带枪名的行文字排在按钮之间（≈251px），没有枪名的单行是居中排版、两侧各留 48px（≈177px）。
 * 这里取**出现次数最多**的那个宽度（并列时取先选中的那一行），
 * 让多数行的断行与屏幕一致，且同样的选择每次复制结果都相同。
 */
export const pickNameContentWidth = (items: TaskItem[]): number | undefined => {
  const widths = items
    .map(item => measureTaskNameWidth(item.id))
    .filter((width): width is number => typeof width === 'number');
  if (widths.length === 0) return undefined;
  const counts = new Map<number, number>();
  widths.forEach(width => counts.set(width, (counts.get(width) || 0) + 1));
  let best = widths[0];
  let bestCount = 0;
  counts.forEach((count, width) => {
    if (count > bestCount) {
      best = width;
      bestCount = count;
    }
  });
  return best;
};

interface UseTaskTableCopyParams {
  isAdmin: boolean;
  colorConfig: TaskColorConfig;
  addToast: (message: string, type: 'success' | 'error') => void;
  /** 多选复制用：必须是 ref，快捷键回调在注册时捕获的闭包不能是过期快照 */
  selectedTasksRef: MutableRefObject<SelectedTask[]>;
  /** 当前月份的表格数据，用来按「表格里的实际顺序」取选中任务 */
  sheets: TaskSheet[];
}

export const useTaskTableCopy = ({
  isAdmin,
  colorConfig,
  addToast,
  selectedTasksRef,
  sheets,
}: UseTaskTableCopyParams) => {
  // 复制指定主任务：把主任务行 + 全部枪名写成一张 HTML 表格放进剪贴板，
  // 表里只有任务名/枪名一列（不带工时）；items 必须来自同一个人同一天，按表格里的先后顺序传入
  const copyTaskAsTable = useCallback(async (items: TaskItem[]) => {
    if (!isAdmin) {
      addToast('仅管理员可复制主任务表格', 'error');
      return;
    }
    if (items.length === 0) return;
    try {
      // 实测页面上任务名的文本可用宽度：完成/上下移按钮虽然淡出不可见，但仍然占着宽度，
      // 只有按实测宽度排版，粘出来的断行位置才和屏幕上（普通用户看到的）一致
      const result = await copyTaskTableToClipboard({
        items,
        config: colorConfig,
        nameContentWidth: pickNameContentWidth(items),
      });
      if (result === 'rich') {
        addToast('已复制为表格，可直接进行粘贴', 'success');
      } else if (result === 'plain') {
        addToast('已复制为纯文本（当前浏览器不允许写带格式剪贴板）', 'success');
      } else {
        addToast('复制失败，请重试', 'error');
      }
    } catch (error) {
      console.error('主任务复制失败:', error);
      addToast('复制失败，请重试', 'error');
    }
  }, [isAdmin, colorConfig, addToast]);

  // 支持多选，但**只能选同一个人同一天**（跨单元格复制出来没法排成一张表）。
  // trigger 只影响提示文案：shortcut = 连按两次 C（默认），button = 页脚「复制任务为表格」按钮
  const copySelectedTaskAsTable = useCallback(async (trigger: 'shortcut' | 'button' = 'shortcut') => {
    if (!isAdmin) {
      addToast('仅管理员可复制主任务表格', 'error');
      return;
    }
    const selections = selectedTasksRef.current;
    if (selections.length === 0) {
      addToast(
        trigger === 'button'
          ? '请先选中主任务，再点击「复制任务为表格」'
          : '请先选中主任务，再连按两次 C 复制',
        'error',
      );
      return;
    }
    const { designerId, date } = selections[0];
    if (selections.some(selection => selection.designerId !== designerId || selection.date !== date)) {
      addToast('只能复制同一个人同一天的主任务，请重新选择', 'error');
      return;
    }
    const sheet = sheets.find(s => s.designerId === designerId);
    const dayItems = sheet && Array.isArray(sheet.days?.[date]) ? sheet.days[date] : [];
    const selectedIds = new Set(selections.map(selection => selection.itemId));
    // 按表格里的实际顺序取任务，而不是用户点击的先后顺序，保证粘出来与屏幕顺序一致
    const items = dayItems.filter(task => selectedIds.has(task.id));
    if (items.length !== selections.length) {
      addToast('部分主任务已不存在，请刷新后重试', 'error');
      return;
    }
    await copyTaskAsTable(items);
  }, [isAdmin, sheets, copyTaskAsTable, addToast]);

  return { copyTaskAsTable, copySelectedTaskAsTable };
};

/** 复制/剪切时的任务载荷：任务本体 + 它所在的设计员与日期（跨单元格粘贴时按这三样定位） */
export interface TaskPayload {
  item: TaskItem;
  designerId: string;
  date: string;
}

interface UseTaskClipboardParams {
  /** 是否已登录（未登录时复制/剪切/粘贴全部不动作，与页面原逻辑一致） */
  hasUser: boolean;
  /** 离线时统一提示并拦截；返回 true 表示已拦截 */
  warnIfOfflineEdit: () => boolean;
  /** 单元格被他人锁定时提示并拦截；返回 true 表示已拦截 */
  warnIfCellLocked: (designerId: string, date: string, itemId?: string) => boolean;
  /** 由页面提供：把「点中的那一行」扩展成多选集合（含跨单元格校验） */
  getSelectedTaskPayloads: (fallback: { item: TaskItem; designerId: string; date: string }) => TaskPayload[];
  addToast: (message: string, type: 'success' | 'error') => void;
  addToHistory: (operation: string, data: unknown) => void;
  fetchSheets: () => Promise<void> | void;
  upsertSheet: (sheet: TaskSheet) => void;
  emitTaskUpdated: (designerId: string) => void;
  stopEditingCell: (designerId?: string, date?: string) => void;
  setSelectedTasks: (value: SelectedTask[]) => void;
  setSelectedCell: (value: { designerId: string; date: string } | null) => void;
  socketRef: MutableRefObject<Socket | null>;
}

/**
 * 任务行的复制 / 剪切 / 粘贴。
 *
 * 这里同时收拢了剪贴板状态本身（原先散在页面顶部的 useState + ref + useEffect 三件套）：
 * 状态和它的三个使用点分开写，很容易出现「复制走新状态、粘贴读旧引用」的隐患，
 * 现在同一份状态只在这个 hook 里流动。
 *
 * 两种入口共用同一套动作：
 *   - 单元格右键 / 快捷键触发的 `task-copy` / `task-cut` / `task-paste` 自定义事件（window 监听）；
 *   - 单元格上的 `handlePaste`（点击粘贴时直接给 designerId + date）。
 */
export const useTaskClipboard = ({
  hasUser,
  warnIfOfflineEdit,
  warnIfCellLocked,
  getSelectedTaskPayloads,
  addToast,
  addToHistory,
  fetchSheets,
  upsertSheet,
  emitTaskUpdated,
  stopEditingCell,
  setSelectedTasks,
  setSelectedCell,
  socketRef,
}: UseTaskClipboardParams) => {
  const [clipboard, setClipboard] = useState<TaskItem[] | null>(null);
  // 事件回调在注册时捕获闭包，必须用 ref 读最新值，否则「刚复制完就粘贴」会拿到 null
  const clipboardRef = useRef<TaskItem[] | null>(null);
  useEffect(() => {
    clipboardRef.current = clipboard;
  }, [clipboard]);

  /** 把剪贴板内容批量写入某个单元格，并登记一条 batchAdd 历史（供撤销） */
  const pasteIntoCell = useCallback(async (designerId: string, date: string, items: TaskItem[]) => {
    addToast('任务已复制', 'success');
    const res = await axiosInstance.post('/tasks/item/batch', { designerId, date, items });
    upsertSheet(res.data.sheet);
    addToHistory('batchAdd', buildBatchAddHistoryItems(res.data.items, items, designerId, date));
    emitTaskUpdated(designerId);
    stopEditingCell(designerId, date);
    setSelectedTasks([]);
    setSelectedCell(null);
  }, [addToast, upsertSheet, addToHistory, emitTaskUpdated, stopEditingCell, setSelectedTasks, setSelectedCell]);

  /** 单元格上的粘贴（点击/快捷键落到具体格子时调用） */
  const handlePaste = useCallback(async (designerId: string, date: string) => {
    if (warnIfOfflineEdit()) return;
    if (!clipboard || !hasUser) return;
    if (warnIfCellLocked(designerId, date)) return;
    try {
      await pasteIntoCell(designerId, date, clipboard);
    } catch {
      addToast('粘贴失败', 'error');
    }
  }, [warnIfOfflineEdit, clipboard, hasUser, warnIfCellLocked, pasteIntoCell, addToast]);

  useEffect(() => {
    const handleTaskCopy = (e: Event) => {
      const { item, designerId, date } = (e as CustomEvent).detail;
      const payloads = getSelectedTaskPayloads({ item, designerId, date });
      setClipboard(payloads.map(payload => payload.item));
      addToast('粘贴已准备', 'success');
    };

    const handleTaskCut = async (e: Event) => {
      const { item, designerId, date } = (e as CustomEvent).detail;
      if (warnIfOfflineEdit()) return;
      if (!hasUser) return;
      const payloads = getSelectedTaskPayloads({ item, designerId, date });
      if (payloads.length === 0) return;
      if (payloads.some(payload => warnIfCellLocked(payload.designerId, payload.date, payload.item.id))) return;

      setClipboard(payloads.map(payload => payload.item));
      addToast('剪切已准备', 'success');

      try {
        // 逐条删除而不是批量接口：删除成功后要按「实际删掉的顺序」登记历史，批量接口不返回明细
        for (const payload of payloads) {
          await axiosInstance.delete('/tasks/item', {
            data: { designerId: payload.designerId, date: payload.date, itemId: payload.item.id },
          });
        }
        addToHistory('batchDelete', {
          items: payloads.map(payload => ({ designerId: payload.designerId, date: payload.date, item: payload.item })),
        });
        void fetchSheets();
        socketRef.current?.emit('task_updated');
        stopEditingCell();
        setSelectedTasks([]);
        setSelectedCell(null);
      } catch {
        addToast('剪切失败', 'error');
      }
    };

    const handleTaskPaste = async (e: Event) => {
      const { designerId, date } = (e as CustomEvent).detail;
      if (warnIfOfflineEdit()) return;
      if (!hasUser) return;
      if (!clipboardRef.current || clipboardRef.current.length === 0) {
        addToast('请先复制任务', 'error');
        return;
      }
      if (warnIfCellLocked(designerId, date)) return;
      try {
        await pasteIntoCell(designerId, date, clipboardRef.current);
      } catch {
        addToast('粘贴失败', 'error');
      }
    };

    window.addEventListener('task-copy', handleTaskCopy);
    window.addEventListener('task-cut', handleTaskCut);
    window.addEventListener('task-paste', handleTaskPaste);

    return () => {
      window.removeEventListener('task-copy', handleTaskCopy);
      window.removeEventListener('task-cut', handleTaskCut);
      window.removeEventListener('task-paste', handleTaskPaste);
    };
  }, [
    hasUser, addToast, addToHistory, fetchSheets,
    getSelectedTaskPayloads, pasteIntoCell, setSelectedCell, setSelectedTasks,
    socketRef, stopEditingCell, warnIfCellLocked, warnIfOfflineEdit,
  ]);

  return { clipboard, clipboardRef, handlePaste };
};
