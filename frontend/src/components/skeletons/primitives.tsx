/**
 * 骨架屏的基础块：占位条、顶栏、月份切换、图标按钮、底部状态栏。
 * 各页面骨架都复用这几块，所以单独一份。
 *
 * 从 components/LoadingSkeleton.tsx 拆分而来，JSX 逐字保留（未改版式）。
 */
import type { CSSProperties, ReactNode } from 'react';

/* ==================== 基础块 ==================== */

function Bar({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <div className={`rounded sk ${className}`} style={style} />;
}

/** 渐变/深色底上的白块 */
function LightBar({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <div className={`rounded sk-light ${className}`} style={style} />;
}

/** 白底顶栏（多个子页面共用）：返回工作台 ｜ 标题 ｜ 右侧操作区 */
function PageHeader({
  children,
  right,
  titleIcon = false,
  titleWidth = 24,
}: {
  children?: ReactNode;
  right?: ReactNode;
  /** 是否在标题前显示图标（任务报表/工时管理/设计规范有图标，状态跟踪没有） */
  titleIcon?: boolean;
  titleWidth?: number;
}) {
  return (
    <div className="shrink-0 h-12 bg-white border-b border-gray-200 shadow-md px-6 flex items-center justify-between">
      <div className="flex items-center gap-4">
        {/* 返回工作台：ChevronLeft(20) + 文字 */}
        <div className="flex items-center gap-1">
          <Bar className="w-5 h-5 rounded" />
          <Bar className="h-3.5 w-16" />
        </div>
        <span className="w-px h-6 bg-gray-200 mx-2" />
        {/* 页面标题 */}
        <div className="flex items-center gap-2">
          {titleIcon && <Bar className="w-6 h-6 rounded" />}
          <Bar className="h-5" style={{ width: titleWidth }} />
        </div>
        {children}
      </div>
      <div className="flex items-center gap-4">
        {right}
        {/* 用户名 + 退出 */}
        <Bar className="h-3.5 w-14" />
        <div className="flex items-center gap-1.5">
          <Bar className="w-[18px] h-[18px] rounded" />
          <Bar className="h-3.5 w-8" />
        </div>
      </div>
    </div>
  );
}

/** 月份切换胶囊 */
function MonthSwitch() {
  return (
    <div className="h-8 px-1 rounded-lg bg-gray-100 flex items-center gap-2">
      <Bar className="h-6 w-6 rounded-md bg-gray-200/90" />
      <Bar className="h-3 w-24" />
      <Bar className="h-6 w-6 rounded-md bg-gray-200/90" />
    </div>
  );
}

/** 刷新按钮 */
function IconButton() {
  return <Bar className="h-8 w-8 rounded-lg bg-blue-50/90" />;
}

/** 页面底部状态条；设计规范使用 max-w-6xl，并同时展示后端与知识库状态。 */
function FooterBar({ variant = 'default' }: { variant?: 'default' | 'knowledge' }) {
  const knowledge = variant === 'knowledge';
  return (
    <div className="shrink-0 border-t bg-white border-gray-200 px-6 py-3">
      <div
        className={`flex items-center justify-between ${
          knowledge ? 'max-w-6xl' : 'max-w-7xl'
        } mx-auto`}
      >
        <Bar className={knowledge ? 'h-3 w-36' : 'h-3 w-20'} />
        {knowledge ? (
          <div className="flex items-center gap-4">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <Bar className="h-3 w-16" />
                <Bar className="h-2.5 w-2.5 rounded-full bg-green-300" />
                <Bar className="h-3 w-8" />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Bar className="h-3 w-14" />
            <Bar className="h-2.5 w-2.5 rounded-full bg-green-300" />
            <Bar className="h-3 w-9" />
          </div>
        )}
      </div>
    </div>
  );
}

/* ==================== 主页面（排产表） ==================== */

const DAY_COUNT = 4;
/** 用最后一列模拟周末（真实页面周末列是淡黄底） */
const WEEKEND_COLS = [2];
/** 与真实页面一致：首尾各 96px，每天拆成「任务内容 + 工时」两列 */
const TASK_COL = 288;
const HOURS_COL = 48;

/**
 * 主页面底部状态栏：左侧状态点 + 六个快捷胶囊 + 月度统计，
 * 右侧上次登录 / IP / 浏览器 + 操作说明 + 缩放指示器 + 全屏。
 */
function DashboardFooter() {
  return (
    <div className="shrink-0 bg-[#f3f3f3] border-t border-gray-300 px-4 py-1 flex flex-wrap items-center justify-between gap-y-0.5 text-[11px] text-gray-500 whitespace-nowrap">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-green-400" />
          <Bar className="h-2.5 w-7" />
        </div>
        {/* 仕样自愈 / 快速取号 / 为今日取号安排确认图 / 快速安排修改 / 查找 / 复制任务为表格 */}
        {[
          ['border-emerald-300 bg-white/70', 72],
          ['border-amber-300 bg-white/70', 72],
          ['border-violet-300 bg-white/70', 140],
          ['border-rose-300 bg-white/70', 100],
          ['border-sky-300 bg-white/70', 52],
          ['border-slate-300 bg-white/70', 120],
        ].map(([cls, w], i) => (
          <span key={i} className={`h-5 rounded-full border ${cls}`} style={{ width: w }} />
        ))}
        <span className="w-px h-3 bg-gray-300" />
        {/* 本月任务条目 / 本月周末加班 / 本月员工出差 / 本月员工请假 */}
        {[72, 84, 84, 84].map((labelW, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Bar className="h-2.5" style={{ width: labelW }} />
            <Bar className="h-2.5 w-8" />
          </div>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        {/* 上次登录 / IP / 浏览器 */}
        <Bar className="h-2.5 w-24" />
        <span className="w-px h-3 bg-gray-300" />
        <Bar className="h-2.5 w-20" />
        <span className="w-px h-3 bg-gray-300" />
        <Bar className="h-2.5 w-14" />
        <span className="w-px h-3 bg-gray-300" />
        {/* 操作说明（仅管理员） */}
        <span className="w-[18px] h-[18px] rounded-full border border-gray-300 bg-white/70" />
        <span className="w-px h-3 bg-gray-300" />
        {/* 缩放指示器 − 100% + */}
        <div className="flex items-center gap-1">
          <span className="h-4 w-4 rounded border border-gray-300 bg-white/70" />
          <Bar className="h-2.5 w-6" />
          <span className="h-4 w-4 rounded border border-gray-300 bg-white/70" />
        </div>
        <span className="w-px h-3 bg-gray-300" />
        {/* 全屏：图标 + 文字 */}
        <div className="flex items-center gap-1">
          <Bar className="h-3 w-3 rounded-sm" />
          <Bar className="h-2.5 w-7" />
        </div>
      </div>
    </div>
  );
}

export { Bar, LightBar, PageHeader, MonthSwitch, IconButton, FooterBar, DAY_COUNT, WEEKEND_COLS, TASK_COL, HOURS_COL, DashboardFooter };
