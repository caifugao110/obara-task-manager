/**
 * 焊枪编号台账骨架屏：左侧分类/表列表 + 右侧宽表格。
 *
 * 从 components/LoadingSkeleton.tsx 拆分而来，JSX 逐字保留（未改版式）。
 */
import { Bar, FooterBar, LightBar } from './primitives';

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

export { LEDGER_COLS, LEDGER_TABLE_MIN_WIDTH };
