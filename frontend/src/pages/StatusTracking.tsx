import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
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
  Edit3,
  Trash2,
  UserPlus,
  Users,
  ChevronDown,
  Lock,
  Unlock,
  AlertTriangle,
  Download,
  RotateCcw,
  Calendar
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface StatusItem {
  id: string;
  factory: string;
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
}

interface LeaderRule {
  leader: string;
  members: string[];
}

interface EditingSession {
  itemId: string;
  userId: string;
  username: string;
  socketId: string;
}

const defaultSettings = { enabled: true, allowAdmins: true, allowViewers: false };

const defaultLeaderRules: LeaderRule[] = [
  { leader: '陈大仪', members: ['郭涛', '王兴龙', '王会永', '李广亮'] },
  { leader: '张啸', members: ['李守健', '邓明江', '贾银鑫', '熊飞'] },
  { leader: '张明', members: ['吴露鹭', '茅舒', '沈雨帆', '张晟隽', '刘知新', '梁科研', '吴方盛'] },
  { leader: '陈青松', members: ['张广奇', '李劲日', '曹圩圩', '许孟涵'] }
];

const factoryOptions = ['O/NJG', 'O/SHA'];

const getLeaderBySalesPerson = (salesPerson: string, rules: LeaderRule[]): string => {
  for (const rule of rules) {
    if (rule.members.includes(salesPerson)) {
      return rule.leader;
    }
  }
  return '';
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

const getItemPlanMonth = (item: StatusItem): string => {
  return getItemPlanMonths(item)[0] || '';
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

const formatPlanMonthsLabel = (item: StatusItem): string => {
  return getItemPlanMonths(item).join(', ') || '未设置';
};

const generateMonthOptions = (items: StatusItem[]) => {
  const monthSet = new Set<string>();
  
  items.forEach(item => {
    getItemPlanMonths(item).forEach(month => monthSet.add(month));
  });
  
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    monthSet.add(`${year}-${String(month).padStart(2, '0')}`);
  }
  
  const options = Array.from(monthSet).map(month => {
    return {
      value: month,
      label: formatMonthLabel(month)
    };
  });
  
  options.sort((a, b) => b.value.localeCompare(a.value));
  
  return options;
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

const StatusTracking = () => {
  const { user, token, logout } = useAuth();
  const [settings, setSettings] = useState(defaultSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [allItems, setAllItems] = useState<StatusItem[]>([]);
  const [fullTableSearch, setFullTableSearch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [planMonthEditorItemId, setPlanMonthEditorItemId] = useState<string | null>(null);
  const [specNumberInput, setSpecNumberInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [leaderRules, setLeaderRules] = useState<LeaderRule[]>(defaultLeaderRules);
  const [showLeaderRulesModal, setShowLeaderRulesModal] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [syncStatus, setSyncStatus] = useState<'connected' | 'disconnected'>('disconnected');
  const [monthFilterMode, setMonthFilterMode] = useState<'production' | 'delivery'>('production');
  const [currentMonth, setCurrentMonth] = useState(getCurrentMonthValue);
  const [deliveryMonth, setDeliveryMonth] = useState(getCurrentMonthValue);
  const [factoryFilter, setFactoryFilter] = useState<string>('');
  const [editingSessions, setEditingSessions] = useState<EditingSession[]>([]);
  const [offlineWarning, setOfflineWarning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dateInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const openDatePicker = useCallback((itemId: string) => {
    const input = dateInputRefs.current.get(itemId);
    if (input) {
      input.showPicker();
    }
  }, []);

  const isSuperAdmin = user?.role === 'superadmin';
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const isOffline = syncStatus === 'disconnected';
  const isRealtimeSyncAvailable = Boolean(token);
  const syncToneClass = !isRealtimeSyncAvailable
    ? 'bg-amber-100 text-amber-700'
    : syncStatus === 'connected'
      ? 'bg-green-100 text-green-700'
      : 'bg-red-100 text-red-700';
  const syncDotClass = !isRealtimeSyncAvailable
    ? 'bg-amber-500'
    : syncStatus === 'connected'
      ? 'bg-green-500'
      : 'bg-red-500';
  const syncBadgeText = !isRealtimeSyncAvailable
    ? '需手动刷新获取最新状态'
    : syncStatus === 'connected'
      ? '已同步'
      : '未同步';
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
      const res = await axios.get('/api/settings/status-tracking');
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
      const res = await axios.get('/api/settings/leader-rules');
      setLeaderRules(res.data);
    } catch (err) {
      console.error('Error fetching leader rules:', err);
    }
  }, []);

  const saveLeaderRules = async () => {
    if (!isAdmin) return;
    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      await axios.put('/api/settings/leader-rules', leaderRules, authHeader);
      addToast('组长规则已保存', 'success');
      setShowLeaderRulesModal(false);
    } catch (err) {
      console.error('Error saving leader rules:', err);
      addToast('保存组长规则失败', 'error');
    }
  };

  const resetLeaderRules = async () => {
    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      await axios.post('/api/settings/leader-rules/reset', {}, authHeader);
      setLeaderRules(defaultLeaderRules);
      addToast('组长规则已重置为默认', 'success');
    } catch (err) {
      console.error('Error resetting leader rules:', err);
      addToast('重置组长规则失败', 'error');
    }
  };

  const loadItems = useCallback(async () => {
    if (!token) {
      setAllItems([]);
      return;
    }

    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      const res = await axios.get('/api/status-tracking/items', authHeader);
      if (Array.isArray(res.data)) {
        setAllItems(res.data);
        localStorage.setItem('statusTrackingItems', JSON.stringify(res.data));
      }
    } catch (err) {
      console.error('Error loading status tracking items:', err);
      const saved = localStorage.getItem('statusTrackingItems');
      if (saved) {
        try {
          setAllItems(JSON.parse(saved));
        } catch (e) {
          console.error('Failed to parse saved items:', e);
        }
      }
    }
  }, [token]);

  const saveItems = useCallback((newItems: StatusItem[]) => {
    localStorage.setItem('statusTrackingItems', JSON.stringify(newItems));
    setAllItems(newItems);
  }, []);

  const createItemOnServer = useCallback(async (item: StatusItem) => {
    if (!token || !isAdmin) {
      throw new Error('Not authorized');
    }
    const authHeader = { headers: { Authorization: `Bearer ${token}` } };
    const res = await axios.post('/api/status-tracking/items', item, authHeader);
    return res.data as StatusItem;
  }, [token, isAdmin]);

  const updateItemOnServer = useCallback(async (item: StatusItem) => {
    if (!token || !isAdmin) {
      throw new Error('Not authorized');
    }
    const authHeader = { headers: { Authorization: `Bearer ${token}` } };
    const res = await axios.put(`/api/status-tracking/items/${item.id}`, item, authHeader);
    return res.data as StatusItem;
  }, [token, isAdmin]);

  const handlePersistError = useCallback((err: unknown) => {
    console.error('Error syncing item to server:', err);
    addToast('保存到服务器失败，已重新加载服务器数据', 'error');
    loadItems();
  }, [loadItems]);

  const addItem = useCallback(async () => {
    if (!isAdmin) {
      addToast('无权限添加记录', 'error');
      return;
    }
    if (!specNumberInput.trim()) {
      addToast('请输入仕样号', 'error');
      return;
    }

    const operationMonth = getCurrentMonthValue();
    const normalizedSpecNumber = specNumberInput.trim().toLowerCase();
    const existingItem = allItems.find(item => (
      item.specNumber.toLowerCase() === normalizedSpecNumber &&
      getItemPlanMonths(item).includes(operationMonth)
    ));
    if (existingItem) {
      addToast(`该仕样号 "${specNumberInput.trim()}" 已存在于${formatMonthLabel(operationMonth)}生产计划`, 'error');
      return;
    }

    setLoading(true);
    let specInfo: SpecInfoResponse | null = null;
    let fetchError = false;
    
    try {
      const authHeader = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
      const res = await axios.post('/api/spec/spec-info', { specNumber: specNumberInput.trim() }, { ...authHeader, timeout: 15000 });
      
      if (!res.data.success) {
        fetchError = true;
      } else {
        specInfo = res.data;
      }
    } catch (err: any) {
      fetchError = true;
    }

    try {
      const designDeliveryDays = specInfo?.deliveryDate ? calculateDesignDeliveryDays(specInfo.deliveryDate) : 0;
      const leader = specInfo?.salesPerson ? getLeaderBySalesPerson(specInfo.salesPerson, leaderRules) : '';

      const newItem: StatusItem = {
        id: Date.now().toString(),
        factory: 'O/NJG',
        clientName: specInfo?.clientName || '',
        specNumber: specInfo?.specNumber || specNumberInput.trim(),
        productionPlanMonth: operationMonth,
        productionPlanMonths: [operationMonth],
        quantity: specInfo?.quantity || '',
        deliveryDate: specInfo?.deliveryDate || '',
        designDeliveryDays,
        salesPerson: specInfo?.salesPerson || '',
        leader,
        shippedCount: 0,
        unconfirmedCount: 0,
        totalVarieties: 0,
        feedbackVarieties: 0,
        feedbackPlan: '',
        drawingPlanStatus: '',
        confirmedQuantity: 0,
        confirmedVarieties: 0,
        drawnVarieties: 0,
        undrawnVarieties: 0,
        undrawnQuantity: 0,
        unconfirmedQuantity: 0
      };

      const savedItem = await createItemOnServer(newItem);
      const updated = [...allItems, savedItem];
      saveItems(updated);

      if (fetchError) {
        addToast(`已添加记录，但未找到仕样号信息，请手动编辑客户、数量、纳期等字段`, 'success');
      } else {
        addToast('已添加新的状态跟踪记录', 'success');
      }

      if (operationMonth !== currentMonth) {
        setCurrentMonth(operationMonth);
      }

      setShowModal(false);
      setSpecNumberInput('');
    } catch (err: any) {
      addToast('添加记录失败: ' + (err.message || '未知错误'), 'error');
    } finally {
      setLoading(false);
    }
  }, [specNumberInput, allItems, token, saveItems, createItemOnServer, leaderRules, currentMonth]);

  const updateField = useCallback((id: string, field: keyof StatusItem, value: any) => {
    if (!isAdmin) {
      addToast('无权限编辑记录', 'error');
      return;
    }
    if (isOffline) {
      addToast('当前离线，禁止编辑', 'error');
      return;
    }
    if (field === 'productionPlanMonth' || field === 'productionPlanMonths') {
      const targetItem = allItems.find(item => item.id === id);
      const targetMonths = Array.isArray(value) ? value : [value];
      const duplicateItem = targetItem
        ? allItems.find(item => (
          item.id !== id &&
          item.specNumber.toLowerCase() === targetItem.specNumber.toLowerCase() &&
          getItemPlanMonths(item).some(month => targetMonths.includes(month))
        ))
        : null;
      if (duplicateItem) {
        addToast('该仕样号已存在于选择的生产计划月份', 'error');
        return;
      }
    }
    let updatedItem: StatusItem | null = null;
    const updated = allItems.map(item => {
      if (item.id === id) {
        updatedItem = { ...item, [field]: value };
        return updatedItem;
      }
      return item;
    });
    saveItems(updated);
    if (updatedItem) {
      updateItemOnServer(updatedItem).catch(handlePersistError);
    }
  }, [allItems, saveItems, updateItemOnServer, handlePersistError, isOffline, isAdmin]);

  const toggleProductionPlanMonth = useCallback((id: string, month: string) => {
    const targetItem = allItems.find(item => item.id === id);
    if (!targetItem) return;

    const currentMonths = getItemPlanMonths(targetItem);
    const nextMonths = currentMonths.includes(month)
      ? currentMonths.filter(itemMonth => itemMonth !== month)
      : [...currentMonths, month].sort();

    if (nextMonths.length === 0) {
      addToast('至少保留一个生产计划月份', 'error');
      return;
    }

    updateField(id, 'productionPlanMonths', nextMonths);
  }, [allItems, updateField]);

  const updateItem = useCallback((id: string, updates: Partial<StatusItem>) => {
    if (!isAdmin) {
      addToast('无权限编辑记录', 'error');
      return;
    }
    if (isOffline) {
      addToast('当前离线，禁止编辑', 'error');
      return;
    }
    let updatedItem: StatusItem | null = null;
    const updated = allItems.map(item => {
      if (item.id === id) {
        updatedItem = { ...item, ...updates };
        return updatedItem;
      }
      return item;
    });
    saveItems(updated);
    if (updatedItem) {
      updateItemOnServer(updatedItem).catch(handlePersistError);
    }
  }, [allItems, saveItems, updateItemOnServer, handlePersistError, isOffline, isAdmin]);

  const deleteItem = useCallback(async (id: string) => {
    if (!isAdmin) {
      addToast('无权限删除记录', 'error');
      return;
    }
    if (isOffline) {
      addToast('当前离线，禁止编辑', 'error');
      return;
    }
    const updated = allItems.filter(item => item.id !== id);
    saveItems(updated);
    
    if (!token) {
      addToast('删除服务器记录失败，已重新加载服务器数据', 'error');
      loadItems();
      return;
    }

    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      await axios.delete(`/api/status-tracking/items/${id}`, authHeader);
    } catch (err) {
      console.error('Error deleting item:', err);
      addToast('删除服务器记录失败，已重新加载服务器数据', 'error');
      loadItems();
      return;
    }
    
    addToast('记录已删除', 'success');
  }, [allItems, token, isAdmin, saveItems, isOffline, loadItems]);

  const updateItemInfo = useCallback(async (id: string) => {
    if (!isAdmin) {
      addToast('无权限更新记录', 'error');
      return;
    }
    if (isOffline) {
      addToast('当前离线，禁止编辑', 'error');
      return;
    }
    const item = allItems.find(i => i.id === id);
    if (!item || !item.specNumber) {
      addToast('无法更新，缺少仕样号', 'error');
      return;
    }

    setLoading(true);
    try {
      const authHeader = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
      const res = await axios.post('/api/spec/spec-info', { specNumber: item.specNumber }, { ...authHeader, timeout: 15000 });
      
      if (!res.data.success) {
        addToast(res.data.message || '获取仕样信息失败', 'error');
        return;
      }

      const specInfo: SpecInfoResponse = res.data;
      const designDeliveryDays = specInfo.deliveryDate ? calculateDesignDeliveryDays(specInfo.deliveryDate) : 0;
      const leader = specInfo.salesPerson ? getLeaderBySalesPerson(specInfo.salesPerson, leaderRules) : item.leader;

      let updatedItem: StatusItem | null = null;
      const updated = allItems.map(i => {
        if (i.id === id) {
          updatedItem = {
            ...i,
            clientName: specInfo.clientName || i.clientName,
            quantity: specInfo.quantity || i.quantity,
            deliveryDate: specInfo.deliveryDate || i.deliveryDate,
            designDeliveryDays,
            salesPerson: specInfo.salesPerson || i.salesPerson,
            leader
          };
          return updatedItem;
        }
        return i;
      });

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
      setLoading(false);
    }
  }, [allItems, token, saveItems, updateItemOnServer, leaderRules, isOffline, isAdmin]);

  const startEditing = useCallback((itemId: string) => {
    if (!isAdmin) {
      addToast('无权限编辑记录', 'error');
      return;
    }
    if (isOffline) {
      addToast('当前离线，禁止编辑', 'error');
      return;
    }
    if (!user || !socket) return;
    
    const existingSession = editingSessions.find(s => s.itemId === itemId);
    if (existingSession && existingSession.userId !== user.id) {
      addToast(`${existingSession.username}正在编辑此记录`, 'error');
      return;
    }

    socket.emit('status_tracking_start_edit', {
      itemId,
      userId: user.id,
      username: user.name || user.username || ''
    });
  }, [user, socket, editingSessions, isOffline, isAdmin]);

  const stopEditing = useCallback((itemId: string) => {
    if (!socket) return;
    socket.emit('status_tracking_stop_edit', { itemId });
  }, [socket]);

  const handleExport = useCallback(async () => {
    if (!token) return;
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (!fullTableSearch) {
        if (monthFilterMode === 'production') {
          params.append('month', currentMonth);
        } else {
          params.append('deliveryMonth', deliveryMonth);
        }
      }
      if (factoryFilter) {
        params.append('factory', factoryFilter);
      }
      if (searchTerm.trim()) {
        params.append('searchTerm', searchTerm.trim());
      }
      if (fullTableSearch) {
        params.append('fullTableSearch', 'true');
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
  }, [token, monthFilterMode, currentMonth, deliveryMonth, factoryFilter, searchTerm, fullTableSearch]);

  useEffect(() => {
    fetchSettings();
    fetchLeaderRules();
    loadItems();
  }, [fetchSettings, fetchLeaderRules, loadItems]);

  useEffect(() => {
    loadItems();
  }, [currentMonth, deliveryMonth]);

  useEffect(() => {
    const interval = setInterval(() => {
      setAllItems(prev => prev.map(item => ({
        ...item,
        designDeliveryDays: item.deliveryDate ? calculateDesignDeliveryDays(item.deliveryDate) : item.designDeliveryDays
      })));
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!token) {
      setSyncStatus('disconnected');
      setSocket(null);
      return;
    }

    const newSocket = io('/', {
      path: '/socket.io',
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 3000,
      reconnectionDelayMax: 10000,
      timeout: 10000,
      auth: { token }
    });
    
    newSocket.on('connect', () => {
      console.log('Socket connected');
      setSyncStatus('connected');
      setOfflineWarning(false);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    });

    newSocket.on('disconnect', () => {
      console.log('Socket disconnected');
      setSyncStatus('disconnected');
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        setOfflineWarning(true);
      }, 3000);
    });

    newSocket.on('connect_error', (err) => {
      console.log('Socket connect error:', err?.message);
      setSyncStatus('disconnected');
    });

    newSocket.on('session_invalidated', (data) => {
      console.log('Session invalidated:', data);
      addToast(`账号已在其他设备登录！\n时间: ${data.timestamp}\nIP: ${data.newLoginIp}\n设备: ${data.newLoginBrowser}`, 'error');
      setTimeout(() => {
        logout();
      }, 3000);
    });

    newSocket.on('status_tracking_updated', async (data) => {
      console.log('Status tracking updated:', data);
      if (data.action === 'add') {
        setAllItems(prev => {
          const exists = prev.find(i => i.id === data.item.id);
          if (exists) return prev;
          const next = [...prev, data.item];
          localStorage.setItem('statusTrackingItems', JSON.stringify(next));
          return next;
        });
      } else if (data.action === 'update') {
        setAllItems(prev => {
          const next = prev.map(i => i.id === data.item.id ? data.item : i);
          localStorage.setItem('statusTrackingItems', JSON.stringify(next));
          return next;
        });
      } else if (data.action === 'delete') {
        setAllItems(prev => {
          const next = prev.filter(i => i.id !== data.itemId);
          localStorage.setItem('statusTrackingItems', JSON.stringify(next));
          return next;
        });
      }
    });

    newSocket.on('status_tracking_bulk', async (dataItems) => {
      console.log('Status tracking bulk sync:', dataItems);
      setAllItems(dataItems);
      localStorage.setItem('statusTrackingItems', JSON.stringify(dataItems));
    });

    newSocket.on('status_tracking_edit_start', (data) => {
      console.log('Edit start:', data);
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

    newSocket.on('status_tracking_edit_stop', (data) => {
      console.log('Edit stop:', data);
      setEditingSessions(prev => prev.filter(s => s.itemId !== data.itemId));
    });

    setSocket(newSocket);

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      newSocket.disconnect();
    };
  }, [token, logout]);

  const filteredItems = useMemo(() => {
    let result = allItems;
    if (!fullTableSearch && monthFilterMode === 'production') {
      result = result.filter(item => {
        const planMonths = getItemPlanMonths(item);
        return planMonths.length === 0 || planMonths.includes(currentMonth);
      });
    }
    if (!fullTableSearch && monthFilterMode === 'delivery') {
      result = result.filter(item => !item.deliveryDate || item.deliveryDate.startsWith(deliveryMonth));
    }
    if (factoryFilter) {
      result = result.filter(item => item.factory === factoryFilter);
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
    return result;
  }, [allItems, searchTerm, factoryFilter, monthFilterMode, currentMonth, deliveryMonth, fullTableSearch]);

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

  if (loading || !settingsLoaded) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <RefreshCw className="animate-spin text-blue-600 mb-4" size={48} />
        <div className="text-gray-600 font-medium">正在加载数据...</div>
      </div>
    );
  }

  if (!canViewStatusTracking) {
    const isClosed = !settings.enabled;
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col">
        <header className="bg-white shadow-sm px-6 py-4 flex items-center justify-between border-b border-gray-200">
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col">

      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map(toast => (
          <div key={toast.id} className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-white transition-all duration-300 ${toast.type === 'error' ? 'bg-red-500' : 'bg-green-500'}`}>
            {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        ))}
      </div>

      <header className="sticky top-0 z-40 bg-white shadow-md px-6 py-4 flex items-center justify-between border-b border-gray-200">
        <div className="flex items-center space-x-4">
          <Link to="/" className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 font-bold transition">
            <ChevronLeft size={20} />
            <span>返回工作台</span>
          </Link>
          <div className="h-6 w-[1px] bg-gray-200 mx-2"></div>
          <h2 className="text-xl font-bold text-blue-600">状态跟踪表</h2>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${syncToneClass}`}>
            <span className={`w-2 h-2 rounded-full ${syncDotClass}`}></span>
            {syncBadgeText}
          </div>
          <div className="h-6 w-[1px] bg-gray-200 mx-2"></div>
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜索客户、仕样号、营业担当..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={fullTableSearch}
              onChange={(e) => setFullTableSearch(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <span className="ml-2 text-sm text-gray-600">全表搜索</span>
          </label>
        </div>

        <div className="flex-1 flex items-center pl-8">
          {isAdmin && (
            <button
              onClick={() => setShowModal(true)}
              className="px-6 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold rounded-full shadow-md hover:shadow-lg transition-all duration-200 text-base tracking-wide"
            >
              添加记录
            </button>
          )}
        </div>

        <div className="flex items-center space-x-4">
          {isAdmin && (
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white font-bold rounded-lg transition"
            >
              {exporting ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
              导出显示结果
            </button>
          )}
          <div className="relative">
            <select
              value={factoryFilter}
              onChange={(e) => setFactoryFilter(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              <option value="">全部工厂</option>
              {factoryOptions.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          <div className="flex items-center rounded-lg border border-gray-300 overflow-hidden">
            <button
              type="button"
              onClick={() => setMonthFilterMode('production')}
              className={`px-3 py-2 text-sm font-medium transition ${
                monthFilterMode === 'production'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              生产计划
            </button>
            <button
              type="button"
              onClick={() => setMonthFilterMode('delivery')}
              className={`px-3 py-2 text-sm font-medium border-l border-gray-300 transition ${
                monthFilterMode === 'delivery'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              纳期
            </button>
          </div>

          <div className="flex items-center space-x-1">
            <div className="relative">
              <select
                value={currentMonth}
                onChange={(e) => setCurrentMonth(e.target.value)}
                disabled={monthFilterMode !== 'production'}
                className="appearance-none pl-3 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
              >
                {generateMonthOptions(allItems).map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <ChevronDown size={16} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </div>

          <div className="flex items-center space-x-1">
            <div className="relative">
              <select
                value={deliveryMonth}
                onChange={(e) => setDeliveryMonth(e.target.value)}
                disabled={monthFilterMode !== 'delivery'}
                className="appearance-none pl-3 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
              >
                {generateDeliveryMonthOptions(allItems).map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <ChevronDown size={16} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {isAdmin && (
            <button
              onClick={() => setShowLeaderRulesModal(true)}
              className="flex items-center space-x-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-lg transition"
            >
              <Users size={18} />
              <span>组长规则</span>
            </button>
          )}

          {user && (
            <div className="flex items-center space-x-4">
              <div className="flex flex-col items-end">
                <span className="text-xs text-gray-400">当前用户</span>
                <span className="text-sm font-bold text-gray-700">{user.name}</span>
              </div>
              <button onClick={logout} className="flex items-center space-x-1.5 text-gray-600 hover:text-red-600 text-sm font-semibold transition">
                <LogOut size={18} />
                <span>退出</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 p-6 overflow-auto">
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          {offlineWarning && (
            <div className="bg-red-100 border-b border-red-200 px-4 py-2 flex items-center justify-center gap-2">
              <AlertTriangle size={18} className="text-red-600" />
              <span className="text-sm font-medium text-red-700">当前离线，禁止编辑！</span>
            </div>
          )}
          <div className="overflow-x-auto">
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
                <col style={{ width: '110px' }} />
                <col style={{ width: '130px' }} />
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
              <thead>
                <tr className="bg-gradient-to-r from-blue-600 to-blue-700 text-white">
                  <th className="px-2 py-1.5 text-center border-r border-white" rowSpan={2}>工厂</th>
                  <th className="px-2 py-1.5 text-center border-r border-white" rowSpan={2}>客户</th>
                  <th className="px-2 py-1.5 text-center border-r border-white" rowSpan={2}>
                    <VerticalHeader text="数量" />
                  </th>
                  <th className="px-2 py-1.5 text-center border-r border-white" rowSpan={2}>纳期</th>
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
                  <th className="px-2 py-1.5 text-center border-r border-white" rowSpan={2}>
                    <VerticalHeader text="未下种数" />
                  </th>
                  <th className="px-2 py-1.5 text-center border-r border-white" rowSpan={2}>
                    <VerticalHeader text="未下数量" />
                  </th>
                  <th className="px-2 py-1.5 text-center border-r border-white" rowSpan={2}>
                    <VerticalHeader text="未确认数" />
                  </th>
                  <th className="px-2 py-1.5 text-center border-r border-white" rowSpan={2}>
                    <VerticalHeader text="设计纳期" />
                  </th>
                  <th className="px-2 py-1.5 text-center border-r border-white" rowSpan={2}>营业担当</th>
                  <th className="px-2 py-1.5 text-center border-r border-white" rowSpan={2}>组长</th>
                  <th className="px-2 py-1.5 text-center" rowSpan={2}>操作</th>
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
                      <div className="text-lg font-medium">暂无状态跟踪记录</div>
                      <div className="text-sm mt-2">{isAdmin ? '点击上方"添加记录"按钮，输入仕样号开始跟踪' : '请联系管理员添加状态跟踪记录'}</div>
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item, index) => {
                    const editingSession = editingSessions.find(s => s.itemId === item.id);
                    const isEditing = editingSession && editingSession.userId === user?.id;
                    const isLocked = editingSession && editingSession.userId !== user?.id;

                    return (
                      <tr key={item.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
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
                            className="w-full text-center border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="px-1 py-2 border-b border-gray-200 text-center overflow-hidden">
                          <input
                            type="text"
                            value={item.unconfirmedCount || ''}
                            onChange={(e) => updateField(item.id, 'unconfirmedCount', parseInt(validateNumberInput(e.target.value)) || 0)}
                            disabled={isLocked || !isAdmin}
                            className="w-full text-center border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
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
                            disabled={isLocked || !isAdmin}
                            className="w-full text-center border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed truncate"
                            placeholder="反馈计划"
                          />
                        </td>
                        <td className="px-2 py-2 border-b border-gray-200 text-center overflow-hidden">
                          <input
                            type="text"
                            value={item.drawingPlanStatus}
                            onChange={(e) => updateField(item.id, 'drawingPlanStatus', e.target.value)}
                            disabled={isLocked || !isAdmin}
                            className="w-full text-center border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed truncate"
                            placeholder="下图计划及状态"
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
                        <td className="px-1 py-2 border-b border-gray-200 text-center overflow-hidden">
                          <input
                            type="text"
                            value={item.undrawnVarieties || ''}
                            onChange={(e) => updateField(item.id, 'undrawnVarieties', parseInt(validateNumberInput(e.target.value)) || 0)}
                            disabled={isLocked || !isAdmin}
                            className="w-full text-center border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="px-1 py-2 border-b border-gray-200 text-center overflow-hidden">
                          <input
                            type="text"
                            value={item.undrawnQuantity || ''}
                            onChange={(e) => updateField(item.id, 'undrawnQuantity', parseInt(validateNumberInput(e.target.value)) || 0)}
                            disabled={isLocked || !isAdmin}
                            className="w-full text-center border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="px-1 py-2 border-b border-gray-200 text-center overflow-hidden">
                          <input
                            type="text"
                            value={item.unconfirmedQuantity || ''}
                            onChange={(e) => updateField(item.id, 'unconfirmedQuantity', parseInt(validateNumberInput(e.target.value)) || 0)}
                            disabled={isLocked || !isAdmin}
                            className="w-full text-center border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className={`px-1 py-2 border-b border-gray-200 text-center font-bold overflow-hidden ${item.designDeliveryDays <= 7 ? 'text-red-700' : item.designDeliveryDays <= 14 ? 'text-yellow-700' : 'text-green-700'}`}>
                          <input
                            type="text"
                            value={item.designDeliveryDays || ''}
                            onChange={(e) => updateField(item.id, 'designDeliveryDays', parseInt(validateNumberInput(e.target.value)) || 0)}
                            disabled={isLocked || !isAdmin}
                            className="w-full text-center border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="px-2 py-2 border-b border-gray-200 text-center overflow-hidden">
                          <select
                            value={item.salesPerson}
                            onChange={(e) => {
                              updateItem(item.id, {
                                salesPerson: e.target.value,
                                leader: getLeaderBySalesPerson(e.target.value, leaderRules)
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
                                <span className="text-xs">{editingSession?.username}正在编辑</span>
                              </div>
                            ) : isAdmin ? (
                              <>
                                <button
                                  onClick={() => updateItemInfo(item.id)}
                                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition"
                                  title="更新信息"
                                >
                                  <RefreshCw size={16} />
                                </button>
                                <button
                                  onClick={() => setPlanMonthEditorItemId(item.id)}
                                  className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition"
                                  title={`生产计划月份: ${formatPlanMonthsLabel(item)}`}
                                  aria-label="修改生产计划月份"
                                >
                                  <Calendar size={16} />
                                </button>
                                <button
                                  onClick={() => deleteItem(item.id)}
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
        </div>

        {isSuperAdmin && (
          <div className="mt-6 bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
              <Shield className="mr-2 text-purple-600" size={22} />
              状态跟踪表查看权限设置
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { label: '启用状态跟踪表', detail: 'Global Toggle', key: 'enabled' as const },
                { label: '一般管理员', detail: 'Admin Access', key: 'allowAdmins' as const },
                { label: '普通用户', detail: 'User Access', key: 'allowViewers' as const }
              ].map(item => (
                <div key={item.key} className="flex items-center justify-between p-5 bg-gray-50 rounded-xl border border-gray-100">
                  <div>
                    <div className="font-bold text-gray-700">{item.label}</div>
                    <div className="text-[10px] text-gray-400 font-bold uppercase mt-0.5">{item.detail}</div>
                  </div>
                  <div className="relative inline-block w-12 h-6 align-middle select-none transition duration-200 ease-in">
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

      <footer className="bg-white border-t border-gray-200 px-6 py-3">
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

      {showModal && isAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-gray-800">添加状态跟踪记录</h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 transition"
              >
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">仕样号</label>
                <div className="relative">
                  <input
                    type="text"
                    value={specNumberInput}
                    onChange={(e) => setSpecNumberInput(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') addItem();
                    }}
                    placeholder="请输入仕样号，如：57048"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    autoFocus
                  />
                  {loading && (
                    <RefreshCw className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-blue-600" size={20} />
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-2">输入仕样号后，系统将自动从PDF文件中获取客户名、纳期、数量和营业担当信息</p>
              </div>
            </div>
            <div className="flex space-x-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold rounded-lg transition"
              >
                取消
              </button>
              <button
                onClick={addItem}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition disabled:opacity-50"
              >
                {loading ? '获取中...' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}

      {planMonthEditorItemId && isAdmin && (() => {
        const editingItem = allItems.find(item => item.id === planMonthEditorItemId);
        if (!editingItem) return null;
        const selectedMonths = getItemPlanMonths(editingItem);
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold text-gray-800">生产计划月份</h3>
                <button
                  onClick={() => setPlanMonthEditorItemId(null)}
                  className="p-1 text-gray-400 hover:text-gray-600 transition"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="mb-4 text-sm text-gray-500 truncate" title={editingItem.clientName}>
                {editingItem.clientName || '未填写客户'}
              </div>
              <div className="grid grid-cols-3 gap-2 max-h-72 overflow-auto">
                {generateMonthOptions(allItems).map(option => {
                  const checked = selectedMonths.includes(option.value);
                  return (
                    <label
                      key={option.value}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition ${
                        checked
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-gray-200 hover:border-gray-300 text-gray-600'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleProductionPlanMonth(editingItem.id, option.value)}
                        className="w-4 h-4 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500"
                      />
                      <span>{option.value}</span>
                    </label>
                  );
                })}
              </div>
              <div className="flex justify-end mt-6">
                <button
                  onClick={() => setPlanMonthEditorItemId(null)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition"
                >
                  完成
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showLeaderRulesModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-4xl mx-4 max-h-[85vh] overflow-auto">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-bold text-gray-800">组长规则配置</h3>
                <button
                  onClick={resetLeaderRules}
                  disabled={!isSuperAdmin}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed bg-gray-100 text-gray-600 hover:bg-gray-200"
                  title={isSuperAdmin ? '重置为默认规则' : '仅超级管理员可重置'}
                >
                  <RotateCcw size={12} />
                  重置为默认规则
                </button>
              </div>
              <button
                onClick={() => setShowLeaderRulesModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 transition"
              >
                <X size={20} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {leaderRules.map((rule, index) => (
                <div key={index} className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Edit3 size={16} className="text-gray-400" />
                      <span className="text-sm font-medium text-gray-500">规则 {index + 1}</span>
                    </div>
                    <button
                      onClick={() => removeLeaderRule(index)}
                      className="p-1 text-gray-400 hover:text-red-600 transition"
                      disabled={leaderRules.length <= 1}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="mb-3">
                    <label className="block text-xs font-bold text-gray-500 mb-1">组长姓名</label>
                    <input
                      type="text"
                      value={rule.leader}
                      onChange={(e) => updateLeaderRule(index, 'leader', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="输入组长姓名"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-bold text-gray-500">营业担当成员</label>
                      <button
                        onClick={() => addMember(index)}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
                      >
                        <UserPlus size={12} />
                        添加成员
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {rule.members.map((member, mIndex) => (
                        <div key={mIndex} className="flex items-center gap-1">
                          <input
                            type="text"
                            value={member}
                            onChange={(e) => {
                              const updatedMembers = [...rule.members];
                              updatedMembers[mIndex] = e.target.value;
                              updateLeaderRule(index, 'members', updatedMembers);
                            }}
                            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-20"
                            placeholder="姓名"
                          />
                          <button
                            onClick={() => removeMember(index, mIndex)}
                            className="p-1 text-gray-400 hover:text-red-600 transition"
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
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={addLeaderRule}
                className="flex items-center gap-2 px-5 py-2.5 border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold rounded-lg transition"
              >
                <Plus size={16} />
                添加规则
              </button>
              <button
                onClick={saveLeaderRules}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition"
              >
                <Save size={16} />
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StatusTracking;
