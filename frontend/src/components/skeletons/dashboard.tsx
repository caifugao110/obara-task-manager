/**
 * 主页面（排产表）骨架屏：绿色顶栏 + 双行表头 + 分组行 + 底部状态栏。
 *
 * 从 components/LoadingSkeleton.tsx 拆分而来，JSX 逐字保留（未改版式）。
 */
import { Bar, DAY_COUNT, DashboardFooter, HOURS_COL, LightBar, TASK_COL, WEEKEND_COLS } from './primitives';

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

