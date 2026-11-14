import React from 'react';
import { usePageZoom } from '../utils/pageZoom';
import { usePageZoomShortcuts } from '../hooks/usePageZoomShortcuts';

/**
 * 主页面缩放容器：把整页内容放在一层 transform: scale() 里，实现「等比放大/缩小」。
 *
 * 关键点在尺寸补偿：
 *   容器自身按 100vw/z × 100vh/z 排版（z = 缩放倍率），再整体放大 z 倍，
 *   视觉上正好铺满窗口。于是**内部布局看到的可用空间始终是 100vw/z × 100vh/z**，
 *   页面的排版规则（横向固定 4 天、任务内容列反算宽度等）照旧生效，
 *   只是整体变大变小——不会像浏览器缩放那样「按新宽度重排」把布局拆散。
 *
 * 附带效果（都是想要的）：
 *   · 缩放后内部 fixed 弹窗/提示层的包含块变成这个容器（transform 会新建包含块），
 *     所以弹窗跟着一起等比缩放并仍然铺满可视区；
 *   · 内部滚动容器照常滚动，表头 sticky、列宽反算都不受影响。
 */
const PageZoomViewport = ({ children }: { children: React.ReactNode }) => {
  const zoom = usePageZoom();
  usePageZoomShortcuts();

  return (
    <div
      data-page-zoom={zoom}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: `calc(100vw / ${zoom})`,
        height: `calc(100vh / ${zoom})`,
        transform: `scale(${zoom})`,
        transformOrigin: '0 0',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
};

export default PageZoomViewport;
