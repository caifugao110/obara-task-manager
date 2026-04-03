import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { LogOut, UserCog, ChevronLeft, ChevronRight, RefreshCw, AlertCircle, CheckCircle, Plus, Trash2, FileSpreadsheet, ChevronDown, X } from 'lucide-react';
import { format, getDaysInMonth, startOfMonth, addDays, isWeekend } from 'date-fns';
import { useDebounce } from '../utils/debounce';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverEvent,
  DragOverlay,
  defaultDropAnimationSideEffects,
  useDroppable,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface GunItem {
  id: string;
  name: string;
  hours: number | string;
}

interface TaskItem {
  id: string;
  taskName: string;
  hours: number | string;
  color?: string;
  guns?: GunItem[];
}

interface TaskSheet {
  id: string;
  designerId: string;
  month: number;
  year: number;
  days: Record<string, TaskItem[]>;
}

interface Designer {
  id: string;
  name: string;
  group?: string;
}

interface User {
  id: string;
  username: string;
  name: string;
  role: 'superadmin' | 'admin';
}

const SortableTask = ({ item, designerId, date, isAdmin }: { item: TaskItem, designerId: string, date: string, isAdmin: boolean }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    data: {
      type: 'task',
      item,
      designerId,
      date,
    },
    disabled: !isAdmin,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    backgroundColor: item.color || 'transparent',
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      {...attributes} 
      {...listeners}
      className="grid grid-cols-[12rem_3rem] border-b border-gray-300 last:border-0 cursor-grab active:cursor-grabbing hover:bg-black/5"
    >
      {/* Main Task Row */}
      <div className="border-r border-gray-200 px-1.5 py-1 min-h-[24px] flex items-center break-all leading-tight text-[11px] font-medium pointer-events-none">
        {item.taskName || <span className="text-gray-300 italic">无</span>}
      </div>
      <div className="px-1 py-1 min-h-[24px] flex items-center justify-center font-mono text-blue-700 font-bold pointer-events-none">
        {item.guns && item.guns.length > 0 ? '' : item.hours}
      </div>

      {/* Gun Rows */}
      {(item.guns || []).map(gun => (
        <React.Fragment key={gun.id}>
          <div className="border-r border-gray-200 px-3 py-0.5 min-h-[17px] flex items-center text-[10px] text-gray-500 border-t border-gray-200/50 italic bg-black/5 pointer-events-none">
            - {gun.name || '未命名'}
          </div>
          <div className="px-1 py-0.5 min-h-[17px] flex items-center justify-center text-[10px] font-mono text-blue-500 border-t border-gray-200/50 bg-black/5 pointer-events-none">
            {gun.hours}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
};

const DroppableCell = ({ designerId, date, children, className, ...props }: any) => {
  const { setNodeRef } = useDroppable({
    id: `cell-${designerId}-${date}`,
    data: {
      type: 'cell',
      designerId,
      date,
    }
  });

  return (
    <td ref={setNodeRef} className={className} {...props}>
      {children}
    </td>
  );
};

interface Toast {
  message: string;
  type: 'success' | 'error';
  id: number;
}

const Dashboard = () => {
  const { user, token, logout } = useAuth();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [designers, setDesigners] = useState<Designer[]>([]);
  const [sheets, setSheets] = useState<TaskSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const [selectedDesignerId, setSelectedDesignerId] = useState<string>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDate, setModalDate] = useState<string | null>(null);
  const [modalDesignerId, setModalDesignerId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<TaskItem[] | null>(null);
  const [activeTask, setActiveTask] = useState<{item: TaskItem, designerId: string, date: string} | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    if (!isAdmin) return;
    const { active } = event;
    const data = active.data.current;
    if (data?.type === 'task') {
      setActiveTask({
        item: data.item,
        designerId: data.designerId,
        date: data.date,
      });
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null);
    if (!isAdmin) return;
    
    const { active, over } = event;
    if (!over) return;

    const sourceData = active.data.current;
    const targetData = over.data.current;

    if (!sourceData || !targetData) return;

    const sourceId = active.id as string;
    const sourceDesignerId = sourceData.designerId;
    const sourceDate = sourceData.date;
    
    let targetDesignerId = targetData.designerId;
    let targetDate = targetData.date;
    let newIndex: number | undefined = undefined;

    if (targetData.type === 'task') {
      const targetItems = getItems(targetDesignerId, targetDate);
      newIndex = targetItems.findIndex(i => i.id === over.id);
    }

    if (sourceDesignerId === targetDesignerId && sourceDate === targetDate && sourceId === over.id) {
       return;
    }

    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      await axios.post('/api/tasks/move', {
        sourceDesignerId,
        sourceDate,
        itemId: sourceId,
        targetDesignerId,
        targetDate,
        newIndex
      }, authHeader);
      
      socketRef.current?.emit('task_updated');
      fetchSheets();
      addToast('任务已移动', 'success');
    } catch (err: any) {
      addToast('移动失败', 'error');
    }
  };

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

  const filteredDesigners = useMemo(() => {
    if (selectedDesignerId === 'all') return designers;
    return designers.filter(d => d.id === selectedDesignerId);
  }, [designers, selectedDesignerId]);

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('collapsedGroups');
    return saved ? JSON.parse(saved) : {};
  });

  const toggleGroup = (group: string) => {
    setCollapsedGroups(prev => {
      const next = { ...prev, [group]: !prev[group] };
      localStorage.setItem('collapsedGroups', JSON.stringify(next));
      return next;
    });
  };

  const designersByGroup = useMemo(() => {
    const groups: Record<string, Designer[]> = {};
    filteredDesigners.forEach(d => {
      const g = d.group || '未分组';
      if (!groups[g]) groups[g] = [];
      groups[g].push(d);
    });
    return groups;
  }, [filteredDesigners]);

  const sortedGroups = useMemo(() => Object.keys(designersByGroup).sort(), [designersByGroup]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalOpen) {
        setModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [modalOpen]);

  const openModal = (designerId: string, date: string) => {
    setModalDesignerId(designerId);
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
      const next = prev.filter(s => !(s.designerId === incoming.designerId && s.month === incoming.month && s.year === incoming.year));
      next.push(incoming);
      return next;
    });
  }, []);

  const fetchSheets = useCallback(async () => {
    try {
      const authHeader = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
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
      const designersRes = await axios.get('/api/designers');
      setDesigners(designersRes.data);
      await fetchSheets();
    } catch (err: any) {
      console.error('Error fetching data:', err);
      addToast('数据加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [fetchSheets]);

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

  const sheetByDesignerId = useMemo(() => {
    const map: Record<string, TaskSheet | undefined> = {};
    for (const s of sheets) map[s.designerId] = s;
    return map;
  }, [sheets]);

  const getItems = (designerId: string, date: string) => {
    const sheet = sheetByDesignerId[designerId];
    const items = sheet?.days?.[date];
    return Array.isArray(items) ? items : [];
  };

  const calculateDailyTotal = (designerId: string, date: string) => {
    const items = getItems(designerId, date);
    return items.reduce((sum, it) => {
      const mainHours = typeof it.hours === 'number' ? it.hours : (parseFloat(it.hours) || 0);
      const gunsHours = (it.guns || []).reduce((gSum, g) => gSum + (typeof g.hours === 'number' ? g.hours : (parseFloat(g.hours) || 0)), 0);
      return sum + (it.guns && it.guns.length > 0 ? gunsHours : mainHours);
    }, 0);
  };

  const calculateMonthlyTotal = (designerId: string) => {
    const sheet = sheetByDesignerId[designerId];
    if (!sheet?.days) return 0;
    return Object.entries(sheet.days).reduce((sum, [date]) => sum + calculateDailyTotal(designerId, date), 0);
  };

  const saveItem = async (designerId: string, date: string, itemId: string, field: 'taskName' | 'hours' | 'color' | 'guns', value: any) => {
    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      await axios.put('/api/tasks/item', { designerId, date, itemId, field, value }, authHeader);
      socketRef.current?.emit('task_updated');
    } catch (err: any) {
      console.error('Error saving item:', err);
      addToast(err.response?.data?.message || '保存失败', 'error');
      fetchSheets();
    }
  };

  const debouncedSave = useDebounce(saveItem, 500);

  const handleItemChange = (designerId: string, date: string, itemId: string, field: 'taskName' | 'hours' | 'color' | 'guns', raw: any) => {
    setSheets(prev => {
      const next = prev.map(sheet => {
        if (sheet.designerId !== designerId) return sheet;
        const dayItems = Array.isArray(sheet.days?.[date]) ? sheet.days[date] : [];
        const idx = dayItems.findIndex(i => i.id === itemId);
        if (idx === -1) return sheet;
        const updatedItems = [...dayItems];
        updatedItems[idx] = { ...updatedItems[idx], [field]: raw };
        return { ...sheet, days: { ...sheet.days, [date]: updatedItems } };
      });
      return next;
    });

    let value = raw;
    if (field === 'hours') value = (parseFloat(raw) || 0);
    
    if (field === 'color' || field === 'guns') {
      saveItem(designerId, date, itemId, field, value);
    } else {
      debouncedSave(designerId, date, itemId, field, value);
    }
  };

  const addItem = async (designerId: string, date: string) => {
    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      const res = await axios.post('/api/tasks/item', { designerId, date }, authHeader);
      upsertSheet(res.data.sheet);
      socketRef.current?.emit('task_updated');
    } catch (err: any) {
      addToast('添加任务失败', 'error');
    }
  };

  const deleteItem = async (designerId: string, date: string, itemId: string) => {
    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      const res = await axios.delete('/api/tasks/item', { ...authHeader, data: { designerId, date, itemId } });
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

  const PRESET_COLORS = [
    { label: '无', value: '' },
    { label: '淡红', value: '#fee2e2' },
    { label: '淡绿', value: '#dcfce7' },
    { label: '淡蓝', value: '#dbeafe' },
    { label: '淡黄', value: '#fef9c3' },
    { label: '淡紫', value: '#f3e8ff' },
    { label: '淡橙', value: '#ffedd5' },
    { label: '深红', value: '#fca5a5' },
    { label: '深绿', value: '#86efac' },
    { label: '深蓝', value: '#93c5fd' },
    { label: '深黄', value: '#fde047' },
    { label: '深紫', value: '#d8b4fe' },
    { label: '深橙', value: '#fdba74' },
    { label: '粉色', value: '#f9a8d4' },
    { label: '青色', value: '#67e8f9' },
    { label: '灰色', value: '#e5e7eb' },
  ];

  const handleCopy = (designerId: string, date: string) => {
    const items = getItems(designerId, date);
    if (items.length > 0) {
      setClipboard(items);
      addToast('已复制该单元格内容', 'success');
    }
  };

  const handlePaste = async (designerId: string, date: string) => {
    if (!clipboard || !user) return;
    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      for (const item of clipboard) {
        await axios.post('/api/tasks/item', { 
          designerId, 
          date, 
          taskName: item.taskName, 
          hours: item.hours, 
          color: item.color,
          guns: item.guns 
        }, authHeader);
      }
      addToast('已粘贴任务内容', 'success');
      fetchSheets();
      socketRef.current?.emit('task_updated');
    } catch (err) {
      addToast('粘贴失败', 'error');
    }
  };

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

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
            <h1 className="text-lg font-bold tracking-tight">Obara 任务管理系统</h1>
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
          {(!user || user.role === 'admin' || user.role === 'superadmin') && (
            <div className="relative">
              <select
                value={selectedDesignerId}
                onChange={(e) => setSelectedDesignerId(e.target.value)}
                className="appearance-none bg-[#1a5c38] text-white text-sm font-medium px-3 py-1.5 pr-8 rounded border-none outline-none cursor-pointer hover:bg-[#237a47] transition"
              >
                <option value="all">全部人员</option>
                {designers.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-white/80" size={14} />
            </div>
          )}
        </div>

        <div className="flex items-center space-x-4">
          {user ? (
            <>
              <div className="flex flex-col items-end">
                <span className="text-[10px] opacity-80 uppercase font-bold">Current User</span>
                <span className="text-sm font-bold">{user.name}</span>
              </div>
              <div className="h-6 w-[1px] bg-white/20"></div>
              {isAdmin && (
                <Link to="/admin" className="p-1.5 hover:bg-[#1a5c38] rounded transition" title="用户管理">
                  <UserCog size={20} />
                </Link>
              )}
              <button onClick={logout} className="p-1.5 hover:bg-red-600 rounded transition" title="退出">
                <LogOut size={20} />
              </button>
            </>
          ) : (
            <Link to="/login" className="px-4 py-1.5 bg-[#1a5c38] hover:bg-[#237a47] rounded text-sm font-bold transition">
              登录编辑
            </Link>
          )}
        </div>
      </header>

      <DndContext 
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <main className="flex-1 overflow-auto p-4">
          <div className="bg-white shadow-sm border border-gray-300 inline-block min-w-full">
            <table className="border-collapse text-[12px] table-fixed w-max min-w-full">
              <thead>
                <tr className="bg-[#f8f9fa] text-gray-600 h-10">
                  <th className="sticky left-0 z-30 bg-[#f8f9fa] border border-gray-300 w-32 font-bold text-center shadow-[1px_0_0_0_#d1d5db]">设计员</th>
                  {days.map(d => (
                    <th key={d.fullDate} colSpan={2} className={`border border-gray-300 min-w-[240px] text-center font-bold ${d.isWeekend ? 'bg-[#fff2cc]' : ''}`}>
                      <div className="text-[10px] opacity-60">{d.dayName}</div>
                      <div>{d.dayNum}</div>
                    </th>
                  ))}
                  <th className="sticky right-0 z-30 bg-[#f8f9fa] border border-gray-300 w-24 font-bold text-center shadow-[-1px_0_0_0_#d1d5db]">月总工时</th>
                </tr>
                <tr className="bg-[#f8f9fa] text-gray-500 text-[10px] h-6">
                  <th className="sticky left-0 z-30 bg-[#f8f9fa] border border-gray-300 shadow-[1px_0_0_0_#d1d5db]"></th>
                  {days.map(d => (
                    <React.Fragment key={`sub-${d.fullDate}`}>
                      <th className={`border border-gray-300 w-48 ${d.isWeekend ? 'bg-[#fff2cc]/50' : ''}`}>任务内容</th>
                      <th className={`border border-gray-300 w-12 ${d.isWeekend ? 'bg-[#fff2cc]/50' : ''}`}>工时</th>
                    </React.Fragment>
                  ))}
                  <th className="sticky right-0 z-30 bg-[#f8f9fa] border border-gray-300 shadow-[-1px_0_0_0_#d1d5db]"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {sortedGroups.map(group => (
                  <React.Fragment key={group}>
                    <tr className="bg-gray-200/80 cursor-pointer hover:bg-gray-300 transition-colors" onClick={() => toggleGroup(group)}>
                      <td 
                        className="sticky left-0 z-30 bg-gray-200 border border-gray-300 px-3 py-1.5 font-black text-gray-700 shadow-[1px_0_0_0_#d1d5db]"
                        colSpan={1 + (days.length * 2) + 1}
                      >
                        <div className="flex items-center gap-2">
                          {collapsedGroups[group] ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                          <span>{group}</span>
                          <span className="text-[10px] font-normal opacity-60 ml-2">({designersByGroup[group].length} 人)</span>
                        </div>
                      </td>
                    </tr>

                    {!collapsedGroups[group] && designersByGroup[group].map(d => (
                      <React.Fragment key={d.id}>
                        <tr className="align-top hover:bg-blue-50/20 group/row transition-colors">
                          <td className="sticky left-0 z-20 bg-white border border-gray-300 px-2 py-3 font-bold text-gray-800 text-center shadow-[1px_0_0_0_#d1d5db] group-hover/row:bg-blue-50/40">
                            {d.name}
                          </td>
                          {days.map(day => {
                            const items = getItems(d.id, day.fullDate);
                            return (
                              <DroppableCell 
                                key={`${d.id}-${day.fullDate}`}
                                designerId={d.id}
                                date={day.fullDate}
                                colSpan={2}
                                className={`border border-gray-300 p-0 align-top ${day.isWeekend ? 'bg-[#fff2cc]/10' : ''} min-h-[40px] relative group/cell`}
                                onContextMenu={(e: any) => {
                                  if (!user) return;
                                  e.preventDefault();
                                  handleCopy(d.id, day.fullDate);
                                }}
                                onClick={(e: any) => {
                                  if (!user) return;
                                  if (e.ctrlKey) {
                                    handlePaste(d.id, day.fullDate);
                                  } else {
                                    openModal(d.id, day.fullDate);
                                  }
                                }}
                                title={user ? "左键:编辑 | Ctrl+左键:粘贴 | 右键:复制" : ""}
                              >
                                <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
                                  <div className="flex flex-col min-h-[40px]">
                                    {items.map(item => (
                                      <SortableTask key={item.id} item={item} designerId={d.id} date={day.fullDate} isAdmin={isAdmin} />
                                    ))}
                                    {user && (
                                      <div 
                                        className="h-[24px] flex items-center justify-center text-gray-300 opacity-0 group-hover/cell:opacity-100 transition-opacity cursor-pointer hover:bg-blue-50/50"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openModal(d.id, day.fullDate);
                                        }}
                                      >
                                        <Plus size={14} />
                                      </div>
                                    )}
                                  </div>
                                </SortableContext>
                              </DroppableCell>
                            );
                          })}
                          <td className="sticky right-0 z-20 bg-[#f8f9fa] border border-gray-300 px-2 py-3 font-bold text-center text-green-700 shadow-[-1px_0_0_0_#d1d5db] group-hover/row:bg-green-50/40">
                            {calculateMonthlyTotal(d.id).toFixed(1)}
                          </td>
                        </tr>
                        <tr className="bg-blue-50/10 text-[10px]">
                          <td className="sticky left-0 z-20 bg-blue-50/30 border border-gray-300 px-2 py-0.5 font-bold text-gray-500 text-right shadow-[1px_0_0_0_#d1d5db]">
                            当日合计
                          </td>
                          {days.map(day => (
                            <td key={`total-${d.id}-${day.fullDate}`} colSpan={2} className={`border border-gray-300 px-1 py-0.5 text-center font-bold text-blue-600 ${day.isWeekend ? 'bg-[#fff2cc]/20' : ''}`}>
                              {calculateDailyTotal(d.id, day.fullDate) || ''}
                            </td>
                          ))}
                          <td className="sticky right-0 z-20 bg-blue-50/30 border border-gray-300 shadow-[-1px_0_0_0_#d1d5db]"></td>
                        </tr>
                      </React.Fragment>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </main>

        <DragOverlay>
          {activeTask && (
            <div className="flex border border-blue-400 shadow-2xl rounded opacity-90 scale-105 bg-white overflow-hidden">
              <div className="w-48 border-r border-gray-200 flex flex-col bg-white">
                <div className="px-1.5 py-1 min-h-[24px] flex items-center break-all leading-tight text-[11px] font-medium">
                  {activeTask.item.taskName || '无'}
                </div>
              </div>
              <div className="w-12 flex flex-col bg-white">
                <div className="px-1 py-1 min-h-[24px] flex items-center justify-center font-mono text-blue-700 font-bold">
                  {activeTask.item.guns && activeTask.item.guns.length > 0 ? '' : activeTask.item.hours}
                </div>
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <footer className="bg-[#f3f3f3] border-t border-gray-300 px-4 py-1 flex justify-between items-center text-[11px] text-gray-500">
        <div className="flex items-center space-x-4">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-500"></div>
            <span>就绪</span>
          </div>
          <div className="w-[1px] h-3 bg-gray-300"></div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold">本月任务条目:</span>
            <span>{sheets.filter(s => filteredDesigners.some(d => d.id === s.designerId)).reduce((sum, s) => sum + Object.values(s.days || {}).flat().length, 0)} 条</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-medium">100%</span>
          <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div className="w-full h-full bg-blue-500"></div>
          </div>
        </div>
      </footer>

      {modalOpen && modalDate && modalDesignerId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModalOpen(false)} />
          <div className="relative bg-white rounded-lg shadow-2xl w-[960px] max-w-[96vw] max-h-[90vh] flex flex-col border-2 border-gray-200">
            <div className="flex items-center justify-between px-4 py-3 border-b-2 border-gray-200 bg-[#217346] text-white rounded-t-lg">
              <div>
                <div className="font-bold text-lg">{designers.find(d => d.id === modalDesignerId)?.name}</div>
                <div className="text-xs opacity-80">{modalDate}</div>
              </div>
              <button onClick={() => setModalOpen(false)} className="p-1 hover:bg-[#1a5c38] rounded transition">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-gray-100/50">
              {(() => {
                const items = getItems(modalDesignerId, modalDate);
                return (
                  <div className={items.length > 3 ? "grid grid-cols-2 gap-4 min-w-0" : "flex flex-col gap-4 min-w-0"}>
                    {items.map(item => {
                      const hasGuns = item.guns && item.guns.length > 0;
                      return (
                        <div key={item.id} className="flex flex-col gap-2 p-4 bg-white rounded-xl border-2 border-gray-200 shadow-sm hover:border-blue-300 transition group/item h-fit min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">任务内容</label>
                              <input
                                className="w-full h-10 px-3 bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white transition"
                                value={item.taskName}
                                onChange={(e) => handleItemChange(modalDesignerId, modalDate, item.id, 'taskName', e.target.value)}
                                placeholder="输入主任务名称..."
                              />
                            </div>
                            <div className="w-24">
                              <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">总工时</label>
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                className={`w-full h-10 text-center bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 transition font-bold text-blue-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${hasGuns ? 'opacity-50 cursor-not-allowed' : 'focus:bg-white'}`}
                                value={hasGuns ? (item.guns || []).reduce((sum, g) => sum + (parseFloat(g.hours as string) || 0), 0) : item.hours}
                                onChange={(e) => !hasGuns && handleItemChange(modalDesignerId, modalDate, item.id, 'hours', e.target.value)}
                                disabled={hasGuns}
                                placeholder="工时"
                              />
                            </div>
                            <button
                              onClick={() => deleteItem(modalDesignerId, modalDate, item.id)}
                              className="mt-4 p-2 text-gray-300 hover:text-red-600 transition"
                              title="删除任务"
                            >
                              <Trash2 size={20} />
                            </button>
                          </div>

                          {/* Guns Section */}
                          <div className="mt-2 pl-4 border-l-2 border-gray-100 flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">子任务 (枪名)</span>
                              <button 
                                onClick={() => {
                                  const newGuns = [...(item.guns || []), { id: `gun-${Date.now()}`, name: '', hours: 0 }];
                                  handleItemChange(modalDesignerId, modalDate, item.id, 'guns', newGuns);
                                }}
                                className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-100 transition font-bold"
                              >
                                + 添加枪名
                              </button>
                            </div>
                            {(item.guns || []).map((gun, gIdx) => (
                              <div key={gun.id} className="flex items-center gap-2 bg-gray-50/50 p-2 rounded-lg group/gun">
                                <input 
                                  className="flex-1 h-8 px-2 bg-transparent border-b-2 border-gray-200 focus:border-blue-400 outline-none text-xs transition"
                                  value={gun.name}
                                  placeholder="枪名..."
                                  onChange={(e) => {
                                    const newGuns = [...(item.guns || [])];
                                    newGuns[gIdx] = { ...newGuns[gIdx], name: e.target.value };
                                    handleItemChange(modalDesignerId, modalDate, item.id, 'guns', newGuns);
                                  }}
                                />
                                <input 
                                  type="number"
                                  step="0.5"
                                  min="0"
                                  className="w-16 h-8 text-center bg-transparent border-b-2 border-gray-200 focus:border-blue-400 outline-none text-xs font-bold text-blue-600 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  value={gun.hours}
                                  placeholder="工时"
                                  onChange={(e) => {
                                    const newGuns = [...(item.guns || [])];
                                    newGuns[gIdx] = { ...newGuns[gIdx], hours: parseFloat(e.target.value) || 0 };
                                    handleItemChange(modalDesignerId, modalDate, item.id, 'guns', newGuns);
                                  }}
                                />
                                <button 
                                  onClick={() => {
                                    const newGuns = (item.guns || []).filter((_, i) => i !== gIdx);
                                    handleItemChange(modalDesignerId, modalDate, item.id, 'guns', newGuns);
                                  }}
                                  className="p-1 text-red-400 hover:text-red-600 transition"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            ))}
                          </div>

                          {isAdmin && (
                            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-50">
                              <span className="text-[10px] text-gray-400 font-bold uppercase">标记颜色:</span>
                              <div className="flex flex-wrap gap-1.5">
                                {PRESET_COLORS.map(c => (
                                  <button
                                    key={c.value}
                                    onClick={() => handleItemChange(modalDesignerId, modalDate, item.id, 'color', c.value)}
                                    className={`w-5 h-5 rounded-full border border-gray-200 transition-all hover:scale-110 ${item.color === c.value ? 'ring-2 ring-blue-500 ring-offset-1 scale-110 shadow-sm' : 'opacity-60 hover:opacity-100'}`}
                                    style={{ backgroundColor: c.value || '#fff' }}
                                    title={c.label}
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t-2 border-gray-200 bg-gray-50 rounded-b-lg">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => addItem(modalDesignerId, modalDate)}
                  className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-bold shadow-lg shadow-blue-100"
                >
                  <Plus size={18} /> 添加任务
                </button>
                <div className="text-sm font-bold text-gray-600 ml-4">
                  当日总工时: <span className="text-blue-700 text-lg ml-1">{calculateDailyTotal(modalDesignerId, modalDate).toFixed(1)}</span> H
                </div>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="px-6 py-2 bg-white border-2 border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm font-bold shadow-sm"
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
