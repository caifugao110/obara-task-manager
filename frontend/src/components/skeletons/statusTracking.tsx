/**
 * 状态跟踪骨架屏：筛选条 + 双行蓝色表头的宽表格。
 *
 * 从 components/LoadingSkeleton.tsx 拆分而来，JSX 逐字保留（未改版式）。
 */
import { Bar, FooterBar, LightBar, PageHeader } from './primitives';

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

export { STATUS_COLS, STATUS_VERTICAL_HEADS, STATUS_TEAL_COLS, STATUS_GROUP_START, STATUS_GROUP_SIZE, StatusFilterBar, STATUS_LEADING_COLS, STATUS_TRAILING_COLS, StatusHeadCell };
