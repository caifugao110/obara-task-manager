import { useSyncExternalStore } from 'react';

/**
 * 主页面等比缩放（Ctrl + 滚轮 / Ctrl + 加号减号 / Ctrl + 0 复位）
 *
 * 为什么不用浏览器自带的 Ctrl+滚轮缩放：
 * 浏览器缩放改变的是「布局视口」有多少 CSS 像素，页面会按新的宽度**重新排版**——
 * 顶栏一排放不下的按钮被裁掉、任务内容列被压到下限、横向只剩两天，看上去是
 * 「布局被拆散」而不是「整体放大」。这里改成给主页面套一层 transform: scale()：
 * 内容仍按原尺寸排版，然后整层等比放大/缩小，任何倍率下横向都还是完整的 4 天，
 * 只是字号、行高、边距一起变小或变大（真正的等比缩放）。
 *
 * 倍率写在 localStorage 里，刷新页面/重新登录后保持；范围 60% ~ 160%，步长 10%。
 */
const STORAGE_KEY = 'obara.pageZoom';

export const PAGE_ZOOM_MIN = 0.6;
export const PAGE_ZOOM_MAX = 1.6;
export const PAGE_ZOOM_STEP = 0.1;
export const PAGE_ZOOM_DEFAULT = 1;

const normalizeZoom = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return Math.min(PAGE_ZOOM_MAX, Math.max(PAGE_ZOOM_MIN, rounded));
};

const readStoredZoom = (): number => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return PAGE_ZOOM_DEFAULT;
    const parsed = Number(raw);
    // 数值异常（旧版本残留、被手改坏）时回落到 100%，不要让页面以 0 倍率渲染成空白
    return Number.isFinite(parsed) && parsed > 0 ? normalizeZoom(parsed) : PAGE_ZOOM_DEFAULT;
  } catch {
    return PAGE_ZOOM_DEFAULT;
  }
};

let currentZoom = readStoredZoom();
const listeners = new Set<() => void>();

/** 当前主页面缩放倍率（1 = 100%）。非 React 环境（钩子、测量函数）直接读它 */
export const getPageZoom = () => currentZoom;

export const setPageZoom = (next: number) => {
  const value = normalizeZoom(next);
  if (Math.abs(value - currentZoom) < 0.001) return;
  currentZoom = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // 隐私模式 / 存储被禁用：写不进去就只在本次会话生效，不影响缩放本身
  }
  listeners.forEach(listener => listener());
};

export const subscribePageZoom = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const zoomIn = () => setPageZoom(currentZoom + PAGE_ZOOM_STEP);
export const zoomOut = () => setPageZoom(currentZoom - PAGE_ZOOM_STEP);
export const resetPageZoom = () => setPageZoom(PAGE_ZOOM_DEFAULT);

/** 订阅缩放倍率的 React 钩子：只有真正需要跟着倍率重渲染的组件才用它 */
export const usePageZoom = () => useSyncExternalStore(subscribePageZoom, getPageZoom, getPageZoom);

/**
 * 屏幕像素 → 页面本地像素。
 * 主页面所有内容都在缩放层里，元素布局用的是「本地 px」，而 getBoundingClientRect /
 * 指针位移给的是「屏幕 px」，两者差一个倍率；浮层、拖动、测量换算时都要过这一道。
 */
export const screenToLocal = (screenValue: number) => screenValue / currentZoom;
