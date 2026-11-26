/**
 * 系统设置骨架屏：各 tab 的内容块（动作卡、数据管理、KPI、列表、图表）与按角色选版式的整页骨架。
 *
 * 从 components/LoadingSkeleton.tsx 拆分而来，JSX 逐字保留（未改版式）。
 */
import type { ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Bar } from './primitives';
import { MonitorTabSkeleton } from './systemMonitorTab';

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

export { TONE_BG, SETTINGS_TABS, SETTINGS_MONITOR_TAB, SETTINGS_DATA_TAB, ActionCard, SettingsChrome, DataTabSkeleton, KpiSkeleton, SectionSkeleton, TIMELINE_SEGMENTS, ChartSkeleton, ListTableSkeleton };
