import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { LogOut, UserCog, ChevronLeft, ChevronRight, RefreshCw, AlertCircle, CheckCircle, Plus, Trash2, FileSpreadsheet, ChevronDown, X } from 'lucide-react';
import { format, getDaysInMonth, startOfMonth, addDays, isWeekend } from 'date-fns';
import { useDebounce } from '../utils/debounce';

interface TaskItem {
  id: string;
  taskName: string;
  hours: number | string;
}

interface TaskSheet {
  id: string;
  userId: string;
  month: number;
  year: number;
  days: Record<string, TaskItem[]>;
}

interface User {
  id: string;
  username: string;
  name: string;
  role: string;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
  id: number;
}

const Dashboard = () => {
  const { user, token, logout } = useAuth();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [users, setUsers] = useState<User[]>([]);
  const [sheets, setSheets] = useState<TaskSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDate, setModalDate] = useState<string | null>(null);
  const [modalUserId, setModalUserId] = useState<string | null>(null);

  const daysInMonth = getDaysInMonth(currentDate);
  const firstDayOfMonth = startOfMonth(currentDate);

  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => {
    const date = addDays(firstDayOfMonth, i);
    return {
      fullDate: format(date, 'yyyy-MM-dd'),
      dayNum: i + 1,
      isWeekend: isWeekend(date),
      dayName: format(date, 'EEE')
    };
  }), [daysInMonth, firstDayOfMonth]);

  const filteredUsers = useMemo(() => {
    if (selectedUserId === 'all') return users;
    return users.filter(u => u.id === selectedUserId);
  }, [users, selectedUserId]);

  useEffect(() => {
    if (user?.role !== 'admin') {
      setSelectedUserId(user?.id || 'all');
    }
  }, [user]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalOpen) {
        setModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [modalOpen]);

  const openModal = (userId: string, date: string) => {
    setModalUserId(userId);
    setModalDate(date);
    setModalOpen(true);
  };

  const addToast = (message: string, type: 'success' | 'error') => {
    const id = Date.now();
    setToasts(prev => [...prev, { message, type, id }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  const upsertSheet = useCallback((incoming: TaskSheet) => {
    setSheets(prev => {
      const next = prev.filter(s => !(s.userId === incoming.userId && s.month === incoming.month && s.year === incoming.year));
      next.push(incoming);
      return next;
    });
  }, []);

  const fetchSheets = useCallback(async () => {
    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      const month = currentDate.getMonth() + 1;
      const year = currentDate.getFullYear();
      const res = await axios.get(`/api/tasks?month=${month}&year=${year}`, authHeader);
      setSheets(res.data);
    } catch (err: any) {
      console.error('Error fetching tasks:', err);
      addToast('无法获取任务数据', 'error');
    }
  }, [currentDate, token]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };

      if (user?.role === 'admin') {
        const usersRes = await axios.get('/api/users', authHeader);
        setUsers(usersRes.data);
      } else if (user) {
        setUsers([user as User]);
      }

      await fetchSheets();
    } catch (err: any) {
      console.error('Error fetching data:', err);
      addToast('数据加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [user, token, fetchSheets]);

  useEffect(() => {
    fetchData();

    socketRef.current = io('/', {
      path: '/socket.io',
      reconnectionAttempts: 5,
      timeout: 10000
    });

    socketRef.current.on('task_refreshed', () => {
      fetchSheets();
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, [fetchData, fetchSheets]);

  const sheetByUserId = useMemo(() => {
    const map: Record<string, TaskSheet | undefined> = {};
    for (const s of sheets) map[s.userId] = s;
    return map;
  }, [sheets]);

  const getItems = (userId: string, date: string) => {
    const sheet = sheetByUserId[userId];
    const items = sheet?.days?.[date];
    return Array.isArray(items) ? items : [];
  };

  const calculateDailyTotal = (userId: string, date: string) => {
    const items = getItems(userId, date);
    return items.reduce((sum, it) => sum + (typeof it.hours === 'number' ? it.hours : (parseFloat(it.hours) || 0)), 0);
  };

  const calculateMonthlyTotal = (userId: string) => {
    const sheet = sheetByUserId[userId];
    if (!sheet?.days) return 0;
    return Object.values(sheet.days).flat().reduce((sum, it) => sum + (typeof it.hours === 'number' ? it.hours : (parseFloat(it.hours) || 0)), 0);
  };

  const saveItem = async (userId: string, date: string, itemId: string, field: 'taskName' | 'hours', value: string | number) => {
    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      await axios.put('/api/tasks/item', { userId, date, itemId, field, value }, authHeader);
      socketRef.current?.emit('task_updated');
    } catch (err: any) {
      console.error('Error saving item:', err);
      addToast(err.response?.data?.message || '保存失败', 'error');
      fetchSheets();
    }
  };

  const debouncedSave = useDebounce(saveItem, 500);

  const handleItemChange = (userId: string, date: string, itemId: string, field: 'taskName' | 'hours', raw: string) => {
    setSheets(prev => {
      const next = prev.map(sheet => {
        if (sheet.userId !== userId) return sheet;
        const dayItems = Array.isArray(sheet.days?.[date]) ? sheet.days[date] : [];
        const idx = dayItems.findIndex(i => i.id === itemId);
        if (idx === -1) return sheet;
        const updatedItems = [...dayItems];
        if (field === 'hours') {
          updatedItems[idx] = { ...updatedItems[idx], hours: raw };
        } else {
          updatedItems[idx] = { ...updatedItems[idx], taskName: raw };
        }
        return { ...sheet, days: { ...sheet.days, [date]: updatedItems } };
      });
      return next;
    });

    const value = field === 'hours' ? (parseFloat(raw) || 0) : raw;
    debouncedSave(userId, date, itemId, field, value);
  };

  const addItem = async (userId: string, date: string) => {
    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      const res = await axios.post('/api/tasks/item', { userId, date }, authHeader);
      upsertSheet(res.data.sheet);
      socketRef.current?.emit('task_updated');
    } catch (err: any) {
      addToast('添加任务失败', 'error');
    }
  };

  const deleteItem = async (userId: string, date: string, itemId: string) => {
    if (!window.confirm('确定要删除这个任务吗？')) return;
    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      const res = await axios.delete('/api/tasks/item', { ...authHeader, data: { userId, date, itemId } });
      upsertSheet(res.data.sheet);
      socketRef.current?.emit('task_updated');
    } catch (err: any) {
      addToast('删除任务失败', 'error');
    }
  };

  const changeMonth = (offset: number) => {
    const newDate = new Date(currentDate);
    newDate.setMonth(newDate.getMonth() + offset);
    setCurrentDate(newDate);
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-50">
      <RefreshCw className="animate-spin text-blue-600 mb-4" size={48} />
      <div className="text-gray-600 font-medium">正在加载数据...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f3f3f3] flex flex-col font-sans">
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map(toast => (
          <div key={toast.id} className={`flex items-center gap-2 px-4 py-3 rounded shadow-lg text-white transition-all duration-300 ${toast.type === 'error' ? 'bg-red-600' : 'bg-green-600'}`}>
            {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        ))}
      </div>

      <header className="bg-[#217346] text-white px-6 py-2 flex items-center justify-between shadow-md">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2">
            <FileSpreadsheet size={24} />
            <h1 className="text-lg font-bold tracking-tight">Obara 工时管理系统</h1>
          </div>
          <div className="flex items-center bg-[#1a5c38] rounded p-0.5 ml-4">
            <button onClick={() => changeMonth(-1)} className="p-1 hover:bg-[#217346] rounded transition">
              <ChevronLeft size={18} />
            </button>
            <span className="px-4 font-bold text-sm min-w-[110px] text-center">{format(currentDate, 'yyyy年 MM月')}</span>
            <button onClick={() => changeMonth(1)} className="p-1 hover:bg-[#217346] rounded transition">
              <ChevronRight size={18} />
            </button>
          </div>
          {user?.role === 'admin' && (
            <div className="relative">
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="appearance-none bg-[#1a5c38] text-white text-sm font-medium px-3 py-1.5 pr-8 rounded border-none outline-none cursor-pointer hover:bg-[#237a47] transition"
              >
                <option value="all">全部人员</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-white/80" size={14} />
            </div>
          )}
        </div>

        <div className="flex items-center space-x-4">
          <div className="flex flex-col items-end">
            <span className="text-[10px] opacity-80 uppercase font-bold">Current User</span>
            <span className="text-sm font-bold">{user?.name}</span>
          </div>
          <div className="h-6 w-[1px] bg-white/20"></div>
          {user?.role === 'admin' && (
            <Link to="/admin" className="p-1.5 hover:bg-[#1a5c38] rounded transition" title="用户管理">
              <UserCog size={20} />
            </Link>
          )}
          <button onClick={logout} className="p-1.5 hover:bg-red-600 rounded transition" title="退出">
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4">
        <div className="bg-white shadow-sm border border-gray-300 inline-block min-w-full">
          <table className="border-collapse text-[12px] table-fixed w-max min-w-full">
            <thead>
              <tr className="bg-[#f8f9fa] text-gray-600 h-10">
                <th className="sticky left-0 z-30 bg-[#f8f9fa] border border-gray-300 w-32 font-bold text-center shadow-[1px_0_0_0_#d1d5db]">设计员</th>
                {days.map(d => (
                  <th key={d.fullDate} className={`border border-gray-300 w-60 text-center font-bold ${d.isWeekend ? 'bg-[#fff2cc]' : ''}`}>
                    <div className="text-[10px] opacity-60">{d.dayName}</div>
                    <div>{d.dayNum}</div>
                  </th>
                ))}
                <th className="sticky right-0 z-30 bg-[#f8f9fa] border border-gray-300 w-24 font-bold text-center shadow-[-1px_0_0_0_#d1d5db]">月总工时</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map(u => (
                <tr key={u.id} className="align-top hover:bg-blue-50/30">
                  <td className="sticky left-0 z-20 bg-white border border-gray-300 px-2 py-2 font-bold text-gray-800 text-center shadow-[1px_0_0_0_#d1d5db]">
                    {u.name}
                  </td>
                  {days.map(d => {
                    const items = getItems(u.id, d.fullDate);
                    const dailyTotal = calculateDailyTotal(u.id, d.fullDate);
                    return (
                      <td 
                        key={d.fullDate} 
                        className={`border border-gray-300 p-0 align-top ${d.isWeekend ? 'bg-[#fff2cc]/20' : ''} cursor-pointer hover:bg-blue-50 transition`}
                        onClick={() => openModal(u.id, d.fullDate)}
                      >
                        <div className="h-20 flex flex-col items-center justify-center gap-1">
                          {items.length > 0 ? (
                            <>
                              <div className="text-[10px] text-gray-500">{items.length} 条任务</div>
                              <div className="text-lg font-bold text-blue-700">{dailyTotal.toFixed(1)}</div>
                              <div className="text-[10px] text-gray-400">小时</div>
                            </>
                          ) : (
                            <div className="text-gray-300 text-xs">点击添加</div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="sticky right-0 z-20 bg-[#f8f9fa] border border-gray-300 px-2 py-2 font-bold text-center text-green-700 shadow-[-1px_0_0_0_#d1d5db]">
                    {calculateMonthlyTotal(u.id).toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 z-40 bg-gray-100 shadow-[0_-1px_0_0_#d1d5db]">
              <tr className="h-10">
                <th className="sticky left-0 z-30 bg-gray-100 border border-gray-300 px-2 font-bold text-gray-700 shadow-[1px_0_0_0_#d1d5db]">全员总计</th>
                {days.map(d => {
                  const dayTotal = filteredUsers.reduce((sum, u) => sum + calculateDailyTotal(u.id, d.fullDate), 0);
                  return (
                    <th key={d.fullDate} className="border border-gray-300 px-1 text-center font-black text-blue-800">
                      {dayTotal ? dayTotal.toFixed(1) : ''}
                    </th>
                  );
                })}
                <th className="sticky right-0 z-30 bg-gray-200 border border-gray-300 px-2 font-black text-center text-green-800 shadow-[-1px_0_0_0_#d1d5db]">
                  {filteredUsers.reduce((sum, u) => sum + calculateMonthlyTotal(u.id), 0).toFixed(1)}
                </th>
              </tr>
            </tfoot>
          </table>
        </div>
      </main>

      <footer className="bg-[#f3f3f3] border-t border-gray-300 px-4 py-1 flex justify-between items-center text-[11px] text-gray-500">
        <div className="flex items-center space-x-4">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-500"></div>
            <span>就绪</span>
          </div>
          <div className="w-[1px] h-3 bg-gray-300"></div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold">本月任务条目:</span>
            <span>{sheets.filter(s => filteredUsers.some(u => u.id === s.userId)).reduce((sum, s) => sum + Object.values(s.days || {}).flat().length, 0)} 条</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-medium">100%</span>
          <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div className="w-full h-full bg-blue-500"></div>
          </div>
        </div>
      </footer>

      {modalOpen && modalDate && modalUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModalOpen(false)} />
          <div className="relative bg-white rounded-lg shadow-2xl w-[500px] max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-[#217346] text-white rounded-t-lg">
              <div>
                <div className="font-bold text-lg">{users.find(u => u.id === modalUserId)?.name}</div>
                <div className="text-xs opacity-80">{modalDate}</div>
              </div>
              <button onClick={() => setModalOpen(false)} className="p-1 hover:bg-[#1a5c38] rounded transition">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <div className="flex flex-col gap-2">
                {getItems(modalUserId, modalDate).map(item => (
                  <div key={item.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded hover:bg-gray-100 transition">
                    <input
                      className="flex-1 h-8 px-3 bg-white border border-gray-300 rounded outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                      value={item.taskName}
                      onChange={(e) => handleItemChange(modalUserId, modalDate, item.id, 'taskName', e.target.value)}
                      placeholder="任务名称..."
                    />
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      className="w-20 h-8 text-center bg-white border border-gray-300 rounded outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      value={item.hours}
                      onChange={(e) => handleItemChange(modalUserId, modalDate, item.id, 'hours', e.target.value)}
                      placeholder="工时"
                    />
                    <span className="text-xs text-gray-500 w-8">小时</span>
                    <button
                      onClick={() => deleteItem(modalUserId, modalDate, item.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 transition"
                      title="删除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50 rounded-b-lg">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => addItem(modalUserId, modalDate)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-sm font-medium"
                >
                  <Plus size={16} /> 添加任务
                </button>
                <div className="text-sm font-bold text-gray-600 ml-2">
                  当日小计: <span className="text-blue-700">{calculateDailyTotal(modalUserId, modalDate).toFixed(1)}</span> 小时
                </div>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-1.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition text-sm font-medium"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
