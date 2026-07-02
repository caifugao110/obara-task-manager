import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { ChevronLeft, LogOut, AlertCircle, CheckCircle, RefreshCw, Clock, Calendar, TrendingUp, Medal, Sun, Cloud, Umbrella, FileSpreadsheet, BarChart2, Shield, Users } from 'lucide-react';
import { format } from 'date-fns';

interface DesignerData {
  id: string;
  name: string;
  group: string;
}

interface LeaderboardData {
  designerId: string;
  designerName: string;
  hours: number;
  sickDays: number;
  vacationDays: number;
  illnessDays: number;
}

interface TaskSearchResult {
  designerId: string;
  designerName: string;
  itemId: string;
  taskName: string;
  color: string;
  date: string;
  guns: { name: string; hours: number | string }[];
}

interface GunSearchResult extends TaskSearchResult {
  gunName: string;
  gunHours: number | string;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
  id: number;
}

const Leaderboard = () => {
  const { user, token, logout } = useAuth();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [designers, setDesigners] = useState<DesignerData[]>([]);
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  
  // Specification tracking
  const [specNumber, setSpecNumber] = useState('');
  const [specResults, setSpecResults] = useState<TaskSearchResult[]>([]);
  const [specFullSearch, setSpecFullSearch] = useState(false);
  const [gunName, setGunName] = useState('');
  const [gunResults, setGunResults] = useState<GunSearchResult[]>([]);
  const [gunFullSearch, setGunFullSearch] = useState(false);
  
  const [leaderboardSettings, setLeaderboardSettings] = useState({ enabled: true, allowAdmins: true, allowViewers: false });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showAllHours, setShowAllHours] = useState(false);
  const [showAllLeave, setShowAllLeave] = useState(false);

  const isSuperAdmin = user?.role === 'superadmin';
  const authHeader = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

  const buildTaskLink = (result: TaskSearchResult) => (
    `/?designerId=${encodeURIComponent(result.designerId)}&date=${encodeURIComponent(result.date)}&itemId=${encodeURIComponent(result.itemId)}`
  );

  const buildTasksUrl = (fullSearch: boolean) => {
    if (fullSearch) return '/api/tasks';
    const month = currentDate.getMonth() + 1;
    const year = currentDate.getFullYear();
    return `/api/tasks?month=${month}&year=${year}`;
  };

  const sortByDateAsc = <T extends TaskSearchResult>(results: T[]) => (
    [...results].sort((a, b) => a.date.localeCompare(b.date))
  );

  // Extract specification number from task name (only 5 digit number)
  const extractSpecNumber = (taskName: string): string | null => {
    if (!taskName) return null;
    // Match exactly 5 digits
    const match = taskName.match(/\d{5}/);
    return match ? match[0] : null;
  };

  // Search for tasks by specification number
  const searchBySpecNumber = useCallback(async (currentSpec?: string, fullSearchOverride?: boolean) => {
    const targetSpec = currentSpec !== undefined ? currentSpec : specNumber;
    if (targetSpec.length !== 5) {
      setSpecResults([]);
      return;
    }

    try {
      const res = await axios.get(buildTasksUrl(fullSearchOverride ?? specFullSearch), authHeader);
      const tasks = res.data;

      const results: TaskSearchResult[] = [];

      tasks.forEach((sheet: any) => {
        const designer = designers.find(d => d.id === sheet.designerId);
        if (!designer) return;

        (Object.entries(sheet.days || {}) as [string, any[]][]).forEach(([date, items]) => {
          items.forEach((item: any) => {
            const extractedSpec = extractSpecNumber(item.taskName);
            // Exact match
            if (extractedSpec === targetSpec.trim()) {
              results.push({
                designerId: sheet.designerId,
                designerName: designer.name,
                itemId: item.id,
                taskName: item.taskName,
                guns: (item.guns || []).map((gun: any) => ({
                  name: String(gun.name || '').trim() || '未命名枪名',
                  hours: gun.hours || 0
                })),
                color: item.color || '#ffffff',
                date
              });
            }
          });
        });
      });

      setSpecResults(sortByDateAsc(results));
    } catch (err: any) {
      console.error('Error searching spec:', err);
      addToast('搜索失败', 'error');
    }
  }, [specNumber, currentDate, designers, token, specFullSearch]);

  const searchByGunName = useCallback(async (currentGunName?: string, fullSearchOverride?: boolean) => {
    const targetGunName = (currentGunName !== undefined ? currentGunName : gunName).trim();
    if (!targetGunName) {
      setGunResults([]);
      return;
    }

    try {
      const res = await axios.get(buildTasksUrl(fullSearchOverride ?? gunFullSearch), authHeader);
      const tasks = res.data;
      const normalizedTarget = targetGunName.toLowerCase();
      const results: GunSearchResult[] = [];

      tasks.forEach((sheet: any) => {
        const designer = designers.find(d => d.id === sheet.designerId);
        if (!designer) return;

        (Object.entries(sheet.days || {}) as [string, any[]][]).forEach(([date, items]) => {
          items.forEach((item: any) => {
            (item.guns || []).forEach((gun: any) => {
              const currentName = String(gun.name || '').trim();
              if (currentName && currentName.toLowerCase().includes(normalizedTarget)) {
                results.push({
                  designerId: sheet.designerId,
                  designerName: designer.name,
                  itemId: item.id,
                  taskName: item.taskName || '未命名任务',
                  guns: item.guns || [],
                  gunName: currentName,
                  gunHours: gun.hours || 0,
                  color: item.color || '#ffffff',
                  date
                });
              }
            });
          });
        });
      });

      setGunResults(sortByDateAsc(results));
    } catch (err: any) {
      console.error('Error searching gun:', err);
      addToast('枪名搜索失败', 'error');
    }
  }, [gunName, currentDate, designers, token, gunFullSearch]);

  const refreshSearches = () => {
    if (specNumber.length === 5) searchBySpecNumber(specNumber);
    if (gunName.trim()) searchByGunName(gunName);
  };

  const canViewLeaderboard = useMemo(() => {
    if (isSuperAdmin) return true;
    if (!leaderboardSettings.enabled) return false;
    
    if (!user) return leaderboardSettings.allowViewers;

    const role = user.role;
    if (role === 'admin' && leaderboardSettings.allowAdmins) return true;
    if (role === 'user' && leaderboardSettings.allowViewers) return true;
    
    return false;
  }, [user, leaderboardSettings, isSuperAdmin]);

  const addToast = (message: string, type: 'success' | 'error') => {
    const id = Date.now();
    setToasts(prev => [...prev, { message, type, id }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  const fetchDesigners = useCallback(async () => {
    try {
      const headers = token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
      const res = await axios.get('/api/designers', headers);
      setDesigners(res.data);
    } catch (err: any) {
      console.error('Error fetching designers:', err);
      addToast('无法加载人员数据', 'error');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchLeaderboardSettings = useCallback(async () => {
    try {
      const res = await axios.get('/api/settings/leaderboard');
      setLeaderboardSettings(res.data);
    } catch (err: any) {
      console.error('Error fetching leaderboard settings:', err);
      addToast('无法加载报表权限设置', 'error');
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  const updateLeaderboardSettings = async (next: Partial<typeof leaderboardSettings>) => {
    const updated = { ...leaderboardSettings, ...next };
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
    setLeaderboardSettings(updated);
    if (!isSuperAdmin) return;
    try {
      await axios.put('/api/settings/leaderboard', updated, authHeader);
      addToast('权限设置已保存', 'success');
    } catch (err: any) {
      console.error('Error saving leaderboard settings:', err);
      addToast('保存报表权限设置失败', 'error');
    }
  };

  const fetchLeaderboardData = useCallback(async () => {
    setLeaderboardLoading(true);
    try {
      const month = currentDate.getMonth() + 1;
      const year = currentDate.getFullYear();
      const res = await axios.get(`/api/tasks?month=${month}&year=${year}`, authHeader);
      const tasks = res.data;

      const leaderboardMap = new Map<string, LeaderboardData>();

      designers.forEach(designer => {
        leaderboardMap.set(designer.id, {
          designerId: designer.id,
          designerName: designer.name,
          hours: 0,
          sickDays: 0,
          vacationDays: 0,
          illnessDays: 0
        });
      });

      tasks.forEach((sheet: any) => {
        const designerData = leaderboardMap.get(sheet.designerId);
        if (designerData) {
          (Object.entries(sheet.days || {}) as [string, any[]][]).forEach(([date, items]) => {
            items.forEach((item: any) => {
              if (item.leaveType === 'sick') {
                const hours = typeof item.hours === 'number' ? item.hours : (parseFloat(item.hours) || 0);
                designerData.sickDays += hours;
              } else if (item.leaveType === 'vacation') {
                const hours = typeof item.hours === 'number' ? item.hours : (parseFloat(item.hours) || 0);
                designerData.vacationDays += hours;
              } else if (item.leaveType === 'illness') {
                const hours = typeof item.hours === 'number' ? item.hours : (parseFloat(item.hours) || 0);
                designerData.illnessDays += hours;
              } else {
                const mainHours = typeof item.hours === 'number' ? item.hours : (parseFloat(item.hours) || 0);
                const gunsHours = (item.guns || []).reduce((sum: number, gun: any) => {
                  return sum + (typeof gun.hours === 'number' ? gun.hours : (parseFloat(gun.hours) || 0));
                }, 0);
                designerData.hours += item.guns && item.guns.length > 0 ? gunsHours : mainHours;
              }
            });
          });
        }
      });

      const sortedData = Array.from(leaderboardMap.values())
        .sort((a, b) => b.hours - a.hours);

      setLeaderboardData(sortedData);
    } catch (err: any) {
      console.error('Error fetching leaderboard data:', err);
      addToast('无法加载排行数据', 'error');
    } finally {
      setLeaderboardLoading(false);
    }
  }, [currentDate, designers, token]);

  useEffect(() => {
    fetchDesigners();
  }, [fetchDesigners]);

  useEffect(() => {
    fetchLeaderboardSettings();
  }, [fetchLeaderboardSettings]);

  useEffect(() => {
    if (!loading && designers.length > 0) {
      fetchLeaderboardData();
    }
  }, [loading, designers, fetchLeaderboardData]);

  useEffect(() => {
    if (loading || designers.length === 0) return;
    if (specNumber.length === 5) searchBySpecNumber(specNumber);
    if (gunName.trim()) searchByGunName(gunName);
  }, [currentDate, specFullSearch, gunFullSearch]);

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const sortedByHours = useMemo(() => 
    [...leaderboardData].sort((a, b) => b.hours - a.hours), 
    [leaderboardData]
  );

  const sortedByLeave = useMemo(() => 
    [...leaderboardData].sort((a, b) => (b.sickDays + b.vacationDays + b.illnessDays) - (a.sickDays + a.vacationDays + a.illnessDays)), 
    [leaderboardData]
  );

  const getRankIcon = (index: number) => {
    switch (index) {
      case 0: return <Medal className="text-yellow-500" size={20} />;
      case 1: return <Medal className="text-gray-400" size={20} />;
      case 2: return <Medal className="text-amber-600" size={20} />;
      default: return <span className="text-gray-400 font-bold text-sm">{index + 1}</span>;
    }
  };

  if (loading || !settingsLoaded) return (
    <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <RefreshCw className="animate-spin text-blue-600 mb-4" size={48} />
      <div className="text-gray-600 font-medium">正在加载数据...</div>
    </div>
  );

  if (!canViewLeaderboard) {
    const isClosed = !leaderboardSettings.enabled;
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col">
        <header className="bg-white shadow-sm px-6 py-4 flex items-center justify-between border-b border-gray-200">
          <div className="flex items-center space-x-4">
            <Link to="/" className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 font-bold transition">
              <ChevronLeft size={20} />
              <span>返回工作台</span>
            </Link>
          </div>
          {user ? (
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
          ) : (
            <Link to="/login" className="text-blue-600 hover:text-blue-800 font-bold transition">
              登录
            </Link>
          )}
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <BarChart2 size={64} className="mx-auto text-gray-300 mb-4" />
            <h2 className="text-xl font-bold text-gray-600">{isClosed ? '报表功能已关闭' : '暂无权限访问任务报表'}</h2>
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
            <p className="text-gray-400 mt-2">任务报表需要设计人员数据才能使用，请先在管理后台添加设计人员。</p>
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

      <header className="sticky top-0 z-40 bg-white shadow-md px-6 py-4 flex items-center justify-between border-b border-gray-200">
        <div className="flex items-center space-x-4">
          <Link to="/" className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 font-bold transition">
            <ChevronLeft size={20} />
            <span>返回工作台</span>
          </Link>
          <div className="h-6 w-[1px] bg-gray-200 mx-2"></div>
            <h2 className="text-xl font-bold text-blue-600 flex items-center">
            <FileSpreadsheet className="text-blue-500 mr-2" size={24} />
            任务报表
          </h2>
        </div>

        <div className="flex items-center space-x-4">
          <div className="flex items-center bg-gray-100 rounded-lg p-1">
            <button 
              onClick={() => {
                const newDate = new Date(currentDate);
                newDate.setMonth(newDate.getMonth() - 1);
                setCurrentDate(newDate);
              }}
              className="p-2 hover:bg-white rounded-lg transition shadow-sm"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="px-6 font-bold text-gray-700 min-w-[140px] text-center">
              {format(currentDate, 'yyyy年 MM月')}
            </span>
            <button 
              onClick={() => {
                const newDate = new Date(currentDate);
                newDate.setMonth(newDate.getMonth() + 1);
                setCurrentDate(newDate);
              }}
              className="p-2 hover:bg-white rounded-lg transition shadow-sm"
            >
              <ChevronLeft size={18} className="rotate-180" />
            </button>
          </div>
          <button 
            onClick={refreshSearches}
            className="p-2 bg-blue-50 hover:bg-blue-100 rounded-lg transition"
            title="刷新搜索"
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
        {/* Specification Progress Management */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden mb-8">
          <div className="px-6 py-5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-bold flex items-center">
                <BarChart2 className="mr-2" size={22} />
                仕样进度管理
              </h2>
              <label className="flex items-center gap-2 text-xs font-bold text-blue-50 cursor-pointer select-none">
                <span>全表搜索</span>
                <span className="relative inline-flex h-5 w-9 items-center">
                  <input
                    type="checkbox"
                    checked={specFullSearch}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setSpecFullSearch(next);
                      if (specNumber.length === 5) searchBySpecNumber(specNumber, next);
                    }}
                    className="peer sr-only"
                  />
                  <span className="absolute inset-0 rounded-full bg-white/30 transition peer-checked:bg-white/80"></span>
                  <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4 peer-checked:bg-blue-600"></span>
                </span>
              </label>
            </div>
            <p className="text-blue-100 text-sm mt-1">输入五位仕样号查看任务状态</p>
          </div>
          
          <div className="p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-2">仕样号 (必须为5位数字)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={5}
                    value={specNumber}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 5);
                      setSpecNumber(val);
                      if (val.length === 5) {
                        searchBySpecNumber(val);
                      } else {
                        setSpecResults([]);
                      }
                    }}
                    placeholder="例如: 56483"
                    className="flex-1 h-12 px-4 bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:border-blue-400 focus:bg-white transition text-gray-800 text-lg"
                  />
                </div>
              </div>
            </div>

            {specResults.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-gray-600">
                    找到 <span className="text-blue-600">{specResults.length}</span> 个匹配任务
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {specResults.map((result, index) => (
                    <Link
                      key={`${result.designerId}-${result.date}-${index}`}
                      to={buildTaskLink(result)}
                      className="block p-4 rounded-xl border-2 transition hover:shadow-lg hover:border-blue-200 bg-white border-gray-100"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-gray-800">{result.designerName}</span>
                        <span className="text-xs text-gray-500">{result.date}</span>
                      </div>
                      <div 
                        className="text-sm px-2 py-1.5 rounded border border-gray-100 font-medium"
                        style={{ backgroundColor: result.color || '#f9fafb' }}
                      >
                          {result.taskName}
                      </div>
                      <div className="mt-2 space-y-1">
                        {result.guns.length > 0 ? (
                          result.guns.map((gun, gunIndex) => (
                            <div
                              key={`${result.itemId}-${gun.name}-${gunIndex}`}
                              className="text-sm font-black text-blue-700 bg-blue-50 border border-blue-100 px-2 py-1 rounded"
                            >
                              {gun.name} <span className="text-xs text-gray-500 ml-1">{gun.hours}h</span>
                            </div>
                          ))
                        ) : (
                          <div className="text-sm font-bold text-gray-400 bg-gray-50 border border-gray-100 px-2 py-1 rounded">
                            暂无枪名
                          </div>
                        )}
                      </div>
                      <div className="mt-2 text-right text-xs font-bold text-blue-600">点击定位</div>
                    </Link>
                  ))}
                </div>
              </div>
            ) : specNumber.length === 5 ? (
              <div className="text-center py-8 text-gray-400">
                <TrendingUp size={40} className="mx-auto mb-2 opacity-50" />
                <p>未找到匹配该仕样号的任务</p>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <TrendingUp size={40} className="mx-auto mb-2 opacity-50" />
                <p>输入五位仕样号开始精确搜索</p>
                <p className="text-xs mt-2">系统将自动从任务内容中提取并匹配五位连续数字</p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          <div className="px-6 py-5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-bold flex items-center">
                <TrendingUp className="mr-2" size={22} />
                枪名周期管理
              </h2>
              <label className="flex items-center gap-2 text-xs font-bold text-emerald-50 cursor-pointer select-none">
                <span>全表搜索</span>
                <span className="relative inline-flex h-5 w-9 items-center">
                  <input
                    type="checkbox"
                    checked={gunFullSearch}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setGunFullSearch(next);
                      if (gunName.trim()) searchByGunName(gunName, next);
                    }}
                    className="peer sr-only"
                  />
                  <span className="absolute inset-0 rounded-full bg-white/30 transition peer-checked:bg-white/80"></span>
                  <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4 peer-checked:bg-emerald-600"></span>
                </span>
              </label>
            </div>
            <p className="text-emerald-100 text-sm mt-1">输入枪名查看枪名生命周期</p>
          </div>

          <div className="p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-2">枪名</label>
                <input
                  type="text"
                  value={gunName}
                  onChange={(e) => {
                    const val = e.target.value;
                    setGunName(val);
                    searchByGunName(val);
                  }}
                  placeholder="输入枪名关键词"
                  className="w-full h-12 px-4 bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:border-emerald-400 focus:bg-white transition text-gray-800 text-lg"
                />
              </div>
            </div>

            {gunResults.length > 0 ? (
              <div className="space-y-4">
                <div className="text-sm font-bold text-gray-600">
                  找到 <span className="text-emerald-600">{gunResults.length}</span> 个匹配枪名
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {gunResults.map((result, index) => (
                    <Link
                      key={`${result.designerId}-${result.date}-${result.itemId}-${index}`}
                      to={buildTaskLink(result)}
                      className="block p-4 rounded-xl border-2 transition hover:shadow-lg hover:border-emerald-200 bg-white border-gray-100"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-gray-800">{result.designerName}</span>
                        <span className="text-xs text-gray-500">{result.date}</span>
                      </div>
                      <div className="text-sm font-black text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-1 rounded mb-2">
                        {result.gunName} <span className="text-xs text-gray-500 ml-1">{result.gunHours}h</span>
                      </div>
                      <div
                        className="text-sm px-2 py-1.5 rounded border border-gray-100 font-medium"
                        style={{ backgroundColor: result.color || '#f9fafb' }}
                      >
                        {result.taskName}
                      </div>
                      <div className="mt-2 text-right text-xs font-bold text-emerald-600">点击定位</div>
                    </Link>
                  ))}
                </div>
              </div>
            ) : gunName.trim() ? (
              <div className="text-center py-8 text-gray-400">
                <TrendingUp size={40} className="mx-auto mb-2 opacity-50" />
                <p>未找到匹配该枪名的任务</p>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <TrendingUp size={40} className="mx-auto mb-2 opacity-50" />
                <p>输入枪名开始查询周期信息</p>
              </div>
            )}
          </div>
        </div>

        {isSuperAdmin && (
          <div className="mt-8 bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
              <Shield className="mr-2 text-purple-600" size={22} />
              任务报表查看权限设置
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { label: '启用任务报表', detail: 'Global Toggle', key: 'enabled' as const },
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
                      checked={leaderboardSettings[item.key]}
                      onChange={(e) => updateLeaderboardSettings({ [item.key]: e.target.checked })}
                      disabled={!settingsLoaded}
                      className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer z-10"
                    />
                    <label className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer ${leaderboardSettings[item.key] ? 'bg-blue-500' : 'bg-gray-300'}`}></label>
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

export default Leaderboard;
