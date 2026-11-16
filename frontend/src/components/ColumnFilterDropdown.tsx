import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Filter, X } from 'lucide-react';

export interface ColumnFilterOption {
  /** 传给 onChange 的原始值 */
  value: string;
  /** 面板里显示的文案 */
  label: string;
  /** 当前范围内该值的记录条数 */
  count: number;
}

interface ColumnFilterDropdownProps {
  /** 列名，用于面板标题与按钮 tooltip */
  label: string;
  options: ColumnFilterOption[];
  /** 已选值；空数组表示该列不过滤 */
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** 面板宽度（px）。列里内容长（如客户名）时调宽，默认 184 */
  panelWidth?: number;
}

const DEFAULT_PANEL_WIDTH = 184;
const PANEL_MAX_HEIGHT = 340;
/** 选项超过这个数量才在面板里显示搜索框，避免短列表多一个多余的输入框 */
const SEARCH_THRESHOLD = 8;

/**
 * 表头列筛选：漏斗按钮 + 多选面板。
 *
 * 面板挂在 body 上（fixed 定位），因为表格外层是 `overflow: auto` 的滚动容器，
 * 直接绝对定位会被裁掉一半；固定在视口坐标后不受滚动容器限制，横向滚动/窗口缩放时关闭即可。
 * 面板以按钮中心为基准居中展开，落在本列正下方，不往左偏。
 * 选项条数与来源由页面级联计算（其他列已筛过的记录），本组件只负责渲染。
 */
const ColumnFilterDropdown: React.FC<ColumnFilterDropdownProps> = ({
  label,
  options,
  selected,
  onChange,
  disabled = false,
  panelWidth = DEFAULT_PANEL_WIDTH
}) => {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [placement, setPlacement] = useState<{ top: number; left: number; maxHeight: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const active = selected.length > 0;

  const updatePlacement = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = Math.max(160, Math.min(panelWidth, window.innerWidth - 16));
    const maxHeight = Math.min(PANEL_MAX_HEIGHT, window.innerHeight - 24);
    // 以漏斗按钮中心为基准居中展开，面板就落在本列正下方；
    // 贴到屏幕左右边缘时往回收，保证面板完整可见。
    const centered = rect.left + rect.width / 2 - width / 2;
    const left = Math.max(8, Math.min(centered, window.innerWidth - width - 8));
    let top = rect.bottom + 6;
    if (top + maxHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - maxHeight - 6);
    }
    setPlacement({ top, left, maxHeight, width });
  }, [panelWidth]);

  const toggleOpen = (event: React.MouseEvent) => {
    // 表头「纳期」整格绑了排序，点漏斗不应触发排序
    event.stopPropagation();
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    setKeyword('');
    updatePlacement();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // 面板用视口坐标定位，外层滚动/改尺寸后会错位，直接关掉比跟着重算更稳。
    // 面板自身的列表滚动要放行，否则滚动选项就把面板关掉了。
    const handleViewportChange = (event: Event) => {
      const target = event.target as Node | null;
      if (target && panelRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [open]);

  const visibleOptions = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return options;
    return options.filter(option => option.label.toLowerCase().includes(kw));
  }, [options, keyword]);

  const toggleValue = (value: string) => {
    onChange(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]);
  };

  const selectAllVisible = () => {
    onChange(Array.from(new Set([...selected, ...visibleOptions.map(option => option.value)])));
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        title={active ? `${label}：已筛选 ${selected.length} 项（点击修改）` : `筛选${label}`}
        className={`inline-flex items-center justify-center rounded p-0.5 transition ${
          active
            ? 'bg-amber-300 text-blue-900 shadow-sm'
            : 'text-white/60 hover:bg-white/20 hover:text-white'
        } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
      >
        <Filter size={11} strokeWidth={2.5} />
      </button>

      {open && placement && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: placement.top,
            left: placement.left,
            width: placement.width,
            maxHeight: placement.maxHeight
          }}
          className="z-[60] flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-2xl"
          // 面板用 portal 挂到 body，但 React 事件仍按组件树冒泡：
          // 不拦住的话，面板里每一次点击（勾选项、全选、关闭）都会冒到表头 <th> 上，
          // 而「纳期」整格绑了点击排序，于是筛选一动排序就跟着切换。这里把事件截断在面板内。
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
            <span className="truncate text-xs font-bold text-gray-700">筛选：{label}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="shrink-0 text-gray-400 transition hover:text-gray-700"
              title="关闭"
            >
              <X size={14} />
            </button>
          </div>

          {options.length > SEARCH_THRESHOLD && (
            <div className="shrink-0 px-2 pt-2">
              <input
                type="text"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索选项..."
                className="w-full rounded border border-gray-200 px-2 py-1 text-xs font-normal focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
            {visibleOptions.length === 0 ? (
              <div className="px-2 py-4 text-center text-xs text-gray-400">没有匹配的选项</div>
            ) : (
              visibleOptions.map(option => {
                const checked = selected.includes(option.value);
                return (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs transition hover:bg-blue-50 ${
                      checked ? 'bg-blue-50/70 font-semibold text-blue-700' : 'font-normal text-gray-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleValue(option.value)}
                      className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-blue-600"
                    />
                    <span className="min-w-0 flex-1 truncate" title={option.label}>{option.label}</span>
                    <span className="shrink-0 text-[10px] font-normal text-gray-400">{option.count}</span>
                  </label>
                );
              })
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-gray-100 px-3 py-1.5 text-[11px]">
            <button type="button" onClick={selectAllVisible} className="font-medium text-blue-600 hover:underline">
              全选
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={!active}
              className="font-medium text-gray-500 hover:text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-gray-500 disabled:hover:no-underline"
            >
              清除本列
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default ColumnFilterDropdown;
