import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';

/**
 * 各页面的加载骨架屏 —— 版式对齐真实页面，避免加载完成时布局跳变。
 * - dashboard       主页面（排产表）：绿色顶栏 + 双行表头（每天拆「任务内容/工时」两列）+ 月总工时列 + 分组行 + 完整底部状态栏
 * - leaderboard     任务报表：白色顶栏 + 两张渐变查询卡 + 权限设置卡 + 底部状态栏
 * - workhours       工时管理：白色顶栏 + 统计分组条 + 双列统计卡片 + 权限设置卡 + 底部状态栏
 * - statustracking  状态跟踪：白色顶栏（搜索/操作）+ 筛选条 + 双行蓝色表头的宽表格 + 底部状态栏
 * - designstandards 设计规范：白色顶栏（含知识库状态）+ 状态卡 + 3 个 tab + 检索面板 + 权限设置卡
 * - gunledger       焊枪编号台账：绿色顶栏 + 左侧分类/表列表 + 右侧表格 + 底部状态栏
 * - systemsettings  系统设置：白色顶栏 + tab 栏（超管 8 个 / 一般管理员 2 个，默认状态监测）+ 对应内容区
 */
export type SkeletonKind =
  | 'dashboard'
  | 'leaderboard'
  | 'workhours'
  | 'statustracking'
  | 'designstandards'
  | 'gunledger'
  | 'systemsettings';

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
 * 主页面底部状态栏：左侧状态点 + 四个快捷胶囊 + 月度统计，
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
        {/* 仕样自愈 / 快速取号 / 为今日取号安排确认图 / 查找 */}
        {[
          ['border-emerald-300 bg-white/70', 72],
          ['border-amber-300 bg-white/70', 72],
          ['border-violet-300 bg-white/70', 140],
          ['border-sky-300 bg-white/70', 52],
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

export function DashboardSkeleton() {
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#f3f3f3]" aria-hidden="true">
      {/* ---------- 顶部绿色栏 ---------- */}
      <div className="shrink-0 bg-[#217346] px-6 py-2 flex flex-wrap items-center justify-between gap-y-1.5 shadow-md">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5">
          <div className="flex shrink-0 items-center gap-2">
            <LightBar className="w-6 h-6 rounded-md" />
            <LightBar className="h-5 w-36" />
          </div>
          {/* 月份切换 */}
          <div className="flex shrink-0 items-center gap-2 h-8 px-2 rounded bg-[#1a5c38]">
            <LightBar className="w-3.5 h-3.5 rounded-sm" />
            <LightBar className="h-3 w-20" />
            <LightBar className="w-3.5 h-3.5 rounded-sm" />
          </div>
          {/* 人员下拉 */}
          <div className="h-8 w-[100px] rounded bg-[#1a5c38] flex items-center px-3">
            <LightBar className="h-2.5 w-12" />
          </div>
          {/* 导航按钮：任务报表 / 工时管理 / 状态跟踪表 / 设计规范知识库 / 焊枪编号台账 */}
          {[
            [102, 56],
            [102, 56],
            [116, 70],
            [144, 98],
            [130, 84],
          ].map(([w, textW], i) => (
            <div
              key={i}
              className="h-8 rounded bg-[#1a5c38] flex items-center justify-center gap-1.5"
              style={{ width: w }}
            >
              <LightBar className="w-4 h-4 rounded-sm" />
              <LightBar className="h-2.5" style={{ width: textW }} />
            </div>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {/* 当前版本 / 用户名 / 系统设置 / 用户管理 / 退出 */}
          <LightBar className="h-3 w-24" />
          <LightBar className="h-3.5 w-16" />
          <LightBar className="w-5 h-5 rounded" />
          <span className="h-6 w-px bg-white/20" />
          <LightBar className="w-5 h-5 rounded" />
          <LightBar className="w-5 h-5 rounded" />
        </div>
      </div>

      {/* ---------- 表格区 ---------- */}
      <div className="flex-1 min-h-0 bg-white border border-gray-300 overflow-hidden">
        <div
          className="grid"
          style={{
            gridTemplateColumns: `96px repeat(${DAY_COUNT}, minmax(${TASK_COL}px, 1fr) ${HOURS_COL}px) 96px`,
          }}
        >
          {/* 主表头：设计员 ｜ 每天（跨「任务内容 + 工时」两列）｜ 月总工时 */}
          <div className="h-10 bg-[#f8f9fa] border-r border-b border-gray-300 flex items-center justify-center">
            <Bar className="h-3 w-10" />
          </div>
          {Array.from({ length: DAY_COUNT }).map((_, i) => (
            <div
              key={i}
              style={{ gridColumn: 'span 2' }}
              className={`h-10 border-r border-b border-gray-300 flex flex-col items-center justify-center gap-1.5 ${
                WEEKEND_COLS.includes(i) ? 'bg-indigo-50' : 'bg-[#f8f9fa]'
              }`}
            >
              <Bar className="h-2 w-16 opacity-80" />
              <Bar className="h-3 w-5" />
            </div>
          ))}
          <div className="h-10 bg-[#f8f9fa] border-b border-gray-300 flex items-center justify-center">
            <Bar className="h-3 w-12" />
          </div>

          {/* 副表头：任务内容 / 工时 */}
          <div className="h-6 bg-[#f8f9fa] border-r border-b border-gray-300" />
          {Array.from({ length: DAY_COUNT }).map((_, i) => (
            <div key={`sub-${i}`} className="contents">
              <div
                className={`h-6 border-r border-b border-gray-300 flex items-center justify-center ${
                  WEEKEND_COLS.includes(i) ? 'bg-indigo-50' : 'bg-[#f8f9fa]'
                }`}
              >
                <Bar className="h-1.5 w-12 opacity-80" />
              </div>
              <div
                className={`h-6 border-r border-b border-gray-300 flex items-center justify-center ${
                  WEEKEND_COLS.includes(i) ? 'bg-indigo-50' : 'bg-[#f8f9fa]'
                }`}
              >
                <Bar className="h-1.5 w-4 opacity-80" />
              </div>
            </div>
          ))}
          <div className="h-6 bg-[#f8f9fa] border-b border-gray-300" />

          {/* 分组行 + 设计员行 */}
          {[8, 8].map((rows, g) => (
            <div key={g} className="contents">
              <div className="col-span-full h-7 bg-gray-200 border-b border-gray-300 flex items-center gap-2 px-3">
                <Bar className="sk-gray h-3 w-3" />
                <Bar className="sk-gray h-3 w-20" />
                <Bar className="sk-gray h-2 w-8" />
              </div>
              {Array.from({ length: rows }).map((_, r) => (
                <div key={r} className="contents">
                  {/* 姓名列 */}
                  <div className="h-20 bg-white border-r border-b border-gray-300 flex items-center justify-center">
                    <Bar className="h-3.5 w-12" />
                  </div>
                  {/* 每日：任务内容 + 工时 */}
                  {Array.from({ length: DAY_COUNT }).map((_, c) => (
                    <div key={c} className="contents">
                      <div
                        className={`h-20 border-r border-b border-gray-300 px-2 py-2.5 flex flex-col justify-center gap-1.5 ${
                          WEEKEND_COLS.includes(c) ? 'bg-[#fffbf0]' : 'bg-white'
                        }`}
                      >
                        <Bar className="h-2 w-[58%]" />
                        <Bar className="h-2 w-[36%]" />
                      </div>
                      <div
                        className={`h-20 border-r border-b border-gray-300 flex items-center justify-center ${
                          WEEKEND_COLS.includes(c) ? 'bg-[#fffbf0]' : 'bg-white'
                        }`}
                      >
                        <Bar className="h-3 w-5" />
                      </div>
                    </div>
                  ))}
                  {/* 月总工时列 */}
                  <div className="h-20 bg-white border-b border-gray-300 flex items-center justify-center">
                    <Bar className="h-3.5 w-10" />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <DashboardFooter />
    </div>
  );
}

/* ==================== 任务报表 ==================== */

/** 渐变卡头的查询卡片；蓝卡卡头有两个开关，绿卡只有一个。 */
function QueryCard({ tone }: { tone: 'blue' | 'emerald' }) {
  const gradient =
    tone === 'blue'
      ? 'from-blue-600 to-indigo-600'
      : 'from-emerald-600 to-teal-600';

  return (
    <div className="bg-white rounded-2xl shadow-xl border border-gray-100">
      {/* 卡头 */}
      <div className={`rounded-t-2xl shadow-lg px-6 py-5 bg-gradient-to-r ${gradient}`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <LightBar className="h-5 w-5 rounded-md" />
              <LightBar className="h-4 w-28" />
            </div>
            <LightBar className="h-3 w-52 opacity-70" />
          </div>
          {tone === 'blue' ? (
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <LightBar className="h-2.5 w-24" />
                <LightBar className="h-5 w-9 rounded-full" />
              </div>
              <div className="flex items-center gap-2">
                <LightBar className="h-2.5 w-16" />
                <LightBar className="h-5 w-9 rounded-full" />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <LightBar className="h-2.5 w-16" />
              <LightBar className="h-5 w-9 rounded-full" />
            </div>
          )}
        </div>
      </div>

      {/* 卡身：标签 + 输入框 + 结果占位 */}
      <div className="p-6">
        <Bar className="h-3 w-40 mb-2" />
        <Bar className="h-12 w-full rounded-lg bg-gray-50 border-2 border-gray-100" />
        <div className="mt-6 flex items-center gap-3">
          <Bar className="h-3 w-24" />
          <Bar className="h-3 w-14 opacity-70" />
        </div>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl border-2 border-gray-100 space-y-2.5">
              <div className="flex items-center justify-between">
                <Bar className="h-3 w-16" />
                <Bar className="h-2.5 w-12 opacity-70" />
              </div>
              <Bar className="h-6 w-full rounded-md" />
              <Bar className="h-2.5 w-2/3 opacity-80" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LeaderboardSkeleton() {
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-gradient-to-br from-slate-50 to-blue-50" aria-hidden="true">
      <PageHeader titleIcon titleWidth={72} right={<><MonthSwitch /><IconButton /></>} />
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="max-w-7xl mx-auto w-full px-8 pb-8">
          {/* 真实页面里两张查询卡是紧贴的，间距只由第一张的 my-8 提供 */}
          <div className="my-8">
            <QueryCard tone="blue" />
            <QueryCard tone="emerald" />
          </div>

          {/* 任务报表查看权限设置：三个开关（仅超管，骨架给出占位） */}
          <div className="mt-8 bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
            <div className="flex items-center gap-2 mb-6">
              <Bar className="h-5 w-5 rounded bg-purple-100/90" />
              <Bar className="h-4 w-44" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-5 bg-gray-50 rounded-xl border border-gray-100"
                >
                  <div className="space-y-2">
                    <Bar className="h-3.5 w-24" />
                    <Bar className="h-2 w-16 opacity-70" />
                  </div>
                  <Bar className="h-6 w-12 rounded-full bg-gray-200/90" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <FooterBar />
    </div>
  );
}

/* ==================== 工时管理 ==================== */

/** 统计分组筛选条 */
function GroupFilterBar() {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-slate-200/70 bg-white px-4 py-2.5 shadow-sm">
      <div className="flex shrink-0 items-center gap-1.5">
        <Bar className="h-3.5 w-3.5 rounded bg-blue-100" />
        <Bar className="h-3 w-12" />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {[56, 48, 44, 52, 40, 46].map((w, i) => (
          <Bar
            key={i}
            className={`h-6 rounded-lg ${i === 0 ? 'bg-blue-100' : 'bg-slate-100'}`}
            style={{ width: w }}
          />
        ))}
      </div>
      <Bar className="ml-auto h-2.5 w-44 opacity-80" />
    </div>
  );
}

/** 双列统计卡片中的一张 */
function HoursCard() {
  return (
    <section className="flex max-h-[calc(100vh_-_17.25rem)] flex-col rounded-2xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/40">
      {/* 卡头 */}
      <div className="flex shrink-0 items-center justify-between gap-3 rounded-t-2xl border-b border-slate-100 bg-slate-50 px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Bar className="h-8 w-8 rounded-lg bg-blue-100" />
          <div className="flex flex-col gap-1.5">
            <Bar className="h-3.5 w-24" />
            <Bar className="h-2.5 w-32 opacity-80" />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <Bar className="h-2.5 w-16" />
          <Bar className="h-4 w-7 rounded-full bg-slate-300/70" />
        </div>
      </div>

      {/* 人员列表 */}
      <div className="min-h-0 flex-1 px-2.5 py-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg border-b border-slate-100/80 px-2 py-3 last:border-b-0"
          >
            <Bar className="h-4 w-4 rounded-md" />
            <Bar className="h-3 w-14" style={{ opacity: 1 - i * 0.04 }} />
            <Bar className="h-1.5 flex-1 rounded-full" />
            <Bar className="h-3 w-8" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function WorkHoursSkeleton() {
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-gradient-to-br from-slate-50 to-blue-50" aria-hidden="true">
      <PageHeader titleIcon titleWidth={72} right={<><MonthSwitch /><IconButton /></>}>
        {/* 导出按钮（仅管理员可见，骨架里给出占位） */}
        <Bar className="h-7 w-28 rounded-lg bg-purple-100/80" />
      </PageHeader>
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="mx-auto w-full max-w-7xl px-6 py-6 lg:px-8">
          <GroupFilterBar />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-6">
            <HoursCard />
            <HoursCard />
          </div>

          {/* 工时管理查看权限设置：三个开关（仅超管，骨架给出占位） */}
          <div className="mt-8 bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
            <div className="flex items-center gap-2 mb-6">
              <Bar className="h-5 w-5 rounded bg-purple-100/90" />
              <Bar className="h-4 w-44" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-5 bg-gray-50 rounded-xl border border-gray-100"
                >
                  <div className="space-y-2">
                    <Bar className="h-3.5 w-24" />
                    <Bar className="h-2 w-16 opacity-70" />
                  </div>
                  <Bar className="h-6 w-12 rounded-full bg-gray-200/90" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <FooterBar />
    </div>
  );
}

/* ==================== 状态跟踪 ==================== */

/** 与真实表格一致的列宽，加载完成时列不跳 */
const STATUS_COLS = [80, 274, 45, 60, 45, 45, 45, 45, 200, 240, 45, 45, 45, 45, 45, 45, 45, 80, 80, 96];
/** 表头中竖排文字（VerticalHeader）的列，宽度都很窄 */
const STATUS_VERTICAL_HEADS = [2, 4, 5, 10, 11, 12, 13, 14, 15, 16];
/** 未下种数 / 未下数量 / 未确认数 三列在真实页面是青色底 */
const STATUS_TEAL_COLS = [12, 13, 14];
/** 「本月状态」分组：起始列 + 占 4 列 */
const STATUS_GROUP_START = 6;
const STATUS_GROUP_SIZE = 4;

/** 产品（四张日程表）单选筛选条 + 纳期月份 */
function StatusFilterBar() {
  return (
    <div className="shrink-0 bg-white border-b border-gray-200 px-6 py-2 flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {[52, 60, 60, 62, 74, 74].map((w, i) => (
          <div key={i} className="flex items-center gap-1.5">
            {(i === 1 || i === 3) && <span className="mx-0.5 h-4 w-px bg-gray-200" />}
            <Bar
              className={`h-[30px] rounded-full border ${
                i === 0 ? 'bg-blue-100 border-blue-200' : 'bg-slate-50 border-gray-200'
              }`}
              style={{ width: w }}
            />
          </div>
        ))}
      </div>
      <span className="h-5 w-px bg-gray-200" />
      {/* 纳期月份下拉 */}
      <Bar className="h-[34px] w-32 rounded-lg bg-gray-50 border border-gray-300" />
      <div className="ml-auto flex items-center gap-3">
        <Bar className="h-3 w-16" />
      </div>
    </div>
  );
}

/** 分组左侧的表头列（工厂/客户/数量/纳期/已发图/未确认） */
const STATUS_LEADING_COLS = Array.from({ length: STATUS_GROUP_START }, (_, i) => i);
/** 分组右侧的表头列（确认数量…操作） */
const STATUS_TRAILING_COLS = Array.from(
  { length: STATUS_COLS.length - STATUS_GROUP_START - STATUS_GROUP_SIZE },
  (_, i) => STATUS_GROUP_START + STATUS_GROUP_SIZE + i
);

/** 单个跨行表头单元格：竖排文字用细长条，横排标题用短条 */
function StatusHeadCell({
  col,
  edge,
}: {
  col: number;
  edge?: 'left' | 'right';
}) {
  const radius =
    edge === 'left' ? 'rounded-tl-2xl' : edge === 'right' ? 'rounded-tr-2xl' : '';
  const teal = STATUS_TEAL_COLS.includes(col) ? 'bg-teal-400' : '';
  return (
    <th rowSpan={2} className={`px-2 py-1.5 border-r border-white ${radius} ${teal}`}>
      {STATUS_VERTICAL_HEADS.includes(col) ? (
        <LightBar className="h-10 w-2.5 mx-auto" />
      ) : (
        <LightBar className="h-2.5 mx-auto w-3/4" />
      )}
    </th>
  );
}

export function StatusTrackingSkeleton() {
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-gradient-to-br from-slate-50 to-blue-50" aria-hidden="true">
      <PageHeader
        titleWidth={80}
        right={
          <>
            <Bar className="h-[34px] w-36 rounded-full bg-blue-200/80" />
            <Bar className="h-[34px] w-28 rounded-lg bg-purple-100/80" />
            <Bar className="h-[34px] w-28 rounded-lg bg-teal-100/80" />
          </>
        }
      >
        <span className="w-px h-6 bg-gray-200 mx-2" />
        {/* 搜索框：左侧放大镜 + 输入区 */}
        <Bar className="h-8 w-64 rounded-lg border border-gray-300 bg-gray-50" />
      </PageHeader>

      <StatusFilterBar />

      <div className="flex-1 min-h-0 overflow-hidden px-6 pb-6">
        <div className="h-6 shrink-0" />
        <div className="w-fit min-w-full overflow-hidden bg-white rounded-2xl shadow-xl border border-gray-100">
          <table className="w-full text-sm" style={{ tableLayout: 'fixed', minWidth: 1650 }}>
            <colgroup>
              {STATUS_COLS.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <thead>
              {/* 第一行：16 个跨两行的表头 + 「本月状态」分组头（占 4 列） */}
              <tr className="bg-gradient-to-r from-blue-600 to-blue-700">
                {STATUS_LEADING_COLS.map((c) => (
                  <StatusHeadCell key={c} col={c} edge={c === 0 ? 'left' : undefined} />
                ))}
                <th
                  colSpan={STATUS_GROUP_SIZE}
                  className="px-2 py-1.5 border-r border-white border-b border-white bg-green-600"
                >
                  <LightBar className="h-2.5 mx-auto w-16" />
                </th>
                {STATUS_TRAILING_COLS.map((c) => (
                  <StatusHeadCell
                    key={c}
                    col={c}
                    edge={c === STATUS_COLS.length - 1 ? 'right' : undefined}
                  />
                ))}
              </tr>
              {/* 第二行：只有「本月状态」分组的 4 个子列 */}
              <tr className="bg-gradient-to-r from-blue-600 to-blue-700">
                {Array.from({ length: STATUS_GROUP_SIZE }).map((_, i) => (
                  <th key={i} className="px-2 py-1.5 border-r border-white bg-green-600">
                    {i < 2 ? (
                      <LightBar className="h-10 w-2.5 mx-auto" />
                    ) : (
                      <LightBar className="h-2.5 mx-auto w-3/4" />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 22 }).map((_, r) => (
                <tr key={r} className={r % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  {STATUS_COLS.map((w, c) => (
                    <td
                      key={c}
                      className="px-2 py-2.5 border-b border-gray-100 border-r border-gray-50"
                    >
                      {/* 宽列放长条，窄列放居中小块，避免整行像点阵 */}
                      {w >= 80 ? (
                        <Bar
                          className={`h-2.5 ${c === 1 ? 'w-[70%]' : w > 100 ? 'w-[58%]' : 'w-[64%]'}`}
                          style={{ opacity: 0.9 - (r % 3) * 0.08 }}
                        />
                      ) : (
                        <Bar
                          className="h-2 w-3 mx-auto rounded-sm"
                          style={{ opacity: 0.85 - (r % 3) * 0.1 }}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <FooterBar />
    </div>
  );
}

/* ==================== 设计规范知识库 ==================== */

/** 检索面板：范围选择 + 输入框 + 检索按钮 + 结果卡片 */
function SearchPanel() {
  return (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
      {/* 检索范围 */}
      <div className="flex items-center gap-2 mb-3">
        <Bar className="h-2.5 w-14" />
        <Bar className="h-8 w-40 rounded-lg bg-gray-100" />
      </div>
      {/* 检索输入 */}
      <div className="flex items-center gap-3">
        <Bar className="h-12 flex-1 rounded-xl bg-gray-50 border-2 border-gray-100" />
        <Bar className="h-12 w-28 rounded-xl bg-blue-100" />
      </div>
      {/* 结果卡片 */}
      <div className="mt-6 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-200 p-4 space-y-2.5">
            <div className="flex items-center gap-2">
              <Bar className="h-4 w-4 rounded-sm" />
              <Bar className="h-3 w-40" />
              <Bar className="h-2.5 w-14 ml-auto opacity-70" />
            </div>
            <Bar className="h-2.5" style={{ width: `${68 - i * 8}%` }} />
            <Bar className="h-2.5" style={{ width: `${48 - i * 6}%`, opacity: 0.8 }} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function DesignStandardsSkeleton() {
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50" aria-hidden="true">
      <PageHeader
        titleIcon
        titleWidth={128}
        right={<Bar className="h-8 w-28 rounded-lg bg-blue-50 border border-blue-200" />}
      >
        {/* 标题后的知识库连接状态胶囊 */}
        <Bar className="h-5 w-24 rounded-full bg-green-100 border border-green-200" />
      </PageHeader>
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="max-w-6xl mx-auto w-full px-6 py-8">
          {/* 状态卡 */}
          <div className="bg-white rounded-2xl shadow-sm border border-blue-100 p-6 mb-6 flex items-start gap-4">
            <div className="shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 opacity-60" />
            <div className="flex-1 space-y-2.5 pt-1">
              <Bar className="h-5 w-48" />
              <Bar className="h-3 w-[68%]" />
              <Bar className="h-3 w-[46%]" />
              {/* GitHub / 官网 / 控制台 / 刷新状态 */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Bar className="h-7 w-24 rounded-lg bg-gray-200/90" />
                <Bar className="h-7 w-24 rounded-lg bg-green-100" />
                <Bar className="h-7 w-28 rounded-lg bg-blue-100" />
                <Bar className="h-7 w-24 rounded-lg bg-gray-50 border border-gray-200" />
              </div>
            </div>
          </div>

          {/* tab 切换：规范检索 / 智能问答 / 知识库管理（真实页面同一时间只显示一个 tab 的内容） */}
          <div className="flex items-center gap-2 mb-4">
            {[80, 96, 110].map((w, i) => (
              <div
                key={i}
                className={`h-9 rounded-xl flex items-center justify-center px-4 ${
                  i === 0 ? 'bg-blue-100' : 'bg-white border border-gray-200'
                }`}
                style={{ width: w }}
              >
                <Bar className="h-2.5 w-3/5" />
              </div>
            ))}
          </div>

          <SearchPanel />

          {/* 设计规范知识库查看权限设置：三个开关（仅超管，骨架给出占位） */}
          <div className="mt-8 bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
            <div className="flex items-center gap-2 mb-6">
              <Bar className="h-5 w-5 rounded bg-purple-100/90" />
              <Bar className="h-4 w-52" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-5 bg-gray-50 rounded-xl border border-gray-100"
                >
                  <div className="space-y-2">
                    <Bar className="h-3.5 w-24" />
                    <Bar className="h-2 w-16 opacity-70" />
                  </div>
                  <Bar className="h-6 w-12 rounded-full bg-gray-200/90" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* 真实页面是同款底栏，只是 fixed 定位；骨架层铺满视口，直接用底部块即可 */}
      <FooterBar variant="knowledge" />
    </div>
  );
}

/* ==================== 焊枪编号台账 ==================== */

/** 台账表格列宽：序号 / 焊枪名 / 客户 / 时间 / 担当 / 规格 / 备注 / 操作 */
const LEDGER_COLS = [64, 112, 272, 80, 96, 144, 288, 80];
const LEDGER_TABLE_MIN_WIDTH = LEDGER_COLS.reduce((sum, w) => sum + w, 0);

export function GunLedgerSkeleton() {
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#f3f3f3]" aria-hidden="true">
      {/* 绿色顶栏：返回 + 标题 + 分类导出；右侧默认工时规则 / 台账初始化 / 权限设置 / 担当人员 / 用户 */}
      <div className="shrink-0 h-12 bg-[#217346] px-6 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <LightBar className="w-5 h-5 rounded" />
            <LightBar className="h-3.5 w-16" />
          </div>
          <span className="w-px h-6 bg-white/30 mx-2" />
          <div className="flex items-center gap-2">
            <LightBar className="w-[22px] h-[22px] rounded" />
            <LightBar className="h-4 w-28" />
          </div>
          <LightBar className="h-6 w-20 rounded-md" />
        </div>
        <div className="flex items-center gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <LightBar className="w-[18px] h-[18px] rounded" />
              <LightBar className="h-3.5 w-16" />
            </div>
          ))}
          <span className="w-px h-6 bg-white/20" />
          <LightBar className="h-3.5 w-12" />
          <div className="flex items-center gap-1.5">
            <LightBar className="w-[18px] h-[18px] rounded" />
            <LightBar className="h-3.5 w-8" />
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* 左侧：分类 + 表格列表 */}
        <aside className="w-64 shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden">
          {/* 分类区 */}
          <div className="shrink-0 p-3 border-b border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <Bar className="h-2.5 w-8" />
              <div className="flex items-center gap-2">
                <Bar className="h-3.5 w-3.5" />
                <Bar className="h-4 w-4" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {[64, 72, 56, 68].map((w, i) => (
                <div
                  key={i}
                  className={`flex items-center rounded-lg px-3 py-2 ${
                    i === 0 ? 'bg-emerald-100' : 'bg-gray-50'
                  }`}
                >
                  <Bar className="h-3" style={{ width: w }} />
                </div>
              ))}
            </div>
          </div>
          {/* 表格列表 */}
          <div className="flex-1 min-h-0 p-3">
            <div className="flex items-center justify-between mb-2">
              <Bar className="h-2.5 w-14" />
              <div className="flex items-center gap-2">
                <Bar className="h-3.5 w-3.5" />
                <Bar className="h-4 w-4" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                    i === 0 ? 'bg-emerald-50 border-emerald-200' : 'border-transparent'
                  }`}
                >
                  <Bar className="h-3" style={{ width: `${70 - i * 4}%` }} />
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* 右侧：表名标题栏 + 台账表格 */}
        <div className="flex-1 min-w-0 bg-white overflow-hidden flex flex-col">
          <div className="shrink-0 px-4 py-2 border-b border-gray-200 bg-[#f8f9fa] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Bar className="h-4 w-4 rounded" />
              <Bar className="h-4 w-28" />
              <Bar className="h-3.5 w-20 rounded-full bg-emerald-50" />
              <Bar className="h-2.5 w-52 opacity-80" />
            </div>
            <div className="flex items-center gap-2">
              <Bar className="h-6 w-16 rounded-md bg-gray-50 border border-gray-200" />
              <Bar className="h-6 w-16 rounded-md bg-blue-50 border border-blue-100" />
              <Bar className="h-6 w-20 rounded-md bg-amber-50 border border-amber-100" />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            <table
              className="border-collapse text-[13px] w-full"
              style={{ tableLayout: 'fixed', minWidth: LEDGER_TABLE_MIN_WIDTH }}
            >
              <colgroup>
                {LEDGER_COLS.map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>
              <thead>
                <tr className="bg-[#217346]">
                  {LEDGER_COLS.map((_, i) => (
                    <th key={i} className="border border-[#1a5c38] px-2 py-2">
                      <LightBar className={`h-2.5 ${i === 0 ? 'w-6 mx-auto' : 'w-3/4 mx-auto'}`} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 18 }).map((_, r) => (
                  <tr key={r} className={r % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'}>
                    {LEDGER_COLS.map((w, c) => (
                      <td key={c} className="border border-gray-300 px-2 py-1.5">
                        <Bar
                          className={`h-2.5 ${c === 0 ? 'w-1/2 mx-auto' : 'w-4/5'}`}
                          style={{ opacity: 0.9 - (r % 3) * 0.08 }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <FooterBar />
    </div>
  );
}

/* ==================== 系统设置 ==================== */

type SettingsTone = 'green' | 'blue' | 'red' | 'orange' | 'purple' | 'emerald' | 'gray';

/** 按钮/图标底色，与真实页面各大按钮的主色对应 */
const TONE_BG: Record<SettingsTone, string> = {
  green: 'bg-green-100/90',
  blue: 'bg-blue-100/90',
  red: 'bg-red-100/90',
  orange: 'bg-orange-100/90',
  purple: 'bg-purple-100/90',
  emerald: 'bg-emerald-100/90',
  gray: 'bg-gray-100/90',
};

/**
 * 顶部 tab：超管可见 8 个（状态监测 + 数据管理 + 6 个运维 tab），
 * 一般管理员可见「状态监测（只读）+ 数据管理」。
 * 顺序与真实页面一致：状态监测排在最前，数据管理其次。
 * 每个 tab = px-6(48) + 图标(18) + gap(8) + 文字宽度。
 */
const SETTINGS_TABS = [64, 64, 80, 64, 96, 64, 64, 64];
/** 超管与一般管理员进页面都默认打开「状态监测」（数组第 0 个） */
const SETTINGS_MONITOR_TAB = 0;
/** 「数据管理」在数组中的位置 */
const SETTINGS_DATA_TAB = 1;

/**
 * 数据管理 tab 的动作卡：图标 + 标题 + 说明 + 底部按钮组
 * （真实页卡片是 flex-col，按钮组 mt-auto 贴底，同一行卡片拉齐）
 */
function ActionCard({
  icon,
  titleWidth,
  descWidths,
  buttons,
}: {
  icon: SettingsTone;
  titleWidth: number;
  descWidths: number[];
  buttons: Array<[SettingsTone, number]>;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <Bar className={`h-[22px] w-[22px] rounded ${TONE_BG[icon]}`} />
        <Bar className="h-[18px]" style={{ width: titleWidth }} />
      </div>
      <div className="mb-6 space-y-2">
        {descWidths.map((w, i) => (
          <Bar key={i} className="h-2.5" style={{ width: `${w}%` }} />
        ))}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-3">
        {buttons.map(([tone, w], i) => (
          <Bar key={i} className={`h-12 rounded-xl ${TONE_BG[tone]}`} style={{ width: w }} />
        ))}
      </div>
    </div>
  );
}

/** 顶栏 + 标签栏 + 内容容器：状态监测 / 数据管理 两个 tab 的骨架共用 */
function SettingsChrome({
  tabs,
  activeIndex,
  children,
}: {
  tabs: number[];
  activeIndex: number;
  children: ReactNode;
}) {
  return (
    <div
      className="flex-1 min-h-0 flex flex-col bg-gradient-to-br from-slate-50 to-blue-50"
      aria-hidden="true"
    >
      {/* 顶部导航：返回工作台 ｜ 系统设置 ｜ 用户名 + 退出 */}
      <div className="shrink-0 h-12 bg-white px-6 flex items-center justify-between border-b border-gray-200 shadow-md">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <Bar className="w-5 h-5 rounded" />
            <Bar className="h-3.5 w-16" />
          </div>
          <span className="w-px h-6 bg-gray-200 mx-2" />
          <div className="flex items-center gap-2">
            <Bar className="w-6 h-6 rounded" />
            <Bar className="h-5 w-20" />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Bar className="h-3.5 w-14" />
          <div className="flex items-center gap-1.5">
            <Bar className="w-[18px] h-[18px] rounded" />
            <Bar className="h-3.5 w-8" />
          </div>
        </div>
      </div>

      {/* 标签栏：px-6 py-3，选中项带蓝色下划线 */}
      <div className="shrink-0 bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-8 flex space-x-1 overflow-hidden">
          {tabs.map((labelW, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 px-6 py-3 ${
                i === activeIndex ? 'border-b-2 border-blue-600' : ''
              }`}
            >
              <Bar
                className={`w-[18px] h-[18px] rounded ${i === activeIndex ? 'bg-blue-100' : ''}`}
              />
              <Bar className="h-3.5" style={{ width: labelW }} />
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="max-w-7xl mx-auto w-full p-8 space-y-6">{children}</div>
      </div>
    </div>
  );
}

/** 数据管理 tab：三张动作卡 + 通栏的焊枪编号台账 + 系统设置查看权限 */
function DataTabSkeleton() {
  return (
    <>
          {/* 三张动作卡 + 通栏的焊枪编号台账 */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3 items-stretch">
            {/* 任务管理：导出 / 导入 / 清理（三个按钮会折成两行） */}
            <ActionCard
              icon="green"
              titleWidth={72}
              descWidths={[96, 88]}
              buttons={[
                ['green', 162],
                ['blue', 162],
                ['red', 162],
              ]}
            />
            {/* 工时管理表：月份选择 + 导出 */}
            <ActionCard
              icon="orange"
              titleWidth={90}
              descWidths={[96, 92, 64]}
              buttons={[
                ['gray', 150],
                ['orange', 178],
              ]}
            />
            {/* 状态跟踪表：纳期月份 + 导出 + 清理 */}
            <ActionCard
              icon="purple"
              titleWidth={90}
              descWidths={[92, 60]}
              buttons={[
                ['gray', 150],
                ['purple', 178],
                ['red', 162],
              ]}
            />

            {/* 焊枪编号台账：独占一行，分类 chip + 全选/清空 + 导出/导入 */}
            <div className="lg:col-span-2 xl:col-span-3 bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-2">
                <Bar className="h-[22px] w-[22px] rounded bg-emerald-100/90" />
                <Bar className="h-[18px] w-28" />
              </div>
              <div className="mb-5 space-y-2">
                <Bar className="h-2.5 w-[94%]" />
                <Bar className="h-2.5 w-[82%]" />
              </div>
              {/* 分类 chip（带勾选框 + 表数/行数） */}
              <div className="flex flex-wrap gap-2 mb-5">
                {[124, 138, 124, 134, 114, 130].map((w, i) => (
                  <Bar
                    key={i}
                    className={`h-[38px] rounded-xl border ${
                      i === 0
                        ? 'bg-emerald-50/90 border-emerald-300'
                        : 'bg-gray-50/90 border-gray-200'
                    }`}
                    style={{ width: w }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-3">
                  <Bar className="h-3 w-8" />
                  <Bar className="h-3 w-8 opacity-70" />
                </div>
                <Bar className="h-12 w-48 rounded-xl bg-emerald-100/90" />
                <Bar className="h-12 w-48 rounded-xl bg-blue-100/90" />
              </div>
            </div>
          </div>

          {/* 系统设置查看权限设置：两个开关行（仅超管） */}
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
            <div className="flex items-center gap-2 mb-6">
              <Bar className="h-[22px] w-[22px] rounded bg-purple-100/90" />
              <Bar className="h-[18px] w-44" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-5 bg-gray-50 rounded-xl border border-gray-100"
                >
                  <div className="space-y-2">
                    <Bar className="h-3.5 w-28" />
                    <Bar className="h-2 w-20 opacity-70" />
                  </div>
                  <Bar className="h-6 w-12 rounded-full bg-gray-200/90" />
                </div>
              ))}
            </div>
          </div>
    </>
  );
}

/* ---------- 状态监测 tab ---------- */

/** KPI 卡片：图标 + 角标 + 标签 + 大数字 + 说明 */
function KpiSkeleton() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-100 bg-white p-4 shadow-sm min-h-[120px]">
      <div className="flex items-start justify-between">
        <Bar className="h-8 w-8 rounded-lg bg-blue-100" />
        <Bar className="h-4 w-12 rounded-full bg-gray-100" />
      </div>
      <Bar className="mt-2.5 h-2.5 w-16" />
      <Bar className="mt-2 h-6 w-20" />
      <Bar className="mt-2 h-2 w-24 opacity-70" />
    </div>
  );
}

/** 监控页的区块卡：标题行（图标 + 标题 + 副标题 + 右侧图例）+ 内容 */
function SectionSkeleton({
  titleW,
  subtitleW,
  right,
  children,
}: {
  titleW: number;
  subtitleW: number;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <Bar className="h-4 w-4 rounded bg-blue-100" />
            <Bar className="h-3.5" style={{ width: titleW }} />
          </div>
          <Bar className="h-2.5 opacity-80" style={{ width: subtitleW }} />
        </div>
        {right}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

/** 可用性时间轴的分段：绿=正常、红=中断、黄=部分中断、灰=未采集 */
const TIMELINE_SEGMENTS: Array<[string, number]> = [
  ['bg-emerald-400', 30],
  ['bg-emerald-400', 22],
  ['bg-rose-500', 3],
  ['bg-emerald-400', 26],
  ['bg-emerald-400', 18],
  ['bg-amber-400', 4],
  ['bg-emerald-400', 24],
  ['bg-gray-200', 6],
  ['bg-emerald-400', 28],
];

/** 小型面积图占位：资源趋势 / 流量曲线通用 */
function ChartSkeleton({ height = 160 }: { height?: number }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50" style={{ height }}>
      <div className="h-full w-full p-3 flex items-end gap-1.5">
        {[35, 48, 40, 62, 55, 70, 58, 82, 66, 74, 60, 88, 72, 65].map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-blue-200/70"
            style={{ height: `${h}%`, opacity: 0.65 + (i % 3) * 0.1 }}
          />
        ))}
      </div>
    </div>
  );
}

/** 列表式表格占位：表头 + 若干行（断开记录 / 进程生命周期 / 存储表清单共用） */
function ListTableSkeleton({
  cols,
  rows = 4,
  height,
}: {
  cols: number[];
  rows?: number;
  height?: number;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-gray-100"
      style={height ? { maxHeight: height } : undefined}
    >
      <table className="w-full border-collapse">
        <colgroup>
          {cols.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead className="bg-slate-50/90">
          <tr>
            {cols.map((w, i) => (
              <th key={i} className="px-3 py-2">
                <Bar className="h-2" style={{ width: Math.min(w - 24, 60) }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="border-t border-gray-50">
              {cols.map((w, c) => (
                <td key={c} className="px-3 py-1.5">
                  <Bar
                    className="h-2.5"
                    style={{ width: `${70 - (r % 3) * 8}%`, opacity: 0.9 - (r % 3) * 0.1 }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MonitorTabSkeleton() {
  return (
    <div className="space-y-5">
      {/* 控制条：标题 + 时间范围预设 + 日期 + 刷新 / 自动刷新 / 热重载开关 */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 opacity-60" />
            <div className="space-y-1.5">
              <Bar className="h-3.5 w-20" />
              <Bar className="h-2.5 w-56 opacity-80" />
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1 rounded-xl bg-slate-100 p-1">
            {[44, 36, 44, 36].map((w, i) => (
              <Bar
                key={i}
                className={`h-7 rounded-lg ${i === 0 ? 'bg-white' : ''}`}
                style={{ width: w }}
              />
            ))}
          </div>
          <Bar className="h-[34px] w-[150px] rounded-xl border border-gray-200 bg-gray-50" />
          <Bar className="h-[34px] w-[74px] rounded-xl border border-gray-200 bg-gray-50" />
          <Bar className="h-[34px] w-[112px] rounded-xl bg-blue-50" />
          <Bar className="h-[34px] w-[136px] rounded-xl border border-gray-200 bg-gray-50" />
        </div>
        {/* 心跳 / 运行时长 / 内存 / 事件循环 / 在线前端 / 近 1 分钟请求 / 共享路径 / 更新时间 */}
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-gray-50 pt-2.5">
          {[88, 64, 58, 70, 96, 104].map((w, i) => (
            <Bar key={i} className="h-2.5" style={{ width: w, opacity: 1 - i * 0.08 }} />
          ))}
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <Bar className="h-2.5 w-12" />
            <Bar className="h-2.5 w-16" />
          </span>
          <Bar className="ml-auto h-2.5 w-20" />
        </div>
      </div>

      {/* KPI：2 / 3 / 6 列 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <KpiSkeleton key={i} />
        ))}
      </div>

      {/* 可用性时间轴 */}
      <SectionSkeleton
        titleW={92}
        subtitleW={250}
        right={
          <div className="flex items-center gap-3">
            {[40, 40, 52, 40].map((w, i) => (
              <Bar key={i} className="h-2.5" style={{ width: w, opacity: 0.9 - i * 0.1 }} />
            ))}
          </div>
        }
      >
        <div className="flex h-4 w-full gap-px overflow-hidden rounded-md">
          {TIMELINE_SEGMENTS.map(([color, grow], i) => (
            <div key={i} className={`h-full ${color} opacity-80`} style={{ flexGrow: grow }} />
          ))}
        </div>
        <div className="mt-2 flex justify-between">
          <Bar className="h-2 w-24" />
          <Bar className="h-2 w-24" />
          <Bar className="h-2 w-24" />
        </div>
      </SectionSkeleton>

      {/* 前端访问流量：折线图 + 访问最多接口 / 请求方法分布 */}
      <SectionSkeleton
        titleW={84}
        subtitleW={280}
        right={
          <div className="flex items-center gap-4">
            {[52, 60, 46].map((w, i) => (
              <Bar key={i} className="h-2.5" style={{ width: w, opacity: 0.9 - i * 0.1 }} />
            ))}
          </div>
        }
      >
        <ChartSkeleton height={160} />
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Bar className="h-3 w-24" />
              <Bar className="h-2.5 w-20 opacity-70" />
            </div>
            {Array.from({ length: 6 }).map((_, r) => (
              <div key={r} className="flex items-center gap-2">
                <Bar className="h-5 w-10 rounded" />
                <Bar className="h-2.5 flex-1" style={{ opacity: 0.9 - r * 0.08 }} />
                <Bar className="h-2.5 w-10" />
              </div>
            ))}
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Bar className="h-3 w-24" />
              <Bar className="h-2.5 w-12 opacity-70" />
            </div>
            <Bar className="h-2.5 w-full rounded-full bg-gray-100" />
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {[40, 36, 32, 28].map((w, i) => (
                <Bar key={i} className="h-2.5" style={{ width: w, opacity: 0.9 - i * 0.1 }} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[0, 1].map((i) => (
                <div key={i} className="rounded-lg bg-slate-50 px-3 py-2 space-y-1.5">
                  <Bar className="h-2 w-24 opacity-70" />
                  <Bar className="h-3.5 w-16" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </SectionSkeleton>

      {/* 资源：内存占用趋势 + 事件循环延迟 */}
      <div className="grid gap-4 lg:grid-cols-2">
        {[
          { titleW: 92, subtitleW: 190 },
          { titleW: 84, subtitleW: 250 },
        ].map((cfg, i) => (
          <SectionSkeleton key={i} titleW={cfg.titleW} subtitleW={cfg.subtitleW}>
            <ChartSkeleton height={130} />
          </SectionSkeleton>
        ))}
      </div>

      {/* 共享路径访问：每行 = 状态徽标 + 名称 + 环境变量 + 用途 + 耗时，路径，5 项证据，结论/建议 */}
      <SectionSkeleton
        titleW={84}
        subtitleW={330}
        right={<Bar className="h-[26px] w-[72px] rounded-lg border border-gray-200 bg-gray-50" />}
      >
        <div className="space-y-2.5">
          {[0, 1].map((i) => (
            <div
              key={i}
              className={`rounded-xl border px-4 py-3.5 ${
                i === 1 ? 'border-rose-200 bg-rose-50/40' : 'border-emerald-100 bg-white'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Bar
                  className={`h-4 w-14 rounded-full ${
                    i === 1 ? 'bg-rose-200' : 'bg-emerald-200'
                  }`}
                />
                <Bar className="h-3 w-24" />
                <Bar className="h-3.5 w-20 rounded bg-slate-100" />
                <Bar className="h-2.5 w-40 opacity-70" />
                <Bar className="ml-auto h-2.5 w-28 opacity-70" />
              </div>
              <Bar className="mt-2 h-2.5 w-[62%]" />
              <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-black/5 pt-2.5 sm:grid-cols-3 lg:grid-cols-5">
                {[0, 1, 2, 3, 4].map((c) => (
                  <div key={c} className="space-y-1">
                    <Bar className="h-2 w-12 opacity-70" />
                    <Bar className="h-2.5 w-16" style={{ opacity: 0.9 - c * 0.08 }} />
                  </div>
                ))}
              </div>
              {/* 文件体积 / 最后修改 */}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <Bar className="h-2.5 w-24" />
                <Bar className="h-2.5 w-28" />
              </div>
              {/* 运行时：最近成功解析 / 已解析条目 / 熔断标记 */}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <Bar className="h-2.5 w-36" />
                <Bar className="h-2.5 w-24" />
                {i === 1 && (
                  <Bar className="h-4 w-24 rounded bg-amber-50 ring-1 ring-amber-100" />
                )}
              </div>
              {/* net use 提示行 */}
              <div className="mt-2 flex items-center gap-1.5">
                <Bar className="h-3 w-3 rounded-sm bg-gray-200" />
                <Bar className="h-2.5 w-[46%]" />
              </div>
              {/* 不可用时的建议框 */}
              {i === 1 && (
                <div className="mt-2 rounded-lg bg-white/70 px-2.5 py-2">
                  <Bar className="h-2.5 w-[70%] opacity-80" />
                </div>
              )}
            </div>
          ))}
          {/* 探测口径说明 */}
          <div className="flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2">
            <Bar className="mt-0.5 h-3 w-3 shrink-0 rounded-sm bg-gray-200" />
            <Bar className="h-2.5 w-[78%]" />
          </div>
        </div>
      </SectionSkeleton>

      {/* 后端断开记录：通栏卡片 */}
      <SectionSkeleton
        titleW={92}
        subtitleW={240}
        right={<Bar className="h-4 w-16 rounded-full bg-gray-100" />}
      >
        {Array.from({ length: 3 }).map((_, r) => (
          <div key={r} className="flex items-center gap-3 rounded-xl border border-gray-100 p-3">
            <Bar className="h-9 w-9 rounded-lg bg-gray-100" />
            <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, c) => (
                <div key={c} className="space-y-1.5">
                  <Bar className="h-2 w-14 opacity-70" />
                  <Bar className="h-3 w-16" style={{ opacity: 0.9 - c * 0.1 }} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </SectionSkeleton>

      {/* 访问时段热力：周一至周日 × 24 小时 */}
      <SectionSkeleton
        titleW={150}
        subtitleW={230}
        right={
          <div className="flex items-center gap-1.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Bar key={i} className="h-3 w-5 rounded-[2px] bg-blue-200" />
            ))}
          </div>
        }
      >
        <div className="space-y-[3px]">
          {Array.from({ length: 8 }).map((_, row) => (
            <div key={row} className="grid grid-cols-[34px_repeat(24,minmax(0,1fr))_46px] items-center gap-[3px]">
              <Bar className="h-3 w-6 justify-self-end" />
              {Array.from({ length: 24 }).map((_, col) => (
                <div
                  key={col}
                  className="h-5 rounded-[3px] bg-blue-100"
                  style={{ opacity: 0.35 + ((row * 7 + col) % 5) * 0.14 }}
                />
              ))}
              <Bar className="h-2 w-6 justify-self-center" />
            </div>
          ))}
        </div>
      </SectionSkeleton>

      {/* 进程生命周期：滚动表格 */}
      <SectionSkeleton
        titleW={80}
        subtitleW={210}
        right={<Bar className="h-4 w-12 rounded-full bg-gray-100" />}
      >
        <ListTableSkeleton cols={[90, 70, 60, 80, 70, 180]} rows={6} height={340} />
      </SectionSkeleton>

      {/* 存储占用与清理：三张小卡 + 表清单 + 操作条 */}
      <SectionSkeleton
        titleW={96}
        subtitleW={260}
        right={<Bar className="h-4 w-16 rounded-full bg-emerald-100" />}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl border border-gray-100 bg-slate-50/70 p-3 space-y-2">
              <Bar className="h-2 w-20 opacity-70" />
              <Bar className="h-6 w-24" />
              <div className="space-y-1.5">
                {[0, 1, 2].map((r) => (
                  <Bar key={r} className="h-2" style={{ width: `${80 - r * 12}%` }} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3">
          <ListTableSkeleton cols={[160, 60, 70, 90, 70, 90]} rows={5} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50/70 px-3 py-2.5">
          {/* 一般管理员为只读模式，这里给状态胶囊占位 */}
          <Bar className="h-6 w-40 rounded-lg bg-white ring-1 ring-gray-200" />
          {[96, 84, 76, 108].map((w, i) => (
            <Bar key={i} className="h-7 rounded-lg" style={{ width: w }} />
          ))}
          <Bar className="ml-auto h-2.5 w-48 opacity-70" />
        </div>
      </SectionSkeleton>

      {/* 统计口径说明 */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm space-y-2">
        {[86, 78, 62].map((w, i) => (
          <Bar key={i} className="h-2.5" style={{ width: `${w}%`, opacity: 0.85 - i * 0.1 }} />
        ))}
      </div>
    </div>
  );
}

/**
 * 系统设置骨架屏：按角色选版式，和真实页面的默认 tab 保持一致。
 * - 超级管理员：8 个 tab，默认「状态监测」
 * - 一般管理员：只有「状态监测（只读）+ 数据管理」两个 tab，默认同样落在「状态监测」
 * - 其它角色（无系统设置权限）：只有「数据管理」
 */
export function SystemSettingsSkeleton() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'superadmin';
  const isAdmin = isSuperAdmin || user?.role === 'admin';

  if (isAdmin) {
    return (
      <SettingsChrome
        tabs={
          isSuperAdmin
            ? SETTINGS_TABS
            : [SETTINGS_TABS[SETTINGS_MONITOR_TAB], SETTINGS_TABS[SETTINGS_DATA_TAB]]
        }
        activeIndex={SETTINGS_MONITOR_TAB}
      >
        <MonitorTabSkeleton />
      </SettingsChrome>
    );
  }

  return (
    <SettingsChrome tabs={[SETTINGS_TABS[SETTINGS_DATA_TAB]]} activeIndex={0}>
      <DataTabSkeleton />
    </SettingsChrome>
  );
}

/* ==================== 映射 ==================== */

export const SKELETONS: Record<SkeletonKind, ComponentType> = {
  dashboard: DashboardSkeleton,
  leaderboard: LeaderboardSkeleton,
  workhours: WorkHoursSkeleton,
  statustracking: StatusTrackingSkeleton,
  designstandards: DesignStandardsSkeleton,
  gunledger: GunLedgerSkeleton,
  systemsettings: SystemSettingsSkeleton,
};

export default DashboardSkeleton;
