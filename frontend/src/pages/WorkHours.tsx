import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { format, isWeekend } from 'date-fns';
import {
  AlertCircle,
  BarChart2,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Clock,
  Download,
  LogOut,
  RefreshCw,
  Shield,
  Users
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { axiosInstance } from '../services/api';
import LoadingScreen from '../components/LoadingScreen';
import { getEffectiveIsWeekend, normalizeWorkdayOverrides, WorkdayOverrides } from '../utils/workdayOverrides';

interface DesignerData {
  id: string;
  name: string;
}

interface WorkHoursData {
  designerId: string;
  designerName: string;
  hours: number;
  workdayHours: number;
  designHours: number;
  workdayDesignHours: number;
  tripHours: number;
  workdayTripHours: number;
  sickDays: number;
  vacationDays: number;
  illnessDays: number;
  leaveDetails: LeaveDetail[];
  tripDetails: TripDetail[];
}

interface LeaveDetail {
  date: string;
  type: 'sick' | 'vacation' | 'illness';
  typeLabel: string;
  hours: number;
}

interface TripDetail {
  date: string;
  taskName: string;
  hours: number;
  isWeekend: boolean;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
  id: number;
}

const defaultSettings = { enabled: true, allowAdmins: true, allowViewers: false };

// 两张榜单各用一套语义色：工时=蓝、请假=玫红。
// 前三名只在数值大于 0 时才高亮，避免「全员 0 小时却挂金牌」的荒谬观感。
const ACCENT_STYLES = {
  blue: {
    value: 'text-blue-700',
    first: 'bg-blue-600 text-white',
    second: 'bg-blue-100 text-blue-700',
    third: 'bg-blue-50 text-blue-600',
    switchOn: 'peer-checked:bg-blue-500'
  },
  rose: {
    value: 'text-rose-600',
    first: 'bg-rose-500 text-white',
    second: 'bg-rose-100 text-rose-600',
    third: 'bg-rose-50 text-rose-500',
    switchOn: 'peer-checked:bg-rose-500'
  }
} as const;


const WorkHours = () => {
  const { user, token, logout } = useAuth();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [designers, setDesigners] = useState<DesignerData[]>([]);
  const [workHoursData, setWorkHoursData] = useState<WorkHoursData[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settings, setSettings] = useState(defaultSettings);
  const workdayOverridesRef = useRef<WorkdayOverrides>({});
  const [showAllHours, setShowAllHours] = useState(false);
  const [showAllLeave, setShowAllLeave] = useState(false);
  // 名单在卡片内独立滚动：收起时要把滚动位置一并归零，否则会停在列表中途
  const hoursListRef = useRef<HTMLDivElement>(null);
  const leaveListRef = useRef<HTMLDivElement>(null);
  const toggleAllHours = () => {
    if (showAllHours && hoursListRef.current) hoursListRef.current.scrollTop = 0;
    setShowAllHours(prev => !prev);
  };
  const toggleAllLeave = () => {
    if (showAllLeave && leaveListRef.current) leaveListRef.current.scrollTop = 0;
    setShowAllLeave(prev => !prev);
  };
  const [excludeWeekendOvertime, setExcludeWeekendOvertime] = useState(false);
  const [excludeVacationLeave, setExcludeVacationLeave] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [exporting, setExporting] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  // 悬停明细改为「视口定位浮层」：列表在卡片内独立滚动，浮层若留在列表里会被滚动容器裁掉
  const [tip, setTip] = useState<{ kind: 'hours' | 'leave'; item: WorkHoursData; top: number; left: number; width: number } | null>(null);

  const openTip = useCallback((kind: 'hours' | 'leave', item: WorkHoursData, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    // 优先落在列表可视区内：下方放不下就向上翻，避免浮层压到卡片外
    const box = el.closest('[data-list]')?.getBoundingClientRect();
    const width = kind === 'hours' ? 320 : 288;
    const estimate = kind === 'hours' ? 320 : 290;
    const left = Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12);
    const bottomLimit = Math.min((box ? box.bottom : window.innerHeight) - 8, window.innerHeight - 12);
    let top = rect.bottom + 8;
    if (top + estimate > bottomLimit) {
      top = Math.max(12, Math.min(rect.top - estimate - 8, bottomLimit - estimate));
    }
    setTip({ kind, item, top, left, width });
  }, []);

  const isOffline = !isOnline;
  const isSuperAdmin = user?.role === 'superadmin';
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const authHeader = useMemo(() => token ? { headers: { Authorization: `Bearer ${token}` } } : {}, [token]);

  const addToast = (message: string, type: 'success' | 'error') => {
    const id = Date.now();
    setToasts(prev => [...prev, { message, type, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  // 网络错误（断网/服务不可达）时标记离线，触发页面禁止编辑
  const markOfflineIfNetworkError = useCallback((err: any) => {
    if (!navigator.onLine || err?.code === 'ERR_NETWORK' || err?.message === 'Network Error') {
      setIsOnline(false);
      return true;
    }
    return false;
  }, []);

  const canViewWorkHours = useMemo(() => {
    if (isSuperAdmin) return true;
    if (!settings.enabled) return false;
    if (!user) return false;
    if (user.role === 'admin' && settings.allowAdmins) return true;
    if (user.role === 'user' && settings.allowViewers) return true;
    return false;
  }, [isSuperAdmin, settings, user]);

  const fetchSettings = useCallback(async () => {
    try {
      // 走 axiosInstance 自动携带 Authorization，接口需登录访问
      const res = await axiosInstance.get('/settings/work-hours');
      setSettings(res.data);
    } catch (err) {
      console.error('Error fetching work hours settings:', err);
      markOfflineIfNetworkError(err);
      addToast('无法加载工时管理权限设置', 'error');
    } finally {
      setSettingsLoaded(true);
    }
  }, [markOfflineIfNetworkError]);

  const fetchWorkdayOverrides = useCallback(async (showError = true): Promise<WorkdayOverrides> => {
    try {
      const res = await axiosInstance.get('/settings/workday-overrides');
      const normalized = normalizeWorkdayOverrides(res.data);
      workdayOverridesRef.current = normalized;
      return normalized;
    } catch (err) {
      console.error('Error fetching workday overrides:', err);
      markOfflineIfNetworkError(err);
      if (showError) addToast('无法加载工作日设置', 'error');
      return workdayOverridesRef.current;
    }
  }, [markOfflineIfNetworkError]);

  const updateSettings = async (next: Partial<typeof settings>) => {
    if (isOffline) {
      addToast('当前离线，禁止编辑', 'error');
      return;
    }
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
      await axios.put('/api/settings/work-hours', updated, authHeader);
      addToast('权限设置已保存', 'success');
    } catch (err) {
      console.error('Error saving work hours settings:', err);
      addToast('保存工时管理权限设置失败', 'error');
    }
  };

  const fetchDesigners = useCallback(async () => {
    try {
      const res = await axios.get('/api/designers', authHeader);
      setDesigners(res.data);
    } catch (err) {
      console.error('Error fetching designers:', err);
      markOfflineIfNetworkError(err);
      addToast('无法加载人员数据', 'error');
    } finally {
      setLoading(false);
    }
  }, [authHeader, markOfflineIfNetworkError]);

  const fetchWorkHoursData = useCallback(async () => {
    if (designers.length === 0 || isOffline) return;
    setDataLoading(true);
    try {
      const activeWorkdayOverrides = await fetchWorkdayOverrides(false);
      const month = currentDate.getMonth() + 1;
      const year = currentDate.getFullYear();
      const res = await axios.get(`/api/tasks?month=${month}&year=${year}`, authHeader);
      const tasks = res.data;
      const dataMap = new Map<string, WorkHoursData>();

      designers.forEach(designer => {
        dataMap.set(designer.id, {
          designerId: designer.id,
          designerName: designer.name,
          hours: 0,
          workdayHours: 0,
          designHours: 0,
          workdayDesignHours: 0,
          tripHours: 0,
          workdayTripHours: 0,
          sickDays: 0,
          vacationDays: 0,
          illnessDays: 0,
          leaveDetails: [],
          tripDetails: []
        });
      });

      tasks.forEach((sheet: any) => {
        const designerData = dataMap.get(sheet.designerId);
        if (!designerData) return;

        (Object.entries(sheet.days || {}) as [string, any[]][]).forEach(([date, items]) => {
          items.forEach((item: any) => {
            // 「暂停/取消」任务工时默认 0，手动赋值后与普通任务一样计入统计
            const itemHours = typeof item.hours === 'number' ? item.hours : (parseFloat(item.hours) || 0);
            const isWeekendDate = getEffectiveIsWeekend(date, isWeekend(new Date(`${date}T00:00:00`)), activeWorkdayOverrides);
            if (item.leaveType === 'sick') {
              designerData.sickDays += itemHours;
              designerData.leaveDetails.push({ date, type: 'sick', typeLabel: '事假', hours: itemHours });
              return;
            }
            if (item.leaveType === 'vacation') {
              designerData.vacationDays += itemHours;
              designerData.leaveDetails.push({ date, type: 'vacation', typeLabel: '休假', hours: itemHours });
              return;
            }
            if (item.leaveType === 'illness') {
              designerData.illnessDays += itemHours;
              designerData.leaveDetails.push({ date, type: 'illness', typeLabel: '病假', hours: itemHours });
              return;
            }

            const gunsHours = (item.guns || []).reduce((sum: number, gun: any) => {
              return sum + (typeof gun.hours === 'number' ? gun.hours : (parseFloat(gun.hours) || 0));
            }, 0);
            const taskHours = item.guns && item.guns.length > 0 ? gunsHours : itemHours;
            designerData.hours += taskHours;
            if (!isWeekendDate) {
              designerData.workdayHours += taskHours;
            }
            if (item.leaveType === 'trip') {
              designerData.tripHours += taskHours;
              if (!isWeekendDate) {
                designerData.workdayTripHours += taskHours;
              }
              designerData.tripDetails.push({
                date,
                taskName: item.taskName || '出差',
                hours: taskHours,
                isWeekend: isWeekendDate
              });
              return;
            }

            designerData.designHours += taskHours;
            if (!isWeekendDate) {
              designerData.workdayDesignHours += taskHours;
            }
          });
        });
      });

      setWorkHoursData(Array.from(dataMap.values()).sort((a, b) => b.hours - a.hours));
    } catch (err) {
      console.error('Error fetching work hours data:', err);
      markOfflineIfNetworkError(err);
      addToast('无法加载工时管理数据', 'error');
    } finally {
      setDataLoading(false);
    }
  }, [authHeader, currentDate, designers, fetchWorkdayOverrides, markOfflineIfNetworkError, isOffline]);

  useEffect(() => {
    fetchSettings();
    fetchWorkdayOverrides();
    fetchDesigners();
  }, [fetchDesigners, fetchSettings, fetchWorkdayOverrides]);

  // 网络恢复后自动重新加载数据
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      fetchSettings();
      fetchDesigners();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [fetchSettings, fetchDesigners]);

  // 后端服务停止/恢复（navigator.onLine 感知不到本机服务停止，由 axiosInstance 拦截器广播）
  useEffect(() => {
    const handleServerUnreachable = () => setIsOnline(false);
    const handleServerOnline = () => {
      setIsOnline(true);
      fetchSettings();
      fetchDesigners();
    };
    window.addEventListener('server-unreachable', handleServerUnreachable);
    window.addEventListener('server-online', handleServerOnline);
    return () => {
      window.removeEventListener('server-unreachable', handleServerUnreachable);
      window.removeEventListener('server-online', handleServerOnline);
    };
  }, [fetchSettings, fetchDesigners]);

  // 离线期间每 5 秒轻量探测后端是否恢复（成功时拦截器自动广播 server-online）
  useEffect(() => {
    if (!isOffline) return;
    const timer = setInterval(() => {
      axiosInstance.get('/auth/validate').catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [isOffline]);

  useEffect(() => {
    if (!loading && canViewWorkHours) fetchWorkHoursData();
  }, [loading, canViewWorkHours, fetchWorkHoursData]);

  // 导出当前月份工时管理表（与系统设置页一致，月份由当前页面决定）
  const handleWorkHoursExport = async () => {
    if (!token) return;
    const month = format(currentDate, 'yyyy-MM');
    setExporting(true);
    try {
      const res = await axios.get(`/api/work-hours/export?month=${month}`, {
        ...authHeader,
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `work-hours-${month}-${format(new Date(), 'yyyyMMddHHmmss')}.xls`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      addToast('导出成功', 'success');
    } catch (err: any) {
      markOfflineIfNetworkError(err);
      if (err.response?.status === 404) {
        addToast('没有可导出的数据', 'error');
      } else {
        addToast('导出失败', 'error');
      }
    } finally {
      setExporting(false);
    }
  };

  const getDisplayedWorkHours = useCallback(
    (item: WorkHoursData) => excludeWeekendOvertime ? item.workdayHours : item.hours,
    [excludeWeekendOvertime]
  );

  const getDisplayedLeaveHours = useCallback(
    (item: WorkHoursData) => item.sickDays + item.illnessDays + (excludeVacationLeave ? 0 : item.vacationDays),
    [excludeVacationLeave]
  );

  const getDisplayedDesignHours = useCallback(
    (item: WorkHoursData) => excludeWeekendOvertime ? item.workdayDesignHours : item.designHours,
    [excludeWeekendOvertime]
  );

  const getDisplayedTripHours = useCallback(
    (item: WorkHoursData) => excludeWeekendOvertime ? item.workdayTripHours : item.tripHours,
    [excludeWeekendOvertime]
  );

  const getDisplayedTripDetails = useCallback(
    (item: WorkHoursData) => excludeWeekendOvertime ? item.tripDetails.filter(detail => !detail.isWeekend) : item.tripDetails,
    [excludeWeekendOvertime]
  );

  const getWeekendOvertimeHours = useCallback(
    (item: WorkHoursData) => Math.max(0, item.hours - item.workdayHours),
    []
  );

  const sortedByHours = useMemo(
    () => [...workHoursData].sort((a, b) => getDisplayedWorkHours(b) - getDisplayedWorkHours(a)),
    [getDisplayedWorkHours, workHoursData]
  );

  const sortedByLeave = useMemo(
    () => [...workHoursData].sort((a, b) => getDisplayedLeaveHours(b) - getDisplayedLeaveHours(a)),
    [getDisplayedLeaveHours, workHoursData]
  );

  // 卡片副标题用的汇总值 / 进度条用的基准值（进度条按榜首归一，视觉上更有可比性）
  const totalWorkHours = useMemo(
    () => sortedByHours.reduce((sum, item) => sum + getDisplayedWorkHours(item), 0),
    [sortedByHours, getDisplayedWorkHours]
  );

  const maxWorkHours = useMemo(
    () => Math.max(1, ...sortedByHours.map(getDisplayedWorkHours)),
    [sortedByHours, getDisplayedWorkHours]
  );

  const maxLeaveHours = useMemo(
    () => Math.max(1, ...sortedByLeave.map(getDisplayedLeaveHours)),
    [sortedByLeave, getDisplayedLeaveHours]
  );

  // 全员为 0 时不渲染十行「0.0」，直接给空态，避免毫无信息量的名单占满半屏
  const hasAnyLeave = useMemo(
    () => sortedByLeave.some(item => getDisplayedLeaveHours(item) > 0),
    [sortedByLeave, getDisplayedLeaveHours]
  );

  // 名次徽章：固定方形底座 + 等宽数字，保证左右两列在任意人名长度下都严格对齐
  const renderRank = (index: number, accent: keyof typeof ACCENT_STYLES, value: number) => {
    const styles = ACCENT_STYLES[accent];
    const highlighted = value > 0 && index < 3;
    const colorClass = highlighted
      ? (index === 0 ? styles.first : index === 1 ? styles.second : styles.third)
      : 'bg-slate-100/70 text-slate-400';
    return (
      <span className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums ${colorClass}`}>
        {index + 1}
      </span>
    );
  };

  const getLeaveTypeClass = (type: LeaveDetail['type']) => {
    if (type === 'sick') return 'bg-red-50 text-red-600 border-red-100';
    if (type === 'vacation') return 'bg-blue-50 text-blue-600 border-blue-100';
    return 'bg-pink-50 text-pink-600 border-pink-100';
  };

  if (loading || !settingsLoaded) {
    return <LoadingScreen skeleton="workhours" />;
  }

  if (!canViewWorkHours) {
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
            <BarChart2 size={64} className="mx-auto text-gray-300 mb-4" />
            <h2 className="text-xl font-bold text-gray-600">{isClosed ? '工时管理已关闭' : '暂无权限访问工时管理'}</h2>
            <p className="text-gray-400 mt-2">
              {isClosed ? '请联系超级管理员开启此功能' : '请联系超级管理员开启对应权限'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (designers.length === 0) {
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
          <div className="text-center max-w-md px-6">
            <Users size={64} className="mx-auto text-gray-300 mb-4" />
            <h2 className="text-xl font-bold text-gray-600">暂无设计人员</h2>
            <p className="text-gray-400 mt-2">工时管理需要设计人员数据才能使用，请先在管理后台添加设计人员。</p>
            {isAdmin && (
              <Link to="/admin" className="inline-block mt-6 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition">
                前往添加设计人员
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col overflow-hidden">
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map(toast => (
          <div key={toast.id} className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-white transition-all duration-300 ${toast.type === 'error' ? 'bg-red-500' : 'bg-green-500'}`}>
            {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        ))}
      </div>

      {/* 悬停明细浮层：固定定位到视口，脱离卡片内部滚动容器，不会被裁切也不会压住卡头 */}
      {tip && (
        <div
          className="pointer-events-none fixed z-[60] max-h-[80vh] overflow-auto rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
          style={{ top: tip.top, left: tip.left, width: tip.width }}
        >
          {tip.kind === 'hours' ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-black text-slate-800">{tip.item.designerName} 工时明细</span>
                <span className="text-xs font-bold text-slate-400">{getDisplayedWorkHours(tip.item).toFixed(1)}h</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                  <div className="text-[10px] font-black text-blue-500">设计计划总工时</div>
                  <div className="mt-1 text-lg font-black text-blue-700">{getDisplayedDesignHours(tip.item).toFixed(1)}h</div>
                </div>
                <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2">
                  <div className="text-[10px] font-black text-teal-600">出差总工时</div>
                  <div className="mt-1 text-lg font-black text-teal-800">{getDisplayedTripHours(tip.item).toFixed(1)}h</div>
                </div>
              </div>
              <div className="mt-3">
                <div className="mb-2 text-xs font-black text-slate-700">出差明细</div>
                {getDisplayedTripDetails(tip.item).length > 0 ? (
                  <div className="max-h-56 space-y-2 overflow-auto pr-1">
                    {[...getDisplayedTripDetails(tip.item)]
                      .sort((a, b) => a.date.localeCompare(b.date))
                      .map((detail, detailIndex) => (
                        <div key={`${tip.item.designerId}-trip-${detail.date}-${detailIndex}`} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">
                          <span className="w-24 text-xs font-bold text-slate-600">{detail.date}</span>
                          <span className="min-w-0 flex-1 truncate text-xs font-bold text-teal-700">{detail.taskName}</span>
                          <span className="text-xs font-black text-slate-700">{detail.hours.toFixed(1)}h</span>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="rounded-lg bg-slate-50 px-3 py-2 text-center text-xs font-bold text-slate-400">
                    暂无出差明细
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-black text-slate-800">{tip.item.designerName} 请假明细</span>
                <span className="text-xs font-bold text-slate-400">{getDisplayedLeaveHours(tip.item).toFixed(1)}h</span>
              </div>
              {(excludeVacationLeave
                ? tip.item.leaveDetails.filter(detail => detail.type !== 'vacation')
                : tip.item.leaveDetails
              ).length > 0 ? (
                <div className="max-h-64 space-y-2 overflow-auto pr-1">
                  {[...(excludeVacationLeave
                    ? tip.item.leaveDetails.filter(detail => detail.type !== 'vacation')
                    : tip.item.leaveDetails)]
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((detail, detailIndex) => (
                      <div key={`${tip.item.designerId}-${detail.date}-${detail.type}-${detailIndex}`} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">
                        <span className="w-24 text-xs font-bold text-slate-600">{detail.date}</span>
                        <span className={`rounded border px-2 py-0.5 text-[10px] font-black ${getLeaveTypeClass(detail.type)}`}>
                          {detail.typeLabel}
                        </span>
                        <span className="ml-auto text-xs font-black text-slate-700">{detail.hours.toFixed(1)}h</span>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-center text-xs font-bold text-slate-400">
                  暂无请假明细
                </div>
              )}
            </>
          )}
        </div>
      )}

      <header className="sticky top-0 z-40 bg-white shadow-md px-6 py-2 h-12 flex items-center justify-between border-b border-gray-200">
        <div className="flex items-center space-x-4">
          <Link to="/" className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 font-bold transition">
            <ChevronLeft size={20} />
            <span>返回工作台</span>
          </Link>
          <div className="h-6 w-[1px] bg-gray-200 mx-2"></div>
          <h2 className="text-xl font-bold text-blue-600 flex items-center">
            <Clock className="text-blue-500 mr-2" size={24} />
            工时管理
          </h2>
          {isAdmin && (
            <button
              onClick={handleWorkHoursExport}
              disabled={exporting || isOffline}
              className="flex items-center gap-2 px-4 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition"
              title={`导出 ${format(currentDate, 'yyyy年MM月')} 工时管理表`}
            >
              {exporting ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
              导出显示结果
            </button>
          )}
        </div>

        <div className={`flex items-center space-x-4 ${isOffline ? 'offline-locked' : ''}`}>
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            <button
              disabled={isOffline}
              onClick={() => setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
              className="p-1 hover:bg-white rounded-lg transition shadow-sm"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="relative px-6 font-bold text-gray-700 min-w-[140px] text-center cursor-pointer hover:bg-white rounded transition">
              {format(currentDate, 'yyyy年 MM月')}
              <input
                type="month"
                className="delivery-date-input"
                disabled={isOffline}
                value={format(currentDate, 'yyyy-MM')}
                onChange={(e) => {
                  if (e.target.value) {
                    const [y, m] = e.target.value.split('-').map(Number);
                    setCurrentDate(new Date(y, m - 1, 1));
                  }
                }}
              />
            </span>
            <button
              disabled={isOffline}
              onClick={() => setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
              className="p-1 hover:bg-white rounded-lg transition shadow-sm"
            >
              <ChevronLeft size={18} className="rotate-180" />
            </button>
          </div>
          <button
            disabled={isOffline}
            onClick={fetchWorkHoursData}
            className="p-2 bg-blue-50 hover:bg-blue-100 rounded-lg transition"
            title="刷新数据"
          >
            <RefreshCw size={18} className="text-blue-600" />
          </button>
        </div>

        {user && (
          <div className="flex items-center space-x-4">
            <span className="text-sm font-bold text-red-600">{user.name}</span>
            <button onClick={logout} className="flex items-center space-x-1.5 text-gray-600 hover:text-red-600 text-sm font-semibold transition">
              <LogOut size={18} />
              <span>退出</span>
            </button>
          </div>
        )}
      </header>

      {isOffline && (
        <div className="relative z-40 shrink-0 bg-amber-500 text-white px-4 py-2 flex items-center justify-center gap-2 text-xs font-medium border-b border-amber-600 shadow-sm">
          <AlertCircle size={14} className="shrink-0" />
          <span>当前处于离线模式，网络恢复后将自动加载最新数据，此页面禁止编辑！</span>
        </div>
      )}

      <main className={`flex-1 w-full overflow-y-auto ${isOffline ? 'offline-locked' : ''}`}>
        <div className="mx-auto w-full max-w-7xl px-6 py-6 lg:px-8">
          {dataLoading ? (
            <div className="flex items-center justify-center py-20">
              <RefreshCw className="animate-spin text-blue-600" size={36} />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-6">
              {/* ==================== 月度工时统计 ==================== */}
              <section className="flex max-h-[calc(100vh_-_13.5rem)] flex-col rounded-2xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/40">
                {/* 卡头固定在卡片顶部（不吸顶覆盖内容）：名单在卡头下方的独立滚动区里滚动，人名永远不会被压住 */}
                <div className="flex shrink-0 items-center justify-between gap-3 rounded-t-2xl border-b border-slate-100 bg-slate-50 px-5 py-3.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600/10 text-blue-600">
                      <Clock size={17} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-[15px] font-bold text-slate-800">月度工时统计</h2>
                      <p className="mt-0.5 truncate text-[11px] font-medium text-slate-400">
                        共 {workHoursData.length} 人 · 合计 {totalWorkHours.toFixed(1)}h
                        {showAllHours && workHoursData.length > 10 ? ' · 已展开' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    {workHoursData.length > 10 && (
                      <button
                        type="button"
                        onClick={toggleAllHours}
                        disabled={isOffline}
                        title={showAllHours ? '收起列表，仅保留前 10 名' : `展开全部 ${workHoursData.length} 人`}
                        className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white/90 px-1.5 py-1 text-[11px] font-bold text-slate-500 shadow-sm transition hover:border-blue-200 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {showAllHours ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        {showAllHours ? '收起' : '展开'}
                      </button>
                    )}
                    <label className="flex shrink-0 cursor-pointer select-none items-center gap-2 text-[11px] font-semibold text-slate-500">
                      不含周末加班
                      <span className="relative inline-flex h-4 w-7 items-center">
                        <input
                          type="checkbox"
                          checked={excludeWeekendOvertime}
                          onChange={(e) => setExcludeWeekendOvertime(e.target.checked)}
                          disabled={isOffline}
                          className="peer sr-only"
                        />
                        <span className={`absolute inset-0 rounded-full bg-slate-300 transition ${ACCENT_STYLES.blue.switchOn}`}></span>
                        <span className="absolute left-0.5 h-3 w-3 rounded-full bg-white shadow transition peer-checked:translate-x-3"></span>
                      </span>
                    </label>
                  </div>
                </div>

                <div className="min-h-0 flex-1 snap-y snap-mandatory overflow-y-auto px-2.5 py-2" data-list ref={hoursListRef} onScroll={() => setTip(null)}>
                  {sortedByHours.length === 0 && (
                    <div className="py-10 text-center text-xs font-medium text-slate-400">本月暂无工时记录</div>
                  )}
                  {(showAllHours ? sortedByHours : sortedByHours.slice(0, 10)).map((item, index) => {
                    const value = getDisplayedWorkHours(item);
                    const weekendHours = getWeekendOvertimeHours(item);
                    return (
                      <div
                        key={item.designerId}
                        className="relative flex min-h-[54px] snap-start items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-slate-100/60"
                        onMouseEnter={(e) => openTip('hours', item, e.currentTarget)}
                        onMouseLeave={() => setTip(null)}
                      >
                        {/* 占比底纹：从左侧铺开的极淡色块，替代独立进度条，避免每行被横线切割 */}
                        <span
                          className="pointer-events-none absolute inset-y-1 left-0 rounded-lg bg-blue-500/[0.09]"
                          style={{ width: `${value > 0 ? Math.max(5, (value / maxWorkHours) * 100) : 0}%` }}
                        />
                        {renderRank(index, 'blue', value)}

                        <div className="relative min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="truncate text-[13px] font-bold text-slate-800">{item.designerName}</span>
                            <span className="flex w-14 shrink-0 items-baseline justify-end tabular-nums">
                              <span className={`text-[17px] font-black leading-none ${value > 0 ? ACCENT_STYLES.blue.value : 'text-slate-300'}`}>
                                {value.toFixed(1)}
                              </span>
                              <span className="ml-0.5 text-[10px] font-semibold text-slate-400">h</span>
                            </span>
                          </div>

                          {weekendHours > 0 && (
                            <div className="mt-0.5 flex flex-wrap items-center gap-1">
                              <span className="rounded bg-amber-100/70 px-1.5 py-0.5 text-[10px] font-bold leading-none text-amber-600">
                                周末加班 {weekendHours.toFixed(1)}h
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {workHoursData.length > 10 && (
                  <div className="shrink-0 border-t border-slate-100 px-2.5 py-1.5">
                    <button
                      onClick={toggleAllHours}
                      disabled={isOffline}
                      className="w-full rounded-lg py-1.5 text-[11px] font-bold text-slate-500 transition hover:bg-slate-50 hover:text-blue-600 disabled:cursor-not-allowed"
                    >
                      {showAllHours ? '收起列表' : `展开全部 ${workHoursData.length} 人`}
                    </button>
                  </div>
                )}
              </section>

              {/* ==================== 月度请假统计 ==================== */}
              <section className="flex max-h-[calc(100vh_-_13.5rem)] flex-col rounded-2xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/40">
                <div className="flex shrink-0 items-center justify-between gap-3 rounded-t-2xl border-b border-slate-100 bg-slate-50 px-5 py-3.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-500">
                      <Calendar size={17} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-[15px] font-bold text-slate-800">月度请假统计</h2>
                      <p className="mt-0.5 truncate text-[11px] font-medium text-slate-400">
                        共 {workHoursData.length} 人 · 有记录 {sortedByLeave.filter(item => getDisplayedLeaveHours(item) > 0).length} 人
                        {showAllLeave && hasAnyLeave && workHoursData.length > 10 ? ' · 已展开' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    {hasAnyLeave && workHoursData.length > 10 && (
                      <button
                        type="button"
                        onClick={toggleAllLeave}
                        disabled={isOffline}
                        title={showAllLeave ? '收起列表，仅保留前 10 名' : `展开全部 ${workHoursData.length} 人`}
                        className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white/90 px-1.5 py-1 text-[11px] font-bold text-slate-500 shadow-sm transition hover:border-rose-200 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {showAllLeave ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        {showAllLeave ? '收起' : '展开'}
                      </button>
                    )}
                    <label className="flex shrink-0 cursor-pointer select-none items-center gap-2 text-[11px] font-semibold text-slate-500">
                      不含休假
                      <span className="relative inline-flex h-4 w-7 items-center">
                        <input
                          type="checkbox"
                          checked={excludeVacationLeave}
                          onChange={(e) => setExcludeVacationLeave(e.target.checked)}
                          disabled={isOffline}
                          className="peer sr-only"
                        />
                        <span className={`absolute inset-0 rounded-full bg-slate-300 transition ${ACCENT_STYLES.rose.switchOn}`}></span>
                        <span className="absolute left-0.5 h-3 w-3 rounded-full bg-white shadow transition peer-checked:translate-x-3"></span>
                      </span>
                    </label>
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 snap-y snap-mandatory flex-col overflow-y-auto px-2.5 py-2" data-list ref={leaveListRef} onScroll={() => setTip(null)}>
                  {sortedByLeave.length === 0 || !hasAnyLeave ? (
                    <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
                      <Calendar size={26} className="mb-2 text-slate-300" />
                      <div className="text-xs font-semibold text-slate-400">本月暂无请假记录</div>
                      <div className="mt-1 text-[11px] text-slate-300">
                        共 {workHoursData.length} 人，均无请假
                      </div>
                    </div>
                  ) : (
                    (showAllLeave ? sortedByLeave : sortedByLeave.slice(0, 10)).map((item, index) => {
                    const totalLeave = getDisplayedLeaveHours(item);
                    return (
                      <div
                        key={item.designerId}
                        className="relative flex min-h-[54px] snap-start items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-slate-100/60"
                        onMouseEnter={(e) => openTip('leave', item, e.currentTarget)}
                        onMouseLeave={() => setTip(null)}
                      >
                        <span
                          className="pointer-events-none absolute inset-y-1 left-0 rounded-lg bg-rose-400/[0.12]"
                          style={{ width: `${totalLeave > 0 ? Math.max(5, (totalLeave / maxLeaveHours) * 100) : 0}%` }}
                        />
                        {renderRank(index, 'rose', totalLeave)}

                        <div className="relative min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="truncate text-[13px] font-bold text-slate-800">{item.designerName}</span>
                            <span className="flex w-14 shrink-0 items-baseline justify-end tabular-nums">
                              <span className={`text-[17px] font-black leading-none ${totalLeave > 0 ? ACCENT_STYLES.rose.value : 'text-slate-300'}`}>
                                {totalLeave.toFixed(1)}
                              </span>
                              <span className="ml-0.5 text-[10px] font-semibold text-slate-400">h</span>
                            </span>
                          </div>

                          {(item.sickDays > 0 || item.illnessDays > 0 || (!excludeVacationLeave && item.vacationDays > 0)) && (
                            <div className="mt-0.5 flex flex-wrap items-center gap-1 leading-none">
                              {item.sickDays > 0 && (
                                <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold leading-none text-red-500">事假 {item.sickDays.toFixed(1)}h</span>
                              )}
                              {!excludeVacationLeave && item.vacationDays > 0 && (
                                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold leading-none text-blue-500">休假 {item.vacationDays.toFixed(1)}h</span>
                              )}
                              {item.illnessDays > 0 && (
                                <span className="rounded bg-pink-50 px-1.5 py-0.5 text-[10px] font-bold leading-none text-pink-500">病假 {item.illnessDays.toFixed(1)}h</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                    })
                  )}
                </div>

                {hasAnyLeave && workHoursData.length > 10 && (
                  <div className="shrink-0 border-t border-slate-100 px-2.5 py-1.5">
                    <button
                      onClick={toggleAllLeave}
                      disabled={isOffline}
                      className="w-full rounded-lg py-1.5 text-[11px] font-bold text-slate-500 transition hover:bg-slate-50 hover:text-rose-500 disabled:cursor-not-allowed"
                    >
                      {showAllLeave ? '收起列表' : `展开全部 ${workHoursData.length} 人`}
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}

          {isSuperAdmin && (
            <div className="mt-8 bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
                <Shield className="mr-2 text-purple-600" size={22} />
                工时管理查看权限设置
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                  { label: '启用工时管理', detail: 'Global Toggle', key: 'enabled' as const },
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
                        disabled={!settingsLoaded || isOffline}
                        className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer z-10"
                      />
                      <label className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer ${settings[item.key] ? 'bg-blue-500' : 'bg-gray-300'}`}></label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="shrink-0 bg-white border-t border-gray-200 px-6 py-3">
        <div className="max-w-7xl mx-auto flex justify-between items-center text-sm text-gray-500">
          <div>数据每月更新</div>
          <div className="flex items-center gap-2">
            <span className="font-medium">当前状态:</span>
            {isOffline ? (
              <span className="text-amber-600 flex items-center">
                <span className="w-2 h-2 bg-amber-500 rounded-full mr-1"></span>
                离线
              </span>
            ) : (
              <span className="text-green-600 flex items-center">
                <span className="w-2 h-2 bg-green-500 rounded-full mr-1"></span>
                正常
              </span>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
};

export default WorkHours;
