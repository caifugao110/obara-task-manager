import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { ChevronLeft, LogOut, AlertCircle, CheckCircle, RefreshCw, Clock, Calendar, TrendingUp, Medal, Sun, Cloud, Umbrella, FileSpreadsheet, BarChart2, Shield } from 'lucide-react';
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
  leaveDays: number;
  sickDays: number;
  vacationDays: number;
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
  const [specResults, setSpecResults] = useState<{designerId: string, designerName: string, taskName: string, color: string, date: string}[]>([]);
  
  const [leaderboardSettings, setLeaderboardSettings] = useState({ enabled: true, allowAdmins: true, allowViewers: false });
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const isSuperAdmin = user?.role === 'superadmin';
  const authHeader = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

  // Extract specification number from task name (only 5 digit number)
  const extractSpecNumber = (taskName: string): string | null => {
    if (!taskName) return null;
    // Match exactly 5 digits
    const match = taskName.match(/\d{5}/);
    return match ? match[0] : null;
  };

  // Search for tasks by specification number
  const searchBySpecNumber = useCallback(async (currentSpec?: string) => {
    const targetSpec = currentSpec !== undefined ? currentSpec : specNumber;
    if (targetSpec.length !== 5) {
      setSpecResults([]);
      return;
    }

    try {
      const month = currentDate.getMonth() + 1;
      const year = currentDate.getFullYear();
      const res = await axios.get(`/api/tasks?month=${month}&year=${year}`, authHeader);
      const tasks = res.data;

      const results: {designerId: string, designerName: string, taskName: string, color: string, date: string}[] = [];

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
                taskName: item.taskName,
                color: item.color || '#ffffff',
                date
              });
            }
          });
        });
      });

      setSpecResults(results);
    } catch (err: any) {
      console.error('Error searching spec:', err);
      addToast('搜索失败', 'error');
    }
  }, [specNumber, currentDate, designers, token]);

  const canViewLeaderboard = useMemo(() => {
    if (isSuperAdmin) return true;
    if (!leaderboardSettings.enabled) return false;
    
    if (!user) return leaderboardSettings.allowViewers;

    const role = user.role;
    if (role === 'admin' && leaderboardSettings.allowAdmins) return true;
    if (role === 'designer' && leaderboardSettings.allowViewers) return true;
    
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
      const res = await axios.get('/api/designers');
      setDesigners(res.data);
    } catch (err: any) {
      console.error('Error fetching designers:', err);
      addToast('无法加载人员数据', 'error');
    }
  }, []);

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
          leaveDays: 0,
          sickDays: 0,
          vacationDays: 0
        });
      });

      tasks.forEach((sheet: any) => {
        const designerData = leaderboardMap.get(sheet.designerId);
        if (designerData) {
          (Object.entries(sheet.days || {}) as [string, any[]][]).forEach(([date, items]) => {
            let hasLeave = false;
            let sickDay = false;
            let vacationDay = false;

            items.forEach((item: any) => {
              if (item.leaveType === 'sick' || item.leaveType === 'vacation') {
                hasLeave = true;
                if (item.leaveType === 'sick') sickDay = true;
                else if (item.leaveType === 'vacation') vacationDay = true;
              } else {
                const mainHours = typeof item.hours === 'number' ? item.hours : (parseFloat(item.hours) || 0);
                const gunsHours = (item.guns || []).reduce((sum: number, gun: any) => {
                  return sum + (typeof gun.hours === 'number' ? gun.hours : (parseFloat(gun.hours) || 0));
                }, 0);
                designerData.hours += item.guns && item.guns.length > 0 ? gunsHours : mainHours;
              }
            });

            if (hasLeave) {
              designerData.leaveDays += 1;
              if (sickDay) designerData.sickDays += 1;
              if (vacationDay) designerData.vacationDays += 1;
            }
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
    if (designers.length > 0) {
      setLoading(false);
    }
  }, [designers]);

  const sortedByHours = useMemo(() => 
    [...leaderboardData].sort((a, b) => b.hours - a.hours), 
    [leaderboardData]
  );

  const sortedByLeave = useMemo(() => 
    [...leaderboardData].sort((a, b) => b.leaveDays - a.leaveDays), 
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
            <h2 className="text-xl font-bold text-gray-600">{isClosed ? '报表功能已关闭' : '暂无权限访问报表'}</h2>
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

      <header className="bg-white shadow-md px-6 py-4 flex items-center justify-between border-b border-gray-200">
        <div className="flex items-center space-x-4">
          <Link to="/" className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 font-bold transition">
            <ChevronLeft size={20} />
            <span>返回工作台</span>
          </Link>
          <div className="h-6 w-[1px] bg-gray-200 mx-2"></div>
            <h2 className="text-xl font-bold text-blue-600 flex items-center">
            <FileSpreadsheet className="text-blue-500 mr-2" size={24} />
            任务报表与分析
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
            onClick={fetchLeaderboardData}
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
        {/* Specification Progress Management */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden mb-8">
          <div className="px-6 py-5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
            <h2 className="text-lg font-bold flex items-center">
              <BarChart2 className="mr-2" size={22} />
              仕样进度管理
            </h2>
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
                    <div 
                      key={`${result.designerId}-${result.date}-${index}`}
                      className="p-4 rounded-xl border-2 transition hover:shadow-lg bg-white border-gray-100"
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
                      <div className="mt-2 flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full border border-gray-300"
                          style={{ backgroundColor: result.color || '#ffffff' }}
                        ></div>
                        <span className="text-[10px] text-gray-400 uppercase font-bold">
                          {result.color ? '标记颜色' : '无颜色'}
                        </span>
                      </div>
                    </div>
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

        {leaderboardLoading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="animate-spin text-blue-600 mb-4" size={40} />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Hours Leaderboard */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="px-6 py-5 bg-gray-50 border-b border-gray-100">
                <h2 className="text-lg font-bold flex items-center text-gray-800">
                  <Clock className="mr-2 text-blue-600" size={22} />
                  月度工时排行
                  <span className="ml-2 text-[10px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full uppercase tracking-wider">Top 10</span>
                </h2>
              </div>
              
              <div className="p-4">
                <div className="space-y-3">
                  {sortedByHours.slice(0, 10).map((item, index) => (
                    <div 
                      key={item.designerId} 
                      className={`flex items-center p-4 rounded-xl transition-all hover:shadow-md ${
                        index === 0 ? 'bg-blue-50/50 border border-blue-100' :
                        index === 1 ? 'bg-gray-50/50 border border-gray-100' :
                        index === 2 ? 'bg-orange-50/50 border border-orange-100' :
                        'bg-white border border-gray-50 hover:bg-gray-50'
                      }`}
                    >
                      <div className="w-10 flex justify-center">
                        {getRankIcon(index)}
                      </div>
                      <div className="flex-1 ml-3">
                        <div className="font-bold text-gray-800">{item.designerName}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-black text-blue-700">{item.hours.toFixed(1)}</div>
                        <div className="text-[10px] text-gray-400 font-bold uppercase">Hours</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Leave Leaderboard */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="px-6 py-5 bg-gray-50 border-b border-gray-100">
                <h2 className="text-lg font-bold flex items-center text-gray-800">
                  <Calendar className="mr-2 text-red-600" size={22} />
                  月度请假排行
                  <span className="ml-2 text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full uppercase tracking-wider">Top 10</span>
                </h2>
              </div>
              
              <div className="p-4">
                <div className="space-y-3">
                  {sortedByLeave.slice(0, 10).map((item, index) => (
                    <div 
                      key={item.designerId} 
                      className={`flex items-center p-4 rounded-xl transition-all hover:shadow-md ${
                        index === 0 ? 'bg-red-50/50 border border-red-100' :
                        index === 1 ? 'bg-gray-50/50 border border-gray-100' :
                        index === 2 ? 'bg-orange-50/50 border border-orange-100' :
                        'bg-white border border-gray-50 hover:bg-gray-50'
                      }`}
                    >
                      <div className="w-10 flex justify-center">
                        {getRankIcon(index)}
                      </div>
                      <div className="flex-1 ml-3">
                        <div className="font-bold text-gray-800">{item.designerName}</div>
                        <div className="flex gap-2 mt-1">
                          <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded">
                            事假 {item.sickDays}h
                          </span>
                          <span className="text-[10px] font-bold text-blue-500 bg-blue-50 px-2 py-0.5 rounded">
                            休假 {item.vacationDays}h
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-black text-gray-700">{item.leaveDays}</div>
                        <div className="text-[10px] text-gray-400 font-bold uppercase">Total</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Settings for Super Admin */}
        {isSuperAdmin && (
          <div className="mt-8 bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
              <Shield className="mr-2 text-purple-600" size={22} />
              报表查看权限设置
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="flex items-center justify-between p-5 bg-gray-50 rounded-xl border border-gray-100">
                <div>
                  <div className="font-bold text-gray-700">启用报表功能</div>
                  <div className="text-[10px] text-gray-400 font-bold uppercase mt-0.5">Global Toggle</div>
                </div>
                <div className="relative inline-block w-12 h-6 align-middle select-none transition duration-200 ease-in">
                  <input 
                    type="checkbox" 
                    checked={leaderboardSettings.enabled}
                    onChange={(e) => updateLeaderboardSettings({ enabled: e.target.checked })}
                    disabled={!settingsLoaded}
                    className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer z-10"
                  />
                  <label className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer ${leaderboardSettings.enabled ? 'bg-blue-500' : 'bg-gray-300'}`}></label>
                </div>
              </div>
              <div className="flex items-center justify-between p-5 bg-gray-50 rounded-xl border border-gray-100">
                <div>
                  <div className="font-bold text-gray-700">一般管理员</div>
                  <div className="text-[10px] text-gray-400 font-bold uppercase mt-0.5">Admin Access</div>
                </div>
                <div className="relative inline-block w-12 h-6 align-middle select-none transition duration-200 ease-in">
                  <input 
                    type="checkbox" 
                    checked={leaderboardSettings.allowAdmins}
                    onChange={(e) => updateLeaderboardSettings({ allowAdmins: e.target.checked })}
                    disabled={!settingsLoaded}
                    className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer z-10"
                  />
                  <label className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer ${leaderboardSettings.allowAdmins ? 'bg-blue-500' : 'bg-gray-300'}`}></label>
                </div>
              </div>
              <div className="flex items-center justify-between p-5 bg-gray-50 rounded-xl border border-gray-100">
                <div>
                  <div className="font-bold text-gray-700">普通查看者</div>
                  <div className="text-[10px] text-gray-400 font-bold uppercase mt-0.5">Viewer Access</div>
                </div>
                <div className="relative inline-block w-12 h-6 align-middle select-none transition duration-200 ease-in">
                  <input 
                    type="checkbox" 
                    checked={leaderboardSettings.allowViewers}
                    onChange={(e) => updateLeaderboardSettings({ allowViewers: e.target.checked })}
                    disabled={!settingsLoaded}
                    className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer z-10"
                  />
                  <label className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer ${leaderboardSettings.allowViewers ? 'bg-blue-500' : 'bg-gray-300'}`}></label>
                </div>
              </div>
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
