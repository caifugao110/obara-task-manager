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
  UserPlus,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { axiosInstance } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSystemSettings } from '../context/SystemSettingsContext';
import { useDebounce } from '../utils/debounce';

interface Toast { message: string; type: 'success' | 'error'; id: number; }

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

interface GunTable { id: string; name: string; rows: GunRow[]; }

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

interface EditingSession {
  tableId: string;
  serialNumber: number;
  userId: string;
  username: string;
  name: string;
  socketId: string;
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

// 根据分类+表名+序号生成焊枪名，无规则时返回空串
const generateGunName = (category: string, tableName: string, serialNumber: number): string => {
  const tablePatterns = GUN_NAME_PATTERNS[category];
  if (!tablePatterns) return '';
  const pattern = tablePatterns[tableName];
  if (!pattern) return '';
  const num = pattern.start + (serialNumber - 1);
  return pattern.prefix + String(num).padStart(pattern.pad, '0');
};
const todayStr = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};

const COLUMNS: { key: keyof GunRow | 'serialNumber'; label: string; width: string }[] = [
  { key: 'serialNumber', label: '序号', width: 'w-16 min-w-[4rem]' },
  { key: 'gunName', label: '焊枪名', width: 'w-28 min-w-[7rem]' },
  { key: 'customer', label: '客户', width: 'w-96 min-w-[24rem]' },
  { key: 'time', label: '时间', width: 'w-24 min-w-[6rem]' },
  { key: 'responsiblePerson', label: '担当', width: 'w-24 min-w-[6rem]' },
  { key: 'remarks', label: '备注', width: 'w-48 min-w-[12rem]' },
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
  const [renamingTableId, setRenamingTableId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newPersonInput, setNewPersonInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [online, setOnline] = useState(true);
  const [showPersonPanel, setShowPersonPanel] = useState(false);
  const [specLookupLoading, setSpecLookupLoading] = useState(false);
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [addCategoryValue, setAddCategoryValue] = useState('');
  const [addTableOpen, setAddTableOpen] = useState(false);
  const [addTableValue, setAddTableValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

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

  const authHeader = useMemo(() => (token ? { headers: { Authorization: `Bearer ${token}` } } : {}), [token]);

  const addToast = useCallback((message: string, type: 'success' | 'error') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { message, type, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

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
    } catch {
      addToast('无法加载焊枪编号台账权限设置', 'error');
    } finally {
      setAccessLoaded(true);
    }
  }, [addToast]);

  // 加载数据
  const fetchLedger = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/gun-ledger', authHeader);
      setLedger(res.data);
    } catch {
      addToast('无法加载焊枪编号台账数据', 'error');
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

  // 自动选中第一个表
  useEffect(() => {
    if (tables.length && (!activeTableId || !tables.find(t => t.id === activeTableId))) {
      setActiveTableId(tables[0].id);
    }
    if (!tables.length) setActiveTableId(null);
  }, [tables, activeTableId]);

  const activeTable = useMemo<GunTable | null>(() => {
    if (!ledger || !activeTableId) return null;
    for (const cat of Object.keys(ledger.categories)) {
      const found = (ledger.categories[cat] || []).find(t => t.id === activeTableId);
      if (found) return found;
    }
    return null;
  }, [ledger, activeTableId]);

  // 计算展示行：真行 + 10 个预填焊枪名的占位行
  const displayRows = useMemo(() => {
    if (!activeTable) return [];
    const real = [...(activeTable.rows || [])].sort((a, b) => a.serialNumber - b.serialNumber);
    const maxSerial = real.length ? Math.max(...real.map(r => r.serialNumber)) : 0;
    const placeholders = Array.from({ length: PLACEHOLDER_COUNT }, (_, i) => {
      const serialNumber = maxSerial + 1 + i;
      return {
        id: `__placeholder__${serialNumber}`,
        serialNumber,
        gunName: generateGunName(activeCategory, activeTable.name, serialNumber),
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

  // 更新本地某表的行
  const patchTableRows = useCallback((tableId: string, updater: (rows: GunRow[]) => GunRow[]) => {
    setLedger(prev => {
      if (!prev) return prev;
      const categories = { ...prev.categories };
      for (const cat of Object.keys(categories)) {
        const list = categories[cat] || [];
        const idx = list.findIndex(t => t.id === tableId);
        if (idx !== -1) {
          const newList = [...list];
          newList[idx] = { ...newList[idx], rows: updater(newList[idx].rows || []) };
          categories[cat] = newList;
          return { ...prev, categories };
        }
      }
      return prev;
    });
  }, []);

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
      }).catch(() => {
        setSaving(false);
        addToast('保存失败，请重试', 'error');
      });
      return prev;
    });
  }, [token, addToast]);

  const debouncedSave = useDebounce((tableId: string) => saveTableRows(tableId), 400);

  // 单元格变更
  const handleCellChange = useCallback((row: GunRow, field: keyof GunRow, value: string) => {
    if (!activeTable || !isAdmin) return;
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
        (promoted as any)[field] = value;
        // 有预填焊枪名时自动填时间与担当（无论哪个字段触发升级）
        if (promoted.gunName.trim() !== '') {
          promoted.time = todayStr();
          promoted.responsiblePerson = user?.name || '';
        }
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
  }, [activeTable, isAdmin, patchTableRows, user, debouncedSave, scheduleCustomerSpecLookup]);

  // 单元格聚焦：取行锁
  const handleCellFocus = useCallback((tableId: string, serialNumber: number) => {
    if (!isAdmin) return;
    startRowLock(tableId, serialNumber);
  }, [isAdmin, startRowLock]);

  const handleCellBlur = useCallback(() => {
    if (!isAdmin) return;
    scheduleStop();
  }, [isAdmin, scheduleStop]);

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
    const name = String(rawName || '').trim();
    if (!name || !ledger) return;
    try {
      const res = await axiosInstance.post(`/gun-ledger/categories/${encodeURIComponent(activeCategory)}/tables`, { name }, authHeader);
      setLedger(prev => prev ? {
        ...prev,
        categories: { ...prev.categories, [activeCategory]: [...(prev.categories[activeCategory] || []), res.data] }
      } : prev);
      setActiveTableId(res.data.id);
      addToast(`已新增表 ${name}`, 'success');
    } catch (err: any) {
      addToast(err?.response?.data?.message || '新增表失败', 'error');
    }
  }, [ledger, activeCategory, authHeader, addToast]);

  // 新增分类
  const handleAddCategory = useCallback(async (rawName: string) => {
    const name = String(rawName || '').trim();
    if (!name || !ledger) return;
    if (name.length > 30) { addToast('分类名不超过 30 字符', 'error'); return; }
    if (Object.prototype.hasOwnProperty.call(ledger.categories, name)) { addToast('已存在同名分类', 'error'); return; }
    try {
      await axiosInstance.post('/gun-ledger/categories', { name }, authHeader);
      setLedger(prev => prev ? { ...prev, categories: { ...prev.categories, [name]: [] } } : prev);
      setActiveCategory(name);
      setActiveTableId(null);
      addToast(`已新增分类 ${name}`, 'success');
    } catch (err: any) {
      addToast(err?.response?.data?.message || '新增分类失败', 'error');
    }
  }, [ledger, authHeader, addToast]);

  // 打开删除分类确认弹窗
  const openDeleteCategoryModal = useCallback((category: string) => {
    if (!ledger) return;
    if (DEFAULT_CATEGORIES.includes(category)) { addToast('默认分类不允许删除', 'error'); return; }
    const tableCount = (ledger.categories[category] || []).length;
    setDeleteCategoryTarget({ name: category, tableCount });
  }, [ledger, addToast]);

  // 确认删除分类（实际执行）
  const confirmDeleteCategory = useCallback(async () => {
    if (!deleteCategoryTarget) return;
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
  }, [deleteCategoryTarget, authHeader, addToast, activeCategory]);

  // 重命名表
  const handleRenameTable = useCallback(async (tableId: string) => {
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
  }, [renameValue, authHeader, addToast]);

  // 打开删除表确认弹窗
  const openDeleteTableModal = useCallback((tableId: string, name: string) => {
    setDeleteTableTarget({ id: tableId, name });
  }, []);

  // 确认删除表（实际执行）
  const confirmDeleteTable = useCallback(async () => {
    if (!deleteTableTarget) return;
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
  }, [deleteTableTarget, authHeader, addToast, activeTableId]);

  // 权限设置保存
  const updateAccessSettings = useCallback(async (next: Partial<typeof defaultAccessSettings>) => {
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
  }, [accessSettings, isSuperAdmin, authHeader, addToast]);

  // 默认担当人员管理
  const handleAddPerson = useCallback(async (person: string) => {
    const p = person.trim();
    if (!p || !ledger) return;
    const list = Array.from(new Set([...(ledger.defaultResponsiblePersons || []), p]));
    try {
      await axiosInstance.put('/gun-ledger/default-persons', list, authHeader);
      setLedger(prev => prev ? { ...prev, defaultResponsiblePersons: list } : prev);
      setNewPersonInput('');
      addToast('已添加默认担当人员', 'success');
    } catch {
      addToast('添加失败', 'error');
    }
  }, [ledger, authHeader, addToast]);

  const handleRemovePerson = useCallback(async (person: string) => {
    if (!ledger) return;
    const list = (ledger.defaultResponsiblePersons || []).filter(p => p !== person);
    try {
      await axiosInstance.put('/gun-ledger/default-persons', list, authHeader);
      setLedger(prev => prev ? { ...prev, defaultResponsiblePersons: list } : prev);
      addToast('已移除', 'success');
    } catch {
      addToast('移除失败', 'error');
    }
  }, [ledger, authHeader, addToast]);

  // 重排分类（上移/下移）：乐观更新 + 持久化 + 广播
  const handleMoveCategory = useCallback((category: string, direction: 'up' | 'down') => {
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
  }, [ledger, authHeader, addToast]);

  // 重排表格（上移/下移）：乐观更新 + 持久化 + 广播
  const handleMoveTable = useCallback((tableId: string, direction: 'up' | 'down') => {
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
  }, [ledger, activeCategory, authHeader, addToast]);

  // Socket 连接
  useEffect(() => {
    if (!token || !canAccess) return;
    const socket = io('/', { path: '/socket.io', reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 3000, timeout: 10000, auth: { token } });
    socketRef.current = socket;

    socket.on('connect', () => { setOnline(true); });
    socket.on('disconnect', () => { setOnline(false); stopRowLock(); });
    socket.on('connect_error', () => { setOnline(false); });

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
    socket.on('gun_ledger_updated', (data: { action: string; tableId?: string; rows?: GunRow[]; category?: string; table?: GunTable; name?: string; defaultResponsiblePersons?: string[]; order?: string[] }) => {
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
              const newList = [...list];
              newList[idx] = { ...newList[idx], rows: merged };
              categories[cat] = newList;
              return { ...prev, categories };
            }
          }
          return prev;
        });
      } else if (data.action === 'add_table' && data.category && data.table) {
        setLedger(prev => prev ? { ...prev, categories: { ...prev.categories, [data.category!]: [...(prev.categories[data.category!] || []), data.table!] } } : prev);
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
      } else {
        fetchLedger();
      }
    });

    const onVis = () => { if (document.hidden) stopRowLock(); };
    document.addEventListener('visibilitychange', onVis);
    const onBeforeUnload = () => stopRowLock();
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

  // 切换表时释放旧锁
  useEffect(() => {
    stopRowLock();
  }, [activeTableId, stopRowLock]);

  // 卸载清理
  useEffect(() => () => {
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
  }, []);

  // Esc 关闭弹窗
  useEffect(() => {
    if (!addCategoryOpen && !addTableOpen && !deleteCategoryTarget && !deleteTableTarget) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!submitting) { setAddCategoryOpen(false); setAddTableOpen(false); }
        if (!deleting) { setDeleteCategoryTarget(null); setDeleteTableTarget(null); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [addCategoryOpen, addTableOpen, deleteCategoryTarget, deleteTableTarget, submitting, deleting]);

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
      {/* Toast */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map(t => (
          <div key={t.id} className={`flex items-center gap-2 px-4 py-3 rounded shadow-lg text-white transition-all duration-300 ${t.type === 'error' ? 'bg-red-600' : 'bg-green-600'}`}>
            {t.type === 'error' ? <AlertCircle size={18} /> : <Check size={18} />}
            <span className="text-sm font-medium">{t.message}</span>
          </div>
        ))}
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
          <div className="flex items-center space-x-4 relative">
            {isSuperAdmin && (
              <button
                onClick={() => setShowPersonPanel(v => !v)}
                className="flex items-center space-x-1.5 text-white hover:text-emerald-200 text-sm font-semibold transition"
                title="管理默认担当人员"
              >
                <UserPlus size={18} /><span>担当人员</span>
              </button>
            )}
            <span className="text-sm font-bold text-amber-200">{user.name}</span>
            <button onClick={logout} className="flex items-center space-x-1.5 text-white hover:text-red-300 text-sm font-semibold transition">
              <LogOut size={18} /><span>退出</span>
            </button>
            {/* 默认担当人员管理弹窗 */}
            {showPersonPanel && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 z-50">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-gray-800 text-sm flex items-center">
                    <UserPlus className="mr-1.5 text-emerald-600" size={16} />
                    默认担当人员
                  </h3>
                  <button onClick={() => setShowPersonPanel(false)} className="text-gray-400 hover:text-gray-600">
                    <X size={16} />
                  </button>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <input
                    type="text"
                    value={newPersonInput}
                    onChange={e => setNewPersonInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && newPersonInput.trim()) handleAddPerson(newPersonInput); }}
                    placeholder="添加姓名"
                    className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-200"
                  />
                  <button onClick={() => newPersonInput.trim() && handleAddPerson(newPersonInput)} className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold flex items-center gap-1 shrink-0">
                    <Plus size={14} />添加
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 max-h-40 overflow-auto">
                  {(ledger?.defaultResponsiblePersons || []).length === 0 && <span className="text-xs text-gray-400">暂无默认人员</span>}
                  {(ledger?.defaultResponsiblePersons || []).map(p => (
                    <span key={p} className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-50 border border-emerald-200 rounded-full text-sm text-gray-700">
                      {p}
                      <button onClick={() => handleRemovePerson(p)} className="text-gray-400 hover:text-red-500" title="移除">
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </header>

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
                  onClick={() => { setAddCategoryValue(''); setAddCategoryOpen(true); }}
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
                      onClick={() => { stopRowLock(); setActiveCategory(cat); }}
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
                    {isSuperAdmin && !DEFAULT_CATEGORIES.includes(cat) && (
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
                <button onClick={() => { setAddTableValue(''); setAddTableOpen(true); }} className="text-emerald-600 hover:text-emerald-700" title="新增表">
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
                return (
                  <div key={t.id} className={`group flex items-center ${isActive ? 'bg-emerald-50 border border-emerald-300' : 'hover:bg-gray-50 border border-transparent'} rounded-lg`}>
                    <button
                      onClick={() => setActiveTableId(t.id)}
                      className={`flex-1 px-3 py-2 text-sm text-left font-medium truncate ${isActive ? 'text-emerald-700' : 'text-gray-700'}`}
                    >
                      {renamingTableId === t.id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onBlur={() => handleRenameTable(t.id)}
                          onKeyDown={e => { if (e.key === 'Enter') handleRenameTable(t.id); if (e.key === 'Escape') { setRenamingTableId(null); setRenameValue(''); } }}
                          className="w-full px-1 py-0 text-sm border border-emerald-400 rounded outline-none"
                        />
                      ) : (
                        <span className="flex items-center gap-2">
                          <ClipboardList size={14} className="shrink-0 opacity-70" />
                          <span className="truncate">{t.name}</span>
                        </span>
                      )}
                    </button>
                    {isAdmin && renamingTableId !== t.id && (
                      <div className="hidden group-hover:flex pr-1 gap-0.5">
                        <button onClick={() => handleMoveTable(t.id, 'up')} disabled={!canMoveUp} className={`p-1 text-gray-400 hover:text-emerald-600 ${!canMoveUp ? 'opacity-30 cursor-not-allowed' : ''}`} title="上移"><ArrowUp size={13} /></button>
                        <button onClick={() => handleMoveTable(t.id, 'down')} disabled={!canMoveDown} className={`p-1 text-gray-400 hover:text-emerald-600 ${!canMoveDown ? 'opacity-30 cursor-not-allowed' : ''}`} title="下移"><ArrowDown size={13} /></button>
                        {isAdmin && <button onClick={() => { setRenamingTableId(t.id); setRenameValue(t.name); }} className="p-1 text-gray-400 hover:text-blue-600" title="重命名"><Pencil size={13} /></button>}
                        {isSuperAdmin && <button onClick={() => openDeleteTableModal(t.id, t.name)} className="p-1 text-gray-400 hover:text-red-600" title="删除"><Trash2 size={13} /></button>}
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
                  <span className="text-xs font-normal text-gray-400 ml-2">序号自动递增 · 预留 {PLACEHOLDER_COUNT} 个未取号行</span>
                </h3>
                <div className="flex items-center gap-2">
                  {isAdmin && renamingTableId !== activeTable.id && (
                    <>
                      {isAdmin && <button onClick={() => { setRenamingTableId(activeTable.id); setRenameValue(activeTable.name); }} className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded" title="重命名表"><Pencil size={15} /></button>}
                      {isSuperAdmin && <button onClick={() => openDeleteTableModal(activeTable.id, activeTable.name)} className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded" title="删除表"><Trash2 size={15} /></button>}
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
                      return (
                        <tr key={row.id} className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'}>
                          <td className="border border-gray-300 px-2 py-1 text-center text-gray-600 font-mono">{row.serialNumber}</td>
                          {EDITABLE_COLS.map((field, colIdx) => {
                            const refKey = `${row.serialNumber}-${field}`;
                            const isResponsible = field === 'responsiblePerson';
                            const value = isPlaceholder ? (field === 'gunName' ? row.gunName : '') : (row[field] as string || '');
                            const disabled = !isAdmin || Boolean(blocking);
                            return (
                              <td key={field} className={`border border-gray-300 p-0 relative ${field === 'gunName' ? 'min-w-[7rem]' : ''}`}>
                                {isResponsible ? (
                                  <input
                                    ref={el => { inputRefs.current[refKey] = el; }}
                                    type="text"
                                    list="responsible-person-options"
                                    value={value}
                                    disabled={disabled}
                                    onChange={e => handleCellChange(row, field, e.target.value)}
                                    onFocus={() => handleCellFocus(activeTable.id, row.serialNumber)}
                                    onBlur={handleCellBlur}
                                    onKeyDown={e => handleKeyDown(e, rowIdx, colIdx)}
                                    className={`w-full px-2 py-1.5 bg-transparent outline-none ${disabled ? 'cursor-not-allowed bg-gray-100' : 'hover:bg-emerald-50 focus:bg-emerald-50'} ${value ? 'text-gray-700' : 'text-gray-400'}`}
                                  />
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
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <datalist id="responsible-person-options">
                  {responsibleOptions.map(opt => <option key={opt} value={opt} />)}
                </datalist>
              </div>

              {/* 表底部状态条 */}
              <div className="shrink-0 px-4 py-1.5 border-t border-gray-200 bg-[#f8f9fa] flex items-center justify-between text-xs text-gray-500">
                <div>已取号 {activeTable.rows?.length || 0} 行 · 占位 {PLACEHOLDER_COUNT} 行</div>
                <div className="flex items-center gap-3">
                  {Object.values(editingSessions).filter(s => s.tableId === activeTable.id).length > 0 && (
                    <span className="flex items-center gap-1 text-amber-600">
                      <Lock size={12} />
                      {Object.values(editingSessions).filter(s => s.tableId === activeTable.id && (!user || s.userId !== user.id)).length} 行被他人编辑
                    </span>
                  )}
                  {!isAdmin && <span className="text-gray-400">仅查看（需管理员权限编辑）</span>}
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      {/* 底部超管区：权限设置 */}
      {isSuperAdmin && (
        <section className="shrink-0 bg-white border-t border-gray-200 px-6 py-4">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
              <Shield className="mr-2 text-purple-600" size={22} />
              焊枪编号台账查看权限设置
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                { label: '启用焊枪编号台账', detail: 'Global Toggle', key: 'enabled' as const },
                { label: '一般管理员', detail: 'Admin Access', key: 'allowAdmins' as const },
              ].map(item => (
                <div key={item.key} className="flex items-center justify-between p-5 bg-gray-50 rounded-xl border border-gray-100">
                  <div>
                    <div className="font-bold text-gray-700">{item.label}</div>
                    <div className="text-[10px] text-gray-400 font-bold uppercase mt-0.5">{item.detail}</div>
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
          </div>
        </section>
      )}

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
    </div>
  );
};

export default GunLedger;
