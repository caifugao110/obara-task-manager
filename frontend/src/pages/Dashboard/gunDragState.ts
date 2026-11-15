// 模块级暂存：枪名拖拽手柄按下时直接量取所在枪名行（枪名格+工时格）的实测尺寸与位置，
// 供 DragOverlay 等比复刻（避免 document.querySelector 命中未布局元素量出 0/NaN）
// 同时保留触发拖拽的枪名格 DOM，防止 drag 激活后鼠标已移开导致 elementFromPoint 找不到源行
export interface GunRowDragDims {
  width: number;
  height: number;
  hoursWidth: number;
  x: number;
  y: number;
  handleX?: number;
  handleY?: number;
}

export const gunRowDragState: {
  dims: GunRowDragDims | null;
  originCell: HTMLElement | null;
} = {
  dims: null,
  originCell: null,
};

/* ------------------------------------------------------------------------- *
 * 枪名拖拽期间的真实指针坐标（client / 视口 px，正是 elementsFromPoint 需要的坐标系）
 *
 * 为什么不能沿用 dnd-kit 的 active.rect.current.translated：
 *   激活节点只是枪名行右侧 18×18 的拖动手柄，但 DragOverlay 里复刻的是「整行」，
 *   dnd-kit 的 active.rect 量的是浮层内容盒（见 getMeasurableNode 的单子元素规则），
 *   取它的中心时落点会相对光标偏移近一整列；浮层外再套一层 scale() 后漂移量还会随倍率变化。
 *   所以这里直接监听 pointermove，拿浏览器给的原始 clientX/clientY，与缩放倍率、浮层结构完全无关。
 * ------------------------------------------------------------------------- */
let pointerX = 0;
let pointerY = 0;
let pointerValid = false;
let pointerListening = false;

function handlePointerMove(event: PointerEvent) {
  pointerX = event.clientX;
  pointerY = event.clientY;
  pointerValid = true;
}

function handlePointerEnd() {
  // 松手/取消后立刻摘掉监听，避免拖拽结束后还在无用地写坐标。
  // 注意：这里**不能**清掉已记下的坐标——dnd-kit 的 pointerup 处理在 document 上，
  // 比 window 捕获阶段晚一步，随后执行的 handleDragEnd 还要用这份「松手瞬间」的坐标定落点。
  detachPointerListeners();
}

function attachPointerListeners() {
  if (pointerListening) return;
  window.addEventListener('pointermove', handlePointerMove, true);
  window.addEventListener('pointerup', handlePointerEnd, true);
  window.addEventListener('pointercancel', handlePointerEnd, true);
  pointerListening = true;
}

function detachPointerListeners() {
  if (!pointerListening) return;
  window.removeEventListener('pointermove', handlePointerMove, true);
  window.removeEventListener('pointerup', handlePointerEnd, true);
  window.removeEventListener('pointercancel', handlePointerEnd, true);
  pointerListening = false;
}

/** 拖拽激活时调用：用激活事件的坐标作为起点，并开始跟踪后续 pointermove */
export const startGunDragPointerTracking = (origin: { x: number; y: number } | null) => {
  detachPointerListeners();
  pointerValid = Boolean(origin && isFinite(origin.x) && isFinite(origin.y));
  pointerX = origin && isFinite(origin.x) ? origin.x : 0;
  pointerY = origin && isFinite(origin.y) ? origin.y : 0;
  attachPointerListeners();
};

/** 拖拽结束/取消时调用 */
export const stopGunDragPointerTracking = () => {
  detachPointerListeners();
  pointerValid = false;
};

/** 当前真实指针坐标；未跟踪或没有指针事件时返回 null（由调用方退化到其它取坐标方式） */
export const getGunDragPointer = (): { x: number; y: number } | null => (
  pointerValid && Number.isFinite(pointerX) && Number.isFinite(pointerY)
    ? { x: pointerX, y: pointerY }
    : null
);
