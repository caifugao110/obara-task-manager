import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Table2,
  Wand2,
  X,
} from 'lucide-react';
import { axiosInstance } from '../services/api';
import { MODAL_OVERLAY } from '../utils/modalStyles';

/**
 * 焊枪编号台账 · 仕样自愈（管理员）
 *
 * 与主页面「仕样自愈」同源：读共享盘上的仕样书，用仕样书里的客户名校正数据。
 * 差别只有两点，但决定了整个界面形态：
 * 1. 台账没有纳期，只自愈客户名——比对对象是每行的「客户」列；
 * 2. 台账里累计的仕样号可达几万个，明细必须分页（服务端分页），
 *    进度只拉计数——否则每轮轮询推几 MB JSON，页面会被重渲染拖死。
 *
 * 交互主线：选范围 → 检测（可中途停止）→ 按状态筛选/搜索 → 勾选 → 写回台账。
 */

type HealStatus = 'outdated' | 'ok' | 'unresolved';
type HealFilter = 'all' | 'outdated' | 'ok' | 'unresolved';
type HealJobStatus = 'running' | 'completed' | 'failed' | 'cancelled';
type ScopeType = 'table' | 'category' | 'all';

interface HealRowSample { from: string; count: number }

interface HealSpecEntry {
  specNumber: string;
  status: HealStatus;
  resolved: boolean;
  expectedClient: string;
  code: string;
  message: string;
  /** 待改写的台账行数 */
  itemCount: number;
  /** 该仕样号在台账中出现的行数 */
  rowCount: number;
  distinctCurrent: number;
  samples: HealRowSample[];
  gunNames: string[];
  tableNames: string[];
}

interface HealSummary {
  specCount: number;
  outdatedSpecs: number;
  okSpecs: number;
  unresolvedSpecs: number;
  outdatedItems: number;
  totalSpecs: number;
  totalRows: number;
  skippedRows: number;
}

interface HealJob {
  jobId: string;
  scope?: { type: ScopeType };
  scopeLabel: string;
  status: HealJobStatus;
  message: string;
  total: number;
  done: number;
  current: string;
  totalRows: number;
  skippedRows: number;
  summary: HealSummary | null;
  startedAt: number;
  finishedAt: number | null;
  cancelRequested: boolean;
}

interface HealPage {
  items: HealSpecEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  counts: { all: number; outdated: number; ok: number; unresolved: number };
}

interface SkippedTable { category: string; tableName: string; rows: number; holder: string }

export interface GunHealScopeStat { specs: number; rows: number; tables: number }

export interface GunLedgerSelfHealModalProps {
  open: boolean;
  onClose: () => void;
  addToast: (message: string, type: 'success' | 'error') => void;
  /** 写回成功后的回调：刷新台账并广播给其他客户端 */
  onApplied: (info: { updatedItems: number; specCount: number }) => void;
  activeCategory: string;
  activeTableId: string | null;
  activeTableName: string | null;
  /** 各检测范围的仕样号/行数估算（父级从已加载的台账直接算，开弹窗即可看到规模） */
  scopeStats: {
    all: GunHealScopeStat;
    category: GunHealScopeStat;
    table: GunHealScopeStat | null;
  };
}

const STATUS_META: Record<HealStatus, { label: string; cls: string; dot: string }> = {
  outdated: { label: '需更新', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  ok: { label: '已最新', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  unresolved: { label: '无法核对', cls: 'bg-gray-100 text-gray-500 border-gray-200', dot: 'bg-gray-400' },
};

const FILTERS: Array<{ key: HealFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'outdated', label: '需更新' },
  { key: 'ok', label: '已最新' },
  { key: 'unresolved', label: '无法核对' },
];

const num = (value: number) => (Number.isFinite(value) ? value.toLocaleString('zh-CN') : '0');

// 上次检测的 jobId：几万个仕样号的检测要十几分钟，误关弹窗（Esc / 点遮罩）后
// 重新打开应当接着看，而不是白等一轮。job 在服务端保留 45 分钟，过期后自动失效。
const RESUME_KEY = 'obara.gunLedger.selfHealJob';
const readResumeJobId = () => {
  try {
    return window.sessionStorage.getItem(RESUME_KEY) || '';
  } catch {
    return '';
  }
};
const saveResumeJobId = (jobId: string) => {
  try {
    window.sessionStorage.setItem(RESUME_KEY, jobId);
  } catch {
    // 隐私模式下 sessionStorage 可能不可写：降级为「关掉就重扫」，不影响功能
  }
};
const clearResumeJobId = () => {
  try {
    window.sessionStorage.removeItem(RESUME_KEY);
  } catch {
    // 同上
  }
};

// 检测耗时：秒级给秒，分钟级给 mm:ss，超过一小时给 h:mm:ss
const formatDuration = (ms: number) => {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

const GunLedgerSelfHealModal: React.FC<GunLedgerSelfHealModalProps> = ({
  open,
  onClose,
  addToast,
  onApplied,
  activeCategory,
  activeTableId,
  activeTableName,
  scopeStats,
}) => {
  const [scopeType, setScopeType] = useState<ScopeType>('table');
  const [job, setJob] = useState<HealJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  const [filter, setFilter] = useState<HealFilter>('outdated');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [pageData, setPageData] = useState<HealPage | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // 勾选状态：'all' = 全选「需更新」并可按仕样号排除（几万个仕样号不在前端堆 Set）
  // 两种模式都用 Map<仕样号, 行数>：算「预计改写多少行」不必回查页码里的明细
  const [selectAll, setSelectAll] = useState(false);
  const [selected, setSelected] = useState<Map<string, number>>(new Map());
  const [excluded, setExcluded] = useState<Map<string, number>>(new Map());

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [appliedResult, setAppliedResult] = useState<{ items: number; specs: number; skipped: SkippedTable[] } | null>(null);

  // 进度条的「已用时 / 预计剩余」需要一个本地时钟
  const [nowTick, setNowTick] = useState(Date.now());

  const pollRef = useRef<number | null>(null);
  const pollingBusyRef = useRef(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 「续看上次检测」的请求序号：用户点了「开始检测」后，在途的续看响应不能再覆盖新 job
  const resumeSeqRef = useRef(0);

  const running = job?.status === 'running';
  const busy = starting || applying;
  const finished = Boolean(job && job.status !== 'running');
  const summary = job?.summary || null;

  const scopeStatsOf = useMemo(() => ({
    table: scopeStats.table,
    category: scopeStats.category,
    all: scopeStats.all,
  }), [scopeStats]);

  const currentStat = scopeStatsOf[scopeType];
  const scopeAvailable = scopeType !== 'table' || Boolean(activeTableId);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    pollingBusyRef.current = false;
  }, []);

  // 打开即重置：默认范围跟着「当前打开的表」走，没开表就落到当前分类
  useEffect(() => {
    if (!open) {
      stopPolling();
      return;
    }
    setScopeType(activeTableId ? 'table' : 'category');
    setJob(null);
    setStarting(false);
    setStopping(false);
    setApplying(false);
    setError('');
    setFilter('outdated');
    setQuery('');
    setDebouncedQuery('');
    setPage(1);
    setPageSize(50);
    setPageData(null);
    setSelectAll(false);
    setSelected(new Map());
    setExcluded(new Map());
    setConfirmOpen(false);
    setAppliedResult(null);
    setNowTick(Date.now());
  }, [open, activeTableId, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // 检测中每 500ms 刷新一次已用时
  useEffect(() => {
    if (!open || !running) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [open, running]);

  // Esc 关闭：写回台账进行中不允许关闭，避免用户以为写入被中断
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || applying) return;
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

  // 搜索防抖：输入停下 350ms 再回第 1 页查
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 350);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [query]);

  // 轮询检测进度：进入后每秒拉一次计数（明细另走分页接口，避免大响应）
  const startPolling = useCallback((jobId: string) => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      if (pollingBusyRef.current) return;
      pollingBusyRef.current = true;
      try {
        const snapshotRes = await axiosInstance.get(
          `/spec/self-heal/gun-ledger/scan/${jobId}`,
          { timeout: 15000 },
        );
        const snapshot = snapshotRes.data as HealJob;
        setJob(snapshot);
        if (snapshot.status === 'running') return;

        stopPolling();
        setStopping(false);

        if (snapshot.status === 'failed') {
          setError(snapshot.message || '检测失败，请稍后重试');
          addToast(snapshot.message || '检测失败', 'error');
          return;
        }
        if (snapshot.status === 'cancelled') {
          addToast(`已停止：完成 ${num(snapshot.summary?.specCount || 0)} / ${num(snapshot.total)} 个仕样号`, 'error');
        } else {
          const outdated = snapshot.summary?.outdatedSpecs || 0;
          addToast(
            outdated > 0
              ? `检测完成：${num(outdated)} 个仕样号需要更新客户名`
              : '检测完成：台账客户名与仕样书一致',
            'success',
          );
        }

        // 需更新的仕样号不多时默认全选，省一次点击；几万个时全选是危险操作，交给用户自己决定
        const outdatedSpecs = snapshot.summary?.outdatedSpecs || 0;
        if (outdatedSpecs > 0 && outdatedSpecs <= 100) {
          setSelectAll(true);
          setExcluded(new Map());
        }
      } catch (err: any) {
        stopPolling();
        setStopping(false);
        if (err?.response?.status === 404) {
          clearResumeJobId();   // 服务端 job 已过期（45 分钟），下次打开只能重新检测
          setError('检测结果已过期，请重新检测');
          addToast('检测结果已过期，请重新检测', 'error');
          return;
        }
        const message = err?.response?.data?.message || '获取检测进度失败，请重试';
        setError(message);
        addToast(message, 'error');
      } finally {
        pollingBusyRef.current = false;
      }
    }, 1000);
  }, [stopPolling, addToast]);

  const startScan = useCallback(async () => {
    if (!scopeAvailable) {
      addToast('请先打开一张台账表，或改用「当前分类 / 全部台账」', 'error');
      return;
    }
    stopPolling();
    resumeSeqRef.current += 1;
    setStarting(true);
    setError('');
    setJob(null);
    setPageData(null);
    setSelectAll(false);
    setSelected(new Map());
    setExcluded(new Map());
    setAppliedResult(null);
    setConfirmOpen(false);
    setFilter('outdated');
    setPage(1);
    setNowTick(Date.now());

    const scope = scopeType === 'table'
      ? { type: 'table', tableId: activeTableId }
      : scopeType === 'category'
        ? { type: 'category', category: activeCategory }
        : { type: 'all' };

    try {
      const res = await axiosInstance.post(
        '/spec/self-heal/gun-ledger/scan',
        { scope },
        { timeout: 30000 },
      );
      const first = res.data as HealJob;
      setJob(first);
      setStarting(false);
      saveResumeJobId(first.jobId);
      startPolling(first.jobId);
    } catch (err: any) {
      setStarting(false);
      const message = err?.response?.data?.message || '无法开始检测，请检查网络后重试';
      setError(message);
      addToast(message, 'error');
    }
  }, [scopeAvailable, scopeType, activeTableId, activeCategory, startPolling, addToast]);

  const stopScan = useCallback(async () => {
    if (!job || job.status !== 'running' || stopping) return;
    setStopping(true);
    try {
      await axiosInstance.post('/spec/self-heal/gun-ledger/stop', { jobId: job.jobId }, { timeout: 15000 });
    } catch {
      addToast('停止请求失败，请稍后重试', 'error');
      setStopping(false);
    }
  }, [job, stopping, addToast]);

  // 重新打开弹窗时接着看上一次检测：jobId 存在 sessionStorage，服务端保留 45 分钟。
  // 404 说明已过期，清掉记录、回到「还没有检测结果」。
  useEffect(() => {
    if (!open) return;
    const jobId = readResumeJobId();
    if (!jobId) return;
    let cancelled = false;
    const seq = resumeSeqRef.current;
    (async () => {
      try {
        const res = await axiosInstance.get(`/spec/self-heal/gun-ledger/scan/${jobId}`, { timeout: 15000 });
        if (cancelled || seq !== resumeSeqRef.current) return;
        const snapshot = res.data as HealJob;
        setJob(snapshot);
        setNowTick(Date.now());
        if (snapshot.scope && snapshot.scope.type) setScopeType(snapshot.scope.type);
        if (snapshot.status === 'running') startPolling(jobId);
      } catch (err: any) {
        if (cancelled) return;
        if (err?.response?.status === 404) clearResumeJobId();
      }
    })();
    return () => { cancelled = true; };
  }, [open, startPolling]);

  // 明细分页：检测中不拉，结束后（含已停止）按筛选/搜索/页码拉当前页
  useEffect(() => {
    const jobId = job?.jobId;
    const jobStatus = job?.status;
    if (!open || !jobId || jobStatus === 'running') return;
    let cancelled = false;
    setPageLoading(true);
    axiosInstance
      .get(`/spec/self-heal/gun-ledger/scan/${jobId}/specs`, {
        params: { filter, page, pageSize, q: debouncedQuery },
        timeout: 20000,
      })
      .then(res => {
        if (cancelled) return;
        setPageData(res.data as HealPage);
      })
      .catch((err: any) => {
        if (cancelled) return;
        addToast(err?.response?.data?.message || '读取检测明细失败', 'error');
      })
      .finally(() => {
        if (!cancelled) setPageLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, job?.jobId, job?.status, filter, page, pageSize, debouncedQuery, reloadKey, addToast]);

  const applySelected = useCallback(async () => {
    if (!job) return;
    setApplying(true);
    try {
      const payload: Record<string, unknown> = { jobId: job.jobId };
      if (selectAll) {
        payload.all = true;
        payload.excludeSpecs = [...excluded.keys()];
      } else {
        payload.specNumbers = [...selected.keys()];
      }
      const res = await axiosInstance.post('/spec/self-heal/gun-ledger/apply', payload, { timeout: 180000 });
      const updatedItems = Number(res.data?.updatedItems || 0);
      const updatedSpecs: string[] = Array.isArray(res.data?.updatedSpecs) ? res.data.updatedSpecs : [];
      const skippedTables: SkippedTable[] = Array.isArray(res.data?.skippedTables) ? res.data.skippedTables : [];

      setAppliedResult({ items: updatedItems, specs: updatedSpecs.length, skipped: skippedTables });
      setConfirmOpen(false);
      setSelectAll(false);
      setSelected(new Map());
      setExcluded(new Map());
      setReloadKey(key => key + 1);

      if (res.data?.summary) {
        setJob(prev => (prev ? { ...prev, summary: res.data.summary as HealSummary } : prev));
      }

      if (updatedItems > 0) {
        addToast(`仕样自愈完成：已更新 ${num(updatedItems)} 行台账客户名`, 'success');
        onApplied({ updatedItems, specCount: updatedSpecs.length });
      } else {
        addToast('所选仕样号已是最新，无需修改', 'success');
      }
      if (skippedTables.length > 0) {
        addToast(`有 ${skippedTables.length} 张表正被人编辑，已跳过`, 'error');
      }
    } catch (err: any) {
      addToast(err?.response?.data?.message || '更新失败，请稍后重试', 'error');
    } finally {
      setApplying(false);
    }
  }, [job, selectAll, excluded, selected, addToast, onApplied]);

  // ---------- 派生数据 ----------
  const counts = pageData?.counts;
  const outdatedSpecs = summary?.outdatedSpecs || 0;

  const selectedSpecCount = selectAll
    ? Math.max(0, outdatedSpecs - excluded.size)
    : selected.size;
  const selectedRowCount = selectAll
    ? Math.max(0, (summary?.outdatedItems || 0) - [...excluded.values()].reduce((sum, n) => sum + n, 0))
    : [...selected.values()].reduce((sum, n) => sum + n, 0);

  const progressPct = job && job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
  const elapsedMs = job ? (job.finishedAt || nowTick) - job.startedAt : 0;
  const etaMs = job && job.done > 0 && job.total > job.done
    ? (elapsedMs / job.done) * (job.total - job.done)
    : 0;

  const isChecked = (entry: HealSpecEntry) => {
    if (entry.status !== 'outdated') return false;
    return selectAll ? !excluded.has(entry.specNumber) : selected.has(entry.specNumber);
  };

  const toggleEntry = (entry: HealSpecEntry) => {
    if (entry.status !== 'outdated') return;
    if (selectAll) {
      setExcluded(prev => {
        const next = new Map(prev);
        if (next.has(entry.specNumber)) next.delete(entry.specNumber);
        else next.set(entry.specNumber, entry.itemCount);
        return next;
      });
      return;
    }
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(entry.specNumber)) next.delete(entry.specNumber);
      else next.set(entry.specNumber, entry.itemCount);
      return next;
    });
  };

  const changeFilter = (next: HealFilter) => {
    setFilter(next);
    setPage(1);
  };

  if (!open) return null;

  const scopeOptions: Array<{ key: ScopeType; label: string; hint: string; stat: GunHealScopeStat | null; disabled: boolean }> = [
    {
      key: 'table',
      label: '当前表',
      hint: activeTableName ? `${activeCategory} / ${activeTableName}` : '未打开台账表',
      stat: scopeStats.table,
      disabled: !activeTableId,
    },
    {
      key: 'category',
      label: '当前分类',
      hint: activeCategory || '未选择分类',
      stat: scopeStats.category,
      disabled: false,
    },
    { key: 'all', label: '全部台账', hint: '所有分类的所有表', stat: scopeStats.all, disabled: false },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className={MODAL_OVERLAY} onClick={() => { if (!applying) onClose(); }} />
      <div className="relative bg-white rounded-xl shadow-2xl w-[1040px] max-w-[96vw] h-[720px] max-h-[92vh] flex flex-col overflow-hidden border border-gray-200">
        {/* ===== 头部 ===== */}
        <div className="shrink-0 px-5 py-3.5 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-white/15 border border-white/25 flex items-center justify-center shrink-0">
              <Wand2 size={18} />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-base leading-tight flex items-center gap-2">
                仕样自愈
                <span className="text-[10px] font-bold px-1.5 py-[1px] rounded bg-white/20 border border-white/25">
                  焊枪编号台账
                </span>
              </div>
              <div className="text-[11px] opacity-85 leading-tight mt-0.5 truncate">
                按仕样书校准台账「客户」列的客户名（不校验纳期），支持分批挑选、分页核对
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="p-1.5 rounded-full hover:bg-white/20 transition disabled:opacity-40"
            title={applying ? '正在写回台账，暂不可关闭' : '关闭（Esc）'}
          >
            <X size={18} />
          </button>
        </div>

        {/* ===== 检测范围 ===== */}
        <div className="shrink-0 px-5 pt-3.5 pb-3 border-b border-gray-100 bg-white">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-bold text-gray-500 mb-1.5 flex items-center gap-1.5">
                <Database size={12} className="text-gray-400" />
                检测范围
                <span className="font-normal text-gray-400">（仕样号越多耗时越长，建议先按表检测）</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {scopeOptions.map(option => {
                  const active = scopeType === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      disabled={running || starting || option.disabled}
                      onClick={() => setScopeType(option.key)}
                      className={`text-left px-3 py-2 rounded-lg border transition ${
                        active
                          ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-200'
                          : option.disabled
                            ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                            : 'border-gray-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/40'
                      } ${running || starting ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <div className={`text-[12px] font-bold ${active ? 'text-emerald-700' : 'text-gray-700'}`}>
                        {option.label}
                      </div>
                      <div className="text-[10px] text-gray-500 truncate mt-0.5" title={option.hint}>{option.hint}</div>
                      <div className="text-[10px] text-gray-400 mt-1 tabular-nums">
                        {option.stat
                          ? `${num(option.stat.specs)} 个仕样号 · ${num(option.stat.rows)} 行`
                          : '—'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="shrink-0 flex flex-col gap-2 w-40 pt-[18px]">
              {running ? (
                <button
                  type="button"
                  onClick={() => { void stopScan(); }}
                  disabled={stopping}
                  className="flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-bold text-white bg-red-500 hover:bg-red-600 shadow-sm transition disabled:bg-gray-300"
                >
                  {stopping ? <Loader2 size={15} className="animate-spin" /> : <Square size={13} />}
                  {stopping ? '正在停止…' : '停止检测'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { void startScan(); }}
                  disabled={busy || !scopeAvailable || (currentStat ? currentStat.specs === 0 : false)}
                  className={`flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-bold text-white shadow-sm transition ${
                    busy || !scopeAvailable || (currentStat ? currentStat.specs === 0 : false)
                      ? 'bg-gray-300 cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                  title="逐个读取仕样书，比对台账客户名"
                >
                  {starting
                    ? <><Loader2 size={15} className="animate-spin" />准备中…</>
                    : finished
                      ? <><RefreshCw size={15} />重新检测</>
                      : <><Sparkles size={15} />开始检测</>}
                </button>
              )}
              <div className="text-[10px] text-gray-400 text-center leading-relaxed">
                同一仕样号 30 分钟内只解析一次
              </div>
            </div>
          </div>

          {/* 进度 */}
          {job && (running || job.done > 0) && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="flex items-center gap-1.5 text-gray-600 min-w-0">
                  {running
                    ? <Loader2 size={11} className="animate-spin text-emerald-600 shrink-0" />
                    : <CheckCircle2 size={11} className="text-emerald-600 shrink-0" />}
                  <span className="truncate">
                    {running ? '正在解析仕样书' : job.status === 'cancelled' ? '已停止（可更新已扫完的部分）' : '检测完成'}
                  </span>
                  {running && job.current && (
                    <span className="font-mono font-bold text-gray-700 shrink-0">{job.current}</span>
                  )}
                  <span className="text-gray-400 shrink-0">· {job.scopeLabel}</span>
                </span>
                <span className="tabular-nums text-gray-500 shrink-0">
                  {num(job.done)} / {num(job.total)}（{progressPct}%）
                  {running && job.done > 0 && etaMs > 0 && ` · 预计剩余 ${formatDuration(etaMs)}`}
                  {!running && elapsedMs > 0 && ` · 耗时 ${formatDuration(elapsedMs)}`}
                </span>
              </div>
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${job.status === 'cancelled' ? 'bg-amber-400' : 'bg-gradient-to-r from-emerald-600 to-emerald-400'}`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {error && !running && (
            <div className="mt-2.5 flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          )}

          {summary && !running && (
            <div className="mt-3 grid grid-cols-5 gap-2">
              {[
                { label: '检测仕样号', value: summary.specCount, total: job?.total, tone: 'text-gray-800' },
                { label: '需更新', value: summary.outdatedSpecs, tone: 'text-amber-600' },
                { label: '待改写行', value: summary.outdatedItems, tone: 'text-violet-600' },
                { label: '已最新', value: summary.okSpecs, tone: 'text-emerald-600' },
                { label: '无法核对', value: summary.unresolvedSpecs, tone: 'text-gray-500' },
              ].map(card => (
                <div key={card.label} className="rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-1.5">
                  <div className={`text-[16px] font-black leading-none tabular-nums ${card.tone}`}>
                    {num(card.value)}
                    {card.total ? <span className="text-[10px] font-bold text-gray-400 ml-1">/ {num(card.total)}</span> : null}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1">{card.label}</div>
                </div>
              ))}
            </div>
          )}

          {appliedResult && (
            <div className="mt-2.5 flex items-start gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-[12px] text-emerald-700">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              <span className="break-all">
                已更新 <b>{num(appliedResult.specs)}</b> 个仕样号、<b>{num(appliedResult.items)}</b> 行台账客户名。
                {appliedResult.skipped.length > 0 && (
                  <> 另有 {appliedResult.skipped.length} 张表正被人编辑，已跳过：{appliedResult.skipped.map(t => `${t.category}/${t.tableName}（${t.holder}）`).join('、')}</>
                )}
              </span>
            </div>
          )}
        </div>

        {/* ===== 明细工具栏 ===== */}
        {finished ? (
          <div className="shrink-0 flex items-center gap-1.5 px-5 py-2 border-b border-gray-200 bg-white">
            {FILTERS.map(tab => {
              const active = filter === tab.key;
              const count = counts ? counts[tab.key] : 0;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => changeFilter(tab.key)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition ${
                    active ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {tab.label}
                  <span className={`ml-1 tabular-nums ${active ? 'text-white/80' : 'text-gray-400'}`}>{num(count)}</span>
                </button>
              );
            })}

            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="仕样号 / 客户名 / 枪名"
                  className="h-7 w-56 pl-7 pr-6 rounded-md border border-gray-200 text-[11px] text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    title="清空搜索"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <select
                value={pageSize}
                onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}
                className="h-7 rounded-md border border-gray-200 text-[11px] text-gray-600 px-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                title="每页条数"
              >
                <option value={50}>50 / 页</option>
                <option value={100}>100 / 页</option>
                <option value={200}>200 / 页</option>
              </select>
            </div>
          </div>
        ) : null}

        {/* ===== 明细列表 ===== */}
        <div className="flex-1 min-h-0 flex flex-col bg-gray-50/60">
          {!job && !starting ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-3">
                <Wand2 size={24} className="text-emerald-500" />
              </div>
              <div className="text-sm font-bold text-gray-700">还没有检测结果</div>
              <p className="text-[12px] text-gray-500 mt-1.5 leading-relaxed max-w-[560px]">
                选择检测范围后点「开始检测」，系统会读取台账每行客户名里的仕样号，
                逐个解析仕样书，比对客户名是否一致——只校准客户名，不动纳期与其它列。
              </p>
              <p className="text-[11px] text-gray-400 mt-2">
                仕样号较多时（上万级）一轮检测可能需要十几分钟，可随时「停止检测」并更新已扫完的部分；
                关掉弹窗再打开能接着看上一次的检测结果（服务端保留 45 分钟）。
              </p>
            </div>
          ) : running || starting ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
              <Loader2 size={26} className="animate-spin text-emerald-600 mb-3" />
              <div className="text-sm font-bold text-gray-700">正在逐个解析仕样书…</div>
              <p className="text-[11px] text-gray-500 mt-1.5 max-w-[520px] leading-relaxed">
                检测结果会在结束后按页展示（几万个仕样号不适合边扫边渲染）。
                关掉弹窗不影响后台检测，重新打开会接着看进度。
              </p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col px-3 pt-2">
              <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pb-2">
                {pageLoading && !pageData && (
                  <div className="py-10 text-center text-[12px] text-gray-400 flex items-center justify-center gap-2">
                    <Loader2 size={13} className="animate-spin" />正在读取检测明细…
                  </div>
                )}

                {!pageLoading && pageData && pageData.items.length === 0 && (
                  <div className="py-10 text-center text-[12px] text-gray-400">
                    {debouncedQuery ? '没有匹配的仕样号' : '该筛选下没有仕样号'}
                  </div>
                )}

                {(pageData?.items || []).map(entry => {
                  const meta = STATUS_META[entry.status];
                  const checked = isChecked(entry);
                  const canSelect = entry.status === 'outdated';
                  return (
                    <div
                      key={entry.specNumber}
                      className={`rounded-xl border bg-white px-3 py-2 transition ${
                        checked ? 'border-amber-300 shadow-sm ring-1 ring-amber-100' : 'border-gray-200'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          disabled={!canSelect}
                          onClick={() => toggleEntry(entry)}
                          title={canSelect ? '勾选后参与本次更新' : '该仕样号无需更新'}
                          className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition ${
                            checked
                              ? 'bg-emerald-600 border-emerald-600 text-white'
                              : canSelect
                                ? 'border-gray-300 bg-white hover:border-emerald-400'
                                : 'border-gray-200 bg-gray-100 cursor-not-allowed'
                          }`}
                        >
                          {checked && <Check size={11} strokeWidth={3} />}
                        </button>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[13px] font-bold text-gray-800">{entry.specNumber}</span>
                            <span className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-[1px] rounded border ${meta.cls}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                              {meta.label}
                            </span>
                            {entry.status === 'outdated' && (
                              <span className="text-[11px] text-gray-500">
                                <b className="text-gray-800">{num(entry.itemCount)}</b> 行待改写
                                {entry.rowCount > entry.itemCount && (
                                  <span className="text-gray-400">（共 {num(entry.rowCount)} 行）</span>
                                )}
                              </span>
                            )}
                            {entry.tableNames.length > 0 && (
                              <span className="flex items-center gap-1 text-[10px] text-gray-400 min-w-0">
                                <Table2 size={10} className="shrink-0" />
                                <span className="truncate max-w-[260px]" title={entry.tableNames.join('、')}>
                                  {entry.tableNames.join('、')}
                                </span>
                              </span>
                            )}
                          </div>

                          {entry.status === 'outdated' && (
                            <div className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed">
                              <span className="text-gray-400 line-through break-all">
                                {entry.samples[0]?.from || '—'}
                                {entry.samples[0] && entry.samples[0].count > 1 && (
                                  <span className="text-gray-400 no-underline"> ×{entry.samples[0].count}</span>
                                )}
                              </span>
                              <ArrowRight size={12} className="mt-[3px] shrink-0 text-gray-400" />
                              <span className="text-emerald-700 font-semibold break-all">{entry.expectedClient}</span>
                              {entry.distinctCurrent > 1 && (
                                <span className="shrink-0 text-[10px] text-gray-400">
                                  （另有 {entry.distinctCurrent - 1} 种旧写法）
                                </span>
                              )}
                            </div>
                          )}

                          {entry.status === 'ok' && (
                            <div className="mt-1 text-[11px] text-gray-400 truncate">
                              {entry.expectedClient || '无客户名'}
                            </div>
                          )}

                          {entry.status === 'unresolved' && (
                            <div className="mt-1 text-[11px] text-gray-400 truncate" title={entry.message}>
                              {entry.message || '无法核对'}
                            </div>
                          )}

                          {entry.status === 'outdated' && entry.gunNames.length > 0 && (
                            <div className="mt-1 flex items-center gap-1 flex-wrap">
                              <span className="text-[10px] text-gray-400">涉及枪名</span>
                              {entry.gunNames.map(name => (
                                <span
                                  key={name}
                                  className="font-mono text-[10px] px-1.5 py-[1px] rounded bg-gray-100 border border-gray-200 text-gray-600"
                                >
                                  {name}
                                </span>
                              ))}
                              {entry.itemCount > entry.gunNames.length && (
                                <span className="text-[10px] text-gray-400">等 {num(entry.itemCount)} 行</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 分页 */}
              <div className="shrink-0 flex items-center justify-between gap-3 px-1 py-2 border-t border-gray-200">
                <div className="text-[11px] text-gray-500 tabular-nums">
                  共 <b className="text-gray-700">{num(pageData?.total || 0)}</b> 个仕样号
                  {debouncedQuery ? '（已按搜索过滤）' : ''}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={page <= 1 || pageLoading}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    className="flex items-center gap-0.5 h-7 px-2 rounded-md border border-gray-200 text-[11px] font-bold text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={13} />上一页
                  </button>
                  <span className="text-[11px] text-gray-600 tabular-nums px-1">
                    {page} / {pageData?.totalPages || 1}
                  </span>
                  <button
                    type="button"
                    disabled={page >= (pageData?.totalPages || 1) || pageLoading}
                    onClick={() => setPage(p => p + 1)}
                    className="flex items-center gap-0.5 h-7 px-2 rounded-md border border-gray-200 text-[11px] font-bold text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    下一页<ChevronRight size={13} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ===== 底部操作 ===== */}
        <div className="shrink-0 px-5 py-3 border-t border-gray-200 bg-white flex items-center justify-between gap-3">
          <div className="text-[11px] text-gray-500 flex items-center gap-2 min-w-0 flex-wrap">
            {outdatedSpecs > 0 && finished ? (
              <>
                <span>
                  已选 <b className="text-gray-800">{num(selectedSpecCount)}</b> 个仕样号
                </span>
                <span className="text-gray-300">|</span>
                <span>
                  预计改写 <b className="text-gray-800">{num(selectedRowCount)}</b> 行
                </span>
                {!selectAll && (
                  <button
                    type="button"
                    onClick={() => { setSelectAll(true); setExcluded(new Map()); setSelected(new Map()); }}
                    className="ml-1 text-[11px] font-bold text-emerald-700 hover:underline"
                  >
                    全选需更新（{num(outdatedSpecs)}）
                  </button>
                )}
                {(selectedSpecCount > 0 || excluded.size > 0) && (
                  <button
                    type="button"
                    onClick={() => { setSelectAll(false); setSelected(new Map()); setExcluded(new Map()); }}
                    className="text-[11px] text-gray-400 hover:text-gray-600"
                  >
                    清空
                  </button>
                )}
              </>
            ) : (
              <span className="flex items-center gap-1.5">
                <Layers size={12} className="text-gray-400" />
                {job
                  ? job.status === 'running'
                    ? '检测进行中，结束后可挑选需要更新的仕样号'
                    : outdatedSpecs === 0
                      ? '当前范围没有需要更新的仕样号'
                      : '选择需要更新的仕样号后执行写回'
                  : '先选择范围并检测，再挑选需要更新的仕样号'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={applying}
              onClick={onClose}
              className="h-9 px-3 rounded-lg text-[12px] font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition disabled:opacity-40"
            >
              关闭
            </button>
            <button
              type="button"
              disabled={busy || running || selectedSpecCount === 0}
              onClick={() => setConfirmOpen(true)}
              className={`flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-bold text-white shadow-sm transition ${
                busy || running || selectedSpecCount === 0
                  ? 'bg-gray-300 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
              title="把选中仕样号的客户名按仕样书写回台账客户列"
            >
              {applying ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
              更新客户名{selectedSpecCount > 0 ? `（${num(selectedSpecCount)}）` : ''}
            </button>
          </div>
        </div>

        {/* ===== 二次确认 ===== */}
        {confirmOpen && (
          <div className={`${MODAL_OVERLAY} z-10 flex items-center justify-center`}>
            <div className="w-[440px] max-w-[92%] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3.5 bg-gradient-to-r from-amber-50 to-white border-b border-amber-100 flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0">
                  <AlertTriangle size={16} className="text-amber-600" />
                </div>
                <div>
                  <div className="text-[13px] font-bold text-gray-800">确认按仕样书改写台账客户名？</div>
                  <div className="text-[11px] text-gray-500">只改「客户」列，其它列与纳期不受影响</div>
                </div>
              </div>
              <div className="px-5 py-4 text-[12px] text-gray-600 leading-relaxed">
                将对 <b className="text-amber-700">{num(selectedSpecCount)}</b> 个仕样号、
                <b className="text-amber-700"> {num(selectedRowCount)} </b> 行台账生效。
                正在被他人编辑的表会自动跳过；写回后所有在线用户的台账页会同步刷新。
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
                  onClick={() => { void applySelected(); }}
                  className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-[12px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition disabled:opacity-50"
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

export default GunLedgerSelfHealModal;
