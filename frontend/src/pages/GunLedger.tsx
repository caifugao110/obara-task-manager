import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import {
  ChevronLeft,
  ClipboardList,
  Plus,
  Trash2,
  Pencil,
  RefreshCw,
  AlertCircle,
  Shield,
  LogOut,
  Check,
  X,
  Lock,
  Unlock,
  UserPlus,
  Users,
  ArrowUp,
  ArrowDown,
  Settings2,
  Eraser,
  Download,
  ChevronRight,
  Zap,
  FolderOpen,
  Clock,
} from 'lucide-react';
import { axiosInstance } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSystemSettings } from '../context/SystemSettingsContext';
import { useDebounce } from '../utils/debounce';

interface Toast { message: string; type: 'success' | 'error'; id: number; center?: boolean }

interface UserMeta { id: string; username: string; name: string; }

interface GunRow {
  id: string;
  serialNumber: number;
  gunName: string;
  customer: string;
  time: string;
  responsiblePerson: string;
  remarks: string;
  createdAt?: string;
  createdBy?: UserMeta | null;
  updatedAt?: string;
  updatedBy?: UserMeta | null;
}

// 焊枪名自动生成规则（台账初始化设置，超管按表配置）
interface GunNameRule {
  enabled: boolean;
  prefix: string;
  start: number;
  pad: number;
}

interface GunTable { id: string; name: string; rows: GunRow[]; gunNameRule?: GunNameRule | null; }

interface SpecInfoResponse {
  success: boolean;
  message?: string;
  specNumber?: string;
  clientName?: string;
  deliveryDate?: string | null;
  isModification?: boolean;
}

interface GunLedgerData {
  categories: Record<string, GunTable[]>;
  defaultResponsiblePersons: string[];
}

// 台账初始化面板中的一键初始化目标：全部表格，或某一分类下的全部表格
type BatchInitTarget = { scope: 'all' } | { scope: 'category'; category: string };

interface EditingSession {
  tableId: string;
  serialNumber: number;
  userId: string;
  username: string;
  name: string;
  socketId: string;
}

interface TableLockSession {
  tableId: string;
  userId: string;
  username: string;
  name: string;
  lockedAt?: number;
}

// 默认分类（用于排序与删除保护）
const DEFAULT_CATEGORIES = ['X2C', 'X2C-V2', 'X2C-V3'];

const defaultAccessSettings = { enabled: true, allowAdmins: true, allowViewers: false };
const PLACEHOLDER_COUNT = 10;
const newRowId = () => `gun-row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// 焊枪名自动生成规则：分类 → 表名 → { prefix, 起始编号, 编号位数 }
const GUN_NAME_PATTERNS: Record<string, Record<string, { prefix: string; start: number; pad: number }>> = {
  'X2C': {
    'SRTC':         { prefix: 'SRTC-2C',    start: 15000, pad: 5 },
    'SRTX':         { prefix: 'SRTX-2C',    start: 25000, pad: 5 },
    'SRTV':         { prefix: 'SRTV-C',     start: 200,   pad: 4 },
    'SRTC-ALA-DC':  { prefix: 'SRTC-ALDC',  start: 400,   pad: 4 },
    'SRTX-ALA-DC':  { prefix: 'SRTX-ALDC',  start: 400,   pad: 4 },
    'SRTD':         { prefix: 'SRTD-C',     start: 200,   pad: 4 },
    'SRTS':         { prefix: 'SRTS-C',     start: 100,   pad: 4 },
  },
  'X2C-V2': {
    'C': { prefix: 'SDZC-C', start: 3000, pad: 4 },
    'X': { prefix: 'SDZX-C', start: 5000, pad: 4 },
  },
  'X2C-V3': {
    'C': { prefix: 'SDZC-3C', start: 30500, pad: 5 },
    'X': { prefix: 'SDZX-3C', start: 30500, pad: 5 },
  },
};

// 表的生效焊枪名规则：优先使用超管在「台账初始化」中保存的表级规则；
// 未配置过的表沿用内置默认规则（按 分类+表名 匹配），无匹配则不自动取号
const getEffectiveGunNameRule = (category: string, table: GunTable): GunNameRule | null => {
  if (table.gunNameRule) {
    return table.gunNameRule.enabled ? table.gunNameRule : null;
  }
  const pattern = GUN_NAME_PATTERNS[category]?.[table.name];
  return pattern ? { enabled: true, prefix: pattern.prefix, start: pattern.start, pad: pattern.pad } : null;
};

// 根据规则+序号生成焊枪名，无规则（未启用）时返回空串
const buildGunName = (rule: GunNameRule | null, serialNumber: number): string => {
  if (!rule || !rule.enabled) return '';
  const num = rule.start + (serialNumber - 1);
  return rule.prefix + String(num).padStart(rule.pad, '0');
};

// 打开「台账初始化」弹窗时某张表的规则草稿：已配置的取已配置值，否则预填内置默认
const buildRuleDraft = (category: string, table: GunTable): GunNameRule => {
  if (table.gunNameRule) return { ...table.gunNameRule };
  const pattern = GUN_NAME_PATTERNS[category]?.[table.name];
  return pattern
    ? { enabled: true, prefix: pattern.prefix, start: pattern.start, pad: pattern.pad }
    : { enabled: false, prefix: '', start: 1, pad: 4 };
};

// 行序号严格按自然顺序连续排列：升序后重新编号为 1..N，杜绝跳号（如 1 直接到 11）
const renumberRows = (rows: GunRow[]): GunRow[] =>
  [...rows]
    .sort((a, b) => a.serialNumber - b.serialNumber)
    .map((r, i) => ({ ...r, serialNumber: i + 1 }));

// 归一化整份台账：所有表的行序号连续
const normalizeLedgerSerials = (data: GunLedgerData): GunLedgerData => {
  const categories: GunLedgerData['categories'] = {};
  for (const cat of Object.keys(data.categories || {})) {
    categories[cat] = (data.categories[cat] || []).map(t => ({ ...t, rows: renumberRows(t.rows || []) }));
  }
  return { ...data, categories };
};
const todayStr = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};

const COLUMNS: { key: keyof GunRow | 'serialNumber' | 'clear'; label: string; width: string }[] = [
  { key: 'serialNumber', label: '序号', width: 'w-16 min-w-[4rem]' },
  { key: 'gunName', label: '焊枪名', width: 'w-28 min-w-[7rem]' },
  { key: 'customer', label: '客户', width: 'w-96 min-w-[24rem]' },
  { key: 'time', label: '时间', width: 'w-28 min-w-[7rem]' },
  { key: 'responsiblePerson', label: '担当', width: 'w-24 min-w-[6rem]' },
  { key: 'remarks', label: '备注', width: 'w-48 min-w-[12rem]' },
  { key: 'clear', label: '操作', width: 'w-14 min-w-[3.5rem]' },
];
const EDITABLE_COLS = ['gunName', 'customer', 'time', 'responsiblePerson', 'remarks'] as const;

const GunLedger: React.FC = () => {
  const { user, token, logout } = useAuth();
  const { specNumberDigits } = useSystemSettings();
  const isSuperAdmin = user?.role === 'superadmin';
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const [ledger, setLedger] = useState<GunLedgerData | null>(null);
  const [accessSettings, setAccessSettings] = useState(defaultAccessSettings);
  const [accessLoaded, setAccessLoaded] = useState(false);
  const [ledgerLoaded, setLedgerLoaded] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('X2C');
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [editingSessions, setEditingSessions] = useState<Record<string, EditingSession>>({});
  // 表级独占编辑锁：tableId -> 持有者会话
  const [tableLocks, setTableLocks] = useState<Record<string, TableLockSession>>({});
  const [renamingTableId, setRenamingTableId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newPersonInput, setNewPersonInput] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resettingPersons, setResettingPersons] = useState(false);
  const [saving, setSaving] = useState(false);
  // 离线状态：综合浏览器 online/offline 事件与 socket 连接状态判定
  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [showPersonPanel, setShowPersonPanel] = useState(false);
  const [showAccessPanel, setShowAccessPanel] = useState(false);
  // 台账初始化弹窗：分类选择 → 分类详情两级视图；每张表的焊枪名生成规则草稿 / 保存中 / 清除中 / 清除二次确认
  const [showInitPanel, setShowInitPanel] = useState(false);
  // 初始化面板内当前进入的分类：null = 分类选择界面
  const [initPanelCategory, setInitPanelCategory] = useState<string | null>(null);
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, GunNameRule>>({});
  const [ruleSavingId, setRuleSavingId] = useState<string | null>(null);
  const [clearingTableId, setClearingTableId] = useState<string | null>(null);
  const [confirmClearId, setConfirmClearId] = useState<string | null>(null);
  // 一键初始化（全部 / 某分类）：进行中标记 + 二次确认目标
  const [batchInitializing, setBatchInitializing] = useState(false);
  const [confirmBatch, setConfirmBatch] = useState<BatchInitTarget | null>(null);
  const [specLookupLoading, setSpecLookupLoading] = useState(false);
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [addCategoryValue, setAddCategoryValue] = useState('');
  const [addTableOpen, setAddTableOpen] = useState(false);
  const [addTableValue, setAddTableValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 分类导出弹窗：选中的分类 / 导出请求中
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportCats, setExportCats] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);

  // 删除确认弹窗状态
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<{ name: string; tableCount: number } | null>(null);
  const [deleteTableTarget, setDeleteTableTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const currentLockRef = useRef<{ tableId: string; serialNumber: number } | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRowIdsRef = useRef<Set<string>>(new Set());
  const inputRefs = useRef<Record<string, HTMLInputElement | HTMLSelectElement | null>>({});
  const specLookupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 表级锁相关 refs（供 socket 回调与卸载清理读取最新值）
  const activeTableIdRef = useRef<string | null>(null);
  const prevActiveTableRef = useRef<string | null>(null);
  const isAdminRef = useRef(isAdmin);
  const userRef = useRef(user);
  const onlineRef = useRef(online);
  isAdminRef.current = isAdmin;
  userRef.current = user;
  onlineRef.current = online;

  const authHeader = useMemo(() => (token ? { headers: { Authorization: `Bearer ${token}` } } : {}), [token]);

  const addToast = useCallback((message: string, type: 'success' | 'error', center = false) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { message, type, id, center }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  // 离线时统一拦截写操作：与主页面一致提示「当前离线，禁止编辑」
  const warnIfOffline = useCallback(() => {
    if (onlineRef.current) return false;
    addToast('当前离线，禁止编辑', 'error');
    return true;
  }, [addToast]);

  // 仕样号 → 客户名查询
  const fetchSpecInfo = useCallback(async (specNumber: string): Promise<SpecInfoResponse> => {
    try {
      const res = await axiosInstance.post('/spec/spec-info', { specNumber }, { ...authHeader, timeout: 15000 } as any);
      return res.data;
    } catch {
      return { success: false, message: '获取仕样信息超时' };
    }
  }, [authHeader]);

  const sessionKey = (tableId: string, serialNumber: number) => `${tableId}::${serialNumber}`;

  // 权限判定（同 system-settings：超管恒显，admin 看 enabled+allowAdmins，user 不可见）
  const canAccess = useMemo(() => {
    if (isSuperAdmin) return true;
    if (!accessSettings.enabled) return false;
    return user?.role === 'admin' && accessSettings.allowAdmins;
  }, [isSuperAdmin, accessSettings, user]);

  // 加载权限
  const fetchAccess = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/settings/gun-ledger');
      setAccessSettings(res.data || defaultAccessSettings);
    } catch (err: any) {
      // 离线/网络不可达时静默处理（离线提示条已说明状态），其他错误才提示
      if (typeof navigator !== 'undefined' && (!navigator.onLine || err?.code === 'ERR_NETWORK' || err?.message === 'Network Error')) {
        setOnline(false);
      } else {
        addToast('无法加载焊枪编号台账权限设置', 'error');
      }
    } finally {
      setAccessLoaded(true);
    }
  }, [addToast]);

  // 加载数据（同时归一化序号，保证 1..N 严格连续）
  const fetchLedger = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/gun-ledger', authHeader);
      setLedger(normalizeLedgerSerials(res.data));
    } catch (err: any) {
      // 网络不可达视为离线（与主页面一致），页面已有数据时继续只读展示
      if (typeof navigator !== 'undefined' && (!navigator.onLine || err?.code === 'ERR_NETWORK' || err?.message === 'Network Error')) {
        setOnline(false);
      } else {
        addToast('无法加载焊枪编号台账数据', 'error');
      }
    } finally {
      setLedgerLoaded(true);
    }
  }, [authHeader, addToast]);

  useEffect(() => {
    fetchAccess();
  }, [fetchAccess]);

  useEffect(() => {
    if (canAccess) fetchLedger();
  }, [canAccess, fetchLedger]);

  // 当前分类的表
  const tables = useMemo<GunTable[]>(() => {
    if (!ledger) return [];
    return ledger.categories[activeCategory] || [];
  }, [ledger, activeCategory]);

  // 仅查看者（无编辑权限）自动选中第一张表；管理员需手动点击打开，打开即获取该表的独占编辑锁
  useEffect(() => {
    if (isAdmin) return;
    if (tables.length && (!activeTableId || !tables.find(t => t.id === activeTableId))) {
      setActiveTableId(tables[0].id);
    }
    if (!tables.length) setActiveTableId(null);
  }, [tables, activeTableId, isAdmin]);

  const activeTable = useMemo<GunTable | null>(() => {
    if (!ledger || !activeTableId) return null;
    for (const cat of Object.keys(ledger.categories)) {
      const found = (ledger.categories[cat] || []).find(t => t.id === activeTableId);
      if (found) return found;
    }
    return null;
  }, [ledger, activeTableId]);

  // 表底部状态条：无任何提示内容时不渲染，使台账区白底与底部 footer 无缝衔接（与左侧表列表一致）
  const tableEditingSessions = activeTable
    ? Object.values(editingSessions).filter(s => s.tableId === activeTable.id)
    : [];
  const showTableStatusBar = !isAdmin || tableEditingSessions.length > 0;

  // 计算展示行：真行（序号严格 1..N 连续）+ 10 个按规则预填焊枪名的占位行
  const displayRows = useMemo(() => {
    if (!activeTable) return [];
    const real = renumberRows(activeTable.rows || []);
    const maxSerial = real.length;
    const rule = getEffectiveGunNameRule(activeCategory, activeTable);
    const placeholders = Array.from({ length: PLACEHOLDER_COUNT }, (_, i) => {
      const serialNumber = maxSerial + 1 + i;
      return {
        id: `__placeholder__${serialNumber}`,
        serialNumber,
        gunName: buildGunName(rule, serialNumber),
        customer: '',
        time: '',
        responsiblePerson: '',
        remarks: '',
      };
    }) as GunRow[];
    return [...real, ...placeholders];
  }, [activeTable, activeCategory]);

  // 担当下拉项：默认人员 + 当前用户
  const responsibleOptions = useMemo(() => {
    const list = ledger?.defaultResponsiblePersons || ['张啸', '张明', '陈青松', '陈大仪'];
    const set = new Set(list);
    if (user?.name) set.add(user.name);
    return Array.from(set);
  }, [ledger, user]);

  // 行锁控制
  const stopRowLock = useCallback(() => {
    if (stopTimeoutRef.current) { clearTimeout(stopTimeoutRef.current); stopTimeoutRef.current = null; }
    const lock = currentLockRef.current;
    if (!lock) return;
    socketRef.current?.emit('gun_ledger_stop_edit', { tableId: lock.tableId, serialNumber: lock.serialNumber });
    currentLockRef.current = null;
  }, []);

  const startRowLock = useCallback((tableId: string, serialNumber: number) => {
    if (stopTimeoutRef.current) { clearTimeout(stopTimeoutRef.current); stopTimeoutRef.current = null; }
    const lock = currentLockRef.current;
    if (lock && lock.tableId === tableId && lock.serialNumber === serialNumber) return;
    if (lock) {
      socketRef.current?.emit('gun_ledger_stop_edit', { tableId: lock.tableId, serialNumber: lock.serialNumber });
    }
    currentLockRef.current = { tableId, serialNumber };
    socketRef.current?.emit('gun_ledger_start_edit', { tableId, serialNumber });
  }, []);

  const scheduleStop = useCallback(() => {
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
    stopTimeoutRef.current = setTimeout(() => {
      stopRowLock();
    }, 400);
  }, [stopRowLock]);

  // 某行是否被他人锁定
  const getBlockingSession = useCallback((tableId: string, serialNumber: number): EditingSession | null => {
    const s = editingSessions[sessionKey(tableId, serialNumber)];
    if (!s) return null;
    if (user && s.userId === user.id) return null;
    return s;
  }, [editingSessions, user]);

  // ===== 表级独占编辑锁 =====
  const requestTableLock = useCallback((tableId: string) => {
    socketRef.current?.emit('gun_ledger_lock_table', { tableId });
  }, []);

  const releaseTableLock = useCallback((tableId: string) => {
    socketRef.current?.emit('gun_ledger_unlock_table', { tableId });
  }, []);

  // 某表是否正被他人锁定
  const getTableHolder = useCallback((tableId: string): TableLockSession | null => {
    const s = tableLocks[tableId];
    if (!s) return null;
    if (userRef.current && s.userId === userRef.current.id) return null;
    return s;
  }, [tableLocks]);

  // 点击左侧表名：他人编辑中则禁止打开并提示；离线时仅只读打开（不申请表锁，重连后自动续锁）
  const handleSelectTable = useCallback((t: GunTable) => {
    const holder = getTableHolder(t.id);
    if (holder) {
      addToast(`「${holder.name || holder.username}」正在编辑表「${t.name}」，请稍后再试`, 'error');
      return;
    }
    if (activeTableIdRef.current && activeTableIdRef.current !== t.id) stopRowLock();
    setActiveTableId(t.id);
    if (isAdminRef.current && onlineRef.current) requestTableLock(t.id);
  }, [getTableHolder, addToast, stopRowLock, requestTableLock]);

  // 完成编辑：释放锁并关闭当前表
  const handleFinishEditing = useCallback(() => {
    const tid = activeTableIdRef.current;
    if (tid) releaseTableLock(tid);
    stopRowLock();
    setActiveTableId(null);
    addToast('已结束编辑，其他人员现在可以打开该表', 'success');
  }, [releaseTableLock, stopRowLock, addToast]);

  // 切换分类：关闭并释放当前表锁
  const handleSelectCategory = useCallback((cat: string) => {
    if (cat === activeCategory) return;
    stopRowLock();
    setActiveTableId(null);
    setActiveCategory(cat);
  }, [activeCategory, stopRowLock]);

  // 更新本地某张表（跨分类查找）
  const patchTable = useCallback((tableId: string, updater: (t: GunTable) => GunTable) => {
    setLedger(prev => {
      if (!prev) return prev;
      const categories = { ...prev.categories };
      for (const cat of Object.keys(categories)) {
        const list = categories[cat] || [];
        const idx = list.findIndex(t => t.id === tableId);
        if (idx !== -1) {
          const newList = [...list];
          newList[idx] = updater(newList[idx]);
          categories[cat] = newList;
          return { ...prev, categories };
        }
      }
      return prev;
    });
  }, []);

  // 更新本地某表的行
  const patchTableRows = useCallback((tableId: string, updater: (rows: GunRow[]) => GunRow[]) => {
    patchTable(tableId, t => ({ ...t, rows: updater(t.rows || []) }));
  }, [patchTable]);

  // 客户列输入仕样号时自动查询客户名
  const scheduleCustomerSpecLookup = useCallback((tableId: string, serialNumber: number, value: string) => {
    if (specLookupTimeoutRef.current) { clearTimeout(specLookupTimeoutRef.current); specLookupTimeoutRef.current = null; }
    const trimmed = value.trim();
    // 仅当输入值为纯仕样号（指定位数的纯数字）时触发
    const isPureSpec = new RegExp(`^\\d{${specNumberDigits}}$`).test(trimmed);
    if (!isPureSpec) return;
    setSpecLookupLoading(true);
    specLookupTimeoutRef.current = setTimeout(async () => {
      const info = await fetchSpecInfo(trimmed);
      setSpecLookupLoading(false);
      if (info.success && info.clientName?.trim()) {
        const clientName = info.clientName.trim();
        patchTableRows(tableId, rows => rows.map(r => r.serialNumber === serialNumber ? { ...r, customer: clientName } : r));
        addToast(`已获取客户：${clientName}`, 'success');
      } else {
        addToast(info.message || `未找到仕样号 ${trimmed} 的客户信息`, 'error');
      }
    }, 600);
  }, [specNumberDigits, fetchSpecInfo, patchTableRows, addToast]);

  // 保存某表行（debounce）
  const saveTableRows = useCallback((tableId: string) => {
    setLedger(prev => {
      if (!prev) return prev;
      let rowsToSave: GunRow[] = [];
      for (const cat of Object.keys(prev.categories)) {
        const t = (prev.categories[cat] || []).find(t => t.id === tableId);
        if (t) { rowsToSave = t.rows || []; break; }
      }
      axiosInstance.put(`/gun-ledger/tables/${tableId}/rows`, rowsToSave, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(() => {
        dirtyRowIdsRef.current.clear();
        setSaving(false);
      }).catch((err: any) => {
        setSaving(false);
        if (err?.response?.status === 409) {
          addToast(err?.response?.data?.message || '该表正被他人编辑，暂时无法保存', 'error');
          // 锁已不属于自己：释放本地占用并关闭表格
          if (activeTableIdRef.current === tableId) {
            socketRef.current?.emit('gun_ledger_unlock_table', { tableId });
            setActiveTableId(null);
          }
        } else {
          addToast('保存失败，请重试', 'error');
        }
      });
      return prev;
    });
  }, [token, addToast]);

  const debouncedSave = useDebounce((tableId: string) => saveTableRows(tableId), 400);

  // 单元格变更
  const handleCellChange = useCallback((row: GunRow, field: keyof GunRow, value: string) => {
    if (!activeTable || !isAdmin || !online) return;
    const { id, serialNumber } = row;
    const isPlaceholder = String(id).startsWith('__placeholder__');

    patchTableRows(activeTable.id, rows => {
      // 占位行：仅在输入非空值时升级为真行
      if (isPlaceholder) {
        if (value.trim() === '') return rows; // 仍是占位，不存
        const promoted: GunRow = {
          id: newRowId(),
          serialNumber,
          gunName: row.gunName,
          customer: '',
          time: '',
          responsiblePerson: '',
          remarks: '',
          createdAt: new Date().toISOString(),
          createdBy: user ? { id: user.id, username: user.username, name: user.name } : null,
          updatedAt: new Date().toISOString(),
          updatedBy: user ? { id: user.id, username: user.username, name: user.name } : null,
        };
        // 有预填焊枪名时自动填时间与担当（无论哪个字段触发升级）；
        // 先自动填充再应用本次手动输入，保证手动选择的担当不被覆盖
        if (promoted.gunName.trim() !== '') {
          promoted.time = todayStr();
          promoted.responsiblePerson = user?.name || '';
        }
        (promoted as any)[field] = value;
        dirtyRowIdsRef.current.add(promoted.id);
        const next = [...rows, promoted];
        return next;
      }
      // 真行：直接更新字段
      const next = rows.map(r => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: value, updatedAt: new Date().toISOString(), updatedBy: user ? { id: user.id, username: user.username, name: user.name } : null };
        // 焊枪名从空变为非空时补填时间和担当
        if (field === 'gunName' && !r.gunName && value.trim() !== '') {
          if (!updated.time) updated.time = todayStr();
          if (!updated.responsiblePerson) updated.responsiblePerson = user?.name || '';
        }
        return updated;
      });
      dirtyRowIdsRef.current.add(id);
      return next;
    });

    setSaving(true);
    debouncedSave(activeTable.id);

    // 客户列输入仕样号时自动查询客户名
    if (field === 'customer') {
      scheduleCustomerSpecLookup(activeTable.id, serialNumber, value);
    }
  }, [activeTable, isAdmin, online, patchTableRows, user, debouncedSave, scheduleCustomerSpecLookup]);

  // 单元格聚焦：取行锁
  const handleCellFocus = useCallback((tableId: string, serialNumber: number) => {
    if (!isAdmin || !online) return;
    startRowLock(tableId, serialNumber);
  }, [isAdmin, online, startRowLock]);

  const handleCellBlur = useCallback(() => {
    if (!isAdmin) return;
    scheduleStop();
  }, [isAdmin, scheduleStop]);

  // 清除行内容：保留焊枪名与序号，清空客户/时间/担当/备注（占位行无内容可清，按钮不渲染）
  const handleClearRow = useCallback((row: GunRow) => {
    if (!activeTable || !isAdmin || !online) return;
    if (String(row.id).startsWith('__placeholder__')) return;
    patchTableRows(activeTable.id, rows => rows.map(r => r.id === row.id
      ? { ...r, customer: '', time: '', responsiblePerson: '', remarks: '', updatedAt: new Date().toISOString(), updatedBy: user ? { id: user.id, username: user.username, name: user.name } : null }
      : r));
    dirtyRowIdsRef.current.add(row.id);
    setSaving(true);
    debouncedSave(activeTable.id);
  }, [activeTable, isAdmin, online, patchTableRows, user, debouncedSave]);

  // 键盘导航：Enter 下移
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>, rowIdx: number, colIdx: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const nextIdx = rowIdx + 1;
      const nextRow = displayRows[nextIdx];
      if (nextRow) {
        const refKey = `${nextRow.serialNumber}-${EDITABLE_COLS[colIdx]}`;
        const el = inputRefs.current[refKey];
        if (el && 'focus' in el) el.focus();
      }
    }
  }, [displayRows]);

  // 新增表
  const handleAddTable = useCallback(async (rawName: string) => {
    if (warnIfOffline()) return;
    const name = String(rawName || '').trim();
    if (!name || !ledger) return;
    try {
      const res = await axiosInstance.post(`/gun-ledger/categories/${encodeURIComponent(activeCategory)}/tables`, { name }, authHeader);
      // 服务端先广播后响应，socket 的 add_table 可能已先一步追加；此处同样按 id 去重，避免同一新表出现两条
      setLedger(prev => {
        if (!prev) return prev;
        const list = prev.categories[activeCategory] || [];
        if (list.some(t => t.id === res.data.id)) return prev;
        return { ...prev, categories: { ...prev.categories, [activeCategory]: [...list, res.data] } };
      });
      setActiveTableId(res.data.id);
      // 新建后自动进入编辑：获取该表独占锁（切换 effect 会自动释放上一张表的锁）
      requestTableLock(res.data.id);
      addToast(`已新增表 ${name}`, 'success');
    } catch (err: any) {
      addToast(err?.response?.data?.message || '新增表失败', 'error');
    }
  }, [ledger, activeCategory, authHeader, addToast, requestTableLock, warnIfOffline]);

  // 新增分类
  const handleAddCategory = useCallback(async (rawName: string) => {
    if (warnIfOffline()) return;
    const name = String(rawName || '').trim();
    if (!name || !ledger) return;
    if (name.length > 30) { addToast('分类名不超过 30 字符', 'error'); return; }
    if (Object.prototype.hasOwnProperty.call(ledger.categories, name)) { addToast('已存在同名分类', 'error'); return; }
    try {
      await axiosInstance.post('/gun-ledger/categories', { name }, authHeader);
      // socket 广播可能先于响应到达，按分类名去重
      setLedger(prev => prev ? { ...prev, categories: { ...prev.categories, [name]: prev.categories[name] || [] } } : prev);
      setActiveCategory(name);
      setActiveTableId(null);
      addToast(`已新增分类 ${name}`, 'success');
    } catch (err: any) {
      addToast(err?.response?.data?.message || '新增分类失败', 'error');
    }
  }, [ledger, authHeader, addToast, warnIfOffline]);

  // 打开删除分类确认弹窗
  const openDeleteCategoryModal = useCallback((category: string) => {
    if (warnIfOffline()) return;
    if (!ledger) return;
    // 删除分类属于高风险操作，仅超级管理员可执行；一般管理员可见按钮但点击时提示
    if (!isSuperAdmin) {
      addToast('删除分类属于高风险操作，需要超级管理员权限，请联系超级管理员删除', 'error', true);
      return;
    }
    if (DEFAULT_CATEGORIES.includes(category)) { addToast('默认分类不允许删除', 'error'); return; }
    const tableCount = (ledger.categories[category] || []).length;
    setDeleteCategoryTarget({ name: category, tableCount });
  }, [ledger, addToast, isSuperAdmin, warnIfOffline]);

  // 确认删除分类（实际执行）
  const confirmDeleteCategory = useCallback(async () => {
    if (!deleteCategoryTarget) return;
    if (warnIfOffline()) return;
    setDeleting(true);
    try {
      await axiosInstance.delete(`/gun-ledger/categories/${encodeURIComponent(deleteCategoryTarget.name)}`, authHeader);
      setLedger(prev => {
        if (!prev) return prev;
        const categories = { ...prev.categories };
        delete categories[deleteCategoryTarget.name];
        return { ...prev, categories };
      });
      if (activeCategory === deleteCategoryTarget.name) {
        setActiveCategory(DEFAULT_CATEGORIES[0]);
        setActiveTableId(null);
      }
      addToast(`已删除分类 ${deleteCategoryTarget.name}`, 'success');
      setDeleteCategoryTarget(null);
    } catch (err: any) {
      addToast(err?.response?.data?.message || '删除分类失败', 'error');
    } finally {
      setDeleting(false);
    }
  }, [deleteCategoryTarget, authHeader, addToast, activeCategory, warnIfOffline]);

  // 重命名表
  const handleRenameTable = useCallback(async (tableId: string) => {
    if (warnIfOffline()) { setRenamingTableId(null); return; }
    const name = renameValue.trim();
    if (!name) { setRenamingTableId(null); return; }
    try {
      await axiosInstance.patch(`/gun-ledger/tables/${tableId}`, { name }, authHeader);
      setLedger(prev => {
        if (!prev) return prev;
        const categories = { ...prev.categories };
        for (const cat of Object.keys(categories)) {
          const list = categories[cat] || [];
          const idx = list.findIndex(t => t.id === tableId);
          if (idx !== -1) {
            const newList = [...list];
            newList[idx] = { ...newList[idx], name };
            categories[cat] = newList;
            return { ...prev, categories };
          }
        }
        return prev;
      });
      addToast('表名已更新', 'success');
    } catch (err: any) {
      addToast(err?.response?.data?.message || '重命名失败', 'error');
    } finally {
      setRenamingTableId(null);
      setRenameValue('');
    }
  }, [renameValue, authHeader, addToast, warnIfOffline]);

  // 打开删除表确认弹窗
  const openDeleteTableModal = useCallback((tableId: string, name: string) => {
    if (warnIfOffline()) return;
    // 删除表格属于高风险操作，仅超级管理员可执行；一般管理员可见按钮但点击时提示
    if (!isSuperAdmin) {
      addToast('删除表格属于高风险操作，需要超级管理员权限，请联系超级管理员删除', 'error', true);
      return;
    }
    setDeleteTableTarget({ id: tableId, name });
  }, [isSuperAdmin, addToast, warnIfOffline]);

  // 确认删除表（实际执行）
  const confirmDeleteTable = useCallback(async () => {
    if (!deleteTableTarget) return;
    if (warnIfOffline()) return;
    setDeleting(true);
    try {
      await axiosInstance.delete(`/gun-ledger/tables/${deleteTableTarget.id}`, authHeader);
      setLedger(prev => {
        if (!prev) return prev;
        const categories = { ...prev.categories };
        for (const cat of Object.keys(categories)) {
          categories[cat] = (categories[cat] || []).filter(t => t.id !== deleteTableTarget.id);
        }
        return { ...prev, categories };
      });
      if (activeTableId === deleteTableTarget.id) setActiveTableId(null);
      addToast(`已删除表 ${deleteTableTarget.name}`, 'success');
      setDeleteTableTarget(null);
    } catch (err: any) {
      addToast(err?.response?.data?.message || '删除表失败', 'error');
    } finally {
      setDeleting(false);
    }
  }, [deleteTableTarget, authHeader, addToast, activeTableId, warnIfOffline]);

  // 权限设置保存
  const updateAccessSettings = useCallback(async (next: Partial<typeof defaultAccessSettings>) => {
    if (warnIfOffline()) return;
    const updated = { ...accessSettings, ...next };
    if (next.enabled === false) { updated.allowAdmins = false; }
    if (updated.allowAdmins === false && accessSettings.allowAdmins) {
      // 允许关闭，无依赖
    }
    setAccessSettings(updated);
    if (!isSuperAdmin) return;
    try {
      await axiosInstance.put('/settings/gun-ledger', updated, authHeader);
      addToast('权限设置已保存', 'success');
    } catch {
      addToast('保存权限设置失败', 'error');
    }
  }, [accessSettings, isSuperAdmin, authHeader, addToast, warnIfOffline]);

  // ===== 台账初始化：按表配置焊枪名生成规则、清除初始焊枪名 =====
  // 打开弹窗：为每张表生成规则草稿（已配置取已配置值，否则预填内置默认）
  const openInitPanel = useCallback(() => {
    if (warnIfOffline()) return;
    if (!ledger) return;
    const drafts: Record<string, GunNameRule> = {};
    for (const cat of Object.keys(ledger.categories)) {
      (ledger.categories[cat] || []).forEach(t => { drafts[t.id] = buildRuleDraft(cat, t); });
    }
    setRuleDrafts(drafts);
    setConfirmClearId(null);
    setConfirmBatch(null);
    setInitPanelCategory(null);
    setShowInitPanel(true);
  }, [ledger, warnIfOffline]);

  const updateRuleDraft = useCallback((tableId: string, patch: Partial<GunNameRule>) => {
    setRuleDrafts(prev => prev[tableId] ? { ...prev, [tableId]: { ...prev[tableId], ...patch } } : prev);
  }, []);

  // 保存某张表的焊枪名生成规则
  const saveGunNameRule = useCallback(async (tableId: string) => {
    if (warnIfOffline()) return;
    const rule = ruleDrafts[tableId];
    if (!rule || !ledger) return;
    let tableName = '';
    for (const cat of Object.keys(ledger.categories)) {
      const found = (ledger.categories[cat] || []).find(t => t.id === tableId);
      if (found) { tableName = found.name; break; }
    }
    setRuleSavingId(tableId);
    try {
      await axiosInstance.put(`/gun-ledger/tables/${tableId}/gun-name-rule`, rule, authHeader);
      patchTable(tableId, t => ({ ...t, gunNameRule: rule }));
      addToast(`表「${tableName}」初始化设置已保存`, 'success');
    } catch (err: any) {
      addToast(err?.response?.data?.message || '初始化设置保存失败', 'error');
    } finally {
      setRuleSavingId(null);
    }
  }, [ruleDrafts, ledger, authHeader, patchTable, addToast, warnIfOffline]);

  // 焊枪名初始化：删除该表全部真实行，表恢复为全新状态——页面只显示 10 个预留行，
  // 预留行按生效规则（表级规则 → 内置默认模式）展示该表的 10 个原始焊枪名
  const initGunNames = useCallback(async (tableId: string) => {
    if (warnIfOffline()) return;
    setClearingTableId(tableId);
    try {
      // 请求体必须发送 {} 而非 null：后端 body-parser 严格模式会将 "null" 视为非法 JSON 拒绝（400）
      await axiosInstance.post(`/gun-ledger/tables/${tableId}/initialize-gun-names`, {}, authHeader);
      addToast('已初始化：该表已恢复为 10 个原始焊枪名', 'success');
      setConfirmClearId(null);
      // update_rows 广播会刷新所有客户端的行数据
    } catch (err: any) {
      if (err?.response?.status === 409) {
        addToast(err?.response?.data?.message || '该表正被他人编辑，暂时无法初始化', 'error');
      } else {
        addToast(err?.response?.data?.message || '焊枪名初始化失败', 'error');
      }
    } finally {
      setClearingTableId(null);
    }
  }, [authHeader, addToast, warnIfOffline]);

  // 一键初始化：scope='all' 清空所有分类下的全部表格；scope='category' 仅清空指定分类。
  // 后端在任意一张表被他人编辑时整体返回 409（不做部分初始化），update_rows 广播会刷新各客户端。
  const executeBatchInitialize = useCallback(async (target: BatchInitTarget) => {
    if (warnIfOffline()) return;
    setBatchInitializing(true);
    try {
      const url = target.scope === 'all'
        ? '/gun-ledger/initialize-all'
        : `/gun-ledger/categories/${encodeURIComponent(target.category)}/initialize-all`;
      // 同单表初始化：请求体必须为 {} 而非 null，避免后端严格 JSON 解析报 400
      const res = await axiosInstance.post(url, {}, authHeader);
      const info = res.data || {};
      const tableCount = Number(info.initializedTables) || 0;
      const rowCount = Number(info.clearedRows) || 0;
      addToast(
        target.scope === 'all'
          ? `已一键初始化全部表格（${tableCount} 张表，清除 ${rowCount} 行内容）`
          : `分类「${target.category}」已初始化（${tableCount} 张表，清除 ${rowCount} 行内容）`,
        'success'
      );
      setConfirmBatch(null);
    } catch (err: any) {
      if (err?.response?.status === 409) {
        addToast(err?.response?.data?.message || '有表格正被他人编辑，暂时无法初始化', 'error', true);
      } else {
        addToast(err?.response?.data?.message || '批量初始化失败', 'error');
      }
    } finally {
      setBatchInitializing(false);
    }
  }, [authHeader, addToast, warnIfOffline]);

  // 默认担当人员管理
  const handleAddPerson = useCallback(async (person: string) => {
    if (warnIfOffline()) return;
    const p = person.trim();
    if (!p || !ledger) return;
    const list = Array.from(new Set([...(ledger.defaultResponsiblePersons || []), p]));
    try {
      await axiosInstance.put('/gun-ledger/default-persons', list, authHeader);
      setLedger(prev => prev ? { ...prev, defaultResponsiblePersons: list } : prev);
      setNewPersonInput('');
      addToast('已添加担当人员', 'success');
    } catch {
      addToast('添加失败', 'error');
    }
  }, [ledger, authHeader, addToast, warnIfOffline]);

  const handleRemovePerson = useCallback(async (person: string) => {
    if (warnIfOffline()) return;
    if (!ledger) return;
    const list = (ledger.defaultResponsiblePersons || []).filter(p => p !== person);
    try {
      await axiosInstance.put('/gun-ledger/default-persons', list, authHeader);
      setLedger(prev => prev ? { ...prev, defaultResponsiblePersons: list } : prev);
      addToast('已移除', 'success');
    } catch {
      addToast('移除失败', 'error');
    }
  }, [ledger, authHeader, addToast, warnIfOffline]);

  // 重置为系统默认担当人员（确认后执行）
  const handleResetPersons = useCallback(async () => {
    if (warnIfOffline()) return;
    setResettingPersons(true);
    try {
      const res = await axiosInstance.post('/gun-ledger/default-persons/reset', {}, authHeader);
      const list = Array.isArray(res.data) ? res.data : [];
      setLedger(prev => prev ? { ...prev, defaultResponsiblePersons: list } : prev);
      setShowResetConfirm(false);
      addToast('已重置为默认人员', 'success');
    } catch {
      addToast('重置失败', 'error');
    } finally {
      setResettingPersons(false);
    }
  }, [authHeader, addToast, warnIfOffline]);

  // 重排分类（上移/下移）：乐观更新 + 持久化 + 广播
  const handleMoveCategory = useCallback((category: string, direction: 'up' | 'down') => {
    if (warnIfOffline()) return;
    if (!ledger) return;
    const keys = Object.keys(ledger.categories);
    const idx = keys.indexOf(category);
    if (idx < 0) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= keys.length) return;
    const nextOrder = [...keys];
    [nextOrder[idx], nextOrder[targetIdx]] = [nextOrder[targetIdx], nextOrder[idx]];
    // 乐观更新本地顺序
    setLedger(prev => {
      if (!prev) return prev;
      const rebuilt: Record<string, GunTable[]> = {};
      nextOrder.forEach(k => { rebuilt[k] = prev.categories[k] || []; });
      return { ...prev, categories: rebuilt };
    });
    axiosInstance.patch('/gun-ledger/categories/order', { order: nextOrder }, authHeader)
      .catch(() => addToast('分类顺序保存失败', 'error'));
  }, [ledger, authHeader, addToast, warnIfOffline]);

  // 重排表格（上移/下移）：乐观更新 + 持久化 + 广播
  const handleMoveTable = useCallback((tableId: string, direction: 'up' | 'down') => {
    if (warnIfOffline()) return;
    if (!ledger) return;
    const list = ledger.categories[activeCategory] || [];
    const idx = list.findIndex(t => t.id === tableId);
    if (idx < 0) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    const nextOrder = list.map(t => t.id);
    [nextOrder[idx], nextOrder[targetIdx]] = [nextOrder[targetIdx], nextOrder[idx]];
    // 乐观更新本地顺序
    setLedger(prev => {
      if (!prev) return prev;
      const categories = { ...prev.categories };
      const oldList = categories[activeCategory] || [];
      const byId = new Map(oldList.map(t => [t.id, t]));
      categories[activeCategory] = nextOrder.map(id => byId.get(id)!).filter(Boolean);
      return { ...prev, categories };
    });
    axiosInstance.patch('/gun-ledger/tables/order', { category: activeCategory, order: nextOrder }, authHeader)
      .catch(() => addToast('表格顺序保存失败', 'error'));
  }, [ledger, activeCategory, authHeader, addToast, warnIfOffline]);

  // 打开分类导出弹窗：默认勾选当前分类
  const openExportPanel = useCallback(() => {
    if (warnIfOffline()) return;
    setExportCats([activeCategory]);
    setShowExportPanel(true);
  }, [warnIfOffline, activeCategory]);

  // 从响应头解析下载文件名
  const parseDownloadName = (disposition: string, fallback: string) => {
    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match) return decodeURIComponent(utf8Match[1]);
    const asciiMatch = disposition.match(/filename="?([^";]+)"?/i);
    if (asciiMatch) return asciiMatch[1];
    return fallback;
  };

  // 触发浏览器下载
  const triggerBlobDownload = (data: BlobPart, fileName: string) => {
    const url = window.URL.createObjectURL(new Blob([data]));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  // 确认导出：单分类下载一个 xls；多分类打包 zip（每个分类一个独立 xls）
  const handleExportCategories = useCallback(async () => {
    if (!exportCats.length) {
      addToast('请至少选择一个分类', 'error');
      return;
    }
    setExporting(true);
    try {
      const response = await axiosInstance.get('/gun-ledger/export', {
        params: { categories: exportCats.join(',') },
        responseType: 'blob',
        ...authHeader
      });
      const fallback = exportCats.length === 1 ? `${exportCats[0]}.xls` : '焊枪编号台账导出.zip';
      const fileName = parseDownloadName(response.headers['content-disposition'] || '', fallback);
      triggerBlobDownload(response.data, fileName);
      setShowExportPanel(false);
      addToast('导出成功', 'success');
    } catch (error: any) {
      // 错误体是 blob（JSON），尝试读取具体提示
      let message = '导出失败';
      const errData = error?.response?.data;
      if (errData instanceof Blob && errData.type.includes('json')) {
        try {
          const text = await errData.text();
          message = JSON.parse(text)?.message || message;
        } catch { /* 忽略解析失败 */ }
      }
      addToast(message, 'error');
    } finally {
      setExporting(false);
    }
  }, [exportCats, authHeader, addToast]);

  // 导出弹窗中的分类勾选切换
  const toggleExportCat = useCallback((name: string) => {
    setExportCats(prev => (prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]));
  }, []);

  // Socket 连接
  useEffect(() => {
    if (!token || !canAccess) return;
    const socket = io('/', { path: '/socket.io', reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 3000, timeout: 10000, auth: { token } });
    socketRef.current = socket;
    let hasConnectedOnce = false;

    socket.on('connect', () => {
      setOnline(true);
      // 断线重连后：刷新台账数据并重新申请表级锁；若期间锁被他人取得，会收到 blocked 事件并自动关闭
      if (hasConnectedOnce) fetchLedger();
      hasConnectedOnce = true;
      const tid = activeTableIdRef.current;
      if (tid && isAdminRef.current) socket.emit('gun_ledger_lock_table', { tableId: tid });
    });
    socket.on('disconnect', () => { setOnline(false); stopRowLock(); });
    socket.on('connect_error', () => { setOnline(false); });

    // ===== 表级独占编辑锁事件 =====
    socket.on('gun_ledger_table_locks_state', (sessions: TableLockSession[]) => {
      const next: Record<string, TableLockSession> = {};
      (Array.isArray(sessions) ? sessions : []).forEach(s => {
        if (s?.tableId) next[s.tableId] = s;
      });
      setTableLocks(next);
    });
    socket.on('gun_ledger_table_locked', (s: TableLockSession) => {
      if (!s?.tableId) return;
      setTableLocks(prev => ({ ...prev, [s.tableId]: s }));
      // 自己正打开着该表，但锁被他人取得（如他人在同一刻抢先打开）→ 自动关闭并提示
      const me = userRef.current;
      if (me && s.userId !== me.id && activeTableIdRef.current === s.tableId) {
        addToast(`「${s.name || s.username}」正在编辑本表，表格已关闭`, 'error');
        stopRowLock();
        setActiveTableId(null);
      }
    });
    socket.on('gun_ledger_table_unlocked', (data: { tableId: string }) => {
      if (!data?.tableId) return;
      setTableLocks(prev => { const n = { ...prev }; delete n[data.tableId]; return n; });
    });
    socket.on('gun_ledger_table_lock_blocked', (data: { tableId: string; holder: TableLockSession }) => {
      if (!data?.tableId) return;
      const holder = data.holder;
      addToast(`「${holder?.name || holder?.username || '他人'}」正在编辑该表，无法打开`, 'error');
      stopRowLock();
      setActiveTableId(prev => (prev === data.tableId ? null : prev));
    });

    socket.on('gun_ledger_editing_state', (sessions: EditingSession[]) => {
      const next: Record<string, EditingSession> = {};
      (Array.isArray(sessions) ? sessions : []).forEach(s => {
        if (s?.tableId && s.serialNumber !== undefined) next[sessionKey(s.tableId, s.serialNumber)] = s;
      });
      setEditingSessions(next);
    });
    socket.on('gun_ledger_edit_start', (s: EditingSession) => {
      if (!s?.tableId || s.serialNumber === undefined) return;
      setEditingSessions(prev => ({ ...prev, [sessionKey(s.tableId, s.serialNumber)]: s }));
    });
    socket.on('gun_ledger_edit_stop', (data: { tableId: string; serialNumber: number }) => {
      if (!data?.tableId || data.serialNumber === undefined) return;
      setEditingSessions(prev => { const n = { ...prev }; delete n[sessionKey(data.tableId, data.serialNumber)]; return n; });
    });
    socket.on('gun_ledger_edit_blocked', (s: EditingSession) => {
      addToast(`${s.name || s.username} 正在编辑该行`, 'error');
    });
    socket.on('gun_ledger_updated', (data: { action: string; tableId?: string; rows?: GunRow[]; category?: string; table?: GunTable; name?: string; defaultResponsiblePersons?: string[]; order?: string[]; rule?: GunNameRule }) => {
      if (!data) return;
      if (data.action === 'add_category' && data.category) {
        setLedger(prev => prev && !(data.category! in prev.categories) ? { ...prev, categories: { ...prev.categories, [data.category!]: [] } } : prev);
      } else if (data.action === 'delete_category' && data.category) {
        setLedger(prev => {
          if (!prev) return prev;
          const categories = { ...prev.categories };
          delete categories[data.category!];
          return { ...prev, categories };
        });
        if (activeCategory === data.category) {
          setActiveCategory(DEFAULT_CATEGORIES[0]);
          setActiveTableId(null);
        }
      } else if (data.action === 'update_rows' && data.tableId && data.rows) {
        setLedger(prev => {
          if (!prev) return prev;
          const categories = { ...prev.categories };
          for (const cat of Object.keys(categories)) {
            const list = categories[cat] || [];
            const idx = list.findIndex(t => t.id === data.tableId);
            if (idx !== -1) {
              // 保留本地未保存的脏行
              const localRows = list[idx].rows || [];
              const dirtyIds = dirtyRowIdsRef.current;
              const localDirty = localRows.filter(r => dirtyIds.has(r.id));
              const serverIds = new Set((data.rows || []).map(r => r.id));
              const merged = (data.rows || []).map(r => {
                const ld = localDirty.find(d => d.id === r.id);
                return ld || r;
              }).concat(localDirty.filter(r => !serverIds.has(r.id)));
              // 服务端为序号权威来源：合并后同样保证序号 1..N 连续
              const newList = [...list];
              newList[idx] = { ...newList[idx], rows: renumberRows(merged) };
              categories[cat] = newList;
              return { ...prev, categories };
            }
          }
          return prev;
        });
      } else if (data.action === 'add_table' && data.category && data.table) {
        // 广播对创建者本人也会到达；创建者已通过 POST 响应本地追加，故按 id 去重，避免列表出现两条相同表格
        setLedger(prev => {
          if (!prev) return prev;
          const list = prev.categories[data.category!] || [];
          if (list.some(t => t.id === data.table!.id)) return prev;
          return { ...prev, categories: { ...prev.categories, [data.category!]: [...list, data.table!] } };
        });
      } else if (data.action === 'rename_table' && data.tableId && data.name) {
        setLedger(prev => {
          if (!prev) return prev;
          const categories = { ...prev.categories };
          for (const cat of Object.keys(categories)) {
            const list = categories[cat] || [];
            const idx = list.findIndex(t => t.id === data.tableId);
            if (idx !== -1) {
              const newList = [...list]; newList[idx] = { ...newList[idx], name: data.name! };
              categories[cat] = newList; return { ...prev, categories };
            }
          }
          return prev;
        });
      } else if (data.action === 'delete_table' && data.tableId) {
        setLedger(prev => {
          if (!prev) return prev;
          const categories = { ...prev.categories };
          for (const cat of Object.keys(categories)) categories[cat] = (categories[cat] || []).filter(t => t.id !== data.tableId);
          return { ...prev, categories };
        });
        if (activeTableId === data.tableId) setActiveTableId(null);
      } else if (data.action === 'default_persons' && Array.isArray(data.defaultResponsiblePersons)) {
        setLedger(prev => prev ? { ...prev, defaultResponsiblePersons: data.defaultResponsiblePersons! } : prev);
      } else if (data.action === 'reorder_categories' && Array.isArray(data.order)) {
        setLedger(prev => {
          if (!prev) return prev;
          const rebuilt: Record<string, GunTable[]> = {};
          (data.order as string[]).forEach(k => { rebuilt[k] = prev.categories[k] || []; });
          // 追加 order 中遗漏的分类（兜底，正常不会触发）
          Object.keys(prev.categories).forEach(k => { if (!(k in rebuilt)) rebuilt[k] = prev.categories[k]; });
          return { ...prev, categories: rebuilt };
        });
      } else if (data.action === 'reorder_tables' && data.category && Array.isArray(data.order)) {
        setLedger(prev => {
          if (!prev) return prev;
          const categories = { ...prev.categories };
          const oldList = categories[data.category!] || [];
          const byId = new Map(oldList.map(t => [t.id, t]));
          categories[data.category!] = (data.order as string[]).map(id => byId.get(id)).filter(Boolean) as GunTable[];
          return { ...prev, categories };
        });
      } else if (data.action === 'gun_name_rule' && data.tableId && data.rule) {
        const rule = data.rule;
        setLedger(prev => {
          if (!prev) return prev;
          const categories = { ...prev.categories };
          for (const cat of Object.keys(categories)) {
            const list = categories[cat] || [];
            const idx = list.findIndex(t => t.id === data.tableId);
            if (idx !== -1) {
              const newList = [...list];
              newList[idx] = { ...newList[idx], gunNameRule: rule };
              categories[cat] = newList;
              return { ...prev, categories };
            }
          }
          return prev;
        });
      } else {
        fetchLedger();
      }
    });

    const onVis = () => { if (document.hidden) stopRowLock(); };
    document.addEventListener('visibilitychange', onVis);
    const onBeforeUnload = () => {
      stopRowLock();
      const tid = activeTableIdRef.current;
      if (tid) socket.emit('gun_ledger_unlock_table', { tableId: tid });
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', onBeforeUnload);
      stopRowLock();
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, canAccess]);

  // 浏览器网络在线/离线事件（拔网线等场景比 socket 探测更即时）
  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      fetchLedger();
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [fetchLedger]);

  // 进入离线状态：关闭所有管理类弹窗与重命名输入，避免离线期间产生无法保存的操作
  useEffect(() => {
    if (online) return;
    setRenamingTableId(null);
    setShowPersonPanel(false);
    setShowAccessPanel(false);
    setShowInitPanel(false);
    setAddCategoryOpen(false);
    setAddTableOpen(false);
    setDeleteCategoryTarget(null);
    setDeleteTableTarget(null);
    setConfirmClearId(null);
    setConfirmBatch(null);
  }, [online]);

  // 切换表时：释放上一张表的表级锁与行锁，并同步 ref
  useEffect(() => {
    const prev = prevActiveTableRef.current;
    if (prev && prev !== activeTableId) {
      releaseTableLock(prev);
    }
    prevActiveTableRef.current = activeTableId;
    activeTableIdRef.current = activeTableId;
    stopRowLock();
  }, [activeTableId, stopRowLock, releaseTableLock]);

  // 表级锁心跳：每 20 秒续期一次（服务端 TTL 60 秒）
  useEffect(() => {
    if (!activeTableId || !isAdmin) return;
    const timer = setInterval(() => {
      socketRef.current?.emit('gun_ledger_table_heartbeat', { tableId: activeTableId });
    }, 20000);
    return () => clearInterval(timer);
  }, [activeTableId, isAdmin]);

  // 卸载清理
  useEffect(() => () => {
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
    const tid = prevActiveTableRef.current;
    if (tid) socketRef.current?.emit('gun_ledger_unlock_table', { tableId: tid });
  }, []);

  // Esc 关闭弹窗
  useEffect(() => {
    if (!addCategoryOpen && !addTableOpen && !deleteCategoryTarget && !deleteTableTarget && !showPersonPanel && !showAccessPanel && !showInitPanel && !showExportPanel) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!submitting) { setAddCategoryOpen(false); setAddTableOpen(false); }
        if (!deleting) { setDeleteCategoryTarget(null); setDeleteTableTarget(null); }
        setShowPersonPanel(false);
        setShowAccessPanel(false);
        setShowInitPanel(false);
        setConfirmClearId(null);
        setConfirmBatch(null);
        if (!exporting) setShowExportPanel(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [addCategoryOpen, addTableOpen, deleteCategoryTarget, deleteTableTarget, showPersonPanel, showAccessPanel, showInitPanel, showExportPanel, submitting, deleting, exporting]);

  const closeAddModals = () => {
    if (!submitting) {
      setAddCategoryOpen(false);
      setAddTableOpen(false);
    }
  };

  const closeDeleteModals = () => {
    if (!deleting) {
      setDeleteCategoryTarget(null);
      setDeleteTableTarget(null);
    }
  };

  const submitAddCategory = async () => {
    const name = addCategoryValue.trim();
    if (!name) return;
    if (name.length > 30) { addToast('分类名不超过 30 字符', 'error'); return; }
    if (ledger && Object.prototype.hasOwnProperty.call(ledger.categories, name)) { addToast('已存在同名分类', 'error'); return; }
    setSubmitting(true);
    try {
      await handleAddCategory(name);
      setAddCategoryOpen(false);
      setAddCategoryValue('');
    } finally {
      setSubmitting(false);
    }
  };

  const submitAddTable = async () => {
    const name = addTableValue.trim();
    if (!name) return;
    setSubmitting(true);
    try {
      await handleAddTable(name);
      setAddTableOpen(false);
      setAddTableValue('');
    } finally {
      setSubmitting(false);
    }
  };

  // 底部实时连接状态（与状态跟踪页底部样式一致）
  const isRealtimeSyncAvailable = Boolean(token);
  const syncDotClass = !isRealtimeSyncAvailable
    ? 'bg-amber-500'
    : online
      ? 'bg-green-500'
      : 'bg-red-500';
  const syncFooterIntro = !isRealtimeSyncAvailable
    ? '未登录时需手动刷新页面获取最新状态'
    : '数据同步至服务器';
  const syncFooterLabel = !isRealtimeSyncAvailable ? '更新方式:' : '同步状态:';
  const syncFooterText = !isRealtimeSyncAvailable
    ? '手动刷新'
    : online
      ? '已连接'
      : '未连接';
  const syncFooterTextClass = !isRealtimeSyncAvailable
    ? 'text-amber-600'
    : online
      ? 'text-green-600'
      : 'text-red-600';

  // ===== 台账初始化面板派生数据 =====
  // 分类选择界面：分类顺序与台账一致，统计每个分类的表数/已取号行数
  const initCategoryNames = useMemo(() => Object.keys(ledger?.categories || {}), [ledger]);
  const initCategoryStats = useMemo(() => {
    const stats: Record<string, { tables: number; rows: number }> = {};
    initCategoryNames.forEach(cat => {
      const list = ledger?.categories[cat] || [];
      stats[cat] = {
        tables: list.length,
        rows: list.reduce((sum, t) => sum + (t.rows?.length || 0), 0),
      };
    });
    return stats;
  }, [ledger, initCategoryNames]);
  const initTotalTables = initCategoryNames.reduce((sum, cat) => sum + initCategoryStats[cat].tables, 0);
  const initTotalRows = initCategoryNames.reduce((sum, cat) => sum + initCategoryStats[cat].rows, 0);
  // 详情界面：仅当分类仍存在时进入，否则留在分类选择界面
  const initDetailCategory = initPanelCategory && ledger?.categories[initPanelCategory] ? initPanelCategory : null;
  const initDetailTables = initDetailCategory ? (ledger?.categories[initDetailCategory] || []) : [];

  // 台账初始化详情中的单表卡片（规则开关/前缀/起始/位数/保存/单表初始化）
  const renderInitTableCard = (t: GunTable) => {
    const draft = ruleDrafts[t.id];
    if (!draft) return null;
    const previewName = draft.enabled
      ? buildGunName(draft, 1) + (t.rows && t.rows.length ? `（下一序号 ${t.rows.length + 1}：${buildGunName(draft, t.rows.length + 1)}）` : ' 起')
      : '未启用自动取号，预留行焊枪名为空';
    return (
      <div key={t.id} className="rounded-xl border border-gray-200 bg-gray-50/70 p-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <ClipboardList size={15} className="text-emerald-600 shrink-0" />
            <span className="font-bold text-gray-800 text-sm truncate">{t.name}</span>
            <span className="text-xs text-gray-400 shrink-0">{t.rows?.length || 0} 行已取号</span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {/* 启用/停用自动取号 */}
            <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 cursor-pointer select-none">
              <span>自动取号</span>
              <div className="relative inline-block w-10 h-5 align-middle select-none">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={e => updateRuleDraft(t.id, { enabled: e.target.checked })}
                  className="toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-4 appearance-none cursor-pointer z-10"
                />
                <label className={`toggle-label block overflow-hidden h-5 rounded-full cursor-pointer ${draft.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}></label>
              </div>
            </label>
            {/* 焊枪名初始化（二次确认） */}
            {confirmClearId === t.id ? (
              <span className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-red-600">确认初始化？将删除全部现有内容</span>
                <button
                  onClick={() => initGunNames(t.id)}
                  disabled={clearingTableId === t.id}
                  className="px-2 py-1 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded transition disabled:opacity-50"
                >
                  {clearingTableId === t.id ? '初始化中...' : '确认'}
                </button>
                <button
                  onClick={() => setConfirmClearId(null)}
                  disabled={clearingTableId === t.id}
                  className="px-2 py-1 text-xs font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-100 rounded transition disabled:opacity-50"
                >
                  取消
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmClearId(t.id)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-red-600 hover:text-white bg-red-50 hover:bg-red-500 border border-red-200 hover:border-red-500 rounded transition"
                title="删除全部内容，重置为序号 1-10 的 10 个原始焊枪名"
              >
                <Eraser size={13} />焊枪名初始化
              </button>
            )}
            {/* 保存规则 */}
            <button
              onClick={() => saveGunNameRule(t.id)}
              disabled={ruleSavingId === t.id}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded transition disabled:opacity-50"
            >
              {ruleSavingId === t.id ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
              保存设置
            </button>
          </div>
        </div>
        {draft.enabled && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-gray-500">
              <span>前缀</span>
              <input
                type="text"
                value={draft.prefix}
                maxLength={20}
                onChange={e => updateRuleDraft(t.id, { prefix: e.target.value })}
                className="w-28 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:ring-2 focus:ring-emerald-500 outline-none font-mono"
                placeholder="如 SDZC-C"
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-gray-500">
              <span>起始编号</span>
              <input
                type="number"
                min={0}
                value={draft.start}
                onChange={e => updateRuleDraft(t.id, { start: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
                className="w-24 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:ring-2 focus:ring-emerald-500 outline-none font-mono"
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-gray-500">
              <span>编号位数</span>
              <input
                type="number"
                min={1}
                max={10}
                value={draft.pad}
                onChange={e => updateRuleDraft(t.id, { pad: Math.min(10, Math.max(1, Math.trunc(Number(e.target.value) || 1))) })}
                className="w-16 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:ring-2 focus:ring-emerald-500 outline-none font-mono"
              />
            </label>
            <span className="text-xs text-gray-400 font-mono truncate">预览：{previewName}</span>
          </div>
        )}
      </div>
    );
  };

  // ===== 渲染 =====
  if (!accessLoaded) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <RefreshCw className="animate-spin text-emerald-600 mb-4" size={48} />
        <div className="text-gray-600 font-medium">正在加载焊枪编号台账...</div>
      </div>
    );
  }

  if (!canAccess) {
    const isClosed = !accessSettings.enabled;
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col">
        <header className="bg-white shadow-sm px-6 py-2 h-12 flex items-center justify-between border-b border-gray-200">
          <Link to="/" className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 font-bold transition">
            <ChevronLeft size={20} /><span>返回工作台</span>
          </Link>
          {user && (
            <button onClick={logout} className="flex items-center space-x-1.5 text-gray-600 hover:text-red-600 text-sm font-semibold transition">
              <LogOut size={18} /><span>退出</span>
            </button>
          )}
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <ClipboardList size={64} className="mx-auto text-gray-300 mb-4" />
            <h2 className="text-xl font-bold text-gray-600">{isClosed ? '焊枪编号台账未启用' : '暂无权限访问焊枪编号台账'}</h2>
            <p className="text-gray-400 mt-2">{isClosed ? '请联系超级管理员开启此功能' : '仅管理员可访问，请联系超级管理员'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-[#f3f3f3] flex flex-col font-sans">
      {/* Toast（紧贴标题栏下方，避免遮挡顶部标题栏） */}
      <div className="fixed top-12 right-4 z-50 flex flex-col gap-2">
        {toasts.filter(t => !t.center).map(t => (
          <div key={t.id} className={`flex items-center gap-2 px-4 py-3 rounded shadow-lg text-white transition-all duration-300 ${t.type === 'error' ? 'bg-red-600' : 'bg-green-600'}`}>
            {t.type === 'error' ? <AlertCircle size={18} /> : <Check size={18} />}
            <span className="text-sm font-medium">{t.message}</span>
          </div>
        ))}
      </div>

      {/* 居中高风险操作提示弹窗（不拦截鼠标事件，3 秒自动消失） */}
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div className="flex flex-col items-center gap-2">
          {toasts.filter(t => t.center).map(t => (
            <div key={t.id} className={`flex items-center gap-2 px-6 py-4 rounded-lg shadow-2xl text-white transition-all duration-300 max-w-[90vw] ${t.type === 'error' ? 'bg-red-600' : 'bg-green-600'}`}>
              {t.type === 'error' ? <AlertCircle size={22} className="shrink-0" /> : <Check size={22} className="shrink-0" />}
              <span className="text-base font-semibold">{t.message}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 顶部导航 */}
      <header className="shrink-0 bg-[#217346] text-white px-6 py-2 flex items-center justify-between shadow-md">
        <div className="flex items-center space-x-3">
          <Link to="/" className="flex items-center space-x-1 text-white hover:text-emerald-200 font-bold transition">
            <ChevronLeft size={20} /><span>返回工作台</span>
          </Link>
          <div className="h-6 w-[1px] bg-white/30 mx-2"></div>
          <h2 className="text-lg font-bold flex items-center">
            <ClipboardList className="text-emerald-200 mr-2" size={22} />
            焊枪编号台账
          </h2>
          {/* 分类导出：一个分类一个工作簿，每张表一个工作表；多分类打包 zip */}
          <button
            onClick={openExportPanel}
            className="ml-2 flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/15 hover:bg-white/25 text-xs font-semibold transition"
            title="按分类导出：一个分类一个工作簿，每张表一个工作表"
          >
            <Download size={14} /><span>分类导出</span>
          </button>
          {!online && (
            <span className="ml-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500 text-white">
              <AlertCircle size={12} />离线
            </span>
          )}
          {saving && (
            <span className="ml-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500 text-white">
              <RefreshCw size={12} className="animate-spin" />保存中
            </span>
          )}
        </div>
        {user && (
          <div className="flex items-center space-x-4">
            {/* 台账初始化：按表配置焊枪名生成规则、焊枪名初始化 */}
            {isSuperAdmin && (
              <button
                onClick={openInitPanel}
                className="flex items-center space-x-1.5 text-white hover:text-emerald-200 text-sm font-semibold transition"
                title="台账初始化：设置每张表的焊枪名生成规则、焊枪名初始化"
              >
                <Settings2 size={18} /><span>台账初始化</span>
              </button>
            )}
            {/* 焊枪编号台账查看权限设置 */}
            {isSuperAdmin && (
              <button
                onClick={() => { if (warnIfOffline()) return; setShowAccessPanel(true); setShowPersonPanel(false); }}
                className="flex items-center space-x-1.5 text-white hover:text-emerald-200 text-sm font-semibold transition"
                title="焊枪编号台账查看权限设置"
              >
                <Shield size={18} /><span>权限设置</span>
              </button>
            )}
            {/* 默认担当人员管理 */}
            {isSuperAdmin && (
              <button
                onClick={() => { if (warnIfOffline()) return; setShowPersonPanel(true); setShowAccessPanel(false); }}
                className="flex items-center space-x-1.5 text-white hover:text-emerald-200 text-sm font-semibold transition"
                title="管理担当人员"
              >
                <UserPlus size={18} /><span>担当人员</span>
              </button>
            )}
            <span className="text-sm font-bold text-red-500">{user.name}</span>
            <button onClick={logout} className="flex items-center space-x-1.5 text-white hover:text-red-300 text-sm font-semibold transition">
              <LogOut size={18} /><span>退出</span>
            </button>
          </div>
        )}
      </header>

      {/* 离线禁止编辑提示条（与主页面样式一致） */}
      {!online && (
        <div className="relative z-50 shrink-0 bg-amber-500 text-white px-4 py-2 flex items-center justify-center gap-2 text-xs font-medium border-b border-amber-600 shadow-sm">
          <AlertCircle size={14} className="shrink-0" />
          <span>当前处于离线模式，网络恢复后将自动加载最新数据，此页面禁止编辑！</span>
        </div>
      )}

      {/* 主体 */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* 左侧：分类 + 表列表 */}
        <aside className="w-64 shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden">
          {/* 分类标签 */}
          <div className="shrink-0 p-3 border-b border-gray-200">
            <div className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wide flex items-center justify-between">
              <span>分类</span>
              {isAdmin && (
                <button
                  onClick={() => { if (warnIfOffline()) return; setAddCategoryValue(''); setAddCategoryOpen(true); }}
                  className="text-emerald-600 hover:text-emerald-700"
                  title="新增分类"
                >
                  <Plus size={16} />
                </button>
              )}
            </div>
            <div className="flex flex-col gap-1">
              {Object.keys(ledger?.categories || {}).map((cat, idx, arr) => {
                const canMoveUp = idx > 0;
                const canMoveDown = idx < arr.length - 1;
                return (
                  <div
                    key={cat}
                    className={`group flex items-center rounded-lg transition ${activeCategory === cat ? 'bg-emerald-600 text-white shadow' : 'text-gray-700 hover:bg-emerald-50'}`}
                  >
                    <button
                      onClick={() => handleSelectCategory(cat)}
                      className={`flex-1 px-3 py-2 text-sm font-bold text-left transition ${activeCategory === cat ? 'text-white' : 'text-gray-700'}`}
                    >
                      {cat}
                      <span className="ml-2 text-xs opacity-70">({ledger?.categories[cat]?.length || 0})</span>
                    </button>
                    {isAdmin && (
                      <div className="hidden group-hover:flex pr-1 gap-0.5">
                        <button
                          onClick={() => handleMoveCategory(cat, 'up')}
                          disabled={!canMoveUp}
                          className={`p-1 transition ${activeCategory === cat ? 'text-white hover:text-emerald-200' : 'text-gray-400 hover:text-emerald-600'} ${!canMoveUp ? 'opacity-30 cursor-not-allowed' : ''}`}
                          title="上移"
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          onClick={() => handleMoveCategory(cat, 'down')}
                          disabled={!canMoveDown}
                          className={`p-1 transition ${activeCategory === cat ? 'text-white hover:text-emerald-200' : 'text-gray-400 hover:text-emerald-600'} ${!canMoveDown ? 'opacity-30 cursor-not-allowed' : ''}`}
                          title="下移"
                        >
                          <ArrowDown size={13} />
                        </button>
                      </div>
                    )}
                    {isAdmin && !DEFAULT_CATEGORIES.includes(cat) && (
                      <button
                        onClick={() => openDeleteCategoryModal(cat)}
                        className={`px-2 py-2 opacity-0 group-hover:opacity-100 transition ${activeCategory === cat ? 'text-white hover:text-red-200' : 'text-gray-400 hover:text-red-600'}`}
                        title="删除分类"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {/* 表列表 */}
          <div className="flex-1 overflow-auto p-3">
            <div className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wide flex items-center justify-between">
              <span>表格列表</span>
              {isAdmin && (
                <button onClick={() => { if (warnIfOffline()) return; setAddTableValue(''); setAddTableOpen(true); }} className="text-emerald-600 hover:text-emerald-700" title="新增表">
                  <Plus size={16} />
                </button>
              )}
            </div>
            <div className="flex flex-col gap-1">
              {tables.length === 0 && <div className="text-xs text-gray-400 py-4 text-center">暂无表格</div>}
              {tables.map((t, idx, arr) => {
                const isActive = t.id === activeTableId;
                const canMoveUp = idx > 0;
                const canMoveDown = idx < arr.length - 1;
                const holder = getTableHolder(t.id);
                const lockedByOther = Boolean(holder);
                const lockedBySelf = Boolean(tableLocks[t.id]) && !lockedByOther;
                return (
                  <div key={t.id} className={`group flex items-center ${isActive ? 'bg-emerald-50 border border-emerald-300' : lockedByOther ? 'bg-amber-50 border border-amber-200' : 'hover:bg-gray-50 border border-transparent'} rounded-lg`}>
                    <button
                      onClick={() => handleSelectTable(t)}
                      title={lockedByOther ? `「${holder!.name || holder!.username}」正在编辑该表，暂时无法打开` : undefined}
                      className={`flex-1 px-3 py-2 text-sm text-left font-medium truncate ${isActive ? 'text-emerald-700' : lockedByOther ? 'text-amber-700' : 'text-gray-700'}`}
                    >
                      {renamingTableId === t.id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          disabled={!online}
                          onChange={e => setRenameValue(e.target.value)}
                          onBlur={() => handleRenameTable(t.id)}
                          onKeyDown={e => { if (e.key === 'Enter') handleRenameTable(t.id); if (e.key === 'Escape') { setRenamingTableId(null); setRenameValue(''); } }}
                          className="w-full px-1 py-0 text-sm border border-emerald-400 rounded outline-none disabled:bg-gray-100"
                        />
                      ) : (
                        <span className="flex items-center gap-2 min-w-0">
                          <ClipboardList size={14} className="shrink-0 opacity-70" />
                          <span className="truncate">{t.name}</span>
                          {lockedByOther && (
                            <Lock size={12} className="shrink-0 text-amber-600" aria-label={`${holder!.name || holder!.username} 正在编辑`} />
                          )}
                          {lockedBySelf && (
                            <Lock size={12} className="shrink-0 text-emerald-600" aria-label="我正在编辑" />
                          )}
                        </span>
                      )}
                    </button>
                    {isAdmin && renamingTableId !== t.id && (
                      <div className="hidden group-hover:flex pr-1 gap-0.5">
                        <button onClick={() => handleMoveTable(t.id, 'up')} disabled={!canMoveUp} className={`p-1 text-gray-400 hover:text-emerald-600 ${!canMoveUp ? 'opacity-30 cursor-not-allowed' : ''}`} title="上移"><ArrowUp size={13} /></button>
                        <button onClick={() => handleMoveTable(t.id, 'down')} disabled={!canMoveDown} className={`p-1 text-gray-400 hover:text-emerald-600 ${!canMoveDown ? 'opacity-30 cursor-not-allowed' : ''}`} title="下移"><ArrowDown size={13} /></button>
                        {isAdmin && <button onClick={() => { if (warnIfOffline()) return; setRenamingTableId(t.id); setRenameValue(t.name); }} className="p-1 text-gray-400 hover:text-blue-600" title="重命名"><Pencil size={13} /></button>}
                        <button onClick={() => openDeleteTableModal(t.id, t.name)} className="p-1 text-gray-400 hover:text-red-600" title="删除"><Trash2 size={13} /></button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        {/* 右侧：表格编辑区 */}
        <main className="flex-1 min-w-0 flex flex-col bg-white overflow-hidden">
          {!activeTable ? (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <ClipboardList size={48} className="mx-auto mb-2 opacity-40" />
                <p>请从左侧选择或新增一张表</p>
              </div>
            </div>
          ) : (
            <>
              {/* 表名标题 */}
              <div className="shrink-0 px-4 py-2 border-b border-gray-200 flex items-center justify-between bg-[#f8f9fa]">
                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                  <ClipboardList size={18} className="text-emerald-600" />
                  {activeTable.name}
                  {isAdmin && online && Boolean(tableLocks[activeTable.id]) && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 border border-emerald-200" title="编辑期间其他人员无法打开该表">
                      <Lock size={11} />编辑中 · 其他人暂无法打开
                    </span>
                  )}
                  {!online && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200" title="网络恢复后自动重新进入编辑状态">
                      <AlertCircle size={11} />离线 · 只读禁止编辑
                    </span>
                  )}
                  <span className="text-xs font-normal text-gray-400 ml-2">序号自动递增 · 预留 {PLACEHOLDER_COUNT} 个未取号行</span>
                </h3>
                <div className="flex items-center gap-2">
                  {isAdmin && renamingTableId !== activeTable.id && (
                    <>
                      {isAdmin && (
                        <button
                          onClick={handleFinishEditing}
                          disabled={!online}
                          className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded border transition ${
                            !online
                              ? 'text-gray-400 bg-gray-50 border-gray-200 cursor-not-allowed'
                              : 'text-amber-700 hover:text-white bg-amber-50 hover:bg-amber-500 border-amber-200 hover:border-amber-500'
                          }`}
                          title={!online ? '当前离线，无法结束编辑，请在网络恢复后操作' : '释放编辑锁，关闭本表，其他人员即可打开'}
                        >
                          <Unlock size={13} />完成编辑
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* 网格 */}
              <div className="flex-1 min-h-0 overflow-auto">
                <table className="border-collapse text-[13px] w-full">
                  <thead className="text-xs sticky top-0 z-20">
                    <tr className="bg-[#217346] text-white">
                      {COLUMNS.map(col => (
                        <th key={col.key} className={`${col.width} border border-[#1a5c38] px-2 py-2 text-center font-bold`}>{col.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((row, rowIdx) => {
                      const blocking = activeTable ? getBlockingSession(activeTable.id, row.serialNumber) : null;
                      const isPlaceholder = String(row.id).startsWith('__placeholder__');
                      // key 使用 serialNumber：占位行首次输入提升为真实行时 DOM 不重建、输入焦点不丢失。
                      // 行顺序始终只按 serialNumber 排序，焊枪名（含英文前缀）改动仅影响当前行，不改变行号与其他行。
                      return (
                        <tr key={row.serialNumber} className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'}>
                          <td className="border border-gray-300 px-2 py-1 text-center text-gray-600 font-mono">{row.serialNumber}</td>
                          {EDITABLE_COLS.map((field, colIdx) => {
                            const refKey = `${row.serialNumber}-${field}`;
                            const isResponsible = field === 'responsiblePerson';
                            const value = isPlaceholder ? (field === 'gunName' ? row.gunName : '') : (row[field] as string || '');
                            const disabled = !isAdmin || !online || Boolean(blocking);
                            return (
                              <td key={field} className={`border border-gray-300 p-0 relative ${field === 'gunName' ? 'min-w-[7rem]' : ''}`}>
                                {isResponsible ? (
                                  (() => {
                                    // 已有值不在默认名单中（如他人填写）时追加为选项，避免 select 显示空白
                                    const options = value && !responsibleOptions.includes(value)
                                      ? [value, ...responsibleOptions]
                                      : responsibleOptions;
                                    return (
                                      <select
                                        ref={el => { inputRefs.current[refKey] = el; }}
                                        value={value}
                                        disabled={disabled}
                                        onChange={e => handleCellChange(row, field, e.target.value)}
                                        onFocus={() => handleCellFocus(activeTable.id, row.serialNumber)}
                                        onBlur={handleCellBlur}
                                        onKeyDown={e => handleKeyDown(e, rowIdx, colIdx)}
                                        // appearance-none：不显示下拉按钮，点击整格即弹出完整名单（同状态跟踪页）
                                        className={`w-full px-2 py-1.5 bg-transparent outline-none appearance-none text-center ${disabled ? 'cursor-not-allowed bg-gray-100' : 'cursor-pointer hover:bg-emerald-50 focus:bg-emerald-50'} ${value ? 'text-gray-700' : 'text-gray-400'}`}
                                      >
                                        <option value="">请选择</option>
                                        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                      </select>
                                    );
                                  })()
                                ) : field === 'time' ? (
                                  <>
                                    <input
                                      ref={el => { inputRefs.current[refKey] = el; }}
                                      type="text"
                                      value={value}
                                      disabled={disabled}
                                      onChange={e => handleCellChange(row, field, e.target.value)}
                                      onFocus={() => handleCellFocus(activeTable.id, row.serialNumber)}
                                      onBlur={handleCellBlur}
                                      onKeyDown={e => handleKeyDown(e, rowIdx, colIdx)}
                                      className={`w-full px-2 pr-7 py-1.5 bg-transparent outline-none ${disabled ? 'cursor-not-allowed bg-gray-100' : 'hover:bg-emerald-50 focus:bg-emerald-50'} ${value ? 'text-gray-700' : 'text-gray-400'}`}
                                    />
                                    {/* 一键获取当前时间：格式与焊枪名自动补时间一致（YYYY.MM.DD）；权限/离线/行锁禁用态与输入框一致 */}
                                    <button
                                      type="button"
                                      tabIndex={-1}
                                      disabled={disabled}
                                      title="一键填入当前日期"
                                      onMouseDown={e => e.preventDefault()}
                                      onClick={() => handleCellChange(row, 'time', todayStr())}
                                      className={`absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded transition ${disabled ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-emerald-700 hover:bg-emerald-100'}`}
                                    >
                                      <Clock size={13} />
                                    </button>
                                  </>
                                ) : (
                                  <input
                                    ref={el => { inputRefs.current[refKey] = el; }}
                                    type="text"
                                    value={value}
                                    disabled={disabled}
                                    placeholder={field === 'gunName' ? (isPlaceholder ? '取号...' : '') : field === 'customer' ? '手动填写客户名或输入仕样号自动获取客户名' : ''}
                                    onChange={e => handleCellChange(row, field, e.target.value)}
                                    onFocus={() => handleCellFocus(activeTable.id, row.serialNumber)}
                                    onBlur={handleCellBlur}
                                    onKeyDown={e => handleKeyDown(e, rowIdx, colIdx)}
                                    className={`w-full px-2 py-1.5 bg-transparent outline-none ${disabled ? 'cursor-not-allowed bg-gray-100' : 'hover:bg-emerald-50 focus:bg-emerald-50'} ${value ? 'text-gray-700' : 'text-gray-400'}`}
                                  />
                                )}
                              </td>
                            );
                          })}
                          {/* 操作列：清除该行除焊枪名外的所有内容（每行都有；占位行本无可清内容，点击为无操作） */}
                          <td className="border border-gray-300 px-1 py-1 text-center">
                            <button
                              onClick={() => handleClearRow(row)}
                              disabled={!isAdmin || !online || Boolean(blocking)}
                              title="清除该行除焊枪名外的所有内容"
                              className={`p-1 rounded ${!isAdmin || !online || Boolean(blocking) ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-red-600 hover:bg-red-50'}`}
                            >
                              <Eraser size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 表底部状态条：仅在有他人编辑行 / 只读时有内容，否则不渲染（与底部 footer 无缝衔接） */}
              {showTableStatusBar && (
                <div className="shrink-0 px-4 py-1.5 border-t border-gray-200 bg-[#f8f9fa] flex items-center justify-end text-xs text-gray-500">
                  <div className="flex items-center gap-3">
                    {online && tableEditingSessions.length > 0 && (
                      <span className="flex items-center gap-1 text-amber-600">
                        <Lock size={12} />
                        {tableEditingSessions.filter(s => !user || s.userId !== user.id).length} 行被他人编辑
                      </span>
                    )}
                    {!isAdmin && <span className="text-gray-400">仅查看（需管理员权限编辑）</span>}
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* 底部实时连接状态（与状态跟踪页底部一致） */}
      <footer className="shrink-0 bg-white border-t border-gray-200 px-6 py-3">
        <div className="max-w-7xl mx-auto flex justify-between items-center text-sm text-gray-500">
          <div>{syncFooterIntro}</div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{syncFooterLabel}</span>
            <span className={`flex items-center ${syncFooterTextClass}`}>
              <span className={`w-2 h-2 rounded-full ${syncDotClass}`}></span>
              {syncFooterText}
            </span>
          </div>
        </div>
      </footer>

      {/* 新增分类弹窗 */}
      {addCategoryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeAddModals} />
          <div className="relative bg-white rounded-xl shadow-2xl w-[420px] max-w-[92vw] border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-lg">
                <ClipboardList size={20} />
                新增分类
              </div>
              <button className="p-1 rounded hover:bg-white/20 transition" onClick={closeAddModals} disabled={submitting}>
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-gray-500 text-[10px] font-black uppercase tracking-widest mb-1.5 ml-1">分类名称</label>
                <input
                  type="text"
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:bg-white outline-none text-gray-800 font-semibold transition"
                  value={addCategoryValue}
                  onChange={e => setAddCategoryValue(e.target.value)}
                  placeholder="例如：X2C-V4"
                  autoFocus
                  maxLength={30}
                  onKeyDown={e => { if (e.key === 'Enter') submitAddCategory(); }}
                  disabled={submitting}
                />
                <div className="flex items-center justify-between mt-1.5 ml-1">
                  <span className="text-[11px] text-gray-400">支持中文/英文/数字/连字符，最多 30 字符</span>
                  <span className="text-[11px] text-gray-400">{addCategoryValue.length}/30</span>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition disabled:opacity-50"
                onClick={closeAddModals}
                disabled={submitting}
              >
                取消
              </button>
              <button
                className="px-5 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                onClick={submitAddCategory}
                disabled={submitting || !addCategoryValue.trim()}
              >
                {submitting && <RefreshCw size={14} className="animate-spin" />}
                {submitting ? '提交中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 分类导出弹窗 */}
      {showExportPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { if (!exporting) setShowExportPanel(false); }} />
          <div className="relative bg-white rounded-xl shadow-2xl w-[480px] max-w-[92vw] max-h-[86vh] flex flex-col border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-lg">
                <Download size={20} />
                按分类导出台账
              </div>
              <button className="p-1 rounded hover:bg-white/20 transition" onClick={() => setShowExportPanel(false)} disabled={exporting}>
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <div className="flex items-center justify-between">
                <span className="text-gray-500 text-[10px] font-black uppercase tracking-widest ml-1">选择需要导出的分类</span>
                <div className="flex items-center gap-3 text-xs font-bold">
                  <button
                    className="text-emerald-600 hover:text-emerald-700 transition"
                    onClick={() => setExportCats(Object.keys(ledger?.categories || {}))}
                  >
                    全选
                  </button>
                  <button
                    className="text-gray-400 hover:text-gray-600 transition"
                    onClick={() => setExportCats([])}
                  >
                    清空
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {Object.keys(ledger?.categories || {}).map(name => {
                  const tables = ledger?.categories[name] || [];
                  const rowCount = tables.reduce((sum, t) => sum + (t.rows?.length || 0), 0);
                  const checked = exportCats.includes(name);
                  return (
                    <label
                      key={name}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${checked ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 bg-gray-50 hover:bg-gray-100'}`}
                    >
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-emerald-600"
                        checked={checked}
                        onChange={() => toggleExportCat(name)}
                      />
                      <span className="font-bold text-gray-800 text-sm min-w-[90px]">{name}</span>
                      <span className="text-xs text-gray-400 ml-auto">{tables.length} 张表 / {rowCount} 行</span>
                    </label>
                  );
                })}
              </div>
              <div className="text-[11px] text-gray-400 bg-gray-50 rounded-lg p-2.5 border border-gray-100">
                每个分类是一个 xls 工作簿，分类下的每张表对应一个工作表。选择 1 个分类直接下载 xls；选择多个分类时打包为 zip（每个分类一个 xls）。
              </div>
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
              <span className="text-xs font-bold text-gray-400">已选 {exportCats.length} 个分类</span>
              <div className="flex items-center gap-2">
                <button
                  className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition disabled:opacity-50"
                  onClick={() => setShowExportPanel(false)}
                  disabled={exporting}
                >
                  取消
                </button>
                <button
                  className="px-5 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                  onClick={handleExportCategories}
                  disabled={exporting || !exportCats.length}
                >
                  {exporting && <RefreshCw size={14} className="animate-spin" />}
                  {exporting ? '导出中...' : '导出 xls'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 新增表弹窗 */}
      {addTableOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeAddModals} />
          <div className="relative bg-white rounded-xl shadow-2xl w-[420px] max-w-[92vw] border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-lg">
                <ClipboardList size={20} />
                新增表格
              </div>
              <button className="p-1 rounded hover:bg-white/20 transition" onClick={closeAddModals} disabled={submitting}>
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-gray-500 text-[10px] font-black uppercase tracking-widest mb-1.5 ml-1">所属分类</label>
                <div className="w-full p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 font-semibold">
                  {activeCategory}
                </div>
              </div>
              <div>
                <label className="block text-gray-500 text-[10px] font-black uppercase tracking-widest mb-1.5 ml-1">表格名称</label>
                <input
                  type="text"
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:bg-white outline-none text-gray-800 font-semibold transition"
                  value={addTableValue}
                  onChange={e => setAddTableValue(e.target.value)}
                  placeholder="例如：X2C-001"
                  autoFocus
                  maxLength={50}
                  onKeyDown={e => { if (e.key === 'Enter') submitAddTable(); }}
                  disabled={submitting}
                />
                <div className="flex items-center justify-between mt-1.5 ml-1">
                  <span className="text-[11px] text-gray-400">同类下名称唯一，最多 50 字符</span>
                  <span className="text-[11px] text-gray-400">{addTableValue.length}/50</span>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition disabled:opacity-50"
                onClick={closeAddModals}
                disabled={submitting}
              >
                取消
              </button>
              <button
                className="px-5 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                onClick={submitAddTable}
                disabled={submitting || !addTableValue.trim()}
              >
                {submitting && <RefreshCw size={14} className="animate-spin" />}
                {submitting ? '提交中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除分类确认弹窗 */}
      {deleteCategoryTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeDeleteModals} />
          <div className="relative bg-white rounded-xl shadow-2xl w-[440px] max-w-[92vw] border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-red-500 to-red-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-lg">
                <AlertCircle size={20} />
                删除分类
              </div>
              <button className="p-1 rounded hover:bg-white/20 transition" onClick={closeDeleteModals} disabled={deleting}>
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle size={22} className="text-red-500 shrink-0 mt-0.5" />
                <div className="text-sm text-gray-700 leading-relaxed">
                  <div className="font-bold text-red-700 mb-1">此操作不可恢复</div>
                  <div>
                    确定要删除分类 <span className="font-bold text-gray-900 bg-white px-1.5 py-0.5 rounded border border-gray-200">{deleteCategoryTarget.name}</span>？
                    {deleteCategoryTarget.tableCount > 0 && (
                      <>
                        <br />
                        该分类下还有 <span className="font-bold text-red-600">{deleteCategoryTarget.tableCount}</span> 张表格，将一并删除。
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition disabled:opacity-50"
                onClick={closeDeleteModals}
                disabled={deleting}
              >
                取消
              </button>
              <button
                className="px-5 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                onClick={confirmDeleteCategory}
                disabled={deleting}
              >
                {deleting && <RefreshCw size={14} className="animate-spin" />}
                {deleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除表确认弹窗 */}
      {deleteTableTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeDeleteModals} />
          <div className="relative bg-white rounded-xl shadow-2xl w-[420px] max-w-[92vw] border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-red-500 to-red-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-lg">
                <AlertCircle size={20} />
                删除表格
              </div>
              <button className="p-1 rounded hover:bg-white/20 transition" onClick={closeDeleteModals} disabled={deleting}>
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle size={22} className="text-red-500 shrink-0 mt-0.5" />
                <div className="text-sm text-gray-700 leading-relaxed">
                  <div className="font-bold text-red-700 mb-1">此操作不可恢复</div>
                  <div>
                    确定要删除表格 <span className="font-bold text-gray-900 bg-white px-1.5 py-0.5 rounded border border-gray-200">{deleteTableTarget.name}</span>？
                    <br />表格内所有焊枪记录将被清除。
                  </div>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition disabled:opacity-50"
                onClick={closeDeleteModals}
                disabled={deleting}
              >
                取消
              </button>
              <button
                className="px-5 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                onClick={confirmDeleteTable}
                disabled={deleting}
              >
                {deleting && <RefreshCw size={14} className="animate-spin" />}
                {deleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 台账初始化弹窗：先选分类，再进入该分类逐表设置；分类选择界面支持一键初始化全部表格 */}
      {showInitPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { if (!batchInitializing) setShowInitPanel(false); }} />
          <div className="relative bg-white rounded-xl shadow-2xl w-[840px] max-w-[94vw] max-h-[86vh] flex flex-col border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 font-bold text-lg min-w-0">
                {initDetailCategory ? (
                  <button
                    onClick={() => setInitPanelCategory(null)}
                    className="p-1 rounded hover:bg-white/20 transition -ml-1"
                    title="返回分类选择"
                  >
                    <ChevronLeft size={20} />
                  </button>
                ) : (
                  <Settings2 size={20} />
                )}
                <span className="truncate">台账初始化{initDetailCategory ? ` · ${initDetailCategory}` : ''}</span>
              </div>
              <button className="p-1 rounded hover:bg-white/20 transition shrink-0" onClick={() => setShowInitPanel(false)} disabled={batchInitializing}>
                <X size={20} />
              </button>
            </div>

            {initDetailCategory === null ? (
              /* ===== 分类选择界面 ===== */
              <div className="p-5 overflow-auto">
                <p className="text-xs text-gray-400 leading-relaxed mb-4">
                  按分类进入后逐表配置焊枪名自动生成规则（前缀 + 起始编号 + 编号位数）并初始化；也可直接一键初始化全部表格。「初始化」会删除范围内所有表的已取号行及客户、时间、担当、备注数据，各表恢复为全新状态，仅显示按规则生成的 10 个原始焊枪名预留行，操作不可恢复。
                </p>

                {/* 一键初始化全部表格 */}
                <button
                  onClick={() => setConfirmBatch({ scope: 'all' })}
                  disabled={batchInitializing || initTotalTables === 0}
                  className="w-full mb-5 flex items-center justify-between gap-3 p-4 rounded-xl border-2 border-red-200 bg-red-50 hover:bg-red-100 hover:border-red-300 transition text-left disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="w-10 h-10 rounded-full bg-red-600 text-white flex items-center justify-center shrink-0">
                      {batchInitializing ? <RefreshCw size={20} className="animate-spin" /> : <Zap size={20} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-bold text-red-700 text-sm">一键初始化全部表格</span>
                      <span className="block text-xs text-red-500/90 mt-0.5">清空所有分类下全部表格的已取号内容，各表恢复为 10 个原始焊枪名预留行</span>
                    </span>
                  </span>
                  <span className="text-xs font-bold text-red-600 bg-white px-3 py-1.5 rounded-lg border border-red-200 shrink-0">
                    {initCategoryNames.length} 个分类 · {initTotalTables} 张表 · {initTotalRows} 行
                  </span>
                </button>

                <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 ml-1">选择分类进入初始化设置</div>
                {initCategoryNames.length === 0 && <div className="text-xs text-gray-400 py-4 text-center">暂无分类</div>}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {initCategoryNames.map(cat => {
                    const stat = initCategoryStats[cat] || { tables: 0, rows: 0 };
                    return (
                      <div key={cat} className="group rounded-xl border border-gray-200 bg-gray-50/70 hover:border-emerald-300 hover:bg-emerald-50/60 transition overflow-hidden">
                        <button
                          onClick={() => setInitPanelCategory(cat)}
                          className="w-full p-4 flex items-center gap-3 text-left"
                        >
                          <span className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                            <FolderOpen size={18} />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block font-bold text-gray-800 text-sm truncate">{cat}</span>
                            <span className="block text-xs text-gray-400 mt-0.5">{stat.tables} 张表 · {stat.rows} 行已取号</span>
                          </span>
                          <ChevronRight size={18} className="text-gray-300 group-hover:text-emerald-600 transition shrink-0" />
                        </button>
                        <div className="border-t border-gray-200/70 px-3 py-2 flex items-center justify-end bg-white/50">
                          <button
                            onClick={() => setConfirmBatch({ scope: 'category', category: cat })}
                            disabled={batchInitializing || stat.tables === 0}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-red-600 hover:text-white bg-red-50 hover:bg-red-500 border border-red-200 hover:border-red-500 rounded transition disabled:opacity-40 disabled:cursor-not-allowed"
                            title={`初始化分类「${cat}」下的全部表格`}
                          >
                            <Eraser size={12} />初始化本分类
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* ===== 分类详情：逐表规则设置 + 本分类一键初始化 ===== */
              <div className="p-5 overflow-auto">
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                  <span className="text-xs text-gray-400">
                    共 {initDetailTables.length} 张表 · 合计 {initCategoryStats[initDetailCategory].rows} 行已取号
                  </span>
                  <button
                    onClick={() => setConfirmBatch({ scope: 'category', category: initDetailCategory })}
                    disabled={batchInitializing || initDetailTables.length === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                    title={`初始化分类「${initDetailCategory}」下的全部表格`}
                  >
                    {batchInitializing ? <RefreshCw size={13} className="animate-spin" /> : <Zap size={13} />}
                    一键初始化本分类全部表格（{initDetailTables.length}）
                  </button>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed mb-4">
                  配置预留行的焊枪名自动生成规则（前缀 + 起始编号 + 编号位数），初始化前请先「保存设置」使最新规则生效；「焊枪名初始化」删除该表所有原有内容，表恢复为仅显示 10 个原始焊枪名预留行的全新状态。
                </p>
                {initDetailTables.length === 0 && <div className="text-xs text-gray-400 py-4 text-center">该分类下暂无表格</div>}
                <div className="space-y-2">
                  {initDetailTables.map(t => renderInitTableCard(t))}
                </div>
              </div>
            )}

            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end shrink-0">
              {initDetailCategory ? (
                <button
                  className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition mr-2"
                  onClick={() => setInitPanelCategory(null)}
                >
                  返回分类选择
                </button>
              ) : null}
              <button
                className="px-5 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition"
                onClick={() => setShowInitPanel(false)}
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 一键初始化二次确认弹窗（全部 / 某分类） */}
      {confirmBatch && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { if (!batchInitializing) setConfirmBatch(null); }} />
          <div className="relative bg-white rounded-xl shadow-2xl w-[460px] max-w-[92vw] border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-red-500 to-red-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-lg">
                <AlertCircle size={20} />
                {confirmBatch.scope === 'all' ? '一键初始化全部表格' : `初始化分类「${confirmBatch.category}」`}
              </div>
              <button className="p-1 rounded hover:bg-white/20 transition" onClick={() => setConfirmBatch(null)} disabled={batchInitializing}>
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle size={22} className="text-red-500 shrink-0 mt-0.5" />
                <div className="text-sm text-gray-700 leading-relaxed">
                  <div className="font-bold text-red-700 mb-1">此操作不可恢复</div>
                  {confirmBatch.scope === 'all' ? (
                    <div>
                      即将清空 <span className="font-bold text-gray-900">{initCategoryNames.length}</span> 个分类下共
                      <span className="font-bold text-red-600"> {initTotalTables} </span>张表的全部已取号内容（合计
                      <span className="font-bold text-red-600"> {initTotalRows} </span>行客户、时间、担当、备注数据）。
                    </div>
                  ) : (
                    <div>
                      即将清空分类「<span className="font-bold text-gray-900">{confirmBatch.category}</span>」下共
                      <span className="font-bold text-red-600"> {initCategoryStats[confirmBatch.category]?.tables || 0} </span>张表的全部已取号内容（合计
                      <span className="font-bold text-red-600"> {initCategoryStats[confirmBatch.category]?.rows || 0} </span>行）。
                    </div>
                  )}
                  <div className="mt-1">每张表将恢复为全新状态，仅显示按各自焊枪名规则生成的 10 个原始焊枪名预留行。若有人员正在编辑相关表格，操作会被阻止并提示。</div>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition disabled:opacity-50"
                onClick={() => setConfirmBatch(null)}
                disabled={batchInitializing}
              >
                取消
              </button>
              <button
                className="px-5 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                onClick={() => executeBatchInitialize(confirmBatch)}
                disabled={batchInitializing}
              >
                {batchInitializing && <RefreshCw size={14} className="animate-spin" />}
                {batchInitializing ? '初始化中...' : '确认初始化'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 权限设置弹窗 */}
      {showAccessPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAccessPanel(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-[440px] max-w-[92vw] border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-purple-600 to-purple-700 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-lg">
                <Shield size={20} />
                查看权限设置
              </div>
              <button className="p-1 rounded hover:bg-white/20 transition" onClick={() => setShowAccessPanel(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-gray-400 leading-relaxed">控制谁可以查看焊枪编号台账，修改即时生效并自动保存。</p>
              {[
                { label: '启用焊枪编号台账', detail: 'Global Toggle', key: 'enabled' as const },
                { label: '一般管理员', detail: 'Admin Access', key: 'allowAdmins' as const },
              ].map(item => (
                <div key={item.key} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100 hover:border-purple-200 transition">
                  <div>
                    <div className="font-bold text-gray-700 text-sm">{item.label}</div>
                    <div className="text-[10px] text-gray-400 font-bold uppercase mt-0.5 tracking-wider">{item.detail}</div>
                  </div>
                  <div className="relative inline-block w-12 h-6 align-middle select-none transition duration-200 ease-in">
                    <input
                      type="checkbox"
                      checked={accessSettings[item.key]}
                      onChange={e => updateAccessSettings({ [item.key]: e.target.checked })}
                      className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer z-10"
                    />
                    <label className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer ${accessSettings[item.key] ? 'bg-blue-500' : 'bg-gray-300'}`}></label>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end">
              <button
                className="px-5 py-2 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-700 transition"
                onClick={() => setShowAccessPanel(false)}
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 默认担当人员管理弹窗 */}
      {showPersonPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowPersonPanel(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-[480px] max-w-[92vw] border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-lg">
                <Users size={20} />
                担当人员
                <button
                  onClick={() => { if (warnIfOffline()) return; setShowResetConfirm(true); }}
                  disabled={resettingPersons}
                  className="ml-2 flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-white/15 hover:bg-white/25 rounded-md border border-white/25 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  title="恢复为系统默认担当人员名单"
                >
                  <RefreshCw size={13} className={resettingPersons ? 'animate-spin' : ''} />
                  重置为默认人员
                </button>
              </div>
              <button className="p-1 rounded hover:bg-white/20 transition" onClick={() => setShowPersonPanel(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-gray-400 leading-relaxed">新增焊枪记录时，「担当」列将从此名单中快速选择。</p>
              {/* 添加人员 */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <UserPlus size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    value={newPersonInput}
                    onChange={e => setNewPersonInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && newPersonInput.trim()) handleAddPerson(newPersonInput); }}
                    placeholder="输入姓名，回车快速添加"
                    autoFocus
                    maxLength={20}
                    className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:bg-white outline-none text-sm text-gray-800 font-semibold transition"
                  />
                </div>
                <button
                  onClick={() => newPersonInput.trim() && handleAddPerson(newPersonInput)}
                  disabled={!newPersonInput.trim()}
                  className="px-4 py-2.5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold flex items-center gap-1.5 shrink-0 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus size={15} />添加
                </button>
              </div>
              {/* 人员列表 */}
              <div>
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">人员列表</span>
                  <span className="text-[11px] text-gray-400">共 {(ledger?.defaultResponsiblePersons || []).length} 人</span>
                </div>
                <div className="max-h-64 overflow-auto space-y-2 pr-1">
                  {(ledger?.defaultResponsiblePersons || []).length === 0 && (
                    <div className="flex flex-col items-center justify-center py-8 text-gray-300">
                      <Users size={32} className="mb-2" />
                      <span className="text-xs text-gray-400">暂无担当人员，请在上方添加</span>
                    </div>
                  )}
                  {(ledger?.defaultResponsiblePersons || []).map(p => (
                    <div key={p} className="group flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-emerald-50 border border-gray-100 hover:border-emerald-200 rounded-lg transition">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-black shrink-0">
                          {p.slice(0, 1)}
                        </span>
                        <span className="text-sm font-semibold text-gray-700 truncate">{p}</span>
                      </div>
                      <button
                        onClick={() => handleRemovePerson(p)}
                        className="p-1.5 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition opacity-0 group-hover:opacity-100"
                        title="移除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end">
              <button
                className="px-5 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition"
                onClick={() => setShowPersonPanel(false)}
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 重置为默认人员确认弹窗 */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !resettingPersons && setShowResetConfirm(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-[420px] max-w-[92vw] border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-amber-500 to-amber-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-lg">
                <AlertCircle size={20} />
                重置为默认人员
              </div>
              <button className="p-1 rounded hover:bg-white/20 transition" onClick={() => !resettingPersons && setShowResetConfirm(false)} disabled={resettingPersons}>
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertCircle size={22} className="text-amber-500 shrink-0 mt-0.5" />
                <div className="text-sm text-gray-700 leading-relaxed">
                  <div className="font-bold text-amber-700 mb-1">此操作将覆盖当前名单</div>
                  <div>确定要将担当人员名单重置为系统默认人员吗？当前已添加/移除的人员将全部丢失。</div>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition disabled:opacity-50"
                onClick={() => setShowResetConfirm(false)}
                disabled={resettingPersons}
              >
                取消
              </button>
              <button
                className="px-5 py-2 rounded-lg bg-amber-600 text-white font-bold hover:bg-amber-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                onClick={handleResetPersons}
                disabled={resettingPersons}
              >
                {resettingPersons && <RefreshCw size={14} className="animate-spin" />}
                {resettingPersons ? '重置中...' : '确认重置'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GunLedger;
