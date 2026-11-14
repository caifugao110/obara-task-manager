import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileSearch,
  History,
  Loader2,
  RefreshCw,
  ScanLine,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { axiosInstance } from '../../../services/api';
import { useModalDrag } from '../../../hooks/useModalDrag';

/**
 * 仕样自愈弹窗（仅管理员）
 *
 * 做两件事：
 * 1. 检测：扫描指定月份任务名里的仕样号，逐份解析仕样书，比对「客户名」与「纳期（[M/D]）」，
 *    列出哪些仕样号需要更新、会改动哪些任务。
 * 2. 一键更新：把选中的仕样号涉及的当月任务名按仕样书写回（客户名 + 纳期）。
 *
 * 扫描走服务端 job + 轮询进度：一份仕样书要读共享盘再解析，几十个仕样号必须异步，
 * 同步接口一定会撞上前端超时，而超时会被误判成「后端离线」。
 */

type HealSpecStatus = 'ok' | 'outdated' | 'unresolved';
type HealChangeFlag = 'client' | 'delivery';
type HealFilter = 'all' | 'outdated' | 'ok' | 'unresolved';

interface HealChangeItem {
  itemId: string;
  designerId: string;
  designerName: string;
  date: string;
  taskName: string;
  newTaskName: string;
  changes: HealChangeFlag[];
  currentClient: string;
  currentDelivery: string;
}

interface HealSpecEntry {
  specNumber: string;
  status: HealSpecStatus;
  resolved: boolean;
  expectedClient: string;
  expectedDelivery: string;
  code: string;
  message: string;
  itemCount: number;
  /** 该仕样号涉及的全部任务里出现过的差异类型（客户名 / 纳期） */
  changes: HealChangeFlag[];
  items: HealChangeItem[];
  itemsTruncated: boolean;
}

interface HealSummary {
  specCount: number;
  outdatedSpecs: number;
  okSpecs: number;
  unresolvedSpecs: number;
  outdatedItems: number;
  totalItems: number;
  skippedItems: number;
}

interface HealJob {
  jobId: string;
  year: number;
  month: number;
  status: 'running' | 'completed' | 'failed';
  message: string;
  total: number;
  done: number;
  current: string;
  totalItems: number;
  skippedItems: number;
  summary: HealSummary | null;
  specs: HealSpecEntry[];
  finishedAt?: number | null;
}

/** 一次「一键更新」的历史记录（后端 self_heal_logs 表） */
interface HealLog {
  id: string;
  timestamp: string;
  year: number;
  month: number;
  userId: string | null;
  username: string | null;
  name: string | null;
  specCount: number;
  requestedSpecs: string[];
  updatedSpecs: string[];
  updatedItems: number;
  sheetCount: number;
  durationMs: number | null;
}

interface SpecSelfHealModalProps {
  open: boolean;
  onClose: () => void;
  /** 当前看板正在查看的月份，作为默认检测范围 */
  year: number;
  month: number;
  addToast: (message: string, type: 'success' | 'error') => void;
  /** 更新成功后的刷新回调：重新拉当月任务并广播给其他客户端 */
  onApplied: (info: { updatedItems: number; updatedSpecs: string[] }) => void;
  /** 是否超级管理员：操作记录面板（含入口/列表/接口）只对超级管理员开放 */
  isSuperAdmin?: boolean;
}

const pad2 = (value: number) => String(value).padStart(2, '0');
const monthLabel = (year: number, month: number) => `${year} 年 ${pad2(month)} 月`;

// YYYY-MM-DD → M/D，明细里跟任务名里的纳期写法一致
const shortDate = (date: string) => {
  const parts = String(date || '').split('-');
  if (parts.length < 3) return date || '';
  return `${Number(parts[1])}/${Number(parts[2])}`;
};

const shiftMonth = (year: number, month: number, offset: number) => {
  const base = new Date(year, month - 1 + offset, 1);
  return { year: base.getFullYear(), month: base.getMonth() + 1 };
};

const STATUS_META: Record<HealSpecStatus, { label: string; cls: string; dot: string }> = {
  outdated: {
    label: '需更新',
    cls: 'bg-amber-50 text-amber-700 border-amber-200',
    dot: 'bg-amber-500',
  },
  ok: {
    label: '已最新',
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dot: 'bg-emerald-500',
  },
  unresolved: {
    label: '无法核对',
    cls: 'bg-gray-100 text-gray-500 border-gray-200',
    dot: 'bg-gray-400',
  },
};

const SPEC_FILTERS: Array<{ key: HealFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'outdated', label: '需更新' },
  { key: 'ok', label: '已最新' },
  { key: 'unresolved', label: '无法核对' },
];

const ChangePill: React.FC<{ children: React.ReactNode; tone: 'blue' | 'violet' }> = ({ children, tone }) => (
  <span
    className={`shrink-0 text-[10px] font-bold px-1.5 py-[1px] rounded border ${
      tone === 'blue'
        ? 'bg-sky-50 text-sky-600 border-sky-200'
        : 'bg-violet-50 text-violet-600 border-violet-200'
    }`}
  >
    {children}
  </span>
);

// ISO 时间 → yyyy-MM-dd HH:mm（记录列表里按本地时区展示）
const formatLogTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

// 一条自愈记录：谁、什么时候、对哪个月、改了哪些仕样号、动了多少条任务
const HealLogCard: React.FC<{ log: HealLog }> = ({ log }) => (
  <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
    <div className="flex items-start gap-2.5">
      <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
        <History size={13} className="text-emerald-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] font-bold text-gray-800">{log.name || log.username || '未知操作人'}</span>
          <span className="text-[11px] text-gray-400 tabular-nums">{formatLogTime(log.timestamp)}</span>
          <span className="text-[10px] font-bold px-1.5 py-[1px] rounded border bg-gray-50 text-gray-500 border-gray-200">
            {log.year} 年 {pad2(log.month)} 月
          </span>
        </div>
        <div className="text-[11px] text-gray-600 mt-1 flex items-center gap-1.5 flex-wrap">
          <span>
            更新 <b className="text-gray-800">{log.updatedItems}</b> 条任务
          </span>
          <span className="text-gray-300">·</span>
          <span>
            <b className="text-gray-800">{log.updatedSpecs.length}</b> 个仕样号
          </span>
          {log.sheetCount > 0 && (
            <>
              <span className="text-gray-300">·</span>
              <span>涉及 {log.sheetCount} 张工时表</span>
            </>
          )}
          {log.durationMs !== null && log.durationMs > 0 && (
            <>
              <span className="text-gray-300">·</span>
              <span className="tabular-nums">
                耗时 {log.durationMs >= 1000 ? `${(log.durationMs / 1000).toFixed(1)}s` : `${log.durationMs}ms`}
              </span>
            </>
          )}
        </div>
        {log.updatedSpecs.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {log.updatedSpecs.map(spec => (
              <span
                key={spec}
                className="font-mono text-[10px] px-1.5 py-[1px] rounded bg-gray-100 border border-gray-200 text-gray-600"
              >
                {spec}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  </div>
);

const SpecSelfHealModal: React.FC<SpecSelfHealModalProps> = ({
  open,
  onClose,
  year,
  month,
  addToast,
  onApplied,
  isSuperAdmin = false,
}) => {
  const [scanYear, setScanYear] = useState(year);
  const [scanMonth, setScanMonth] = useState(month);
  const [job, setJob] = useState<HealJob | null>(null);
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<HealFilter>('all');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [appliedResult, setAppliedResult] = useState<{ items: number; specs: number } | null>(null);
  // 历史操作记录（谁在什么时候改了哪个月的哪些仕样号）
  const [logs, setLogs] = useState<HealLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [view, setView] = useState<'result' | 'logs'>('result');

  const pollRef = useRef<number | null>(null);
  const pollingBusyRef = useRef(false);
  // 打开弹窗时用「当前看板月份」重置，之后父级切月不影响弹窗内的选择
  const scopeRef = useRef({ year, month });
  scopeRef.current = { year, month };
  const busy = scanning || applying;
  // 操作记录只给超级管理员看：普通管理员既没有入口，也不会去拉这个接口
  const canViewLogs = isSuperAdmin;

  const { frameRef, dragging, headerProps } = useModalDrag(open);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    pollingBusyRef.current = false;
  }, []);

  const loadLogs = useCallback(async () => {
    if (!canViewLogs) {
      setLogs([]);
      return;
    }
    setLogsLoading(true);
    try {
      const res = await axiosInstance.get('/spec/self-heal/logs', { params: { limit: 30 }, timeout: 15000 });
      setLogs(Array.isArray(res.data?.logs) ? res.data.logs as HealLog[] : []);
    } catch {
      // 记录读不出来不影响主流程：静默降级为空列表
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, [canViewLogs]);

  // 每次打开都是干净的一次操作：清掉上一次的扫描结果与勾选，并拉一次历史记录
  useEffect(() => {
    if (!open) {
      stopPolling();
      return;
    }
    const scope = scopeRef.current;
    setScanYear(scope.year);
    setScanMonth(scope.month);
    setJob(null);
    setScanning(false);
    setApplying(false);
    setError('');
    setSelected(new Set());
    setExpanded(new Set());
    setFilter('all');
    setConfirmOpen(false);
    setAppliedResult(null);
    setView('result');
    void loadLogs();
  }, [open, stopPolling, loadLogs]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // 权限兜底：非超级管理员不可能停在记录视图（防止会话中角色被降级后还留着旧视图）
  useEffect(() => {
    if (!canViewLogs) setView('result');
  }, [canViewLogs]);

  // Esc 关闭：只在「写回任务」进行中禁用，避免用户以为写入被中断；
  // 扫描阶段允许关闭（关掉即停止轮询，服务端 job 自己跑完、30 分钟后过期）
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (applying) return;
      event.stopPropagation();
      if (confirmOpen) {
        setConfirmOpen(false);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, applying, confirmOpen, onClose]);

  const applySelected = useCallback(async (specNumbers: string[]) => {
    if (!job || job.status !== 'completed') return;
    if (specNumbers.length === 0) {
      addToast('请先勾选需要更新的仕样号', 'error');
      return;
    }
    setApplying(true);
    try {
      const res = await axiosInstance.post(
        '/spec/self-heal/apply',
        { jobId: job.jobId, specNumbers },
        { timeout: 90000 },
      );
      const updatedItems = Number(res.data?.updatedItems || 0);
      const updatedSpecs: string[] = Array.isArray(res.data?.updatedSpecs) ? res.data.updatedSpecs : [];
      setAppliedResult({ items: updatedItems, specs: updatedSpecs.length });
      setConfirmOpen(false);

      // 已写回的仕样号在本地直接标记为「已最新」，避免重复点击造成重复统计
      const doneSet = new Set(updatedSpecs.length > 0 ? updatedSpecs : specNumbers);
      setJob(prev => {
        if (!prev) return prev;
        const specs = prev.specs.map(entry => (
          doneSet.has(entry.specNumber)
            ? { ...entry, status: 'ok' as HealSpecStatus, itemCount: 0, items: [], itemsTruncated: false }
            : entry
        ));
        const summary: HealSummary = {
          specCount: specs.length,
          outdatedSpecs: specs.filter(s => s.status === 'outdated').length,
          okSpecs: specs.filter(s => s.status === 'ok').length,
          unresolvedSpecs: specs.filter(s => s.status === 'unresolved').length,
          outdatedItems: specs.reduce((sum, s) => sum + (s.status === 'outdated' ? s.itemCount : 0), 0),
          totalItems: prev.summary?.totalItems ?? prev.totalItems,
          skippedItems: prev.summary?.skippedItems ?? prev.skippedItems,
        };
        return { ...prev, specs, summary };
      });
      setSelected(new Set());

      if (updatedItems > 0) {
        addToast(`仕样自愈完成：已更新 ${updatedItems} 条任务`, 'success');
      } else {
        addToast('所选仕样号已是最新，无需修改', 'success');
      }
      if (updatedItems > 0) {
        onApplied({ updatedItems, updatedSpecs: updatedSpecs.length > 0 ? updatedSpecs : specNumbers });
        // 写回成功后刷新一次历史记录，切到「操作记录」就能看到刚才这次
        void loadLogs();
      }
    } catch (err: any) {
      addToast(err?.response?.data?.message || '更新失败，请稍后重试', 'error');
    } finally {
      setApplying(false);
    }
  }, [job, addToast, onApplied, loadLogs]);

  const startScan = useCallback(async (targetYear: number, targetMonth: number) => {
    stopPolling();
    setScanning(true);
    setApplying(false);
    setError('');
    setJob(null);
    setSelected(new Set());
    setExpanded(new Set());
    setFilter('all');
    setConfirmOpen(false);
    setAppliedResult(null);

    try {
      const res = await axiosInstance.post(
        '/spec/self-heal/scan',
        { year: targetYear, month: targetMonth },
        { timeout: 20000 },
      );
      const first = res.data as HealJob;
      setJob(first);

      pollRef.current = window.setInterval(async () => {
        if (pollingBusyRef.current) return;
        pollingBusyRef.current = true;
        try {
          const snapshotRes = await axiosInstance.get(`/spec/self-heal/scan/${first.jobId}`, { timeout: 15000 });
          const snapshot = snapshotRes.data as HealJob;
          setJob(snapshot);
          if (snapshot.status === 'running') return;

          stopPolling();
          setScanning(false);

          if (snapshot.status === 'completed') {
            const outdated = (snapshot.specs || [])
              .filter(entry => entry.status === 'outdated')
              .map(entry => entry.specNumber);
            setSelected(new Set(outdated));
            if (outdated.length === 0) {
              addToast('本月任务里的客户名与纳期都是最新的', 'success');
            } else {
              addToast(`检测完成：${outdated.length} 个仕样号需要更新`, 'success');
            }
          } else {
            setError(snapshot.message || '检测失败，请稍后重试');
            addToast(snapshot.message || '检测失败', 'error');
          }
        } catch (err: any) {
          stopPolling();
          setScanning(false);
          const message = err?.response?.data?.message || '获取检测进度失败，请重试';
          setError(message);
          addToast(message, 'error');
        } finally {
          pollingBusyRef.current = false;
        }
      }, 700);
    } catch (err: any) {
      setScanning(false);
      const message = err?.response?.data?.message || '无法开始检测，请检查网络后重试';
      setError(message);
      addToast(message, 'error');
    }
  }, [stopPolling, addToast]);

  const specs = job?.specs ?? [];
  const outdatedSpecs = useMemo(() => specs.filter(entry => entry.status === 'outdated'), [specs]);
  const selectedSpecs = useMemo(
    () => outdatedSpecs.filter(entry => selected.has(entry.specNumber)),
    [outdatedSpecs, selected],
  );
  const selectedItemCount = selectedSpecs.reduce((sum, entry) => sum + entry.itemCount, 0);

  const filteredSpecs = useMemo(() => {
    if (filter === 'all') return specs;
    return specs.filter(entry => entry.status === filter);
  }, [specs, filter]);

  const filterCounts = useMemo(() => ({
    all: specs.length,
    outdated: outdatedSpecs.length,
    ok: specs.filter(entry => entry.status === 'ok').length,
    unresolved: specs.filter(entry => entry.status === 'unresolved').length,
  }), [specs, outdatedSpecs]);

  const toggleSpec = (specNumber: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(specNumber)) next.delete(specNumber);
      else next.add(specNumber);
      return next;
    });
  };

  const toggleExpanded = (specNumber: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(specNumber)) next.delete(specNumber);
      else next.add(specNumber);
      return next;
    });
  };

  const selectAllOutdated = () => setSelected(new Set(outdatedSpecs.map(entry => entry.specNumber)));
  const clearSelection = () => setSelected(new Set());

  if (!open) return null;

  const progressTotal = job?.total ?? 0;
  const progressDone = job?.done ?? 0;
  const progressPct = progressTotal > 0
    ? Math.min(100, Math.round((progressDone / progressTotal) * 100))
    : 0;
  const allOutdatedSelected = outdatedSpecs.length > 0 && selectedSpecs.length === outdatedSpecs.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/20"
        onClick={() => { if (!applying) onClose(); }}
      />
      <div
        ref={frameRef}
        style={{ transform: 'translate3d(0px, 0px, 0)' }}
        className="relative bg-white rounded-2xl shadow-2xl w-[900px] max-w-[96vw] h-[640px] max-h-[88vh] flex flex-col overflow-hidden border border-gray-200"
      >
        {/* ===== 头部 ===== */}
        <div
          {...headerProps}
          className={`relative flex items-center justify-between gap-4 px-5 py-3.5 bg-gradient-to-r from-[#1c6638] via-[#217346] to-[#2a8a57] text-white shrink-0 select-none touch-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-white/15 border border-white/25 shrink-0">
              <Activity size={18} />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-base leading-tight flex items-center gap-2">
                仕样自愈
                <span className="text-[10px] font-bold px-1.5 py-[1px] rounded bg-white/20 border border-white/25">仅管理员</span>
              </div>
              <div className="text-[11px] opacity-85 leading-tight mt-0.5 truncate">
                按仕样书校准当月任务的客户名与纳期，支持检测后一键批量更新
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0" data-modal-no-drag>
            {/* 检测范围：月份步进（默认当前看板月份） */}
            <div className="flex items-center gap-0.5 bg-black/15 rounded-lg px-1 py-0.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const next = shiftMonth(scanYear, scanMonth, -1);
                  setScanYear(next.year);
                  setScanMonth(next.month);
                  setJob(null);
                  setError('');
                  setAppliedResult(null);
                }}
                className="p-1 rounded hover:bg-white/20 transition disabled:opacity-40 disabled:cursor-not-allowed"
                title="上一个月"
              >
                <ChevronLeft size={15} />
              </button>
              <span className="px-1.5 text-[12px] font-bold whitespace-nowrap tabular-nums">
                {monthLabel(scanYear, scanMonth)}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const next = shiftMonth(scanYear, scanMonth, 1);
                  setScanYear(next.year);
                  setScanMonth(next.month);
                  setJob(null);
                  setError('');
                  setAppliedResult(null);
                }}
                className="p-1 rounded hover:bg-white/20 transition disabled:opacity-40 disabled:cursor-not-allowed"
                title="下一个月"
              >
                <ChevronRight size={15} />
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={applying}
              className="p-1.5 rounded-full hover:bg-white/20 transition cursor-pointer disabled:opacity-40"
              title={applying ? '正在写回任务，暂不可关闭' : '关闭（Esc）'}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ===== 操作区 / 进度 ===== */}
        <div className="shrink-0 px-5 pt-4 pb-3 border-b border-gray-100 bg-white">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
                <ScanLine size={16} className="text-emerald-600" />
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-gray-800">
                  检测 {monthLabel(scanYear, scanMonth)} 的仕样号
                </div>
                <div className="text-[11px] text-gray-500 truncate">
                  逐个读取仕样书，比对任务名中的客户名与纳期 [M/D]
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => { void startScan(scanYear, scanMonth); }}
              className={`flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-bold text-white shadow-sm transition cursor-pointer disabled:cursor-not-allowed ${
                busy
                  ? 'bg-gray-300'
                  : 'bg-[#217346] hover:bg-[#1b5f3a] hover:shadow'
              }`}
            >
              {scanning
                ? <><Loader2 size={15} className="animate-spin" />检测中…</>
                : job
                  ? <><RefreshCw size={15} />重新检测</>
                  : <><Sparkles size={15} />开始检测</>}
            </button>
          </div>

          {scanning && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
                <span className="flex items-center gap-1.5 truncate">
                  <Loader2 size={11} className="animate-spin text-emerald-600" />
                  正在解析仕样书
                  {job?.current ? <span className="font-mono font-bold text-gray-700">{job.current}</span> : null}
                </span>
                <span className="tabular-nums shrink-0">
                  {progressDone} / {progressTotal || '…'}
                </span>
              </div>
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#217346] to-emerald-400 transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {error && !scanning && (
            <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          )}

          {job?.summary && !scanning && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[
                { label: '本月仕样号', value: job.summary.specCount, tone: 'text-gray-800' },
                { label: '需更新仕样号', value: job.summary.outdatedSpecs, tone: 'text-amber-600' },
                { label: '需更新任务', value: job.summary.outdatedItems, tone: 'text-violet-600' },
                { label: '无法核对', value: job.summary.unresolvedSpecs, tone: 'text-gray-500' },
              ].map(card => (
                <div key={card.label} className="rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2">
                  <div className={`text-[17px] font-black leading-none tabular-nums ${card.tone}`}>{card.value}</div>
                  <div className="text-[10px] text-gray-500 mt-1">{card.label}</div>
                </div>
              ))}
            </div>
          )}

          {appliedResult && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-[12px] text-emerald-700">
              <CheckCircle2 size={14} className="shrink-0" />
              <span>
                已更新 <b>{appliedResult.specs}</b> 个仕样号、<b>{appliedResult.items}</b> 条任务名，
                当前看板已刷新。
              </span>
            </div>
          )}
        </div>

        {/* ===== 结果列表 / 操作记录 ===== */}
        <div className="flex-1 min-h-0 flex flex-col bg-gray-50/60 relative">
          {view === 'logs' && canViewLogs ? (
            <>
              <div className="shrink-0 flex items-center gap-2 px-5 py-2 border-b border-gray-200 bg-white">
                <History size={13} className="text-gray-400" />
                <span className="text-[12px] font-bold text-gray-700">操作记录</span>
                <span className="text-[11px] text-gray-400">最近 30 次「一键更新」</span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { void loadLogs(); }}
                    disabled={logsLoading}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition disabled:opacity-50"
                  >
                    {logsLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    刷新
                  </button>
                  {job && (
                    <button
                      type="button"
                      onClick={() => setView('result')}
                      className="px-2 py-1 rounded-md text-[11px] font-bold text-[#217346] bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition"
                    >
                      返回检测结果
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5">
                {logsLoading && logs.length === 0 ? (
                  <div className="py-10 text-center text-[12px] text-gray-400 flex items-center justify-center gap-2">
                    <Loader2 size={13} className="animate-spin" />正在读取操作记录…
                  </div>
                ) : logs.length === 0 ? (
                  <div className="py-10 text-center text-[12px] text-gray-400">
                    还没有操作记录，执行一次「一键更新」后会在这里留痕
                  </div>
                ) : (
                  logs.map(log => <HealLogCard key={log.id} log={log} />)
                )}
              </div>
            </>
          ) : !job && !scanning ? (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="min-h-[200px] flex flex-col items-center justify-center text-center px-8 py-6">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-3">
                  <Wand2 size={24} className="text-emerald-500" />
                </div>
                <div className="text-sm font-bold text-gray-700">还没有检测结果</div>
                <p className="text-[12px] text-gray-500 mt-1.5 leading-relaxed max-w-[430px]">
                  点击右上角「开始检测」，系统会扫描 {monthLabel(scanYear, scanMonth)} 任务里的仕样号，
                  逐份读取仕样书，找出客户名或纳期与仕样书不一致的任务。
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="shrink-0 flex items-center gap-1.5 px-5 py-2 border-b border-gray-200 bg-white">
                {SPEC_FILTERS.map(tab => {
                  const active = filter === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setFilter(tab.key)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition ${
                        active
                          ? 'bg-[#217346] text-white shadow-sm'
                          : 'text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      {tab.label}
                      <span className={`ml-1 tabular-nums ${active ? 'text-white/80' : 'text-gray-400'}`}>
                        {filterCounts[tab.key]}
                      </span>
                    </button>
                  );
                })}
                <div className="ml-auto flex items-center gap-2 text-[11px] text-gray-400">
                  <FileSearch size={12} />
                  <span>共 {job?.summary?.totalItems ?? 0} 条任务，认不出仕样号 {job?.summary?.skippedItems ?? 0} 条</span>
                  {canViewLogs && (
                    <button
                      type="button"
                      onClick={() => setView('logs')}
                      className="ml-1 flex items-center gap-1 px-2 py-[3px] rounded-md text-[11px] font-bold text-gray-500 bg-gray-50 border border-gray-200 hover:text-[#217346] hover:border-emerald-200 hover:bg-emerald-50 transition"
                      title="查看历次一键更新的操作记录"
                    >
                      <History size={11} />
                      操作记录{logs.length > 0 ? ` ${logs.length}` : ''}
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5">
                {filteredSpecs.length === 0 && (
                  <div className="py-10 text-center text-[12px] text-gray-400">
                    {scanning ? '正在检测…' : '该分类下没有仕样号'}
                  </div>
                )}

                {filteredSpecs.map(entry => {
                  const meta = STATUS_META[entry.status];
                  const checked = selected.has(entry.specNumber);
                  const canSelect = entry.status === 'outdated';
                  const isOpen = expanded.has(entry.specNumber);
                  return (
                    <div
                      key={entry.specNumber}
                      className={`rounded-xl border bg-white transition ${
                        checked ? 'border-amber-300 shadow-sm ring-1 ring-amber-100' : 'border-gray-200'
                      }`}
                    >
                      <div className="flex items-center gap-3 px-3 py-2.5">
                        <button
                          type="button"
                          disabled={!canSelect}
                          onClick={() => toggleSpec(entry.specNumber)}
                          title={canSelect ? '勾选后参与本次更新' : '该仕样号无需更新'}
                          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition ${
                            checked
                              ? 'bg-[#217346] border-[#217346] text-white'
                              : canSelect
                                ? 'border-gray-300 bg-white hover:border-emerald-400'
                                : 'border-gray-200 bg-gray-100 cursor-not-allowed'
                          }`}
                        >
                          {checked && <Check size={11} strokeWidth={3} />}
                        </button>

                        <span className="font-mono text-[13px] font-bold text-gray-800 shrink-0">
                          {entry.specNumber}
                        </span>

                        <span className={`shrink-0 flex items-center gap-1 text-[10px] font-bold px-1.5 py-[1px] rounded border ${meta.cls}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>

                        <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                          {entry.status === 'outdated' && (
                            <>
                              {entry.changes.includes('client') && <ChangePill tone="blue">客户名</ChangePill>}
                              {entry.changes.includes('delivery') && <ChangePill tone="violet">纳期</ChangePill>}
                              <span className="text-[11px] text-gray-500">
                                {entry.itemCount} 条任务待改写
                              </span>
                            </>
                          )}
                          {entry.status === 'ok' && (
                            <span className="text-[11px] text-gray-400 truncate">
                              {entry.expectedClient || '无客户名'} {entry.expectedDelivery}
                            </span>
                          )}
                          {entry.status === 'unresolved' && (
                            <span className="text-[11px] text-gray-400 truncate">{entry.message}</span>
                          )}
                        </div>

                        {entry.status === 'outdated' && (
                          <button
                            type="button"
                            onClick={() => toggleExpanded(entry.specNumber)}
                            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition"
                            title="查看将要改写的任务"
                          >
                            {entry.items.length} 条明细
                            <ChevronDown
                              size={13}
                              className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
                            />
                          </button>
                        )}
                      </div>

                      {entry.status === 'outdated' && isOpen && (
                        <div className="border-t border-gray-100 divide-y divide-gray-100">
                          {entry.items.map(item => (
                            <div key={item.itemId} className="px-3 py-2 bg-gray-50/60">
                              <div className="flex items-center gap-2 mb-1 text-[11px]">
                                <span className="font-bold text-gray-700">{item.designerName || '未知设计员'}</span>
                                <span className="text-gray-400 tabular-nums">{shortDate(item.date)}</span>
                                {item.changes.includes('client') && <ChangePill tone="blue">客户名</ChangePill>}
                                {item.changes.includes('delivery') && <ChangePill tone="violet">纳期</ChangePill>}
                              </div>
                              <div className="flex items-start gap-1.5 text-[11px] leading-relaxed">
                                <span className="text-gray-400 line-through break-all">{item.taskName}</span>
                                <ArrowRight size={12} className="mt-[3px] shrink-0 text-gray-400" />
                                <span className="text-emerald-700 font-semibold break-all">{item.newTaskName}</span>
                              </div>
                            </div>
                          ))}
                          {entry.itemsTruncated && (
                            <div className="px-3 py-1.5 text-[11px] text-gray-400 bg-gray-50/60">
                              明细仅显示前 {entry.items.length} 条，更新时会处理全部 {entry.itemCount} 条。
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 列表底部渐隐：提示还有内容可滚动，避免被底栏硬生生切断 */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-gray-50 to-transparent" />
            </>
          )}
        </div>

        {/* ===== 底部操作 ===== */}
        <div className="shrink-0 px-5 py-3 border-t border-gray-200 bg-white flex items-center justify-between gap-3">
          <div className="text-[11px] text-gray-500 flex items-center gap-2 min-w-0">
            {view === 'logs' && canViewLogs ? (
              <span className="flex items-center gap-1.5">
                <History size={12} className="text-gray-400" />
                记录来自历次「一键更新」，点「返回检测结果」可继续处理本次检测
              </span>
            ) : outdatedSpecs.length > 0 ? (
              <>
                <span>
                  已选 <b className="text-gray-800">{selectedSpecs.length}</b> 个仕样号
                </span>
                <span className="text-gray-300">|</span>
                <span>
                  预计改写 <b className="text-gray-800">{selectedItemCount}</b> 条任务
                </span>
                {!allOutdatedSelected && (
                  <button
                    type="button"
                    onClick={selectAllOutdated}
                    className="ml-1 text-[11px] font-bold text-[#217346] hover:underline"
                  >
                    全选本月需更新
                  </button>
                )}
                {selectedSpecs.length > 0 && (
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="text-[11px] text-gray-400 hover:text-gray-600"
                  >
                    清空
                  </button>
                )}
              </>
            ) : (
              <span>{job ? '本月没有需要更新的仕样号' : '检测后再执行更新'}</span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={applying}
              onClick={onClose}
              className="h-9 px-3 rounded-lg text-[12px] font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              关闭
            </button>
            {view === 'result' && (
              <button
                type="button"
                disabled={busy || selectedSpecs.length === 0}
                onClick={() => setConfirmOpen(true)}
                className={`flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-bold text-white shadow-sm transition ${
                  busy || selectedSpecs.length === 0
                    ? 'bg-gray-300 cursor-not-allowed'
                    : 'bg-gradient-to-r from-[#217346] to-[#2a8a57] hover:shadow-md'
                }`}
                title="把选中仕样号的客户名与纳期按仕样书写回任务名"
              >
                {applying ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
                {selectedSpecs.length > 0 && selectedSpecs.length < outdatedSpecs.length
                  ? `更新已选 ${selectedSpecs.length} 个`
                  : '一键更新本月全部'}
              </button>
            )}
          </div>
        </div>

        {/* ===== 更新二次确认 ===== */}
        {confirmOpen && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20">
            <div className="w-[420px] max-w-[90%] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3.5 bg-gradient-to-r from-amber-50 to-white border-b border-amber-100 flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0">
                  <AlertTriangle size={16} className="text-amber-600" />
                </div>
                <div>
                  <div className="text-[13px] font-bold text-gray-800">确认写入仕样书的客户名与纳期？</div>
                  <div className="text-[11px] text-gray-500">任务名会被直接改写并保存到数据库</div>
                </div>
              </div>
              <div className="px-5 py-4 text-[12px] text-gray-600 leading-relaxed">
                将对 <b className="text-amber-700">{selectedSpecs.length}</b> 个仕样号、
                <b className="text-amber-700"> {selectedItemCount} </b>条任务生效，
                尾部任务类型（确认图 / 设计 / 暂停等）保持不变。所有在线用户会同步看到更新结果。
              </div>
              <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={applying}
                  onClick={() => setConfirmOpen(false)}
                  className="h-8 px-3 rounded-lg text-[12px] font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-100 transition disabled:opacity-40"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={applying}
                  onClick={() => { void applySelected(selectedSpecs.map(entry => entry.specNumber)); }}
                  className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-[12px] font-bold text-white bg-[#217346] hover:bg-[#1b5f3a] transition disabled:opacity-50"
                >
                  {applying ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  {applying ? '更新中…' : '确认更新'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SpecSelfHealModal;
