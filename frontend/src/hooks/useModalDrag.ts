import { useCallback, useEffect, useRef, useState } from 'react';
import { getPageZoom } from '../utils/pageZoom';

/**
 * 弹窗拖动（按住标题栏移动整个弹窗）
 *
 * 用法：
 *   const { frameRef, dragging, headerProps } = useModalDrag(open);
 *   <div ref={frameRef} style={{ transform: 'translate3d(0px, 0px, 0)' }} className="...">// 弹窗外框
 *     <div {...headerProps} className={`... select-none touch-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}>// 标题栏
 *
 * 位移直接写 DOM 的 transform，不走 React state：
 * 这些弹窗挂在超大页面（看板 / 焊枪台账）里，每帧 setState 会重渲染整页导致拖动卡顿；
 * React 只在 style prop 的值变化时才写 DOM，所以命令式写入不会被后续重渲染冲掉。
 * 每次打开弹窗（open 变化）自动复位到居中位置。
 */

type DragState = {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

// 标题栏上的这些元素是交互控件，按下时不应触发拖动
const NO_DRAG_SELECTOR = 'button, a, input, select, textarea, label, [role="button"], [contenteditable="true"], [data-modal-no-drag]';

export const isModalDragBlocker = (target: EventTarget | null): boolean => {
  const el = target as Element | null;
  if (!el || typeof el.closest !== 'function') return false;
  return Boolean(el.closest(NO_DRAG_SELECTOR));
};

const clampOffset = (value: number, lo: number, hi: number) => (hi < lo ? lo : Math.min(Math.max(value, lo), hi));

export function useModalDrag(open: boolean, resetKey?: string | number | boolean | null) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);

  const applyOffset = useCallback((x: number, y: number) => {
    offsetRef.current = { x, y };
    const el = frameRef.current;
    if (el) el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }, []);

  const reset = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
    applyOffset(0, 0);
  }, [applyOffset]);

  // 打开弹窗 / 切换目标时复位到居中
  useEffect(() => {
    reset();
  }, [open, resetKey, reset]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    // 只响应鼠标左键 / 触摸 / 手写笔主接触点
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (isModalDragBlocker(e.target)) return;
    const el = frameRef.current;
    if (!el) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 个别浏览器/输入设备不支持指针捕获，忽略即可
    }
    const rect = el.getBoundingClientRect();
    const { x: originX, y: originY } = offsetRef.current;
    const margin = 8; // 拖动时至少留 8px 在可视区边缘内
    // 主页面可能被整体等比缩放（见 utils/pageZoom）：transform 里的 px 是「本地 px」，
    // 而 rect / clientX 都是「屏幕 px」，两者差一个倍率，这里统一换算成本地 px 再算边界。
    const zoom = getPageZoom();
    // rect 已含当前位移，减掉后得到「未拖动时」的居中位置，再据此算出可拖动范围
    const baseLeft = rect.left / zoom - originX;
    const baseTop = rect.top / zoom - originY;
    const viewportWidth = window.innerWidth / zoom;
    const viewportHeight = window.innerHeight / zoom;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX,
      originY,
      minX: margin - baseLeft,
      maxX: viewportWidth - margin - baseLeft - rect.width / zoom,
      minY: margin - baseTop,
      maxY: viewportHeight - margin - baseTop - rect.height / zoom,
    };
    setDragging(true);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.preventDefault();
    // 指针位移是屏幕 px，弹窗的 translate 是缩放层里的本地 px，按倍率换算后光标才跟手
    const zoom = getPageZoom();
    applyOffset(
      clampOffset(drag.originX + (e.clientX - drag.startX) / zoom, drag.minX, drag.maxX),
      clampOffset(drag.originY + (e.clientY - drag.startY) / zoom, drag.minY, drag.maxY),
    );
  }, [applyOffset]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // 指针已释放，忽略
    }
  }, []);

  return {
    frameRef,
    dragging,
    reset,
    headerProps: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerUp,
    },
  };
}
