import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
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
  Eye,
  ChevronRight,
  Zap,
  FolderOpen,
  Clock,
  RotateCcw,
} from 'lucide-react';
import { axiosInstance } from '../services/api';
import LoadingScreen from '../components/LoadingScreen';
import { useAuth } from '../context/AuthContext';
import { useSystemSettings, DefaultGunHours } from '../context/SystemSettingsContext';
import { useDebounce } from '../utils/debounce';
import { acquireSocket } from '../utils/socketClient';
import {
  BUILTIN_TABLE_GUN_HOURS,
  FALLBACK_GUN_HOURS,
  GUN_HOURS_TASK_LABELS,
  EXTRA_TASK_HOURS_LABELS,
  DEFAULT_EXTRA_TASK_HOURS,
  ExtraTaskHours,
  ExtraTaskHoursType,
  GunHoursTaskType,
  TableGunHoursMap,
  getEffectiveTableGunHours,
  resolveGunHours,
} from '../utils/gunHoursRules';

interface Toast { message: string; type: 'success' | 'error'; id: number; center?: boolean }

interface UserMeta { id: string; username: string; name: string; }

interface Designer { id: string; name: string; group?: string; hidden?: boolean; }

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

// 默认工时规则弹窗中的单元格草稿：空串代表未配置（仅可能出现在用户自建表）
type HoursDraftValue = number | '';
interface HoursDraftCell { confirm: HoursDraftValue; confirmModify: HoursDraftValue; design: HoursDraftValue }
type TableHoursDraft = Record<string, Record<string, HoursDraftCell>>;

interface GunTable { id: string; name: string; rows: GunRow[]; gunNameRule?: GunNameRule | null; }

interface SpecInfoResponse {
  success: boolean;
  message?: string;
  specNumber?: string;
  clientName?: string;
  deliveryDate?: string | null;
  isModification?: boolean;
}

// 已存在的相同仕样号任务（用于「添加到已有任务」合并分配）
interface ExistingSpecTask {
  itemId: string;
  taskName: string;
  guns: { id: string; name: string; hours: number | string }[];
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
const DEFAULT_CATEGORIES = ['X2C', 'X2C-V2', 'X2C-V3', 'GLOBAL', 'PSW', 'IT', 'ROBOT', 'EQ', 'TOYOTA'];

const defaultAccessSettings = { enabled: true, allowAdmins: true, allowViewers: false };
const PLACEHOLDER_COUNT = 10;

// 预设颜色池（与主页面 Dashboard 一致），用于随机标记颜色
const PRESET_COLORS = [
  '#fee2e2', '#ffe4e6', '#ffedd5', '#fef3c7', '#fef9c3', '#ecfccb', '#dcfce7', '#d1fae5',
  '#cffafe', '#e0f2fe', '#dbeafe', '#e0e7ff', '#f3e8ff', '#fce7f3', '#f5e6d3', '#f1f5f9',
  '#fca5a5', '#f87171', '#fb7185', '#fdba74', '#fb923c', '#fbbf24', '#fde047', '#a3e635',
  '#86efac', '#34d399', '#67e8f9', '#22d3ee', '#38bdf8', '#93c5fd', '#818cf8', '#d8b4fe',
  '#f9a8d4', '#f472b6', '#c08457', '#94a3b8', '#e5e7eb', '#6b7280',
];
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
  'GLOBAL': {
    'RBC': { prefix: 'RBC', start: 14000, pad: 5 },
    'LAW': { prefix: 'LAW', start: 24080, pad: 5 },
  },
  'TOYOTA': {
    'C01': { prefix: 'C01-C', start: 500,  pad: 4 },
    'C02': { prefix: 'C02-C', start: 120,  pad: 4 },
    'C03': { prefix: 'C03-C', start: 130,  pad: 4 },
    'C04': { prefix: 'C04-C', start: 620,  pad: 4 },
    'C05': { prefix: 'C05-C', start: 180,  pad: 4 },
    'C06': { prefix: 'C06-C', start: 50,   pad: 4 },
    'C07': { prefix: 'C07-C', start: 30,   pad: 4 },
    'C08': { prefix: 'C08-C', start: 10,   pad: 4 },
    'C09': { prefix: 'C09-C', start: 10,   pad: 4 },
    'C10': { prefix: 'C10-C', start: 1,    pad: 4 },
    'X01': { prefix: 'X01-C', start: 30,   pad: 4 },
    'X02': { prefix: 'X02-C', start: 40,   pad: 4 },
    'X03': { prefix: 'X03-C', start: 1420, pad: 4 },
    'X04': { prefix: 'X04-C', start: 700,  pad: 4 },
    'X05': { prefix: 'X05-C', start: 380,  pad: 4 },
    'X06': { prefix: 'X06-C', start: 200,  pad: 4 },
    'X07': { prefix: 'X07-C', start: 180,  pad: 4 },
    'X08': { prefix: 'X08-C', start: 210,  pad: 4 },
    'X09': { prefix: 'X09-C', start: 120,  pad: 4 },
    'X10': { prefix: 'X10-C', start: 50,   pad: 4 },
    'X11': { prefix: 'X11-C', start: 1,    pad: 4 },
    'X12': { prefix: 'X12-C', start: 10,   pad: 4 },
  },
  'PSW': {
    'UC':  { prefix: 'UC-C',  start: 12700, pad: 5 },
    'UX':  { prefix: 'UX-C',  start: 11500, pad: 5 },
    'UCR': { prefix: 'UCR-C', start: 1050,  pad: 4 },
    'UXR': { prefix: 'UXR-C', start: 950,   pad: 4 },
    'NOC': { prefix: 'NOC-C', start: 2130,  pad: 4 },
    'NOX': { prefix: 'NOX-C', start: 2320,  pad: 4 },
  },
  'IT': {
    'PTC':     { prefix: 'PTC-C',   start: 3750,  pad: 4 },
    'PTX':     { prefix: 'PTX-C',   start: 4960,  pad: 4 },
    'PTC-ALC': { prefix: 'PTC-ALC', start: 30,    pad: 4 },
    'PTX-ALC': { prefix: 'PTX-ALC', start: 30,    pad: 4 },
  },
  'ROBOT': {
    'RTC': { prefix: 'RTC-C', start: 2350, pad: 4 },
    'RTX': { prefix: 'RTX-C', start: 2400, pad: 4 },
    'RC':  { prefix: 'RC-C',  start: 25,   pad: 4 },
    'RX':  { prefix: 'RX-C',  start: 35,   pad: 4 },
  },
  'EQ': {
    'PE1':  { prefix: 'PE1-C',  start: 1550, pad: 4 },
    'PE2':  { prefix: 'PE2-C',  start: 250,  pad: 4 },
    'R':    { prefix: 'R-C',    start: 260,  pad: 4 },
    'RR':   { prefix: 'RR-C',   start: 5,    pad: 4 },
    'SEN':  { prefix: 'SEN-C',  start: 150,  pad: 4 },
    'SEU':  { prefix: 'SEU-C',  start: 6,    pad: 4 },
    'SET':  { prefix: 'SET-C',  start: 11,   pad: 4 },
    'STUD': { prefix: 'STUD-C', start: 65,   pad: 4 },
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

// 焊枪名编号归一化：编号由规则决定（不可修改），前缀与编号之后的后缀都可自由编辑。
// 例：规则编号 15015 时，SRTC-2C15015 / SRTC-2C15015L / SRTC-2C15015-EL / SRTC-2C15015L-WL
// 均视为合法名称——编号位置被自动校正为规则值，前后文字原样保留。
const normalizeGunNameNumber = (rule: GunNameRule | null, serialNumber: number, rawValue: string): string => {
  const value = String(rawValue ?? '').trim();
  if (!value || !rule || !rule.enabled) return value;
  const expected = String(rule.start + (serialNumber - 1)).padStart(rule.pad, '0');
  const prefix = String(rule.prefix || '');
  // 规则前缀未被改动时，编号必须紧跟在前缀之后；前缀被改过则在整串里定位编号
  const anchored = prefix !== '' && value.startsWith(prefix);
  const from = anchored ? prefix.length : 0;
  const runs = Array.from(value.matchAll(/\d+/g)).filter(m => (m.index ?? 0) >= from);
  if (runs.length) {
    // 优先取位数与规则编号一致的数字段；都没有时取第一个数字段
    const target = runs.find(m => m[0].length === expected.length) || runs[0];
    if (target[0] === expected) return value;
    const start = target.index ?? 0;
    return value.slice(0, start) + expected + value.slice(start + target[0].length);
  }
  // 整串已没有数字（编号被删空）：前缀未变则补回前缀之后，否则追加到末尾
  return anchored ? prefix + expected + value.slice(prefix.length) : value + expected;
};

// 从某行焊枪名中拆出「编号之前的前缀」与「编号之后的后缀」。
// 编号定位逻辑与 normalizeGunNameNumber 完全一致：规则前缀未被改动时编号紧跟其后，
// 前缀被改过则取位数与规则编号一致的数字段（都没有时取第一个数字段）。
// 返回 null 表示无法拆分（焊枪名为空或整串不含数字）。
const splitGunNameByRule = (rule: GunNameRule, serialNumber: number, name: string): { prefix: string; suffix: string } | null => {
  const value = String(name ?? '').trim();
  if (!value) return null;
  const expected = String(rule.start + (serialNumber - 1)).padStart(rule.pad, '0');
  const rulePrefix = String(rule.prefix || '');
  const anchored = rulePrefix !== '' && value.startsWith(rulePrefix);
  const from = anchored ? rulePrefix.length : 0;
  const runs = Array.from(value.matchAll(/\d+/g)).filter(m => (m.index ?? 0) >= from);
  if (!runs.length) return null;
  const target = runs.find(m => m[0].length === expected.length) || runs[0];
  const start = target.index ?? 0;
  return { prefix: value.slice(0, start), suffix: value.slice(start + target[0].length) };
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
  { key: 'time', label: '时间', width: 'w-24 min-w-[6rem]' },
  { key: 'responsiblePerson', label: '担当', width: 'w-24 min-w-[6rem]' },
  { key: 'remarks', label: '焊枪规格或备注', width: 'w-64 min-w-[16rem]' },
  { key: 'clear', label: '操作', width: 'w-24 min-w-[6rem]' },
];
const EDITABLE_COLS = ['gunName', 'customer', 'time', 'responsiblePerson', 'remarks'] as const;

const GunLedger: React.FC = () => {
  const { user, token, logout } = useAuth();
  const { specNumberDigits, settings: systemSettings, setSettings } = useSystemSettings();
  const isSuperAdmin = user?.role === 'superadmin';
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const [ledger, setLedger] = useState<GunLedgerData | null>(null);
  const [accessSettings, setAccessSettings] = useState(defaultAccessSettings);
  const [accessLoaded, setAccessLoaded] = useState(false);
  // 只写不读：加载标记实际未被消费，保留 setter 以免影响调用方
  const [, setLedgerLoaded] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('X2C');
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [editingSessions, setEditingSessions] = useState<Record<string, EditingSession>>({});
  // 表级独占编辑锁：tableId -> 持有者会话
  const [tableLocks, setTableLocks] = useState<Record<string, TableLockSession>>({});
  // 只读打开的表：表被他人锁定时，用户可以只读打开查看内容，不申请表级锁、不可编辑
  const [readonlyTableId, setReadonlyTableId] = useState<string | null>(null);
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
  // 默认工时规则弹窗（仅超管）：分类选择 → 分类详情两级；表专用规则草稿 + C/X 回退草稿
  const [showHoursPanel, setShowHoursPanel] = useState(false);
  const [hoursPanelCategory, setHoursPanelCategory] = useState<string | null>(null);
  const [tableHoursDraft, setTableHoursDraft] = useState<TableHoursDraft>({});
  const [fallbackHoursDraft, setFallbackHoursDraft] = useState<DefaultGunHours | null>(null);
  // 设计变更 / 既制审图的固定工时草稿（不区分 C/X、不套用表专用规则）
  const [extraHoursDraft, setExtraHoursDraft] = useState<ExtraTaskHours>(DEFAULT_EXTRA_TASK_HOURS);
  // 首页页签：三类规则分页展示，避免三张表纵向堆叠把弹窗拉长
  const [hoursPanelTab, setHoursPanelTab] = useState<'fallback' | 'extra' | 'table'>('fallback');
  const [hoursSaving, setHoursSaving] = useState(false);
  // 默认工时规则恢复内置二次确认：'all' 全部恢复；字符串为分类名；null 关闭
  const [confirmHoursReset, setConfirmHoursReset] = useState<'all' | string | null>(null);
  const [, setSpecLookupLoading] = useState(false);
  // 已被主任务使用的焊枪名集合：命中者枪名显示天蓝色
  const [usedGunNames, setUsedGunNames] = useState<Set<string>>(new Set());
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [addCategoryValue, setAddCategoryValue] = useState('');
  const [addTableOpen, setAddTableOpen] = useState(false);
  const [addTableValue, setAddTableValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 恢复默认排序确认弹窗：'categories' 恢复分类顺序；'tables' 恢复当前分类下表格顺序
  const [restoreTarget, setRestoreTarget] = useState<'categories' | 'tables' | null>(null);
  const [restoring, setRestoring] = useState(false);

  // 任务分配模式：勾选焊枪名后批量给设计人员创建确认图任务
  const [assignmentMode, setAssignmentMode] = useState(false);
  const [selectedGunRowIds, setSelectedGunRowIds] = useState<Set<string>>(new Set());
  const [showAssignPanel, setShowAssignPanel] = useState(false);
  const [assignDesignerId, setAssignDesignerId] = useState('');
  const [assignDate, setAssignDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [designers, setDesigners] = useState<Designer[]>([]);
  const [assigning, setAssigning] = useState(false);
  // 相同仕样号检测：所选设计人员 + 日期下已存在的任务，及「添加到已有任务」复选框状态
  const [existingSpecTasks, setExistingSpecTasks] = useState<ExistingSpecTask[]>([]);
  const [specCheckLoading, setSpecCheckLoading] = useState(false);
  const [mergeIntoExisting, setMergeIntoExisting] = useState(false);
  const [mergeTargetItemId, setMergeTargetItemId] = useState('');

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
  // 操作列「向下复制」每行的复制数量输入框（非受控，点击加号时读取值，1~20）
  const countInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const specLookupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 表级锁相关 refs（供 socket 回调与卸载清理读取最新值）
  const activeTableIdRef = useRef<string | null>(null);
  const prevActiveTableRef = useRef<string | null>(null);
  const readonlyTableIdRef = useRef<string | null>(null);
  readonlyTableIdRef.current = readonlyTableId;
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
      const res = await axiosInstance.post('/spec/spec-info', { specNumber }, { timeout: 15000 } as any);
      return res.data;
    } catch {
      return { success: false, message: '获取仕样信息超时' };
    }
  }, [authHeader]);

  // 从文本中提取仕样号：与系统配置位数一致的独立数字段（台账客户列格式如「57908>O/客户名」）
  const extractSpecNumbers = useCallback((text: string): string[] => {
    const raw = String(text || '');
    if (!raw.trim() || !specNumberDigits) return [];
    const re = new RegExp(`(?<!\\d)\\d{${specNumberDigits}}(?!\\d)`, 'g');
    return Array.from(new Set(raw.match(re) || []));
  }, [specNumberDigits]);

  const sessionKey = (tableId: string, serialNumber: number) => `${tableId}::${serialNumber}`;

  // 权限判定（同 status-tracking：超管恒显，admin 看 enabled+allowAdmins，user 看 enabled+allowViewers）
  const canAccess = useMemo(() => {
    if (isSuperAdmin) return true;
    if (!accessSettings.enabled) return false;
    if (!user) return false;
    if (user.role === 'admin' && accessSettings.allowAdmins) return true;
    if (user.role === 'user' && accessSettings.allowViewers) return true;
    return false;
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
      const res = await axiosInstance.get('/gun-ledger');
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

  // 拉取已被主任务使用的焊枪名集合（用于枪名天蓝色标识）
  const fetchUsedGunNames = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/tasks/used-gun-names');
      setUsedGunNames(new Set((res.data?.gunNames || []).map((n: string) => String(n).trim())));
    } catch {
      // 拉取失败仅影响高亮，不打断台账本身的使用
    }
  }, [authHeader]);

  useEffect(() => {
    if (canAccess) fetchUsedGunNames();
  }, [canAccess, fetchUsedGunNames]);

  // 获取设计人员列表（任务分配模式下拉用）
  const fetchDesigners = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/designers');
      const list = Array.isArray(res.data) ? res.data : [];
      // 按姓名姓氏 A-Z 排序（中文按拼音，英文按字母）
      list.sort((a: Designer, b: Designer) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'));
      setDesigners(list.filter((d: Designer) => !d.hidden));
    } catch {
      // 静默失败，下拉为空时按钮禁用
    }
  }, [authHeader]);

  useEffect(() => {
    if (canAccess && isAdmin) fetchDesigners();
  }, [canAccess, isAdmin, fetchDesigners]);

  // 确认图默认工时：优先枪名所在表（当前打开表）的专用规则，未命中走 C/X 回退与兜底
  const getDefaultConfirmHours = (gunName: string): number => {
    const location = activeTable ? { category: activeCategory, tableName: activeTable.name } : null;
    return resolveGunHours('confirm', gunName, location, systemSettings) ?? 0;
  };

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

  // 当前表是否处于只读打开状态（表被他人锁定时的只读模式：不申请表级锁、禁用所有编辑）
  const activeTableReadOnly = Boolean(activeTable && readonlyTableId === activeTable.id);

  // 切换表或进入只读模式时重置任务分配状态
  useEffect(() => {
    setAssignmentMode(false);
    setSelectedGunRowIds(new Set());
    setShowAssignPanel(false);
  }, [activeTableId, activeTableReadOnly]);

  // 分配面板打开且选定设计人员 + 日期后，拉取该设计人员当月任务，找出该日期下已存在的任务（用于相同仕样号检测）
  useEffect(() => {
    setMergeIntoExisting(false);
    setMergeTargetItemId('');
    if (!showAssignPanel || !isAdmin || !assignDesignerId || !assignDate) {
      setExistingSpecTasks([]);
      return;
    }
    let cancelled = false;
    setSpecCheckLoading(true);
    const [yearStr, monthStr] = assignDate.split('-');
    axiosInstance.get('/tasks', {
      params: { designerId: assignDesignerId, month: parseInt(monthStr, 10), year: parseInt(yearStr, 10) },
    })
      .then((res: any) => {
        if (cancelled) return;
        const sheets = Array.isArray(res.data) ? res.data : [];
        const sheet = sheets.find((s: any) => s.designerId === assignDesignerId);
        const dayItems = Array.isArray(sheet?.days?.[assignDate]) ? sheet.days[assignDate] : [];
        setExistingSpecTasks(dayItems
          .filter((i: any) => !i.leaveType && i.id)
          .map((i: any) => ({
            itemId: String(i.id),
            taskName: String(i.taskName || ''),
            guns: Array.isArray(i.guns) ? i.guns : [],
          })));
      })
      .catch(() => { if (!cancelled) setExistingSpecTasks([]); })
      .finally(() => { if (!cancelled) setSpecCheckLoading(false); });
    return () => { cancelled = true; };
  }, [showAssignPanel, isAdmin, assignDesignerId, assignDate, authHeader]);

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
    const list = ledger?.defaultResponsiblePersons || ['张啸', '张明', '陈青松', '陈大仪', '翟世学', '朱海洋'];
    const set = new Set(list);
    if (user?.name) set.add(user.name);
    return Array.from(set);
  }, [ledger, user]);

  // 当前表中重复的焊枪名集合（用于前端视觉标记）
  const duplicateGunNames = useMemo(() => {
    if (!activeTable) return new Set<string>();
    const nameCount = new Map<string, number>();
    (activeTable.rows || []).forEach(r => {
      const name = String(r.gunName || '').trim();
      if (!name) return;
      nameCount.set(name, (nameCount.get(name) || 0) + 1);
    });
    const dup = new Set<string>();
    for (const [name, count] of nameCount) {
      if (count > 1) dup.add(name);
    }
    return dup;
  }, [activeTable]);

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
      // 普通用户仅有查看权限，被他人锁定的表直接以只读方式打开
      if (!isAdminRef.current) {
        if (activeTableIdRef.current && activeTableIdRef.current !== t.id) stopRowLock();
        setActiveTableId(t.id);
        setReadonlyTableId(t.id);
        addToast(`已只读打开表「${t.name}」（${holder.name || holder.username} 正在编辑）`, 'success');
        return;
      }
      addToast(`「${holder.name || holder.username}」正在编辑表「${t.name}」，请稍后再试；可点击锁旁的只读按钮查看`, 'error');
      return;
    }
    if (activeTableIdRef.current && activeTableIdRef.current !== t.id) stopRowLock();
    setReadonlyTableId(null);
    setActiveTableId(t.id);
    if (isAdminRef.current && onlineRef.current) requestTableLock(t.id);
  }, [getTableHolder, addToast, stopRowLock, requestTableLock]);

  // 只读打开被他人锁定的表：不申请表级锁，所有编辑控件禁用
  const handleSelectTableReadOnly = useCallback((t: GunTable) => {
    if (activeTableIdRef.current && activeTableIdRef.current !== t.id) stopRowLock();
    setActiveTableId(t.id);
    setReadonlyTableId(t.id);
    addToast(`已只读打开表「${t.name}」，无法编辑`, 'success');
  }, [stopRowLock, addToast]);

  // 完成编辑：释放锁并关闭当前表
  const handleFinishEditing = useCallback(() => {
    const tid = activeTableIdRef.current;
    if (tid) {
      if (!readonlyTableIdRef.current || readonlyTableIdRef.current !== tid) {
        releaseTableLock(tid);
      }
    }
    stopRowLock();
    setActiveTableId(null);
    setReadonlyTableId(null);
    addToast(readonlyTableIdRef.current ? '已关闭只读查看' : '已结束编辑，其他人员现在可以打开该表', 'success');
  }, [releaseTableLock, stopRowLock, addToast]);

  // 切换分类：关闭并释放当前表锁
  const handleSelectCategory = useCallback((cat: string) => {
    if (cat === activeCategory) return;
    stopRowLock();
    setActiveTableId(null);
    setReadonlyTableId(null);
    setActiveCategory(cat);
  }, [activeCategory, stopRowLock]);

  // 选中枪名客户列中包含的仕样号，以及所选设计人员 + 日期下与之相同的已有任务
  // 仅匹配「确认图」任务（任务名含「确认图」且不含「确认图修改」）
  const selectedSpecNumbers = showAssignPanel && activeTable
    ? Array.from(new Set((activeTable.rows || [])
        .filter(r => selectedGunRowIds.has(r.id))
        .flatMap(r => extractSpecNumbers(r.customer))))
    : [];
  const matchedExistingSpecTasks = selectedSpecNumbers.length === 0 || existingSpecTasks.length === 0
    ? []
    : existingSpecTasks.filter(t => {
        if (!t.taskName.includes('确认图') || t.taskName.includes('确认图修改')) return false;
        return extractSpecNumbers(t.taskName).some(s => selectedSpecNumbers.includes(s));
      });

  // 任务分配：按客户分组构建确认图任务，批量创建到指定设计人员的指定日期；
  // 勾选「添加到已有任务」时，相同仕样号的枪名追加进已有任务而不新建
  const handleConfirmAssign = useCallback(async () => {
    if (warnIfOffline()) return;
    if (!activeTable || !assignDesignerId || !assignDate) {
      addToast('请选择设计人员和日期', 'error');
      return;
    }
    // 从真实行中按 ID 取选中行
    const selectedRows = (activeTable.rows || []).filter(r => selectedGunRowIds.has(r.id));
    if (selectedRows.length === 0) {
      addToast('未选中任何焊枪名', 'error');
      return;
    }
    // 按客户分组（空 → "未命名"）
    const groups = new Map<string, typeof selectedRows>();
    selectedRows.forEach(r => {
      const customer = String(r.customer || '').trim() || '未命名';
      if (!groups.has(customer)) groups.set(customer, []);
      groups.get(customer)!.push(r);
    });
    // 合并模式：勾选复选框并选定目标后，与目标任务仕样号相同的枪名追加进该任务，不新建
    const mergeTarget = mergeIntoExisting && mergeTargetItemId
      ? matchedExistingSpecTasks.find(t => t.itemId === mergeTargetItemId)
      : null;
    const mergeTargets = new Map<string, { item: ExistingSpecTask; guns: { id: string; name: string; hours: number }[] }>();
    const buildGuns = (rows: typeof selectedRows) => rows.map(r => {
      const hours = getDefaultConfirmHours(r.gunName);
      return { id: `gun-assign-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: r.gunName.trim(), hours };
    });
    const createGroups: Array<[string, typeof selectedRows]> = [];
    Array.from(groups.entries()).forEach(([customer, rows]) => {
      const specs = extractSpecNumbers(customer);
      const matched = mergeTarget && specs.length > 0
        && extractSpecNumbers(mergeTarget.taskName).some(s => specs.includes(s))
        ? mergeTarget
        : null;
      if (matched) {
        const target = mergeTargets.get(matched.itemId) || { item: matched, guns: [] };
        target.guns.push(...buildGuns(rows));
        mergeTargets.set(matched.itemId, target);
      } else {
        createGroups.push([customer, rows]);
      }
    });
    // 构建批量创建 items（仅未命中相同仕样号的组）
    const items = createGroups.map(([customer, rows]) => {
      const guns = buildGuns(rows);
      const hours = guns.reduce((sum, g) => sum + (parseFloat(String(g.hours)) || 0), 0);
      const color = systemSettings.randomAssignmentColor
        ? PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]
        : '#86efac';
      return {
        taskName: `${customer} 确认图`,
        hours,
        color,
        guns,
        leaveType: null,
      };
    });
    setAssigning(true);
    try {
      // 追加枪名到已有任务，并同步任务总工时（有枪名时任务工时 = 枪名工时之和）
      let mergedGunCount = 0;
      for (const [itemId, target] of mergeTargets.entries()) {
        const allGuns = [...target.item.guns, ...target.guns];
        await axiosInstance.put('/tasks/item', {
          designerId: assignDesignerId,
          date: assignDate,
          itemId,
          field: 'guns',
          value: allGuns,
        });
        const totalHours = allGuns.reduce((sum, g) => sum + (parseFloat(String(g.hours)) || 0), 0);
        await axiosInstance.put('/tasks/item', {
          designerId: assignDesignerId,
          date: assignDate,
          itemId,
          field: 'hours',
          value: totalHours,
        });
        mergedGunCount += target.guns.length;
      }
      if (items.length > 0) {
        await axiosInstance.post('/tasks/item/batch', {
          designerId: assignDesignerId,
          date: assignDate,
          items,
        });
      }
      socketRef.current?.emit('task_updated');
      fetchUsedGunNames();
      const designerLabel = designers.find(d => d.id === assignDesignerId)?.name || '设计人员';
      if (mergedGunCount > 0 && items.length === 0) {
        addToast(`已将 ${mergedGunCount} 个枪名添加到 ${mergeTargets.size} 个已有的相同仕样号任务`, 'success');
      } else if (mergedGunCount > 0) {
        addToast(`已创建 ${items.length} 个确认图任务，并将 ${mergedGunCount} 个枪名添加到 ${mergeTargets.size} 个已有任务`, 'success');
      } else {
        addToast(`已为 ${designerLabel} 创建 ${items.length} 个确认图任务`, 'success');
      }
      setSelectedGunRowIds(new Set());
      setShowAssignPanel(false);
      setAssignmentMode(false);
    } catch (err: any) {
      addToast(err?.response?.data?.message || '任务分配失败', 'error');
    } finally {
      setAssigning(false);
    }
  }, [activeTable, assignDesignerId, assignDate, selectedGunRowIds, getDefaultConfirmHours, authHeader, fetchUsedGunNames, addToast, designers, systemSettings, warnIfOffline, extractSpecNumbers, mergeIntoExisting, mergeTargetItemId, matchedExistingSpecTasks]);

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

  // 保存某表行（debounce）
  const saveTableRows = useCallback((tableId: string) => {
    setLedger(prev => {
      if (!prev) return prev;
      let rowsToSave: GunRow[] = [];
      for (const cat of Object.keys(prev.categories)) {
        const t = (prev.categories[cat] || []).find(t => t.id === tableId);
        if (t) { rowsToSave = t.rows || []; break; }
      }

      // 预保存守卫：本地检测到焊枪名重复时直接跳过保存，避免无意义的网络请求
      const localDup = findDuplicateGunNamesClientSide(rowsToSave);
      if (localDup.length) {
        setSaving(false);
        const detail = localDup.map(d => `「${d.gunName}」（序号 ${d.serialNumbers.join('、')}）`).join('；');
        addToast(`焊枪名不可重复：${detail}，请修改后再保存`, 'error');
        return prev;
      }

      axiosInstance.put(`/gun-ledger/tables/${tableId}/rows`, rowsToSave, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(() => {
        dirtyRowIdsRef.current.clear();
        setSaving(false);
      }).catch((err: any) => {
        setSaving(false);
        const status = err?.response?.status;
        const msg = err?.response?.data?.message || '';
        if (status === 409 && msg.startsWith('焊枪名不可重复')) {
          // 焊枪名重复：后端兜底返回（正常情况下前端已拦截），提示 + 重新同步
          addToast(msg + '，已从服务器同步最新数据', 'error');
          dirtyRowIdsRef.current.clear();
          fetchLedger();
        } else if (status === 400 && msg.startsWith('焊枪名编号')) {
          // 焊枪名编号被修改：后端兜底返回（正常情况下前端已自动修正），提示 + 重新同步
          addToast(msg, 'error');
          dirtyRowIdsRef.current.clear();
          fetchLedger();
        } else if (status === 409) {
          // 表被他人锁定：关闭表格
          addToast(msg || '该表正被他人编辑，暂时无法保存', 'error');
          if (activeTableIdRef.current === tableId) {
            socketRef.current?.emit('gun_ledger_unlock_table', { tableId });
            setActiveTableId(null);
          }
        } else {
          addToast(msg || '保存失败，请重试', 'error');
        }
      });
      return prev;
    });
  }, [token, addToast, fetchLedger]);

  // 前端版 findDuplicateGunNames（与后端逻辑一致，空值不计入）
  const findDuplicateGunNamesClientSide = (rows: GunRow[]) => {
    const seen = new Map<string, number[]>();
    rows.forEach(r => {
      const name = String(r.gunName || '').trim();
      if (!name) return;
      if (seen.has(name)) {
        seen.get(name)!.push(r.serialNumber);
      } else {
        seen.set(name, [r.serialNumber]);
      }
    });
    const duplicates: { gunName: string; serialNumbers: number[] }[] = [];
    for (const [gunName, serialNumbers] of seen) {
      if (serialNumbers.length > 1) {
        duplicates.push({ gunName, serialNumbers });
      }
    }
    return duplicates;
  };

  const debouncedSave = useDebounce((tableId: string) => saveTableRows(tableId), 400);

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
        patchTableRows(tableId, rows => rows.map(r => r.serialNumber === serialNumber ? { ...r, customer: clientName, updatedAt: new Date().toISOString() } : r));
        // 完整客户名查询回来后必须再次触发保存，否则只会保存到本地状态，
        // 后端和其他客户端仍只保留最初输入的仕样号。
        setSaving(true);
        debouncedSave(tableId);
        addToast(`已获取客户：${clientName}`, 'success');
      } else {
        addToast(info.message || `未找到仕样号 ${trimmed} 的客户信息`, 'error');
      }
    }, 600);
  }, [specNumberDigits, fetchSpecInfo, patchTableRows, addToast, debouncedSave]);

  // 单元格变更
  const handleCellChange = useCallback((row: GunRow, field: keyof GunRow, value: string) => {
    if (!activeTable || !isAdmin || !online) return;
    const { id, serialNumber } = row;
    const isPlaceholder = String(id).startsWith('__placeholder__');

    // 焊枪名编号不可编辑 + 前缀可编辑 + 编号之后可追加后缀 + 同表不可重复
    if (field === 'gunName') {
      const rule = getEffectiveGunNameRule(activeCategory, activeTable);
      if (rule && rule.enabled) {
        // 编号自动校正为规则值；前缀与编号之后的后缀（L / -EL / L-WL 等）原样保留
        value = normalizeGunNameNumber(rule, serialNumber, value);
      }
      // 同表内焊枪名不可重复（空值不计入）
      const trimmedNewName = value.trim();
      if (trimmedNewName) {
        const dup = (activeTable.rows || []).find(r =>
          r.id !== id && String(r.gunName || '').trim() === trimmedNewName
        );
        if (dup) {
          addToast(`焊枪名「${trimmedNewName}」已被序号 ${dup.serialNumber} 使用，请修改`, 'error');
        }
      }
    }

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
  }, [activeTable, activeCategory, isAdmin, online, addToast, patchTableRows, user, debouncedSave, scheduleCustomerSpecLookup]);

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
    if (!activeTable || !isAdmin || !online || activeTableReadOnly) return;
    if (String(row.id).startsWith('__placeholder__')) return;
    patchTableRows(activeTable.id, rows => rows.map(r => r.id === row.id
      ? { ...r, customer: '', time: '', responsiblePerson: '', remarks: '', updatedAt: new Date().toISOString(), updatedBy: user ? { id: user.id, username: user.username, name: user.name } : null }
      : r));
    dirtyRowIdsRef.current.add(row.id);
    setSaving(true);
    debouncedSave(activeTable.id);
  }, [activeTable, isAdmin, online, activeTableReadOnly, patchTableRows, user, debouncedSave]);

  // 向下复制：把当前行的「客户名」复制到该行下方最新的「客户名为空」的行
  // 时间列填当前日期（与时间列 Clock 按钮同格式），担当列填当前操作者
  // 焊枪名：不再沿用目标行按表默认规则预填的名字，而是继承当前行焊枪名的前缀与后缀，
  // 仅编号替换为目标行规则编号（prefix + 目标行编号 + suffix），即整列焊枪名仅编号不一致
  // 加号按钮前的数字框决定复制行数（默认 1，范围 1~20）；占位行会被提升为真实行
  const handleCopyDown = useCallback((row: GunRow) => {
    if (!activeTable || !isAdmin || !online || activeTableReadOnly) return;
    const srcCustomer = row.customer;
    if (!srcCustomer.trim()) {
      addToast('当前行客户名为空，无法复制', 'error');
      return;
    }
    // 拆分当前行焊枪名的前缀/后缀（无生效规则或无法拆分时不改写目标行焊枪名）
    const rule = getEffectiveGunNameRule(activeCategory, activeTable);
    const split = rule && rule.enabled ? splitGunNameByRule(rule, row.serialNumber, row.gunName) : null;
    const nowTime = todayStr();
    const currentPerson = user?.name || '';
    // 读取该行数字框的复制数量（非受控，点击时取值并夹到 1~10）
    const inputEl = countInputRefs.current[row.id];
    let count = 1;
    if (inputEl) {
      const parsed = parseInt(inputEl.value, 10);
      if (!Number.isNaN(parsed)) count = Math.min(10, Math.max(1, parsed));
    }
    // 在展示行中定位当前行，取其下方「客户名为空」的行（升序）前 count 个
    const startIdx = displayRows.findIndex(r => r.id === row.id);
    if (startIdx < 0) return;
    const targets = displayRows
      .slice(startIdx + 1)
      .filter(r => !r.customer.trim())
      .slice(0, count);
    if (targets.length === 0) {
      addToast('下方无客户名为空的行可复制', 'error');
      return;
    }
    patchTableRows(activeTable.id, rows => {
      let next = [...rows];
      const nowIso = new Date().toISOString();
      const userMeta = user ? { id: user.id, username: user.username, name: user.name } : null;
      for (const t of targets) {
        // 目标行焊枪名：当前行前缀 + 目标行规则编号 + 当前后缀（无法拆分时保留原名）
        const newGunName = split && rule
          ? split.prefix + String(rule.start + (t.serialNumber - 1)).padStart(rule.pad, '0') + split.suffix
          : t.gunName;
        const isPlaceholder = String(t.id).startsWith('__placeholder__');
        if (isPlaceholder) {
          // 占位行：提升为真实行，写入继承自当前行的焊枪名与客户/时间/担当
          const promoted: GunRow = {
            id: newRowId(),
            serialNumber: t.serialNumber,
            gunName: newGunName,
            customer: srcCustomer,
            time: nowTime,
            responsiblePerson: currentPerson,
            remarks: '',
            createdAt: nowIso,
            createdBy: userMeta,
            updatedAt: nowIso,
            updatedBy: userMeta,
          };
          next = [...next, promoted];
          dirtyRowIdsRef.current.add(promoted.id);
        } else {
          // 已有空行：改写焊枪名（继承当前行前缀/后缀，仅编号不同）并写入客户/时间/担当，保留备注
          next = next.map(r => r.id === t.id
            ? { ...r, gunName: newGunName, customer: srcCustomer, time: nowTime, responsiblePerson: currentPerson, updatedAt: nowIso, updatedBy: userMeta }
            : r);
          dirtyRowIdsRef.current.add(t.id);
        }
      }
      return next;
    });
    setSaving(true);
    debouncedSave(activeTable.id);
    if (targets.length < count) {
      addToast(`下方仅有 ${targets.length} 行客户名为空，已复制 ${targets.length} 行`, 'success');
    }
  }, [activeTable, activeCategory, isAdmin, online, activeTableReadOnly, displayRows, patchTableRows, user, debouncedSave, addToast]);

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
      const res = await axiosInstance.post(`/gun-ledger/categories/${encodeURIComponent(activeCategory)}/tables`, { name });
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
      await axiosInstance.post('/gun-ledger/categories', { name });
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
    // 分类下有任意表格被他人锁定时禁止删除
    const catTables = ledger.categories[category] || [];
    if (catTables.some(t => Boolean(getTableHolder(t.id)))) {
      addToast('分类下有表格被他人锁定，暂时无法删除分类', 'error');
      return;
    }
    const tableCount = catTables.length;
    setDeleteCategoryTarget({ name: category, tableCount });
  }, [ledger, addToast, isSuperAdmin, warnIfOffline, getTableHolder]);

  // 确认删除分类（实际执行）
  const confirmDeleteCategory = useCallback(async () => {
    if (!deleteCategoryTarget) return;
    if (warnIfOffline()) return;
    setDeleting(true);
    try {
      await axiosInstance.delete(`/gun-ledger/categories/${encodeURIComponent(deleteCategoryTarget.name)}`);
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
      await axiosInstance.patch(`/gun-ledger/tables/${tableId}`, { name });
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
    // 表被他人锁定时禁止删除
    const holder = getTableHolder(tableId);
    if (holder) {
      addToast(`表被「${holder.name || holder.username}」锁定，暂时无法删除`, 'error');
      return;
    }
    setDeleteTableTarget({ id: tableId, name });
  }, [isSuperAdmin, addToast, warnIfOffline, getTableHolder]);

  // 确认删除表（实际执行）
  const confirmDeleteTable = useCallback(async () => {
    if (!deleteTableTarget) return;
    if (warnIfOffline()) return;
    setDeleting(true);
    try {
      await axiosInstance.delete(`/gun-ledger/tables/${deleteTableTarget.id}`);
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
    if (next.enabled === false) {
      updated.allowAdmins = false;
      updated.allowViewers = false;
    }
    if (next.enabled === true) {
      updated.allowAdmins = true;
      updated.allowViewers = true;
    }
    if (next.allowAdmins === false && updated.allowViewers) {
      addToast('普通用户权限开启时，不能关闭一般管理员权限', 'error');
      return;
    }
    if (updated.allowViewers) updated.allowAdmins = true;
    setAccessSettings(updated);
    if (!isSuperAdmin) return;
    try {
      await axiosInstance.put('/settings/gun-ledger', updated);
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
      await axiosInstance.put(`/gun-ledger/tables/${tableId}/gun-name-rule`, rule);
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
      await axiosInstance.post(`/gun-ledger/tables/${tableId}/initialize-gun-names`);
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
      const res = await axiosInstance.post(url);
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

  // ===== 默认工时规则：按表专用规则 + C/X 机型回退规则 =====
  // 打开弹窗：按台账实际存在的表生成草稿，已配置覆盖值优先，否则预填内置专用规则；
  // 用户自建且未配置过的表三个输入框留空（保存时跳过，运行时回退 C/X 规则）
  const openHoursPanel = useCallback(() => {
    if (warnIfOffline()) return;
    if (!ledger) return;
    const draft: TableHoursDraft = {};
    Object.keys(ledger.categories).forEach(cat => {
      draft[cat] = {};
      (ledger.categories[cat] || []).forEach(t => {
        const cell = getEffectiveTableGunHours(systemSettings.tableGunHours, cat, t.name);
        draft[cat][t.name] = cell
          ? { confirm: cell.confirm, confirmModify: cell.confirmModify, design: cell.design }
          : { confirm: '', confirmModify: '', design: '' };
      });
    });
    const fb = systemSettings.defaultGunHours;
    setTableHoursDraft(draft);
    setFallbackHoursDraft(fb
      ? {
          confirm: { ...fb.confirm },
          design: { ...fb.design },
          confirmModify: { ...fb.confirmModify },
        }
      : null);
    setExtraHoursDraft({ ...DEFAULT_EXTRA_TASK_HOURS, ...(systemSettings.extraTaskHours || {}) });
    setHoursPanelCategory(null);
    setHoursPanelTab('fallback');
    setShowHoursPanel(true);
  }, [ledger, systemSettings, warnIfOffline]);

  const updateTableHoursDraft = (
    category: string,
    tableName: string,
    key: GunHoursTaskType,
    raw: string
  ) => {
    setTableHoursDraft(prev => {
      const current = prev[category]?.[tableName];
      if (!current) return prev;
      let value: HoursDraftValue = '';
      if (raw !== '') {
        const num = parseFloat(raw);
        if (!Number.isFinite(num) || num < 0 || num > 24) return prev;
        value = num;
      }
      return {
        ...prev,
        [category]: {
          ...prev[category],
          [tableName]: { ...current, [key]: value },
        },
      };
    });
  };

  const updateFallbackHoursDraft = (
    key: GunHoursTaskType,
    gunType: 'C' | 'X',
    raw: string
  ) => {
    const num = parseFloat(raw);
    if (!Number.isFinite(num) || num < 0 || num > 24) return;
    setFallbackHoursDraft(prev => prev ? { ...prev, [key]: { ...prev[key], [gunType]: num } } : prev);
  };

  // 设计变更 / 既制审图 的固定工时（单一数值，不分 C/X）
  const updateExtraHoursDraft = (key: ExtraTaskHoursType, raw: string) => {
    const num = parseFloat(raw);
    if (!Number.isFinite(num) || num < 0 || num > 24) return;
    setExtraHoursDraft(prev => ({ ...prev, [key]: num }));
  };

  // 某分类恢复为内置专用规则（无内置值的自建表清空）
  const resetCategoryHoursDraft = (category: string) => {
    if (!ledger) return;
    setTableHoursDraft(prev => {
      const next: TableHoursDraft = { ...prev, [category]: {} };
      (ledger.categories[category] || []).forEach(t => {
        const cell = BUILTIN_TABLE_GUN_HOURS[category]?.[t.name];
        next[category][t.name] = cell
          ? { confirm: cell.confirm, confirmModify: cell.confirmModify, design: cell.design }
          : { confirm: '', confirmModify: '', design: '' };
      });
      return next;
    });
  };

  // 全部恢复内置：表专用规则 + C/X 回退规则
  const resetAllHoursDraft = () => {
    if (!ledger) return;
    const draft: TableHoursDraft = {};
    Object.keys(ledger.categories).forEach(cat => {
      draft[cat] = {};
      (ledger.categories[cat] || []).forEach(t => {
        const cell = BUILTIN_TABLE_GUN_HOURS[cat]?.[t.name];
        draft[cat][t.name] = cell
          ? { confirm: cell.confirm, confirmModify: cell.confirmModify, design: cell.design }
          : { confirm: '', confirmModify: '', design: '' };
      });
    });
    setTableHoursDraft(draft);
    setFallbackHoursDraft({
      confirm: { C: 1.5, X: 2 },
      design: { C: 2.5, X: 3 },
      confirmModify: { C: 0.5, X: 0.75 },
    });
    setExtraHoursDraft({ ...DEFAULT_EXTRA_TASK_HOURS });
  };

  const saveHoursRules = useCallback(async () => {
    if (warnIfOffline()) return;
    if (!fallbackHoursDraft) return;
    const tableGunHours: TableGunHoursMap = {};
    for (const category of Object.keys(tableHoursDraft)) {
      for (const [tableName, cell] of Object.entries(tableHoursDraft[category] || {})) {
        const values = [cell.confirm, cell.confirmModify, cell.design];
        const allEmpty = values.every(v => v === '');
        if (allEmpty) continue;
        if (values.some(v => v === '' || !Number.isFinite(v))) {
          addToast(`表「${category} / ${tableName}」三个工时需全部填写或全部留空`, 'error', true);
          setHoursPanelCategory(category);
          return;
        }
        if (!tableGunHours[category]) tableGunHours[category] = {};
        tableGunHours[category][tableName] = {
          confirm: Number(cell.confirm),
          confirmModify: Number(cell.confirmModify),
          design: Number(cell.design),
        };
      }
    }
    setHoursSaving(true);
    try {
      const updated = {
        ...systemSettings,
        defaultGunHours: fallbackHoursDraft,
        tableGunHours,
        extraTaskHours: extraHoursDraft,
      };
      await axiosInstance.put('/system/settings', updated);
      setSettings(updated);
      addToast('默认工时规则已保存', 'success');
      setShowHoursPanel(false);
    } catch (err: any) {
      addToast(err?.response?.data?.message || '默认工时规则保存失败', 'error');
    } finally {
      setHoursSaving(false);
    }
  }, [fallbackHoursDraft, tableHoursDraft, extraHoursDraft, systemSettings, authHeader, setSettings, addToast, warnIfOffline]);

  // 默认担当人员管理
  const handleAddPerson = useCallback(async (person: string) => {
    if (warnIfOffline()) return;
    const p = person.trim();
    if (!p || !ledger) return;
    const list = Array.from(new Set([...(ledger.defaultResponsiblePersons || []), p]));
    try {
      await axiosInstance.put('/gun-ledger/default-persons', list);
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
      await axiosInstance.put('/gun-ledger/default-persons', list);
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
      const res = await axiosInstance.post('/gun-ledger/default-persons/reset');
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
    axiosInstance.patch('/gun-ledger/categories/order', { order: nextOrder })
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
    axiosInstance.patch('/gun-ledger/tables/order', { category: activeCategory, order: nextOrder })
      .catch(() => addToast('表格顺序保存失败', 'error'));
  }, [ledger, activeCategory, authHeader, addToast, warnIfOffline]);

  // 恢复默认排序（仅超管）：弹窗确认后调用后端接口，并用响应数据更新本地状态
  const confirmRestoreDefaultOrder = useCallback(async () => {
    if (!restoreTarget || warnIfOffline()) return;
    setRestoring(true);
    try {
      if (restoreTarget === 'categories') {
        const res = await axiosInstance.post('/gun-ledger/categories/order/default');
        const order: string[] = res.data?.order || [];
        setLedger(prev => {
          if (!prev) return prev;
          const rebuilt: Record<string, GunTable[]> = {};
          order.forEach(k => { rebuilt[k] = prev.categories[k] || []; });
          Object.keys(prev.categories).forEach(k => { if (!(k in rebuilt)) rebuilt[k] = prev.categories[k]; });
          return { ...prev, categories: rebuilt };
        });
        addToast('分类顺序已恢复为默认排序', 'success');
      } else {
        const res = await axiosInstance.post('/gun-ledger/tables/order/default', { category: activeCategory });
        const order: string[] = res.data?.order || [];
        setLedger(prev => {
          if (!prev) return prev;
          const categories = { ...prev.categories };
          const oldList = categories[activeCategory] || [];
          const byId = new Map(oldList.map(t => [t.id, t]));
          const reordered = order.map(id => byId.get(id)).filter(Boolean) as GunTable[];
          oldList.forEach(t => { if (!order.includes(t.id)) reordered.push(t); });
          categories[activeCategory] = reordered;
          return { ...prev, categories };
        });
        addToast('表格顺序已恢复为默认排序', 'success');
      }
      setRestoreTarget(null);
    } catch (err: any) {
      addToast(err?.response?.data?.message || '恢复默认排序失败', 'error');
    } finally {
      setRestoring(false);
    }
  }, [restoreTarget, activeCategory, authHeader, addToast, warnIfOffline]);

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
    // 共享连接：全应用只维护一条 WebSocket，由 socketClient 按引用计数管理生命周期
    const handle = acquireSocket(token);
    socketRef.current = handle.socket;
    let hasConnectedOnce = false;

    handle.on('connect', () => {
      setOnline(true);
      // 断线重连后：刷新台账数据并重新申请表级锁；若期间锁被他人取得，会收到 blocked 事件并自动关闭
      if (hasConnectedOnce) fetchLedger();
      hasConnectedOnce = true;
      fetchUsedGunNames();
      const tid = activeTableIdRef.current;
      if (tid && isAdminRef.current) handle.socket.emit('gun_ledger_lock_table', { tableId: tid });
    });
    handle.on('disconnect', () => { setOnline(false); stopRowLock(); });
    handle.on('connect_error', () => { setOnline(false); });

    // 主页面任务变更后服务端广播 task_refreshed：同步刷新已用枪名（天蓝色标识）
    handle.on('task_refreshed', () => {
      fetchUsedGunNames();
    });

    // ===== 表级独占编辑锁事件 =====
    // 下列两个是连接期快照：共享连接可能早于本页挂载建立、事件不会重放，
    // 因此注册后用缓存补一次初始状态
    const applyTableLocksState = (sessions: TableLockSession[]) => {
      const next: Record<string, TableLockSession> = {};
      (Array.isArray(sessions) ? sessions : []).forEach(s => {
        if (s?.tableId) next[s.tableId] = s;
      });
      setTableLocks(next);
    };
    handle.on('gun_ledger_table_locks_state', applyTableLocksState);
    const cachedTableLocks = handle.getSnapshot<TableLockSession[]>('gun_ledger_table_locks_state');
    if (cachedTableLocks) applyTableLocksState(cachedTableLocks);

    handle.on('gun_ledger_table_locked', (s: TableLockSession) => {
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
    handle.on('gun_ledger_table_unlocked', (data: { tableId: string }) => {
      if (!data?.tableId) return;
      setTableLocks(prev => { const n = { ...prev }; delete n[data.tableId]; return n; });
    });
    handle.on('gun_ledger_table_lock_blocked', (data: { tableId: string; holder: TableLockSession }) => {
      if (!data?.tableId) return;
      const holder = data.holder;
      addToast(`「${holder?.name || holder?.username || '他人'}」正在编辑该表，无法打开`, 'error');
      stopRowLock();
      setActiveTableId(prev => (prev === data.tableId ? null : prev));
    });

    const applyGunEditingState = (sessions: EditingSession[]) => {
      const next: Record<string, EditingSession> = {};
      (Array.isArray(sessions) ? sessions : []).forEach(s => {
        if (s?.tableId && s.serialNumber !== undefined) next[sessionKey(s.tableId, s.serialNumber)] = s;
      });
      setEditingSessions(next);
    };
    handle.on('gun_ledger_editing_state', applyGunEditingState);
    const cachedGunEditing = handle.getSnapshot<EditingSession[]>('gun_ledger_editing_state');
    if (cachedGunEditing) applyGunEditingState(cachedGunEditing);

    handle.on('gun_ledger_edit_start', (s: EditingSession) => {
      if (!s?.tableId || s.serialNumber === undefined) return;
      setEditingSessions(prev => ({ ...prev, [sessionKey(s.tableId, s.serialNumber)]: s }));
    });
    handle.on('gun_ledger_edit_stop', (data: { tableId: string; serialNumber: number }) => {
      if (!data?.tableId || data.serialNumber === undefined) return;
      setEditingSessions(prev => { const n = { ...prev }; delete n[sessionKey(data.tableId, data.serialNumber)]; return n; });
    });
    handle.on('gun_ledger_edit_blocked', (s: EditingSession) => {
      addToast(`${s.name || s.username} 正在编辑该行`, 'error');
    });
    handle.on('gun_ledger_updated', (data: { action: string; tableId?: string; rows?: GunRow[]; category?: string; table?: GunTable; name?: string; defaultResponsiblePersons?: string[]; order?: string[]; rule?: GunNameRule }) => {
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
      if (tid) handle.socket.emit('gun_ledger_unlock_table', { tableId: tid });
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', onBeforeUnload);
      stopRowLock();
      handle.release();
      socketRef.current = null;
    };
  }, [token, canAccess]);

  // 浏览器网络在线/离线事件（拔网线等场景比 socket 探测更即时）
  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      fetchLedger();
      fetchUsedGunNames();
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    // 后端 HTTP 可达性（全局心跳广播）：与浏览器网络事件共用同一套在线判定，
    // 后端进程停止时不必等 socket 超时
    window.addEventListener('server-online', handleOnline);
    window.addEventListener('server-unreachable', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('server-online', handleOnline);
      window.removeEventListener('server-unreachable', handleOffline);
    };
  }, [fetchLedger, fetchUsedGunNames]);

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
    setAssignmentMode(false);
    setSelectedGunRowIds(new Set());
    setShowAssignPanel(false);
  }, [online]);

  // 切换表时：释放上一张表的表级锁与行锁，并同步 ref（只读打开的表从未申请过锁，不释放）
  useEffect(() => {
    const prev = prevActiveTableRef.current;
    if (prev && prev !== activeTableId && readonlyTableIdRef.current !== prev) {
      releaseTableLock(prev);
    }
    prevActiveTableRef.current = activeTableId;
    activeTableIdRef.current = activeTableId;
    stopRowLock();
  }, [activeTableId, stopRowLock, releaseTableLock]);

  // 表级锁心跳：每 20 秒续期一次（服务端 TTL 60 秒）；只读打开的表不发心跳
  useEffect(() => {
    if (!activeTableId || !isAdmin || activeTableReadOnly) return;
    const timer = setInterval(() => {
      socketRef.current?.emit('gun_ledger_table_heartbeat', { tableId: activeTableId });
    }, 20000);
    return () => clearInterval(timer);
  }, [activeTableId, isAdmin, activeTableReadOnly]);

  // 卸载清理
  useEffect(() => () => {
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
    const tid = prevActiveTableRef.current;
    if (tid && readonlyTableIdRef.current !== tid) socketRef.current?.emit('gun_ledger_unlock_table', { tableId: tid });
  }, []);

  // Esc 关闭弹窗
  useEffect(() => {
    if (!addCategoryOpen && !addTableOpen && !deleteCategoryTarget && !deleteTableTarget && !showPersonPanel && !showAccessPanel && !showInitPanel && !showExportPanel && !restoreTarget) return;
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
        if (!restoring) setRestoreTarget(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [addCategoryOpen, addTableOpen, deleteCategoryTarget, deleteTableTarget, showPersonPanel, showAccessPanel, showInitPanel, showExportPanel, restoreTarget, submitting, deleting, exporting, restoring]);

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

  // ===== 默认工时规则面板派生数据 =====
  // 详情界面：仅当分类仍存在时进入，否则留在分类选择界面
  const hoursDetailCategory = hoursPanelCategory && ledger?.categories[hoursPanelCategory] ? hoursPanelCategory : null;
  const hoursDetailTables = hoursDetailCategory ? (ledger?.categories[hoursDetailCategory] || []) : [];

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
    return <LoadingScreen text="正在加载焊枪编号台账" skeleton="gunledger" />;
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
            <p className="text-gray-400 mt-2">{isClosed ? '请联系超级管理员开启此功能' : '请联系超级管理员开启对应权限'}</p>
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
          {/* 分类导出：一个分类一个工作簿，每张表一个工作表；多分类打包 zip（仅管理员可见，普通用户不可见） */}
          {isAdmin && (
            <button
              onClick={openExportPanel}
              className="ml-2 flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/15 hover:bg-white/25 text-xs font-semibold transition"
              title="按分类导出：一个分类一个工作簿，每张表一个工作表"
            >
              <Download size={14} /><span>分类导出</span>
            </button>
          )}
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
            {/* 默认工时规则：按台账表配置专用工时，超管专用 */}
            {isSuperAdmin && (
              <button
                onClick={openHoursPanel}
                className="flex items-center space-x-1.5 text-white hover:text-emerald-200 text-sm font-semibold transition"
                title="默认工时规则：按分类/表设置确认图、确认图修改、设计的默认工时，并为设计变更、既制审图设置固定工时"
              >
                <Clock size={18} /><span>默认工时规则</span>
              </button>
            )}
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

      {/* 普通用户只读模式提示条（查看权限打开时仅可浏览，不可编辑；离线提示条已覆盖时不再重复展示） */}
      {online && !isAdmin && (
        <div className="relative z-50 shrink-0 bg-amber-500 text-white px-4 py-2 flex items-center justify-center gap-2 text-xs font-medium border-b border-amber-600 shadow-sm">
          <Eye size={14} className="shrink-0" />
          <span>当前为只读模式，仅可查看数据，无法编辑</span>
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
              <div className="flex items-center gap-1">
                {isSuperAdmin && (
                  <button
                    onClick={() => { if (warnIfOffline()) return; setRestoreTarget('categories'); }}
                    className="text-gray-400 hover:text-emerald-600"
                    title="恢复默认排序"
                  >
                    <RotateCcw size={14} />
                  </button>
                )}
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
            </div>
            <div className="flex flex-col gap-1">
              {Object.keys(ledger?.categories || {}).map((cat, idx, arr) => {
                const canMoveUp = idx > 0;
                const canMoveDown = idx < arr.length - 1;
                // 分类下有任意表格被他人锁定时，禁止删除分类
                const catTables = (ledger?.categories[cat] || []);
                const catHasLockedTable = catTables.some(t => Boolean(getTableHolder(t.id)));
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
                        onClick={() => { if (catHasLockedTable) return; openDeleteCategoryModal(cat); }}
                        disabled={catHasLockedTable}
                        title={catHasLockedTable ? '分类下有表格被他人锁定，无法删除' : '删除分类'}
                        className={`px-2 py-2 opacity-0 group-hover:opacity-100 transition ${catHasLockedTable ? 'text-gray-300 cursor-not-allowed' : activeCategory === cat ? 'text-white hover:text-red-200' : 'text-gray-400 hover:text-red-600'}`}
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
              <div className="flex items-center gap-1">
                {isSuperAdmin && (
                  <button
                    onClick={() => { if (warnIfOffline()) return; setRestoreTarget('tables'); }}
                    disabled={!DEFAULT_CATEGORIES.includes(activeCategory)}
                    className={`${DEFAULT_CATEGORIES.includes(activeCategory) ? 'text-gray-400 hover:text-emerald-600' : 'text-gray-300 cursor-not-allowed'}`}
                    title={DEFAULT_CATEGORIES.includes(activeCategory) ? '恢复默认排序' : '自定义分类无默认表格顺序'}
                  >
                    <RotateCcw size={14} />
                  </button>
                )}
                {isAdmin && (
                  <button onClick={() => { if (warnIfOffline()) return; setAddTableValue(''); setAddTableOpen(true); }} className="text-emerald-600 hover:text-emerald-700" title="新增表">
                    <Plus size={16} />
                  </button>
                )}
              </div>
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
                            <>
                              <Lock size={12} className="shrink-0 text-amber-600" aria-label={`${holder!.name || holder!.username} 正在编辑`} />
                              {!isActive && (
                                <button
                                  onClick={e => { e.stopPropagation(); handleSelectTableReadOnly(t); }}
                                  title={`只读打开：查看 ${holder!.name || holder!.username} 正在编辑的表`}
                                  className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition"
                                >
                                  只读打开
                                </button>
                              )}
                              {isActive && activeTableReadOnly && (
                                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700">
                                  只读中
                                </span>
                              )}
                            </>
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
                        <button
                          onClick={() => { if (lockedByOther) return; if (warnIfOffline()) return; setRenamingTableId(t.id); setRenameValue(t.name); }}
                          disabled={lockedByOther}
                          title={lockedByOther ? `表被 ${holder!.name || holder!.username} 锁定，无法重命名` : '重命名'}
                          className={`p-1 ${lockedByOther ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-blue-600'}`}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => { if (lockedByOther) return; openDeleteTableModal(t.id, t.name); }}
                          disabled={lockedByOther}
                          title={lockedByOther ? `表被 ${holder!.name || holder!.username} 锁定，无法删除` : '删除'}
                          className={`p-1 ${lockedByOther ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-red-600'}`}
                        >
                          <Trash2 size={13} />
                        </button>
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
                  {activeTableReadOnly && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200" title={`${(() => { const h = getTableHolder(activeTable.id); return h ? `${h.name || h.username} 正在编辑` : ''; })()}，当前为只读打开`}>
                      <Lock size={11} />只读打开
                    </span>
                  )}
                  {isAdmin && online && !activeTableReadOnly && Boolean(tableLocks[activeTable.id]) && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 border border-emerald-200" title="编辑期间其他人员无法打开该表">
                      <Lock size={11} />编辑中 · 其他人暂无法打开
                    </span>
                  )}
                  {!online && !activeTableReadOnly && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200" title="网络恢复后自动重新进入编辑状态">
                      <AlertCircle size={11} />离线 · 只读禁止编辑
                    </span>
                  )}
                  <span className="text-xs font-normal text-gray-400 ml-2">序号自动递增 · 预留 {PLACEHOLDER_COUNT} 个未取号行</span>
                </h3>
                {isAdmin && !activeTableReadOnly && (
                  <label
                    className={`flex items-center gap-1.5 select-none ${online ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                    title={online ? undefined : '当前离线，禁止编辑'}
                  >
                    <input
                      type="checkbox"
                      checked={assignmentMode}
                      disabled={!online}
                      onChange={e => {
                        if (warnIfOffline()) return;
                        const checked = e.target.checked;
                        setAssignmentMode(checked);
                        setSelectedGunRowIds(new Set());
                        setShowAssignPanel(false);
                        // 启用时检查是否存在可分配的枪名（已取号且未被主任务使用）
                        if (checked && activeTable) {
                          const hasAvailable = (activeTable.rows || []).some(r => {
                            const name = String(r.gunName || '').trim();
                            return name && !usedGunNames.has(name);
                          });
                          if (!hasAvailable) {
                            addToast('当前表没有可分配的枪名：所有已取号枪名均已被主任务使用，或尚未取号', 'error');
                          }
                        }
                      }}
                      className="w-4 h-4 accent-blue-600 border-gray-300 rounded focus:ring-blue-400 disabled:cursor-not-allowed"
                    />
                    <span className={`text-xs font-bold ${online ? 'text-blue-600' : 'text-gray-400'}`}>启用任务分配模式</span>
                  </label>
                )}
                <div className="flex items-center gap-2">
                  {isAdmin && !activeTableReadOnly && assignmentMode && selectedGunRowIds.size > 0 && (
                    <button
                      onClick={() => { if (warnIfOffline()) return; setShowAssignPanel(true); }}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded border text-blue-700 bg-blue-50 hover:bg-blue-500 hover:text-white border-blue-200 hover:border-blue-500 transition"
                      title="将选中的焊枪名按客户分组，批量创建确认图任务"
                    >
                      <ClipboardList size={13} />为这些枪名分配确认图任务（{selectedGunRowIds.size}）
                    </button>
                  )}
                  {isAdmin && renamingTableId !== activeTable.id && !activeTableReadOnly && (
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
                  {activeTableReadOnly && (
                    <button
                      onClick={handleFinishEditing}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded border text-gray-600 hover:text-white bg-gray-50 hover:bg-gray-500 border-gray-200 hover:border-gray-500 transition"
                      title="关闭只读查看"
                    >
                      <X size={13} />关闭只读
                    </button>
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
                            const disabled = !isAdmin || !online || activeTableReadOnly || Boolean(blocking);
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
                                  <>
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
                                      className={`w-full ${assignmentMode && !activeTableReadOnly && field === 'gunName' && !isPlaceholder && value.trim() && !usedGunNames.has(value.trim()) ? 'pr-7' : ''} px-2 py-1.5 bg-transparent outline-none ${disabled ? 'cursor-not-allowed bg-gray-100' : 'hover:bg-emerald-50 focus:bg-emerald-50'} ${value ? 'text-gray-700' : 'text-gray-400'} ${field === 'gunName' && value && duplicateGunNames.has(value.trim()) ? 'ring-2 ring-red-500 bg-red-50 text-red-700 font-bold' : field === 'gunName' && value && usedGunNames.has(value.trim()) ? 'text-sky-600 font-bold' : ''}`}
                                    />
                                    {/* 已被主任务使用的枪名不显示勾选框（不允许重复分配确认图任务） */}
                                    {assignmentMode && !activeTableReadOnly && field === 'gunName' && !isPlaceholder && value.trim() && !usedGunNames.has(value.trim()) && (
                                      <input
                                        type="checkbox"
                                        checked={selectedGunRowIds.has(row.id)}
                                        onChange={e => {
                                          setSelectedGunRowIds(prev => {
                                            const next = new Set(prev);
                                            if (e.target.checked) next.add(row.id);
                                            else next.delete(row.id);
                                            return next;
                                          });
                                        }}
                                        onClick={e => e.stopPropagation()}
                                        className="absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4 accent-blue-600 cursor-pointer"
                                        title="选中此枪名以分配确认图任务"
                                      />
                                    )}
                                  </>
                                )}
                              </td>
                            );
                          })}
                          {/* 操作列：[复制数量][向下复制][清除] —— 加号把当前行客户名复制到下方最新的空行，时间填当前日期、担当填当前操作者；焊枪名继承当前行前缀/后缀，仅编号按目标行规则变化 */}
                          <td className="border border-gray-300 px-1 py-1">
                            <div className="flex items-center justify-center gap-1">
                              <input
                                ref={el => { countInputRefs.current[row.id] = el; }}
                                type="number"
                                min={1}
                                max={10}
                                step={1}
                                defaultValue={1}
                                disabled={!isAdmin || !online || activeTableReadOnly || Boolean(blocking)}
                                title="复制行数（1~10）"
                                onInput={e => {
                                  const v = (e.target as HTMLInputElement).value;
                                  const n = parseInt(v, 10);
                                  if (!Number.isNaN(n) && n > 10) {
                                    (e.target as HTMLInputElement).value = '10';
                                  }
                                }}
                                className="w-10 px-1 py-0.5 text-center text-xs border border-gray-300 rounded outline-none focus:border-emerald-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                              />
                              <button
                                onClick={() => handleCopyDown(row)}
                                disabled={!isAdmin || !online || activeTableReadOnly || Boolean(blocking) || !row.customer.trim()}
                                title="向下复制：复制本行客户名到下方空行（时间填当前日期、担当填当前操作者）；下方行焊枪名继承本行前缀/后缀，仅编号不同"
                                className={`p-1 rounded ${!isAdmin || !online || activeTableReadOnly || Boolean(blocking) || !row.customer.trim() ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-emerald-700 hover:bg-emerald-50'}`}
                              >
                                <Plus size={14} />
                              </button>
                              <button
                                onClick={() => handleClearRow(row)}
                                disabled={!isAdmin || !online || activeTableReadOnly || Boolean(blocking)}
                                title="清除该行除焊枪名外的所有内容"
                                className={`p-1 rounded ${!isAdmin || !online || activeTableReadOnly || Boolean(blocking) ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-red-600 hover:bg-red-50'}`}
                              >
                                <Eraser size={14} />
                              </button>
                            </div>
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

      {/* 任务分配面板 */}
      {showAssignPanel && activeTable && (() => {
        const selectedRows = (activeTable.rows || []).filter(r => selectedGunRowIds.has(r.id));
        const customerSet = new Set(selectedRows.map(r => String(r.customer || '').trim() || '未命名'));
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !assigning && setShowAssignPanel(false)} />
            <div className="relative bg-white rounded-xl shadow-2xl w-[460px] max-w-[92vw] border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-lg">
                  <ClipboardList size={20} />
                  分配确认图任务
                </div>
                <button className="p-1 rounded hover:bg-white/20 transition" onClick={() => setShowAssignPanel(false)} disabled={assigning}>
                  <X size={18} />
                </button>
              </div>
              <div className="p-5 flex flex-col gap-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-700">
                  已选 <span className="font-bold">{selectedRows.length}</span> 个枪名，按客户分为 <span className="font-bold">{customerSet.size}</span> 组
                  {customerSet.size > 0 && (
                    <div className="mt-1 text-xs text-blue-500">
                      {Array.from(customerSet).map(c => `「${c}」`).join('、')}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-gray-500 uppercase">设计人员</label>
                  <select
                    value={assignDesignerId}
                    onChange={e => setAssignDesignerId(e.target.value)}
                    disabled={assigning}
                    className="w-full h-10 px-3 bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white transition"
                  >
                    <option value="">请选择设计人员</option>
                    {designers.map(d => (
                      <option key={d.id} value={d.id}>{d.name}{d.group ? `（${d.group}）` : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-gray-500 uppercase">日期</label>
                  <input
                    type="date"
                    value={assignDate}
                    onChange={e => setAssignDate(e.target.value)}
                    disabled={assigning}
                    className="w-full h-10 px-3 bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white transition"
                  />
                </div>
                {/* 相同仕样号提醒：勾选后枪名添加到已有「确认图」任务；多个满足条件时可选择目标 */}
                {specCheckLoading && (
                  <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-gray-400">
                    <RefreshCw size={13} className="animate-spin" />正在检测相同仕样号任务...
                  </div>
                )}
                {!specCheckLoading && matchedExistingSpecTasks.length > 0 && (
                  <div className={`rounded-lg border px-3 py-2.5 transition ${mergeIntoExisting ? 'border-amber-300 bg-amber-50 ring-1 ring-amber-200' : 'border-amber-200 bg-amber-50/70 hover:bg-amber-50'}`}>
                    <label className="flex items-start gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={mergeIntoExisting}
                        disabled={assigning}
                        onChange={e => {
                          setMergeIntoExisting(e.target.checked);
                          if (e.target.checked && !mergeTargetItemId && matchedExistingSpecTasks.length > 0) {
                            setMergeTargetItemId(matchedExistingSpecTasks[0].itemId);
                          }
                        }}
                        className="mt-0.5 w-4 h-4 accent-amber-500 cursor-pointer disabled:cursor-not-allowed"
                      />
                      <span className="text-xs text-amber-800 leading-snug">
                        发现 <span className="font-bold">{matchedExistingSpecTasks.length}</span> 个相同仕样号的确认图任务，勾选后选中的枪名将
                        <span className="font-bold">添加到已有任务</span>，不再新建
                      </span>
                    </label>
                    {mergeIntoExisting && matchedExistingSpecTasks.length > 1 && (
                      <div className="mt-2 ml-6 flex flex-col gap-1.5 border-l-2 border-amber-200 pl-3">
                        <div className="text-[11px] font-bold text-amber-600">请选择添加到哪一个任务：</div>
                        {matchedExistingSpecTasks.map(t => (
                          <label key={t.itemId} className="flex items-center gap-2 cursor-pointer group">
                            <input
                              type="radio"
                              name="merge-target-item"
                              checked={mergeTargetItemId === t.itemId}
                              disabled={assigning}
                              onChange={() => setMergeTargetItemId(t.itemId)}
                              className="w-3.5 h-3.5 accent-amber-500 cursor-pointer"
                            />
                            <span className={`text-xs truncate transition ${mergeTargetItemId === t.itemId ? 'text-amber-900 font-semibold' : 'text-amber-700 group-hover:text-amber-900'}`}>
                              {t.taskName || '（无任务名）'}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowAssignPanel(false)}
                  disabled={assigning}
                  className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-300 text-gray-600 bg-white hover:bg-gray-100 transition disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={handleConfirmAssign}
                  disabled={!assignDesignerId || !assignDate || assigning || designers.length === 0}
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {assigning ? '分配中...' : '确认分配'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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

      {/* 恢复默认排序确认弹窗（仅超管） */}
      {restoreTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { if (!restoring) setRestoreTarget(null); }} />
          <div className="relative bg-white rounded-xl shadow-2xl w-[420px] max-w-[92vw] border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-lg">
                <RotateCcw size={20} />
                恢复默认排序
              </div>
              <button className="p-1 rounded hover:bg-white/20 transition" onClick={() => { if (!restoring) setRestoreTarget(null); }} disabled={restoring}>
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                <AlertCircle size={22} className="text-emerald-500 shrink-0 mt-0.5" />
                <div className="text-sm text-gray-700 leading-relaxed">
                  {restoreTarget === 'categories' ? (
                    <div>
                      确定要将<span className="font-bold text-gray-900">分类顺序</span>恢复为系统默认排序吗？
                      <br />
                      自定义分类将排在默认分类之后，并保持当前相对顺序。
                    </div>
                  ) : (
                    <div>
                      确定要将分类 <span className="font-bold text-gray-900 bg-white px-1.5 py-0.5 rounded border border-gray-200">{activeCategory}</span> 下的<span className="font-bold text-gray-900">表格顺序</span>恢复为系统默认排序吗？
                      <br />
                      自定义表格将排在默认表格之后，并保持当前相对顺序。
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition disabled:opacity-50"
                onClick={() => setRestoreTarget(null)}
                disabled={restoring}
              >
                取消
              </button>
              <button
                className="px-5 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                onClick={confirmRestoreDefaultOrder}
                disabled={restoring}
              >
                {restoring && <RefreshCw size={14} className="animate-spin" />}
                {restoring ? '恢复中...' : '确认恢复'}
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
                  配置预留行的焊枪名自动生成规则（前缀 + 起始编号 + 编号位数），初始化前请先「保存设置」使最新规则生效；表中焊枪名的编号由规则自动决定、不可修改，前缀与编号之后的后缀（如 L、-EL、L-WL）可自由编辑；「焊枪名初始化」删除该表所有原有内容，表恢复为仅显示 10 个原始焊枪名预留行的全新状态。
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

      {/* 默认工时规则弹窗：先选分类，再逐表编辑专用工时；首页可编辑 C/X 回退规则 */}
      {showHoursPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { if (!hoursSaving) setShowHoursPanel(false); }} />
          <div className="relative bg-white rounded-xl shadow-2xl w-[860px] max-w-[94vw] max-h-[86vh] flex flex-col border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 font-bold text-lg min-w-0">
                {hoursDetailCategory ? (
                  <button
                    onClick={() => setHoursPanelCategory(null)}
                    className="p-1 rounded hover:bg-white/20 transition -ml-1"
                    title="返回分类选择"
                  >
                    <ChevronLeft size={20} />
                  </button>
                ) : (
                  <Clock size={20} />
                )}
                <span className="truncate">默认工时规则{hoursDetailCategory ? ` · ${hoursDetailCategory}` : ''}</span>
              </div>
              <button className="p-1 rounded hover:bg-white/20 transition shrink-0" onClick={() => setShowHoursPanel(false)} disabled={hoursSaving}>
                <X size={20} />
              </button>
            </div>

            {hoursDetailCategory === null ? (
              /* ===== 首页：取值顺序 + 三类规则页签（机型回退 / 固定工时 / 表专用规则） ===== */
              <div className="flex-1 min-h-0 flex flex-col">
                {/* 取值顺序：单行紧凑链路，替代原先的四行说明 */}
                <div className="px-5 pt-3.5 shrink-0 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
                  <span className="font-black uppercase tracking-widest text-gray-400">取值顺序</span>
                  <span className="px-2 py-0.5 rounded-full bg-sky-50 border border-sky-200 text-sky-700 font-bold">① 表专用规则</span>
                  <ChevronRight size={12} className="text-gray-300" />
                  <span className="px-2 py-0.5 rounded-full bg-sky-50 border border-sky-200 text-sky-700 font-bold">② C / X 机型回退</span>
                  <ChevronRight size={12} className="text-gray-300" />
                  <span className="px-2 py-0.5 rounded-full bg-gray-50 border border-gray-200 text-gray-600 font-bold">
                    ③ 兜底 {FALLBACK_GUN_HOURS.confirm} / {FALLBACK_GUN_HOURS.confirmModify} / {FALLBACK_GUN_HOURS.design} h
                  </span>
                  <span className="text-gray-400">· 设计变更 / 既制审图 直接取固定工时</span>
                </div>

                {/* 三类规则分页展示，避免三张表纵向堆叠 */}
                <div className="px-5 mt-2.5 shrink-0 flex items-end justify-between gap-2 border-b border-gray-200">
                  <div className="flex items-center gap-1">
                    {([
                      { key: 'fallback', label: '机型回退规则', hint: 'C / X' },
                      { key: 'extra', label: '固定任务工时', hint: '不分 C/X' },
                      { key: 'table', label: '表专用规则', hint: `${initTotalTables} 张表` },
                    ] as const).map(tab => {
                      const active = hoursPanelTab === tab.key;
                      return (
                        <button
                          key={tab.key}
                          onClick={() => setHoursPanelTab(tab.key)}
                          className={`px-3 py-2 -mb-px border-b-2 text-xs font-bold transition whitespace-nowrap ${active ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                        >
                          {tab.label}
                          <span className={`ml-1.5 text-[10px] font-semibold ${active ? 'text-emerald-500/80' : 'text-gray-300'}`}>{tab.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => setConfirmHoursReset('all')}
                    disabled={hoursSaving}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-400 hover:text-emerald-600 disabled:opacity-50 shrink-0 pb-1.5"
                    title="表专用规则、机型回退规则与固定任务工时全部恢复为系统内置值"
                  >
                    <RotateCcw size={12} />
                    全部恢复内置
                  </button>
                </div>

                <div className="p-5 overflow-auto flex-1 min-h-0">
                  {hoursPanelTab === 'fallback' && (
                    <>
                      <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                        按枪名首个「-」前字符判定 C / X 机型
                      </div>
                      <div className="overflow-hidden rounded-xl border border-gray-200">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-100 text-gray-600">
                              <th className="px-4 py-2.5 text-left font-bold">任务类型</th>
                              <th className="px-4 py-2.5 text-center font-bold">C 类枪名</th>
                              <th className="px-4 py-2.5 text-center font-bold">X 类枪名</th>
                            </tr>
                          </thead>
                          <tbody>
                            {GUN_HOURS_TASK_LABELS.map(row => (
                              <tr key={row.key} className="border-t border-gray-200">
                                <td className="px-4 py-2.5 font-bold text-gray-700">{row.label}</td>
                                {(['C', 'X'] as const).map(type => (
                                  <td key={type} className="px-4 py-2.5 text-center">
                                    <input
                                      type="number"
                                      step="0.25"
                                      min="0"
                                      max="24"
                                      value={fallbackHoursDraft?.[row.key]?.[type] ?? ''}
                                      onChange={(e) => updateFallbackHoursDraft(row.key, type, e.target.value)}
                                      disabled={hoursSaving}
                                      className="w-20 h-9 text-center bg-white border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-400 font-bold text-emerald-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                        枪名未匹配到表专用规则时使用这里的数值；连机型也判定不出时取兜底值 {FALLBACK_GUN_HOURS.confirm}h / {FALLBACK_GUN_HOURS.confirmModify}h / {FALLBACK_GUN_HOURS.design}h（确认图 / 确认图修改 / 设计）。
                      </p>
                    </>
                  )}

                  {hoursPanelTab === 'extra' && (
                    <>
                      <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                        固定任务工时（不分 C / X，不套用任何专用规则）
                      </div>
                      <div className="overflow-hidden rounded-xl border border-gray-200">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-100 text-gray-600">
                              <th className="px-4 py-2.5 text-left font-bold">任务类型</th>
                              <th className="px-4 py-2.5 text-center font-bold">默认工时</th>
                            </tr>
                          </thead>
                          <tbody>
                            {EXTRA_TASK_HOURS_LABELS.map(row => (
                              <tr key={row.key} className="border-t border-gray-200">
                                <td className="px-4 py-2.5 font-bold text-gray-700">{row.label}</td>
                                <td className="px-4 py-2.5 text-center">
                                  <input
                                    type="number"
                                    step="0.25"
                                    min="0"
                                    max="24"
                                    value={extraHoursDraft[row.key] ?? ''}
                                    onChange={(e) => updateExtraHoursDraft(row.key, e.target.value)}
                                    disabled={hoursSaving}
                                    className="w-20 h-9 text-center bg-white border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-400 font-bold text-emerald-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                        勾选「设计变更」/「既制审图」后填写枪名，每个枪名的工时按此值自动计算，总工时 = 各枪名工时之和；没有枪名时不自动赋值，总工时由用户手动输入。
                      </p>
                    </>
                  )}

                  {hoursPanelTab === 'table' && (
                    <>
                      <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                        选择分类编辑各表专用规则
                      </div>
                      {initCategoryNames.length === 0 && <div className="text-xs text-gray-400 py-4 text-center">暂无分类</div>}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {initCategoryNames.map(cat => {
                          const stat = initCategoryStats[cat] || { tables: 0, rows: 0 };
                          return (
                            <div key={cat} className="group rounded-xl border border-gray-200 bg-gray-50/70 hover:border-emerald-300 hover:bg-emerald-50/60 transition overflow-hidden">
                              <button
                                onClick={() => setHoursPanelCategory(cat)}
                                className="w-full p-3.5 flex items-center gap-3 text-left"
                              >
                                <span className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                                  <FolderOpen size={16} />
                                </span>
                                <span className="flex-1 min-w-0">
                                  <span className="block font-bold text-gray-800 text-sm truncate">{cat}</span>
                                  <span className="block text-xs text-gray-400 mt-0.5">{stat.tables} 张表</span>
                                </span>
                                <ChevronRight size={18} className="text-gray-300 group-hover:text-emerald-600 transition shrink-0" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              /* ===== 分类详情：逐表专用工时编辑 ===== */
              <div className="p-5 overflow-auto flex-1 min-h-0">
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                  <span className="text-xs text-gray-400">共 {hoursDetailTables.length} 张表，单位：小时（h）</span>
                  <button
                    onClick={() => { if (hoursDetailCategory) setConfirmHoursReset(hoursDetailCategory); }}
                    disabled={hoursSaving}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg transition disabled:opacity-40"
                    title="将本分类全部表的专用工时恢复为系统内置值"
                  >
                    <RotateCcw size={13} />
                    本分类恢复内置默认
                  </button>
                </div>
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-100 text-gray-600">
                        <th className="px-4 py-2.5 text-left font-bold">表格</th>
                        <th className="px-4 py-2.5 text-center font-bold w-32">确认图</th>
                        <th className="px-4 py-2.5 text-center font-bold w-32">确认图修改</th>
                        <th className="px-4 py-2.5 text-center font-bold w-32">设计</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hoursDetailTables.length === 0 && (
                        <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-gray-400">该分类下暂无表格</td></tr>
                      )}
                      {hoursDetailTables.map(t => {
                        const cell = tableHoursDraft[hoursDetailCategory]?.[t.name];
                        const isBuiltin = Boolean(BUILTIN_TABLE_GUN_HOURS[hoursDetailCategory]?.[t.name]);
                        return (
                          <tr key={t.id} className="border-t border-gray-200">
                            <td className="px-4 py-2.5">
                              <span className="font-bold text-gray-700">{t.name}</span>
                              {!isBuiltin && (
                                <span className="ml-2 text-[10px] text-gray-400" title="无内置专用规则；三项全部留空时按机型回退规则取值">自建表{cell && (cell.confirm === '' && cell.confirmModify === '' && cell.design === '') ? '·留空走回退' : ''}</span>
                              )}
                            </td>
                            {GUN_HOURS_TASK_LABELS.map(col => (
                              <td key={col.key} className="px-4 py-2.5 text-center">
                                <input
                                  type="number"
                                  step="0.25"
                                  min="0"
                                  max="24"
                                  value={cell?.[col.key] ?? ''}
                                  onChange={(e) => updateTableHoursDraft(hoursDetailCategory, t.name, col.key, e.target.value)}
                                  disabled={hoursSaving}
                                  className="w-20 h-9 text-center bg-white border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-400 font-bold text-emerald-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50"
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                  三项全部留空的表不启用专用规则，枪名工时按机型回退规则取值；部分填写无法保存。
                </p>
              </div>
            )}

            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2 shrink-0">
              {hoursDetailCategory && (
                <button
                  className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition"
                  onClick={() => setHoursPanelCategory(null)}
                >
                  返回分类选择
                </button>
              )}
              <button
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition disabled:opacity-50"
                onClick={() => setShowHoursPanel(false)}
                disabled={hoursSaving}
              >
                取消
              </button>
              <button
                className="px-5 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition disabled:opacity-50 flex items-center gap-1.5"
                onClick={saveHoursRules}
                disabled={hoursSaving}
              >
                {hoursSaving && <RefreshCw size={14} className="animate-spin" />}
                {hoursSaving ? '保存中...' : '保存'}
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

      {/* 默认工时规则恢复内置二次确认弹窗（全部 / 某分类） */}
      {confirmHoursReset !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setConfirmHoursReset(null)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-[460px] max-w-[92vw] border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-lg">
                <AlertCircle size={20} />
                {confirmHoursReset === 'all' ? '全部恢复内置默认' : `恢复分类「${confirmHoursReset}」内置默认`}
              </div>
              <button className="p-1 rounded hover:bg-white/20 transition" onClick={() => setConfirmHoursReset(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertCircle size={22} className="text-amber-500 shrink-0 mt-0.5" />
                <div className="text-sm text-gray-700 leading-relaxed">
                  <div className="font-bold text-amber-700 mb-1">将覆盖当前未保存的修改</div>
                  {confirmHoursReset === 'all' ? (
                    <div>
                      所有分类的表专用工时规则、C/X 机型回退规则与固定任务工时（设计变更 / 既制审图）都将恢复为系统内置值，自建表专用工时将被清空（留空走机型回退）。
                    </div>
                  ) : (
                    <div>
                      分类「<span className="font-bold text-gray-900">{confirmHoursReset}</span>」下所有表的专用工时将恢复为系统内置值，自建表专用工时将被清空（留空走机型回退）。
                    </div>
                  )}
                  <div className="mt-1">恢复后需点击「保存」才会生效。</div>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition"
                onClick={() => setConfirmHoursReset(null)}
              >
                取消
              </button>
              <button
                className="px-5 py-2 rounded-lg bg-amber-600 text-white font-bold hover:bg-amber-700 transition flex items-center gap-1.5"
                onClick={() => {
                  if (confirmHoursReset === 'all') resetAllHoursDraft();
                  else if (confirmHoursReset) resetCategoryHoursDraft(confirmHoursReset);
                  setConfirmHoursReset(null);
                }}
              >
                <RotateCcw size={14} />
                确认恢复
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
                { label: '普通用户', detail: 'User Access (View Only)', key: 'allowViewers' as const },
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
