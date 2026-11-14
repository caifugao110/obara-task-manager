import { Minus, Plus } from 'lucide-react';
import { PAGE_ZOOM_MAX, PAGE_ZOOM_MIN, resetPageZoom, usePageZoom, zoomIn, zoomOut } from '../utils/pageZoom';

/**
 * 底部状态栏的缩放指示器：显示当前倍率，点「−/+」微调，点百分数复位 100%。
 * 独立成组件是为了让倍率变化只重渲染这三个按钮，不牵动整张主表格。
 */
const PageZoomIndicator = () => {
  const zoom = usePageZoom();
  const percent = Math.round(zoom * 100);
  const canZoomOut = zoom > PAGE_ZOOM_MIN + 0.001;
  const canZoomIn = zoom < PAGE_ZOOM_MAX - 0.001;
  const buttonClass = 'flex h-[16px] w-[16px] items-center justify-center rounded border border-gray-300 bg-white/70 text-gray-500 transition-colors hover:border-[#217346] hover:bg-[#217346] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-300 disabled:hover:bg-white/70 disabled:hover:text-gray-500';

  return (
    <div
      className="flex items-center gap-1"
      title="Ctrl + 滚轮 / Ctrl + 加号减号 等比缩放主页面内容，Ctrl + 0 恢复 100%"
    >
      <button type="button" onClick={zoomOut} disabled={!canZoomOut} className={buttonClass} aria-label="缩小页面">
        <Minus size={11} strokeWidth={3} />
      </button>
      <button
        type="button"
        onClick={resetPageZoom}
        title="点击恢复 100%"
        className={`w-[34px] rounded px-0.5 text-center text-[11px] font-bold tabular-nums transition-colors hover:bg-gray-200/70 ${percent === 100 ? 'text-gray-500' : 'text-[#217346]'}`}
      >
        {percent}%
      </button>
      <button type="button" onClick={zoomIn} disabled={!canZoomIn} className={buttonClass} aria-label="放大页面">
        <Plus size={11} strokeWidth={3} />
      </button>
    </div>
  );
};

export default PageZoomIndicator;
