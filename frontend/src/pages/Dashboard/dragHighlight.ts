/**
 * 拖拽落点高亮：直接改命中元素的 data-* 属性，由 index.css 用属性选择器画高亮。
 *
 * 为什么绕开 React：
 * 落点状态（gunDropTarget / taskDropTarget）原来作为 props 传给 TaskTable，
 * 指针每跨过一个任务边界引用就变一次 → React.memo 失效 → 600+ 单元格与上千个
 * dnd-kit 节点整体重渲。快速拖动时多次重渲堆在同一帧里，就成了肉眼可见的卡顿。
 * 高亮只是纯视觉反馈，不需要参与 React 渲染，所以这里直接操作 DOM：
 * 每帧最多改 1~2 个元素的属性，成本与表格规模无关。
 *
 * 高亮目标变化时先清掉上一帧的属性，再写新的；拖拽结束统一清理。
 */

/** 枪名拖拽：命中的主任务整行描边（valid=绿、invalid=红） */
const GUN_TASK_ATTR = 'data-drag-gun';
/** 枪名拖拽：空白单元格整格高亮（松手新建主任务） */
const GUN_CELL_ATTR = 'data-drag-gun-cell';
/** 枪名拖拽：单元格最下方加号高亮（松手在该格追加新主任务） */
const GUN_PLUS_ATTR = 'data-drag-gun-plus';
/** 主任务拖拽：在目标主任务上方插入的标记线 */
const TASK_INSERT_ATTR = 'data-drag-task-insert';
/** 主任务拖拽：追加到目标单元格最下方的标记线 */
const TASK_APPEND_ATTR = 'data-drag-task-append';

const ALL_ATTRS = [
  GUN_TASK_ATTR,
  GUN_CELL_ATTR,
  GUN_PLUS_ATTR,
  TASK_INSERT_ATTR,
  TASK_APPEND_ATTR,
];

// 当前带高亮属性的元素，下一帧只需要清理这一小撮，不必全表 querySelectorAll
const activeElements = new Set<HTMLElement>();

const clearActive = () => {
  activeElements.forEach(el => {
    ALL_ATTRS.forEach(attr => el.removeAttribute(attr));
  });
  activeElements.clear();
};

const setAttr = (el: HTMLElement | null | undefined, attr: string, value: string) => {
  if (!el) return;
  el.setAttribute(attr, value);
  activeElements.add(el);
};

export type GunDropHighlight = {
  /** 命中的主任务行元素（整行描边） */
  taskEl?: HTMLElement | null;
  taskKind?: 'valid' | 'invalid';
  /** 空白单元格（整格高亮） */
  cellEl?: HTMLElement | null;
  /** 单元格最下方加号（加号高亮） */
  plusEl?: HTMLElement | null;
};

export type TaskDropHighlight = {
  /** 插入到该主任务上方 */
  insertEl?: HTMLElement | null;
  insertKind?: 'valid' | 'invalid';
  /** 追加到该单元格最下方 */
  appendCellEl?: HTMLElement | null;
  appendKind?: 'valid' | 'invalid';
};

/** 刷新枪名拖拽高亮；传 null 表示清空 */
export const applyGunDropHighlight = (highlight: GunDropHighlight | null) => {
  clearActive();
  if (!highlight) return;
  if (highlight.taskEl && highlight.taskKind) {
    setAttr(highlight.taskEl, GUN_TASK_ATTR, highlight.taskKind);
  }
  if (highlight.cellEl) setAttr(highlight.cellEl, GUN_CELL_ATTR, 'create');
  if (highlight.plusEl) setAttr(highlight.plusEl, GUN_PLUS_ATTR, 'create');
};

/** 刷新主任务拖拽高亮；传 null 表示清空 */
export const applyTaskDropHighlight = (highlight: TaskDropHighlight | null) => {
  clearActive();
  if (!highlight) return;
  if (highlight.insertEl && highlight.insertKind) {
    setAttr(highlight.insertEl, TASK_INSERT_ATTR, highlight.insertKind);
  }
  if (highlight.appendCellEl && highlight.appendKind) {
    setAttr(highlight.appendCellEl, TASK_APPEND_ATTR, highlight.appendKind);
  }
};

/** 拖拽结束 / 取消时统一清除所有高亮 */
export const clearDragHighlight = () => {
  clearActive();
};
