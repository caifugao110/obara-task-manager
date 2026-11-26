/**
 * 系统设置里「状态监测」tab 的骨架：控制条 + 指标卡 + 两张图表 + 表格。
 * 单独一个文件是因为它是设置页里最大的一块（约 300 行），混在一起会让设置骨架重新变大。
 *
 * 从 components/LoadingSkeleton.tsx 拆分而来，JSX 逐字保留（未改版式）。
 */
import { Bar } from './primitives';
import { ChartSkeleton, KpiSkeleton, ListTableSkeleton, SectionSkeleton, TIMELINE_SEGMENTS } from './systemSettings';

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

export { MonitorTabSkeleton };
