import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckSquare,
  ClipboardList,
  Loader2,
  RefreshCw,
  Square,
  User,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { axiosInstance } from '../services/api';
import { useSystemSettings } from '../context/SystemSettingsContext';
import { getTaskBaseColor } from '../utils/taskColors';
import {
  appendDeadlineSuffix,
  extractSpecNumbers,
  resolveTextDeadlineSuffix,
  stripDeadlineSuffix,
} from '../utils/specDeadline';

// 今日取号的一行枪名（跨表汇总后传给弹窗）
export interface QuickConfirmGunRow {
  rowId: string;
  gunName: string;
  customer: string;
  category: string;
  tableName: string;
  // 按「确认图」默认工时规则预先算好的枪名工时
  hours: number;
  // 已被主任务使用（天蓝色标识）——这类枪名不允许再分配
  used: boolean;
}

interface DesignerOption {
  id: string;
  name: string;
  group?: string;
  hidden?: boolean;
}

// 目标设计员当天已存在的任务（用于「相同仕样号合并」）
interface DayTask {
  itemId: string;
  taskName: string;
  guns: { id: string; name: string; hours: number | string }[];
}

interface QuickConfirmAssignModalProps {
  open: boolean;
  onClose: () => void;
  rows: QuickConfirmGunRow[];
  designers: DesignerOption[];
  addToast: (message: string, type: 'success' | 'error') => void;
  // 创建/合并成功后通知调用方刷新「已用枪名」等派生数据
  onCreated: () => void;
  // 浮层层级：从其他弹窗（如主页面快速取号）内部唤起时需要压在其上方
  zIndexClass?: string;
  // 底部左侧提示：从台账页（Shift×2）和从快速取号打开时的入口不同
  hintText?: string;
}

const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const groupByCustomer = (rows: QuickConfirmGunRow[]) => {
  const groups = new Map<string, QuickConfirmGunRow[]>();
  rows.forEach(row => {
    const customer = String(row.customer || '').trim() || '未命名';
    if (!groups.has(customer)) groups.set(customer, []);
    groups.get(customer)!.push(row);
  });
  return groups;
};

const toggleClass = (active: boolean) =>
  `relative inline-block w-8 h-4 rounded-full transition-colors ${active ? 'bg-white' : 'bg-white/30'}`;

/**
 * 焊枪台账「快速确认图安排」弹窗（连按两次 Shift 呼出）
 *
 * 数据来源与主页面「快速添加确认图修改」不同：这里不做枪名搜索，直接把
 * 「今天取号（时间列=今天、担当=当前登录人）」的枪名一次性列出来，勾选后按客户
 * 分组创建确认图任务；界面与逻辑（设计人员/日期/工时/纳期/相同仕样号合并）
 * 都与主页面那个弹窗保持一致。
 */
const QuickConfirmAssignModal: React.FC<QuickConfirmAssignModalProps> = ({
  open,
  onClose,
  rows,
  designers,
  addToast,
  onCreated,
  zIndexClass = 'z-50',
  hintText = 'Shift × 2 呼出 · Esc 关闭',
}) => {
  const { specNumberDigits, settings } = useSystemSettings();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [designerId, setDesignerId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [showDeadline, setShowDeadline] = useState(true);
  // 任务加急：勾选后本次创建的确认图任务全部标记为加急（默认关闭）
  const [urgent, setUrgent] = useState(false);
  const [deadlineMap, setDeadlineMap] = useState<Record<string, string | null>>({});
  const [deadlineLoading, setDeadlineLoading] = useState(false);

  const [dayTasks, setDayTasks] = useState<DayTask[]>([]);
  const [checking, setChecking] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 行变化时按「行签名」判断是否需要重新给默认勾选，避免用户手动取消后被再次勾上
  const lastRowsSignatureRef = useRef('');

  const designerOptions = useMemo(
    () => designers
      .filter(d => !d.hidden)
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN')),
    [designers]
  );

  // 打开时重置状态
  useEffect(() => {
    if (!open) return;
    setDesignerId('');
    setDate(todayStr());
    setShowDeadline(true);
    setUrgent(false);
    setDeadlineMap({});
    setDayTasks([]);
    setChecking(false);
    setMergeMode(false);
    setMergeTargetId('');
    setSubmitting(false);
    lastRowsSignatureRef.current = '';
  }, [open]);

  // Esc 关闭（提交中不响应，避免关掉正在写入的请求）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || submitting) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, submitting, onClose]);

  // 今日取的枪名默认全部勾选（已被主任务使用的不勾）
  useEffect(() => {
    if (!open) return;
    const signature = rows.map(r => r.rowId).join(',');
    if (lastRowsSignatureRef.current === signature) return;
    lastRowsSignatureRef.current = signature;
    setSelectedIds(new Set(rows.filter(r => !r.used).map(r => r.rowId)));
  }, [open, rows]);

  const selectedRows = useMemo(
    () => rows.filter(r => selectedIds.has(r.rowId)),
    [rows, selectedIds]
  );

  const groups = useMemo(() => groupByCustomer(selectedRows), [selectedRows]);

  const totalHours = useMemo(
    () => selectedRows.reduce((sum, r) => sum + (Number.isFinite(r.hours) ? r.hours : 0), 0),
    [selectedRows]
  );

  // 选中枪名的客户列里出现的仕样号
  const selectedSpecs = useMemo(
    () => extractSpecNumbers(selectedRows.map(r => r.customer).join(' '), specNumberDigits),
    [selectedRows, specNumberDigits]
  );

  // 拉取目标设计员当天的任务（相同仕样号检测 + 合并目标）
  useEffect(() => {
    if (!open || !designerId || !date) {
      setDayTasks([]);
      setChecking(false);
      return;
    }
    const [yearStr, monthStr] = date.split('-');
    if (!yearStr || !monthStr) return;
    let cancelled = false;
    setChecking(true);
    axiosInstance
      .get('/tasks', { params: { designerId, month: parseInt(monthStr, 10), year: parseInt(yearStr, 10) } })
      .then(res => {
        if (cancelled) return;
        const sheets = Array.isArray(res.data) ? res.data : [];
        const sheet = sheets.find((s: any) => s.designerId === designerId);
        const items = Array.isArray(sheet?.days?.[date]) ? sheet.days[date] : [];
        setDayTasks(
          items
            .filter((i: any) => !i.leaveType && i.id)
            .map((i: any) => ({
              itemId: String(i.id),
              taskName: String(i.taskName || ''),
              guns: Array.isArray(i.guns) ? i.guns : [],
            }))
        );
      })
      .catch(() => { if (!cancelled) setDayTasks([]); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [open, designerId, date]);

  // 相同仕样号的已有「确认图」任务（不含「确认图修改」）
  const mergeCandidates = useMemo(() => {
    if (selectedSpecs.length === 0 || dayTasks.length === 0) return [];
    return dayTasks.filter(t => {
      if (!t.taskName.includes('确认图') || t.taskName.includes('确认图修改')) return false;
      return extractSpecNumbers(t.taskName, specNumberDigits).some(s => selectedSpecs.includes(s));
    });
  }, [dayTasks, selectedSpecs, specNumberDigits]);

  // 「添加到已有任务」默认勾选：候选变化时自动勾上（用户手动取消后不会被重勾）
  const mergeSignature = `${designerId}|${date}|${mergeCandidates.map(c => c.itemId).join(',')}`;
  const lastMergeSignatureRef = useRef('');
  useEffect(() => {
    if (lastMergeSignatureRef.current === mergeSignature) return;
    lastMergeSignatureRef.current = mergeSignature;
    if (mergeCandidates.length > 0) {
      setMergeMode(true);
      setMergeTargetId(mergeCandidates[0].itemId);
    } else {
      setMergeMode(false);
      setMergeTargetId('');
    }
  }, [mergeSignature, mergeCandidates]);

  // 纳期预览：按客户分组提前查好 [M/D]，让用户提交前就能看到最终任务名
  const groupNames = useMemo(() => Array.from(groups.keys()), [groups]);
  const groupNamesSignature = groupNames.join('\u0001');
  useEffect(() => {
    if (!open) return;
    if (!showDeadline || groupNames.length === 0) {
      setDeadlineMap({});
      setDeadlineLoading(false);
      return;
    }
    let cancelled = false;
    setDeadlineLoading(true);
    void Promise.all(
      groupNames.map(async customer => {
        if (deadlineMap[customer] !== undefined) return [customer, deadlineMap[customer]] as const;
        const suffix = await resolveTextDeadlineSuffix(customer, specNumberDigits);
        return [customer, suffix] as const;
      })
    ).then(entries => {
      if (cancelled) return;
      setDeadlineMap(prev => {
        const next = { ...prev };
        entries.forEach(([customer, suffix]) => { next[customer] = suffix; });
        return next;
      });
      setDeadlineLoading(false);
    });
    return () => { cancelled = true; };
    // deadlineMap 故意不进依赖：它由本 effect 自己写入，进依赖会自触发死循环
  }, [open, showDeadline, groupNamesSignature, specNumberDigits]);

  const allSelectableIds = useMemo(
    () => rows.filter(r => !r.used).map(r => r.rowId),
    [rows]
  );
  const allSelected = allSelectableIds.length > 0 && allSelectableIds.every(id => selectedIds.has(id));

  const toggleRow = (rowId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(allSelectableIds));
  };

  const taskNameFor = useCallback((customer: string) => {
    const suffix = showDeadline ? (deadlineMap[customer] ?? null) : null;
    return appendDeadlineSuffix(`${customer} 确认图`, suffix);
  }, [showDeadline, deadlineMap]);

  const mergeTarget = mergeMode
    ? mergeCandidates.find(c => c.itemId === mergeTargetId) || null
    : null;

  const canSubmit = Boolean(designerId && date && selectedRows.length > 0) && !submitting;

  const handleSubmit = async () => {
    if (!designerId || !date) {
      addToast('请选择设计人员和日期', 'error');
      return;
    }
    if (selectedRows.length === 0) {
      addToast('请至少勾选一个枪名', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const buildGuns = (list: QuickConfirmGunRow[]) => list.map(r => ({
        id: `gun-quick-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: r.gunName.trim(),
        hours: Number.isFinite(r.hours) ? r.hours : 0,
      }));

      // 相同仕样号的分组追加进已有任务，其余分组新建
      const mergeTargets = new Map<string, { item: DayTask; guns: { id: string; name: string; hours: number }[] }>();
      const createGroups: Array<[string, QuickConfirmGunRow[]]> = [];
      Array.from(groups.entries()).forEach(([customer, groupRows]) => {
        const specs = extractSpecNumbers(customer, specNumberDigits);
        const matched = mergeTarget && specs.length > 0
          && extractSpecNumbers(mergeTarget.taskName, specNumberDigits).some(s => specs.includes(s))
          ? mergeTarget
          : null;
        if (matched) {
          const target = mergeTargets.get(matched.itemId) || { item: matched, guns: [] };
          target.guns.push(...buildGuns(groupRows));
          mergeTargets.set(matched.itemId, target);
        } else {
          createGroups.push([customer, groupRows]);
        }
      });

      // 新建任务：任务名 = <客户> 确认图 [+ 纳期]
      const items = await Promise.all(createGroups.map(async ([customer, groupRows]) => {
        const guns = buildGuns(groupRows);
        const hours = guns.reduce((sum, g) => sum + (parseFloat(String(g.hours)) || 0), 0);
        let taskName = `${customer} 确认图`;
        if (showDeadline) {
          // 预览阶段可能还没查完，这里再兜底查一次（有缓存，不会重复请求）
          const suffix = deadlineMap[customer] ?? await resolveTextDeadlineSuffix(customer, specNumberDigits);
          taskName = appendDeadlineSuffix(taskName, suffix);
        }
        // 配色由任务内容决定（本弹窗固定创建确认图任务），加急时改取加急配色
        return {
          taskName,
          hours,
          color: getTaskBaseColor(settings.taskColorConfig, 'confirm', urgent),
          urgent,
          guns,
          leaveType: null,
        };
      }));

      let mergedGunCount = 0;
      for (const [itemId, target] of mergeTargets.entries()) {
        const allGuns = [...target.item.guns, ...target.guns];
        await axiosInstance.put('/tasks/item', {
          designerId,
          date,
          itemId,
          field: 'guns',
          value: allGuns,
        });
        const total = allGuns.reduce((sum, g) => sum + (parseFloat(String(g.hours)) || 0), 0);
        await axiosInstance.put('/tasks/item', {
          designerId,
          date,
          itemId,
          field: 'hours',
          value: total,
        });
        mergedGunCount += target.guns.length;
      }
      if (items.length > 0) {
        await axiosInstance.post('/tasks/item/batch', { designerId, date, items });
      }

      const designerLabel = designerOptions.find(d => d.id === designerId)?.name || '设计人员';
      if (mergedGunCount > 0 && items.length === 0) {
        addToast(`已将 ${mergedGunCount} 个枪名添加到 ${mergeTargets.size} 个已有的相同仕样号任务`, 'success');
      } else if (mergedGunCount > 0) {
        addToast(`已创建 ${items.length} 个确认图任务，并将 ${mergedGunCount} 个枪名添加到 ${mergeTargets.size} 个已有任务`, 'success');
      } else {
        addToast(`已为 ${designerLabel} 创建 ${items.length} 个确认图任务`, 'success');
      }
      onCreated();
      onClose();
    } catch (err: any) {
      addToast(err?.response?.data?.message || '确认图安排失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className={`fixed inset-0 ${zIndexClass} flex items-center justify-center`} role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => !submitting && onClose()} />
      <div className="relative bg-white rounded-xl shadow-2xl w-[620px] max-w-[94vw] max-h-[90vh] flex flex-col overflow-hidden border border-gray-200">
        {/* 头部 */}
        <div className="relative flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-[#1d4ed8] via-[#2563eb] to-[#3b82f6] text-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white/15 border border-white/25">
              <Zap size={17} />
            </div>
            <div>
              <div className="font-bold text-base leading-tight">快速确认图安排</div>
              <div className="text-[11px] opacity-80 leading-tight mt-0.5">今日取号枪名 → 按客户分组 → 安排确认图任务</div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            {/* 任务加急：勾选后本次创建的确认图任务全部标记为加急 */}
            <label
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full transition select-none ${submitting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-white/10'} ${urgent ? 'bg-red-500/90' : 'bg-white/10'}`}
              title="勾选后本次创建的确认图任务全部标记为加急（底色改用加急配色，文字变红）"
            >
              <input
                type="checkbox"
                checked={urgent}
                disabled={submitting}
                onChange={e => setUrgent(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-white/60 cursor-pointer accent-red-500 disabled:cursor-not-allowed"
              />
              <span className="text-[11px] font-semibold text-white whitespace-nowrap inline-flex items-center gap-1">
                <Zap size={11} />任务加急
              </span>
            </label>
            {/* 显示纳期开关：打开后任务名自动带上仕样号纳期 [M/D]（默认打开） */}
            <button
              type="button"
              role="switch"
              aria-checked={showDeadline}
              disabled={submitting}
              onClick={() => setShowDeadline(v => !v)}
              title={showDeadline
                ? '已开启：客户列中的仕样号能查到纳期时，任务名自动带 [M/D]'
                : '已关闭：任务名不带纳期'}
              className={`flex items-center gap-1.5 px-1.5 py-1 rounded-full transition cursor-pointer disabled:opacity-50 ${showDeadline ? 'bg-white/15' : 'hover:bg-white/10'}`}
            >
              <span className="text-[11px] font-semibold text-white/90 whitespace-nowrap">
                显示纳期{deadlineLoading && showDeadline ? '…' : ''}
              </span>
              <span className={toggleClass(showDeadline)}>
                <span
                  className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${showDeadline ? 'left-[18px] bg-[#2563eb]' : 'left-0.5 bg-white'}`}
                />
              </span>
            </button>
            <button
              onClick={onClose}
              disabled={submitting}
              className="p-1.5 rounded-full hover:bg-white/20 transition cursor-pointer disabled:opacity-50"
              title="关闭（Esc）"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4 bg-gray-50/70">
          {/* 步骤 1：今日取的枪名 */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#2563eb] text-white text-[11px] font-bold shrink-0">1</span>
              <span className="text-sm font-bold text-gray-800">今日取的枪名</span>
              <span className="text-[11px] text-gray-400">
                共 {rows.length} 个，已选 {selectedRows.length} 个
                {totalHours > 0 && ` · ${totalHours.toFixed(2)}h`}
              </span>
              {allSelectableIds.length > 0 && (
                <button
                  type="button"
                  onClick={toggleAll}
                  disabled={submitting}
                  className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
                >
                  {allSelected ? <CheckSquare size={12} /> : <Square size={12} />}
                  {allSelected ? '取消全选' : '全选'}
                </button>
              )}
            </div>

            <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
              {rows.length === 0 ? (
                <div className="px-3 py-6 text-[12px] text-gray-400 text-center leading-relaxed">
                  今天还没有取号记录
                  <div className="mt-1 text-[11px] text-gray-400">
                    台账里「时间」为今天、「担当」为当前登录人员的枪名会出现在这里
                  </div>
                </div>
              ) : (
                <ul className="max-h-[240px] overflow-auto divide-y divide-gray-100">
                  {rows.map(row => {
                    const checked = selectedIds.has(row.rowId);
                    const disabled = row.used || submitting;
                    return (
                      <li key={row.rowId}>
                        <label
                          className={`flex items-center gap-2.5 px-3 py-2 transition ${disabled
                            ? 'opacity-60 cursor-not-allowed'
                            : checked ? 'bg-blue-50/60 cursor-pointer hover:bg-blue-50' : 'cursor-pointer hover:bg-gray-50'}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggleRow(row.rowId)}
                            className="w-3.5 h-3.5 accent-blue-600 cursor-pointer disabled:cursor-not-allowed"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-mono text-[13px] font-bold text-gray-800 truncate">{row.gunName}</div>
                            <div className="text-[11px] text-gray-500 truncate mt-0.5">
                              {row.customer || '未填写客户 / 仕样'}
                              <span className="text-gray-400">{` · ${row.category}/${row.tableName}`}</span>
                            </div>
                          </div>
                          {row.used && (
                            <span className="shrink-0 text-[10px] font-semibold text-sky-600 bg-sky-50 border border-sky-200 rounded px-1.5 py-0.5">
                              已安排
                            </span>
                          )}
                          <span className="shrink-0 text-[11px] font-bold text-blue-700">{row.hours}h</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {rows.some(r => r.used) && (
              <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-sky-700 bg-sky-50 border border-sky-200 rounded-md px-2 py-1.5">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                天蓝色「已安排」的枪名已存在于任务中，不能再分配确认图任务
              </div>
            )}
          </section>

          {/* 步骤 2：安排到 */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#2563eb] text-white text-[11px] font-bold shrink-0">2</span>
              <span className="text-sm font-bold text-gray-800">安排到</span>
              <span className="text-[11px] text-gray-400 ml-auto">
                将按客户分组创建 {groups.size} 个确认图任务
              </span>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="flex items-center gap-1 text-[11px] font-bold text-gray-500">
                    <User size={11} />设计人员
                  </label>
                  <select
                    value={designerId}
                    onChange={e => setDesignerId(e.target.value)}
                    disabled={submitting}
                    className="w-full h-9 px-2 bg-gray-50 border border-gray-200 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white transition"
                  >
                    <option value="">请选择设计人员</option>
                    {designerOptions.map(d => (
                      <option key={d.id} value={d.id}>{d.name}{d.group ? `（${d.group}）` : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="flex items-center gap-1 text-[11px] font-bold text-gray-500">
                    <CalendarDays size={11} />日期
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    disabled={submitting}
                    className="w-full h-9 px-2 bg-gray-50 border border-gray-200 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white transition"
                  />
                </div>
              </div>

              {/* 分组预览：客户 → 任务名（含纳期） */}
              {groups.size > 0 && (
                <div className="rounded-md border border-blue-100 bg-blue-50/50 px-2.5 py-2">
                  <div className="flex items-center gap-1 text-[11px] font-bold text-blue-700">
                    <ClipboardList size={11} />
                    将创建/合并的任务
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {Array.from(groups.entries()).map(([customer, groupRows]) => {
                      const specs = extractSpecNumbers(customer, specNumberDigits);
                      const willMerge = Boolean(mergeTarget && mergeMode && specs.length > 0
                        && extractSpecNumbers(mergeTarget.taskName, specNumberDigits).some(s => specs.includes(s)));
                      const hours = groupRows.reduce((sum, r) => sum + (Number.isFinite(r.hours) ? r.hours : 0), 0);
                      return (
                        <li key={customer} className="flex items-center gap-1.5 text-[11px]">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${willMerge ? 'bg-amber-400' : 'bg-blue-400'}`} />
                          <span className="truncate text-gray-700" title={willMerge ? mergeTarget?.taskName : taskNameFor(customer)}>
                            {willMerge ? `追加到「${mergeTarget?.taskName || ''}」` : stripDeadlineSuffix(taskNameFor(customer))}
                          </span>
                          {!willMerge && showDeadline && (
                            <span className={`shrink-0 font-bold ${deadlineMap[customer] ? 'text-red-600' : 'text-gray-300'}`}>
                              {deadlineMap[customer] || '无纳期'}
                            </span>
                          )}
                          <span className="shrink-0 text-gray-400">{groupRows.length} 个 · {hours}h</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {checking && (
                <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                  <RefreshCw size={11} className="animate-spin" />正在检测当天已有的确认图任务...
                </div>
              )}

              {!checking && mergeCandidates.length > 0 && (
                <div className={`rounded-md border px-2.5 py-2 transition ${mergeMode ? 'border-amber-300 bg-amber-50 ring-1 ring-amber-200' : 'border-amber-200 bg-amber-50/60'}`}>
                  <label className="flex items-start gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={mergeMode}
                      disabled={submitting}
                      onChange={e => {
                        setMergeMode(e.target.checked);
                        if (e.target.checked && !mergeTargetId) setMergeTargetId(mergeCandidates[0].itemId);
                      }}
                      className="mt-0.5 w-3.5 h-3.5 accent-amber-500 cursor-pointer"
                    />
                    <span className="text-[11px] text-amber-800 leading-snug">
                      发现 <span className="font-bold">{mergeCandidates.length}</span> 个相同仕样号的确认图任务，勾选后把相同仕样号的枪名
                      <span className="font-bold">添加进已有任务</span>，不再新建
                    </span>
                  </label>
                  {mergeMode && mergeCandidates.length > 1 && (
                    <div className="mt-1.5 ml-5 flex flex-col gap-1 border-l-2 border-amber-200 pl-2.5">
                      <div className="text-[10px] font-bold text-amber-600">选择要添加到的任务：</div>
                      {mergeCandidates.map(candidate => (
                        <label key={candidate.itemId} className="flex items-center gap-1.5 cursor-pointer group">
                          <input
                            type="radio"
                            name="quick-assign-merge-target"
                            checked={mergeTargetId === candidate.itemId}
                            disabled={submitting}
                            onChange={() => setMergeTargetId(candidate.itemId)}
                            className="w-3 h-3 accent-amber-500 cursor-pointer"
                          />
                          <span className={`text-[11px] truncate transition ${mergeTargetId === candidate.itemId ? 'text-amber-900 font-semibold' : 'text-amber-700'}`}>
                            {candidate.taskName || '（无任务名）'}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {selectedRows.length === 0 && rows.length > 0 && (
                <div className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  还没有勾选枪名
                </div>
              )}
            </div>
          </section>
        </div>

        {/* 底部 */}
        <div className="shrink-0 px-5 py-3 border-t border-gray-100 bg-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-1 text-[11px] text-gray-400 min-w-0">
            <Users size={11} className="shrink-0" />
            <span className="truncate">{hintText}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-300 text-gray-600 bg-white hover:bg-gray-100 transition disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#2563eb] text-white hover:bg-[#1d4ed8] transition disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {submitting ? '安排中...' : `确认安排（${selectedRows.length}）`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuickConfirmAssignModal;
