import { useCallback, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Socket } from 'socket.io-client';
import {
  rectIntersection,
  pointerWithin,
  PointerSensor,
  useSensor,
  useSensors,
  CollisionDetection,
  DragEndEvent,
  DragStartEvent,
  DragOverEvent,
  DragMoveEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { axiosInstance } from '../../../services/api';
import { gunRowDragState } from '../gunDragState';
import { isTaskContentIdentical } from '../utils';
import type { Designer, GunItem, SelectedTask, TaskItem, TaskSheet } from '../types';

interface UseGunDragDropParams {
  canEditTasks: boolean;
  warnIfCellLocked: (designerId: string, date: string, itemId?: string | null) => boolean;
  getAllItems: (designerId: string, date: string) => TaskItem[];
  getVisibleItems: (designerId: string, date: string) => TaskItem[];
  getSelectedTaskPayloads: (fallback: { item: TaskItem; designerId: string; date: string }) => { item: TaskItem; designerId: string; date: string }[];
  designers: Designer[];
  setDesigners: React.Dispatch<React.SetStateAction<Designer[]>>;
  token: string | null;
  addToHistory: (operation: string, data: any) => void;
  upsertSheet: (incoming: TaskSheet) => void;
  fetchSheets: () => Promise<void>;
  fetchData: () => Promise<void>;
  stopEditingCell: (designerId?: string | null, date?: string | null) => void;
  addToast: (message: string, type: 'success' | 'error') => void;
  onMoveGunToTask: (args: {
    sourceDesignerId: string;
    sourceDate: string;
    sourceItemId: string;
    sourceGunIndex: number;
    gunId: string;
    targetDesignerId: string;
    targetDate: string;
    targetItemId: string;
    createTaskName?: string;
    newIndex?: number;
    sourceItemSnapshot?: TaskItem;
  }) => Promise<void>;
  setSelectedTasks: React.Dispatch<React.SetStateAction<SelectedTask[]>>;
  setSelectedCell: React.Dispatch<React.SetStateAction<{designerId: string, date: string} | null>>;
  socketRef: MutableRefObject<Socket | null>;
}

export const useGunDragDrop = ({
  canEditTasks,
  warnIfCellLocked,
  getAllItems,
  getVisibleItems,
  getSelectedTaskPayloads,
  designers,
  setDesigners,
  // 保留在接口中但本 hook 不再使用，下划线前缀标记为有意忽略
  token: _token,
  addToHistory,
  upsertSheet,
  fetchSheets,
  fetchData,
  stopEditingCell,
  addToast,
  onMoveGunToTask,
  setSelectedTasks,
  setSelectedCell,
  socketRef,
}: UseGunDragDropParams) => {
  const [activeTask, setActiveTask] = useState<{item: TaskItem, designerId: string, date: string, isCtrlDrag?: boolean} | null>(null);
  // 正在拖拽的枪名（十字箭头手柄按住不放触发）；dims 为原枪名行两格（枪名格+工时格）的实测尺寸，用于浮层等比复刻
  const [activeGun, setActiveGun] = useState<{gun: GunItem, item: TaskItem, designerId: string, date: string, gunIndex: number, dims?: {width: number, height: number, hoursWidth: number, offsetX?: number, offsetY?: number}} | null>(null);
  // 枪名拖拽过程中，指针扫过的目标主任务（预选中反馈）：
  // invalid = 不可放置（红）——目标已有同名枪名（noGuns=false）或目标主任务没有任何枪名（noGuns=true）；
  // isSelf = 扫过的是源主任务自身（不预选中、禁止拖拽调整）；
  // create = 指针落在可新建主任务的位置（松手会按源主任务名称新建主任务，itemId 恒为 ''）：
  //   append=false → 落在没有任何主任务的空白单元格上（整格高亮）；
  //   append=true  → 落在已有主任务单元格最下方的加号区（新建的主任务追加到该格最下面）
  const [gunDropTarget, setGunDropTarget] = useState<{ designerId: string, date: string, itemId: string, invalid: boolean, isSelf: boolean, noGuns?: boolean, create?: boolean, append?: boolean } | null>(null);
  const gunDropTargetRef = useRef<string>('');
  // 主任务拖拽过程中，指针扫过的目标位置（预选中反馈）：
  // itemId = 预插入到该主任务上方；itemId 为 null = 预追加到目标单元格最下方；
  // duplicate = 目标单元格已存在内容完全一样的主任务（红，移动/复制都会被拒绝）
  const [taskDropTarget, setTaskDropTarget] = useState<{ designerId: string, date: string, itemId: string | null, duplicate: boolean } | null>(null);
  const taskDropTargetRef = useRef<{ designerId: string, date: string, itemId: string | null, duplicate: boolean } | null>(null);
  // 主任务拖拽是否按住 Ctrl（复制）：dragStart 时记录，供 dragMove 实时判定重复标记（避免 state 闭包旧值）
  const taskDragCtrlRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isOverDelete, setIsOverDelete] = useState(false);
  const lastOverIdRef = useRef<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const collisionDetection: CollisionDetection = useCallback((args) => {
    const pointer = pointerWithin(args);
    if (pointer.length) return pointer;
    return rectIntersection(args);
  }, []);

  const handleDragStart = (event: DragStartEvent) => {
    if (!canEditTasks) return;
    const { active: { data } } = event;
    const data_current = data.current;

    const isCtrlDrag = event.activatorEvent &&
      (event.activatorEvent as MouseEvent | KeyboardEvent).ctrlKey;

    if (data_current?.type === 'task') {
      if (warnIfCellLocked(data_current.designerId, data_current.date, data_current.item?.id)) return;
      taskDragCtrlRef.current = Boolean(isCtrlDrag);
      setTaskDropTargetState(null);
      setActiveTask({
        item: data_current.item,
        designerId: data_current.designerId,
        date: data_current.date,
        isCtrlDrag,
      });
      setIsDragging(true);
      return;
    }

    if (data_current?.type === 'gun') {
      if (warnIfCellLocked(data_current.designerId, data_current.date, data_current.item?.id)) return;
      setGunDropTargetState(null);
      // 优先使用 pointerDown 时量取的源枪名行尺寸；若丢失（如拖拽激活前重渲染），
      // 回退到保留的源 DOM 或事件坐标重新量取，最大限度保证 DragOverlay 与原行尺寸一致
      let measured = gunRowDragState.dims;
      if (!measured || !isFinite(measured.width) || !isFinite(measured.height) || measured.width <= 0 || measured.height <= 0) {
        const cell =
          (gunRowDragState.originCell?.isConnected ? gunRowDragState.originCell : null) ??
          (() => {
            const ev = event.activatorEvent as PointerEvent | MouseEvent | undefined;
            if (!ev || !('clientX' in ev) || !('clientY' in ev)) return null;
            const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
            return el?.closest('[data-gun-index]') as HTMLElement | null;
          })();
        const hoursCell = cell?.nextElementSibling as HTMLElement | null;
        if (cell) {
          const r = cell.getBoundingClientRect();
          const hr = hoursCell?.getBoundingClientRect();
          measured = {
            width: r.width + (hr?.width ?? 0),
            height: r.height,
            hoursWidth: hr?.width ?? 0,
            x: r.x,
            y: r.y,
          };
        }
      }
      let dims: {width: number, height: number, hoursWidth: number, offsetX?: number, offsetY?: number} | undefined;
      if (measured && isFinite(measured.width) && isFinite(measured.height) && measured.width > 0 && measured.height > 0) {
        // DragOverlay 根容器宽高锁定为激活节点（手柄按钮，约 21x21），
        // 浮层内容必须显式指定整行宽高，并按「源枪名格 − 手柄初始位置」平移对齐源行
        const hasHandlePos = typeof measured.handleX === 'number' && typeof measured.handleY === 'number';
        const offsetX = hasHandlePos && isFinite(measured.x) ? measured.x - (measured.handleX as number) : 0;
        const offsetY = hasHandlePos && isFinite(measured.y) ? measured.y - (measured.handleY as number) : 0;
        dims = {
          width: Math.min(Math.max(measured.width, 80), 800),
          height: Math.min(Math.max(measured.height, 18), 60),
          hoursWidth: Math.min(Math.max(measured.hoursWidth, 24), 120),
          offsetX: Math.min(Math.max(offsetX, -2000), 2000),
          offsetY: Math.min(Math.max(offsetY, -2000), 2000),
        };
      }
      gunRowDragState.dims = null;
      gunRowDragState.originCell = null;
      setActiveGun({
        gun: data_current.gun,
        item: data_current.item,
        designerId: data_current.designerId,
        date: data_current.date,
        gunIndex: data_current.gunIndex,
        dims,
      });
    }
  };

  // 更新「指针扫过的目标主任务 + 是否可放置」：同步 ref/state，并切换禁止放置光标
  const setGunDropTargetState = (next: { designerId: string, date: string, itemId: string, invalid: boolean, isSelf: boolean, noGuns?: boolean, create?: boolean, append?: boolean } | null) => {
    const key = next
      ? `${next.designerId}|${next.date}|${next.itemId}|${next.invalid ? '1' : '0'}|${next.isSelf ? '1' : '0'}|${next.noGuns ? '1' : '0'}|${next.create ? '1' : '0'}|${next.append ? '1' : '0'}`
      : '';
    if (gunDropTargetRef.current === key) return;
    gunDropTargetRef.current = key;
    setGunDropTarget(next);
    // 扫过自身主任务或目标重名时都禁止放置
    document.body.style.cursor = next && (next.invalid || next.isSelf) ? 'not-allowed' : '';
  };

  // 枪名拖拽落点：一次性命中枪名行 / 主任务容器 / 单元格 / 单元格最下方加号区（每层取最外层匹配）
  // 拖拽过程中每次 mousemove 都要判定，合并成单次 elementsFromPoint 避免大表格上重复计算
  const hitTestGunDropLayers = (cx: number, cy: number): {
    gunEl: HTMLElement | null,
    taskEl: HTMLElement | null,
    cellEl: HTMLElement | null,
    plusEl: HTMLElement | null,
  } => {
    const stack = document.elementsFromPoint(cx, cy);
    let gunEl: HTMLElement | null = null;
    let taskEl: HTMLElement | null = null;
    let cellEl: HTMLElement | null = null;
    let plusEl: HTMLElement | null = null;
    for (const el of stack) {
      if (!(el instanceof HTMLElement)) continue;
      if (!gunEl) {
        const g = el.closest('[data-gun-index]');
        if (g instanceof HTMLElement) gunEl = g;
      }
      if (!taskEl) {
        const t = el.closest('[data-task-id]');
        if (t instanceof HTMLElement) taskEl = t;
      }
      if (!cellEl) {
        const c = el.closest('[data-cell-designer-id]');
        if (c instanceof HTMLElement) cellEl = c;
      }
      if (!plusEl) {
        const p = el.closest('[data-cell-plus]');
        if (p instanceof HTMLElement) plusEl = p;
      }
      if (gunEl && taskEl && cellEl && plusEl) break;
    }
    return { gunEl, taskEl, cellEl, plusEl };
  };

  // 拖拽事件的指针实际位置：激活事件坐标 + 位移 delta（键盘拖拽等无坐标场景返回 null）
  const getDragPointer = (event: DragMoveEvent | DragEndEvent): { x: number, y: number } | null => {
    const ev = event.activatorEvent as PointerEvent | MouseEvent | undefined;
    if (!ev || !('clientX' in ev) || !('clientY' in ev)) return null;
    return { x: ev.clientX + event.delta.x, y: ev.clientY + event.delta.y };
  };

  // 指针位置同时命中单元格（data-cell-designer-id）与主任务容器；命中的主任务必须属于该单元格
  const hitTestCellAndTask = (cx: number, cy: number): { cellEl: HTMLElement | null, taskEl: HTMLElement | null } => {
    const stack = document.elementsFromPoint(cx, cy);
    let cellEl: HTMLElement | null = null;
    let taskEl: HTMLElement | null = null;
    for (const el of stack) {
      if (!(el instanceof HTMLElement)) continue;
      if (!cellEl) {
        const c = el.closest('[data-cell-designer-id]');
        if (c instanceof HTMLElement) cellEl = c;
      }
      if (!taskEl) {
        const t = el.closest('[data-task-id]');
        if (t instanceof HTMLElement) taskEl = t;
      }
      if (cellEl && taskEl) break;
    }
    if (cellEl && taskEl) {
      const sameCell = taskEl.getAttribute('data-designer-id') === cellEl.getAttribute('data-cell-designer-id')
        && taskEl.getAttribute('data-date') === cellEl.getAttribute('data-cell-date');
      if (!sameCell) taskEl = null;
    }
    return { cellEl, taskEl };
  };

  // 判断目标主任务是否已存在同名枪名（同主任务内重排不算）
  const isGunDropDuplicate = (taskEl: HTMLElement, sourceData: any): boolean => {
    const dId = taskEl.getAttribute('data-designer-id') || '';
    const dt = taskEl.getAttribute('data-date') || '';
    const itemId = taskEl.getAttribute('data-task-id') || '';
    if (!dId || !dt || !itemId) return false;
    if (dId === sourceData.designerId && dt === sourceData.date && itemId === sourceData.item.id) return false;
    const gunName = String(sourceData.gun?.name || '').trim();
    if (!gunName) return false;
    const targetItem = getAllItems(dId, dt).find(i => i.id === itemId);
    return !!targetItem && (targetItem.guns || []).some(g => String(g?.name || '').trim() === gunName);
  };


  // 目标单元格是否已存在与 sourceItem 内容完全一样的主任务（用于 Ctrl 复制预选中变红）
  const isTaskCopyDuplicate = (designerId: string, date: string, sourceItem: TaskItem): boolean => {
    return getAllItems(designerId, date).some(i => isTaskContentIdentical(i, sourceItem));
  };

  // 更新「主任务拖拽指针扫过的目标位置」：同步 ref/state，并在复制重复时切换禁止放置光标
  const setTaskDropTargetState = (next: { designerId: string, date: string, itemId: string | null, duplicate: boolean } | null) => {
    const key = next
      ? `${next.designerId}|${next.date}|${next.itemId ?? 'append'}|${next.duplicate ? '1' : '0'}`
      : '';
    const prev = taskDropTargetRef.current;
    const prevKey = prev
      ? `${prev.designerId}|${prev.date}|${prev.itemId ?? 'append'}|${prev.duplicate ? '1' : '0'}`
      : '';
    if (prevKey === key) return;
    taskDropTargetRef.current = next;
    setTaskDropTarget(next);
    document.body.style.cursor = next?.duplicate ? 'not-allowed' : '';
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const { active } = event;
    const sourceData = active.data.current;

    // 主任务拖拽：指针扫过的目标位置实时显示标记框（绿=预移动到该主任务上方/最下方，红=复制内容重复）；
    // 扫过自己当天的源单元格不显示标记框
    if (sourceData?.type === 'task') {
      const pointer = getDragPointer(event);
      if (!pointer) {
        setTaskDropTargetState(null);
        return;
      }
      const { cellEl, taskEl } = hitTestCellAndTask(pointer.x, pointer.y);
      if (!cellEl) {
        setTaskDropTargetState(null);
        return;
      }
      const designerId = cellEl.getAttribute('data-cell-designer-id') || '';
      const date = cellEl.getAttribute('data-cell-date') || '';
      if (!designerId || !date) {
        setTaskDropTargetState(null);
        return;
      }
      // 划过自己当天的任务框（源单元格）：不做预选中标记
      if (designerId === sourceData.designerId && date === sourceData.date) {
        setTaskDropTargetState(null);
        return;
      }
      const overItemId = taskEl ? (taskEl.getAttribute('data-task-id') || null) : null;
      // 目标单元格已存在内容完全一样的主任务（多选时任一重复即标红）→ 红色重复标记，移动/复制都会被拒绝；
      // 复制时检查全部待复制任务；移动时仅检查真正会被移过去的任务（已在目标单元格中的选中任务不参与）
      const isCopyDrag = taskDragCtrlRef.current;
      const duplicate = getSelectedTaskPayloads({ item: sourceData.item, designerId: sourceData.designerId, date: sourceData.date })
        .filter(payload => isCopyDrag || !(payload.designerId === designerId && payload.date === date))
        .some(payload => isTaskCopyDuplicate(designerId, date, payload.item));
      setTaskDropTargetState({ designerId, date, itemId: overItemId, duplicate });
      return;
    }

    if (sourceData?.type !== 'gun') return;
    const rect = active.rect.current.translated;
    if (!rect) {
      setGunDropTargetState(null);
      return;
    }
    // 落点跟随指针（十字光标）实际位置：激活节点是枪名行右侧的拖动手柄，
    // 其矩形中心即光标位置。不能用浮层整行中心——手柄偏向行右侧，整行中心
    // 比光标偏左约半行宽，悬停在右格左半区时会误判到左侧相邻人员单元格。
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const { taskEl, cellEl, plusEl } = hitTestGunDropLayers(cx, cy);
    if (!taskEl) {
      // 落点没有主任务：可新建主任务的位置有两种——
      // ① 整格没有任何主任务的空白单元格（整格预选中）；
      // ② 已有主任务的单元格最下方加号区（只在加号上预选中，新主任务追加到该格最下面）
      const cellDesignerId = cellEl?.getAttribute('data-cell-designer-id') || '';
      const cellDate = cellEl?.getAttribute('data-cell-date') || '';
      if (!cellDesignerId || !cellDate) {
        setGunDropTargetState(null);
        return;
      }
      const overPlus = Boolean(plusEl && plusEl.closest('[data-cell-designer-id]') === cellEl);
      const hasTasks = getVisibleItems(cellDesignerId, cellDate).length > 0;
      if (!hasTasks || overPlus) {
        setGunDropTargetState({
          designerId: cellDesignerId,
          date: cellDate,
          itemId: '',
          invalid: false,
          isSelf: false,
          create: true,
          append: hasTasks,
        });
      } else {
        setGunDropTargetState(null);
      }
      return;
    }
    const designerId = taskEl.getAttribute('data-designer-id') || '';
    const date = taskEl.getAttribute('data-date') || '';
    const itemId = taskEl.getAttribute('data-task-id') || '';
    if (!designerId || !date || !itemId) {
      setGunDropTargetState(null);
      return;
    }
    // 扫过的是源主任务自身：不做预选中高亮，且禁止拖拽调整顺序
    // （同主任务内调整枪名顺序请使用行内的上移/下移箭头）
    const isSelf = designerId === sourceData.designerId && date === sourceData.date && itemId === sourceData.item.id;
    // 目标主任务没有任何枪名：不允许把枪名移进去（该行只有主任务自身的内容，需先有枪名才能承接枪名）
    const targetItem = getAllItems(designerId, date).find(i => i.id === itemId);
    const noGuns = Boolean(targetItem && !(targetItem.guns || []).length);
    setGunDropTargetState({
      designerId,
      date,
      itemId,
      invalid: isSelf ? false : (noGuns || isGunDropDuplicate(taskEl, sourceData)),
      isSelf,
      noGuns: isSelf ? false : noGuns,
    });
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (!canEditTasks) return;
    const { active, over } = event;
    const activeType = active.data.current?.type;
    if (activeType !== 'task') {
      setIsOverDelete(false);
      return;
    }
    lastOverIdRef.current = over?.id ? String(over.id) : null;
    setIsOverDelete(over?.id === 'delete-area');
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setIsDragging(false);
    setActiveGun(null);
    setGunDropTargetState(null);
    // 落点以拖拽过程中实时维护的指针命中结果为准（ref 保存最新值，避免闭包旧值）
    const dropTargetSnapshot = taskDropTargetRef.current;
    setTaskDropTargetState(null);

    const sourceData = active.data.current;
    const targetData = over?.data.current;

    if (!canEditTasks) return;

    // 枪名拖拽：可移动到任意人员的任意日期的任意主任务；
    // 命中某条枪名则插入到该枪名上面，否则追加到该主任务最下面
    if (sourceData?.type === 'gun') {
      const translatedRect = active.rect.current.translated;
      if (!translatedRect) return;
      // 落点以指针（十字光标）实际位置为准：激活节点是枪名行右侧的拖动手柄，
      // 其矩形中心即光标位置。不能用浮层整行中心——手柄偏向行右侧，整行中心
      // 比光标偏左约半行宽，光标已进入右侧目标单元格时仍会误命中左边单元格。
      // 注意：DragOverlay 浮层容器本身会出现在 elementsFromPoint 栈顶，但其无
      // data-gun-index/data-task-id，closest 匹配为空后循环会继续穿透到下方真实行。
      const cx = translatedRect.left + translatedRect.width / 2;
      const cy = translatedRect.top + translatedRect.height / 2;
      const layers = hitTestGunDropLayers(cx, cy);
      let gunTargetEl = layers.gunEl;
      const taskTargetEl = layers.taskEl;
      const cellTargetEl = layers.cellEl;
      const plusTargetEl = layers.plusEl;
      // 命中的枪名必须属于同一个主任务容器
      if (gunTargetEl && taskTargetEl && gunTargetEl.closest('[data-task-id]') !== taskTargetEl) gunTargetEl = null;

      // 落点没有主任务：两种情况可按源主任务名称新建主任务承接该枪名——
      // ① 整格没有任何主任务的空白单元格；
      // ② 已有主任务的单元格最下方加号区（新主任务追加到该格最下面）
      if (!taskTargetEl) {
        const cellDesignerId = cellTargetEl?.getAttribute('data-cell-designer-id') || '';
        const cellDate = cellTargetEl?.getAttribute('data-cell-date') || '';
        if (!cellDesignerId || !cellDate) return; // 未落在表格单元格上，取消移动
        const plusCellEl = plusTargetEl?.closest('[data-cell-designer-id]');
        const overPlus = Boolean(plusTargetEl && plusCellEl === cellTargetEl);
        // 松手回到源单元格空白处：视为取消，不提示（落在加号上除外，加号是明确的新建意图）
        if (!overPlus && cellDesignerId === sourceData.designerId && cellDate === sourceData.date) return;
        const hasTasks = getVisibleItems(cellDesignerId, cellDate).length > 0;
        if (hasTasks && !overPlus) {
          addToast('该位置没有主任务，请拖到已有主任务上，或拖到该格最下面的加号上新建主任务', 'error');
          return;
        }
        if (warnIfCellLocked(cellDesignerId, cellDate)) return;
        await onMoveGunToTask({
          sourceDesignerId: sourceData.designerId,
          sourceDate: sourceData.date,
          sourceItemId: sourceData.item.id,
          sourceGunIndex: sourceData.gunIndex,
          gunId: sourceData.gun.id,
          targetDesignerId: cellDesignerId,
          targetDate: cellDate,
          // targetItemId 为空：由后端按 createTaskName 新建主任务承接该枪名
          targetItemId: '',
          createTaskName: String(sourceData.item?.taskName || ''),
          sourceItemSnapshot: sourceData.item,
        });
        return;
      }

      const targetDesignerId = taskTargetEl.getAttribute('data-designer-id') || '';
      const targetDate = taskTargetEl.getAttribute('data-date') || '';
      const targetItemId = taskTargetEl.getAttribute('data-task-id') || '';
      if (!targetDesignerId || !targetDate || !targetItemId) return;
      if (warnIfCellLocked(targetDesignerId, targetDate, targetItemId)) return;

      const sameItem = sourceData.designerId === targetDesignerId && sourceData.date === targetDate && sourceData.item.id === targetItemId;
      // 禁止拖拽调整自身主任务内的枪名顺序：请使用该枪名行的上移/下移箭头
      if (sameItem) {
        addToast('同一主任务内请使用枪名行的上移/下移箭头调整顺序', 'error');
        return;
      }
      // 目标主任务没有任何枪名：不允许把枪名移进去（前后端双重拦截，后端 /tasks/move-gun 同样校验）
      const targetItemForCheck = getAllItems(targetDesignerId, targetDate).find(i => i.id === targetItemId);
      if (targetItemForCheck && !(targetItemForCheck.guns || []).length) {
        addToast('目标主任务没有枪名，不能移入枪名', 'error');
        return;
      }
      // 目标主任务存在同名枪名：前端直接拦截并提示（后端 /tasks/move-gun 同样有校验兜底）
      const movingGunName = String(sourceData.gun?.name || '').trim();
      if (movingGunName && targetItemForCheck) {
        if ((targetItemForCheck.guns || []).some(g => String(g?.name || '').trim() === movingGunName)) {
          addToast(`目标主任务已存在枪名「${movingGunName}」，无法移动`, 'error');
          return;
        }
      }
      const newIndex = gunTargetEl ? Number(gunTargetEl.getAttribute('data-gun-index')) : undefined;

      await onMoveGunToTask({
        sourceDesignerId: sourceData.designerId,
        sourceDate: sourceData.date,
        sourceItemId: sourceData.item.id,
        sourceGunIndex: sourceData.gunIndex,
        gunId: sourceData.gun.id,
        targetDesignerId,
        targetDate,
        targetItemId,
        newIndex,
        sourceItemSnapshot: sourceData.item,
      });
      return;
    }

    const isCtrlDrag = activeTask?.isCtrlDrag;

    // Ctrl+拖拽复制主任务：落点由指针命中快照决定——命中某条主任务则插入到其上方，
    // 否则追加到目标单元格最下方；目标已存在内容完全一样的主任务时拒绝复制
    if (isCtrlDrag && sourceData?.type === 'task') {
      if (!dropTargetSnapshot) {
        setActiveTask(null);
        return;
      }
      if (warnIfCellLocked(dropTargetSnapshot.designerId, dropTargetSnapshot.date)) {
        setActiveTask(null);
        return;
      }
      const targetDesignerId = dropTargetSnapshot.designerId;
      const targetDate = dropTargetSnapshot.date;
      const targetItems = getAllItems(targetDesignerId, targetDate);
      let newIndex: number | undefined = undefined;
      if (dropTargetSnapshot.itemId) {
        const hitIndex = targetItems.findIndex(i => i.id === dropTargetSnapshot.itemId);
        if (hitIndex >= 0) newIndex = hitIndex;
      }
      try {
        const payloads = getSelectedTaskPayloads({ item: sourceData.item, designerId: sourceData.designerId, date: sourceData.date });
        const duplicatePayload = payloads.find(payload => targetItems.some(i => isTaskContentIdentical(i, payload.item)));
        if (duplicatePayload) {
          addToast(`目标已存在内容完全相同的主任务「${(duplicatePayload.item.taskName || '').trim() || '无'}」，拒绝复制`, 'error');
          setActiveTask(null);
          return;
        }
        const res = await axiosInstance.post('/tasks/item/batch', {
          designerId: targetDesignerId,
          date: targetDate,
          items: payloads.map(payload => payload.item),
          newIndex
        });
        addToHistory('batchAdd', {
          items: (res.data.items || []).map((created: TaskItem, idx: number) => ({
            designerId: targetDesignerId,
            date: targetDate,
            itemId: created.id,
            item: payloads[idx]?.item
          }))
        });
        upsertSheet(res.data.sheet);
        socketRef.current?.emit('task_updated');
        setActiveTask(null);
        addToast('任务已复制', 'success');
        return;
      } catch (err: any) {
        addToast('复制失败', 'error');
        setActiveTask(null);
        return;
      }
    }

    if (sourceData?.type === 'designer' && targetData?.type === 'designer') {
      const group = sourceData.group;
      if (group !== targetData.group) return;

      const groupIds = designers.filter(d => (d.group || '未分组') === group).map(d => d.id);
      const oldIndex = groupIds.indexOf(sourceData.designerId);
      const newIndex = groupIds.indexOf(targetData.designerId);
      if (oldIndex === -1 || newIndex === -1) return;

      const nextGroupIds = arrayMove(groupIds, oldIndex, newIndex);
      const groupOf = new Map(designers.map(d => [d.id, d.group || '未分组']));
      let ptr = 0;
      const nextIds = designers.map(d => d.id).map(id => (groupOf.get(id) === group ? nextGroupIds[ptr++] : id));

      const byId = new Map(designers.map(d => [d.id, d]));
      const nextDesigners = nextIds.map(id => byId.get(id)).filter(Boolean) as Designer[];
      setDesigners(nextDesigners);

      try {
        await axiosInstance.post('/designers/reorder', { ids: nextIds });
        addToast('排序已保存', 'success');
      } catch (err) {
        addToast('排序保存失败', 'error');
        fetchData();
      } finally {
        setActiveTask(null);
      }
      return;
    }

    // 主任务移动（无 Ctrl）：落点以指针命中快照为准——命中某条主任务则移动到其上方，
    // 否则移动到目标单元格最下方；落在源单元格（自己当天的任务框）时不做任何移动
    if (sourceData?.type === 'task') {
      const sourceDesignerId = sourceData.designerId;
      const sourceDate = sourceData.date;

      if (!dropTargetSnapshot) {
        setActiveTask(null);
        return;
      }
      const targetDesignerId = dropTargetSnapshot.designerId;
      const targetDate = dropTargetSnapshot.date;

      // 源主任务按主任务粒度校验；目标单元格仅插入新位置，不修改他人正在编辑的主任务，故只做整格级（旧版会话）校验
      if (warnIfCellLocked(sourceDesignerId, sourceDate, sourceData.item?.id) || warnIfCellLocked(targetDesignerId, targetDate)) {
        setActiveTask(null);
        return;
      }

      const targetItems = getAllItems(targetDesignerId, targetDate);
      let newIndex: number | undefined = undefined;
      if (dropTargetSnapshot.itemId) {
        const hitIndex = targetItems.findIndex(i => i.id === dropTargetSnapshot.itemId);
        if (hitIndex >= 0) newIndex = hitIndex;
      }

      try {
        const payloads = getSelectedTaskPayloads({ item: sourceData.item, designerId: sourceDesignerId, date: sourceDate });
        // 多选时排除已在目标单元格中的任务，避免同单元格重复挪动导致顺序抖动
        const movedPayloads = payloads.filter(payload => !(payload.designerId === targetDesignerId && payload.date === targetDate));
        if (movedPayloads.length === 0) {
          setActiveTask(null);
          return;
        }

        // 目标单元格已存在内容完全一样的主任务时拒绝移动（任一重复即整体拒绝）
        const duplicatePayload = movedPayloads.find(payload => targetItems.some(i => isTaskContentIdentical(i, payload.item)));
        if (duplicatePayload) {
          addToast(`目标已存在内容完全相同的主任务「${(duplicatePayload.item.taskName || '').trim() || '无'}」，拒绝移动`, 'error');
          setActiveTask(null);
          return;
        }

        for (const payload of movedPayloads) {
          await axiosInstance.post('/tasks/move', {
            sourceDesignerId: payload.designerId,
            sourceDate: payload.date,
            itemId: payload.item.id,
            targetDesignerId,
            targetDate,
            newIndex: movedPayloads.length === 1 ? newIndex : undefined
          });
        }

        // Add to history for undo
        addToHistory('batchMove', {
          items: movedPayloads.map(payload => ({
            sourceDesignerId: payload.designerId,
            sourceDate: payload.date,
            targetDesignerId,
            targetDate,
            itemId: payload.item.id
          }))
        });

        socketRef.current?.emit('task_updated');
        stopEditingCell();
        fetchSheets();
        setSelectedTasks([]);
        setSelectedCell(null);
        addToast('任务已移动', 'success');
      } catch (err: any) {
        addToast('移动失败', 'error');
      } finally {
        setActiveTask(null);
      }
      return;
    }

    if (!over || !sourceData || !targetData) {
      setActiveTask(null);
      return;
    }
  };

  return {
    sensors,
    collisionDetection,
    handleDragStart,
    handleDragMove,
    handleDragOver,
    handleDragEnd,
    setGunDropTargetState,
    setTaskDropTargetState,
    taskDragCtrlRef,
    activeTask,
    setActiveTask,
    activeGun,
    setActiveGun,
    gunDropTarget,
    taskDropTarget,
    isDragging,
    setIsDragging,
    isOverDelete,
    setIsOverDelete,
  };
};
