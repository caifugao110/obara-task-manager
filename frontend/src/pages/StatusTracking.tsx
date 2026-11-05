import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import {
  AlertCircle,
  CheckCircle,
  ChevronLeft,
  LogOut,
  Plus,
  RefreshCw,
  Shield,
  X,
  Search,
  Save,
  Trash2,
  UserPlus,
  Users,
  ChevronDown,
  Lock,
  AlertTriangle,
  Download,
  Eye,
  RotateCcw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Building2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { axiosInstance } from '../services/api';
import LoadingScreen from '../components/LoadingScreen';
import { acquireSocket, getCurrentSocketId } from '../utils/socketClient';

interface StatusItem {
  id: string;
  factory: string;
  /** 来自「各产品大日程.xls」的哪张工作表（南京焊钳/上海焊钳/南京焊钳修改/上海焊钳修改） */
  sheetName?: string;
  clientName: string;
  specNumber: string;
  productionPlanMonth?: string;
  productionPlanMonths?: string[];
  quantity: string;
  deliveryDate: string;
  designDeliveryDays: number;
  salesPerson: string;
  leader: string;
  shippedCount: number;
  unconfirmedCount: number;
  totalVarieties: number;
  feedbackVarieties: number;
  feedbackPlan: string;
  drawingPlanStatus: string;
  confirmedQuantity: number;
  confirmedVarieties: number;
  drawnVarieties: number;
  undrawnVarieties: number;
  undrawnQuantity: number;
  unconfirmedQuantity: number;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
  id: number;
}

interface SpecInfoResponse {
  success: boolean;
  message?: string;
  specNumber?: string;
  clientName?: string;
  middleMan?: string;
  finalClient?: string;
  projectName?: string;
  quantity?: string;
  deliveryDate?: string;
  salesPerson?: string;
  factory?: string;
  shippedCount?: number | null;
  /** 命中的工作表名，用于按表筛选 */
  scheduleSheet?: string;
  scheduleMonth?: string;
}

interface LeaderRule {
  leader: string;
  members: string[];
}

// 「同步生产大日程」预览/执行返回的统计
interface ScheduleSyncStats {
  success: boolean;
  total: number;
  added: number;
  updated: number;
  unchanged: number;
  locked: number;
  skipped: number;
  /** 本次会自动补全营业担当 / 组长 的记录数 */
  salesFilled?: number;
  leaderFilled?: number;
  /** 仕样书里也拿不到营业担当的记录数 */
  salesMissing?: number;
  salesLookup?: {
    specs: number;
    resolved: number;
    missingPdf: number;
    noSalesPerson: number;
    failed: number;
    shareAvailable: boolean;
  };
  months: { month: string; count: number }[];
  filePath?: string;
  message?: string;
}
interface FactoryRule {
  factory: string;
  members: string[];
}

interface FactoryRulesConfig {
  defaultFactory: string;
  rules: FactoryRule[];
}

interface EditingSession {
  itemId: string;
  userId: string;
  username: string;
  socketId: string;
}

// allowAdminScheduleSync：超级管理员控制一般管理员能否点「同步生产大日程」
const defaultSettings = { enabled: true, allowAdmins: true, allowViewers: false, allowAdminScheduleSync: true };

const defaultLeaderRules: LeaderRule[] = [
  { leader: '陈大仪', members: ['郭涛', '王兴龙', '王会永', '李广亮'] },
  { leader: '张啸', members: ['李守健', '邓明江', '贾银鑫', '熊飞', '孙海山'] },
  { leader: '张明', members: ['吴露鹭', '茅舒', '沈雨帆', '张晟隽', '梁科研', '吴方盛', '许华俊'] },
  { leader: '陈青松', members: ['张广奇', '李劲日', '曹圩圩', '许孟涵'] }
];

const defaultFactoryRules: FactoryRule[] = [
  { factory: 'O/SHA', members: ['吴露鹭', '茅舒', '沈雨帆', '梁科研', '张晟隽', '许华俊'] }
];
const defaultFactory = 'O/NJG';
const defaultFactoryRulesConfig: FactoryRulesConfig = {
  defaultFactory: defaultFactory,
  rules: defaultFactoryRules
};

const factoryOptions = ['O/NJG', 'O/SHA'];

// 「各产品大日程.xls」的四张工作表：状态跟踪的记录来源。
// 工厂列只有 O/NJG、O/SHA，区分不出「修改」表，所以按 sheetName 单独筛。
// 筛选条在最前面额外提供两个合并项：「焊钳」= 南京+上海，「焊钳修改」= 南京修改+上海修改。
interface SheetFilterOption {
  key: string;
  sheets: string[];
  hint: string;
}

const SHEET_FILTERS: SheetFilterOption[] = [
  { key: '焊钳', sheets: ['南京焊钳', '上海焊钳'], hint: '南京焊钳 + 上海焊钳' },
  { key: '南京焊钳', sheets: ['南京焊钳'], hint: '只看南京焊钳' },
  { key: '上海焊钳', sheets: ['上海焊钳'], hint: '只看上海焊钳' },
  { key: '焊钳修改', sheets: ['南京焊钳修改', '上海焊钳修改'], hint: '南京焊钳修改 + 上海焊钳修改' },
  { key: '南京焊钳修改', sheets: ['南京焊钳修改'], hint: '只看南京焊钳修改' },
  { key: '上海焊钳修改', sheets: ['上海焊钳修改'], hint: '只看上海焊钳修改' }
];

const getSheetFilter = (key: string): SheetFilterOption | undefined =>
  SHEET_FILTERS.find(option => option.key === key);

// 老记录没有 sheetName，按工厂兜底（区分不出「修改」表，下次同步会补上准确值）
const FACTORY_DEFAULT_SHEET: Record<string, string> = {
  'O/NJG': '南京焊钳',
  'O/SHA': '上海焊钳'
};

const getItemSheetName = (item: StatusItem): string =>
  (item.sheetName || FACTORY_DEFAULT_SHEET[item.factory] || '').trim();

const getLeaderBySalesPerson = (salesPerson: string, rules: LeaderRule[]): string => {
  for (const rule of rules) {
    if (rule.members.includes(salesPerson)) {
      return rule.leader;
    }
  }
  return '';
};

const getFactoryBySalesPerson = (salesPerson: string, config: FactoryRulesConfig): string => {
  if (!salesPerson) return config.defaultFactory;
  for (const rule of config.rules) {
    if (rule.members.includes(salesPerson)) {
      return rule.factory;
    }
  }
  return config.defaultFactory;
};

const calculateDesignDeliveryDays = (deliveryDate: string): number => {
  if (!deliveryDate) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = new Date(deliveryDate);
  targetDate.setHours(0, 0, 0, 0);
  const diffTime = targetDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

const validateNumberInput = (value: string): string => {
  if (!value || value.trim() === '') return '';
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0) return '';
  if (num > 999) return '999';
  return num.toString();
};

const formatDeliveryDate = (dateStr: string): string => {
  if (!dateStr) return '';
  const [, month, day] = dateStr.split('-');
  return `${parseInt(month)}/${parseInt(day)}`;
};

const formatMonthLabel = (monthStr: string): string => {
  if (!monthStr) return '';
  const [year, monthNum] = monthStr.split('-');
  return `${year}年${parseInt(monthNum)}月`;
};

const getCurrentMonthValue = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const getItemPlanMonths = (item: StatusItem): string[] => {
  const months = Array.isArray(item.productionPlanMonths)
    ? item.productionPlanMonths.filter(Boolean)
    : [];
  if (months.length > 0) {
    return Array.from(new Set(months)).sort();
  }
  const fallbackMonth = item.productionPlanMonth || item.deliveryDate?.substring(0, 7) || '';
  return fallbackMonth ? [fallbackMonth] : [];
};

const generateDeliveryMonthOptions = (items: StatusItem[]) => {
  const monthSet = new Set<string>();

  items.forEach(item => {
    if (item.deliveryDate) {
      monthSet.add(item.deliveryDate.substring(0, 7));
    }
  });

  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    monthSet.add(`${year}-${String(month).padStart(2, '0')}`);
  }

  const options = Array.from(monthSet).map(month => ({
    value: month,
    label: formatMonthLabel(month)
  }));

  options.sort((a, b) => b.value.localeCompare(a.value));

  return options;
};

const VerticalHeader = ({ text }: { text: string }) => (
  <span className="inline-block writing-vertical text-sm leading-tight">{text}</span>
);

// 自动定位时用的真实滚动容器：正常情况下就是表格外的 <main>，
// 但若外层布局把滚动交给了别的祖先（例如某次改动让 <main> 不再出现纵向溢出），
// 直接往 <main> 上 scrollTo 会静默无效——所以这里往上找到真正能纵向滚动的祖先兜底。
const resolveScrollContainer = (
  row: HTMLElement | null,
  preferred: HTMLElement | null
): HTMLElement | null => {
  const canScroll = (el: HTMLElement | null) =>
    Boolean(el) && (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 1;
  if (canScroll(preferred)) return preferred;
  let node = row?.parentElement ?? null;
  while (node) {
    const style = window.getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && canScroll(node)) return node;
    node = node.parentElement;
  }
  return preferred;
};

const StatusTracking = () => {
  const { user, token, logout } = useAuth();
  const [settings, setSettings] = useState(defaultSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [allItems, setAllItems] = useState<StatusItem[]>([]);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [leaderRules, setLeaderRules] = useState<LeaderRule[]>(defaultLeaderRules);
  const [factoryRulesConfig, setFactoryRulesConfig] = useState<FactoryRulesConfig>(defaultFactoryRulesConfig);
  const [showLeaderRulesModal, setShowLeaderRulesModal] = useState(false);
  const [rulesModalTab, setRulesModalTab] = useState<'leader' | 'factory'>('leader');
  const [showResetRulesConfirm, setShowResetRulesConfirm] = useState(false);
  const [resettingRules, setResettingRules] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [syncStatus, setSyncStatus] = useState<'connected' | 'disconnected'>('disconnected');
  // 后端 HTTP 可达性（全局心跳广播）：socket 只反映 WebSocket 存活，二者取并集判定离线，
  // 避免 socket 状态滞后时仍发起注定失败的写请求
  const [backendUnreachable, setBackendUnreachable] = useState(false);
  // 月份筛选只看「纳期」：业务日常关心的是本月要交的活
  const [deliveryMonth, setDeliveryMonth] = useState(getCurrentMonthValue);
  // 按「来自哪张日程表」筛选，空串表示不过滤（四张表全看）
  // 默认停在「焊钳」（南京+上海，不含修改表）：这是最常看的一张表
  const [sheetFilter, setSheetFilter] = useState<string>('焊钳');
  const [editingSessions, setEditingSessions] = useState<EditingSession[]>([]);
  // editingSessions 的实时镜像：socket effect 的依赖只有 [token, logout]，
  // 卸载清理时需要读取最新锁列表，直接闭包捕获会拿到过期值
  const editingSessionsRef = useRef<EditingSession[]>([]);
  editingSessionsRef.current = editingSessions;
  // user 的实时镜像：刷新页面时 token 先就绪、user 后恢复，
  // socket effect 不会因此重跑，闭包里的 user 可能还是 null
  const userRef = useRef(user);
  userRef.current = user;
  const [offlineWarning, setOfflineWarning] = useState(false);
  const [exporting, setExporting] = useState(false);
  // 同步生产大日程：按钮先取预览统计，确认后才真正写库
  const [scheduleSyncStats, setScheduleSyncStats] = useState<ScheduleSyncStats | null>(null);
  const [scheduleSyncing, setScheduleSyncing] = useState(false);
  // 预览阶段要读共享盘 + 解析仕样书（首次约十几秒），按钮文案据此区分两种等待
  const [scheduleSyncPhase, setScheduleSyncPhase] = useState<'idle' | 'planning' | 'applying'>('idle');
  // 默认按「纳期」升序：最紧急的排在最上面。点表头仍可切换升/降/取消排序。
  const [sortConfig, setSortConfig] = useState<{ key: 'deliveryDate' | 'designDeliveryDays'; direction: 'asc' | 'desc' } | null>({ key: 'deliveryDate', direction: 'asc' });
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dateInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  // startEditing 的实时镜像：socket 重连回调里要重新占用焦点所在行，
  // 而 socket effect 的依赖只有 [token, logout]，闭包捕获会拿到过期实现
  const startEditingRef = useRef<(itemId: string) => void>(() => {});
  // loadItems 的实时镜像：socket effect 依赖不含 loadItems（避免整条连接重建）
  const loadItemsRef = useRef<() => void>(() => {});
  // commitItems 的实时镜像：socket 回调同样不能因为依赖变化而重建连接
  const commitItemsRef = useRef<(items: StatusItem[]) => void>(() => {});
  // 表格滚动容器 <main> / 「设计纳期」非空第一行的节点，用于进入页面时自动定位
  const tableScrollRef = useRef<HTMLElement | null>(null);
  const targetRowRef = useRef<HTMLTableRowElement | null>(null);
  // 是否还有一次「待执行」的定位：进页面时置 true，用户每次手动切换筛选也重新置 true。
  // 数据实时刷新（socket）时不会置 true，避免把正在看的表格滚走。
  const pendingPositionRef = useRef(true);
  // 计数器：筛选变化时自增，用于强制 effect 重跑（即使 firstDesignIndex 数值没变）
  const [positionToken, setPositionToken] = useState(0);

  // ── 输入稳定性（中文输入法「打字被打断」的修复）────────────────────────────
  // 1) allItems 的可变镜像。连续快速输入时同一帧内会多次 onChange，若每次都基于
  //    React state 快照计算，后一次会覆盖前一次 → 丢字。
  const itemsRef = useRef<StatusItem[]>([]);
  // 2) 待保存快照 / 防抖定时器 / 在飞请求 / 输入法正在合成的记录。
  //    以前每按一个键就 PUT 一次，请求互相乱序落地，服务器最终存下的可能是
  //    中间某个快照；合成期间的拼音中间态也会被一起存进库。
  const pendingSaveRef = useRef<Map<string, StatusItem>>(new Map());
  const saveTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const savingIdsRef = useRef<Set<string>>(new Set());
  const composingIdsRef = useRef<Set<string>>(new Set());
  // 3) 焦点所在行。这段时间内不接受服务器推送覆盖——服务器快照必然滞后于本地输入，
  //    一旦写回受控 input 的 value，输入法合成会被打断。
  const activeEditItemIdRef = useRef<string | null>(null);
  // localStorage 落盘防抖：全表 stringify（几百行）每键一次会明显卡顿
  const localSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestReposition = useCallback(() => {
    pendingPositionRef.current = true;
    setPositionToken(token => token + 1);
  }, []);

  const openDatePicker = useCallback((itemId: string) => {
    const input = dateInputRefs.current.get(itemId);
    if (input) {
      input.showPicker();
    }
  }, []);

  useEffect(() => {
    const handleServerUnreachable = () => setBackendUnreachable(true);
    const handleServerOnline = () => setBackendUnreachable(false);
    window.addEventListener('server-unreachable', handleServerUnreachable);
    window.addEventListener('server-online', handleServerOnline);
    return () => {
      window.removeEventListener('server-unreachable', handleServerUnreachable);
      window.removeEventListener('server-online', handleServerOnline);
    };
  }, []);

  const isSuperAdmin = user?.role === 'superadmin';
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  // 「同步生产大日程」权限：开关关闭时只保留超级管理员的入口，一般管理员按钮置灰
  const canSyncSchedule = isSuperAdmin || settings.allowAdminScheduleSync !== false;
  // 离线 = socket 断开 或 后端 HTTP 不可达（取并集，任一不满足即禁止编辑）
  const isOffline = syncStatus === 'disconnected' || backendUnreachable;
  const isRealtimeSyncAvailable = Boolean(token);
  const syncDotClass = !isRealtimeSyncAvailable
    ? 'bg-amber-500'
    : syncStatus === 'connected'
      ? 'bg-green-500'
      : 'bg-red-500';
  const syncFooterIntro = !isRealtimeSyncAvailable
    ? '未登录时需手动刷新页面获取最新状态'
    : '数据同步至服务器';
  const syncFooterLabel = !isRealtimeSyncAvailable ? '更新方式:' : '同步状态:';
  const syncFooterText = !isRealtimeSyncAvailable
    ? '手动刷新'
    : syncStatus === 'connected'
      ? '已连接'
      : '未连接';
  const syncFooterTextClass = !isRealtimeSyncAvailable
    ? 'text-amber-600'
    : syncStatus === 'connected'
      ? 'text-green-600'
      : 'text-red-600';

  const addToast = (message: string, type: 'success' | 'error') => {
    const id = Date.now();
    setToasts(prev => [...prev, { message, type, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  const canViewStatusTracking = useMemo(() => {
    if (isSuperAdmin) return true;
    if (!settings.enabled) return false;
    if (!user) return false;
    if (user.role === 'admin' && settings.allowAdmins) return true;
    if (user.role === 'user' && settings.allowViewers) return true;
    return false;
  }, [isSuperAdmin, settings, user]);

  const allSalesPersons = useMemo(() => {
    const persons = new Set<string>();
    leaderRules.forEach(rule => {
      rule.members.forEach(member => persons.add(member));
    });
    return Array.from(persons);
  }, [leaderRules]);

  const allLeaders = useMemo(() => {
    return [...new Set(leaderRules.map(rule => rule.leader))];
  }, [leaderRules]);

  const fetchSettings = useCallback(async () => {
    try {
      // 走 axiosInstance 自动携带 Authorization，接口需登录访问
      const res = await axiosInstance.get('/settings/status-tracking');
      setSettings(res.data);
    } catch (err) {
      console.error('Error fetching status tracking settings:', err);
      addToast('无法加载状态跟踪表权限设置', 'error');
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  const updateSettings = async (next: Partial<typeof settings>) => {
    const updated = { ...settings, ...next };
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
    setSettings(updated);
    if (!isSuperAdmin) return;

    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      await axios.put('/api/settings/status-tracking', updated, authHeader);
      addToast('权限设置已保存', 'success');
    } catch (err) {
      console.error('Error saving status tracking settings:', err);
      addToast('保存状态跟踪表权限设置失败', 'error');
    }
  };

  const fetchLeaderRules = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/settings/leader-rules');
      setLeaderRules(res.data);
    } catch (err) {
      console.error('Error fetching leader rules:', err);
    }
  }, []);

  const fetchFactoryRules = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/settings/factory-rules');
      setFactoryRulesConfig({
        defaultFactory: res.data.defaultFactory || defaultFactory,
        rules: res.data.rules && res.data.rules.length ? res.data.rules : defaultFactoryRules
      });
    } catch (err) {
      console.error('Error fetching factory rules:', err);
    }
  }, []);

  const saveAllRules = async () => {
    if (!isAdmin) return;
    let ok = true;
    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      await axios.put('/api/settings/leader-rules', leaderRules, authHeader);
    } catch (err) {
      ok = false;
      console.error('Error saving leader rules:', err);
      addToast('保存组长规则失败', 'error');
    }
    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      await axios.put('/api/settings/factory-rules', factoryRulesConfig, authHeader);
    } catch (err) {
      ok = false;
      console.error('Error saving factory rules:', err);
      addToast('保存工厂规则失败', 'error');
    }
    if (ok) {
      addToast('组长/工厂规则已保存', 'success');
      setShowLeaderRulesModal(false);
    }
  };

  const resetLeaderRules = async () => {
    setResettingRules(true);
    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      await axios.post('/api/settings/leader-rules/reset', {}, authHeader);
      setLeaderRules(defaultLeaderRules);
      setShowResetRulesConfirm(false);
      addToast('组长规则已重置为默认', 'success');
    } catch (err) {
      console.error('Error resetting leader rules:', err);
      addToast('重置组长规则失败', 'error');
    } finally {
      setResettingRules(false);
    }
  };

  const resetFactoryRules = async () => {
    setResettingRules(true);
    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      await axios.post('/api/settings/factory-rules/reset', {}, authHeader);
      setFactoryRulesConfig(defaultFactoryRulesConfig);
      setShowResetRulesConfirm(false);
      addToast('工厂规则已重置为默认', 'success');
    } catch (err) {
      console.error('Error resetting factory rules:', err);
      addToast('重置工厂规则失败', 'error');
    } finally {
      setResettingRules(false);
    }
  };

  const resetCurrentTabRules = async () => {
    if (rulesModalTab === 'leader') {
      await resetLeaderRules();
    } else {
      await resetFactoryRules();
    }
  };

  // 统一写入入口：先同步可变镜像，再更新 state，最后防抖落 localStorage。
  // 所有「本地数据变了」的路径都必须走这里，itemsRef 才不会和历史状态脱节。
  const commitItems = useCallback((next: StatusItem[], persistLocal = true) => {
    itemsRef.current = next;
    setAllItems(next);
    if (!persistLocal) return;
    if (localSaveTimerRef.current) clearTimeout(localSaveTimerRef.current);
    localSaveTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem('statusTrackingItems', JSON.stringify(itemsRef.current));
      } catch (e) {
        console.error('Failed to cache status tracking items:', e);
      }
    }, 500);
  }, []);
  commitItemsRef.current = commitItems;

  const loadItems = useCallback(async () => {
    if (!token) {
      commitItems([], false);
      return;
    }

    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      const res = await axios.get('/api/status-tracking/items', authHeader);
      if (Array.isArray(res.data)) {
        // 拉全量时保留本端正在编辑的那一行：请求返回前的这段时间用户可能已经
        // 又打了几个字，直接覆盖会把这几个字吞掉。
        const editingId = activeEditItemIdRef.current;
        const localEditing = editingId ? itemsRef.current.find(i => i.id === editingId) : null;
        const merged = localEditing
          ? res.data.map((i: StatusItem) => (i.id === editingId ? localEditing : i))
          : res.data;
        commitItems(merged);
      }
    } catch (err) {
      console.error('Error loading status tracking items:', err);
      const saved = localStorage.getItem('statusTrackingItems');
      if (saved) {
        try {
          commitItems(JSON.parse(saved));
        } catch (e) {
          console.error('Failed to parse saved items:', e);
        }
      }
    }
  }, [token, commitItems]);

  const saveItems = useCallback((newItems: StatusItem[]) => {
    commitItems(newItems);
  }, [commitItems]);

  // 写接口带上当前连接 id：服务端据此判断行锁是否属于本窗口，
  // 避免同一账号的另一个窗口绕过前端锁定，改动别人正在编辑的行。
  const writeAuthHeader = useCallback(() => {
    const socketId = getCurrentSocketId();
    return {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(socketId ? { 'x-socket-id': socketId } : {})
      }
    };
  }, [token]);

  const updateItemOnServer = useCallback(async (item: StatusItem) => {
    if (!token || !isAdmin) {
      throw new Error('Not authorized');
    }
    const authHeader = writeAuthHeader();
    const res = await axios.put(`/api/status-tracking/items/${item.id}`, item, authHeader);
    return res.data as StatusItem;
  }, [token, isAdmin, writeAuthHeader]);

  const handlePersistError = useCallback((err: unknown) => {
    console.error('Error syncing item to server:', err);
    addToast('保存到服务器失败，已重新加载服务器数据', 'error');
    loadItems();
  }, [loadItems]);

  // 把某一行的待保存快照真正发出去。三条约束：
  //   a) 输入法合成中不发（否则把拼音中间态存进库）；
  //   b) 同一行已有请求在飞时不并发（否则多个快照乱序落地，最终存下的可能是旧值）；
  //   c) 请求回来发现又有新快照，自动补发一次，保证最后一次输入一定落库。
  const flushSaveRef = useRef<(id: string) => void>(() => {});
  const flushSave = useCallback((id: string) => {
    const timer = saveTimerRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      saveTimerRef.current.delete(id);
    }
    const snapshot = pendingSaveRef.current.get(id);
    if (!snapshot) return;
    if (composingIdsRef.current.has(id)) return;
    if (savingIdsRef.current.has(id)) return;
    pendingSaveRef.current.delete(id);
    savingIdsRef.current.add(id);
    updateItemOnServer(snapshot)
      .catch(handlePersistError)
      .finally(() => {
        savingIdsRef.current.delete(id);
        if (pendingSaveRef.current.has(id)) flushSaveRef.current(id);
      });
  }, [updateItemOnServer, handlePersistError]);
  flushSaveRef.current = flushSave;

  // 输入过程中只排队、不请求：停手 700ms 后再写服务器。
  // 这样打字再快也只有一个请求，输入法合成也来得及完成。
  const queueSave = useCallback((item: StatusItem) => {
    pendingSaveRef.current.set(item.id, item);
    const prev = saveTimerRef.current.get(item.id);
    if (prev) clearTimeout(prev);
    // 合成中先攒着，compositionend 时会立刻补发
    if (composingIdsRef.current.has(item.id)) {
      saveTimerRef.current.delete(item.id);
      return;
    }
    saveTimerRef.current.set(item.id, setTimeout(() => flushSaveRef.current(item.id), 700));
  }, []);

  const handleCompositionStart = useCallback((id: string) => {
    composingIdsRef.current.add(id);
  }, []);

  const handleCompositionEnd = useCallback((id: string) => {
    // 延后一拍：compositionend 之后紧跟的 input 事件还会再更新一次内容，
    // 让它先落到 pendingSaveRef，再统一提交
    setTimeout(() => {
      composingIdsRef.current.delete(id);
      flushSaveRef.current(id);
    }, 0);
  }, []);

  // 单行改写：基于 itemsRef（最新本地快照）计算，而不是渲染时的 allItems 闭包。
  // 快速连打时同一帧会连续触发多次 onChange，用闭包快照会互相覆盖导致丢字。
  const applyItemPatch = useCallback((id: string, compute: (item: StatusItem) => StatusItem) => {
    if (!itemsRef.current.some(item => item.id === id)) return;
    let changed: StatusItem | null = null;
    const next = itemsRef.current.map(item => {
      if (item.id !== id) return item;
      changed = compute(item);
      return changed;
    });
    const updated = changed as StatusItem | null;
    if (!updated) return;
    commitItems(next);
    // 本地即时更新，服务器写入走防抖队列（详见 queueSave）
    queueSave(updated);
  }, [commitItems, queueSave]);

  const updateField = useCallback((id: string, field: keyof StatusItem, value: any) => {
    if (!isAdmin) {
      addToast('无权限编辑记录', 'error');
      return;
    }
    if (isOffline) {
      addToast('当前离线，禁止编辑', 'error');
      return;
    }
    applyItemPatch(id, item => {
      const tempItem = { ...item, [field]: value };
      const confirmedVarieties = tempItem.confirmedVarieties || 0;
      const drawnVarieties = tempItem.drawnVarieties || 0;
      const confirmedQuantity = tempItem.confirmedQuantity || 0;
      const shippedCount = tempItem.shippedCount || 0;
      const quantity = parseInt(tempItem.quantity || '0', 10) || 0;
      return {
        ...tempItem,
        undrawnVarieties: Math.max(0, confirmedVarieties - drawnVarieties),
        undrawnQuantity: Math.max(0, confirmedQuantity - shippedCount),
        unconfirmedQuantity: Math.max(0, quantity - confirmedQuantity)
      };
    });
  }, [applyItemPatch, isOffline, isAdmin]);

  const updateItem = useCallback((id: string, updates: Partial<StatusItem>) => {
    if (!isAdmin) {
      addToast('无权限编辑记录', 'error');
      return;
    }
    if (isOffline) {
      addToast('当前离线，禁止编辑', 'error');
      return;
    }
    applyItemPatch(id, item => {
      const tempItem = { ...item, ...updates };
      const confirmedVarieties = tempItem.confirmedVarieties || 0;
      const drawnVarieties = tempItem.drawnVarieties || 0;
      const confirmedQuantity = tempItem.confirmedQuantity || 0;
      const shippedCount = tempItem.shippedCount || 0;
      const quantity = parseInt(tempItem.quantity || '0', 10) || 0;
      return {
        ...tempItem,
        undrawnVarieties: Math.max(0, confirmedVarieties - drawnVarieties),
        undrawnQuantity: Math.max(0, confirmedQuantity - shippedCount),
        unconfirmedQuantity: Math.max(0, quantity - confirmedQuantity)
      };
    });
  }, [applyItemPatch, isOffline, isAdmin]);

  const deleteItem = useCallback(async (id: string) => {
    if (!isAdmin) {
      addToast('无权限删除记录', 'error');
      return;
    }
    if (isOffline) {
      addToast('当前离线，禁止编辑', 'error');
      return;
    }
    const updated = itemsRef.current.filter(item => item.id !== id);
    // 该行可能还有没来得及落库的输入，删掉时一并丢弃
    const timer = saveTimerRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      saveTimerRef.current.delete(id);
    }
    pendingSaveRef.current.delete(id);
    saveItems(updated);
    
    if (!token) {
      addToast('删除服务器记录失败，已重新加载服务器数据', 'error');
      loadItems();
      return;
    }

    try {
      const authHeader = writeAuthHeader();
      await axios.delete(`/api/status-tracking/items/${id}`, authHeader);
    } catch (err) {
      console.error('Error deleting item:', err);
      addToast('删除服务器记录失败，已重新加载服务器数据', 'error');
      loadItems();
      return;
    }
    
    addToast('记录已删除', 'success');
  }, [token, isAdmin, saveItems, isOffline, loadItems, writeAuthHeader]);

  const updateItemInfo = useCallback(async (id: string) => {
    if (!isAdmin) {
      addToast('无权限更新记录', 'error');
      return;
    }
    if (isOffline) {
      addToast('当前离线，禁止编辑', 'error');
      return;
    }
    const item = itemsRef.current.find(i => i.id === id);
    if (!item || !item.specNumber) {
      addToast('无法更新，缺少仕样号', 'error');
      return;
    }

    setUpdatingItemId(id);
    try {
      const authHeader = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
      // 传入该行的添加时间月份，让后端取「各产品大日程」对应月份块的数据
      const planMonths = getItemPlanMonths(item);
      const currentMonthValue = getCurrentMonthValue();
      const preferredMonth = planMonths.includes(currentMonthValue) ? currentMonthValue : (planMonths[0] || '');
      const res = await axios.post('/api/spec/spec-info', {
        specNumber: item.specNumber,
        productionPlanMonth: preferredMonth
      }, { ...authHeader, timeout: 15000 });

      if (!res.data.success) {
        addToast(res.data.message || '获取仕样信息失败', 'error');
        return;
      }

      const specInfo: SpecInfoResponse = res.data;
      const effectiveDeliveryDate = specInfo.deliveryDate || item.deliveryDate;
      const designDeliveryDays = effectiveDeliveryDate ? calculateDesignDeliveryDays(effectiveDeliveryDate) : 0;
      const leader = specInfo.salesPerson ? getLeaderBySalesPerson(specInfo.salesPerson, leaderRules) : item.leader;
      // 大日程工作表命中的工厂优先，其次按营业担当规则，最后保留原值
      const factory = specInfo.factory
        || (specInfo.salesPerson ? getFactoryBySalesPerson(specInfo.salesPerson, factoryRulesConfig) : item.factory);
      const matchedSchedule = Boolean(specInfo.scheduleMonth);

      let updatedItem: StatusItem | null = null;
      // 以当前本地镜像为基准：await 期间用户可能又改了别的单元格
      const updated = itemsRef.current.map(i => {
        if (i.id === id) {
          updatedItem = {
            ...i,
            clientName: specInfo.clientName || i.clientName,
            quantity: specInfo.quantity || i.quantity,
            deliveryDate: effectiveDeliveryDate,
            designDeliveryDays,
            salesPerson: specInfo.salesPerson || i.salesPerson,
            leader,
            factory,
            // 命中大日程时更新「来自哪张表」，未命中保留原值
            sheetName: specInfo.scheduleSheet || i.sheetName,
            // 命中大日程时已发图以表格为准（表格为空则显示空），未命中保留原值
            shippedCount: matchedSchedule ? (specInfo.shippedCount ?? 0) : i.shippedCount
          };
          return updatedItem;
        }
        return i;
      });

      // 丢弃该行还没落库的旧快照，否则 700ms 后它会把刚刷新的信息覆盖回去
      const staleTimer = saveTimerRef.current.get(id);
      if (staleTimer) {
        clearTimeout(staleTimer);
        saveTimerRef.current.delete(id);
      }
      pendingSaveRef.current.delete(id);

      saveItems(updated);
      if (updatedItem) {
        await updateItemOnServer(updatedItem);
      }
      addToast('信息已更新', 'success');
    } catch (err: any) {
      if (axios.isAxiosError(err) && err.code === 'ECONNABORTED') {
        addToast('获取仕样信息超时(超过15秒)', 'error');
      } else {
        addToast('获取仕样信息失败: ' + (err.response?.data?.message || err.message), 'error');
      }
    } finally {
      setUpdatingItemId(null);
    }
  }, [token, saveItems, updateItemOnServer, leaderRules, factoryRulesConfig, isOffline, isAdmin]);

  const startEditing = useCallback((itemId: string) => {
    if (!isAdmin) {
      addToast('无权限编辑记录，只有管理员可以修改状态跟踪', 'error');
      return;
    }
    if (!user || !socket) return;

    // 「被他人锁定」比「连接断开」更具体、更可操作，因此优先判定，
    // 避免真正被占用时却给出泛化的离线提示。
    // 判定口径与服务端一致：锁按「连接」归属，只有本连接持有才算自己的锁。
    // 他人账号、以及同一账号的另一个标签页/设备持有的锁都不能抢占——
    // 抢占等于替原持有者解锁，后来者换行走查时还会把抢来的锁随手放掉。
    const existingSession = editingSessions.find(s => s.itemId === itemId);
    if (existingSession && socket.id && existingSession.socketId !== socket.id) {
      const sameAccount = existingSession.userId === user.id;
      addToast(
        sameAccount
          ? '该记录正在你的其他窗口/设备中编辑，请在该窗口继续或先退出编辑'
          : `${existingSession.username || '他人'} 正在编辑此记录，请稍后再试`,
        'error'
      );
      return;
    }
    // 本连接已持有该行锁：焦点在行内单元格之间移动时无需重复占用。
    // 既避免高频 start_edit 触发服务端频率限制导致锁没抢上，
    // 也减少无谓的全员广播。
    if (existingSession && existingSession.socketId === socket.id) {
      return;
    }
    if (isOffline || !socket.id) {
      addToast('与服务器的连接已断开，暂时无法编辑此记录', 'error');
      return;
    }

    socket.emit('status_tracking_start_edit', {
      itemId,
      userId: user.id,
      username: user.name || user.username || ''
    });
  }, [user, socket, editingSessions, isOffline, isAdmin]);

  startEditingRef.current = startEditing;
  loadItemsRef.current = loadItems;

  const stopEditing = useCallback((itemId: string) => {
    if (!socket) return;
    // 只释放本连接持有的锁：他人（含同一账号其他窗口）持有的锁一律不碰，
    // 服务端也会按 socketId 复核，这里提前挡掉可减少无谓事件。
    const session = editingSessions.find(s => s.itemId === itemId);
    if (session && session.socketId !== socket.id) return;
    socket.emit('status_tracking_stop_edit', { itemId });
  }, [socket, editingSessions]);

  const handleExport = useCallback(async () => {
    if (!token) return;
    setExporting(true);
    try {
      const params = new URLSearchParams();
      params.append('deliveryMonth', deliveryMonth);
      if (sheetFilter) {
        // 合并项（焊钳 / 焊钳修改）会一次传多个 sheetName，后端按「任一命中」筛选
        const sheets = getSheetFilter(sheetFilter)?.sheets || [sheetFilter];
        sheets.forEach(sheet => params.append('sheetName', sheet));
      }
      if (searchTerm.trim()) {
        params.append('searchTerm', searchTerm.trim());
      }
      
      const res = await axios.get(`/api/status-tracking/export?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 14);
      link.download = `status-tracking-${timestamp}.xls`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      addToast('导出成功', 'success');
    } catch (err: any) {
      if (err.response?.status === 404) {
        addToast('没有可导出的数据', 'error');
      } else {
        addToast('导出失败', 'error');
      }
    } finally {
      setExporting(false);
    }
  }, [token, deliveryMonth, sheetFilter, searchTerm]);

  // 同步生产大日程：先从服务端取预览（新增/更新/未变/被锁条数），确认后再落库。
  // 大日程在网络共享盘上，预览还要顺带解析仕样书补全营业担当，
  // 首次（无缓存）约十几秒，因此单独放宽超时并区分按钮文案。
  const handleScheduleSyncPreview = useCallback(async () => {
    if (!isAdmin) {
      addToast('无权限同步生产大日程', 'error');
      return;
    }
    if (!canSyncSchedule) {
      addToast('超级管理员已关闭「同步生产大日程」权限', 'error');
      return;
    }
    setScheduleSyncing(true);
    setScheduleSyncPhase('planning');
    try {
      const res = await axiosInstance.post('/status-tracking/sync-schedule/preview', {}, { timeout: 180000 });
      setScheduleSyncStats(res.data as ScheduleSyncStats);
    } catch (err: any) {
      addToast(err?.response?.data?.message || '读取「各产品大日程.xls」失败，请稍后重试', 'error');
    } finally {
      setScheduleSyncing(false);
      setScheduleSyncPhase('idle');
    }
  }, [isAdmin, canSyncSchedule]);

  const handleScheduleSyncConfirm = useCallback(async () => {
    setScheduleSyncing(true);
    setScheduleSyncPhase('applying');
    try {
      const res = await axiosInstance.post('/status-tracking/sync-schedule', {}, { timeout: 180000 });
      const data = res.data as ScheduleSyncStats;
      addToast(data.message || `同步完成：新增 ${data.added} 条，更新 ${data.updated} 条`, 'success');
      setScheduleSyncStats(null);
      loadItems();
    } catch (err: any) {
      addToast(err?.response?.data?.message || '同步生产大日程失败', 'error');
    } finally {
      setScheduleSyncing(false);
      setScheduleSyncPhase('idle');
    }
  }, [loadItems]);

  useEffect(() => {
    fetchSettings();
    fetchLeaderRules();
    fetchFactoryRules();
    loadItems();
  }, [fetchSettings, fetchLeaderRules, fetchFactoryRules, loadItems]);

  useEffect(() => {
    loadItems();
  }, [deliveryMonth]);

  useEffect(() => {
    const interval = setInterval(() => {
      // 每分钟只重算派生值，不触碰用户正在输入的文字
      const next = itemsRef.current.map(item => ({
        ...item,
        designDeliveryDays: item.deliveryDate ? calculateDesignDeliveryDays(item.deliveryDate) : item.designDeliveryDays
      }));
      itemsRef.current = next;
      setAllItems(next);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // 离开页面 / 关闭标签页：把还在防抖队列里的输入立刻提交，
  // 否则最后一个字的保存计时器会随组件卸载一起被清掉。
  useEffect(() => {
    const flushAll = () => {
      pendingSaveRef.current.forEach((_item, id) => flushSaveRef.current(id));
      try {
        localStorage.setItem('statusTrackingItems', JSON.stringify(itemsRef.current));
      } catch (e) {
        /* 配额或隐私模式下忽略，服务器才是权威数据源 */
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flushAll();
    };
    window.addEventListener('beforeunload', flushAll);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('beforeunload', flushAll);
      document.removeEventListener('visibilitychange', handleVisibility);
      flushAll();
    };
  }, []);

  useEffect(() => {
    if (!token) {
      setSyncStatus('disconnected');
      setSocket(null);
      return;
    }

    // 共享连接：全应用只维护一条 WebSocket，由 socketClient 按引用计数管理生命周期
    const handle = acquireSocket(token);
    const newSocket = handle.socket;

    const applyConnected = () => {
      setSyncStatus('connected');
      setOfflineWarning(false);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      // 重连后补占：旧连接断开时服务端已把它的行锁释放，而焦点可能仍停在
      // 某一行的输入框里（用户毫无感知）。若不重新占用，别人就能趁虚介入，
      // 表现为「编辑中的行锁莫名其妙没了」。
      const focusedRow = document.activeElement?.closest?.('tr[data-item-id]');
      const focusedItemId = focusedRow?.getAttribute('data-item-id');
      if (focusedItemId) {
        startEditingRef.current(focusedItemId);
      }
    };

    const applyDisconnected = () => {
      setSyncStatus('disconnected');
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        setOfflineWarning(true);
      }, 3000);
    };

    // 关键：共享连接可能在本页挂载之前就已建立，connect 事件不会重放。
    // 若不按当前状态校正一次，syncStatus 会一直停在初始的 'disconnected'，
    // isOffline 恒为 true，于是所有编辑都被误判成「离线禁止」。
    if (handle.socket.connected) applyConnected(); else applyDisconnected();

    handle.on('connect', applyConnected);
    handle.on('disconnect', applyDisconnected);

    handle.on('connect_error', () => {
      setSyncStatus('disconnected');
    });

    handle.on('session_invalidated', (data) => {
      // 浏览器与系统分字段展示，替代原来笼统的 summary
      const deviceInfo = [data.newLoginBrowser, data.newLoginOs].filter(Boolean).join(' / ');
      addToast(`账号已在其他设备登录！\n时间: ${data.timestamp}\nIP: ${data.newLoginIp}\n浏览器/系统: ${deviceInfo}`, 'error');
      setTimeout(() => {
        logout();
      }, 3000);
    });

    handle.on('status_tracking_updated', async (data) => {
      if (data.action === 'add') {
        if (itemsRef.current.some(i => i.id === data.item.id)) return;
        commitItemsRef.current([...itemsRef.current, data.item]);
      } else if (data.action === 'update') {
        // 关键：本端正在这一行打字时，绝不把服务器快照写回受控 input。
        // 服务器快照必然滞后于本地输入，一旦回写 value，中文输入法的合成
        // 就会被强行中断，已输入的拼音被截成半截（「打字被截断」的真正原因）。
        if (activeEditItemIdRef.current === data.item.id) return;
        if (!itemsRef.current.some(i => i.id === data.item.id)) return;
        commitItemsRef.current(itemsRef.current.map(i => i.id === data.item.id ? data.item : i));
      } else if (data.action === 'delete') {
        commitItemsRef.current(itemsRef.current.filter(i => i.id !== data.itemId));
      }
    });

    handle.on('status_tracking_bulk', async (dataItems) => {
      // 整表覆盖时保留本端正在编辑的那一行，避免把这几个字直接冲掉
      if (!Array.isArray(dataItems)) return;
      const editingId = activeEditItemIdRef.current;
      const localEditing = editingId ? itemsRef.current.find(i => i.id === editingId) : null;
      const merged = localEditing
        ? dataItems.map((i: StatusItem) => (i.id === editingId ? localEditing : i))
        : dataItems;
      commitItemsRef.current(merged);
    });

    // 任务数据被批量清理 / 导入 / 年度归档后重新拉取：
    // 状态跟踪里会引用任务信息，清理完还停留在旧列表容易被误认为没清干净。
    handle.on('task_refreshed', () => {
      loadItemsRef.current();
    });

    // 连接期快照：后连接的客户端据此看到他人已持有的行锁，
    // 不必等下一次编辑广播。共享连接可能早于本页挂载建立、事件不会重放，
    // 因此注册后立刻用缓存补一次初始状态。
    const applyStatusTrackingState = (sessions: EditingSession[]) => {
      setEditingSessions((Array.isArray(sessions) ? sessions : []).filter(s => s?.itemId));
    };
    handle.on('status_tracking_editing_state', applyStatusTrackingState);
    const cachedStatusTrackingState = handle.getSnapshot<EditingSession[]>('status_tracking_editing_state');
    if (cachedStatusTrackingState) applyStatusTrackingState(cachedStatusTrackingState);

    // 缓存快照可能已经很旧（连接建立时的那一份）：共享连接常驻不销毁，
    // 页面来回切换时它仍是旧值，直接拿它覆盖会把别人正在持有的行锁
    // 显示成「已释放」。因此挂载后向服务端要一份最新快照覆盖一次。
    if (newSocket.connected) {
      newSocket.emit('request_state', { event: 'status_tracking_editing_state' });
    }

    handle.on('status_tracking_edit_start', (data) => {
      setEditingSessions(prev => {
        const filtered = prev.filter(s => s.itemId !== data.itemId);
        return [...filtered, {
          itemId: data.itemId,
          userId: data.userId,
          username: data.username,
          socketId: data.socketId
        }];
      });
    });

    handle.on('status_tracking_edit_stop', (data) => {
      setEditingSessions(prev => prev.filter(s => s.itemId !== data.itemId));
    });

    // 服务端仲裁拒绝：与客户端本地预判重复时只提示一次即可
    handle.on('status_tracking_edit_blocked', (data) => {
      // 把占用者写入本地锁状态：否则本行仍渲染为可编辑，用户会以为
      // 「别人的锁被释放了」并继续输入（实际保存已被服务端 409 拒绝）。
      // 本地已有该行记录但归属的是别的连接（陈旧状态）时，用服务端的占用者覆盖。
      if (data?.itemId && data.userId) {
        setEditingSessions(prev => {
          const index = prev.findIndex(s => s.itemId === data.itemId);
          const holder = {
            itemId: data.itemId,
            userId: data.userId,
            username: data.username,
            socketId: data.socketId
          };
          if (index === -1) return [...prev, holder];
          if (prev[index].socketId === data.socketId) return prev;
          const next = [...prev];
          next[index] = holder;
          return next;
        });
      }
      // 占用者可能是他人，也可能是同一账号的另一个标签页/设备——
      // 后者不要用「他人」文案把用户说糊涂
      const sameAccount = data?.userId && data.userId === userRef.current?.id;
      addToast(
        sameAccount
          ? '该记录正在你的其他窗口/设备中编辑，请在该窗口继续或先退出编辑'
          : `${data?.username || '他人'} 正在编辑此记录，请稍后再试`,
        'error'
      );
    });

    setSocket(newSocket);

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      // 离开页面时释放本连接持有的行锁。共享 socket 由其他页面续命不会断开，
      // 若不主动释放，离开前聚焦的那一行会一直显示「他人正在编辑」挡住别人。
      // 只放自己的锁（userId + socketId 双匹配），不会碰他人持有的行。
      const mySocketId = newSocket.id;
      editingSessionsRef.current
        .filter(s => s.userId === userRef.current?.id && s.socketId === mySocketId)
        .forEach(s => newSocket.emit('status_tracking_stop_edit', { itemId: s.itemId }));
      handle.release();
    };
  }, [token, logout]);

  const filteredItems = useMemo(() => {
    let result = allItems;
    result = result.filter(item => !item.deliveryDate || item.deliveryDate.startsWith(deliveryMonth));
    if (sheetFilter) {
      const sheets = getSheetFilter(sheetFilter)?.sheets || [sheetFilter];
      result = result.filter(item => sheets.includes(getItemSheetName(item)));
    }
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(item => 
        item.clientName.toLowerCase().includes(term) ||
        item.specNumber.toLowerCase().includes(term) ||
        item.salesPerson.toLowerCase().includes(term) ||
        item.leader.toLowerCase().includes(term)
      );
    }
    if (sortConfig) {
      result = [...result].sort((a, b) => {
        if (sortConfig.key === 'deliveryDate') {
          // 空值始终放末尾
          if (!a.deliveryDate && !b.deliveryDate) return 0;
          if (!a.deliveryDate) return 1;
          if (!b.deliveryDate) return -1;
          const cmp = a.deliveryDate.localeCompare(b.deliveryDate);
          return sortConfig.direction === 'asc' ? cmp : -cmp;
        }
        if (sortConfig.key === 'designDeliveryDays') {
          const va = a.designDeliveryDays ?? 0;
          const vb = b.designDeliveryDays ?? 0;
          const cmp = va - vb;
          return sortConfig.direction === 'asc' ? cmp : -cmp;
        }
        return 0;
      });
    }
    return result;
  }, [allItems, searchTerm, sheetFilter, deliveryMonth, sortConfig]);

  // 「设计纳期」格显示的是纳期距今天数，<=0（无纳期或已过期）时留空。
  // 列表默认按纳期升序，所以「第一行非空」自然就是纳期最近、设计纳期最小的那一行。
  // 设计纳期为空的记录仍留在列表里（排序时被放到末尾或靠前位置），不会被过滤掉。
  const firstDesignIndex = useMemo(
    () => filteredItems.findIndex(
      item => Boolean(item.deliveryDate) && calculateDesignDeliveryDays(item.deliveryDate) >= 1
    ),
    [filteredItems]
  );

  // 定位规则：在原有滚动基础上再滚一段，使「设计纳期」非空的第一行成为可视区第一行
  // （顶在吸顶表头下方）。触发时机：①进入页面首次拿到数据；②用户手动切换六个产品钩子中的
  // 任意一个（含全部取消）或改纳期月份。数据实时刷新、用户自己滚动时不触发，不抢滚动位置。
  useEffect(() => {
    // 权限设置未加载完时页面还停在骨架屏，表格节点不存在，等加载完再定位
    if (!settingsLoaded) return;
    if (!pendingPositionRef.current) return;
    if (firstDesignIndex < 0) {
      // 当前筛选下没有「设计纳期」非空的记录，且列表确实已经渲染出来 → 本次定位作废，
      // 否则会一直挂着，等下次数据刷新时突然滚动
      if (filteredItems.length > 0) pendingPositionRef.current = false;
      return;
    }

    let frame1 = 0;
    let frame2 = 0;
    const scrollToTarget = () => {
      const row = targetRowRef.current;
      if (!row) return;
      const container = resolveScrollContainer(row, tableScrollRef.current);
      if (!container) return;
      pendingPositionRef.current = false;
      // 表头是 sticky 的，直接 scrollIntoView 会把目标行藏到表头下面，这里手动扣掉表头高度
      const thead = container.querySelector('thead');
      const headerHeight = thead ? thead.getBoundingClientRect().height : 0;
      const containerRect = container.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      // 目标行顶边对齐到「表头下沿」，成为可视区第一行（留 2px 缝隙，避免半像素把上一行露出头发丝）
      const rowTopInContainer = rowRect.top - containerRect.top;
      const top = container.scrollTop + rowTopInContainer - headerHeight - 2;
      container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    };
    // 等两帧：数据刚渲染完时行高、表头高度可能还没稳定，立刻量会偏
    frame1 = window.requestAnimationFrame(() => {
      frame2 = window.requestAnimationFrame(scrollToTarget);
    });
    return () => {
      window.cancelAnimationFrame(frame1);
      window.cancelAnimationFrame(frame2);
    };
  }, [firstDesignIndex, settingsLoaded, positionToken, filteredItems.length]);

  const toggleSort = useCallback((key: 'deliveryDate' | 'designDeliveryDays') => {
    setSortConfig(prev => {
      if (!prev || prev.key !== key) {
        return { key, direction: 'asc' };
      }
      if (prev.direction === 'asc') {
        return { key, direction: 'desc' };
      }
      // 第三次点击取消排序
      return null;
    });
  }, []);

  const SortIcon = ({ columnKey }: { columnKey: 'deliveryDate' | 'designDeliveryDays' }) => {
    if (!sortConfig || sortConfig.key !== columnKey) {
      return <ArrowUpDown size={14} className="inline ml-1 opacity-60" />;
    }
    return sortConfig.direction === 'asc'
      ? <ArrowUp size={14} className="inline ml-1" />
      : <ArrowDown size={14} className="inline ml-1" />;
  };

  const addLeaderRule = () => {
    setLeaderRules([...leaderRules, { leader: '', members: [''] }]);
  };

  const removeLeaderRule = (index: number) => {
    if (leaderRules.length <= 1) return;
    setLeaderRules(leaderRules.filter((_, i) => i !== index));
  };

  const updateLeaderRule = (index: number, field: 'leader' | 'members', value: string | string[]) => {
    const updated = [...leaderRules];
    updated[index] = { ...updated[index], [field]: value };
    setLeaderRules(updated);
  };

  const addMember = (index: number) => {
    const updated = [...leaderRules];
    updated[index] = { ...updated[index], members: [...updated[index].members, ''] };
    setLeaderRules(updated);
  };

  const removeMember = (ruleIndex: number, memberIndex: number) => {
    const updated = [...leaderRules];
    updated[ruleIndex] = {
      ...updated[ruleIndex],
      members: updated[ruleIndex].members.filter((_, i) => i !== memberIndex)
    };
    setLeaderRules(updated);
  };

  const addFactoryRule = () => {
    setFactoryRulesConfig(prev => ({
      ...prev,
      rules: [...prev.rules, { factory: prev.defaultFactory, members: [''] }]
    }));
  };

  const removeFactoryRule = (index: number) => {
    setFactoryRulesConfig(prev => ({
      ...prev,
      rules: prev.rules.filter((_, i) => i !== index)
    }));
  };

  const updateFactoryRule = (index: number, field: 'factory' | 'members', value: string | string[]) => {
    setFactoryRulesConfig(prev => {
      const updated = [...prev.rules];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, rules: updated };
    });
  };

  const updateDefaultFactory = (value: string) => {
    setFactoryRulesConfig(prev => ({ ...prev, defaultFactory: value }));
  };

  const addFactoryMember = (index: number) => {
    setFactoryRulesConfig(prev => {
      const updated = [...prev.rules];
      updated[index] = { ...updated[index], members: [...updated[index].members, ''] };
      return { ...prev, rules: updated };
    });
  };

  const removeFactoryMember = (ruleIndex: number, memberIndex: number) => {
    setFactoryRulesConfig(prev => {
      const updated = [...prev.rules];
      updated[ruleIndex] = {
        ...updated[ruleIndex],
        members: updated[ruleIndex].members.filter((_, i) => i !== memberIndex)
      };
      return { ...prev, rules: updated };
    });
  };

  if (!settingsLoaded) {
    return <LoadingScreen skeleton="statustracking" />;
  }

  if (!canViewStatusTracking) {
    const isClosed = !settings.enabled;
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col">
        <header className="bg-white shadow-sm px-6 py-2 h-12 flex items-center justify-between border-b border-gray-200">
          <Link to="/" className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 font-bold transition">
            <ChevronLeft size={20} />
            <span>返回工作台</span>
          </Link>
          {user && (
            <button onClick={logout} className="flex items-center space-x-1.5 text-gray-600 hover:text-red-600 text-sm font-semibold transition">
              <LogOut size={18} />
              <span>退出</span>
            </button>
          )}
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Shield size={64} className="mx-auto text-gray-300 mb-4" />
            <h2 className="text-xl font-bold text-gray-600">{isClosed ? '状态跟踪表已关闭' : '暂无权限访问状态跟踪表'}</h2>
            <p className="text-gray-400 mt-2">
              {isClosed ? '请联系超级管理员开启此功能' : '请联系超级管理员开启对应权限'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col overflow-hidden">

      <div className="fixed top-16 right-4 z-50 flex flex-col gap-2">
        {toasts.map(toast => (
          <div key={toast.id} className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-white transition-all duration-300 ${toast.type === 'error' ? 'bg-red-500' : 'bg-green-500'}`}>
            {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        ))}
      </div>

      <header className="sticky top-0 z-40 bg-white shadow-md px-6 py-2 h-12 flex items-center justify-between border-b border-gray-200">
        <div className="flex items-center space-x-4">
          <Link to="/" className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 font-bold transition">
            <ChevronLeft size={20} />
            <span>返回工作台</span>
          </Link>
          <div className="h-6 w-[1px] bg-gray-200 mx-2"></div>
          <h2 className="text-xl font-bold text-blue-600">状态跟踪表</h2>
          <div className="h-6 w-[1px] bg-gray-200 mx-2"></div>
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜索客户、仕样号、营业担当..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="flex-1"></div>

        <div className="flex items-center space-x-4">
          {isAdmin && (
            <button
              onClick={handleScheduleSyncPreview}
              disabled={scheduleSyncing || offlineWarning || !canSyncSchedule}
              title={!canSyncSchedule
                ? '超级管理员已关闭「同步生产大日程」权限，如需使用请联系超级管理员'
                : '从「各产品大日程.xls」的南京焊钳/上海焊钳/南京焊钳修改/上海焊钳修改四张表同步有效仕样号，并按仕样书自动补全营业担当与组长'}
              className="flex shrink-0 items-center gap-2 whitespace-nowrap px-5 py-1.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white text-sm font-bold rounded-full shadow-md hover:shadow-lg transition-all duration-200 tracking-wide disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-md"
            >
              <RefreshCw size={16} className={scheduleSyncing ? 'animate-spin' : ''} />
              {scheduleSyncPhase === 'planning' ? '读取仕样书...' : scheduleSyncPhase === 'applying' ? '同步中...' : '同步生产大日程'}
            </button>
          )}
          {isAdmin && (
            <button
              onClick={handleExport}
              disabled={exporting || offlineWarning}
              className="flex items-center gap-2 px-4 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition"
            >
              {exporting ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
              导出显示结果
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => {
                setRulesModalTab('leader');
                setShowLeaderRulesModal(true);
              }}
              disabled={offlineWarning}
              className="flex items-center space-x-2 px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Users size={18} />
              <span>组长/工厂规则</span>
            </button>
          )}

          {user && (
            <div className="flex items-center space-x-4">
              <span className="text-sm font-bold text-amber-700">{user.name}</span>
              <button onClick={logout} className="flex items-center space-x-1.5 text-gray-600 hover:text-red-600 text-sm font-semibold transition">
                <LogOut size={18} />
                <span>退出</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* 离线禁止编辑提示条（与焊枪台账页面样式一致，滚动时吸顶） */}
      {offlineWarning && (
        <div className="sticky top-12 z-[45] shrink-0 bg-amber-500 text-white px-4 py-2 flex items-center justify-center gap-2 text-xs font-medium border-b border-amber-600 shadow-sm">
          <AlertCircle size={14} className="shrink-0" />
          <span>当前处于离线模式，网络恢复后将自动加载最新数据，此页面禁止编辑！</span>
        </div>
      )}

      {/* 普通用户只读模式提示条（查看权限打开时仅可浏览，不可编辑；离线提示条已覆盖时不再重复展示） */}
      {!offlineWarning && !isAdmin && (
        <div className="relative z-50 shrink-0 bg-amber-500 text-white px-4 py-2 flex items-center justify-center gap-2 text-xs font-medium border-b border-amber-600 shadow-sm">
          <Eye size={14} className="shrink-0" />
          <span>当前为只读模式，仅可查看数据，无法编辑</span>
        </div>
      )}

      {/* 筛选条：产品（四张日程表）单选 + 纳期月份。
          四张表并列而不是下拉，一眼能看到当前在看哪张表。 */}
      <div className="shrink-0 bg-white border-b border-gray-200 px-6 py-2 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {SHEET_FILTERS.map((option, index) => {
            const active = sheetFilter === option.key;
            // 合并项与单项之间用细竖线分组，避免六项连成一片看不出层级
            const isGroupStart = index === 1 || index === 3;
            return (
              <React.Fragment key={option.key}>
                {isGroupStart && <span className="mx-0.5 h-4 w-[1px] bg-gray-200" />}
                <button
                  type="button"
                  onClick={() => {
                    setSheetFilter(active ? '' : option.key);
                    // 任意勾选/取消都重新定位到「设计纳期」非空的第一行
                    requestReposition();
                  }}
                  title={active ? '再次点击取消筛选，显示全部记录' : option.hint}
                  className={`px-3 py-1 text-sm rounded-full border transition ${
                    active
                      ? 'bg-blue-600 border-blue-600 text-white font-bold shadow-sm'
                      : option.sheets.length > 1
                        ? 'bg-slate-50 border-gray-300 text-gray-700 font-semibold hover:border-blue-400 hover:text-blue-600'
                        : 'bg-white border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600'
                  }`}
                >
                  {option.key}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        <div className="h-5 w-[1px] bg-gray-200"></div>

        {/* 只按纳期月份筛选 */}
        <div className="relative">
          <select
            value={deliveryMonth}
            onChange={(e) => {
              setDeliveryMonth(e.target.value);
              // 换月份后同样按规则定位
              requestReposition();
            }}
            title="按纳期月份筛选"
            className="appearance-none pl-3 pr-8 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            {generateDeliveryMonthOptions(allItems).map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <ChevronDown size={16} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>

        <div className="ml-auto flex items-center gap-3 text-xs text-gray-500">
          {sheetFilter && (
            <button
              type="button"
              onClick={() => {
                // 「显示全部」= 六个钩子都不勾，也要重新定位
                setSheetFilter('');
                requestReposition();
              }}
              className="text-blue-600 hover:text-blue-800 hover:underline"
            >
              显示全部
            </button>
          )}
          <span>
            共 <span className="font-bold text-gray-700">{filteredItems.length}</span> 条
          </span>
        </div>
      </div>

      <main ref={tableScrollRef} className={`flex-1 px-6 pb-6 overflow-y-auto overflow-x-auto ${offlineWarning ? 'offline-locked' : ''}`}>
        <div className="h-6 shrink-0"></div>
        <div className="w-fit min-w-full bg-white rounded-2xl shadow-xl border border-gray-100">
            <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '80px' }} />
                <col style={{ width: '274px' }} />
                <col style={{ width: '45px' }} />
                <col style={{ width: '60px' }} />
                <col style={{ width: '45px' }} />
                <col style={{ width: '45px' }} />
                <col style={{ width: '45px' }} />
                <col style={{ width: '45px' }} />
                <col style={{ width: '200px' }} />
                <col style={{ width: '240px' }} />
                <col style={{ width: '45px' }} />
                <col style={{ width: '45px' }} />
                <col style={{ width: '45px' }} />
                <col style={{ width: '45px' }} />
                <col style={{ width: '45px' }} />
                <col style={{ width: '45px' }} />
                <col style={{ width: '45px' }} />
                <col style={{ width: '80px' }} />
                <col style={{ width: '80px' }} />
                <col style={{ width: '96px' }} />
              </colgroup>
              <thead className="sticky top-0 z-20">
                <tr className="bg-gradient-to-r from-blue-600 to-blue-700 text-white">
                  <th className="px-2 py-1.5 text-center border-r border-white rounded-tl-2xl" rowSpan={2}>工厂</th>
                  <th className="px-2 py-1.5 text-center border-r border-white" rowSpan={2}>客户</th>
                  <th className="px-2 py-1.5 text-center border-r border-white" rowSpan={2}>
                    <VerticalHeader text="数量" />
                  </th>
                  <th
                    className={`px-2 py-1.5 text-center border-r border-white cursor-pointer select-none hover:bg-blue-700 transition ${
                      sortConfig?.key === 'deliveryDate' ? 'bg-blue-800' : ''
                    }`}
                    rowSpan={2}
                    onClick={() => toggleSort('deliveryDate')}
                    title="点击排序"
                  >
                    纳期<SortIcon columnKey="deliveryDate" />
                  </th>
                  <th className="px-2 py-1.5 text-center border-r border-white" rowSpan={2}>
                    <VerticalHeader text="已发图" />
                  </th>
                  <th className="px-2 py-1.5 text-center border-r border-white" rowSpan={2}>
                    <VerticalHeader text="未确认" />
                  </th>
                  <th className="px-2 py-1.5 text-center border-r border-white border-b border-white bg-green-600" colSpan={4}>
                    {new Date().getMonth() + 1}/{new Date().getDate()} 状态
                  </th>
                  <th className="px-2 py-1.5 text-center border-r border-white" rowSpan={2}>
                    <VerticalHeader text="确认数量" />
                  </th>
                  <th className="px-2 py-1.5 text-center border-r border-white" rowSpan={2}>
                    <VerticalHeader text="确认种数" />
                  </th>
                  <th className="px-2 py-1.5 text-center border-r border-white" rowSpan={2}>
                    <VerticalHeader text="下图种数" />
                  </th>
                  <th className="px-2 py-1.5 text-center border-r border-white bg-teal-400" rowSpan={2}>
                    <VerticalHeader text="未下种数" />
                  </th>
                  <th className="px-2 py-1.5 text-center border-r border-white bg-teal-400" rowSpan={2}>
                    <VerticalHeader text="未下数量" />
                  </th>
                  <th className="px-2 py-1.5 text-center border-r border-white bg-teal-400" rowSpan={2}>
                    <VerticalHeader text="未确认数" />
                  </th>
                  <th
                    className={`px-2 py-1.5 text-center border-r border-white cursor-pointer select-none hover:bg-blue-700 transition ${
                      sortConfig?.key === 'designDeliveryDays' ? 'bg-blue-800' : ''
                    }`}
                    rowSpan={2}
                    onClick={() => toggleSort('designDeliveryDays')}
                    title="点击排序"
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <VerticalHeader text="设计纳期" />
                      <SortIcon columnKey="designDeliveryDays" />
                    </div>
                  </th>
                  <th className="px-2 py-1.5 text-center border-r border-white" rowSpan={2}>营业担当</th>
                  <th className="px-2 py-1.5 text-center border-r border-white" rowSpan={2}>组长</th>
                  <th className="px-2 py-1.5 text-center rounded-tr-2xl" rowSpan={2}>操作</th>
                </tr>
                <tr className="bg-gradient-to-r from-blue-600 to-blue-700 text-white">
                  <th className="px-2 py-1.5 text-center border-r border-white bg-green-600">
                    <VerticalHeader text="总种数" />
                  </th>
                  <th className="px-2 py-1.5 text-center border-r border-white bg-green-600">
                    <VerticalHeader text="反馈种数" />
                  </th>
                  <th className="px-2 py-1.5 text-center border-r border-white bg-green-600">反馈计划</th>
                  <th className="px-2 py-1.5 text-center border-r border-white bg-green-600">下图计划及状态</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={20} className="px-4 py-12 text-center text-gray-400">
                      <Shield size={48} className="mx-auto mb-4 opacity-50" />
                      {allItems.length > 0 ? (
                        <>
                          <div className="text-lg font-medium">当前筛选条件下没有记录</div>
                          <div className="text-sm mt-2">
                            换个月份或点筛选条右侧的「显示全部」试试
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-lg font-medium">暂无状态跟踪记录</div>
                          <div className="text-sm mt-2">
                            {isAdmin
                              ? (canSyncSchedule
                                ? '点击右上角「同步生产大日程」，从各产品大日程同步仕样号'
                                : '超级管理员已关闭「同步生产大日程」权限，请联系超级管理员同步')
                              : '请联系管理员同步生产大日程'}
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item, index) => {
                    const editingSession = editingSessions.find(s => s.itemId === item.id);
                    // 锁按「连接」归属：只有本连接持有的锁才算自己的。
                    // 他人账号、以及同一账号的另一个窗口/设备持有的锁都要锁住本行，
                    // 否则后来者一点就把原持有者的锁顶掉了。
                    const lockedByOtherConnection = Boolean(editingSession) && editingSession!.socketId !== socket?.id;
                    const lockedBySameAccount = lockedByOtherConnection && editingSession!.userId === user?.id;
                    const isLocked = lockedByOtherConnection;
                    const lockHint = lockedBySameAccount
                      ? '该记录正在你的其他窗口/设备中编辑，请在该窗口继续或先退出编辑'
                      : `${editingSession?.username || '他人'} 正在编辑此记录，请稍后再试`;
                    // 「已发图」与「数量」相同时标绿，便于识别已发完
                    const quantityValue = parseInt(item.quantity, 10);
                    const shippedMatchesQuantity = item.quantity !== ''
                      && Number.isFinite(quantityValue)
                      && quantityValue > 0
                      && (item.shippedCount || 0) === quantityValue;

                    return (
                      <tr
                        key={item.id}
                        // 「设计纳期」最小的那一行：进页面后自动滚到这里（见上方的滚动 effect）
                        ref={index === firstDesignIndex ? targetRowRef : undefined}
                        // 供重连后按焦点所在行补占行锁（见 applyConnected）
                        data-item-id={item.id}
                        className={`trow-hover trow-hover-blue ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${isLocked ? 'cursor-not-allowed' : ''}`}
                        // 被锁定时整行输入都是 disabled，无法触发 onFocus，
                        // 也就不会有任何提示；用 title 让用户 hover 即知原因
                        title={isLocked ? lockHint : undefined}
                        // 行级获取/释放编辑锁：startEditing/stopEditing 此前从未被调用，
                        // 编辑锁功能实际上一直不生效。焦点在本行内单元格之间移动时
                        // 不应释放锁，因此只在焦点离开整行时才 stop。
                        onFocus={() => {
                          // 标记「这一行正在编辑」：期间不接受服务器推送覆盖，
                          // 否则输入法的合成会被打断
                          activeEditItemIdRef.current = item.id;
                          startEditing(item.id);
                        }}
                        onBlur={(e) => {
                          const next = e.relatedTarget as Node | null;
                          if (!next || !e.currentTarget.contains(next)) {
                            activeEditItemIdRef.current = null;
                            // 极端情况：合成事件没正常结束时焦点就跑了，
                            // 这里强制解封，避免这行的改动一直卡在队列里不落库
                            composingIdsRef.current.delete(item.id);
                            // 焦点离开整行时立刻把这行攒的改动落库，不必再等防抖
                            flushSaveRef.current(item.id);
                            stopEditing(item.id);
                          }
                        }}
                      >
                        <td className="px-2 py-2 border-b border-gray-200 text-center overflow-hidden">
                          <select
                            value={item.factory}
                            onChange={(e) => updateField(item.id, 'factory', e.target.value)}
                            disabled={isLocked || !isAdmin}
                            className="w-full text-center border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed appearance-none"
                          >
                            {factoryOptions.map(option => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2 border-b border-gray-200 overflow-hidden">
                          <input
                            type="text"
                            value={item.clientName}
                            onChange={(e) => updateField(item.id, 'clientName', e.target.value)}
                            onCompositionStart={() => handleCompositionStart(item.id)}
                            onCompositionEnd={() => handleCompositionEnd(item.id)}
                            disabled={isLocked || !isAdmin}
                            className="w-full text-left border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-blue-700 truncate"
                            title={item.clientName}
                          />
                        </td>
                        <td className="px-1 py-2 border-b border-gray-200 text-center overflow-hidden">
                          <input
                            type="text"
                            value={item.quantity}
                            onChange={(e) => updateField(item.id, 'quantity', validateNumberInput(e.target.value))}
                            disabled={isLocked || !isAdmin}
                            className="w-full text-center border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="px-1 py-2 border-b border-gray-200 text-center relative">
                          <button
                            onClick={() => openDatePicker(item.id)}
                            disabled={isLocked || !isAdmin}
                            className={`w-full text-center text-xs text-gray-700 rounded hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isLocked ? '' : 'cursor-pointer'}`}
                          >
                            {formatDeliveryDate(item.deliveryDate) || '—'}
                            <input
                              ref={(el) => {
                                if (el) {
                                  dateInputRefs.current.set(item.id, el);
                                } else {
                                  dateInputRefs.current.delete(item.id);
                                }
                              }}
                              type="date"
                              value={item.deliveryDate}
                              onChange={(e) => {
                                updateItem(item.id, {
                                  deliveryDate: e.target.value,
                                  designDeliveryDays: calculateDesignDeliveryDays(e.target.value)
                                });
                              }}
                              disabled={isLocked || !isAdmin}
                              style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', inset: 0, pointerEvents: 'none' }}
                            />
                          </button>
                        </td>
                        <td className="px-1 py-2 border-b border-gray-200 text-center overflow-hidden">
                          <input
                            type="text"
                            value={item.shippedCount || ''}
                            onChange={(e) => updateField(item.id, 'shippedCount', parseInt(validateNumberInput(e.target.value)) || 0)}
                            disabled={isLocked || !isAdmin}
                            className={`w-full text-center border rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${shippedMatchesQuantity ? 'bg-green-100 border-green-500 text-green-800' : 'border-gray-300'}`}
                          />
                        </td>
                        <td className="px-1 py-2 border-b border-gray-200 text-center font-bold">
                          {(item.confirmedQuantity || 0) < (parseInt(item.quantity) || 0) ? '是' : ''}
                        </td>
                        <td className="px-1 py-2 border-b border-gray-200 text-center overflow-hidden">
                          <input
                            type="text"
                            value={item.totalVarieties || ''}
                            onChange={(e) => updateField(item.id, 'totalVarieties', parseInt(validateNumberInput(e.target.value)) || 0)}
                            disabled={isLocked || !isAdmin}
                            className="w-full text-center border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="px-1 py-2 border-b border-gray-200 text-center overflow-hidden">
                          <input
                            type="text"
                            value={item.feedbackVarieties || ''}
                            onChange={(e) => updateField(item.id, 'feedbackVarieties', parseInt(validateNumberInput(e.target.value)) || 0)}
                            disabled={isLocked || !isAdmin}
                            className="w-full text-center border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="px-2 py-2 border-b border-gray-200 text-center overflow-hidden">
                          <input
                            type="text"
                            value={item.feedbackPlan}
                            onChange={(e) => updateField(item.id, 'feedbackPlan', e.target.value)}
                            onCompositionStart={() => handleCompositionStart(item.id)}
                            onCompositionEnd={() => handleCompositionEnd(item.id)}
                            disabled={isLocked || !isAdmin}
                            className="w-full text-center border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            placeholder="反馈计划"
                            title={item.feedbackPlan || undefined}
                          />
                        </td>
                        <td className="px-2 py-2 border-b border-gray-200 text-center overflow-hidden">
                          <input
                            type="text"
                            value={item.drawingPlanStatus}
                            onChange={(e) => updateField(item.id, 'drawingPlanStatus', e.target.value)}
                            onCompositionStart={() => handleCompositionStart(item.id)}
                            onCompositionEnd={() => handleCompositionEnd(item.id)}
                            disabled={isLocked || !isAdmin}
                            className="w-full text-center border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            placeholder="下图计划及状态"
                            title={item.drawingPlanStatus || undefined}
                          />
                        </td>
                        <td className="px-1 py-2 border-b border-gray-200 text-center overflow-hidden">
                          <input
                            type="text"
                            value={item.confirmedQuantity || ''}
                            onChange={(e) => updateField(item.id, 'confirmedQuantity', parseInt(validateNumberInput(e.target.value)) || 0)}
                            disabled={isLocked || !isAdmin}
                            className="w-full text-center border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="px-1 py-2 border-b border-gray-200 text-center overflow-hidden">
                          <input
                            type="text"
                            value={item.confirmedVarieties || ''}
                            onChange={(e) => updateField(item.id, 'confirmedVarieties', parseInt(validateNumberInput(e.target.value)) || 0)}
                            disabled={isLocked || !isAdmin}
                            className="w-full text-center border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="px-1 py-2 border-b border-gray-200 text-center overflow-hidden">
                          <input
                            type="text"
                            value={item.drawnVarieties || ''}
                            onChange={(e) => updateField(item.id, 'drawnVarieties', parseInt(validateNumberInput(e.target.value)) || 0)}
                            disabled={isLocked || !isAdmin}
                            className="w-full text-center border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        </td>
                        {(() => {
                          const val1 = (item.confirmedVarieties || 0) - (item.drawnVarieties || 0);
                          return (
                            <td className={`px-1 py-2 border-b border-gray-200 text-center overflow-hidden ${val1 !== 0 ? 'font-bold text-red-600 bg-red-100' : ''}`}>
                              {val1}
                            </td>
                          );
                        })()}
                        {(() => {
                          const val2 = (item.confirmedQuantity || 0) - (item.shippedCount || 0);
                          return (
                            <td className={`px-1 py-2 border-b border-gray-200 text-center overflow-hidden ${val2 !== 0 ? 'font-bold text-red-600 bg-red-100' : ''}`}>
                              {val2}
                            </td>
                          );
                        })()}
                        {(() => {
                          const val3 = (parseInt(item.quantity) || 0) - (item.confirmedQuantity || 0);
                          return (
                            <td className={`px-1 py-2 border-b border-gray-200 text-center overflow-hidden ${val3 !== 0 ? 'font-bold text-red-600 bg-red-100' : ''}`}>
                              {val3}
                            </td>
                          );
                        })()}
                        {(() => {
                          const designDays = item.deliveryDate ? calculateDesignDeliveryDays(item.deliveryDate) : 0;
                          let colorClass = '';
                          if (designDays <= 7 && designDays >= 1) colorClass = 'text-red-700';
                          else if (designDays <= 14 && designDays >= 1) colorClass = 'text-yellow-700';
                          else if (designDays >= 1) colorClass = 'text-green-700';
                          return (
                            <td className={`px-1 py-2 border-b border-gray-200 text-center font-bold overflow-hidden ${colorClass}`}>
                              {designDays >= 1 ? designDays : ''}
                            </td>
                          );
                        })()}
                        <td className="px-2 py-2 border-b border-gray-200 text-center overflow-hidden">
                          <select
                            value={item.salesPerson}
                            onChange={(e) => {
                              updateItem(item.id, {
                                salesPerson: e.target.value,
                                leader: getLeaderBySalesPerson(e.target.value, leaderRules),
                                factory: getFactoryBySalesPerson(e.target.value, factoryRulesConfig)
                              });
                            }}
                            disabled={isLocked || !isAdmin}
                            className="w-full text-center border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed appearance-none"
                          >
                            <option value="">请选择</option>
                            {allSalesPersons.map(person => (
                              <option key={person} value={person}>{person}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2 border-b border-gray-200 text-center font-medium overflow-hidden">
                          <select
                            value={item.leader}
                            onChange={(e) => updateField(item.id, 'leader', e.target.value)}
                            disabled={isLocked || !isAdmin}
                            className="w-full text-center border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed appearance-none"
                          >
                            <option value="">请选择</option>
                            {allLeaders.map(leader => (
                              <option key={leader} value={leader}>{leader}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2 border-b border-gray-200 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {isLocked ? (
                              <div className="flex items-center gap-1 text-gray-400">
                                <Lock size={14} />
                                <span className="text-xs">{lockedBySameAccount ? '你的其他窗口' : editingSession?.username}正在编辑</span>
                              </div>
                            ) : isAdmin ? (
                              <>
                                <button
                                  onClick={() => updateItemInfo(item.id)}
                                  disabled={updatingItemId === item.id}
                                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition disabled:opacity-50 disabled:cursor-wait"
                                  title="更新信息"
                                >
                                  <RefreshCw size={16} className={updatingItemId === item.id ? 'animate-spin' : ''} />
                                </button>
                                <button
                                  onClick={() => setDeleteConfirmId(item.id)}
                                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                                  title="删除"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
        </div>

        {isSuperAdmin && (
          <div className="mt-6 bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
              <Shield className="mr-2 text-purple-600" size={22} />
              状态跟踪表权限设置
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: '启用状态跟踪表', detail: 'Global Toggle', key: 'enabled' as const },
                { label: '一般管理员', detail: 'Admin Access', key: 'allowAdmins' as const },
                { label: '普通用户', detail: 'User Access', key: 'allowViewers' as const },
                { label: '一般管理员可同步生产大日程', detail: 'Admin Sync Access', key: 'allowAdminScheduleSync' as const }
              ].map(item => (
                <div key={item.key} className="flex items-center justify-between gap-3 p-5 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="min-w-0">
                    <div className="font-bold text-gray-700 text-sm leading-tight">{item.label}</div>
                    <div className="text-[10px] text-gray-400 font-bold uppercase mt-0.5">{item.detail}</div>
                    {item.key === 'allowAdminScheduleSync' && (
                      <div className="text-[11px] text-gray-400 mt-1 leading-tight">关闭后仅超级管理员可同步</div>
                    )}
                  </div>
                  <div className="relative inline-block w-12 h-6 shrink-0 align-middle select-none transition duration-200 ease-in">
                    <input
                      type="checkbox"
                      checked={settings[item.key]}
                      onChange={(e) => updateSettings({ [item.key]: e.target.checked })}
                      disabled={!settingsLoaded}
                      className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer z-10"
                    />
                    <label className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer ${settings[item.key] ? 'bg-blue-500' : 'bg-gray-300'}`}></label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

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

      {scheduleSyncStats && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !scheduleSyncing && setScheduleSyncStats(null)}
          />
          <div className="relative bg-white rounded-xl shadow-2xl w-[480px] max-w-[92vw] border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-lg">
                <RefreshCw size={20} className={scheduleSyncing ? 'animate-spin' : ''} />
                同步生产大日程
              </div>
              <button
                className="p-1 rounded hover:bg-white/20 transition"
                onClick={() => !scheduleSyncing && setScheduleSyncStats(null)}
                disabled={scheduleSyncing}
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-600 leading-relaxed">
                将读取「各产品大日程.xls」中
                <span className="font-semibold text-gray-800">南京焊钳、上海焊钳、南京焊钳修改、上海焊钳修改</span>
                四张工作表的全部有效仕样号（位数符合系统配置且数量&gt;0），按所属月份写入状态跟踪。
                已有记录只覆盖工厂、客户、数量、纳期、已发图；营业担当与组长按仕样书自动补全，
                但只填空缺，人工改过的值不会被覆盖。
              </p>

              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-center">
                  <div className="text-xl font-bold text-blue-700">{scheduleSyncStats.added}</div>
                  <div className="text-xs text-blue-500 mt-0.5">将新增</div>
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-center">
                  <div className="text-xl font-bold text-amber-600">{scheduleSyncStats.updated}</div>
                  <div className="text-xs text-amber-500 mt-0.5">将更新</div>
                </div>
                <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-center">
                  <div className="text-xl font-bold text-gray-600">{scheduleSyncStats.unchanged}</div>
                  <div className="text-xs text-gray-500 mt-0.5">已一致</div>
                </div>
              </div>

              {(scheduleSyncStats.salesFilled !== undefined || scheduleSyncStats.leaderFilled !== undefined) && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs text-emerald-800 leading-relaxed">
                  <div className="flex items-center gap-1.5 font-bold">
                    <Users size={14} />
                    自动补全营业担当 {scheduleSyncStats.salesFilled || 0} 条、组长 {scheduleSyncStats.leaderFilled || 0} 条
                  </div>
                  <div className="text-emerald-700/80 mt-0.5">
                    营业担当取自仕样书 PDF，组长按「组长规则」由营业担当推出；只补空字段，不覆盖已有值。
                  </div>
                  {(scheduleSyncStats.salesMissing || 0) > 0 && (
                    <div className="text-amber-700 mt-1">
                      另有 {scheduleSyncStats.salesMissing} 条在仕样书中未找到营业担当
                      {scheduleSyncStats.salesLookup && scheduleSyncStats.salesLookup.missingPdf > 0
                        ? `（其中 ${scheduleSyncStats.salesLookup.missingPdf} 条没有对应仕样书）`
                        : ''}
                      ，同步后需人工补填。
                    </div>
                  )}
                  {scheduleSyncStats.salesLookup && !scheduleSyncStats.salesLookup.shareAvailable && (
                    <div className="text-amber-700 mt-1">仕样书共享目录不可访问，本次只同步表格字段；营业担当留待下次同步或人工填写。</div>
                  )}
                </div>
              )}

              <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 space-y-1">
                <div>
                  <span className="text-gray-400">有效仕样号：</span>
                  {scheduleSyncStats.total} 条
                  {scheduleSyncStats.skipped > 0 && (
                    <span className="text-gray-400">（另有 {scheduleSyncStats.skipped} 行不符合条件已忽略）</span>
                  )}
                </div>
                {scheduleSyncStats.months.length > 0 && (
                  <div>
                    <span className="text-gray-400">月份分布：</span>
                    {scheduleSyncStats.months.map(m => `${formatMonthLabel(m.month)} ${m.count} 条`).join('，')}
                  </div>
                )}
                {scheduleSyncStats.locked > 0 && (
                  <div className="text-amber-600">
                    <span className="text-amber-500">正在他人编辑中：</span>
                    {scheduleSyncStats.locked} 条将被跳过，请保存后再同步
                  </div>
                )}
              </div>

              <div className="flex space-x-3 pt-1">
                <button
                  onClick={() => setScheduleSyncStats(null)}
                  disabled={scheduleSyncing}
                  className="flex-1 px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold rounded-lg transition disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={handleScheduleSyncConfirm}
                  disabled={scheduleSyncing || (scheduleSyncStats.added === 0 && scheduleSyncStats.updated === 0)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {scheduleSyncing ? <RefreshCw size={16} className="animate-spin" /> : null}
                  {scheduleSyncing ? '同步中...' : '开始同步'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmId && isAdmin && (() => {
        const targetItem = allItems.find(item => item.id === deleteConfirmId);
        if (!targetItem) {
          return null;
        }
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                  <AlertTriangle className="text-red-600" size={22} />
                </div>
                <h3 className="text-lg font-bold text-gray-800">确认删除</h3>
              </div>
              <p className="text-gray-600 mb-1">确定要删除这条记录吗？此操作不可撤销。</p>
              <div className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3 mt-3 space-y-1">
                <div className="truncate"><span className="text-gray-400">客户：</span>{targetItem.clientName || '未填写'}</div>
                <div className="truncate"><span className="text-gray-400">仕样号：</span>{targetItem.specNumber || '未填写'}</div>
              </div>
              <div className="flex space-x-3 mt-6">
                <button
                  onClick={() => setDeleteConfirmId(null)}
                  className="flex-1 px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold rounded-lg transition"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    const id = deleteConfirmId;
                    setDeleteConfirmId(null);
                    deleteItem(id);
                  }}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        );
      })()}


      {showLeaderRulesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !resettingRules && setShowLeaderRulesModal(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-4 max-h-[85vh] flex flex-col border border-gray-200 overflow-hidden">
            {/* 头部 */}
            <div className="px-5 py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 font-bold text-lg">
                <Users size={20} />
                组长/工厂规则配置
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowResetRulesConfirm(true)}
                  disabled={!isSuperAdmin || resettingRules}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-white/15 hover:bg-white/25 rounded-md border border-white/25 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  title={isSuperAdmin ? `恢复为系统默认${rulesModalTab === 'leader' ? '组长' : '工厂'}规则` : '仅超级管理员可重置'}
                >
                  <RotateCcw size={12} className={resettingRules ? 'animate-spin' : ''} />
                  {resettingRules ? '重置中...' : '重置为默认规则'}
                </button>
                <button className="p-1 rounded hover:bg-white/20 transition" onClick={() => setShowLeaderRulesModal(false)}>
                  <X size={20} />
                </button>
              </div>
            </div>
            {/* Tab 切换栏 */}
            <div className="flex shrink-0 border-b border-gray-200 bg-gray-50">
              <button
                onClick={() => setRulesModalTab('leader')}
                className={`flex items-center gap-2 px-5 py-2.5 text-sm font-bold transition border-b-2 ${
                  rulesModalTab === 'leader'
                    ? 'border-blue-600 text-blue-600 bg-white'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Users size={16} />
                组长规则
                <span className="text-xs font-medium text-gray-400">({leaderRules.length})</span>
              </button>
              <button
                onClick={() => setRulesModalTab('factory')}
                className={`flex items-center gap-2 px-5 py-2.5 text-sm font-bold transition border-b-2 ${
                  rulesModalTab === 'factory'
                    ? 'border-teal-600 text-teal-600 bg-white'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Building2 size={16} />
                工厂规则
                <span className="text-xs font-medium text-gray-400">({factoryRulesConfig.rules.length})</span>
              </button>
            </div>
            {/* 规则内容区 */}
            <div className="flex-1 min-h-0 p-5 overflow-y-auto">
              {rulesModalTab === 'leader' ? (
                <div className="grid grid-cols-2 gap-4">
                  {leaderRules.map((rule, index) => (
                    <div key={index} className="border border-gray-200 rounded-xl p-4 bg-gray-50/60 hover:border-blue-300 hover:shadow-md transition">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-lg bg-blue-600 text-white text-xs font-black flex items-center justify-center shadow-sm">{index + 1}</span>
                          <span className="text-sm font-bold text-gray-600">规则 {index + 1}</span>
                        </div>
                        <button
                          onClick={() => removeLeaderRule(index)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400"
                          disabled={leaderRules.length <= 1}
                          title="删除此规则"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="mb-3">
                        <label className="block text-gray-500 text-[10px] font-black uppercase tracking-widest mb-1.5 ml-1">组长姓名</label>
                        <input
                          type="text"
                          value={rule.leader}
                          onChange={(e) => updateLeaderRule(index, 'leader', e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-800 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                          placeholder="输入组长姓名"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="block text-gray-500 text-[10px] font-black uppercase tracking-widest ml-1">营业担当成员</label>
                          <button
                            onClick={() => addMember(index)}
                            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-bold px-2 py-0.5 rounded-md hover:bg-blue-50 transition"
                          >
                            <UserPlus size={12} />
                            添加成员
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {rule.members.map((member, mIndex) => (
                            <div key={mIndex} className="flex items-center gap-0.5 bg-white border border-gray-200 rounded-lg pl-2.5 pr-1 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition">
                              <input
                                type="text"
                                value={member}
                                onChange={(e) => {
                                  const updatedMembers = [...rule.members];
                                  updatedMembers[mIndex] = e.target.value;
                                  updateLeaderRule(index, 'members', updatedMembers);
                                }}
                                className="px-0 py-1.5 bg-transparent text-sm text-gray-800 font-semibold outline-none w-16"
                                placeholder="姓名"
                              />
                              <button
                                onClick={() => removeMember(index, mIndex)}
                                className="p-1 text-gray-300 hover:text-red-500 transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-gray-300"
                                disabled={rule.members.length <= 1}
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  {/* 默认工厂设置 */}
                  <div className="flex items-center gap-3 p-4 border border-teal-200 rounded-xl bg-teal-50/60">
                    <div className="flex items-center gap-2 text-teal-700 shrink-0">
                      <Building2 size={18} />
                      <span className="text-sm font-bold">默认工厂</span>
                    </div>
                    <div className="text-xs text-gray-500">未命中规则的营业担当将分配至此工厂</div>
                    <div className="ml-auto w-40">
                      <div className="relative">
                        <select
                          value={factoryRulesConfig.defaultFactory}
                          onChange={(e) => updateDefaultFactory(e.target.value)}
                          className="w-full appearance-none px-3 py-2 bg-white border border-teal-300 rounded-lg text-sm text-gray-800 font-bold focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition cursor-pointer"
                        >
                          {factoryOptions.map(option => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                        <ChevronDown size={16} className="absolute right-2 top-1/2 -translate-y-1/2 text-teal-500 pointer-events-none" />
                      </div>
                    </div>
                  </div>
                  {/* 工厂规则卡片 */}
                  <div className="grid grid-cols-2 gap-4">
                    {factoryRulesConfig.rules.map((rule, index) => (
                      <div key={index} className="border border-gray-200 rounded-xl p-4 bg-gray-50/60 hover:border-teal-300 hover:shadow-md transition">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-lg bg-teal-600 text-white text-xs font-black flex items-center justify-center shadow-sm">{index + 1}</span>
                            <span className="text-sm font-bold text-gray-600">规则 {index + 1}</span>
                          </div>
                          <button
                            onClick={() => removeFactoryRule(index)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400"
                            disabled={factoryRulesConfig.rules.length === 0}
                            title="删除此规则"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div className="mb-3">
                          <label className="block text-gray-500 text-[10px] font-black uppercase tracking-widest mb-1.5 ml-1">对应工厂</label>
                          <div className="relative">
                            <select
                              value={rule.factory}
                              onChange={(e) => updateFactoryRule(index, 'factory', e.target.value)}
                              className="w-full appearance-none px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-800 font-bold focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition cursor-pointer"
                            >
                              {factoryOptions.map(option => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>
                            <ChevronDown size={16} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="block text-gray-500 text-[10px] font-black uppercase tracking-widest ml-1">营业担当成员</label>
                            <button
                              onClick={() => addFactoryMember(index)}
                              className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-bold px-2 py-0.5 rounded-md hover:bg-teal-50 transition"
                            >
                              <UserPlus size={12} />
                              添加成员
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {rule.members.map((member, mIndex) => (
                              <div key={mIndex} className="flex items-center gap-0.5 bg-white border border-gray-200 rounded-lg pl-2.5 pr-1 focus-within:border-teal-400 focus-within:ring-2 focus-within:ring-teal-100 transition">
                                <input
                                  type="text"
                                  value={member}
                                  onChange={(e) => {
                                    const updatedMembers = [...rule.members];
                                    updatedMembers[mIndex] = e.target.value;
                                    updateFactoryRule(index, 'members', updatedMembers);
                                  }}
                                  className="px-0 py-1.5 bg-transparent text-sm text-gray-800 font-semibold outline-none w-16"
                                  placeholder="姓名"
                                />
                                <button
                                  onClick={() => removeFactoryMember(index, mIndex)}
                                  className="p-1 text-gray-300 hover:text-red-500 transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-gray-300"
                                  disabled={rule.members.length <= 1}
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {/* 底部操作栏 */}
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between shrink-0">
              <span className="text-xs text-gray-400 font-medium">
                {rulesModalTab === 'leader' ? `共 ${leaderRules.length} 条组长规则` : `共 ${factoryRulesConfig.rules.length} 条工厂规则`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={rulesModalTab === 'leader' ? addLeaderRule : addFactoryRule}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-200 hover:bg-gray-100 text-gray-700 font-bold rounded-lg transition"
                >
                  <Plus size={16} />
                  添加规则
                </button>
                <button
                  onClick={saveAllRules}
                  className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white font-bold hover:bg-blue-700 rounded-lg transition"
                >
                  <Save size={16} />
                  保存全部
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 重置为默认规则确认弹窗 */}
      {showResetRulesConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !resettingRules && setShowResetRulesConfirm(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-[420px] max-w-[92vw] border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-amber-500 to-amber-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-lg">
                <AlertCircle size={20} />
                重置为默认规则
              </div>
              <button className="p-1 rounded hover:bg-white/20 transition" onClick={() => !resettingRules && setShowResetRulesConfirm(false)} disabled={resettingRules}>
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertCircle size={22} className="text-amber-500 shrink-0 mt-0.5" />
                <div className="text-sm text-gray-700 leading-relaxed">
                  <div className="font-bold text-amber-700 mb-1">此操作将覆盖当前规则</div>
                  <div>确定要将{rulesModalTab === 'leader' ? '组长规则' : '工厂规则'}重置为系统默认规则吗？当前已修改的规则内容将全部丢失。</div>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition disabled:opacity-50"
                onClick={() => setShowResetRulesConfirm(false)}
                disabled={resettingRules}
              >
                取消
              </button>
              <button
                className="px-5 py-2 rounded-lg bg-amber-600 text-white font-bold hover:bg-amber-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                onClick={resetCurrentTabRules}
                disabled={resettingRules}
              >
                {resettingRules && <RefreshCw size={14} className="animate-spin" />}
                {resettingRules ? '重置中...' : '确认重置'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StatusTracking;
