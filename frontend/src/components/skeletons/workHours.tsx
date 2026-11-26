/**
 * 工时管理骨架屏：统计分组条 + 双列统计卡片。
 *
 * 从 components/LoadingSkeleton.tsx 拆分而来，JSX 逐字保留（未改版式）。
 */
import { Bar, FooterBar, IconButton, MonthSwitch, PageHeader } from './primitives';

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

export { GroupFilterBar, HoursCard };
