import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { format, isWeekend } from 'date-fns';
import {
  AlertCircle,
  BarChart2,
  Calendar,
  CheckCircle,
  ChevronLeft,
  Clock,
  LogOut,
  Medal,
  RefreshCw,
  Shield,
  Users
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

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

const WorkHours = () => {
  const { user, token, logout } = useAuth();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [designers, setDesigners] = useState<DesignerData[]>([]);
  const [workHoursData, setWorkHoursData] = useState<WorkHoursData[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settings, setSettings] = useState(defaultSettings);
  const [showAllHours, setShowAllHours] = useState(false);
  const [showAllLeave, setShowAllLeave] = useState(false);
  const [excludeWeekendOvertime, setExcludeWeekendOvertime] = useState(false);
  const [excludeVacationLeave, setExcludeVacationLeave] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const isSuperAdmin = user?.role === 'superadmin';
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const authHeader = useMemo(() => token ? { headers: { Authorization: `Bearer ${token}` } } : {}, [token]);

  const addToast = (message: string, type: 'success' | 'error') => {
    const id = Date.now();
    setToasts(prev => [...prev, { message, type, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  const canViewWorkHours = useMemo(() => {
    if (isSuperAdmin) return true;
    if (!settings.enabled) return false;
    if (!user) return settings.allowViewers;
    if (user.role === 'admin' && settings.allowAdmins) return true;
    if (user.role === 'user' && settings.allowViewers) return true;
    return false;
  }, [isSuperAdmin, settings, user]);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await axios.get('/api/settings/work-hours');
      setSettings(res.data);
    } catch (err) {
      console.error('Error fetching work hours settings:', err);
      addToast('无法加载工时管理权限设置', 'error');
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
      addToast('游客/普通用户权限开启时，不能关闭一般管理员权限', 'error');
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
      addToast('无法加载人员数据', 'error');
    } finally {
      setLoading(false);
    }
  }, [authHeader]);

  const fetchWorkHoursData = useCallback(async () => {
    if (designers.length === 0) return;
    setDataLoading(true);
    try {
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
            const itemHours = typeof item.hours === 'number' ? item.hours : (parseFloat(item.hours) || 0);
            const isWeekendDate = isWeekend(new Date(`${date}T00:00:00`));
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
      addToast('无法加载工时管理数据', 'error');
    } finally {
      setDataLoading(false);
    }
  }, [authHeader, currentDate, designers]);

  useEffect(() => {
    fetchSettings();
    fetchDesigners();
  }, [fetchDesigners, fetchSettings]);

  useEffect(() => {
    if (!loading && canViewWorkHours) fetchWorkHoursData();
  }, [loading, canViewWorkHours, fetchWorkHoursData]);

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

  const getRankIcon = (index: number) => {
    switch (index) {
      case 0: return <Medal className="text-yellow-500" size={20} />;
      case 1: return <Medal className="text-gray-400" size={20} />;
      case 2: return <Medal className="text-amber-600" size={20} />;
      default: return <span className="text-gray-400 font-bold text-sm">{index + 1}</span>;
    }
  };

  const getLeaveTypeClass = (type: LeaveDetail['type']) => {
    if (type === 'sick') return 'bg-red-50 text-red-600 border-red-100';
    if (type === 'vacation') return 'bg-blue-50 text-blue-600 border-blue-100';
    return 'bg-pink-50 text-pink-600 border-pink-100';
  };

  if (loading || !settingsLoaded) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <RefreshCw className="animate-spin text-blue-600 mb-4" size={48} />
        <div className="text-gray-600 font-medium">正在加载数据...</div>
      </div>
    );
  }

  if (!canViewWorkHours) {
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col">
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map(toast => (
          <div key={toast.id} className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-white transition-all duration-300 ${toast.type === 'error' ? 'bg-red-500' : 'bg-green-500'}`}>
            {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        ))}
      </div>

      <header className="bg-white shadow-md px-6 py-4 flex items-center justify-between border-b border-gray-200">
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
        </div>

        <div className="flex items-center space-x-4">
          <div className="flex items-center bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
              className="p-2 hover:bg-white rounded-lg transition shadow-sm"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="px-6 font-bold text-gray-700 min-w-[140px] text-center">
              {format(currentDate, 'yyyy年 MM月')}
            </span>
            <button
              onClick={() => setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
              className="p-2 hover:bg-white rounded-lg transition shadow-sm"
            >
              <ChevronLeft size={18} className="rotate-180" />
            </button>
          </div>
          <button
            onClick={fetchWorkHoursData}
            className="p-2 bg-blue-50 hover:bg-blue-100 rounded-lg transition"
            title="刷新数据"
          >
            <RefreshCw size={18} className="text-blue-600" />
          </button>
        </div>

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
      </header>

      <main className="flex-1 p-8 max-w-7xl mx-auto w-full">
        {dataLoading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="animate-spin text-blue-600 mb-4" size={40} />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-visible">
              <div className="px-6 py-5 bg-gray-50 border-b border-gray-100">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-lg font-bold flex items-center text-gray-800">
                    <Clock className="mr-2 text-blue-600" size={22} />
                    月度工时排行
                    {workHoursData.length > 10 && (
                      <button
                        className="ml-2 text-[10px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full uppercase tracking-wider hover:bg-blue-200"
                        onClick={() => setShowAllHours(!showAllHours)}
                      >
                        {showAllHours ? '收起' : '显示全部'}
                      </button>
                    )}
                  </h2>
                  <label className="flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer select-none">
                    <span>不包含周末加班</span>
                    <span className="relative inline-flex h-5 w-9 items-center">
                      <input
                        type="checkbox"
                        checked={excludeWeekendOvertime}
                        onChange={(e) => setExcludeWeekendOvertime(e.target.checked)}
                        className="peer sr-only"
                      />
                      <span className="absolute inset-0 rounded-full bg-gray-300 transition peer-checked:bg-blue-500"></span>
                      <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4"></span>
                    </span>
                  </label>
                </div>
              </div>
              <div className="p-4 space-y-3">
                {(showAllHours ? sortedByHours : sortedByHours.slice(0, 10)).map((item, index) => {
                  const visibleTripDetails = getDisplayedTripDetails(item);
                  return (
                    <div key={item.designerId} className={`relative group/hours flex items-center p-4 rounded-xl transition-all hover:shadow-md ${
                      index === 0 ? 'bg-blue-50/50 border border-blue-100' :
                      index === 1 ? 'bg-gray-50/50 border border-gray-100' :
                      index === 2 ? 'bg-orange-50/50 border border-orange-100' :
                      'bg-white border border-gray-50 hover:bg-gray-50'
                    }`}>
                      <div className="w-10 flex justify-center">{getRankIcon(index)}</div>
                      <div className="flex-1 ml-3">
                        <div className="font-bold text-gray-800">{item.designerName}</div>
                        {getWeekendOvertimeHours(item) > 0 && (
                          <div className="flex gap-2 mt-1">
                            <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                              周末加班 {getWeekendOvertimeHours(item).toFixed(1)}h
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-black text-blue-700">{getDisplayedWorkHours(item).toFixed(1)}</div>
                        <div className="text-[10px] text-gray-400 font-bold uppercase">Hours</div>
                      </div>
                      <div className="pointer-events-none absolute right-3 bottom-full z-40 mb-2 hidden w-80 rounded-xl border border-gray-200 bg-white p-3 shadow-2xl group-hover/hours:block">
                        <div className="mb-3 flex items-center justify-between">
                          <span className="text-sm font-black text-gray-800">{item.designerName} 工时明细</span>
                          <span className="text-xs font-bold text-gray-400">{getDisplayedWorkHours(item).toFixed(1)}h</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                            <div className="text-[10px] font-black text-blue-500">设计计划总工时</div>
                            <div className="mt-1 text-lg font-black text-blue-700">{getDisplayedDesignHours(item).toFixed(1)}h</div>
                          </div>
                          <div className="rounded-lg border border-yellow-100 bg-yellow-50 px-3 py-2">
                            <div className="text-[10px] font-black text-yellow-600">出差总工时</div>
                            <div className="mt-1 text-lg font-black text-yellow-800">{getDisplayedTripHours(item).toFixed(1)}h</div>
                          </div>
                        </div>
                        <div className="mt-3">
                          <div className="mb-2 text-xs font-black text-gray-700">出差明细</div>
                          {visibleTripDetails.length > 0 ? (
                            <div className="max-h-56 space-y-2 overflow-auto pr-1">
                              {[...visibleTripDetails]
                                .sort((a, b) => a.date.localeCompare(b.date))
                                .map((detail, detailIndex) => (
                                  <div key={`${item.designerId}-trip-${detail.date}-${detailIndex}`} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-2 py-1.5">
                                    <span className="w-24 text-xs font-bold text-gray-600">{detail.date}</span>
                                    <span className="min-w-0 flex-1 truncate text-xs font-bold text-yellow-800">{detail.taskName}</span>
                                    <span className="text-xs font-black text-gray-700">{detail.hours.toFixed(1)}h</span>
                                  </div>
                                ))}
                            </div>
                          ) : (
                            <div className="rounded-lg bg-gray-50 px-3 py-2 text-center text-xs font-bold text-gray-400">
                              暂无出差明细
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-visible">
              <div className="px-6 py-5 bg-gray-50 border-b border-gray-100">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-lg font-bold flex items-center text-gray-800">
                    <Calendar className="mr-2 text-red-600" size={22} />
                    月度请假排行
                    {workHoursData.length > 10 && (
                      <button
                        className="ml-2 text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full uppercase tracking-wider hover:bg-red-200"
                        onClick={() => setShowAllLeave(!showAllLeave)}
                      >
                        {showAllLeave ? '收起' : '显示全部'}
                      </button>
                    )}
                  </h2>
                  <label className="flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer select-none">
                    <span>不包含休假</span>
                    <span className="relative inline-flex h-5 w-9 items-center">
                      <input
                        type="checkbox"
                        checked={excludeVacationLeave}
                        onChange={(e) => setExcludeVacationLeave(e.target.checked)}
                        className="peer sr-only"
                      />
                      <span className="absolute inset-0 rounded-full bg-gray-300 transition peer-checked:bg-red-500"></span>
                      <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4"></span>
                    </span>
                  </label>
                </div>
              </div>
              <div className="p-4 space-y-3">
                {(showAllLeave ? sortedByLeave : sortedByLeave.slice(0, 10)).map((item, index) => {
                  const totalLeave = getDisplayedLeaveHours(item);
                  const visibleLeaveDetails = excludeVacationLeave
                    ? item.leaveDetails.filter(detail => detail.type !== 'vacation')
                    : item.leaveDetails;
                  return (
                    <div key={item.designerId} className={`relative group/leave flex items-center p-4 rounded-xl transition-all hover:shadow-md ${
                      index === 0 ? 'bg-red-50/50 border border-red-100' :
                      index === 1 ? 'bg-gray-50/50 border border-gray-100' :
                      index === 2 ? 'bg-orange-50/50 border border-orange-100' :
                      'bg-white border border-gray-50 hover:bg-gray-50'
                    }`}>
                      <div className="w-10 flex justify-center">{getRankIcon(index)}</div>
                      <div className="flex-1 ml-3">
                        <div className="font-bold text-gray-800">{item.designerName}</div>
                        <div className="flex gap-2 mt-1">
                          {item.sickDays > 0 && <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded">事假 {item.sickDays.toFixed(1)}h</span>}
                          {!excludeVacationLeave && item.vacationDays > 0 && <span className="text-[10px] font-bold text-blue-500 bg-blue-50 px-2 py-0.5 rounded">休假 {item.vacationDays.toFixed(1)}h</span>}
                          {item.illnessDays > 0 && <span className="text-[10px] font-bold text-pink-500 bg-pink-50 px-2 py-0.5 rounded">病假 {item.illnessDays.toFixed(1)}h</span>}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-black text-gray-700">{totalLeave.toFixed(1)}</div>
                        <div className="text-[10px] text-gray-400 font-bold uppercase">Hours</div>
                      </div>
                      <div className="pointer-events-none absolute right-3 bottom-full z-40 mb-2 hidden w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-2xl group-hover/leave:block">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-sm font-black text-gray-800">{item.designerName} 请假明细</span>
                          <span className="text-xs font-bold text-gray-400">{totalLeave.toFixed(1)}h</span>
                        </div>
                        {visibleLeaveDetails.length > 0 ? (
                          <div className="max-h-64 space-y-2 overflow-auto pr-1">
                            {[...visibleLeaveDetails]
                              .sort((a, b) => a.date.localeCompare(b.date))
                              .map((detail, detailIndex) => (
                                <div key={`${item.designerId}-${detail.date}-${detail.type}-${detailIndex}`} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-2 py-1.5">
                                  <span className="w-24 text-xs font-bold text-gray-600">{detail.date}</span>
                                  <span className={`rounded border px-2 py-0.5 text-[10px] font-black ${getLeaveTypeClass(detail.type)}`}>
                                    {detail.typeLabel}
                                  </span>
                                  <span className="ml-auto text-xs font-black text-gray-700">{detail.hours.toFixed(1)}h</span>
                                </div>
                              ))}
                          </div>
                        ) : (
                          <div className="rounded-lg bg-gray-50 px-3 py-2 text-center text-xs font-bold text-gray-400">
                            暂无请假明细
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
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
                { label: '游客/普通用户', detail: 'Guest Access', key: 'allowViewers' as const }
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
          <div>数据每月更新</div>
          <div className="flex items-center gap-2">
            <span className="font-medium">当前状态:</span>
            <span className="text-green-600 flex items-center">
              <span className="w-2 h-2 bg-green-500 rounded-full mr-1"></span>
              正常
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default WorkHours;
