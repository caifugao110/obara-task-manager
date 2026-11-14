import { useEffect, useRef } from 'react';
import { resetPageZoom, zoomIn, zoomOut } from '../utils/pageZoom';

// 连续滚轮时每 40ms 只走一档：触控板/高频鼠标一帧能发好几个 wheel 事件，
// 不节流会瞬间从 100% 冲到上限，手感很差
const WHEEL_STEP_INTERVAL = 40;

/**
 * 绑定主页面的缩放快捷键：
 *   Ctrl + 滚轮（触控板双指捏合也是这个事件）→ 上滚放大 / 下滚缩小
 *   Ctrl + = / Ctrl + +  → 放大
 *   Ctrl + -             → 缩小
 *   Ctrl + 0             → 恢复 100%
 * 必须 preventDefault，否则浏览器会把同样的操作当成「浏览器页面缩放」再缩一次。
 */
export const usePageZoomShortcuts = () => {
  const lastStepAtRef = useRef(0);

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      // 拦掉浏览器自身的页面缩放，改为缩放主页面内容
      event.preventDefault();
      const now = Date.now();
      if (now - lastStepAtRef.current < WHEEL_STEP_INTERVAL) return;
      lastStepAtRef.current = now;
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (!delta) return;
      if (delta < 0) zoomIn();
      else zoomOut();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.altKey) return;
      // 小键盘 +/- 的 key 同样是 '+'/'-'，这里一并覆盖
      if (event.key === '=' || event.key === '+') {
        event.preventDefault();
        zoomIn();
        return;
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomOut();
        return;
      }
      if (event.key === '0') {
        event.preventDefault();
        resetPageZoom();
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
};
