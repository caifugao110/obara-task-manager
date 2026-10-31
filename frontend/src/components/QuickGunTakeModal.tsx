import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  ClipboardList,
  Copy,
  Hash,
  Loader2,
  Lock,
  Minus,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { axiosInstance } from '../services/api';
import { useSystemSettings } from '../context/SystemSettingsContext';
import { acquireSocket } from '../utils/socketClient';
import { resolveGunHours } from '../utils/gunHoursRules';
import QuickConfirmAssignModal, { type QuickConfirmGunRow } from './QuickConfirmAssignModal';

/** 表级编辑锁持有者（lockedBy.self 表示锁由当前登录人自己持有，如另一个标签页开着台账） */
interface QuickTakeLock {
  name: string;
  username: string;
  self: boolean;
}

/** 表的焊枪名规则：前端据此预览「连续取 N 个」时每个序号对应的枪名 */
interface QuickTakeGunNameRule {
  prefix: string;
  start: number;
  pad: number;
}

/** 快速取号面板中的一张表：已取行数 / 下一个未取行号 / 规则预置枪名 / 锁状态 */
interface QuickTakeTable {
  id: string;
  name: string;
  takenCount: number;
  nextSerial: number;
  nextGunName: string;
  rule?: QuickTakeGunNameRule | null;
  hasRule: boolean;
  lastGunName: string;
  lastTakenAt: string;
  lockedBy: QuickTakeLock | null;
}

interface QuickTakeCategory {
  name: string;
  tables: QuickTakeTable[];
}

/** 今天由当前登录人取号的行（供「安排确认图」使用） */
interface QuickTakeTodayRow {
  rowId: string;
  gunName: string;
  customer: string;
  category: string;
  tableName: string;
  serialNumber: number;
}

interface QuickTakeOptions {
  categories: QuickTakeCategory[];
  defaultResponsiblePersons: string[];
  today: string;
  todayTaken?: QuickTakeTodayRow[];
}

interface LastTakenInfo {
  rows: { gunName: string; serialNumber: number }[];
  customer: string;
  category: string;
  tableName: string;
}

interface DesignerOption {
  id: string;
  name: string;
  group?: string;
  hidden?: boolean;
}

interface QuickGunTakeModalProps {
  open: boolean;
  onClose: () => void;
  addToast: (message: string, type: 'success' | 'error') => void;
  token?: string | null;
  currentUserId?: string;
  offline?: boolean;
  designers?: DesignerOption[];
}

// 记住上次取号用的表：同一批料常连续取号，下次呼出直接停在原表
const LAST_TABLE_KEY = 'quickGunTake.lastTableId';
const LAST_COUNT_KEY = 'quickGunTake.count';
// 单次连续取号上限（与后端 QUICK_TAKE_MAX_COUNT 保持一致）
const MAX_COUNT = 10;

const clampCount = (value: number) => {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_COUNT, Math.max(1, Math.round(value)));
};

const isLockedByOther = (table: QuickTakeTable | null | undefined) =>
  Boolean(table?.lockedBy && !table.lockedBy.self);

/** 按规则计算某个序号对应的焊枪名（与后端 buildGunNumber 一致） */
const buildGunName = (rule: QuickTakeGunNameRule | null | undefined, serialNumber: number) => {
  if (!rule) return '';
  const num = Number(rule.start || 0) + (serialNumber - 1);
  return `${rule.prefix || ''}${String(num).padStart(Number(rule.pad) || 4, '0')}`;
};


/**
 * 主页面「快速取号」弹窗（连按两次空格呼出）
 *
 * 与 /gun-ledger 页内的取号完全同源：选中分类 + 表格后，直接跳到该表「最新的未取行」
 * （已有行数 + 1），按表的焊枪名规则生成枪名并落库，时间/担当默认当天与当前操作者。
 *
 * 表级独占锁的语义在这里被严格执行：表格正被他人打开时，列表项置灰、不可取号，
 * 也不提供「只读查看」入口——弹窗内只做取号这一件事，避免与台账页的编辑锁互相干扰。
 */
const QuickGunTakeModal: React.FC<QuickGunTakeModalProps> = ({
  open,
  onClose,
  addToast,
  token,
  currentUserId,
  offline = false,
  designers = [],
}) => {
  const { specNumberDigits, settings: systemSettings } = useSystemSettings();

  const [options, setOptions] = useState<QuickTakeOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [activeCategory, setActiveCategory] = useState('');
  const [tableId, setTableId] = useState('');
  const [search, setSearch] = useState('');

  const [customer, setCustomer] = useState('');
  // 本次连续取号的数量（从最新未取行号起连续占用）
  const [count, setCount] = useState(1);
  const [countInput, setCountInput] = useState('1');

  const [resolvedClient, setResolvedClient] = useState<string | null>(null);
  const [specLoading, setSpecLoading] = useState(false);
  const [specNotFound, setSpecNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastTaken, setLastTaken] = useState<LastTakenInfo | null>(null);
  const [copied, setCopied] = useState(false);

  // 取号成功后的可选动作：把「我最近取的号」直接安排确认图任务
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignRows, setAssignRows] = useState<QuickConfirmGunRow[]>([]);

  const customerRef = useRef<HTMLInputElement | null>(null);
  const lastTakenRef = useRef<HTMLDivElement | null>(null);
  const specTimerRef = useRef<number | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  // 只认最后一次仕样号查询的结果，避免连续输入时旧响应覆盖新值
  const specSeqRef = useRef(0);

  const allTables = useMemo(
    () => (options?.categories || []).flatMap(c => c.tables.map(t => ({ ...t, category: c.name }))),
    [options]
  );

  const activeTable = useMemo(
    () => allTables.find(t => t.id === tableId) || null,
    [allTables, tableId]
  );

  const todayTakenCount = options?.todayTaken?.length || 0;

  const lockedByOther = isLockedByOther(activeTable);
  const tableUnavailable = !activeTable || lockedByOther || !activeTable.hasRule;

  // 数量归一化（1..50）：输入框可能短暂存在非法值，这里按最终值渲染预览与提交
  const safeCount = clampCount(count);
  const previewRows = useMemo(() => {
    if (!activeTable || !activeTable.rule) return [];
    return Array.from({ length: safeCount }, (_, i) => {
      const serial = activeTable.nextSerial + i;
      return { serial, gunName: buildGunName(activeTable.rule, serial) };
    });
  }, [activeTable, safeCount]);

  const filteredTables = useMemo(() => {
    const list = (options?.categories || []).find(c => c.name === activeCategory)?.tables || [];
    const keyword = search.trim().toLowerCase();
    if (!keyword) return list;
    return list.filter(t => t.name.toLowerCase().includes(keyword));
  }, [options, activeCategory, search]);

  const availableCount = useMemo(
    () => filteredTables.filter(t => !isLockedByOther(t) && t.hasRule).length,
    [filteredTables]
  );

  // 应用表锁状态：只改动 lockedBy 字段，其余（行数/下一行号）由 options 接口负责。
  // patch 中未出现的表在 partial=false（全量快照）时视为无锁；partial=true 时保持原状。
  const applyLocks = useCallback((
    patch: Map<string, { userId?: string; username?: string; name?: string } | null>,
    partial: boolean
  ) => {
    setOptions(prev => {
      if (!prev) return prev;
      const toLock = (holder: { userId?: string; username?: string; name?: string } | null | undefined): QuickTakeLock | null => {
        if (!holder) return null;
        return {
          name: holder.name || holder.username || '他人',
          username: holder.username || '',
          self: Boolean(currentUserId) && holder.userId === currentUserId,
        };
      };
      return {
        ...prev,
        categories: prev.categories.map(category => ({
          ...category,
          tables: category.tables.map(table => {
            if (partial && !patch.has(table.id)) return table;
            return { ...table, lockedBy: toLock(patch.get(table.id)) };
          }),
        })),
      };
    });
  }, [currentUserId]);

  const fetchOptions = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await axiosInstance.get('/gun-ledger/quick-take/options');
      const data = res.data as QuickTakeOptions;
      setOptions({
        categories: Array.isArray(data?.categories) ? data.categories : [],
        defaultResponsiblePersons: Array.isArray(data?.defaultResponsiblePersons) ? data.defaultResponsiblePersons : [],
        today: String(data?.today || ''),
        todayTaken: Array.isArray(data?.todayTaken) ? data.todayTaken : [],
      });
      setLoadError('');
    } catch (err: any) {
      const msg = err?.response?.data?.message || '无法加载焊枪台账数据';
      setLoadError(msg);
      if (silent) addToast(msg, 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [addToast]);

  // 打开时重置表单并拉取数据
  useEffect(() => {
    if (!open) return;
    setSearch('');
    setCustomer('');
    setResolvedClient(null);
    setSpecNotFound(false);
    setSpecLoading(false);
    setLastTaken(null);
    setCopied(false);
    setSubmitting(false);
    setLoadError('');
    setAssignOpen(false);
    setAssignRows([]);
    // 数量沿用上次的值：同一批料连续取号时通常数量相同
    const rememberedCount = (() => {
      try { return Number(localStorage.getItem(LAST_COUNT_KEY) || '') || 1; } catch { return 1; }
    })();
    const initialCount = clampCount(rememberedCount);
    setCount(initialCount);
    setCountInput(String(initialCount));
    void fetchOptions();
  }, [open, fetchOptions]);

  // 数据就绪后决定选中哪张表：优先恢复上次使用的表，否则取当前分类第一张可用表
  useEffect(() => {
    if (!open || !options) return;
    if (tableId && allTables.some(t => t.id === tableId)) return;
    const remembered = (() => {
      try { return localStorage.getItem(LAST_TABLE_KEY) || ''; } catch { return ''; }
    })();
    const rememberedTable = remembered ? allTables.find(t => t.id === remembered) : null;
    if (rememberedTable && !isLockedByOther(rememberedTable) && rememberedTable.hasRule) {
      setActiveCategory(rememberedTable.category);
      setTableId(rememberedTable.id);
      return;
    }
    const firstCategory = options.categories.find(c => c.tables.length > 0);
    if (!firstCategory) return;
    setActiveCategory(prev => (options.categories.some(c => c.name === prev) ? prev : firstCategory.name));
    const fallback = firstCategory.tables.find(t => !isLockedByOther(t) && t.hasRule);
    if (fallback) {
      setTableId(fallback.id);
    }
  }, [open, options, allTables, tableId]);

  // 表锁实时同步：共享连接上订阅锁事件，并主动索取一次最新快照
  useEffect(() => {
    if (!open || !token) return;
    const handle = acquireSocket(token);

    const toMap = (sessions: any[]) => {
      const map = new Map<string, { userId?: string; username?: string; name?: string } | null>();
      (Array.isArray(sessions) ? sessions : []).forEach(session => {
        if (session?.tableId) map.set(String(session.tableId), session);
      });
      return map;
    };

    handle.on('gun_ledger_table_locks_state', (sessions: any[]) => {
      applyLocks(toMap(sessions), false);
    });
    const cached = handle.getSnapshot<any[]>('gun_ledger_table_locks_state');
    if (cached) applyLocks(toMap(cached), false);
    handle.socket.emit('request_state', { event: 'gun_ledger_table_locks_state' });

    handle.on('gun_ledger_table_locked', (holder: any) => {
      if (!holder?.tableId) return;
      applyLocks(new Map([[String(holder.tableId), holder]]), true);
    });
    handle.on('gun_ledger_table_unlocked', (data: any) => {
      if (!data?.tableId) return;
      applyLocks(new Map([[String(data.tableId), null]]), true);
    });

    // 其他客户端取号/改行后，下一行号会变：静默重取一次
    handle.on('gun_ledger_updated', (data: any) => {
      if (data?.action !== 'update_rows' && data?.action !== 'delete_table' && data?.action !== 'add_table') return;
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => { void fetchOptions(true); }, 250);
    });

    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      handle.release();
    };
  }, [open, token, applyLocks, fetchOptions]);

  // 取号成功后把结果面板滚进视野：右侧表单区可滚动，成功提示常在折叠线以下
  useEffect(() => {
    if (!lastTaken) return;
    const timer = window.setTimeout(() => {
      lastTakenRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [lastTaken]);

  // 打开后聚焦客户输入框
  useEffect(() => {
    if (!open || !tableId) return;
    const timer = window.setTimeout(() => customerRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [open, tableId]);

  // Esc 关闭（提交中或确认图安排浮层打开时不响应，先关上层）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || submitting || assignOpen) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, submitting, assignOpen, onClose]);

  // 输入纯仕样号时自动解析客户名（与台账页行为一致）
  const scheduleSpecLookup = useCallback((raw: string) => {
    if (specTimerRef.current) window.clearTimeout(specTimerRef.current);
    setResolvedClient(null);
    setSpecNotFound(false);
    const trimmed = raw.trim();
    const digits = Number(specNumberDigits) || 0;
    if (!digits || !new RegExp(`^\\d{${digits}}$`).test(trimmed)) {
      setSpecLoading(false);
      return;
    }
    const seq = ++specSeqRef.current;
    setSpecLoading(true);
    specTimerRef.current = window.setTimeout(async () => {
      try {
        const res = await axiosInstance.post('/spec/spec-info', { specNumber: trimmed }, { timeout: 15000 } as any);
        if (seq !== specSeqRef.current) return;
        const clientName = String(res.data?.clientName || '').trim();
        if (clientName) setResolvedClient(clientName);
        else setSpecNotFound(true);
      } catch {
        if (seq === specSeqRef.current) setSpecNotFound(true);
      } finally {
        if (seq === specSeqRef.current) setSpecLoading(false);
      }
    }, 450);
  }, [specNumberDigits]);

  const handleCustomerChange = useCallback((value: string) => {
    setCustomer(value);
    scheduleSpecLookup(value);
  }, [scheduleSpecLookup]);

  // 关闭弹窗时清掉未触发的仕样号查询，避免回调落到已关闭的弹窗上
  useEffect(() => {
    if (open) return;
    if (specTimerRef.current) {
      window.clearTimeout(specTimerRef.current);
      specTimerRef.current = null;
    }
    setSpecLoading(false);
  }, [open]);

  const selectTable = useCallback((table: QuickTakeTable & { category: string }) => {
    if (isLockedByOther(table)) return;
    setTableId(table.id);
    setActiveCategory(table.category);
    setLastTaken(null);
    try { localStorage.setItem(LAST_TABLE_KEY, table.id); } catch { /* 隐私模式忽略 */ }
    window.setTimeout(() => customerRef.current?.focus(), 30);
  }, []);

  // 切换分类：右侧表单跟着切到该分类下第一张可用的表，避免列表与表单对不上
  const handleSelectCategory = useCallback((categoryName: string) => {
    setActiveCategory(categoryName);
    setSearch('');
    const current = allTables.find(t => t.id === tableId);
    if (current && current.category === categoryName) return;
    const list = (options?.categories || []).find(c => c.name === categoryName)?.tables || [];
    const next = list.find(t => !isLockedByOther(t) && t.hasRule) || null;
    setTableId(next ? next.id : '');
    setLastTaken(null);
    if (next) {
      try { localStorage.setItem(LAST_TABLE_KEY, next.id); } catch { /* 隐私模式忽略 */ }
    }
  }, [allTables, tableId, options]);

  // 数量变化：写入 state 与本地记忆，输入框保留用户正在敲的原文
  const commitCount = useCallback((next: number) => {
    const value = clampCount(next);
    setCount(value);
    setCountInput(String(value));
    try { localStorage.setItem(LAST_COUNT_KEY, String(value)); } catch { /* 隐私模式忽略 */ }
  }, []);

  // 「−/+」按增量更新：连点时以最新 state 为基准，避免两次点击读到同一个旧值
  const bumpCount = useCallback((delta: number) => {
    setCount(prev => {
      const next = clampCount(prev + delta);
      if (next === prev) return prev;
      setCountInput(String(next));
      try { localStorage.setItem(LAST_COUNT_KEY, String(next)); } catch { /* 隐私模式忽略 */ }
      return next;
    });
  }, []);

  const handleCountInput = useCallback((raw: string) => {
    const digits = raw.replace(/[^\d]/g, '').slice(0, 2);
    setCountInput(digits);
    if (digits === '') return;
    setCount(clampCount(Number(digits)));
  }, []);

  const handleCountBlur = useCallback(() => {
    commitCount(count);
  }, [commitCount, count]);

  const canSubmit = Boolean(
    activeTable
    && !tableUnavailable
    && customer.trim()
    && !submitting
    && !offline
  );

  const handleSubmit = useCallback(async () => {
    if (!activeTable) {
      addToast('请先选择要取号的表格', 'error');
      return;
    }
    if (lockedByOther) {
      addToast(`表「${activeTable.name}」正由「${activeTable.lockedBy?.name}」编辑，暂时不能取号`, 'error');
      return;
    }
    if (!activeTable.hasRule) {
      addToast('该表未配置焊枪名规则，无法自动取号', 'error');
      return;
    }
    if (!customer.trim()) {
      addToast('请填写客户或仕样号', 'error');
      customerRef.current?.focus();
      return;
    }
    if (offline) {
      addToast('当前离线，禁止编辑', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await axiosInstance.post(`/gun-ledger/tables/${activeTable.id}/quick-take`, {
        customer: (resolvedClient || customer).trim(),
        count: safeCount,
      });
      const data = res.data || {};
      const createdRows = (Array.isArray(data.rows) ? data.rows : []).map((r: any) => ({
        gunName: String(r?.gunName || ''),
        serialNumber: Number(r?.serialNumber) || 0,
      }));
      setLastTaken({
        rows: createdRows.length ? createdRows : [{ gunName: String(data.gunName || ''), serialNumber: Number(data.serialNumber) || 0 }],
        customer: String(data.row?.customer || customer).trim(),
        category: activeTable.category,
        tableName: activeTable.name,
      });
      const created = createdRows.length || 1;
      addToast(
        created > 1
          ? `已连续取号 ${created} 个：${data.gunName || ''} ~ ${data.lastGunName || ''}（序号 ${data.serialNumber}–${data.lastSerialNumber}）`
          : `已取号 ${data.gunName || ''}（序号 ${data.serialNumber ?? ''}）`,
        'success'
      );
      // 表单复位：客户清空、备注清空、担当与数量保留，下一号立即可继续取
      setCustomer('');
      setResolvedClient(null);
      setSpecNotFound(false);
      setCopied(false);
      await fetchOptions(true);
      window.setTimeout(() => customerRef.current?.focus(), 50);
    } catch (err: any) {
      addToast(err?.response?.data?.message || '取号失败，请重试', 'error');
      // 锁冲突：重新拉一次，让列表显示最新持有者
      if (err?.response?.status === 409) void fetchOptions(true);
    } finally {
      setSubmitting(false);
    }
  }, [
    activeTable, lockedByOther, customer, resolvedClient,
    safeCount, offline, addToast, fetchOptions,
  ]);

  // 取号成功后的可选动作：把「我今天取的号」直接带入确认图安排
  const handleOpenAssign = useCallback(async () => {
    if (offline) {
      addToast('当前离线，禁止编辑', 'error');
      return;
    }
    setAssignLoading(true);
    try {
      // 重新拉一次，保证包含刚取的号（取号后虽已静默刷新，这里再取一次最稳）
      const res = await axiosInstance.get('/gun-ledger/quick-take/options');
      const list: QuickTakeTodayRow[] = Array.isArray(res.data?.todayTaken) ? res.data.todayTaken : [];
      if (list.length === 0) {
        addToast('今天还没有取号记录，先去取号再安排确认图', 'error');
        return;
      }
      // 已被主任务使用的枪名不能再分配确认图任务（与台账页一致）
      let usedGunNames = new Set<string>();
      try {
        const usedRes = await axiosInstance.get('/tasks/used-gun-names');
        usedGunNames = new Set((usedRes.data?.gunNames || []).map((n: string) => String(n).trim()));
      } catch {
        // 拉取失败仅影响「已安排」标识，不阻断安排流程
      }
      setAssignRows(list.map(row => ({
        rowId: row.rowId,
        gunName: row.gunName,
        customer: row.customer,
        category: row.category,
        tableName: row.tableName,
        hours: resolveGunHours('confirm', row.gunName, { category: row.category, tableName: row.tableName }, systemSettings) ?? 0,
        used: usedGunNames.has(row.gunName),
      })));
      setAssignOpen(true);
    } catch (err: any) {
      addToast(err?.response?.data?.message || '无法读取今日取号记录', 'error');
    } finally {
      setAssignLoading(false);
    }
  }, [offline, addToast, systemSettings]);

  const handleCopyGunName = useCallback(async () => {
    if (!lastTaken || lastTaken.rows.length === 0) return;
    try {
      await navigator.clipboard.writeText(lastTaken.rows.map(r => r.gunName).join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      addToast('复制失败，请手动选中枪名复制', 'error');
    }
  }, [lastTaken, addToast]);

  if (!open) return null;

  const hasCategories = (options?.categories || []).some(c => c.tables.length > 0);

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => !submitting && onClose()} />
      <div className="relative bg-white rounded-xl shadow-2xl w-[880px] max-w-[95vw] max-h-[90vh] flex flex-col overflow-hidden border border-gray-200">
        {/* 头部 */}
        <div className="relative flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-[#1d4ed8] via-[#2563eb] to-[#3b82f6] text-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white/15 border border-white/25">
              <Sparkles size={17} />
            </div>
            <div>
              <div className="font-bold text-base leading-tight">标准焊枪名快速取号</div>
              <div className="text-[11px] opacity-80 leading-tight mt-0.5">选分类与表格 → 跳到最新未取行号 → 按标准规则生成焊枪名</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* 二级浮层：把今天取的号安排成确认图任务（不必先取号，随时可打开） */}
            <button
              type="button"
              onClick={() => void handleOpenAssign()}
              disabled={assignLoading || offline || submitting}
              title="浮层：把今天取的号按客户分组安排确认图任务（不必先取号）"
              className="flex items-center gap-1 h-7 px-2.5 rounded-full bg-white/15 border border-white/25 text-[11px] font-bold text-white hover:bg-white/25 transition cursor-pointer disabled:opacity-50"
            >
              {assignLoading ? <Loader2 size={12} className="animate-spin" /> : <ClipboardList size={12} />}
              安排确认图
              {todayTakenCount > 0 && (
                <span className="text-[10px] font-bold px-1 rounded bg-white/25">{todayTakenCount}</span>
              )}
            </button>
            <span className="hidden sm:flex items-center gap-1 text-[11px] text-white/80 px-2 py-1 rounded-full bg-white/10 border border-white/15">
              <kbd className="font-mono">Space</kbd>×2 呼出
            </span>
            <button
              type="button"
              onClick={() => void fetchOptions(true)}
              disabled={loading || refreshing}
              className="p-1.5 rounded-full hover:bg-white/20 transition cursor-pointer disabled:opacity-50"
              title="刷新表格与锁状态"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="p-1.5 rounded-full hover:bg-white/20 transition cursor-pointer disabled:opacity-50"
              title="关闭（Esc）"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col gap-3 p-4 bg-gray-50/70 overflow-hidden">
          {/* 步骤 1：分类 */}
          <div className="shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#2563eb] text-white text-[11px] font-bold shrink-0">1</span>
              <span className="text-sm font-bold text-gray-800">选择分类</span>
              <span className="text-[11px] text-gray-400">共 {(options?.categories || []).length} 个分类</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {loading && !options && (
                <>
                  {[0, 1, 2, 3, 4].map(i => (
                    <div key={i} className="h-7 w-20 rounded-md bg-gray-200/70 animate-pulse" />
                  ))}
                </>
              )}
              {(options?.categories || []).map(category => {
                const total = category.tables.length;
                const free = category.tables.filter(t => !isLockedByOther(t) && t.hasRule).length;
                const active = category.name === activeCategory;
                return (
                  <button
                    key={category.name}
                    type="button"
                    onClick={() => handleSelectCategory(category.name)}
                    className={`px-2.5 h-7 rounded-md border text-[12px] font-semibold transition inline-flex items-center gap-1.5 ${
                      active
                        ? 'bg-[#2563eb] border-[#2563eb] text-white shadow-sm'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-700'
                    }`}
                    title={`${category.name}：${total} 张表，${free} 张可立即取号`}
                  >
                    {category.name}
                    <span className={`text-[10px] font-bold px-1 rounded ${active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>
                      {free}/{total}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 步骤 2 / 3：表格与取号表单 */}
          <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_340px] gap-3">
            <section className="min-h-0 flex flex-col rounded-lg border border-gray-200 bg-white overflow-hidden">
              <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-100">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#2563eb] text-white text-[11px] font-bold shrink-0">2</span>
                <span className="text-sm font-bold text-gray-800">选择表格</span>
                <span className="text-[11px] text-gray-400">{availableCount}/{filteredTables.length} 可取号</span>
                <div className="ml-auto relative">
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="筛选表名"
                    className="h-7 w-32 pl-6 pr-2 rounded-md border border-gray-200 bg-gray-50 text-[12px] outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white transition"
                  />
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-auto">
                {loading && !options && (
                  <div className="p-3 space-y-2">
                    {[0, 1, 2, 3].map(i => <div key={i} className="h-12 rounded-md bg-gray-100 animate-pulse" />)}
                  </div>
                )}

                {!loading && loadError && (
                  <div className="flex flex-col items-center justify-center h-full gap-2 px-4 py-8 text-center">
                    <AlertTriangle size={20} className="text-amber-500" />
                    <div className="text-[12px] text-gray-600">{loadError}</div>
                    <button
                      type="button"
                      onClick={() => void fetchOptions()}
                      className="text-[12px] font-semibold text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"
                    >
                      <RefreshCw size={12} />重试
                    </button>
                  </div>
                )}

                {!loading && !loadError && !hasCategories && (
                  <div className="flex flex-col items-center justify-center h-full gap-1 px-4 py-8 text-center">
                    <Hash size={20} className="text-gray-300" />
                    <div className="text-[12px] text-gray-500">台账里还没有可用的表格</div>
                    <div className="text-[11px] text-gray-400">请先到焊枪台账页面新增分类与表格</div>
                  </div>
                )}

                {!loading && !loadError && hasCategories && filteredTables.length === 0 && (
                  <div className="px-3 py-8 text-center text-[12px] text-gray-400">该分类下没有匹配的表格</div>
                )}

                <ul className="divide-y divide-gray-100">
                  {filteredTables.map(table => {
                    const locked = isLockedByOther(table);
                    const disabled = locked || !table.hasRule;
                    const selected = table.id === tableId;
                    return (
                      <li key={table.id}>
                        <button
                          type="button"
                          onClick={() => selectTable({ ...table, category: activeCategory })}
                          disabled={disabled}
                          title={locked
                            ? `表正由「${table.lockedBy?.name}」打开，暂不可取号（弹窗内也不提供只读查看）`
                            : !table.hasRule
                              ? '该表未配置焊枪名规则，无法自动取号'
                              : `跳到序号 ${table.nextSerial} 取号`}
                          className={`w-full text-left px-3 py-2 transition flex items-center gap-2.5 ${
                            disabled
                              ? 'cursor-not-allowed bg-gray-50/80'
                              : selected
                                ? 'bg-blue-50/70 ring-1 ring-inset ring-blue-400 cursor-pointer'
                                : 'hover:bg-gray-50 cursor-pointer'
                          }`}
                        >
                          <span className={`shrink-0 w-1.5 h-8 rounded-full ${locked ? 'bg-amber-300' : !table.hasRule ? 'bg-gray-300' : selected ? 'bg-[#2563eb]' : 'bg-emerald-300'}`} />
                          <div className="min-w-0 flex-1">
                            <div className={`text-[13px] font-bold truncate ${disabled ? 'text-gray-400' : 'text-gray-800'}`}>
                              {table.name}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-400 truncate">
                              <span>已取 {table.takenCount} 行</span>
                              {table.lastGunName && table.hasRule && (
                                <>
                                  <span className="text-gray-300">·</span>
                                  <span className="font-mono truncate">上一号 {table.lastGunName}</span>
                                </>
                              )}
                              {!table.hasRule && <span className="text-amber-600 font-semibold">· 未配焊枪名规则</span>}
                            </div>
                          </div>

                          {locked ? (
                            <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                              <Lock size={10} />{table.lockedBy?.name} 打开中
                            </span>
                          ) : (
                            <div className="shrink-0 text-right">
                              <div className="text-[11px] text-gray-400 leading-tight">序号 <span className="font-bold text-gray-600">#{table.nextSerial}</span></div>
                              <div className={`font-mono text-[12px] font-bold leading-tight mt-0.5 ${selected ? 'text-blue-700' : 'text-gray-600'}`}>
                                {table.nextGunName || '—'}
                              </div>
                            </div>
                          )}
                          {!locked && <ChevronRight size={14} className={`shrink-0 ${selected ? 'text-blue-500' : 'text-gray-300'}`} />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>

            {/* 取号表单 */}
            <section className="min-h-0 flex flex-col rounded-lg border border-gray-200 bg-white overflow-hidden">
              <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-100">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#2563eb] text-white text-[11px] font-bold shrink-0">3</span>
                <span className="text-sm font-bold text-gray-800">取号</span>
                <span className="ml-auto text-[11px] text-gray-400 truncate max-w-[150px]" title={activeTable ? `${activeTable.category} / ${activeTable.name}` : ''}>
                  {activeTable ? `${activeTable.category} / ${activeTable.name}` : '未选择表格'}
                </span>
              </div>

              <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
                {!activeTable && (
                  <div className="flex flex-col items-center justify-center h-full gap-1 text-center py-8">
                    <ChevronRight size={18} className="text-gray-300" />
                    <div className="text-[12px] text-gray-500">从左侧选择一张表开始取号</div>
                    <div className="text-[11px] text-gray-400">灰显的表已被他人打开，暂不可取号</div>
                  </div>
                )}

                {activeTable && (
                  <>
                    {/* 本次取号摘要：只报序号与行范围，具体枪名在客户栏下方逐个列出 */}
                    <div className={`rounded-lg border px-3 py-2 ${lockedByOther
                      ? 'border-amber-300 bg-amber-50/70'
                      : tableUnavailable
                        ? 'border-gray-200 bg-gray-50'
                        : 'border-blue-200 bg-gradient-to-br from-blue-50 to-white'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-gray-500">本次取号</span>
                        <div className="flex items-center gap-1">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${lockedByOther
                            ? 'bg-amber-100 text-amber-700'
                            : tableUnavailable
                              ? 'bg-gray-200 text-gray-500'
                              : 'bg-blue-100 text-blue-700'}`}>
                            {lockedByOther ? '暂不可取' : !activeTable.hasRule ? '无规则' : '可取号'}
                          </span>
                        </div>
                      </div>
                      <div className="mt-1.5 flex items-end justify-between gap-2">
                        <div className="min-w-0 text-[11px] text-gray-500 leading-tight">
                          {safeCount > 1
                            ? <>第 {activeTable.takenCount + 1}–{activeTable.takenCount + safeCount} 行<span className="text-gray-300"> · </span>连续占用 {safeCount} 个序号</>
                            : <>第 {activeTable.takenCount + 1} 行<span className="text-gray-300"> · </span>最新未取行号</>}
                        </div>
                        <div className="shrink-0 text-right leading-none">
                          <span className="text-[10px] text-gray-400 mr-1">序号</span>
                          <span className={`font-mono text-[16px] font-bold ${lockedByOther || tableUnavailable ? 'text-gray-400' : 'text-gray-800'}`}>
                            {safeCount > 1
                              ? `#${activeTable.nextSerial}–${activeTable.nextSerial + safeCount - 1}`
                              : `#${activeTable.nextSerial}`}
                          </span>
                        </div>
                      </div>
                      {lockedByOther && (
                        <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-800 bg-amber-100/60 rounded px-2 py-1.5">
                          <ShieldAlert size={12} className="mt-0.5 shrink-0" />
                          <span>「{activeTable.lockedBy?.name}」正在该表编辑中，请等其完成后刷新或换一张表</span>
                        </div>
                      )}
                    </div>

                    {/* 取号数量：从最新未取行号起连续占用 N 个序号 */}
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 text-[11px] font-bold text-gray-500 shrink-0">
                        <Hash size={11} />取号数量
                      </label>
                      <div className={`flex items-center rounded-md border overflow-hidden ${tableUnavailable ? 'border-gray-200 bg-gray-100' : 'border-gray-200 bg-gray-50'}`}>
                        <button
                          type="button"
                          onClick={() => bumpCount(-1)}
                          disabled={tableUnavailable || submitting || safeCount <= 1}
                          className="w-7 h-8 flex items-center justify-center text-gray-500 hover:bg-white hover:text-blue-600 transition disabled:opacity-30 disabled:hover:bg-transparent"
                          title="减少一个"
                        >
                          <Minus size={12} />
                        </button>
                        <input
                          value={countInput}
                          onChange={e => handleCountInput(e.target.value)}
                          onBlur={handleCountBlur}
                          disabled={tableUnavailable || submitting}
                          inputMode="numeric"
                          aria-label="取号数量"
                          onKeyDown={e => {
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void handleSubmit(); }
                            if (e.key === 'ArrowUp') { e.preventDefault(); bumpCount(1); }
                            if (e.key === 'ArrowDown') { e.preventDefault(); bumpCount(-1); }
                          }}
                          className="w-9 h-8 text-center bg-transparent text-sm font-bold text-gray-800 outline-none disabled:opacity-60"
                        />
                        <button
                          type="button"
                          onClick={() => bumpCount(1)}
                          disabled={tableUnavailable || submitting || safeCount >= MAX_COUNT}
                          className="w-7 h-8 flex items-center justify-center text-gray-500 hover:bg-white hover:text-blue-600 transition disabled:opacity-30 disabled:hover:bg-transparent"
                          title="增加一个"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <span className="text-[11px] text-gray-400 truncate">最多 {MAX_COUNT} 个</span>
                    </div>

                    {/* 客户 / 仕样号 */}
                    <div>
                      <label className="flex items-center gap-1 text-[11px] font-bold text-gray-500 mb-1">
                        <User size={11} />客户 / 仕样号 <span className="text-red-500">*</span>
                      </label>
                      <input
                        ref={customerRef}
                        value={customer}
                        onChange={e => handleCustomerChange(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void handleSubmit(); } }}
                        disabled={tableUnavailable || submitting}
                        placeholder={`输入${specNumberDigits || ''}位仕样号或客户名`}
                        className="w-full h-9 px-2 bg-gray-50 border border-gray-200 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white transition disabled:opacity-60"
                      />
                      <div className="mt-1 min-h-[16px] text-[11px] leading-tight">
                        {specLoading && <span className="text-gray-400 inline-flex items-center gap-1"><Loader2 size={10} className="animate-spin" />正在查询仕样号…</span>}
                        {!specLoading && resolvedClient && <span className="text-emerald-600 truncate block">客户：{resolvedClient}</span>}
                        {!specLoading && !resolvedClient && specNotFound && <span className="text-amber-600">未查到该仕样号的客户信息，将按输入内容保存</span>}
                      </div>
                    </div>

                    {/* 将生成的枪名：放在客户栏下方，字号放大，最多 10 个两列铺开不滚动 */}
                    {previewRows.length > 0 && (
                      <div className={`rounded-lg border overflow-hidden ${lockedByOther || tableUnavailable
                        ? 'border-gray-200 bg-white'
                        : 'border-blue-200 bg-white'}`}>
                        <div className="flex items-center justify-between px-2.5 py-1.5 bg-blue-50/70 border-b border-blue-100">
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-gray-600">
                            <Hash size={11} />将生成的枪名
                          </span>
                          <span className="text-[10px] font-bold text-blue-700">共 {previewRows.length} 个</span>
                        </div>
                        {previewRows.length === 1 ? (
                          <div className={`px-2.5 py-2 font-mono text-[15px] font-bold truncate ${lockedByOther || tableUnavailable ? 'text-gray-400' : 'text-blue-800'}`}>
                            {previewRows[0].gunName || '—'}
                          </div>
                        ) : (
                          <ul className="px-2.5 py-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                            {previewRows.map(row => (
                              <li key={row.serial} className="flex items-baseline justify-between gap-1.5 min-w-0">
                                <span className={`font-mono text-[13px] font-semibold leading-snug truncate ${lockedByOther || tableUnavailable ? 'text-gray-400' : 'text-gray-800'}`}>
                                  {row.gunName || '—'}
                                </span>
                                <span className="shrink-0 text-[10px] text-gray-400 tabular-nums">#{row.serial}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {/* 上一次取号结果（可选：顺手安排确认图任务） */}
                    {lastTaken && (
                      <div ref={lastTakenRef} className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700">
                          <Check size={12} />已取号成功
                          {lastTaken.rows.length > 1 && (
                            <span className="ml-0.5 text-[10px] font-bold px-1 rounded bg-emerald-600 text-white">共 {lastTaken.rows.length} 个</span>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleCopyGunName()}
                            className="ml-auto shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900"
                            title={lastTaken.rows.length > 1 ? '复制全部枪名（每行一个）' : '复制枪名'}
                          >
                            {copied ? <Check size={11} /> : <Copy size={11} />}{copied ? '已复制' : '复制'}
                          </button>
                        </div>
                        <div className="mt-1 max-h-[68px] overflow-auto space-y-0.5">
                          {lastTaken.rows.map(row => (
                            <div key={`${row.serialNumber}-${row.gunName}`} className="flex items-baseline gap-2">
                              <span className="font-mono text-[13px] font-bold text-emerald-800 truncate">{row.gunName}</span>
                              <span className="text-[11px] text-emerald-600 shrink-0">#{row.serialNumber}</span>
                            </div>
                          ))}
                        </div>
                        <div className="text-[11px] text-emerald-600/90 truncate mt-0.5 flex items-center gap-1">
                          <span className="truncate">{lastTaken.customer}</span>
                          <span className="shrink-0 text-emerald-500/70">· {lastTaken.category}/{lastTaken.tableName}</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>
          </div>
        </div>

        {/* 底部 */}
        <div className="shrink-0 px-5 py-3 border-t border-gray-100 bg-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-[11px] text-gray-400 min-w-0">
            <span className="inline-flex items-center gap-1 shrink-0"><kbd className="px-1 py-0.5 bg-gray-100 border border-gray-300 rounded font-mono text-[10px]">Esc</kbd>关闭</span>
            <span className="inline-flex items-center gap-1 shrink-0"><kbd className="px-1 py-0.5 bg-gray-100 border border-gray-300 rounded font-mono text-[10px]">Enter</kbd>提交</span>
            <span className="truncate hidden md:inline">被他人打开的表不可取号，也不提供只读查看</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-300 text-gray-600 bg-white hover:bg-gray-100 transition disabled:opacity-50"
            >
              关闭
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#2563eb] text-white hover:bg-[#1d4ed8] transition disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {submitting
                ? '取号中…'
                : activeTable
                  ? (safeCount > 1 ? `确认取号 #${activeTable.nextSerial}–#${activeTable.nextSerial + safeCount - 1}` : `确认取号 #${activeTable.nextSerial}`)
                  : '确认取号'}
            </button>
          </div>
        </div>
      </div>
    </div>

    {/* 可选：把今天取的号安排确认图任务（浮在取号弹窗之上） */}
    <QuickConfirmAssignModal
      open={assignOpen}
      onClose={() => setAssignOpen(false)}
      rows={assignRows}
      designers={designers}
      addToast={addToast}
      onCreated={() => { void fetchOptions(true); }}
      zIndexClass="z-[60]"
      hintText="从快速取号打开 · Esc 关闭"
    />
    </>
  );
};

export default QuickGunTakeModal;
