/**
 * 任务报表骨架屏：两张渐变查询卡 + 权限卡。
 *
 * 从 components/LoadingSkeleton.tsx 拆分而来，JSX 逐字保留（未改版式）。
 */
import { Bar, FooterBar, IconButton, LightBar, MonthSwitch, PageHeader } from './primitives';

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

export { QueryCard };
