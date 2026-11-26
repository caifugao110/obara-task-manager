/**
 * 设计规范知识库骨架屏：状态卡 + 3 个 tab + 检索面板。
 *
 * 从 components/LoadingSkeleton.tsx 拆分而来，JSX 逐字保留（未改版式）。
 */
import { Bar, FooterBar, PageHeader } from './primitives';

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

export { SearchPanel };
