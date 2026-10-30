import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  X,
  Zap,
  Loader2,
  AlertTriangle,
  RefreshCw,
  CalendarDays,
  Clock3,
  Check,
  User,
  Users,
  Sparkles,
} from 'lucide-react';
import { axiosInstance } from '../../../services/api';
import { useSystemSettings } from '../../../context/SystemSettingsContext';
import { resolveAutoFillHours, GunLocation } from '../../../utils/gunHoursRules';
import {
  appendDeadlineSuffix,
  hasDeadlineSuffix,
  resolveTextDeadlineSuffix,
  stripDeadlineSuffix,
} from '../../../utils/specDeadline';
import { PRESET_COLORS } from '../constants';
import type { Designer, TaskItem, TaskSheet } from '../types';

// 枪名归属：该枪名当前被放在哪位设计员的哪一天、哪条任务里
export interface GunNameOwner {
  itemId: string;
  designerId: string;
  designerName: string;
  date: string;
  taskName: string;
  gunHours: number;
}

// 枪名搜索结果（台账信息 + 任务归属）
export interface GunNameSearchResult {
  gunName: string;
  customer: string;
  category: string;
  tableName: string;
  owners: GunNameOwner[];
}

interface QuickConfirmModifyModalProps {
  open: boolean;
  onClose: () => void;
  designers: Designer[];
  // 枪名 → 台账分类/表，用于取「确认图修改」的默认工时
  gunLocations: Record<string, GunLocation>;
  addToast: (message: string, type: 'success' | 'error') => void;
  // 创建/合并成功后回传受影响的设计员、日期、任务 id 与最新工时表
  onCreated: (payload: { designerId: string; date: string; itemId?: string; sheet?: TaskSheet; merged: boolean }) => void;
}

// 选中的枪名在目标日期已存在「确认图修改」任务（合并候选）
interface MergeCandidate {
  itemId: string;
  taskName: string;
  guns: { id: string; name: string; hours: number | string }[];
}

const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// YYYY-MM-DD → M/D，用于归属信息展示
const shortDate = (date: string) => {
  const parts = String(date || '').split('-');
  if (parts.length < 3) return date || '';
  return `${Number(parts[1])}/${Number(parts[2])}`;
};

// 归属按设计员分组：同一个人名合并成一行（日期并列展示），不同人名分行
const groupOwnersByDesigner = (owners: GunNameOwner[]) => {
  const groups = new Map<string, { key: string; designerId: string; designerName: string; owners: GunNameOwner[] }>();
  owners.forEach(owner => {
    const key = String(owner.designerId || owner.designerName || '');
    const group = groups.get(key);
    if (group) {
      group.owners.push(owner);
    } else {
      groups.set(key, {
        key,
        designerId: owner.designerId,
        designerName: owner.designerName || '未知设计员',
        owners: [owner],
      });
    }
  });
  groups.forEach(group => group.owners.sort((a, b) => String(b.date).localeCompare(String(a.date))));
  return Array.from(groups.values());
};


// 尾部任务类型（与 utils.splitDesignTaskName 的识别口径一致）
const TASK_TYPE_SUFFIX_RE = /\s*(确认图修改|确认图|设计变更|既制审图|设计)$/;

// 台账未填写客户/仕样时：沿用该枪名原有任务名，只把尾部类型（确认图 / 设计…）换成「确认图修改」，
// 其余部分（含交付日期标记 [m/d]）原样保留
const buildTaskNameFromExisting = (existingTaskName: string) => {
  const trimmed = String(existingTaskName || '').trim();
  if (!trimmed) return '';
  const deadlineMatch = trimmed.match(/(\[\d{1,2}\/\d{1,2}\])$/);
  const deadline = deadlineMatch ? deadlineMatch[1] : '';
  const head = deadline ? trimmed.slice(0, trimmed.length - deadline.length).trim() : trimmed;
  const base = head.replace(TASK_TYPE_SUFFIX_RE, '').trim() || head;
  return `${base} 确认图修改${deadline ? ` ${deadline}` : ''}`;
};

// 自动带出的任务名：客户/仕样串 + 确认图修改（与台账页「客户 + 确认图」的命名规则一致）；
// 台账没填客户/仕样时，沿用该枪名原来所在任务的名称，只把尾部类型换成「确认图修改」
const buildAutoTaskName = (result: GunNameSearchResult) => {
  const customer = String(result.customer || '').trim();
  if (customer) return `${customer} 确认图修改`;
  const existing = String(result.owners[0]?.taskName || '').trim();
  return buildTaskNameFromExisting(existing) || `${result.gunName.trim()} 确认图修改`;
};

const stepBadge = (index: string) => (
  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#217346] text-white text-[11px] font-bold shrink-0">
    {index}
  </span>
);

const QuickConfirmModifyModal: React.FC<QuickConfirmModifyModalProps> = ({
  open,
  onClose,
  designers,
  gunLocations,
  addToast,
  onCreated,
}) => {
  const { settings: systemSettings, specNumberDigits } = useSystemSettings();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GunNameSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  // 全表搜索：默认关闭，只在「日期」所在月份里搜；打开后搜所有月份
  const [fullSearch, setFullSearch] = useState(false);
  // 显示纳期：默认打开，任务名中的仕样号能查到纳期时自动带上 [M/D]
  const [showDeadline, setShowDeadline] = useState(true);
  const [deadlineLoading, setDeadlineLoading] = useState(false);

  const [selected, setSelected] = useState<GunNameSearchResult | null>(null);
  const [designerId, setDesignerId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [hours, setHours] = useState('');
  // 任务名称（默认自动带出，可手动修改）
  const [taskNameDraft, setTaskNameDraft] = useState('');

  const [dayItems, setDayItems] = useState<TaskItem[]>([]);
  const [checking, setChecking] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const resultsListRef = useRef<HTMLUListElement | null>(null);
  const requestSeqRef = useRef(0);
  // 纳期查询序号：快速切换枪名时丢弃过期的查询结果
  const deadlineSeqRef = useRef(0);

  // 设计人员下拉选项：与 /gun-ledger 分配面板一致——过滤隐藏人员 + 按姓名拼音升序
  const designerOptions = useMemo(
    () => designers
      .filter(d => !d.hidden)
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN')),
    [designers]
  );

  // 从文本中提取仕样号（与系统配置位数一致，和台账页分配逻辑保持一致）
  const extractSpecs = useCallback((text: string): string[] => {
    const raw = String(text || '');
    if (!raw.trim() || !specNumberDigits) return [];
    const re = new RegExp(`(?<!\\d)\\d{${specNumberDigits}}(?!\\d)`, 'g');
    return Array.from(new Set(raw.match(re) || []));
  }, [specNumberDigits]);

  // 自动带出的任务名（仅作默认值，用户可在「任务名称」里手动改）
  const autoTaskName = useMemo(() => (selected ? buildAutoTaskName(selected) : ''), [selected]);

  const selectedSpecs = useMemo(
    () => extractSpecs(taskNameDraft),
    [taskNameDraft, extractSpecs]
  );

  // 目标日期下与之仕样号相同的已有「确认图修改」任务（合并候选）
  const mergeCandidates = useMemo<MergeCandidate[]>(() => {
    if (!selected || selectedSpecs.length === 0) return [];
    return dayItems
      .filter(item => {
        if (!item?.id || item.leaveType) return false;
        const name = String(item.taskName || '');
        if (!name.includes('确认图修改')) return false;
        const specs = extractSpecs(name);
        return specs.some(s => selectedSpecs.includes(s));
      })
      .map(item => ({
        itemId: String(item.id),
        taskName: String(item.taskName || ''),
        guns: Array.isArray(item.guns) ? item.guns : [],
      }));
  }, [dayItems, selected, selectedSpecs, extractSpecs]);

  // 该枪名当天是否已被安排过（任意任务）
  const duplicateTask = useMemo(() => {
    if (!selected) return null;
    const name = selected.gunName.trim();
    if (!name) return null;
    return dayItems.find(item => (item.guns || []).some(g => String(g?.name || '').trim() === name)) || null;
  }, [dayItems, selected]);

  // 该枪名所在任务对应的设计员（默认设计人员）
  const defaultDesignerId = useMemo(() => {
    if (!selected || selected.owners.length === 0) return '';
    const owner = selected.owners[0];
    return designerOptions.some(d => d.id === owner.designerId) ? owner.designerId : '';
  }, [selected, designerOptions]);

  // 该枪名的安排按设计员分组（多个人名时可在「安排到」里点选）
  const ownerGroups = useMemo(
    () => (selected ? groupOwnersByDesigner(selected.owners) : []),
    [selected]
  );

  const defaultDesignerName = useMemo(
    () => designerOptions.find(d => d.id === defaultDesignerId)?.name || '',
    [designerOptions, defaultDesignerId]
  );

  // 所有命中的归属条数（一个枪名可能被安排在多天/多条任务里）
  const totalOwners = useMemo(
    () => results.reduce((sum, r) => sum + (r.owners?.length || 0), 0),
    [results]
  );

  const hoursNumber = parseFloat(hours);
  const hoursValid = Number.isFinite(hoursNumber) && hoursNumber > 0;

  // 搜索范围：「日期」所在月份（默认今天所在月），全表搜索打开后不再限制月份
  const scope = useMemo(() => {
    const [yearStr, monthStr] = String(date || todayStr()).split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const now = new Date();
    const safeYear = Number.isFinite(year) ? year : now.getFullYear();
    const safeMonth = Number.isFinite(month) ? month : now.getMonth() + 1;
    return { year: safeYear, month: safeMonth, label: `${safeYear} 年 ${safeMonth} 月` };
  }, [date]);

  // 打开时重置状态并聚焦搜索框
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults([]);
    setSearchError('');
    setActiveIndex(0);
    setFullSearch(false);
    setShowDeadline(true);
    setDeadlineLoading(false);
    deadlineSeqRef.current += 1;
    setSelected(null);
    setDesignerId('');
    setDate(todayStr());
    setHours('');
    setTaskNameDraft('');
    setDayItems([]);
    setMergeMode(false);
    setMergeTargetId('');
    setSubmitting(false);
    const timer = window.setTimeout(() => searchInputRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
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

  const fetchGunNames = useCallback(async (keyword: string) => {
    const seq = ++requestSeqRef.current;
    setSearching(true);
    setSearchError('');
    try {
      const res = await axiosInstance.get('/tasks/gun-name-search', {
        params: {
          q: keyword.trim(),
          limit: 24,
          allMonths: fullSearch ? 'true' : 'false',
          year: scope.year,
          month: scope.month,
        },
      });
      if (seq !== requestSeqRef.current) return;
      setResults(Array.isArray(res.data?.results) ? res.data.results : []);
      setActiveIndex(0);
    } catch (err: any) {
      if (seq !== requestSeqRef.current) return;
      setResults([]);
      const message = err?.response?.data?.message;
      if (err?.response?.status === 403) {
        setSearchError(message || '只有管理员可以使用该快捷操作');
      } else if (!err?.response) {
        setSearchError('无法连接服务器');
      } else {
        setSearchError(message || '枪名搜索失败');
      }
    } finally {
      if (seq === requestSeqRef.current) setSearching(false);
    }
  }, [fullSearch, scope.year, scope.month]);

  // 输入防抖查询：空关键字不请求（不展示「最近安排过的枪名」）
  useEffect(() => {
    if (!open) return;
    const keyword = query.trim();
    if (!keyword) {
      requestSeqRef.current += 1;
      setResults([]);
      setSearching(false);
      setSearchError('');
      return;
    }
    const timer = window.setTimeout(() => { void fetchGunNames(keyword); }, 260);
    return () => window.clearTimeout(timer);
  }, [open, query, fetchGunNames]);

  // 拉取目标设计员当天的任务，用于「相同仕样号合并」与「重复枪名」提示
  useEffect(() => {
    if (!open || !selected || !designerId || !date) {
      setDayItems([]);
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
        const sheet = sheets.find((s: TaskSheet) => s.designerId === designerId);
        const items = Array.isArray(sheet?.days?.[date]) ? sheet!.days[date] : [];
        setDayItems(items);
      })
      .catch(() => { if (!cancelled) setDayItems([]); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [open, selected, designerId, date]);

  // 合并选择随候选变化重置：**默认勾选**（发现相同仕样号时不再需要手动勾）
  // 用候选签名判重，避免用户手动取消勾选后被状态刷新重新勾上
  const mergeSignature = `${designerId}|${date}|${selected?.gunName || ''}|${mergeCandidates.map(c => c.itemId).join(',')}`;
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

  // 按任务名里的仕样号自动补纳期（显示纳期开关关闭时不做任何事）；
  // 只有当前输入框内容仍是这条自动名称时才写入，避免覆盖用户的手动修改
  const applyAutoDeadline = useCallback((baseName: string) => {
    const seq = ++deadlineSeqRef.current;
    if (!showDeadline) {
      setDeadlineLoading(false);
      return;
    }
    setDeadlineLoading(true);
    void resolveTextDeadlineSuffix(baseName, specNumberDigits)
      .then(suffix => {
        if (seq !== deadlineSeqRef.current) return;
        setDeadlineLoading(false);
        if (!suffix) return;
        setTaskNameDraft(prev => (stripDeadlineSuffix(prev) === stripDeadlineSuffix(baseName)
          ? appendDeadlineSuffix(baseName, suffix)
          : prev));
      })
      .catch(() => {
        if (seq === deadlineSeqRef.current) setDeadlineLoading(false);
      });
  }, [showDeadline, specNumberDigits]);

  const handleSelect = useCallback((result: GunNameSearchResult) => {
    setSelected(result);
    const ownerId = result.owners[0]?.designerId || '';
    setDesignerId(designerOptions.some(d => d.id === ownerId) ? ownerId : '');
    setDate(todayStr());
    // 工时取「确认图修改」规则：接口回传的台账位置最准（实时），本地缓存仅作兜底
    const location = (result.category && result.tableName)
      ? { category: result.category, tableName: result.tableName }
      : (gunLocations[result.gunName] || null);
    const defaultHours = resolveAutoFillHours('confirmModify', result.gunName, location, systemSettings);
    setHours(defaultHours !== null && defaultHours !== undefined ? String(defaultHours) : '');
    // 任务名默认自动带出，仍可在「任务名称」里手动修改
    const autoName = buildAutoTaskName(result);
    setTaskNameDraft(autoName);
    setSearchError('');
    // 显示纳期：任务名里能提取到仕样号时，自动补上 [M/D]
    applyAutoDeadline(autoName);
  }, [designerOptions, gunLocations, systemSettings, applyAutoDeadline]);

  // 切换「显示纳期」：关闭时移除任务名末尾的纳期，打开时按仕样号重新查询并补上
  const handleDeadlineToggle = useCallback(async (next: boolean) => {
    setShowDeadline(next);
    const seq = ++deadlineSeqRef.current;
    if (!next) {
      setDeadlineLoading(false);
      setTaskNameDraft(prev => stripDeadlineSuffix(prev));
      return;
    }
    const base = stripDeadlineSuffix(taskNameDraft);
    if (!base) return;
    setDeadlineLoading(true);
    try {
      const suffix = await resolveTextDeadlineSuffix(base, specNumberDigits);
      if (seq !== deadlineSeqRef.current) return;
      if (suffix) setTaskNameDraft(appendDeadlineSuffix(base, suffix));
    } finally {
      if (seq === deadlineSeqRef.current) setDeadlineLoading(false);
    }
  }, [taskNameDraft, specNumberDigits]);

  // 选中枪名后把结果列表里对应的那一行滚动到可视区域（列表常驻，可能已滚出视野）
  useEffect(() => {
    if (!selected || !resultsListRef.current) return;
    const index = results.findIndex(r => r.gunName === selected.gunName);
    if (index < 0) return;
    const row = resultsListRef.current.children[index] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [selected, results]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (results.length ? (prev + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (results.length ? (prev - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      const target = results[activeIndex];
      if (target) {
        e.preventDefault();
        handleSelect(target);
      }
    }
  };

  // 搜索无结果时直接把输入值当枪名使用（台账里还没登记的枪名）
  const useRawGunName = useCallback(() => {
    const name = query.trim();
    if (!name) return;
    handleSelect({ gunName: name, customer: '', category: '', tableName: '', owners: [] });
  }, [query, handleSelect]);

  const mergeTarget = mergeMode
    ? mergeCandidates.find(c => c.itemId === mergeTargetId) || null
    : null;

  const canSubmit = Boolean(selected && designerId && date && hoursValid && taskNameDraft.trim()) && !submitting;

  const handleSubmit = async () => {
    if (!selected || !designerId || !date) {
      addToast('请选择枪名、设计人员和日期', 'error');
      return;
    }
    if (!hoursValid) {
      addToast('工时必须大于 0', 'error');
      return;
    }
    const finalTaskName = taskNameDraft.trim();
    if (!finalTaskName) {
      addToast('请填写任务名称', 'error');
      return;
    }
    setSubmitting(true);
    try {
      // 显示纳期：提交前再做一次兜底——任务名里有仕样号但还没带纳期时补上
      // （预览阶段的查询可能因为切换枪名被丢弃，或用户手动改了名称）
      let submitTaskName = finalTaskName;
      if (showDeadline && !mergeTarget) {
        const suffix = await resolveTextDeadlineSuffix(finalTaskName, specNumberDigits);
        if (suffix) submitTaskName = appendDeadlineSuffix(finalTaskName, suffix);
      }
      const gunPayload = {
        id: `gun-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: selected.gunName.trim(),
        hours: hoursNumber,
      };

      if (mergeTarget) {
        const allGuns = [...mergeTarget.guns, gunPayload];
        await axiosInstance.put('/tasks/item', {
          designerId,
          date,
          itemId: mergeTarget.itemId,
          field: 'guns',
          value: allGuns,
        });
        const totalHours = allGuns.reduce((sum, g) => sum + (parseFloat(String(g.hours)) || 0), 0);
        const res = await axiosInstance.put('/tasks/item', {
          designerId,
          date,
          itemId: mergeTarget.itemId,
          field: 'hours',
          value: totalHours,
        });
        onCreated({ designerId, date, itemId: mergeTarget.itemId, sheet: res.data?.sheet, merged: true });
        addToast(`已将「${selected.gunName}」添加到已有确认图修改任务`, 'success');
      } else {
        const pool = PRESET_COLORS.filter(c => c.value);
        const color = systemSettings.randomAssignmentColor
          ? pool[Math.floor(Math.random() * pool.length)]?.value || '#86efac'
          : '#86efac';
        const res = await axiosInstance.post('/tasks/item/batch', {
          designerId,
          date,
          items: [{
            taskName: submitTaskName,
            hours: hoursNumber,
            color,
            guns: [gunPayload],
            leaveType: null,
          }],
        });
        onCreated({ designerId, date, itemId: res.data?.items?.[0]?.id, sheet: res.data?.sheet, merged: false });
        const designerLabel = designerOptions.find(d => d.id === designerId)?.name || '设计人员';
        addToast(`已为 ${designerLabel} 添加确认图修改：${selected.gunName}`, 'success');
      }
      onClose();
    } catch (err: any) {
      addToast(err?.response?.data?.message || '添加确认图修改失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => !submitting && onClose()} />
      <div className="relative bg-white rounded-xl shadow-2xl w-[580px] max-w-[94vw] max-h-[90vh] flex flex-col overflow-hidden border border-gray-200">
        {/* 头部 */}
        <div className="relative flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-[#1c6638] via-[#217346] to-[#2a8a57] text-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white/15 border border-white/25">
              <Zap size={17} />
            </div>
            <div>
              <div className="font-bold text-base leading-tight">快速添加确认图修改</div>
              <div className="text-[11px] opacity-80 leading-tight mt-0.5">搜索枪名 → 带出所属设计员 → 安排到某天任务</div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            {/* 显示纳期开关：打开后任务名自动带上仕样号纳期 [M/D]（默认打开） */}
            <button
              type="button"
              role="switch"
              aria-checked={showDeadline}
              disabled={submitting}
              onClick={() => { void handleDeadlineToggle(!showDeadline); }}
              title={showDeadline
                ? '已开启：任务名里的仕样号能查到纳期时自动带上 [M/D]'
                : '已关闭：任务名不带纳期'}
              className={`flex items-center gap-1.5 px-1.5 py-1 rounded-full transition cursor-pointer disabled:opacity-50 ${showDeadline ? 'bg-white/15' : 'hover:bg-white/10'}`}
            >
              <span className="text-[11px] font-semibold text-white/90 whitespace-nowrap">
                显示纳期{deadlineLoading ? '…' : ''}
              </span>
              <span
                className={`relative inline-block w-8 h-4 rounded-full transition-colors ${showDeadline ? 'bg-white' : 'bg-white/30'}`}
              >
                <span
                  className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${showDeadline ? 'left-[18px] bg-[#217346]' : 'left-0.5 bg-white'}`}
                />
              </span>
            </button>
            {/* 全表搜索开关：关闭时只搜「日期」所在月份 */}
            <button
              type="button"
              role="switch"
              aria-checked={fullSearch}
              disabled={submitting}
              onClick={() => setFullSearch(v => !v)}
              title={fullSearch
                ? '已开启：搜索所有月份的任务'
                : `已关闭：只搜索 ${scope.label} 的任务，开启后可搜历史月份`}
              className={`flex items-center gap-1.5 px-1.5 py-1 rounded-full transition cursor-pointer disabled:opacity-50 ${fullSearch ? 'bg-white/15' : 'hover:bg-white/10'}`}
            >
              <span className="text-[11px] font-semibold text-white/90 whitespace-nowrap">全表搜索</span>
              <span
                className={`relative inline-block w-8 h-4 rounded-full transition-colors ${fullSearch ? 'bg-white' : 'bg-white/30'}`}
              >
                <span
                  className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${fullSearch ? 'left-[18px] bg-[#217346]' : 'left-0.5 bg-white'}`}
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
          {/* 步骤 1：选择枪名（搜索结果列表常驻，全部命中都可见，选中行高亮打勾） */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              {stepBadge('1')}
              <span className="text-sm font-bold text-gray-800">选择枪名</span>
              <span className="text-[11px] text-gray-400 ml-auto">
                {selected
                  ? '已选中，可继续搜索更换'
                  : fullSearch ? '全表搜索：所有月份' : `仅搜索 ${scope.label}`}
              </span>
            </div>

            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="输入枪名关键字，例如 SRTC-2C15"
                className="w-full h-11 pl-9 pr-9 bg-white border-2 border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-300 transition"
              />
              {searching && (
                <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600 animate-spin" />
              )}
            </div>

            <div className="mt-2 rounded-lg border border-gray-200 bg-white overflow-hidden">
              {searchError ? (
                <div className="px-3 py-3 text-[12px] text-red-600 flex items-center gap-2">
                  <AlertTriangle size={14} />{searchError}
                </div>
              ) : results.length === 0 ? (
                <div className="px-3 py-4 text-[12px] text-gray-400 text-center">
                  {searching
                    ? '正在搜索枪名...'
                    : query.trim()
                      ? (fullSearch ? '台账中没有匹配的枪名' : `${scope.label}没有匹配的枪名`)
                      : '输入枪名关键字开始搜索'}
                  {!searching && query.trim() && (
                    <div className="mt-2 flex items-center justify-center gap-2">
                      {!fullSearch && (
                        <button
                          onClick={() => setFullSearch(true)}
                          className="px-3 py-1.5 rounded-md border border-emerald-300 bg-emerald-50 text-[12px] text-emerald-700 hover:bg-emerald-100 transition"
                        >
                          搜索全部月份
                        </button>
                      )}
                      <button
                        onClick={useRawGunName}
                        className="px-3 py-1.5 rounded-md border border-gray-300 text-[12px] text-gray-600 hover:bg-gray-50 transition"
                      >
                        直接使用「{query.trim()}」
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-[11px] text-gray-500">
                    <span>
                      共 <span className="font-bold text-gray-700">{results.length}</span> 个枪名
                      {totalOwners > results.length && (
                        <span className="text-gray-400">（{totalOwners} 处安排）</span>
                      )}
                    </span>
                    <span className="text-gray-400">方向键选择，Enter 确认</span>
                  </div>
                  <ul ref={resultsListRef} className="max-h-[280px] overflow-auto divide-y divide-gray-100">
                    {results.map((result, index) => {
                      const active = index === activeIndex;
                      const chosen = selected?.gunName === result.gunName;
                      return (
                        <li key={result.gunName}>
                          <button
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={() => handleSelect(result)}
                            className={`w-full flex items-center gap-3 px-3 py-2 text-left transition ${chosen
                              ? 'bg-emerald-50 ring-1 ring-inset ring-emerald-300'
                              : active ? 'bg-emerald-50/60' : 'hover:bg-gray-50'}`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="font-mono text-[13px] font-bold text-gray-800 truncate">{result.gunName}</div>
                              <div className="text-[11px] text-gray-500 truncate mt-0.5">
                                {result.customer || '未填写客户 / 仕样'}
                                {result.tableName ? ` · ${result.category}/${result.tableName}` : ''}
                              </div>
                            </div>
                            {result.owners.length > 0 ? (() => {
                              const groups = groupOwnersByDesigner(result.owners);
                              return (
                                <span
                                  title={result.owners
                                    .map(o => `${o.designerName} · ${o.taskName || '（无任务名）'} · ${o.date} · ${o.gunHours}h`)
                                    .join('\n')}
                                  className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-blue-100 bg-blue-50 text-[11px] text-blue-700 max-w-[46%]"
                                >
                                  <Users size={11} className="shrink-0" />
                                  <span className="truncate">
                                    {groups.map(g => g.designerName).join('、')}
                                  </span>
                                  {result.owners.length > 1 && (
                                    <span className="shrink-0 text-blue-400">· {result.owners.length} 处</span>
                                  )}
                                </span>
                              );
                            })() : (
                              <span className="shrink-0 text-[11px] text-gray-300">未安排</span>
                            )}
                            {chosen && <Check size={14} className="shrink-0 text-[#217346]" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </section>

          {/* 步骤 2：安排到 */}
          {selected && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                {stepBadge('2')}
                <span className="text-sm font-bold text-gray-800">安排到</span>
                {defaultDesignerName && ownerGroups.length <= 1 && (
                  <span className="text-[11px] text-gray-400 ml-auto truncate">
                    {designerId === defaultDesignerId
                      ? `默认：${defaultDesignerName}（该枪名所在任务的设计员）`
                      : `原负责人：${defaultDesignerName}`}
                  </span>
                )}
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
                      className="w-full h-9 px-2 bg-gray-50 border border-gray-200 rounded-md text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition"
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
                      className="w-full h-9 px-2 bg-gray-50 border border-gray-200 rounded-md text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition"
                    />
                  </div>
                </div>

                {ownerGroups.length > 1 && (
                  <div className="rounded-md border border-blue-100 bg-blue-50/60 px-2.5 py-2">
                    <div className="flex items-center gap-1 text-[11px] font-bold text-blue-700">
                      <Users size={11} />
                      该枪名有 {ownerGroups.length} 位设计员，点选一位作为默认
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {ownerGroups.map(group => {
                        const active = designerId === group.designerId;
                        return (
                          <button
                            key={group.key}
                            type="button"
                            disabled={submitting}
                            onClick={() => setDesignerId(group.designerId)}
                            title={group.owners
                              .map(o => `${o.taskName || '（无任务名）'} · ${o.date} · ${o.gunHours}h`)
                              .join('\n')}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] transition disabled:opacity-60 ${active
                              ? 'bg-[#217346] border-[#217346] text-white shadow-sm'
                              : 'bg-white border-blue-200 text-blue-700 hover:border-blue-300 hover:bg-blue-50'}`}
                          >
                            <User size={11} className="shrink-0" />
                            <span className="font-semibold">{group.designerName}</span>
                            <span className={active ? 'text-white/75' : 'text-blue-400'}>
                              {group.owners.map(o => shortDate(o.date)).join('、')}
                            </span>
                            {group.owners.length > 1 && (
                              <span className={active ? 'text-white/60' : 'text-blue-300'}>×{group.owners.length}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-[120px_1fr] gap-3 items-end">
                  <div className="flex flex-col gap-1">
                    <label className="flex items-center gap-1 text-[11px] font-bold text-gray-500">
                      <Clock3 size={11} />工时
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={0.25}
                      value={hours}
                      onChange={e => setHours(e.target.value)}
                      disabled={submitting}
                      className={`w-full h-9 px-2 bg-gray-50 border rounded-md text-sm outline-none focus:ring-2 focus:bg-white transition ${hours && !hoursValid ? 'border-red-300 focus:ring-red-300' : 'border-gray-200 focus:ring-emerald-400'}`}
                    />
                  </div>
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <label className="text-[11px] font-bold text-gray-500">任务名称</label>
                      {showDeadline && (
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${hasDeadlineSuffix(taskNameDraft)
                            ? 'text-red-600 bg-red-50 border-red-200'
                            : deadlineLoading
                              ? 'text-gray-400 bg-gray-50 border-gray-200'
                              : 'text-gray-400 bg-gray-50 border-gray-200'}`}
                          title="按任务名中的仕样号查询仕样书纳期，自动拼到任务名末尾"
                        >
                          {deadlineLoading ? '纳期查询中…' : hasDeadlineSuffix(taskNameDraft) ? '已带纳期' : '无纳期'}
                        </span>
                      )}
                      {taskNameDraft.trim() !== autoTaskName.trim() && (
                        <button
                          onClick={() => {
                            setTaskNameDraft(autoTaskName);
                            applyAutoDeadline(autoTaskName);
                          }}
                          disabled={submitting}
                          className="ml-auto text-[10px] font-semibold text-blue-600 hover:text-blue-700 hover:underline disabled:opacity-50"
                          title="恢复为自动带出的任务名称"
                        >
                          恢复默认
                        </button>
                      )}
                    </div>
                    <input
                      value={taskNameDraft}
                      onChange={e => setTaskNameDraft(e.target.value)}
                      disabled={submitting}
                      placeholder="任务名称（可修改）"
                      title={taskNameDraft}
                      className={`w-full h-9 px-2 rounded-md bg-pink-50/70 border text-[12px] text-pink-700 outline-none focus:ring-2 focus:bg-white transition ${taskNameDraft.trim() ? 'border-pink-100 focus:ring-emerald-400' : 'border-red-300 focus:ring-red-300'}`}
                    />
                  </div>
                </div>

                {selected.owners.length === 0 && (
                  <div className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    该枪名还没有安排在任何任务里，请手动选择设计人员
                  </div>
                )}

                {duplicateTask && (
                  <div className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    该枪名当天已在任务「{duplicateTask.taskName || '（无任务名）'}」中，请确认是否重复添加
                  </div>
                )}

                {checking && (
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                    <RefreshCw size={11} className="animate-spin" />正在检测当天已有的确认图修改任务...
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
                        发现 <span className="font-bold">{mergeCandidates.length}</span> 个相同仕样号的确认图修改任务，勾选后把枪名
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
                              name="quick-merge-target"
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
              </div>
            </section>
          )}
        </div>

        {/* 底部 */}
        <div className="shrink-0 px-5 py-3 border-t border-gray-100 bg-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-1 text-[11px] text-gray-400 min-w-0">
            <Sparkles size={11} className="shrink-0" />
            <span className="truncate">Shift × 2 呼出 · Esc 关闭</span>
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
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#217346] text-white hover:bg-[#1c6638] transition disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {submitting ? '添加中...' : mergeTarget ? '添加到已有任务' : '确认添加'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuickConfirmModifyModal;
