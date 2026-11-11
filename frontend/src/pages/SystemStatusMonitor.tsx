import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  Info,
  RefreshCw,
  Server,
  Timer,
  TrendingUp,
  Wifi,
  Zap
} from 'lucide-react';
import { axiosInstance } from '../services/api';

/* ------------------------------------------------------------------ *
 * 类型
 * ------------------------------------------------------------------ */

type Preset = 'today' | '3d' | '7d' | '30d' | '90d' | '180d' | 'day';

interface CauseInfo {
  code: string;
  label: string;
  confidence: 'high' | 'medium' | 'low' | string;
  severity: 'info' | 'warning' | 'critical' | string;
  evidence: string[];
}

interface DisconnectItem {
  kind: 'restart' | 'stall';
  startAtMs: number;
  endAtMs: number;
  durationSec: number;
  stableBeforeSec: number | null;
  precision: 'exact' | 'sample';
  cause: CauseInfo;
}

interface TrafficPoint {
  tsMs: number;
  requests: number;
  errors: number;
  slow: number;
  avgMs: number;
  maxMs: number;
  clients: number;
}

interface ResourcePoint {
  tsMs: number;
  rssMb: number;
  rssMaxMb: number;
  heapMb: number;
  lagMs: number;
  lagMaxMs: number;
  dbMs: number;
  sockets: number;
  samples: number;
}

interface OverviewData {
  serverTimeMs: number;
  range: { preset: Preset; label: string; startMs: number; endMs: number; granularity: 'hour' | 'day' };
  collection: { startedAtMs: number | null; coverageStartMs: number | null; coverageMs: number; hasData: boolean };
  availability: {
    uptimeMs: number;
    downtimeMs: number;
    ratio: number | null;
    disconnectCount: number;
    /** 含热重载的总条数（忽略开关开启时与 disconnectCount 不同） */
    totalCount: number;
    hotReloadCount: number;
    ignoreHotReload: boolean;
    longestDowntimeMs: number;
    longestStableMs: number | null;
    avgStableMs: number | null;
    currentUptimeSec: number;
    bootedAtMs: number;
  };
  timeline: Array<{ startMs: number; endMs: number; state: 'up' | 'down' | 'partial' | 'unknown'; downSec: number; availability: number }>;
  disconnects: DisconnectItem[];
  traffic: {
    granularity: 'hour' | 'day';
    bucketMs: number;
    series: TrafficPoint[];
    totals: {
      requests: number;
      errors: number;
      slow: number;
      avgMs: number;
      errorRate: number;
      peakClients: number;
      peakRequests: number;
      peakAtMs: number | null;
    };
    topPaths: Array<{ path: string; method: string; requests: number; errors: number; avgMs: number }>;
    methods: Array<{ method: string; requests: number }>;
  };
  resources: {
    series: ResourcePoint[];
    summary: { peakRssMb: number; peakLagMs: number; avgLagMs: number; peakSockets: number; avgDbMs: number };
  };
  heatmap: { matrix: number[][]; max: number; total?: number };
  events: Array<{ tsMs: number; type: string; detail: any }>;
}

interface LiveData {
  serverTimeMs: number;
  bootedAtMs: number;
  uptimeSec: number;
  socketCount: number;
  requestsLastMinute: number;
  errorsLastMinute: number;
  rssMb: number;
  heapMb: number;
  lagMs: number;
  dbMs: number;
  sampleAgeSec: number | null;
  collectionStartedAtMs: number | null;
}

interface StorageTableInfo {
  key: string;
  table: string;
  label: string;
  note: string;
  retentionDays: number | null;
  rows: number;
  bytes: number | null;
  oldestMs: number | null;
  newestMs: number | null;
}

interface StorageData {
  serverTimeMs: number;
  db: {
    fileName: string;
    mainBytes: number;
    walBytes: number;
    shmBytes: number;
    totalBytes: number;
    pageSize: number;
    pageCount: number;
    freelistCount: number;
    reclaimableBytes: number;
    journalMode: string;
  };
  monitor: {
    bytes: number | null;
    rows: number;
    tables: StorageTableInfo[];
    share: number | null;
  };
  policy: {
    retentionDays: number;
    minuteRetentionDays: number;
    cleanupIntervalHours: number;
    autoCleanup: boolean;
    lastCleanupAtMs: number | null;
    lastCleanupMode: string | null;
    lastCleanupDeleted: number;
    lastCleanupFreedBytes: number;
    lastCleanupDurationMs: number;
    lastCleanupSource: string | null;
    cleanupCount: number;
    totalDeleted: number;
    lastVacuumAtMs: number | null;
    lastVacuumFreedBytes: number;
    nextCleanupAtMs: number | null;
  };
  estimate: {
    collectedDays: number | null;
    bytesPerDay: number | null;
    projectedFullBytes: number | null;
  };
}

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

const PRESETS: Array<{ key: Preset; label: string }> = [
  { key: 'today', label: '今日' },
  { key: '3d', label: '近三天' },
  { key: '7d', label: '近一周' },
  { key: '30d', label: '近一月' },
  { key: '90d', label: '近三月' },
  { key: '180d', label: '近半年' }
];

const pad = (value: number) => String(value).padStart(2, '0');

const toDayInputValue = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** 秒 -> 人类可读（1天3小时 / 12分34秒） */
const formatDuration = (sec: number | null | undefined, options?: { compact?: boolean }) => {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
  const total = Math.max(0, Math.round(sec));
  if (total === 0) return '0 秒';
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (options?.compact) {
    if (days > 0) return `${days}天${hours}小时`;
    if (hours > 0) return `${hours}小时${minutes}分`;
    if (minutes > 0) return `${minutes}分${seconds}秒`;
    return `${seconds}秒`;
  }
  if (days > 0) return `${days} 天 ${hours} 小时 ${minutes} 分`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`;
  return `${seconds} 秒`;
};

const formatDurationMs = (ms: number | null | undefined) => formatDuration(ms ? ms / 1000 : 0, { compact: true });

const formatPercent = (ratio: number | null | undefined, digits = 3) => {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
};

const formatNumber = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('zh-CN');
};

/** 紧凑数字：12800 -> 1.3万，用于热力图行/列合计这种窄列 */
const formatCompact = (value: number) => {
  if (!Number.isFinite(value) || value === 0) return '0';
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
};

const formatTime = (ms: number, pattern = 'MM-dd HH:mm:ss') => format(new Date(ms), pattern);

/** 字节 -> 可读体积，用于存储占用卡片 */
const formatBytes = (bytes: number | null | undefined, digits = 2) => {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(digits)} ${units[unit]}`;
};

const axisLabel = (ms: number, granularity: 'hour' | 'day') => (
  granularity === 'day' ? format(new Date(ms), 'MM-dd') : format(new Date(ms), 'HH:mm')
);

const niceMax = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = Math.pow(10, exponent);
  const normalized = value / base;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return step * base;
};

const useElementWidth = (fallback = 760) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(Math.max(260, element.clientWidth));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
};

/* ------------------------------------------------------------------ *
 * 图表：请求量面积图 + 错误率折线（双轴，共享时间刻度）
 * ------------------------------------------------------------------ */

interface TrafficChartProps {
  series: TrafficPoint[];
  granularity: 'hour' | 'day';
  height?: number;
}

const TrafficChart: React.FC<TrafficChartProps> = ({ series, granularity, height = 240 }) => {
  const { ref, width } = useElementWidth();
  const [hover, setHover] = useState<number | null>(null);

  const padding = { top: 14, right: 46, bottom: 26, left: 48 };
  const innerWidth = Math.max(10, width - padding.left - padding.right);
  const innerHeight = Math.max(10, height - padding.top - padding.bottom);

  const maxRequests = niceMax(Math.max(1, ...series.map((point) => point.requests)));
  const rates = series.map((point) => (point.requests ? point.errors / point.requests : 0));
  const maxRate = Math.max(0.02, Math.min(1, Math.max(...rates, 0)));

  const x = (index: number) => {
    if (series.length <= 1) return padding.left + innerWidth / 2;
    return padding.left + (index / (series.length - 1)) * innerWidth;
  };
  const y = (value: number) => padding.top + innerHeight - (value / maxRequests) * innerHeight;
  const yRate = (value: number) => padding.top + innerHeight - (value / maxRate) * innerHeight;

  const linePath = series.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(point.requests).toFixed(2)}`).join(' ');
  const areaPath = series.length
    ? `${linePath} L${x(series.length - 1).toFixed(2)},${(padding.top + innerHeight).toFixed(2)} L${x(0).toFixed(2)},${(padding.top + innerHeight).toFixed(2)} Z`
    : '';
  const ratePath = series.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${yRate(point.errors ? point.errors / Math.max(1, point.requests) : 0).toFixed(2)}`).join(' ');

  const tickCount = Math.min(6, Math.max(2, series.length));
  const ticks = Array.from({ length: tickCount }, (_, index) => {
    if (series.length <= 1) return 0;
    return Math.round((index / (tickCount - 1)) * (series.length - 1));
  });

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((ratio) => maxRequests * ratio);

  const hoverPoint = hover !== null ? series[hover] : null;

  return (
    <div ref={ref} className="relative">
      {series.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-gray-300" style={{ height }}>
          <BarChart3 size={28} className="mb-2" />
          <span className="text-xs">该时间段暂无流量数据</span>
        </div>
      ) : (
        <svg
          width={width}
          height={height}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const offset = event.clientX - rect.left - padding.left;
            const ratio = innerWidth > 0 ? offset / innerWidth : 0;
            const index = Math.round(ratio * (series.length - 1));
            setHover(Math.min(series.length - 1, Math.max(0, index)));
          }}
        >
          <defs>
            <linearGradient id="trafficArea" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {gridValues.map((value) => (
            <g key={`grid-${value}`}>
              <line
                x1={padding.left}
                x2={padding.left + innerWidth}
                y1={y(value)}
                y2={y(value)}
                stroke="#eef2f7"
                strokeWidth={1}
              />
              <text x={padding.left - 8} y={y(value) + 3.5} textAnchor="end" fontSize={10} fill="#94a3b8">
                {Math.round(value).toLocaleString('zh-CN')}
              </text>
            </g>
          ))}

          {[0, 0.5, 1].map((ratio) => (
            <text
              key={`rate-${ratio}`}
              x={padding.left + innerWidth + 8}
              y={yRate(maxRate * ratio) + 3.5}
              fontSize={10}
              fill="#fb7185"
            >
              {`${(maxRate * ratio * 100).toFixed(maxRate < 0.1 ? 1 : 0)}%`}
            </text>
          ))}

          <path d={areaPath} fill="url(#trafficArea)" />
          <path d={linePath} fill="none" stroke="#2563eb" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={ratePath} fill="none" stroke="#f43f5e" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.9} />

          {ticks.map((index) => (
            <text
              key={`tick-${index}`}
              x={x(index)}
              y={height - 8}
              textAnchor={index === 0 ? 'start' : index === series.length - 1 ? 'end' : 'middle'}
              fontSize={10}
              fill="#94a3b8"
            >
              {axisLabel(series[index].tsMs, granularity)}
            </text>
          ))}

          {hover !== null && (
            <g>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={padding.top}
                y2={padding.top + innerHeight}
                stroke="#94a3b8"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <circle cx={x(hover)} cy={y(series[hover].requests)} r={3.5} fill="#2563eb" stroke="#fff" strokeWidth={2} />
              <circle cx={x(hover)} cy={yRate(rates[hover])} r={3} fill="#f43f5e" stroke="#fff" strokeWidth={1.5} />
            </g>
          )}
        </svg>
      )}

      {hoverPoint && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-gray-200 bg-white/95 px-3 py-2 text-[11px] shadow-lg backdrop-blur"
          style={{
            left: Math.min(Math.max(x(hover || 0) - 70, 4), Math.max(4, width - 168)),
            top: 4
          }}
        >
          <div className="mb-1 font-bold text-gray-700">
            {format(new Date(hoverPoint.tsMs), granularity === 'day' ? 'yyyy-MM-dd' : 'MM-dd HH:mm')}
          </div>
          <div className="flex items-center justify-between gap-4 text-blue-600">
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-blue-500" />请求</span>
            <span className="font-bold tabular-nums">{formatNumber(hoverPoint.requests)}</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-rose-500">
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-rose-500" />错误</span>
            <span className="font-bold tabular-nums">
              {formatNumber(hoverPoint.errors)}
              {hoverPoint.requests > 0 && ` (${((hoverPoint.errors / hoverPoint.requests) * 100).toFixed(1)}%)`}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 text-gray-500">
            <span>平均响应</span>
            <span className="font-bold tabular-nums">{hoverPoint.avgMs} ms</span>
          </div>
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * 图表：单值折线（资源趋势）
 * ------------------------------------------------------------------ */

interface MiniChartProps {
  points: Array<{ tsMs: number; value: number }>;
  granularity: 'hour' | 'day';
  color: string;
  gradientId: string;
  height?: number;
  unit?: string;
  threshold?: number;
}

const MiniAreaChart: React.FC<MiniChartProps> = ({ points, granularity, color, gradientId, height = 120, unit = '', threshold }) => {
  const { ref, width } = useElementWidth(520);
  const [hover, setHover] = useState<number | null>(null);
  const padding = { top: 10, right: 12, bottom: 20, left: 40 };
  const innerWidth = Math.max(10, width - padding.left - padding.right);
  const innerHeight = Math.max(10, height - padding.top - padding.bottom);
  const maxValue = niceMax(Math.max(1, threshold || 0, ...points.map((point) => point.value)));
  const x = (index: number) => (points.length <= 1 ? padding.left + innerWidth / 2 : padding.left + (index / (points.length - 1)) * innerWidth);
  const y = (value: number) => padding.top + innerHeight - (Math.min(value, maxValue) / maxValue) * innerHeight;
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ');
  const area = points.length
    ? `${line} L${x(points.length - 1).toFixed(2)},${padding.top + innerHeight} L${x(0).toFixed(2)},${padding.top + innerHeight} Z`
    : '';

  const tickCount = Math.min(4, Math.max(2, points.length));
  const ticks = Array.from({ length: tickCount }, (_, index) => (points.length <= 1 ? 0 : Math.round((index / (tickCount - 1)) * (points.length - 1))));

  return (
    <div ref={ref} className="relative">
      {points.length === 0 ? (
        <div className="flex items-center justify-center text-[11px] text-gray-300" style={{ height }}>暂无采样数据</div>
      ) : (
        <svg
          width={width}
          height={height}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const offset = event.clientX - rect.left - padding.left;
            const ratio = innerWidth > 0 ? offset / innerWidth : 0;
            setHover(Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1)))));
          }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((ratio) => (
            <g key={ratio}>
              <line x1={padding.left} x2={padding.left + innerWidth} y1={y(maxValue * ratio)} y2={y(maxValue * ratio)} stroke="#eef2f7" />
              <text x={padding.left - 6} y={y(maxValue * ratio) + 3.5} textAnchor="end" fontSize={9} fill="#94a3b8">
                {Math.round(maxValue * ratio)}
              </text>
            </g>
          ))}
          <path d={area} fill={`url(#${gradientId})`} />
          <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
          {ticks.map((index) => (
            <text
              key={index}
              x={x(index)}
              y={height - 6}
              textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
              fontSize={9}
              fill="#94a3b8"
            >
              {axisLabel(points[index].tsMs, granularity)}
            </text>
          ))}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={padding.top} y2={padding.top + innerHeight} stroke="#94a3b8" strokeDasharray="3 3" />
              <circle cx={x(hover)} cy={y(points[hover].value)} r={3} fill={color} stroke="#fff" strokeWidth={1.5} />
            </g>
          )}
        </svg>
      )}
      {hover !== null && points[hover] && (
        <div className="pointer-events-none absolute right-1 top-1 rounded-md border border-gray-100 bg-white/95 px-2 py-1 text-[10px] font-bold text-gray-600 shadow">
          {format(new Date(points[hover].tsMs), granularity === 'day' ? 'MM-dd' : 'MM-dd HH:mm')} · {points[hover].value.toFixed(1)}{unit}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * 小组件
 * ------------------------------------------------------------------ */

const KpiCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  hint?: React.ReactNode;
  tone: 'blue' | 'emerald' | 'rose' | 'amber' | 'violet' | 'slate';
  badge?: React.ReactNode;
}> = ({ icon, label, value, unit, hint, tone, badge }) => {
  const tones: Record<string, string> = {
    blue: 'from-blue-500/10 to-blue-500/0 text-blue-600 ring-blue-100',
    emerald: 'from-emerald-500/10 to-emerald-500/0 text-emerald-600 ring-emerald-100',
    rose: 'from-rose-500/10 to-rose-500/0 text-rose-600 ring-rose-100',
    amber: 'from-amber-500/10 to-amber-500/0 text-amber-600 ring-amber-100',
    violet: 'from-violet-500/10 to-violet-500/0 text-violet-600 ring-violet-100',
    slate: 'from-slate-500/10 to-slate-500/0 text-slate-600 ring-slate-100'
  };

  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition hover:shadow-md">
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${tones[tone]}`} />
      <div className="relative flex items-start justify-between">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-white/70 ring-1 ${tones[tone]}`}>{icon}</div>
        {badge}
      </div>
      <div className="relative mt-2.5 text-[11px] font-bold text-gray-400">{label}</div>
      <div className="relative mt-0.5 flex items-baseline gap-1">
        <span className="text-[22px] font-black leading-tight text-gray-800 tabular-nums">{value}</span>
        {unit && <span className="text-[11px] font-bold text-gray-400">{unit}</span>}
      </div>
      {hint && <div className="relative mt-1 text-[10px] leading-snug text-gray-400">{hint}</div>}
    </div>
  );
};

const ConfidenceBadge: React.FC<{ confidence: string }> = ({ confidence }) => {
  const map: Record<string, { label: string; className: string }> = {
    high: { label: '证据充分', className: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
    medium: { label: '较可信', className: 'bg-amber-50 text-amber-700 ring-amber-100' },
    low: { label: '待观察', className: 'bg-slate-100 text-slate-500 ring-slate-200' }
  };
  const item = map[confidence] || map.low;
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${item.className}`}>{item.label}</span>;
};

const SectionCard: React.FC<{ title: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }> = ({
  title,
  subtitle,
  right,
  children,
  className = ''
}) => (
  <div className={`overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm ${className}`}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-bold text-gray-800">{title}</div>
        {subtitle && <div className="mt-0.5 text-[11px] text-gray-400">{subtitle}</div>}
      </div>
      {right}
    </div>
    <div className="px-5 py-4">{children}</div>
  </div>
);

/* ------------------------------------------------------------------ *
 * 主面板
 * ------------------------------------------------------------------ */

const SystemStatusMonitor: React.FC = () => {
  const [preset, setPreset] = useState<Preset>('today');
  const [day, setDay] = useState<string>(toDayInputValue(new Date()));
  const [data, setData] = useState<OverviewData | null>(null);
  const [live, setLive] = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  // 开发期 nodemon 热重载不是故障，默认剔除；关闭后可见全部记录
  const [ignoreHotReload, setIgnoreHotReload] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  // 存储占用：与总览分开请求，失败不影响整页
  const [storage, setStorage] = useState<StorageData | null>(null);
  // 待确认的清理动作（清理不可恢复，必须二次确认）
  const [pendingAction, setPendingAction] = useState<{ mode: 'retention' | 'days' | 'vacuum'; days?: number } | null>(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const query = useMemo(() => ({
    ...(preset === 'day' ? { preset, date: day } : { preset }),
    ...(ignoreHotReload ? { ignoreHotReload: '1' } : {})
  }), [preset, day, ignoreHotReload]);

  const fetchOverview = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const response = await axiosInstance.get('/system/monitor/overview', { params: query });
      setData(response.data);
      setError(null);
      setLastUpdatedAt(Date.now());
    } catch (err: any) {
      setError(err?.response?.data?.message || '无法获取状态数据，请确认后端服务是否正常');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [query]);

  const fetchLive = useCallback(async () => {
    try {
      const response = await axiosInstance.get('/system/monitor/live');
      setLive(response.data);
    } catch {
      // 实时状态失败不覆盖整页错误
    }
  }, []);

  const fetchStorage = useCallback(async (force = false) => {
    try {
      const response = await axiosInstance.get('/system/monitor/storage', {
        params: force ? { force: '1' } : undefined
      });
      setStorage(response.data);
    } catch {
      // 存储信息失败不影响主面板
    }
  }, []);

  useEffect(() => {
    void fetchStorage();
  }, [fetchStorage]);

  const runCleanup = useCallback(async () => {
    if (!pendingAction || cleanupRunning) return;
    setCleanupRunning(true);
    setCleanupMessage(null);
    try {
      const response = await axiosInstance.post('/system/monitor/cleanup', {
        mode: pendingAction.mode,
        days: pendingAction.days,
        vacuum: pendingAction.mode === 'vacuum'
      });
      const result = response.data;
      if (result.storage) setStorage(result.storage);
      const parts = [`删除 ${formatNumber(result.totalDeleted)} 行`];
      if (result.vacuumed) parts.push(`压缩耗时 ${formatNumber(result.vacuumMs)} ms`);
      parts.push(`释放 ${formatBytes(result.freedBytes)}`);
      setCleanupMessage({
        tone: 'success',
        text: `${pendingAction.mode === 'vacuum' ? '压缩完成' : '清理完成'}：${parts.join('，')}`
      });
      setPendingAction(null);
      void fetchOverview(true);
    } catch (err: any) {
      setCleanupMessage({
        tone: 'error',
        text: err?.response?.data?.message || '清理失败，请稍后重试或查看后端日志'
      });
    } finally {
      setCleanupRunning(false);
    }
  }, [pendingAction, cleanupRunning, fetchOverview]);

  useEffect(() => {
    setLoading(true);
    void fetchOverview();
  }, [fetchOverview]);

  useEffect(() => {
    void fetchLive();
    const timer = setInterval(() => { void fetchLive(); }, 15000);
    return () => clearInterval(timer);
  }, [fetchLive]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => { void fetchOverview(true); }, 30000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchOverview]);

  const availability = data?.availability;
  const traffic = data?.traffic;
  const resources = data?.resources;

  const upRatioTone = useMemo(() => {
    const ratio = availability?.ratio;
    if (ratio === null || ratio === undefined) return 'slate';
    if (ratio >= 0.999) return 'emerald';
    if (ratio >= 0.99) return 'blue';
    if (ratio >= 0.97) return 'amber';
    return 'rose';
  }, [availability?.ratio]);

  const trafficPoints = useMemo(() => (
    (resources?.series || []).map((point) => ({ tsMs: point.tsMs, value: point.rssMb }))
  ), [resources?.series]);

  const lagPoints = useMemo(() => (
    (resources?.series || []).map((point) => ({ tsMs: point.tsMs, value: point.lagMs }))
  ), [resources?.series]);

  const maxPathRequests = Math.max(1, ...(traffic?.topPaths || []).map((item) => item.requests));
  const totalMethodRequests = Math.max(1, (traffic?.methods || []).reduce((sum, item) => sum + item.requests, 0));

  const collectionStartedAtMs = data?.collection.startedAtMs ?? null;
  const collectAgeText = collectionStartedAtMs
    ? `采集自 ${format(new Date(collectionStartedAtMs), 'yyyy-MM-dd HH:mm')}`
    : '尚未开始采集';

  const liveOnline = live !== null && (live.sampleAgeSec === null || live.sampleAgeSec <= 120);

  // ---- 存储占用与清理 ----
  const dbInfo = storage?.db;
  const policy = storage?.policy;
  const reclaimableBytes = dbInfo?.reclaimableBytes ?? 0;
  // 压缩后主文件预计大小：当前页数去掉空闲页
  const projectedMainBytes = dbInfo ? Math.max(0, dbInfo.mainBytes - reclaimableBytes) : 0;

  // 某张表里是否存在「早于 N 天」的数据：据此禁用无意义的清理按钮，避免误点
  const hasDataOlderThan = useCallback((days: number) => {
    if (!storage) return false;
    const cutoff = Date.now() - days * 86400000;
    return storage.monitor.tables.some((item) => item.oldestMs !== null && item.oldestMs < cutoff);
  }, [storage]);

  const canPruneRetention = storage
    ? storage.monitor.tables.some(
      (item) => item.retentionDays !== null && item.oldestMs !== null
        && item.oldestMs < Date.now() - item.retentionDays * 86400000
    )
    : false;

  const pendingText = (() => {
    if (!pendingAction) return '';
    if (pendingAction.mode === 'vacuum') {
      return `将先按保留期清理，再重建数据库文件，把 ${formatBytes(reclaimableBytes)} 空闲碎片归还磁盘（预计缩到 ${formatBytes(projectedMainBytes)}）。重建期间接口会短暂阻塞，不要中途停止服务。`;
    }
    if (pendingAction.mode === 'days') {
      return `将永久删除 ${pendingAction.days} 天之前的全部监测数据（含尚未到保留期的部分），删除后无法恢复。`;
    }
    return `将删除超出保留期的监测数据：原始样本与汇总保留 ${policy?.retentionDays ?? 200} 天，分钟明细保留 ${policy?.minuteRetentionDays ?? 35} 天。`;
  })();

  return (
    <div className="space-y-5">
      {/* 控制条 */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 text-white shadow-md shadow-blue-200`}>
              <Activity size={20} />
            </div>
            <div>
              <div className="text-sm font-bold text-gray-800">系统运行状态</div>
              <div className="text-[11px] text-gray-400">
                {collectAgeText} · 每 30 秒心跳采样 · 每 20 秒落盘流量
              </div>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1">
            {PRESETS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setPreset(item.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  preset === item.key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 transition ${preset === 'day' ? 'border-blue-300 bg-blue-50/60' : 'border-gray-200 bg-white'}`}>
            <CalendarDays size={14} className={preset === 'day' ? 'text-blue-600' : 'text-gray-400'} />
            <input
              type="date"
              value={day}
              max={toDayInputValue(new Date())}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) return;
                setDay(value);
                setPreset('day');
              }}
              className="w-[124px] border-0 bg-transparent text-xs font-bold text-gray-700 outline-none"
            />
          </div>

          <button
            type="button"
            onClick={() => { void fetchOverview(); void fetchLive(); void fetchStorage(true); }}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 transition hover:border-blue-300 hover:text-blue-600 disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            刷新
          </button>

          <button
            type="button"
            onClick={() => setAutoRefresh((prev) => !prev)}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition ${
              autoRefresh ? 'bg-blue-50 text-blue-600 ring-1 ring-blue-100' : 'bg-gray-50 text-gray-400 ring-1 ring-gray-200'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${autoRefresh ? 'animate-pulse bg-blue-500' : 'bg-gray-300'}`} />
            {autoRefresh ? '自动刷新 30s' : '自动刷新已关'}
          </button>

          <button
            type="button"
            onClick={() => setIgnoreHotReload((prev) => !prev)}
            title="nodemon 因代码变更重启不是故障：开启后这类记录不计入可用率与断开次数"
            className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition ${
              ignoreHotReload ? 'bg-sky-50 text-sky-600 ring-1 ring-sky-100' : 'bg-white text-gray-500 ring-1 ring-gray-200 hover:text-gray-700'
            }`}
          >
            <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border ${ignoreHotReload ? 'border-sky-500 bg-sky-500 text-white' : 'border-gray-300 bg-white'}`}>
              {ignoreHotReload && <CheckCircle2 size={10} />}
            </span>
            排除代码热重载{data ? `（${data.availability.hotReloadCount}）` : ''}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-gray-50 pt-2.5 text-[11px] text-gray-400">
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${liveOnline ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            {live ? (
              <>
                后端心跳 <span className={`font-bold ${liveOnline ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {live.sampleAgeSec === null ? '未知' : live.sampleAgeSec <= 60 ? '正常' : `${live.sampleAgeSec} 秒前`}
                </span>
              </>
            ) : '等待实时状态'}
          </span>
          {live && (
            <>
              <span>进程运行 <span className="font-bold text-gray-600">{formatDuration(live.uptimeSec, { compact: true })}</span></span>
              <span>内存 <span className="font-bold text-gray-600">{live.rssMb.toFixed(0)} MB</span></span>
              <span>事件循环 <span className="font-bold text-gray-600">{live.lagMs.toFixed(1)} ms</span></span>
              <span>在线前端 <span className="font-bold text-gray-600">{live.socketCount}</span></span>
              <span>近 1 分钟请求 <span className="font-bold text-gray-600">{formatNumber(live.requestsLastMinute)}</span></span>
            </>
          )}
          {lastUpdatedAt && <span className="ml-auto">更新于 {format(new Date(lastUpdatedAt), 'HH:mm:ss')}</span>}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-[104px] animate-pulse rounded-xl border border-gray-100 bg-white" />
          ))}
        </div>
      )}

      {data && (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard
              icon={<Gauge size={16} />}
              label="系统可用率"
              value={availability?.ratio === null || availability?.ratio === undefined ? '—' : (availability.ratio * 100).toFixed(2)}
              unit="%"
              tone={upRatioTone as any}
              badge={<span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[9px] font-bold text-gray-400 ring-1 ring-gray-100">覆盖 {formatDurationMs(data.collection.coverageMs)}</span>}
              hint={availability?.ratio === null ? '该区间无采集数据' : `中断累计 ${formatDurationMs(availability?.downtimeMs)}`}
            />
            <KpiCard
              icon={<Timer size={16} />}
              label="当前连续运行"
              value={formatDuration(live?.uptimeSec ?? availability?.currentUptimeSec ?? 0, { compact: true })}
              tone="emerald"
              hint={`启动于 ${formatTime(live?.bootedAtMs ?? availability?.bootedAtMs ?? Date.now(), 'MM-dd HH:mm')}`}
            />
            <KpiCard
              icon={<Wifi size={16} />}
              label="断开次数"
              value={formatNumber(availability?.disconnectCount)}
              unit="次"
              tone={availability?.disconnectCount ? 'rose' : 'emerald'}
              badge={availability?.hotReloadCount ? (
                <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[9px] font-bold text-sky-600 ring-1 ring-sky-100">
                  热重载 {availability.hotReloadCount}
                </span>
              ) : undefined}
              hint={availability?.longestDowntimeMs
                ? `最长中断 ${formatDurationMs(availability.longestDowntimeMs)}`
                : (availability?.hotReloadCount && availability.ignoreHotReload ? '已排除代码热重载' : '区间内无中断')}
            />
            <KpiCard
              icon={<Zap size={16} />}
              label="平均无故障时长"
              value={availability?.avgStableMs ? formatDurationMs(availability.avgStableMs) : '—'}
              tone="blue"
              hint={availability?.longestStableMs ? `最长稳定 ${formatDurationMs(availability.longestStableMs)}` : '暂无重启记录'}
            />
            <KpiCard
              icon={<TrendingUp size={16} />}
              label="接口请求量"
              value={formatNumber(traffic?.totals.requests)}
              unit="次"
              tone="violet"
              hint={traffic?.totals.peakAtMs
                ? `峰值 ${formatNumber(traffic.totals.peakRequests)}/${traffic.granularity === 'hour' ? '小时' : '天'} · ${format(new Date(traffic.totals.peakAtMs), 'MM-dd HH:mm')}`
                : '暂无流量'}
            />
            <KpiCard
              icon={<Cpu size={16} />}
              label="平均响应 / 错误率"
              value={`${traffic?.totals.avgMs ?? 0}`}
              unit="ms"
              tone={(traffic?.totals.errorRate || 0) > 0.02 ? 'rose' : 'slate'}
              badge={<span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1 ${(traffic?.totals.errorRate || 0) > 0.02 ? 'bg-rose-50 text-rose-600 ring-rose-100' : 'bg-emerald-50 text-emerald-600 ring-emerald-100'}`}>{formatPercent(traffic?.totals.errorRate, 2)}</span>}
              hint={`慢请求(≥1.5s) ${formatNumber(traffic?.totals.slow)} 次`}
            />
          </div>

          {/* 可用性时间轴 */}
          <SectionCard
            title={<><Activity size={16} className="text-blue-600" />可用性时间轴</>}
            subtitle={`${format(new Date(data.range.startMs), 'yyyy-MM-dd HH:mm')} → ${format(new Date(data.range.endMs), 'yyyy-MM-dd HH:mm')} · ${data.range.granularity === 'hour' ? '按小时' : '按天'}切分`}
            right={
              <div className="flex items-center gap-3 text-[10px] text-gray-400">
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" />正常</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-rose-500" />中断</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" />部分中断</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-gray-200" />未采集</span>
              </div>
            }
          >
            {data.timeline.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-300">该区间暂无采集数据</div>
            ) : (
              <>
                <div className="flex h-4 w-full gap-[1px] overflow-hidden rounded-md">
                  {data.timeline.map((segment) => {
                    const color = segment.state === 'up'
                      ? 'bg-emerald-400 hover:bg-emerald-500'
                      : segment.state === 'down'
                        ? 'bg-rose-500 hover:bg-rose-600'
                        : segment.state === 'partial'
                          ? 'bg-amber-400 hover:bg-amber-500'
                          : 'bg-gray-200';
                    return (
                      <div
                        key={segment.startMs}
                        className={`h-full transition ${color}`}
                        style={{ flexGrow: Math.max(1, segment.endMs - segment.startMs) }}
                        title={`${format(new Date(segment.startMs), 'MM-dd HH:mm')} - ${format(new Date(segment.endMs), 'MM-dd HH:mm')}｜${segment.state === 'up' ? '正常' : segment.state === 'down' ? '中断' : segment.state === 'partial' ? '部分中断' : '未采集'}${segment.downSec ? `｜中断 ${formatDuration(segment.downSec, { compact: true })}` : ''}`}
                      />
                    );
                  })}
                </div>
                <div className="mt-2 flex justify-between text-[10px] text-gray-400">
                  <span>{format(new Date(data.range.startMs), 'MM-dd HH:mm')}</span>
                  <span>{format(new Date((data.range.startMs + data.range.endMs) / 2), 'MM-dd HH:mm')}</span>
                  <span>{format(new Date(data.range.endMs), 'MM-dd HH:mm')}</span>
                </div>
                {!data.collection.hasData && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                    <Info size={13} className="mt-0.5 shrink-0" />
                    <span>状态监测从部署后开始记录，历史区间无法回算；灰色段表示当时尚未开始采集。</span>
                  </div>
                )}
                {collectionStartedAtMs && data.range.startMs < collectionStartedAtMs && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-gray-500">
                    <Info size={13} className="mt-0.5 shrink-0" />
                    <span>
                      本区间前段（{format(new Date(data.range.startMs), 'MM-dd HH:mm')} → {format(new Date(collectionStartedAtMs), 'MM-dd HH:mm')}）发生在采集开始之前，
                      已从可用率统计中剔除，未采集部分不参与计算。
                    </span>
                  </div>
                )}
              </>
            )}
          </SectionCard>

          {/* 流量 */}
          <SectionCard
            title={<><BarChart3 size={16} className="text-blue-600" />前端访问流量</>}
            subtitle={`${data.range.granularity === 'hour' ? '按小时' : '按天'}聚合 · 蓝色=请求量（左轴） · 红色虚线=错误率（右轴）`}
            right={
              <div className="flex items-center gap-4 text-[11px] text-gray-500">
                <span>总量 <b className="text-gray-800 tabular-nums">{formatNumber(traffic?.totals.requests)}</b></span>
                <span>客户端峰值 <b className="text-gray-800 tabular-nums">{formatNumber(traffic?.totals.peakClients)}</b></span>
                <span>慢请求 <b className="text-gray-800 tabular-nums">{formatNumber(traffic?.totals.slow)}</b></span>
              </div>
            }
          >
            <TrafficChart series={traffic?.series || []} granularity={data.range.granularity} />

            {(traffic?.series || []).filter((point) => point.requests > 0).length <= 2 && (traffic?.totals.requests || 0) > 0 && (
              <div className="mt-2 flex items-start gap-2 rounded-lg bg-blue-50/70 px-3 py-2 text-[11px] text-blue-700">
                <Info size={13} className="mt-0.5 shrink-0" />
                <span>当前区间内仅 {traffic?.series.filter((point) => point.requests > 0).length} 个时间桶采集到流量，曲线会随采集时间增长而变得完整。</span>
              </div>
            )}

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-bold text-gray-500">访问最多的接口</span>
                  <span className="text-[10px] text-gray-400">次数 / 平均耗时</span>
                </div>
                {(traffic?.topPaths || []).length === 0 ? (
                  <div className="py-6 text-center text-[11px] text-gray-300">暂无接口访问记录</div>
                ) : (
                  <div className="space-y-1.5">
                    {traffic!.topPaths.slice(0, 8).map((item) => (
                      <div key={`${item.method}-${item.path}`} className="group flex items-center gap-2">
                        <span className={`w-10 shrink-0 rounded text-center text-[9px] font-bold ${
                          item.method === 'GET' ? 'bg-sky-50 text-sky-600'
                            : item.method === 'POST' ? 'bg-emerald-50 text-emerald-600'
                              : item.method === 'PUT' ? 'bg-amber-50 text-amber-600'
                                : 'bg-rose-50 text-rose-600'
                        }`}>{item.method}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-600" title={item.path}>{item.path}</span>
                        <div className="hidden h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-gray-100 sm:block">
                          <div className="h-full rounded-full bg-blue-400" style={{ width: `${Math.max(4, (item.requests / maxPathRequests) * 100)}%` }} />
                        </div>
                        <span className="w-12 shrink-0 text-right text-[11px] font-bold text-gray-700 tabular-nums">{formatNumber(item.requests)}</span>
                        <span className={`w-14 shrink-0 text-right text-[10px] tabular-nums ${item.errors ? 'text-rose-500' : 'text-gray-400'}`}>{item.avgMs} ms</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-bold text-gray-500">请求方法分布</span>
                  <span className="text-[10px] text-gray-400">按次数</span>
                </div>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
                  {(traffic?.methods || []).map((item) => (
                    <div
                      key={item.method}
                      className={`h-full ${
                        item.method === 'GET' ? 'bg-sky-400'
                          : item.method === 'POST' ? 'bg-emerald-400'
                            : item.method === 'PUT' ? 'bg-amber-400'
                              : item.method === 'DELETE' ? 'bg-rose-400' : 'bg-slate-400'
                      }`}
                      style={{ width: `${(item.requests / totalMethodRequests) * 100}%` }}
                      title={`${item.method} ${formatNumber(item.requests)}`}
                    />
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                  {(traffic?.methods || []).map((item) => (
                    <span key={item.method} className="flex items-center gap-1.5 text-[11px] text-gray-500">
                      <span className={`h-2 w-2 rounded-full ${
                        item.method === 'GET' ? 'bg-sky-400'
                          : item.method === 'POST' ? 'bg-emerald-400'
                            : item.method === 'PUT' ? 'bg-amber-400'
                              : item.method === 'DELETE' ? 'bg-rose-400' : 'bg-slate-400'
                      }`} />
                      {item.method}
                      <b className="text-gray-700 tabular-nums">{formatNumber(item.requests)}</b>
                      <span className="text-gray-300">{((item.requests / totalMethodRequests) * 100).toFixed(0)}%</span>
                    </span>
                  ))}
                  {(traffic?.methods || []).length === 0 && <span className="text-[11px] text-gray-300">暂无数据</span>}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <div className="text-[10px] text-gray-400">同时在线客户端（峰值）</div>
                    <div className="text-sm font-bold text-gray-700 tabular-nums">{formatNumber(traffic?.totals.peakClients)}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <div className="text-[10px] text-gray-400">Socket 连接（实时）</div>
                    <div className="text-sm font-bold text-gray-700 tabular-nums">{formatNumber(live?.socketCount)}</div>
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* 资源 */}
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard
              title={<><HardDrive size={16} className="text-violet-600" />内存占用趋势</>}
              subtitle={`峰值 ${resources?.summary.peakRssMb ?? 0} MB · 采样含 RSS 与堆内存`}
            >
              <MiniAreaChart points={trafficPoints} granularity={data.range.granularity} color="#8b5cf6" gradientId="rssGradient" unit=" MB" />
            </SectionCard>
            <SectionCard
              title={<><Cpu size={16} className="text-amber-600" />事件循环延迟</>}
              subtitle={`峰值 ${resources?.summary.peakLagMs ?? 0} ms · 均值 ${resources?.summary.avgLagMs ?? 0} ms · 持续偏高通常意味着长任务阻塞`}
            >
              <MiniAreaChart points={lagPoints} granularity={data.range.granularity} color="#f59e0b" gradientId="lagGradient" unit=" ms" threshold={50} />
            </SectionCard>
          </div>

          {/* 断开事件 */}
          <SectionCard
            title={<><AlertTriangle size={16} className={data.disconnects.some((item) => item.cause.code !== 'hot_reload') ? 'text-rose-600' : 'text-sky-600'} />后端断开记录</>}
            subtitle={
              data.availability.ignoreHotReload && data.availability.hotReloadCount
                ? `已隐藏 ${data.availability.hotReloadCount} 次代码热重载；关闭顶部「排除代码热重载」可查看全部`
                : '断开时间取最后一次心跳（精度 ±30 秒）；有正常停止记录时精确到事件时刻'
            }
            right={
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ${
                data.disconnects.length ? 'bg-rose-50 text-rose-600 ring-rose-100' : 'bg-emerald-50 text-emerald-600 ring-emerald-100'
              }`}>
                {data.disconnects.length ? `${data.disconnects.length} 次中断` : '区间内无中断'}
              </span>
            }
          >
            {data.disconnects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <CheckCircle2 size={30} className="mb-2 text-emerald-400" />
                <div className="text-sm font-bold text-gray-600">该时间段后端服务持续可用</div>
                <div className="mt-1 text-[11px] text-gray-400">
                  {data.collection.hasData ? `已连续稳定运行 ${formatDuration(availability?.longestStableMs ? availability.longestStableMs / 1000 : availability?.currentUptimeSec)}` : '采集尚未开始，暂无判据'}
                </div>
                {data.availability.ignoreHotReload && data.availability.hotReloadCount > 0 && (
                  <div className="mt-2 rounded-lg bg-sky-50 px-3 py-1.5 text-[10.5px] text-sky-700">
                    另有 {data.availability.hotReloadCount} 次代码热重载（nodemon 重启，不是故障）已被隐藏
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="rounded-lg bg-slate-50 px-3 py-1.5 text-[10px] text-gray-400">
                  按时间倒序（最新在上），列表内滚动查看，最多显示最近 60 次
                </div>
                <div className="max-h-[380px] space-y-2.5 overflow-y-auto rounded-xl border border-gray-100 bg-slate-50/50 p-2.5">
                  {[...data.disconnects].reverse().map((item, index) => {
                  const critical = item.cause.severity === 'critical';
                  const isReload = item.cause.code === 'hot_reload';
                  return (
                    <div
                      key={`${item.startAtMs}-${index}`}
                      className={`overflow-hidden rounded-xl border bg-white transition hover:shadow-sm ${
                        isReload
                          ? 'border-sky-100'
                          : critical ? 'border-rose-100' : item.cause.severity === 'warning' ? 'border-amber-100' : 'border-gray-100'
                      }`}
                    >
                      <div className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                          isReload
                            ? 'bg-sky-50 text-sky-500'
                            : critical ? 'bg-rose-50 text-rose-500' : item.cause.severity === 'warning' ? 'bg-amber-50 text-amber-500' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {isReload ? <RefreshCw size={16} /> : item.kind === 'restart' ? <Server size={17} /> : <AlertTriangle size={17} />}
                        </div>

                        <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
                          <div>
                            <div className="text-[10px] text-gray-400">断开时刻</div>
                            <div className="text-[12px] font-bold text-gray-700 tabular-nums">{formatTime(item.startAtMs)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-gray-400">恢复时刻</div>
                            <div className="text-[12px] font-bold text-gray-700 tabular-nums">{formatTime(item.endAtMs)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-gray-400">持续时长</div>
                            <div className={`text-[12px] font-black tabular-nums ${isReload ? 'text-sky-600' : 'text-rose-600'}`}>{formatDuration(item.durationSec, { compact: true })}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-gray-400">断开前已稳定运行</div>
                            <div className="text-[12px] font-bold text-emerald-600 tabular-nums">
                              {item.stableBeforeSec === null ? '不可追溯' : formatDuration(item.stableBeforeSec, { compact: true })}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-start gap-2 border-t border-gray-50 bg-slate-50/60 px-3.5 py-2.5">
                        <span className="flex items-center gap-1.5 text-[11px] font-bold text-gray-700">
                          <span className={`h-1.5 w-1.5 rounded-full ${isReload ? 'bg-sky-500' : critical ? 'bg-rose-500' : item.cause.severity === 'warning' ? 'bg-amber-500' : 'bg-gray-400'}`} />
                          可能原因：{item.cause.label}
                        </span>
                        <ConfidenceBadge confidence={item.cause.confidence} />
                        {isReload && (
                          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-600 ring-1 ring-sky-100">非故障</span>
                        )}
                        {item.precision === 'sample' && (
                          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-gray-400 ring-1 ring-gray-100">时间±30秒</span>
                        )}
                        <div
                          className="mt-1 w-full text-[10.5px] leading-relaxed text-gray-500 line-clamp-2"
                          title={item.cause.evidence.join('\n')}
                        >
                          {item.cause.evidence.join(' · ')}
                        </div>
                      </div>
                    </div>
                  );
                  })}
                </div>
              </div>
            )}
          </SectionCard>

          {/* 热力图 */}
          <SectionCard
            title={<><Clock size={16} className="text-blue-600" />访问时段热力（周一至周日 × 24 小时）</>}
            subtitle="颜色越深代表该时段累计请求越多，可用于判断系统使用高峰与排班"
            right={
              <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                <span>少</span>
                {[0.1, 0.3, 0.5, 0.7, 0.95].map((alpha) => (
                  <span key={alpha} className="h-3 w-5 rounded-[2px]" style={{ backgroundColor: `rgba(37, 99, 235, ${alpha})` }} />
                ))}
                <span>多</span>
              </div>
            }
          >
            {data.heatmap.max === 0 ? (
              <div className="py-10 text-center text-xs text-gray-300">暂无足够流量数据</div>
            ) : (
              <div className="space-y-[2px]">
                {/* 小时刻度：与格子同列，随容器拉伸对齐 */}
                <div className="grid grid-cols-[34px_repeat(24,minmax(0,1fr))_46px] gap-[3px] pb-0.5">
                  <div />
                  {Array.from({ length: 24 }).map((_, hour) => (
                    <div key={hour} className="text-center text-[9px] leading-4 text-gray-400">
                      {hour % 2 === 0 ? hour : ''}
                    </div>
                  ))}
                  <div className="text-center text-[9px] leading-4 text-gray-400">合计</div>
                </div>
                {['一', '二', '三', '四', '五', '六', '日'].map((label, weekday) => {
                  const rowTotal = data.heatmap.matrix[weekday].reduce((sum, value) => sum + value, 0);
                  return (
                    <div key={label} className="grid grid-cols-[34px_repeat(24,minmax(0,1fr))_46px] items-center gap-[3px]">
                      <div className="pr-1 text-right text-[10px] font-bold text-gray-500">周{label}</div>
                      {data.heatmap.matrix[weekday].map((value, hour) => {
                        const ratio = data.heatmap.max ? value / data.heatmap.max : 0;
                        return (
                          <div
                            key={hour}
                            className="h-5 rounded-[3px] transition hover:ring-2 hover:ring-blue-400"
                            style={{
                              backgroundColor: value === 0
                                ? '#f1f5f9'
                                : `rgba(37, 99, 235, ${(0.12 + ratio * 0.84).toFixed(2)})`
                            }}
                            title={`周${label} ${pad(hour)}:00-${pad((hour + 1) % 24)}:00｜${formatNumber(value)} 次请求`}
                          />
                        );
                      })}
                      <div className="text-center text-[9px] text-gray-400 tabular-nums">{rowTotal > 0 ? formatCompact(rowTotal) : '—'}</div>
                    </div>
                  );
                })}
                {/* 每小时合计：一眼看出全天高峰时段 */}
                <div className="mt-1 grid grid-cols-[34px_repeat(24,minmax(0,1fr))_46px] items-center gap-[3px] border-t border-gray-100 pt-1.5">
                  <div className="pr-1 text-right text-[9px] font-bold text-gray-400">合计</div>
                  {Array.from({ length: 24 }).map((_, hour) => {
                    const columnTotal = data.heatmap.matrix.reduce((sum, row) => sum + (row[hour] || 0), 0);
                    return (
                      <div
                        key={hour}
                        className="text-center text-[8px] text-gray-400 tabular-nums"
                        title={`${pad(hour)}:00-${pad((hour + 1) % 24)}:00 合计 ${formatNumber(columnTotal)} 次`}
                      >
                        {columnTotal > 0 ? formatCompact(columnTotal) : ''}
                      </div>
                    );
                  })}
                  <div className="text-center text-[9px] font-bold text-gray-500 tabular-nums">
                    {formatCompact(data.heatmap.total ?? 0)}
                  </div>
                </div>
              </div>
            )}
          </SectionCard>

          {/* 进程生命周期 */}
          <SectionCard
            title={<><ArrowDownRight size={16} className="text-slate-500" />进程生命周期</>}
            subtitle="启动 / 正常停止 / 热重载 / 退出码，最近 60 条（列表内滚动）"
            right={
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                {data.events.length} 条
              </span>
            }
          >
            {data.events.length === 0 ? (
              <div className="py-10 text-center text-xs text-gray-300">该区间无生命周期事件</div>
            ) : (
              <div className="max-h-[340px] overflow-y-auto rounded-xl border border-gray-100">
                <table className="w-full border-collapse text-left">
                  <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
                    <tr className="text-[10px] font-bold text-gray-500">
                      <th className="px-3 py-2">时间</th>
                      <th className="px-3 py-2">事件</th>
                      <th className="px-3 py-2">PID</th>
                      <th className="px-3 py-2">运行时长</th>
                      <th className="px-3 py-2">内存</th>
                      <th className="px-3 py-2">说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.events.map((event, index) => {
                      const isBoot = event.type === 'boot';
                      const isStop = event.type === 'graceful_stop';
                      const signal = String(event.detail?.signal || '');
                      const isSigusr2 = signal.toUpperCase().includes('SIGUSR2');
                      // 由 nodemon 拉起且「几秒内就重启」→ 这次启动本身就是一次代码热重载。
                      // 冷启动（start.bat 也走 nodemon）间隔很长，不能算热重载。
                      const gapSec = event.detail?.uptimeBeforeBootSec;
                      const isReload = isSigusr2
                        || (isBoot
                          && Boolean(event.detail?.nodemonBoot)
                          && typeof gapSec === 'number'
                          && gapSec <= 300);
                      const code = event.detail?.code;
                      // 启动事件本身没有运行时长/内存，展示上一轮被替换进程的最终值
                      const uptimeSec = isBoot ? event.detail?.previousUptimeSec : event.detail?.uptimeSec;
                      const rssMb = isBoot ? event.detail?.previousRssMb : event.detail?.rssMb;
                      const tone = isBoot && !isReload
                        ? 'bg-emerald-50 text-emerald-600 ring-emerald-100'
                        : isReload
                          ? 'bg-sky-50 text-sky-600 ring-sky-100'
                          : isStop
                            ? 'bg-slate-100 text-slate-500 ring-slate-200'
                            : Number(code) === 0
                              ? 'bg-slate-100 text-slate-500 ring-slate-200'
                              : 'bg-rose-50 text-rose-600 ring-rose-100';
                      const eventLabel = isReload ? '代码热重载' : isBoot ? '服务启动' : isStop ? '正常停止' : '进程退出';
                      const note = isBoot
                        ? [
                          event.detail?.launcher ? `启动方式 ${event.detail.launcher}` : '',
                          event.detail?.node ? `Node ${event.detail.node}` : '',
                          isReload && typeof event.detail?.uptimeBeforeBootSec === 'number'
                            ? `上轮中断约 ${formatDuration(event.detail.uptimeBeforeBootSec, { compact: true })}`
                            : '',
                          event.detail?.previousStopSignal ? `上轮结束于 ${event.detail.previousStopSignal}` : ''
                        ].filter(Boolean).join(' · ')
                        : [
                          isStop && event.detail?.label ? event.detail.label : '',
                          !isStop && code !== undefined ? `退出码 ${code}` : '',
                          typeof event.detail?.handles === 'number' ? `句柄 ${event.detail.handles}` : ''
                        ].filter(Boolean).join(' · ');

                      return (
                        <tr key={`${event.tsMs}-${index}`} className="border-t border-gray-50 text-[11px] text-gray-600 hover:bg-slate-50/70">
                          <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[10.5px] tabular-nums text-gray-500">
                            {format(new Date(event.tsMs), 'MM-dd HH:mm:ss')}
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${tone}`}>{eventLabel}</span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[10px] text-gray-400 tabular-nums">
                            {event.detail?.pid ?? '—'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                            {typeof uptimeSec === 'number' && uptimeSec > 0 ? (
                              <>
                                {isBoot && <span className="mr-1 text-[9px] text-gray-300">上轮</span>}
                                {formatDuration(uptimeSec, { compact: true })}
                              </>
                            ) : '—'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-gray-500">
                            {typeof rssMb === 'number' && rssMb > 0 ? `${Math.round(rssMb)} MB` : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-[10.5px] text-gray-400">
                            <span className="line-clamp-2">{note || '—'}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* 存储占用与清理 */}
          <SectionCard
            title={<><Database size={16} className="text-indigo-600" />存储占用与清理</>}
            subtitle={`监测数据与业务数据同库（${dbInfo?.fileName || 'data.db'}）：SQLite 删除只把页标记为空闲，必须「压缩数据库」才会真正缩小文件`}
            right={
              reclaimableBytes > 0 ? (
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-600 ring-1 ring-amber-100">
                  可回收 {formatBytes(reclaimableBytes)}
                </span>
              ) : (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-600 ring-1 ring-emerald-100">
                  无碎片
                </span>
              )
            }
          >
            {!storage ? (
              <div className="py-10 text-center text-xs text-gray-300">正在读取存储信息…</div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  {/* 数据库文件 */}
                  <div className="rounded-xl border border-gray-100 bg-slate-50/70 p-3">
                    <div className="text-[10px] font-bold text-gray-400">数据库文件总占用</div>
                    <div className="mt-0.5 text-xl font-black text-gray-800 tabular-nums">
                      {formatBytes(storage.db.totalBytes)}
                    </div>
                    <div className="mt-2 space-y-0.5 text-[10px] text-gray-500">
                      <div className="flex justify-between">
                        <span>主文件</span><span className="tabular-nums">{formatBytes(storage.db.mainBytes)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>WAL 日志</span><span className="tabular-nums">{formatBytes(storage.db.walBytes)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>空闲页（碎片）</span>
                        <span className={`tabular-nums ${reclaimableBytes > 0 ? 'font-bold text-amber-600' : 'text-emerald-600'}`}>
                          {formatBytes(reclaimableBytes)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 监测数据 */}
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
                    <div className="text-[10px] font-bold text-indigo-500">监测数据占用</div>
                    <div className="mt-0.5 flex items-baseline gap-1.5">
                      <span className="text-xl font-black text-indigo-700 tabular-nums">
                        {formatBytes(storage.monitor.bytes)}
                      </span>
                      <span className="text-[10px] text-indigo-400">{formatNumber(storage.monitor.rows)} 行</span>
                    </div>
                    <div className="mt-2 space-y-0.5 text-[10px] text-indigo-900/60">
                      <div className="flex justify-between">
                        <span>占整库比例</span>
                        <span className="tabular-nums">
                          {storage.monitor.share === null ? '—' : `${(storage.monitor.share * 100).toFixed(1)}%`}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>日增（实测）</span>
                        <span className="tabular-nums">
                          {storage.estimate.bytesPerDay === null ? '采集不足 1 天' : formatBytes(storage.estimate.bytesPerDay)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>满 {storage.policy.retentionDays} 天预计</span>
                        <span className="tabular-nums">
                          {storage.estimate.projectedFullBytes === null ? '—' : formatBytes(storage.estimate.projectedFullBytes)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 清理策略 */}
                  <div className="rounded-xl border border-gray-100 bg-white p-3">
                    <div className="text-[10px] font-bold text-gray-400">自动清理策略</div>
                    <div className="mt-0.5 flex items-baseline gap-1.5">
                      <span className="text-xl font-black text-gray-800 tabular-nums">每 {storage.policy.cleanupIntervalHours} 小时</span>
                    </div>
                    <div className="mt-2 space-y-0.5 text-[10px] text-gray-500">
                      <div className="flex justify-between">
                        <span>趋势数据保留</span>
                        <span className="font-bold text-gray-600 tabular-nums">{storage.policy.retentionDays} 天</span>
                      </div>
                      <div className="flex justify-between">
                        <span>分钟明细保留</span>
                        <span className="tabular-nums">{storage.policy.minuteRetentionDays} 天</span>
                      </div>
                      <div className="flex justify-between">
                        <span>上次清理</span>
                        <span className="tabular-nums">
                          {storage.policy.lastCleanupAtMs ? formatTime(storage.policy.lastCleanupAtMs, 'MM-dd HH:mm:ss') : '尚未执行'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>累计清理</span>
                        <span className="tabular-nums">
                          {storage.policy.cleanupCount} 次 / {formatNumber(storage.policy.totalDeleted)} 行
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 表清单 */}
                <div className="overflow-hidden rounded-xl border border-gray-100">
                  <table className="w-full border-collapse text-left">
                    <thead className="bg-slate-50/90 text-[10px] font-bold text-gray-500">
                      <tr>
                        <th className="px-3 py-2">表 / 用途</th>
                        <th className="px-3 py-2 text-right">行数</th>
                        <th className="px-3 py-2 text-right">占用</th>
                        <th className="px-3 py-2">占比</th>
                        <th className="px-3 py-2 whitespace-nowrap">保留</th>
                        <th className="px-3 py-2 whitespace-nowrap">最早数据</th>
                      </tr>
                    </thead>
                    <tbody>
                      {storage.monitor.tables.map((item) => {
                        const share = item.bytes !== null && storage.monitor.bytes
                          ? item.bytes / storage.monitor.bytes
                          : null;
                        return (
                          <tr key={item.key} className="border-t border-gray-50 text-[11px] text-gray-600">
                            <td className="px-3 py-1.5">
                              <div className="font-bold text-gray-700">{item.label}</div>
                              <div className="text-[10px] text-gray-400">{item.note}</div>
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(item.rows)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{formatBytes(item.bytes)}</td>
                            <td className="px-3 py-1.5">
                              <div className="flex items-center gap-1.5">
                                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
                                  <div
                                    className="h-full rounded-full bg-indigo-400"
                                    style={{ width: `${Math.min(100, Math.round((share ?? 0) * 100))}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-gray-400 tabular-nums">
                                  {share === null ? '—' : `${(share * 100).toFixed(0)}%`}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-1.5 whitespace-nowrap text-[10px] text-gray-500">
                              {item.retentionDays === null ? '长期' : `${item.retentionDays} 天`}
                            </td>
                            <td className="px-3 py-1.5 whitespace-nowrap text-[10px] text-gray-400 tabular-nums">
                              {item.oldestMs ? formatTime(item.oldestMs, 'yyyy-MM-dd') : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* 保留期口径说明：避免把「明细 35 天」误解成「近半年看不到数据」 */}
                <div className="flex items-start gap-1.5 rounded-lg bg-slate-50/70 px-3 py-2 text-[10px] leading-relaxed text-gray-500">
                  <Info size={11} className="mt-0.5 shrink-0 text-gray-400" />
                  <span>
                    趋势数据保留 <span className="font-bold text-gray-600">{storage.policy.retentionDays} 天</span>，已覆盖「近半年」（180 天）查询；
                    <span className="font-bold text-gray-600">{storage.policy.minuteRetentionDays} 天</span>只限制
                    <span className="font-bold text-gray-600"> 分钟级明细</span>，它仅用于顶部「近 1 分钟请求」和断开原因里的 5xx 取证（过期后自动退回小时汇总）。
                    趋势图、资源曲线、热力图、可用性时间轴与断开记录分别读小时汇总表和事件表，因此近半年数据仍然完整。
                  </span>
                </div>

                {/* 操作 */}
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50/70 px-3 py-2.5">
                  {!canPruneRetention && !hasDataOlderThan(7) && reclaimableBytes === 0 && (
                    <span className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-600 ring-1 ring-emerald-100">
                      <CheckCircle2 size={12} />
                      当前无需清理
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={!canPruneRetention || cleanupRunning}
                    onClick={() => { setCleanupMessage(null); setPendingAction({ mode: 'retention' }); }}
                    title={canPruneRetention ? '删除超出保留期的监测数据' : '当前没有超出保留期的数据'}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    按保留期清理
                  </button>
                  <button
                    type="button"
                    disabled={!hasDataOlderThan(30) || cleanupRunning}
                    onClick={() => { setCleanupMessage(null); setPendingAction({ mode: 'days', days: 30 }); }}
                    title={hasDataOlderThan(30) ? '删除 30 天之前的监测数据' : '没有 30 天前的数据'}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-bold text-gray-600 transition hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:border-gray-100 disabled:bg-gray-50 disabled:text-gray-300"
                  >
                    清理 30 天前
                  </button>
                  <button
                    type="button"
                    disabled={!hasDataOlderThan(7) || cleanupRunning}
                    onClick={() => { setCleanupMessage(null); setPendingAction({ mode: 'days', days: 7 }); }}
                    title={hasDataOlderThan(7) ? '删除 7 天之前的监测数据' : '没有 7 天前的数据'}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-bold text-gray-600 transition hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:border-gray-100 disabled:bg-gray-50 disabled:text-gray-300"
                  >
                    清理 7 天前
                  </button>
                  <button
                    type="button"
                    disabled={reclaimableBytes === 0 || cleanupRunning}
                    onClick={() => { setCleanupMessage(null); setPendingAction({ mode: 'vacuum' }); }}
                    title={reclaimableBytes === 0 ? '没有可回收的空闲页' : '重建数据库文件，把空闲页归还磁盘'}
                    className="rounded-lg bg-violet-50 px-3 py-1.5 text-[11px] font-bold text-violet-600 ring-1 ring-violet-100 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-300 disabled:ring-gray-100"
                  >
                    压缩数据库{reclaimableBytes > 0 ? `（回收 ${formatBytes(reclaimableBytes)}）` : ''}
                  </button>
                  <span className="ml-auto text-[10px] text-gray-400">
                    只动监测数据，任务、台账、用户、日志等业务数据不受影响
                  </span>
                </div>

                {/* 二次确认 */}
                {pendingAction && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-bold text-amber-700">
                          {pendingAction.mode === 'vacuum' ? '确认压缩数据库？' : '确认清理监测数据？'}
                        </div>
                        <div className="mt-0.5 text-[10.5px] leading-relaxed text-amber-700/80">
                          {pendingText} 此操作不可恢复。
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => { void runCleanup(); }}
                            disabled={cleanupRunning}
                            className="rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-amber-700 disabled:opacity-60"
                          >
                            {cleanupRunning ? '执行中…' : '确认执行'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingAction(null)}
                            disabled={cleanupRunning}
                            className="rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold text-gray-500 ring-1 ring-gray-200 transition hover:text-gray-700 disabled:opacity-60"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 执行结果 */}
                {cleanupMessage && (
                  <div
                    className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[11px] ${
                      cleanupMessage.tone === 'success'
                        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
                        : 'bg-rose-50 text-rose-700 ring-1 ring-rose-100'
                    }`}
                  >
                    {cleanupMessage.tone === 'success'
                      ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                      : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
                    <span className="leading-relaxed">{cleanupMessage.text}</span>
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          <div className="flex items-start gap-2 rounded-xl bg-white/60 px-4 py-3 text-[11px] leading-relaxed text-gray-400 ring-1 ring-gray-100">
            <Info size={13} className="mt-0.5 shrink-0" />
            <span>
              统计口径：心跳 30 秒一条，样本间超过 90 秒的间隔记为「后端无响应」；每次进程启动都会与上一轮会话的结束记录比对，
              无正常停止记录即判定为异常中断。断开原因仅基于崩溃日志、退出码、内存曲线与 5xx 突增等可核对证据给出，证据不足时标注「待观察」。
              数据保留 200 天，覆盖近半年查询范围。
            </span>
          </div>
        </>
      )}
    </div>
  );
};

export default SystemStatusMonitor;
