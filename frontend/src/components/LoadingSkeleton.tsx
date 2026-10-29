import type { ComponentType, CSSProperties, ReactNode } from 'react';

/**
 * 各页面的加载骨架屏 —— 版式对齐真实页面，避免加载完成时布局跳变。
 * - dashboard      主页面（排产表）：绿色顶栏 + 双行表头 + 分组行 + 设计员行
 * - leaderboard    任务报表：白色顶栏 + 两张渐变卡头 + 查询输入框
 * - workhours      工时管理：白色顶栏 + 双列统计卡片 + 人员列表
 * - statustracking 状态跟踪：白色顶栏（搜索/筛选）+ 双行蓝色表头的宽表格
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

/** 白底顶栏（三个子页面共用）：返回工作台 ｜ 标题 ｜ 右侧操作区 */
function PageHeader({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="shrink-0 h-12 bg-white border-b border-gray-200 shadow-sm px-6 flex items-center justify-between">
      <div className="flex items-center gap-4">
        {/* 返回工作台 */}
        <Bar className="h-3.5 w-20" />
        <span className="w-px h-6 bg-gray-200" />
        {/* 页面标题 */}
        <Bar className="h-5 w-24" />
        {children}
      </div>
      <div className="flex items-center gap-4">
        {right}
        {/* 用户名 + 退出 */}
        <Bar className="h-3.5 w-12" />
        <Bar className="h-3.5 w-10" />
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

/* ==================== 主页面（排产表） ==================== */

const DAY_COUNT = 4;
/** 用最后一列模拟周末（真实页面周末列是淡黄底） */
const WEEKEND_COLS = [2];

export function DashboardSkeleton() {
  return (
    <div className="flex-1 min-h-0 flex flex-col" aria-hidden="true">
      {/* ---------- 顶部绿色栏 ---------- */}
      <div className="shrink-0 h-12 bg-[#217346] px-6 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-4">
          <LightBar className="w-6 h-6 rounded-md" />
          <LightBar className="h-4 w-36" />
          {/* 月份切换 */}
          <div className="flex items-center gap-2 h-8 px-2 rounded bg-[#1a5c38]">
            <LightBar className="w-3.5 h-3.5 rounded-sm" />
            <LightBar className="h-3 w-20" />
            <LightBar className="w-3.5 h-3.5 rounded-sm" />
          </div>
          {/* 人员下拉 */}
          <div className="h-8 w-24 rounded bg-[#1a5c38] flex items-center px-3">
            <LightBar className="h-2.5 w-12" />
          </div>
          {/* 导航按钮 */}
          {[88, 72, 84, 96].map((w, i) => (
            <div
              key={i}
              className="h-8 rounded bg-[#1a5c38] flex items-center justify-center"
              style={{ width: w }}
            >
              <LightBar className="h-2.5" style={{ width: w - 36 }} />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <LightBar className="h-3 w-24" />
          <LightBar className="h-3 w-14" />
          <LightBar className="w-6 h-6 rounded-md" />
        </div>
      </div>

      {/* ---------- 表格区 ---------- */}
      <div className="flex-1 min-h-0 bg-white border border-gray-300 overflow-hidden">
        <div
          className="grid"
          style={{ gridTemplateColumns: '96px repeat(' + DAY_COUNT + ', minmax(336px, 1fr))' }}
        >
          {/* 主表头 */}
          <div className="h-14 bg-[#f8f9fa] border-r border-b border-gray-300 flex items-center justify-center">
            <Bar className="h-3 w-10" />
          </div>
          {Array.from({ length: DAY_COUNT }).map((_, i) => (
            <div
              key={i}
              className={`h-14 border-r border-b border-gray-300 flex flex-col items-center justify-center gap-1.5 ${
                WEEKEND_COLS.includes(i) ? 'bg-[#fff2cc]' : 'bg-[#f8f9fa]'
              }`}
            >
              <Bar className="h-2 w-6 opacity-80" />
              <Bar className="h-3 w-5" />
            </div>
          ))}

          {/* 副表头 */}
          <div className="h-6 bg-[#f8f9fa] border-r border-b border-gray-300" />
          {Array.from({ length: DAY_COUNT }).map((_, i) => (
            <div
              key={`sub-${i}`}
              className={`h-6 border-r border-b border-gray-300 flex items-center justify-center ${
                WEEKEND_COLS.includes(i) ? 'bg-[#fff2cc]' : 'bg-[#f8f9fa]'
              }`}
            >
              <Bar className="h-1.5 w-8 opacity-80" />
            </div>
          ))}

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
                  <div className="h-14 bg-white border-r border-b border-gray-300 flex items-center justify-center">
                    <Bar className="h-3.5 w-12" />
                  </div>
                  {/* 每日单元格 */}
                  {Array.from({ length: DAY_COUNT }).map((_, c) => (
                    <div
                      key={c}
                      className={`h-14 border-r border-b border-gray-300 px-2 py-2.5 flex flex-col justify-center gap-1.5 ${
                        WEEKEND_COLS.includes(c) ? 'bg-[#fffbf0]' : 'bg-white'
                      }`}
                    >
                      <Bar className="h-2 w-[58%]" />
                      <Bar className="h-2 w-[36%]" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ==================== 任务报表 ==================== */

/** 渐变卡头的查询卡片 */
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
    <div className="flex-1 min-h-0 flex flex-col" aria-hidden="true">
      <PageHeader right={<><MonthSwitch /><IconButton /></>} />
      <div className="flex-1 min-h-0 overflow-hidden bg-gray-50">
        <div className="max-w-7xl mx-auto w-full px-8 pb-8">
          {/* 真实页面里两张查询卡是紧贴的，间距只由第一张的 my-8 提供 */}
          <div className="my-8">
            <QueryCard tone="blue" />
            <QueryCard tone="emerald" />
          </div>
          {/* 底部汇总条 */}
          <div className="mt-8 bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <Bar className="h-4 w-28" />
              <div className="flex items-center gap-3">
                <Bar className="h-8 w-24 rounded-lg" />
                <Bar className="h-8 w-20 rounded-lg" />
              </div>
            </div>
            <div className="space-y-2.5">
              <Bar className="h-2.5 w-[64%]" />
              <Bar className="h-2.5 w-[44%]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==================== 工时管理 ==================== */

/** 双列统计卡片中的一张 */
function HoursCard() {
  return (
    <section className="flex max-h-[calc(100vh_-_13.5rem)] flex-col rounded-2xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/40">
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
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg border-b border-slate-100/80 px-2 py-2.5 last:border-b-0"
          >
            <Bar className="h-4 w-4 rounded-md" />
            <Bar className="h-3 w-14" style={{ opacity: 1 - i * 0.05 }} />
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
    <div className="flex-1 min-h-0 flex flex-col" aria-hidden="true">
      <PageHeader right={<><MonthSwitch /><IconButton /></>}>
        {/* 导出按钮（仅管理员可见，骨架里给出占位） */}
        <Bar className="h-7 w-28 rounded-lg bg-purple-100/80" />
      </PageHeader>
      <div className="flex-1 min-h-0 overflow-hidden bg-slate-50">
        <div className="mx-auto w-full max-w-7xl px-6 py-6 lg:px-8">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-6">
            <HoursCard />
            <HoursCard />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==================== 状态跟踪 ==================== */

/** 与真实表格一致的列宽，加载完成时列不跳 */
const STATUS_COLS = [80, 274, 45, 60, 45, 45, 45, 45, 110, 130, 45, 45, 45, 45, 45, 45, 45, 80, 80, 96];

export function StatusTrackingSkeleton() {
  return (
    <div className="flex-1 min-h-0 flex flex-col" aria-hidden="true">
      <PageHeader
        right={
          <>
            <Bar className="h-7 w-20 rounded-full bg-blue-200/70" />
            <Bar className="h-7 w-28 rounded-lg bg-purple-100/80" />
            <Bar className="h-7 w-24 rounded-lg bg-gray-100" />
            <Bar className="h-7 w-32 rounded-lg bg-gray-100" />
            <Bar className="h-7 w-20 rounded-lg bg-gray-100" />
          </>
        }
      >
        <span className="w-px h-6 bg-gray-200" />
        {/* 搜索框 */}
        <Bar className="h-8 w-64 rounded-lg border border-gray-200 bg-gray-50" />
        {/* 全表搜索 */}
        <div className="flex items-center gap-2">
          <Bar className="h-4 w-4 rounded bg-gray-200" />
          <Bar className="h-3 w-14" />
        </div>
      </PageHeader>

      <div className="flex-1 min-h-0 overflow-hidden bg-gray-50 px-6 pb-6">
        <div className="h-6 shrink-0" />
        <div className="w-full overflow-hidden bg-white rounded-2xl shadow-xl border border-gray-100">
          <table className="w-full text-sm" style={{ tableLayout: 'fixed', minWidth: 1500 }}>
            <colgroup>
              {STATUS_COLS.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <thead>
              {/* 第一行表头：蓝渐变 */}
              <tr className="bg-gradient-to-r from-blue-600 to-blue-700">
                {STATUS_COLS.map((w, i) => (
                  <th
                    key={i}
                    className={`px-2 py-2 border-r border-white/60 ${i === 0 ? 'rounded-tl-2xl' : ''}`}
                  >
                    <LightBar
                      className={`h-2.5 mx-auto ${w > 100 ? 'w-3/4' : w > 60 ? 'w-8' : 'w-5'}`}
                    />
                  </th>
                ))}
              </tr>
              {/* 第二行表头：同色系、字条更细 */}
              <tr className="bg-blue-700/85">
                {STATUS_COLS.map((w, i) => (
                  <th key={i} className="px-2 py-1.5 border-r border-white/40">
                    <LightBar
                      className={`h-2 mx-auto opacity-80 ${w > 100 ? 'w-1/2' : 'w-5'}`}
                    />
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
    </div>
  );
}

/* ==================== 设计规范知识库 ==================== */

/** 检索面板：范围选择 + 输入框 + 结果卡片 */
function SearchPanel() {
  return (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
      {/* 检索范围 */}
      <div className="flex items-center gap-2 mb-2">
        <Bar className="h-2.5 w-14" />
        <Bar className="h-8 w-40 rounded-lg bg-gray-100" />
      </div>
      {/* 检索输入 */}
      <div className="flex items-center gap-3 mt-3">
        <Bar className="h-12 flex-1 rounded-lg bg-gray-50 border-2 border-gray-100" />
        <Bar className="h-12 w-28 rounded-lg bg-blue-100" />
      </div>
      {/* 结果卡片 */}
      <div className="mt-6 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-100 p-4 space-y-2.5">
            <div className="flex items-center gap-2">
              <Bar className="h-6 w-6 rounded-md" />
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
    <div className="flex-1 min-h-0 flex flex-col" aria-hidden="true">
      <PageHeader
        right={
          <>
            <Bar className="h-8 w-24 rounded-lg bg-gray-100" />
            <Bar className="h-8 w-8 rounded-lg bg-blue-50" />
          </>
        }
      >
        <Bar className="h-5 w-32" />
      </PageHeader>
      <div className="flex-1 min-h-0 overflow-hidden bg-gray-50">
        <div className="max-w-6xl mx-auto w-full px-6 py-8">
          {/* 状态卡 */}
          <div className="bg-white rounded-2xl shadow-sm border border-blue-100 p-6 mb-6 flex items-start gap-4">
            <div className="shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 opacity-60" />
            <div className="flex-1 space-y-2.5 pt-1">
              <Bar className="h-5 w-48" />
              <Bar className="h-3 w-[68%]" />
              <Bar className="h-3 w-[46%]" />
            </div>
          </div>

          {/* tab 切换（真实页面同一时间只显示一个 tab 的内容） */}
          <div className="flex items-center gap-2 mb-6">
            {[80, 96, 88, 72].map((w, i) => (
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
        </div>
      </div>
    </div>
  );
}

/* ==================== 焊枪编号台账 ==================== */

const LEDGER_COLS = ['w-14', 'w-32', 'w-24', 'w-28', 'w-20', 'w-24', 'w-20', 'w-16'];

export function GunLedgerSkeleton() {
  return (
    <div className="flex-1 min-h-0 flex flex-col" aria-hidden="true">
      {/* 绿色顶栏 */}
      <div className="shrink-0 h-11 bg-[#217346] px-6 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <LightBar className="h-3.5 w-20" />
          <span className="w-px h-6 bg-white/30" />
          <LightBar className="h-5 w-32" />
          <LightBar className="h-6 w-20 rounded-md" />
        </div>
        <div className="flex items-center gap-4">
          <LightBar className="h-3 w-16" />
          <LightBar className="h-3.5 w-10" />
        </div>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* 左侧表列表 */}
        <aside className="w-64 shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden">
          <div className="shrink-0 p-3 border-b border-gray-200 space-y-2">
            <Bar className="h-2.5 w-10" />
            <div className="flex gap-1.5">
              <Bar className="h-6 w-14 rounded-full bg-emerald-50" />
              <Bar className="h-6 w-16 rounded-full bg-gray-100" />
              <Bar className="h-6 w-12 rounded-full bg-gray-100" />
            </div>
          </div>
          <div className="flex-1 min-h-0 p-2 space-y-1.5">
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 rounded-lg px-2 py-2 ${
                  i === 0 ? 'bg-emerald-50/80' : ''
                }`}
              >
                <Bar className="h-3 w-3 rounded" />
                <Bar className="h-2.5 flex-1" style={{ opacity: 1 - i * 0.06 }} />
              </div>
            ))}
          </div>
        </aside>

        {/* 右侧表格 */}
        <div className="flex-1 min-w-0 bg-white overflow-hidden">
          <div className="p-3 border-b border-gray-100 flex items-center gap-2">
            <Bar className="h-6 w-40 rounded-md bg-gray-50" />
            <Bar className="h-6 w-16 rounded-md bg-emerald-50" />
            <Bar className="h-6 w-16 rounded-md bg-gray-100 ml-auto" />
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#217346]">
                {LEDGER_COLS.map((w, i) => (
                  <th key={i} className="border border-[#1a5c38] px-2 py-2">
                    <LightBar className={`h-2.5 ${i === 0 ? 'w-6 mx-auto' : 'w-3/4 mx-auto'}`} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 16 }).map((_, r) => (
                <tr key={r} className={r % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'}>
                  {LEDGER_COLS.map((_, c) => (
                    <td key={c} className="border border-gray-300 px-2 py-2">
                      <Bar className={`h-2.5 ${c === 0 ? 'w-1/2 mx-auto' : 'w-4/5'}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ==================== 系统设置 ==================== */

/** 设置页的一张表单卡 */
function SettingsCard({ fields = 2, columns = 2 }: { fields?: number; columns?: number }) {
  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
      <div className="flex items-center gap-2 mb-5">
        <Bar className="h-4 w-4 rounded" />
        <Bar className="h-4 w-32" />
      </div>
      <div className={`grid gap-4 ${columns === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Bar className="h-2.5 w-20" />
            <Bar className="h-10 w-full rounded-lg bg-gray-50 border border-gray-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SystemSettingsSkeleton() {
  return (
    <div className="flex-1 min-h-0 flex flex-col" aria-hidden="true">
      <PageHeader />

      {/* 标签栏 */}
      <div className="shrink-0 bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-8 flex space-x-1">
          {[96, 112, 96, 88].map((w, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 px-6 py-3 ${
                i === 0 ? 'border-b-2 border-blue-600' : ''
              }`}
            >
              <Bar className="h-4 w-4 rounded" />
              <Bar className="h-3.5" style={{ width: w - 40 }} />
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden bg-gray-50">
        <div className="max-w-5xl mx-auto w-full p-8 space-y-8">
          <SettingsCard fields={4} />
          <SettingsCard fields={3} columns={3} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <SettingsCard fields={2} columns={1} />
            <SettingsCard fields={2} columns={1} />
          </div>
          <SettingsCard fields={6} columns={3} />
        </div>
      </div>
    </div>
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
