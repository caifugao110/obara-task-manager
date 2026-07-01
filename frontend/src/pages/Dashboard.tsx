import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { Link, useLocation } from 'react-router-dom';
import { LogOut, UserCog, ChevronLeft, ChevronRight, RefreshCw, AlertCircle, CheckCircle, Plus, Trash2, FileSpreadsheet, ChevronDown, X, Trophy, GripVertical, Clock, Settings } from 'lucide-react';
import { format, getDaysInMonth, startOfMonth, addDays, isWeekend } from 'date-fns';
import { useDebounce } from '../utils/debounce';
import {
    DndContext,
    rectIntersection,
    pointerWithin,
    PointerSensor,
    KeyboardSensor,
    useSensor,
    useSensors,
    CollisionDetection,
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
  leaveType?: 'sick' | 'vacation' | 'illness' | 'trip' | null;
  createdAt?: string;
  createdBy?: { id: string; username: string; name: string };
  updatedAt?: string;
  updatedBy?: { id: string; username: string; name: string };
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
  hidden?: boolean;
}

interface User {
  id: string;
  username: string;
  name: string;
  role: 'superadmin' | 'admin' | 'user';
}

type TaskField = 'taskName' | 'hours' | 'color' | 'guns' | 'leaveType';

type PendingChange = {
  designerId: string;
  date: string;
  itemId: string;
  field: TaskField;
  value: any;
};

const defaultAccessSettings = { enabled: true, allowAdmins: true, allowViewers: false };

type SelectedTask = { itemId: string; designerId: string; date: string };

const taskSelectionKey = (selection: SelectedTask) => `${selection.designerId}__${selection.date}__${selection.itemId}`;

const SortableTask = ({ item, designerId, date, isAdmin, onTaskClick, onDeleteGun, onDeleteTask, selectedTasks, onSelectTask, metadataTitle }: { item: TaskItem, designerId: string, date: string, isAdmin: boolean, onTaskClick: (item: TaskItem, designerId: string, date: string, type: 'task' | 'hours' | 'gun' | 'gunHours', gunIndex?: number) => void, onDeleteGun: (item: TaskItem, designerId: string, date: string, gunIndex: number) => void, onDeleteTask: (item: TaskItem, designerId: string, date: string) => void, selectedTasks: SelectedTask[], onSelectTask: (itemId: string, designerId: string, date: string, append: boolean) => void, metadataTitle: string }) => {
  const currentSelection = { itemId: item.id, designerId, date };
  const isSelected = selectedTasks.some(selection => taskSelectionKey(selection) === taskSelectionKey(currentSelection));

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
    disabled: !isAdmin || !isSelected,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    backgroundColor: item.color || 'transparent',
    opacity: isDragging ? 0.3 : 1,
    border: isSelected ? '2px solid #3b82f6' : '1px solid transparent',
    borderRadius: isSelected ? '4px' : '0',
  };

  const getTypeStyle = () => {
    if (item.leaveType === 'sick') return { backgroundColor: '#fee2e2' };
    if (item.leaveType === 'vacation') return { backgroundColor: '#dbeafe' };
    if (item.leaveType === 'illness') return { backgroundColor: '#fce7f3' };
    if (item.leaveType === 'trip') return { backgroundColor: '#fef9c3' };
    return {};
  };

  const typeLabel = (() => {
    if (item.leaveType === 'sick') return '事假';
    if (item.leaveType === 'vacation') return '休假';
    if (item.leaveType === 'illness') return '病假';
    if (item.leaveType === 'trip') {
      const name = (item.taskName || '').trim();
      if (!name) return '出差';
      return name.endsWith('出差') ? name : `${name}出差`;
    }
    return '';
  })();

  const isLeaveType = item.leaveType === 'sick' || item.leaveType === 'vacation' || item.leaveType === 'illness';

  return (
    <div
      ref={setNodeRef}
      data-task-id={item.id}
      data-designer-id={designerId}
      data-date={date}
      title={isAdmin ? metadataTitle : undefined}
      style={{ ...style, ...getTypeStyle() }}
      {...attributes}
      {...listeners}

      onKeyDown={(e: any) => {
        if (isAdmin) {
          if (e.key === 'Delete') {
            e.preventDefault();
            onDeleteTask(item, designerId, date);
          } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
            e.preventDefault();
            const copyEvent = new CustomEvent('task-copy', { detail: { item, designerId, date } });
            window.dispatchEvent(copyEvent);
          } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
            e.preventDefault();
            const cutEvent = new CustomEvent('task-cut', { detail: { item, designerId, date } });
            window.dispatchEvent(cutEvent);
          } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
            e.preventDefault();
            const pasteEvent = new CustomEvent('task-paste', { detail: { item, designerId, date } });
            window.dispatchEvent(pasteEvent);
          }
        }
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (isAdmin) {
          onSelectTask(item.id, designerId, date, e.ctrlKey || e.metaKey);
        }
      }}
      onDoubleClick={(e) => {
        if (e.ctrlKey || e.metaKey) return;
        e.stopPropagation();
        if (isAdmin) {
          onTaskClick(item, designerId, date, 'task');
        }
      }}
      tabIndex={isAdmin ? 0 : -1}
      className={`grid grid-cols-[12rem_3rem] border-b border-gray-300 last:border-0 cursor-grab active:cursor-grabbing hover:bg-black/5 ${isLeaveType ? 'opacity-90' : ''} ${isSelected ? 'bg-blue-50/30' : ''}`}
    >
      {/* Main Task Row */}
      <div
        className={`px-1.5 py-1 min-h-[24px] flex items-center break-all leading-tight text-[11px] font-medium hover:bg-blue-50/50 transition cursor-pointer ${isLeaveType ? 'border-r border-gray-300' : 'border-r border-gray-200'}`}
      >
        <div className={`flex items-center ${item.leaveType ? 'justify-center' : 'justify-start'} w-full px-1`}>
            {typeLabel ? (
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${item.leaveType === 'sick' ? 'bg-red-100 text-red-700' : item.leaveType === 'vacation' ? 'bg-blue-100 text-blue-700' : item.leaveType === 'illness' ? 'bg-pink-100 text-pink-700' : 'bg-yellow-100 text-yellow-800'}`}>
                {typeLabel}
              </span>
            ) : (
              item.taskName || <span className="text-gray-300 italic">无</span>
            )}
          </div>
      </div>
      <div 
        className="px-1 py-1 min-h-[24px] flex items-center justify-center font-mono text-blue-700 font-bold hover:bg-blue-50/50 transition cursor-pointer"
      >
        {item.guns && item.guns.length > 0 ? '' : item.hours}
      </div>

      {/* Gun Rows */}
      {(item.guns || []).map((gun, index) => (
        <React.Fragment key={gun.id}>
          <div 
            className="border-r border-gray-200 px-3 py-1 min-h-[24px] flex items-center text-[11px] font-medium border-t border-gray-200/50 hover:bg-blue-50/50 transition cursor-pointer group/gun-row"
          >
            <div className="flex-1">{gun.name || '未命名'}</div>
             {isAdmin && (
               <button 
                 className="opacity-0 group-hover/gun-row:opacity-100 p-0.5 text-gray-300 hover:text-red-500 transition-opacity"
                 onClick={(e) => {
                   e.stopPropagation();
                   onDeleteGun(item, designerId, date, index);
                 }}
               >
                 <Trash2 size={12} />
               </button>
             )}
            </div>
          <div 
            className="px-1 py-1 min-h-[24px] flex items-center justify-center font-mono text-blue-700 font-bold border-t border-gray-200/50 hover:bg-blue-50/50 transition cursor-pointer"
          >
            {gun.hours}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
};

const SortableDesignerTbody = ({ designer, isAdmin, children }: { designer: Designer, isAdmin: boolean, children: (args: { attributes: any, listeners: any, isDragging: boolean }) => React.ReactNode }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `designer-${designer.id}`,
    data: {
      type: 'designer',
      designerId: designer.id,
      group: designer.group || '未分组',
    },
    disabled: !isAdmin,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <tbody ref={setNodeRef} style={style}>
      {children({ attributes, listeners, isDragging })}
    </tbody>
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
  const location = useLocation();
  const jumpTarget = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const date = params.get('date');
    const designerId = params.get('designerId');
    const itemId = params.get('itemId');
    if (!date || !designerId || !itemId) return null;
    return { date, designerId, itemId };
  }, [location.search]);
  const [currentDate, setCurrentDate] = useState(() => {
    if (jumpTarget?.date) {
      const [year, month] = jumpTarget.date.split('-').map(Number);
      if (year && month) return new Date(year, month - 1, 1);
    }
    return new Date();
  });
  const [designers, setDesigners] = useState<Designer[]>([]);
  const [sheets, setSheets] = useState<TaskSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [systemSettingsLoaded, setSystemSettingsLoaded] = useState(false);
  const [allowGuestView, setAllowGuestView] = useState(true);
  const [leaderboardAccess, setLeaderboardAccess] = useState(defaultAccessSettings);
  const [workHoursAccess, setWorkHoursAccess] = useState(defaultAccessSettings);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const [selectedDesignerId, setSelectedDesignerId] = useState<string>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDate, setModalDate] = useState<string | null>(null);
  const [modalDesignerId, setModalDesignerId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<TaskItem[] | null>(null);
  const clipboardRef = useRef<TaskItem[] | null>(null);
  useEffect(() => {
    clipboardRef.current = clipboard;
  }, [clipboard]);
  const [activeTask, setActiveTask] = useState<{item: TaskItem, designerId: string, date: string, isCtrlDrag?: boolean} | null>(null);
  const [focusTarget, setFocusTarget] = useState<{itemId: string, type: 'task' | 'hours' | 'gun' | 'gunHours', gunIndex?: number} | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isOverDelete, setIsOverDelete] = useState(false);
  const lastOverIdRef = useRef<string | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<SelectedTask[]>([]);
  const selectedTasksRef = useRef<SelectedTask[]>([]);
  useEffect(() => {
    selectedTasksRef.current = selectedTasks;
  }, [selectedTasks]);
  const [selectedCell, setSelectedCell] = useState<{designerId: string, date: string} | null>(null);
  const [editingUser, setEditingUser] = useState<{designerId: string, date: string, username: string, name: string} | null>(null);
  const [history, setHistory] = useState<{operation: string, data: any, timestamp: number}[]>([]);
  const [tableHeight, setTableHeight] = useState<number>(0);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const handledJumpKeyRef = useRef<string | null>(null);

  // Calculate table height dynamically
  useEffect(() => {
    const calculateHeight = () => {
      const viewportHeight = window.innerHeight;
      const headerHeight = 56; // Header height
      const footerHeight = 36; // Footer height
      const padding = 8; // Bottom padding only
      const scrollbarHeight = 8; // Scrollbar height (minimal)
      const calculatedHeight = viewportHeight - headerHeight - footerHeight - padding - scrollbarHeight;
      setTableHeight(calculatedHeight);
    };

    calculateHeight();
    window.addEventListener('resize', calculateHeight);
    return () => window.removeEventListener('resize', calculateHeight);
  }, []);

  // Input refs for modal focus
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const collisionDetection: CollisionDetection = useCallback((args) => {
    const pointer = pointerWithin(args);
    if (pointer.length) return pointer;
    return rectIntersection(args);
  }, []);



  const handleDragStart = (event: DragStartEvent) => {
    if (!isAdmin) return;
    const { active, active: { data } } = event;
    const data_current = data.current;
    
    const isCtrlDrag = event.activatorEvent && 
      (event.activatorEvent as MouseEvent | KeyboardEvent).ctrlKey;
    
    if (data_current?.type === 'task') {
      setActiveTask({
        item: data_current.item,
        designerId: data_current.designerId,
        date: data_current.date,
        isCtrlDrag,
      });
      setIsDragging(true);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (!isAdmin) return;
    const { active, over } = event;
    const activeType = active.data.current?.type;
    if (activeType !== 'task') {
      setIsOverDelete(false);
      return;
    }
    lastOverIdRef.current = over?.id ? String(over.id) : null;
    setIsOverDelete(over?.id === 'delete-area');
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setIsDragging(false);

    const sourceData = active.data.current;
    const targetData = over?.data.current;

    if (!isAdmin) return;

    const isCtrlDrag = activeTask?.isCtrlDrag;

    if (isCtrlDrag && sourceData?.type === 'task' && targetData?.type === 'cell') {
      try {
        const authHeader = { headers: { Authorization: `Bearer ${token}` } };
        const payloads = getSelectedTaskPayloads({ item: sourceData.item, designerId: sourceData.designerId, date: sourceData.date });
        const res = await axios.post('/api/tasks/item/batch', { 
          designerId: targetData.designerId, 
          date: targetData.date, 
          items: payloads.map(payload => payload.item)
        }, authHeader);
        addToHistory('batchAdd', {
          items: (res.data.items || []).map((created: TaskItem) => ({ designerId: targetData.designerId, date: targetData.date, itemId: created.id }))
        });
        upsertSheet(res.data.sheet);
        socketRef.current?.emit('task_updated');
        setActiveTask(null);
        addToast('任务已复制', 'success');
        return;
      } catch (err: any) {
        addToast('复制失败', 'error');
        setActiveTask(null);
        return;
      }
    }

    if (sourceData?.type === 'designer' && targetData?.type === 'designer') {
      const group = sourceData.group;
      if (group !== targetData.group) return;

      const groupIds = designers.filter(d => (d.group || '未分组') === group).map(d => d.id);
      const oldIndex = groupIds.indexOf(sourceData.designerId);
      const newIndex = groupIds.indexOf(targetData.designerId);
      if (oldIndex === -1 || newIndex === -1) return;

      const nextGroupIds = arrayMove(groupIds, oldIndex, newIndex);
      const groupOf = new Map(designers.map(d => [d.id, d.group || '未分组']));
      let ptr = 0;
      const nextIds = designers.map(d => d.id).map(id => (groupOf.get(id) === group ? nextGroupIds[ptr++] : id));

      const byId = new Map(designers.map(d => [d.id, d]));
      const nextDesigners = nextIds.map(id => byId.get(id)).filter(Boolean) as Designer[];
      setDesigners(nextDesigners);

      try {
        const authHeader = { headers: { Authorization: `Bearer ${token}` } };
        await axios.post('/api/designers/reorder', { ids: nextIds }, authHeader);
        addToast('排序已保存', 'success');
      } catch (err) {
        addToast('排序保存失败', 'error');
        fetchData();
      } finally {
        setActiveTask(null);
      }
      return;
    }

    if (!over || !sourceData || !targetData) {
      setActiveTask(null);
      return;
    }

    // Regular move operation (without Ctrl)
    if (sourceData?.type === 'task' && targetData?.type === 'cell') {
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
         setActiveTask(null);
         return;
      }

      try {
        const authHeader = { headers: { Authorization: `Bearer ${token}` } };
        const payloads = getSelectedTaskPayloads({ item: sourceData.item, designerId: sourceDesignerId, date: sourceDate });
        const movedPayloads = payloads.filter(payload => !(payload.designerId === targetDesignerId && payload.date === targetDate && payload.item.id === over.id));
        if (movedPayloads.length === 0) {
          setActiveTask(null);
          return;
        }

        for (const payload of movedPayloads) {
          await axios.post('/api/tasks/move', {
            sourceDesignerId: payload.designerId,
            sourceDate: payload.date,
            itemId: payload.item.id,
            targetDesignerId,
            targetDate,
            newIndex: movedPayloads.length === 1 ? newIndex : undefined
          }, authHeader);
        }
        
        // Add to history for undo
        addToHistory('batchMove', {
          items: movedPayloads.map(payload => ({
            sourceDesignerId: payload.designerId,
            sourceDate: payload.date,
            targetDesignerId,
            targetDate,
            itemId: payload.item.id
          }))
        });
        
        socketRef.current?.emit('task_updated');
        socketRef.current?.emit('stop_editing');
        fetchSheets();
        setSelectedTasks([]);
        setSelectedCell(null);
        setEditingUser(null);
        addToast('任务已移动', 'success');
      } catch (err: any) {
        addToast('移动失败', 'error');
      } finally {
        setActiveTask(null);
      }
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
    const base = designers.filter(d => !d.hidden || selectedDesignerId === d.id);
    if (selectedDesignerId === 'all') return base;
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
    if (!jumpTarget) return;
    const [year, month] = jumpTarget.date.split('-').map(Number);
    if (!year || !month) return;
    if (currentDate.getFullYear() !== year || currentDate.getMonth() !== month - 1) {
      setCurrentDate(new Date(year, month - 1, 1));
    }
  }, [jumpTarget, currentDate]);

  useEffect(() => {
    if (!jumpTarget || loading || sheets.length === 0 || designers.length === 0) return;
    const jumpKey = `${jumpTarget.designerId}-${jumpTarget.date}-${jumpTarget.itemId}`;
    if (handledJumpKeyRef.current === jumpKey) return;

    const designer = designers.find(d => d.id === jumpTarget.designerId);
    const sheet = sheets.find(s => s.designerId === jumpTarget.designerId);
    const targetExists = sheet?.days?.[jumpTarget.date]?.some(item => item.id === jumpTarget.itemId);
    if (!designer || !targetExists) return;

    handledJumpKeyRef.current = jumpKey;
    const group = designer.group || '未分组';
    setCollapsedGroups(prev => {
      const next = { ...prev, [group]: false };
      localStorage.setItem('collapsedGroups', JSON.stringify(next));
      return next;
    });
    setSelectedTasks([{ itemId: jumpTarget.itemId, designerId: jumpTarget.designerId, date: jumpTarget.date }]);

    window.setTimeout(() => {
      const escapeSelector = globalThis.CSS?.escape || ((value: string) => value.replace(/"/g, '\\"'));
      const target = document.querySelector(
        `[data-task-id="${escapeSelector(jumpTarget.itemId)}"][data-designer-id="${escapeSelector(jumpTarget.designerId)}"][data-date="${escapeSelector(jumpTarget.date)}"]`
      ) as HTMLElement | null;
      target?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      target?.focus({ preventScroll: true });
    }, 120);
  }, [jumpTarget, loading, sheets, designers]);



  // Handle focus when modal opens with focus target
  useEffect(() => {
    if (!modalOpen || !focusTarget) return;
    
    const { itemId, type, gunIndex } = focusTarget;
    let refKey = '';
    
    switch (type) {
      case 'task':
        refKey = `task-${itemId}`;
        break;
      case 'hours':
        refKey = `hours-${itemId}`;
        break;
      case 'gun':
        if (gunIndex !== undefined) {
          refKey = `gun-${itemId}-${gunIndex}`;
        }
        break;
      case 'gunHours':
        if (gunIndex !== undefined) {
          refKey = `gunHours-${itemId}-${gunIndex}`;
        }
        break;
    }
    
    const tryFocus = () => {
      if (refKey && inputRefs.current[refKey]) {
        const input = inputRefs.current[refKey];
        input?.focus();
        // Just focus, let the browser handle cursor position based on the click
        return true;
      }
      return false;
    };
    
    // Try immediately, then retry a few times
    if (!tryFocus()) {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (tryFocus() || attempts > 5) {
          clearInterval(interval);
        }
      }, 50);
    }
  }, [modalOpen, focusTarget]);

  const [isAddMode, setIsAddMode] = useState(false);
  const [selectedTaskType, setSelectedTaskType] = useState<'none' | 'trip' | 'sick' | 'vacation' | 'illness'>('none');
  const [addModeTaskName, setAddModeTaskName] = useState<string>('');
  const [addModeTripPlace, setAddModeTripPlace] = useState<string>('');
  const [addModeHours, setAddModeHours] = useState<number>(0);
  const [addModeGuns, setAddModeGuns] = useState<GunItem[]>([]);
  const [addModeColor, setAddModeColor] = useState<string>('#dcfce7');
  const [taskTypeDrafts, setTaskTypeDrafts] = useState<Record<string, { designName?: string; designGuns?: GunItem[]; tripName?: string }>>({});

  const openModal = (designerId: string, date: string, addMode: boolean = false) => {
    setModalDesignerId(designerId);
    setModalDate(date);
    setFocusTarget(null);
    setIsAddMode(addMode);
    setSelectedTaskType('none');
    setAddModeTaskName('');
    setAddModeTripPlace('');
    setAddModeHours(0);
    setAddModeGuns([]);
    setAddModeColor('#dcfce7');
    setTaskTypeDrafts({});
    setModalOpen(true);
  };

  const onTaskClick = (item: TaskItem, designerId: string, date: string, type: 'task' | 'hours' | 'gun' | 'gunHours', gunIndex?: number) => {
    setModalDesignerId(designerId);
    setModalDate(date);
    setFocusTarget({ itemId: item.id, type, gunIndex });
    setIsAddMode(false);
    setTaskTypeDrafts({});
    setModalOpen(true);
  };

  const onDeleteGun = (item: TaskItem, designerId: string, date: string, gunIndex: number) => {
    const newGuns = (item.guns || []).filter((_, i) => i !== gunIndex);
    handleItemChange(designerId, date, item.id, 'guns', newGuns);
    addToast('枪名已删除', 'success');
  };

  const onDeleteTask = (item: TaskItem, designerId: string, date: string) => {
    deleteItem(designerId, date, item.id);
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

  const addToHistory = (operation: string, data: any) => {
    setHistory(prev => [...prev, { operation, data, timestamp: Date.now() }].slice(-5));
  };

  const performUndo = useCallback(async (operation: {operation: string, data: any, timestamp: number}) => {
    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      
      switch (operation.operation) {
        case 'delete':
          // Restore deleted task
          const { designerId, date, item } = operation.data;
          const res = await axios.post('/api/tasks/item', { 
            designerId, 
            date, 
            taskName: item.taskName || '', 
            hours: item.hours || 0, 
            color: item.color || '', 
            guns: item.guns || [], 
            leaveType: item.leaveType || null 
          }, authHeader);
          upsertSheet(res.data.sheet);
          socketRef.current?.emit('task_updated');
          addToast('操作已撤销', 'success');
          break;
        
        case 'add':
          // Remove added task
          const { designerId: addDesignerId, date: addDate, itemId } = operation.data;
          await axios.delete('/api/tasks/item', { ...authHeader, data: { designerId: addDesignerId, date: addDate, itemId } });
          fetchSheets();
          socketRef.current?.emit('task_updated');
          addToast('操作已撤销', 'success');
          break;

        case 'batchAdd':
          const { items } = operation.data;
          for (const added of items || []) {
            await axios.delete('/api/tasks/item', {
              ...authHeader,
              data: { designerId: added.designerId, date: added.date, itemId: added.itemId }
            });
          }
          fetchSheets();
          socketRef.current?.emit('task_updated');
          addToast('操作已撤销', 'success');
          break;

        case 'batchDelete':
          for (const deleted of operation.data.items || []) {
            await axios.post('/api/tasks/item', {
              designerId: deleted.designerId,
              date: deleted.date,
              taskName: deleted.item.taskName || '',
              hours: deleted.item.hours || 0,
              color: deleted.item.color || '',
              guns: deleted.item.guns || [],
              leaveType: deleted.item.leaveType || null
            }, authHeader);
          }
          fetchSheets();
          socketRef.current?.emit('task_updated');
          addToast('操作已撤销', 'success');
          break;
        
        case 'move':
          // Reverse move operation
          const { sourceDesignerId, sourceDate, targetDesignerId, targetDate, itemId: moveItemId } = operation.data;
          await axios.post('/api/tasks/move', {
            sourceDesignerId: targetDesignerId,
            sourceDate: targetDate,
            itemId: moveItemId,
            targetDesignerId: sourceDesignerId,
            targetDate: sourceDate
          }, authHeader);
          fetchSheets();
          socketRef.current?.emit('task_updated');
          addToast('操作已撤销', 'success');
          break;

        case 'batchMove':
          for (const moved of operation.data.items || []) {
            await axios.post('/api/tasks/move', {
              sourceDesignerId: moved.targetDesignerId,
              sourceDate: moved.targetDate,
              itemId: moved.itemId,
              targetDesignerId: moved.sourceDesignerId,
              targetDate: moved.sourceDate
            }, authHeader);
          }
          fetchSheets();
          socketRef.current?.emit('task_updated');
          addToast('操作已撤销', 'success');
          break;
        
        default:
          addToast('无法撤销此操作', 'error');
      }
    } catch (err) {
      addToast('撤销失败', 'error');
    }
  }, [token, upsertSheet, fetchSheets]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalOpen) {
        setModalOpen(false);
        socketRef.current?.emit('stop_editing');
      }
    };

    const handleUndo = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (history.length > 0) {
          const lastOperation = history[history.length - 1];
          performUndo(lastOperation);
          setHistory(prev => prev.slice(0, -1));
        } else {
          addToast('暂无可撤销操作', 'error');
        }
      }
    };

    window.addEventListener('keydown', handleEsc);
    window.addEventListener('keydown', handleUndo);
    return () => {
      window.removeEventListener('keydown', handleEsc);
      window.removeEventListener('keydown', handleUndo);
    };
  }, [modalOpen, history, performUndo]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      const designersRes = await axios.get('/api/designers', headers ? { headers } : undefined);
      setDesigners(Array.isArray(designersRes.data) ? designersRes.data : []);
      await fetchSheets();
    } catch (err: any) {
      console.error('Error fetching data:', err);
      if (err.response?.data?.code === 'GUEST_VIEW_DISABLED') {
        setAllowGuestView(false);
      } else {
        addToast('数据加载失败', 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [fetchSheets, token]);

  useEffect(() => {
    Promise.all([
      axios.get('/api/system/settings'),
      axios.get('/api/settings/leaderboard'),
      axios.get('/api/settings/work-hours')
    ])
      .then(([systemRes, leaderboardRes, workHoursRes]) => {
        const guestAllowed = systemRes.data.allowGuestView ?? true;
        setAllowGuestView(guestAllowed);
        setLeaderboardAccess(leaderboardRes.data || defaultAccessSettings);
        setWorkHoursAccess(workHoursRes.data || defaultAccessSettings);
        if (!guestAllowed && !user) setLoading(false);
      })
      .catch(() => setAllowGuestView(true))
      .finally(() => setSystemSettingsLoaded(true));
  }, [user]);

  useEffect(() => {
    if (!systemSettingsLoaded) return;
    if (!allowGuestView && !user) return;
    fetchData();

    socketRef.current = io('/', {
      path: '/socket.io',
      reconnectionAttempts: 5,
      timeout: 10000
    });

    socketRef.current.on('task_refreshed', () => {
      setEditingUser(null);
      fetchSheets();
    });

    socketRef.current.on('user_editing', (data: { designerId: string, date: string, userId: string, username: string, name: string }) => {
      if (user && data.userId !== user.id) {
        setEditingUser({ designerId: data.designerId, date: data.date, username: data.username, name: data.name });
      }
    });

    socketRef.current.on('user_stopped_editing', () => {
      setEditingUser(null);
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, [fetchData, fetchSheets, systemSettingsLoaded, allowGuestView, user]);

  useEffect(() => {
    const handleTaskCopy = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { item, designerId, date } = customEvent.detail;
      const payloads = getSelectedTaskPayloads({ item, designerId, date });
      setClipboard(payloads.map(payload => payload.item));
      addToast('粘贴已准备', 'success');
    };

    const handleTaskCut = async (e: Event) => {
      const customEvent = e as CustomEvent;
      const { item, designerId, date } = customEvent.detail;
      if (!user) return;
      const payloads = getSelectedTaskPayloads({ item, designerId, date });
      if (payloads.length === 0) return;
      
      setClipboard(payloads.map(payload => payload.item));
      addToast('剪切已准备', 'success');
      
      try {
        const authHeader = { headers: { Authorization: `Bearer ${token}` } };
        for (const payload of payloads) {
          await axios.delete('/api/tasks/item', { ...authHeader, data: { designerId: payload.designerId, date: payload.date, itemId: payload.item.id } });
        }
        addToHistory('batchDelete', {
          items: payloads.map(payload => ({ designerId: payload.designerId, date: payload.date, item: payload.item }))
        });
        fetchSheets();
        socketRef.current?.emit('task_updated');
        socketRef.current?.emit('stop_editing');
        setSelectedTasks([]);
        setSelectedCell(null);
        setEditingUser(null);
      } catch (err) {
        addToast('剪切失败', 'error');
      }
    };

    const handleTaskPaste = async (e: Event) => {
      const customEvent = e as CustomEvent;
      const { designerId, date } = customEvent.detail;
      if (!user) return;
      if (!clipboardRef.current || clipboardRef.current.length === 0) {
        addToast('请先复制任务', 'error');
        return;
      }
      addToast('任务已复制', 'success');
      try {
        const authHeader = { headers: { Authorization: `Bearer ${token}` } };
        const res = await axios.post('/api/tasks/item/batch', { 
          designerId, 
          date, 
          items: clipboardRef.current
        }, authHeader);
        addToHistory('batchAdd', {
          items: (res.data.items || []).map((created: TaskItem) => ({ designerId, date, itemId: created.id }))
        });
        upsertSheet(res.data.sheet);
        socketRef.current?.emit('task_updated');
        socketRef.current?.emit('stop_editing');
        setSelectedTasks([]);
        setSelectedCell(null);
        setEditingUser(null);
      } catch (err) {
        addToast('粘贴失败', 'error');
      }
    };

    window.addEventListener('task-copy', handleTaskCopy);
    window.addEventListener('task-cut', handleTaskCut);
    window.addEventListener('task-paste', handleTaskPaste);

    return () => {
      window.removeEventListener('task-copy', handleTaskCopy);
      window.removeEventListener('task-cut', handleTaskCut);
      window.removeEventListener('task-paste', handleTaskPaste);
    };
  }, [clipboard, user, token, fetchSheets, upsertSheet, sheets]);

  const sheetByDesignerId = useMemo(() => {
    const map: Record<string, TaskSheet | undefined> = {};
    for (const s of sheets) map[s.designerId] = s;
    return map;
  }, [sheets]);

  const getItems = (designerId: string, date: string) => {
    const sheet = sheetByDesignerId[designerId];
    const items = sheet?.days?.[date];
    const validItems = Array.isArray(items) ? items.filter(item => {
      if (item.leaveType) return true;
      const taskName = (item.taskName || '').trim();
      const gunsEmpty = !item.guns || item.guns.length === 0 || item.guns.every((g: any) => !g.name || g.name.trim() === '未命名');
      if (!taskName && gunsEmpty) return false;
      return true;
    }) : [];
    return validItems;
  };

  // 获取所有任务（包括空任务），用于编辑模态框
  const getAllItems = (designerId: string, date: string) => {
    const sheet = sheetByDesignerId[designerId];
    return Array.isArray(sheet?.days?.[date]) ? sheet.days[date] : [];
  };

  function getSelectedTaskPayloads(fallback: { item: TaskItem; designerId: string; date: string }) {
    const fallbackSelection = { itemId: fallback.item.id, designerId: fallback.designerId, date: fallback.date };
    const selections = selectedTasksRef.current;
    const activeSelections = selections.some(selection => taskSelectionKey(selection) === taskSelectionKey(fallbackSelection))
      ? selections
      : [fallbackSelection];

    return activeSelections
      .map(selection => {
        const item = getAllItems(selection.designerId, selection.date).find(task => task.id === selection.itemId);
        return item ? { item, designerId: selection.designerId, date: selection.date } : null;
      })
      .filter(Boolean) as { item: TaskItem; designerId: string; date: string }[];
  }

  const handleSelectTask = (itemId: string, designerId: string, date: string, append: boolean) => {
    const nextSelection = { itemId, designerId, date };
    if (!append) {
      setSelectedTasks([nextSelection]);
      return;
    }

    setSelectedTasks(prev => {
      const key = taskSelectionKey(nextSelection);
      if (prev.some(selection => taskSelectionKey(selection) === key)) {
        return prev.filter(selection => taskSelectionKey(selection) !== key);
      }
      return [...prev, nextSelection];
    });
  };

  // 获取考虑 pendingChanges 后的任务字段值
  const getItemFieldWithPendingChanges = (itemId: string, field: string) => {
    const pendingChange = pendingChanges.find(change => change.itemId === itemId && change.field === field);
    return pendingChange ? pendingChange.value : undefined;
  };

  // 获取考虑 pendingChanges 后的完整任务对象
  const getItemWithPendingChanges = (item: TaskItem) => {
    const itemChanges = pendingChanges.filter(change => change.itemId === item.id);
    if (itemChanges.length === 0) return item;
    
    const updatedItem = { ...item };
    itemChanges.forEach(change => {
      updatedItem[change.field as keyof TaskItem] = change.value;
    });
    return updatedItem;
  };

  const hasInvalidNamedGunHours = (guns?: GunItem[]) => {
    return (guns || []).some(gun => {
      const name = String(gun.name || '').trim();
      if (!name) return false;
      const hours = typeof gun.hours === 'number' ? gun.hours : (parseFloat(String(gun.hours)) || 0);
      return hours <= 0;
    });
  };
 
  const calculateDailyTotal = (designerId: string, date: string) => {
    const items = getItems(designerId, date);
    return items.reduce((sum, it) => {
      // Skip leave tasks from hour calculation
      if (it.leaveType === 'sick' || it.leaveType === 'vacation' || it.leaveType === 'illness') return sum;
      
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

  const saveItem = async (designerId: string, date: string, itemId: string, field: TaskField, value: any) => {
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

  // 存储待保存的任务更改
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);

  const handleItemChange = (designerId: string, date: string, itemId: string, field: TaskField, raw: any) => {
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

    // 存储待保存的更改
    let value = raw;
    if (field === 'hours') value = (parseFloat(raw) || 0);
    
    setPendingChanges(prev => {
      // 移除相同字段的旧更改
      const filtered = prev.filter(change => !(change.designerId === designerId && change.date === date && change.itemId === itemId && change.field === field));
      // 添加新更改
      return [...filtered, { designerId, date, itemId, field, value }];
    });
  };

  const addItem = async (designerId: string, date: string, taskType?: 'none' | 'trip' | 'sick' | 'vacation' | 'illness') => {
    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      const leaveType = taskType === 'none' ? null : taskType === 'trip' ? 'trip' : taskType === 'sick' ? 'sick' : taskType === 'vacation' ? 'vacation' : taskType === 'illness' ? 'illness' : null;
      const taskName = taskType === 'trip' ? '出差' : '';
      const res = await axios.post('/api/tasks/item', { 
        designerId, 
        date, 
        taskName, 
        leaveType, 
        hours: 0 
      }, authHeader);
      upsertSheet(res.data.sheet);
      socketRef.current?.emit('task_updated');
      
      // Add to history for undo
      if (res.data.sheet?.days?.[date]) {
        const newItems = res.data.sheet.days[date];
        const newItem = newItems[newItems.length - 1]; // Assume the last item is the newly added one
        if (newItem) {
          addToHistory('add', { designerId, date, itemId: newItem.id });
        }
      }
      
      addToast('任务已添加', 'success');
    } catch (err: any) {
      addToast('添加任务失败', 'error');
      console.error('Error adding task:', err);
    }
  };

  const deleteItem = async (designerId: string, date: string, itemId: string) => {
    try {
      // Get the item data before deletion for undo
      const item = getItems(designerId, date).find(i => i.id === itemId);
      
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      const res = await axios.delete('/api/tasks/item', { ...authHeader, data: { designerId, date, itemId } });
      upsertSheet(res.data.sheet);
      socketRef.current?.emit('task_updated');
      
      // Add to history for undo
      if (item) {
        addToHistory('delete', { designerId, date, item });
      }
      
      addToast('任务已删除', 'success');
    } catch (err: any) {
      addToast('删除任务失败', 'error');
    }
  };

  const changeMonth = (offset: number) => {
    const newDate = new Date(currentDate);
    newDate.setMonth(newDate.getMonth() + offset);
    setCurrentDate(newDate);
  };

  if (!systemSettingsLoaded || loading) return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-50">
      <RefreshCw className="animate-spin text-blue-600 mb-4" size={48} />
      <div className="text-gray-600 font-medium">正在加载数据...</div>
    </div>
  );

  if (!allowGuestView && !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-[#217346] text-white px-6 py-3 flex items-center justify-between shadow-md">
          <h1 className="text-lg font-bold">Obara 任务管理系统</h1>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <FileSpreadsheet size={64} className="mx-auto text-gray-300 mb-4" />
            <h2 className="text-xl font-bold text-gray-600">请先登录后查看</h2>
            <p className="text-gray-400 mt-2">管理员已关闭未登录用户的查看权限</p>
            <Link to="/login" className="inline-block mt-6 px-6 py-2 bg-[#217346] hover:bg-[#1a5c38] text-white font-bold rounded transition">
              前往登录
            </Link>
          </div>
        </div>
      </div>
    );
  }

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
    addToast('任务已复制', 'success');
    try {
      const authHeader = { headers: { Authorization: `Bearer ${token}` } };
      const res = await axios.post('/api/tasks/item/batch', { 
        designerId, 
        date, 
        items: clipboard 
      }, authHeader);
      
      upsertSheet(res.data.sheet);
      addToHistory('batchAdd', {
        items: (res.data.items || []).map((item: TaskItem) => ({ designerId, date, itemId: item.id }))
      });
      socketRef.current?.emit('task_updated');
      socketRef.current?.emit('stop_editing');
      setSelectedTasks([]);
      setSelectedCell(null);
      setEditingUser(null);
    } catch (err) {
      addToast('粘贴失败', 'error');
    }
  };

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const isSuperAdmin = user?.role === 'superadmin';

  const canShowAccessLink = (access: typeof defaultAccessSettings) => {
    if (isSuperAdmin) return true;
    if (!access.enabled) return false;
    if (!user) return access.allowViewers;
    if (user.role === 'admin') return access.allowAdmins;
    if (user.role === 'user') return access.allowViewers;
    return false;
  };

  const formatTaskMetaTime = (value?: string) => {
    if (!value) return '暂无记录';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '暂无记录';
    return format(date, 'yyyy-MM-dd HH:mm');
  };

  const buildTaskMetadataTitle = (item: TaskItem) => {
    const creator = item.createdBy?.name || item.createdBy?.username || '暂无记录';
    const updater = item.updatedBy?.name || item.updatedBy?.username || '暂无记录';
    return [
      `创建者：${creator}`,
      `创建时间：${formatTaskMetaTime(item.createdAt)}`,
      `最后修改者：${updater}`,
      `最后修改时间：${formatTaskMetaTime(item.updatedAt)}`
    ].join('\n');
  };

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
          {canShowAccessLink(leaderboardAccess) && (
              <Link 
                to="/leaderboard" 
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a5c38] hover:bg-[#237a47] rounded transition text-white text-sm font-medium"
              >
                <FileSpreadsheet size={16} className="text-blue-200" />
                <span>任务报表</span>
              </Link>
          )}
          {canShowAccessLink(workHoursAccess) && (
              <Link
                to="/work-hours"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a5c38] hover:bg-[#237a47] rounded transition text-white text-sm font-medium"
              >
                <Clock size={16} className="text-amber-200" />
                <span>工时管理</span>
              </Link>
          )}
          {isSuperAdmin && (
            <Link
              to="/system-settings"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a5c38] hover:bg-[#237a47] rounded transition text-white text-sm font-medium"
            >
              <Settings size={16} className="text-purple-200" />
              <span>系统设置</span>
            </Link>
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
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >


        <main className="flex-1 overflow-auto p-4">
          <div className="bg-white shadow-sm border border-gray-300 overflow-hidden" ref={tableContainerRef}>
            <div style={{ height: `${tableHeight}px` }} className="overflow-auto">
              <table className="border-collapse text-[12px] w-full">
              <thead className="text-xs">
                <tr className="bg-[#f8f9fa] text-gray-600 h-10 table-header-row">
                  <th className="sticky left-0 bg-[#f8f9fa] border border-gray-300 w-48 font-bold text-center shadow-[1px_0_0_0_#d1d5db] z-40">设计员</th>
                  {days.map(d => (
                    <th key={d.fullDate} colSpan={2} className={`sticky top-0 border border-gray-300 min-w-[240px] text-center font-bold z-40 ${d.isWeekend ? 'bg-[#fff2cc]' : ''}`}>
                      <div className="text-[10px] opacity-60">{d.dayName}</div>
                      <div>{d.dayNum}</div>
                    </th>
                  ))}
                  <th className="sticky right-0 bg-[#f8f9fa] border border-gray-300 w-24 font-bold text-center shadow-[-1px_0_0_0_#d1d5db] z-40">月总工时</th>
                </tr>
                <tr className="bg-[#f8f9fa] text-gray-500 text-[10px] h-6 table-header-row-secondary">
                  <th className="sticky left-0 bg-[#f8f9fa] border border-gray-300 shadow-[1px_0_0_0_#d1d5db] z-30"></th>
                  {days.map(d => (
                    <React.Fragment key={`sub-${d.fullDate}`}>
                      <th className={`sticky top-10 border border-gray-300 w-48 z-30 ${d.isWeekend ? 'bg-[#fff2cc]/50' : ''}`}>任务内容</th>
                      <th className={`sticky top-10 border border-gray-300 w-12 z-30 ${d.isWeekend ? 'bg-[#fff2cc]/50' : ''}`}>工时</th>
                    </React.Fragment>
                  ))}
                  <th className="sticky right-0 bg-[#f8f9fa] border border-gray-300 shadow-[-1px_0_0_0_#d1d5db] z-30"></th>
                </tr>
              </thead>
              {sortedGroups.map(group => (
                <React.Fragment key={group}>
                  <tbody>
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
                  </tbody>

                  {!collapsedGroups[group] && (
                    <SortableContext items={designersByGroup[group].map(d => `designer-${d.id}`)} strategy={verticalListSortingStrategy}>
                      {designersByGroup[group].map(d => (
                        <SortableDesignerTbody key={d.id} designer={d} isAdmin={isAdmin}>
                          {({ attributes, listeners }) => (
                            <>
                              <tr className="align-top hover:bg-blue-50/20 group/row transition-colors">
                                <td className="sticky left-0 z-20 bg-white border border-gray-300 px-2 py-3 font-bold text-gray-800 text-center align-middle shadow-[1px_0_0_0_#d1d5db] group-hover/row:bg-blue-50/40">
                                  <div className="flex items-center justify-center gap-1.5 h-full">
                                    {isAdmin && (
                                      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-0.5 hover:bg-blue-100 rounded">
                                        <GripVertical size={14} className="text-gray-400" />
                                      </div>
                                    )}
                                    <span className="text-base font-bold text-gray-900 whitespace-nowrap align-middle">{d.name}</span>
                                  </div>
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
                                      onClick={(e: React.MouseEvent) => {
                                        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('flex') && !(e.target as HTMLElement).closest('[data-task-id]')) {
                                          setSelectedTasks([]);
                                          setSelectedCell(null);
                                          socketRef.current?.emit('stop_editing');
                                        }
                                      }}
                                    >
                                      <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
                                        <div className="flex flex-col min-h-[40px]">
                                          {items.map(item => (
                                            <SortableTask
                                              key={item.id}
                                              item={item}
                                              designerId={d.id}
                                              date={day.fullDate}
                                              isAdmin={isAdmin}
                                              onTaskClick={onTaskClick}
                                              onDeleteGun={onDeleteGun}
                                              onDeleteTask={onDeleteTask}
                                              selectedTasks={selectedTasks}
                                              metadataTitle={buildTaskMetadataTitle(item)}
                                              onSelectTask={(itemId, designerId, date, append) => {
                                                handleSelectTask(itemId, designerId, date, append);
                                                setSelectedCell(null);
                                                if (user) {
                                                  socketRef.current?.emit('start_editing', { designerId, date, userId: user.id, username: user.username, name: user.name });
                                                }
                                              }}
                                            />
                                          ))}
                                          {isAdmin && (
                                            <div 
                                              className={`h-[24px] flex items-center justify-center text-gray-300 opacity-0 group-hover/cell:opacity-100 transition-opacity cursor-pointer hover:bg-blue-50/50 ${selectedCell?.designerId === d.id && selectedCell?.date === day.fullDate ? 'opacity-100 bg-blue-100 border border-blue-400' : ''}`}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedCell({ designerId: d.id, date: day.fullDate });
                                                setSelectedTasks([]);
                                                if (user) {
                                                  socketRef.current?.emit('start_editing', { designerId: d.id, date: day.fullDate, userId: user.id, username: user.username, name: user.name });
                                                }
                                              }}
                                              onDoubleClick={(e) => {
                                                e.stopPropagation();
                                                openModal(d.id, day.fullDate, true);
                                              }}
                                              onKeyDown={(e) => {
                                                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  // 实现粘贴功能
                                                  if (clipboardRef.current && clipboardRef.current.length > 0) {
                                                    handlePaste(d.id, day.fullDate);
                                                  }
                                                }
                                              }}
                                              tabIndex={0}
                                              title={selectedCell?.designerId === d.id && selectedCell?.date === day.fullDate ? "双击此处添加任务" : ""}
                                            >
                                              <Plus size={14} />
                                            </div>
                                          )}
                                          {editingUser && editingUser.designerId === d.id && editingUser.date === day.fullDate && (
                                            <div className="absolute inset-0 bg-yellow-100/80 flex items-center justify-center z-10">
                                              <span className="text-xs font-bold text-yellow-700 bg-yellow-200/50 px-2 py-1 rounded border border-yellow-300">
                                                {editingUser.name} 正在编辑
                                              </span>
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
                                <td className="sticky left-0 z-20 bg-blue-50/30 border border-gray-300 px-2 py-0.5 font-bold text-gray-500 text-center whitespace-nowrap shadow-[1px_0_0_0_#d1d5db]">
                                  当日合计
                                </td>
                                {days.map(day => (
                                  <td key={`total-${d.id}-${day.fullDate}`} colSpan={2} className={`border border-gray-300 px-1 py-0.5 text-center font-bold text-blue-600 ${day.isWeekend ? 'bg-[#fff2cc]/20' : ''}`}>
                                    {calculateDailyTotal(d.id, day.fullDate)}
                                  </td>
                                ))}
                                <td className="sticky right-0 z-20 bg-blue-50/30 border border-gray-300 shadow-[-1px_0_0_0_#d1d5db]"></td>
                              </tr>
                            </>
                          )}
                        </SortableDesignerTbody>
                      ))}
                    </SortableContext>
                  )}
                </React.Fragment>
              ))}
              </table>
            </div>
            </div>
        </main>

        <DragOverlay>
          {activeTask && (
            <div className="flex border border-blue-400 shadow-2xl rounded opacity-90 scale-105 bg-white overflow-hidden">
              <div className="w-48 border-r border-gray-200 flex flex-col bg-white">
                <div className="px-1.5 py-1 min-h-[24px] flex items-center break-all leading-tight text-[11px] font-medium">
                  {(() => {
                    const item = activeTask.item;
                    if (item.leaveType === 'sick') return <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">事假</span>;
                    if (item.leaveType === 'vacation') return <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">休假</span>;
                    if (item.leaveType === 'illness') return <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-pink-100 text-pink-700">病假</span>;
                    if (item.leaveType === 'trip') {
                      const name = (item.taskName || '').trim();
                      if (!name) return <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800">出差</span>;
                      return <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800">{name.endsWith('出差') ? name : `${name}出差`}</span>;
                    }
                    return item.taskName || <span className="text-gray-300 italic">无</span>;
                  })()}
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
          <div className="absolute inset-0 bg-black/40" onClick={() => { setModalOpen(false); socketRef.current?.emit('stop_editing'); }} />
          <div className="relative bg-white rounded-lg shadow-2xl w-[960px] max-w-[96vw] max-h-[90vh] flex flex-col border-2 border-gray-200">
            <div className="flex items-center justify-between px-4 py-3 border-b-2 border-gray-200 bg-[#217346] text-white rounded-t-lg">
              <div>
                <div className="font-bold text-lg">{designers.find(d => d.id === modalDesignerId)?.name}</div>
                <div className="text-xs opacity-80">{modalDate}</div>
              </div>
              <button onClick={() => { 
                // 清空待保存的更改
                setPendingChanges([]);
                // 关闭模态框
                setModalOpen(false); 
                socketRef.current?.emit('stop_editing'); 
              }} className="p-1 hover:bg-red-600 rounded transition">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-gray-100/50">
              {(() => {
                if (isAddMode) {
                  const isLeave = selectedTaskType === 'sick' || selectedTaskType === 'vacation' || selectedTaskType === 'illness';
                  const isTrip = selectedTaskType === 'trip';
                  
                  return (
                    <div className="flex flex-col gap-4 min-w-0">
                      <div className={`flex flex-col gap-2 p-4 bg-white rounded-xl border-2 border-gray-200 shadow-sm hover:border-blue-300 transition group/item h-fit min-w-0 ${isLeave ? 'bg-gradient-to-r from-red-50 to-blue-50' : isTrip ? 'bg-gradient-to-r from-yellow-50 to-white' : ''}`}>
                        {isLeave ? (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-bold px-3 py-1.5 rounded-lg ${selectedTaskType === 'sick' ? 'bg-red-100 text-red-700 border border-red-300' : selectedTaskType === 'vacation' ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-pink-100 text-pink-700 border border-pink-300'}`}>
                                {selectedTaskType === 'sick' ? '🏖️ 事假' : selectedTaskType === 'vacation' ? '🌴 休假' : '🤒 病假'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-24">
                                <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">请假工时</label>
                                <input
                                  ref={el => inputRefs.current['hours-new'] = el}
                                  type="number"
                                  step="0.5"
                                  min="0"
                                  className="w-full h-10 text-center bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 transition font-bold text-blue-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:bg-white"
                                  defaultValue="0"
                                  placeholder="工时"
                                  onChange={(e) => setAddModeHours(parseFloat(e.target.value) || 0)}
                                />
                              </div>
                              <button
                                onClick={() => {
                                  setModalOpen(false);
                                  socketRef.current?.emit('stop_editing');
                                  addToast('任务已取消', 'error');
                                }}
                                className="mt-4 p-2 text-gray-300 hover:text-red-600 transition"
                                title="删除任务"
                              >
                                <Trash2 size={20} />
                              </button>
                            </div>
                          </div>
                        ) : isTrip ? (
                          <div className="flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-bold px-3 py-1.5 rounded-lg bg-yellow-100 text-yellow-800 border border-yellow-300">
                                出差
                              </span>
                              <button
                                onClick={() => {
                                  setModalOpen(false);
                                  socketRef.current?.emit('stop_editing');
                                  addToast('任务已取消', 'error');
                                }}
                                className="p-2 text-gray-300 hover:text-red-600 transition"
                                title="删除任务"
                              >
                                <Trash2 size={20} />
                              </button>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex-1">
                                <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">地点/客户</label>
                                <input
                                  ref={el => inputRefs.current['task-new'] = el}
                                  className="w-full h-10 px-3 bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white transition"
                                  value={addModeTripPlace}
                                  onChange={(e) => setAddModeTripPlace(e.target.value)}
                                  placeholder="输入地点或者客户"
                                  autoFocus
                                />
                              </div>
                              <div className="w-24">
                                <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">工时</label>
                                <input
                                  ref={el => inputRefs.current['hours-new'] = el}
                                  type="number"
                                  step="0.5"
                                  min="0"
                                  className="w-full h-10 text-center bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 transition font-bold text-blue-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:bg-white"
                                  defaultValue="0"
                                  placeholder="工时"
                                  onChange={(e) => setAddModeHours(parseFloat(e.target.value) || 0)}
                                />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">任务内容</label>
                              <input
                                ref={el => inputRefs.current['task-new'] = el}
                                className="w-full h-10 px-3 bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white transition"
                                value={addModeTaskName}
                                onChange={(e) => setAddModeTaskName(e.target.value)}
                                placeholder="输入主任务名称..."
                                autoFocus
                              />
                            </div>
                            <div className="w-24">
                              <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">总工时</label>
                              <input
                                ref={el => inputRefs.current['hours-new'] = el}
                                type="number"
                                step="0.5"
                                min="0"
                                className={`w-full h-10 text-center bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 transition font-bold text-blue-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${addModeGuns.length > 0 ? 'opacity-50 cursor-not-allowed' : 'focus:bg-white'}`}
                                value={addModeGuns.length > 0 ? addModeGuns.reduce((sum, gun) => sum + (parseFloat(String(gun.hours)) || 0), 0) : addModeHours}
                                placeholder="工时"
                                onChange={(e) => setAddModeHours(parseFloat(e.target.value) || 0)}
                                disabled={addModeGuns.length > 0}
                              />
                            </div>
                            <button
                              onClick={() => {
                                setModalOpen(false);
                                socketRef.current?.emit('stop_editing');
                                addToast('任务已取消', 'error');
                              }}
                              className="mt-4 p-2 text-gray-300 hover:text-red-600 transition"
                              title="删除任务"
                            >
                              <Trash2 size={20} />
                            </button>
                          </div>
                        )}

                        {!isLeave && !isTrip && (
                        <div className="mt-2 pl-4 border-l-2 border-gray-100 flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">枪名</span>
                            <button 
                              onClick={() => {
                                setAddModeGuns(prev => [...prev, { id: `gun-new-${Date.now()}`, name: '', hours: 0 }]);
                              }}
                              className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-100 transition font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                              disabled={!addModeTaskName.trim()}
                            >
                              + 添加枪名
                            </button>
                          </div>
                          {addModeGuns.map((gun, gIdx) => (
                            <div key={gun.id} className="flex items-center gap-2 bg-gray-50/50 p-2 rounded-lg group/gun">
                              <input
                                ref={el => inputRefs.current[`gun-new-${gIdx}`] = el}
                                className="flex-1 h-8 px-2 bg-transparent border-b-2 border-gray-200 focus:border-blue-400 outline-none text-xs transition"
                                value={gun.name}
                                placeholder="枪名..."
                                onChange={(e) => {
                                  setAddModeGuns(prev => {
                                    const next = [...prev];
                                    next[gIdx] = { ...next[gIdx], name: e.target.value };
                                    return next;
                                  });
                                }}
                              />
                              <input
                                ref={el => inputRefs.current[`gunHours-new-${gIdx}`] = el}
                                type="number"
                                step="0.5"
                                min="0"
                                className="w-16 h-8 text-center bg-transparent border-b-2 border-gray-200 focus:border-blue-400 outline-none text-xs font-bold text-blue-600 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                value={gun.hours}
                                placeholder="工时"
                                onChange={(e) => {
                                  setAddModeGuns(prev => {
                                    const next = [...prev];
                                    next[gIdx] = { ...next[gIdx], hours: parseFloat(e.target.value) || 0 };
                                    return next;
                                  });
                                }}
                              />
                              <button
                                onClick={() => setAddModeGuns(prev => prev.filter((_, i) => i !== gIdx))}
                                className="p-1 text-red-400 hover:text-red-600 transition"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                        )}

                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-50">
                          <span className="text-[10px] text-gray-400 font-bold uppercase">任务类型:</span>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setSelectedTaskType('none');
                              }}
                              className={`px-3 py-1 text-xs font-bold rounded transition ${selectedTaskType === 'none' ? 'bg-gray-100 text-gray-800 border border-gray-400' : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'}`}
                            >
                              设计计划
                            </button>
                            <button
                              onClick={() => {
                                setAddModeGuns([]);
                                setSelectedTaskType('trip');
                              }}
                              className={`px-3 py-1 text-xs font-bold rounded transition ${selectedTaskType === 'trip' ? 'bg-yellow-100 text-yellow-800 border border-yellow-300' : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'}`}
                            >
                              出差
                            </button>
                            <button
                              onClick={() => {
                                setAddModeGuns([]);
                                setSelectedTaskType('sick');
                              }}
                              className={`px-3 py-1 text-xs font-bold rounded transition ${selectedTaskType === 'sick' ? 'bg-red-100 text-red-700 border border-red-300' : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'}`}
                            >
                              事假
                            </button>
                            <button
                              onClick={() => {
                                setAddModeGuns([]);
                                setSelectedTaskType('vacation');
                              }}
                              className={`px-3 py-1 text-xs font-bold rounded transition ${selectedTaskType === 'vacation' ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'}`}
                            >
                              休假
                            </button>
                            <button
                              onClick={() => {
                                setAddModeGuns([]);
                                setSelectedTaskType('illness');
                              }}
                              className={`px-3 py-1 text-xs font-bold rounded transition ${selectedTaskType === 'illness' ? 'bg-pink-100 text-pink-700 border border-pink-300' : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'}`}
                            >
                              病假
                            </button>
                          </div>
                        </div>

                        {isAdmin && !isLeave && !isTrip && (
                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-50">
                          <span className="text-[10px] text-gray-400 font-bold uppercase">标记颜色:</span>
                          <div className="flex flex-wrap gap-1.5">
                            {PRESET_COLORS.map(c => (
                              <button
                                key={c.value}
                                onClick={() => setAddModeColor(c.value)}
                                className={`w-5 h-5 rounded-full border border-gray-200 transition-all hover:scale-110 ${addModeColor === c.value ? 'ring-2 ring-blue-500 ring-offset-1 scale-110 shadow-sm' : 'opacity-60 hover:opacity-100'}`}
                                style={{ backgroundColor: c.value || '#fff' }}
                                title={c.label}
                              />
                            ))}
                          </div>
                        </div>
                        )}
                      </div>
                    </div>
                  );
                }
                
                const allItems = getAllItems(modalDesignerId, modalDate);
                const items = focusTarget ? allItems.filter(item => item.id === focusTarget.itemId) : allItems;
                
                return (
                    <div className={items.length > 3 ? "grid grid-cols-2 gap-4 min-w-0" : "flex flex-col gap-4 min-w-0"}>
                      {items.map(item => {
                        // 使用考虑 pendingChanges 后的完整 item 对象
                        const currentItem = getItemWithPendingChanges(item);
                        const hasGuns = currentItem.guns && currentItem.guns.length > 0;
                        const isLeave = currentItem.leaveType === 'sick' || currentItem.leaveType === 'vacation' || currentItem.leaveType === 'illness';
                        const isTrip = currentItem.leaveType === 'trip';
                        const tripPlace = (() => {
                          const name = (currentItem.taskName || '').trim();
                          if (!name) return '';
                          return name.endsWith('出差') ? name.slice(0, -2) : name;
                        })();
                        const itemDraft = taskTypeDrafts[currentItem.id] || {};
                        const rememberCurrentTypeDraft = () => {
                          setTaskTypeDrafts(prev => {
                            const nextDraft = { ...(prev[currentItem.id] || {}) };
                            if (!currentItem.leaveType) {
                              nextDraft.designName = currentItem.taskName || '';
                              nextDraft.designGuns = currentItem.guns || [];
                            }
                            if (currentItem.leaveType === 'trip') {
                              nextDraft.tripName = currentItem.taskName || '出差';
                            }
                            return { ...prev, [currentItem.id]: nextDraft };
                          });
                        };
                        const getDesignDraftName = () => {
                          if (itemDraft.designName !== undefined) return itemDraft.designName;
                          return !currentItem.leaveType ? (currentItem.taskName || '') : '';
                        };
                        const getDesignDraftGuns = () => {
                          if (itemDraft.designGuns !== undefined) return itemDraft.designGuns;
                          return !currentItem.leaveType ? (currentItem.guns || []) : [];
                        };
                        const getTripDraftName = () => {
                          if (itemDraft.tripName !== undefined) return itemDraft.tripName;
                          return currentItem.leaveType === 'trip' ? (currentItem.taskName || '出差') : '出差';
                        };
                        return (
                          <div key={currentItem.id} className={`flex flex-col gap-2 p-4 bg-white rounded-xl border-2 border-gray-200 shadow-sm hover:border-blue-300 transition group/item h-fit min-w-0 ${isLeave ? 'bg-gradient-to-r from-red-50 to-blue-50' : isTrip ? 'bg-gradient-to-r from-yellow-50 to-white' : ''}`}>
                            {isLeave ? (
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className={`text-sm font-bold px-3 py-1.5 rounded-lg ${currentItem.leaveType === 'sick' ? 'bg-red-100 text-red-700 border border-red-300' : currentItem.leaveType === 'vacation' ? 'bg-blue-100 text-blue-700 border border-blue-300' : currentItem.leaveType === 'illness' ? 'bg-pink-100 text-pink-700 border border-pink-300' : ''}`}>
                                    {currentItem.leaveType === 'sick' ? '🏖️ 事假' : currentItem.leaveType === 'vacation' ? '🌴 休假' : currentItem.leaveType === 'illness' ? '🤒 病假' : ''}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="w-24">
                                    <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">请假工时</label>
                                    <input
                                      ref={el => inputRefs.current[`hours-${currentItem.id}`] = el}
                                      type="number"
                                      step="0.5"
                                      min="0"
                                      className="w-full h-10 text-center bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 transition font-bold text-blue-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:bg-white"
                                      value={typeof currentItem.hours === 'number' ? currentItem.hours : (parseFloat(currentItem.hours as string) || 0)}
                                      onChange={(e) => handleItemChange(modalDesignerId, modalDate, currentItem.id, 'hours', e.target.value)}
                                      placeholder="工时"
                                    />
                                  </div>
                                  <button
                                    onClick={() => deleteItem(modalDesignerId, modalDate, currentItem.id)}
                                    className="mt-4 p-2 text-gray-300 hover:text-red-600 transition"
                                    title="删除任务"
                                  >
                                    <Trash2 size={20} />
                                  </button>
                                </div>
                              </div>
                            ) : isTrip ? (
                              <div className="flex flex-col gap-3">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-bold px-3 py-1.5 rounded-lg bg-yellow-100 text-yellow-800 border border-yellow-300">
                                    出差
                                  </span>
                                  <button
                                    onClick={() => deleteItem(modalDesignerId, modalDate, currentItem.id)}
                                    className="p-2 text-gray-300 hover:text-red-600 transition"
                                    title="删除任务"
                                  >
                                    <Trash2 size={20} />
                                  </button>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="flex-1">
                                    <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">地点/客户</label>
                                    <input
                                      ref={el => inputRefs.current[`task-${currentItem.id}`] = el}
                                      className="w-full h-10 px-3 bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white transition"
                                      value={tripPlace}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        const nextName = val ? `${val}出差` : '出差';
                                        setTaskTypeDrafts(prev => ({
                                          ...prev,
                                          [currentItem.id]: { ...(prev[currentItem.id] || {}), tripName: nextName }
                                        }));
                                        handleItemChange(modalDesignerId, modalDate, currentItem.id, 'taskName', nextName);
                                      }}
                                      placeholder="输入地点或者客户"
                                    />
                                  </div>
                                  <div className="w-24">
                                    <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">工时</label>
                                    <input
                                      ref={el => inputRefs.current[`hours-${currentItem.id}`] = el}
                                      type="number"
                                      step="0.5"
                                      min="0"
                                      className="w-full h-10 text-center bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 transition font-bold text-blue-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:bg-white"
                                      value={typeof currentItem.hours === 'number' ? currentItem.hours : (parseFloat(currentItem.hours as string) || 0)}
                                      onChange={(e) => handleItemChange(modalDesignerId, modalDate, currentItem.id, 'hours', e.target.value)}
                                      placeholder="工时"
                                    />
                                  </div>
                                </div>
                              </div>
                            ) : (
                            <div className="flex items-center gap-2">
                              <div className="flex-1">
                                <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">任务内容</label>
                                <input
                                  ref={el => inputRefs.current[`task-${currentItem.id}`] = el}
                                  className="w-full h-10 px-3 bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white transition"
                                  value={currentItem.taskName}
                                  onChange={(e) => {
                                    setTaskTypeDrafts(prev => ({
                                      ...prev,
                                      [currentItem.id]: { ...(prev[currentItem.id] || {}), designName: e.target.value, designGuns: currentItem.guns || [] }
                                    }));
                                    handleItemChange(modalDesignerId, modalDate, currentItem.id, 'taskName', e.target.value);
                                  }}
                                  placeholder="请输入主任务名称，不能为空..."
                                />
                              </div>
                              <div className="w-24">
                                <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">总工时</label>
                                <input
                                  ref={el => inputRefs.current[`hours-${currentItem.id}`] = el}
                                  type="number"
                                  step="0.5"
                                  min="0"
                                  className={`w-full h-10 text-center bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 transition font-bold text-blue-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${hasGuns ? 'opacity-50 cursor-not-allowed' : 'focus:bg-white'}`}
                                  value={hasGuns ? (currentItem.guns || []).reduce((sum, g) => sum + (typeof g.hours === 'number' ? g.hours : (parseFloat(g.hours as string) || 0)), 0) : currentItem.hours}
                                  onChange={(e) => !hasGuns && handleItemChange(modalDesignerId, modalDate, currentItem.id, 'hours', e.target.value)}
                                  disabled={hasGuns}
                                  placeholder="工时"
                                />
                              </div>
                              <button
                                onClick={() => deleteItem(modalDesignerId, modalDate, currentItem.id)}
                                className="mt-4 p-2 text-gray-300 hover:text-red-600 transition"
                                title="删除任务"
                              >
                                <Trash2 size={20} />
                              </button>
                            </div>
                            )}

                            {!isLeave && !isTrip && (
                            <div className="mt-2 pl-4 border-l-2 border-gray-100 flex flex-col gap-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">枪名</span>
                                <button 
                                  onClick={() => {
                                    const newGuns = [...(currentItem.guns || []), { id: `gun-${Date.now()}`, name: '', hours: 0 }];
                                    setTaskTypeDrafts(prev => ({
                                      ...prev,
                                      [currentItem.id]: { ...(prev[currentItem.id] || {}), designName: currentItem.taskName || '', designGuns: newGuns }
                                    }));
                                    handleItemChange(modalDesignerId, modalDate, currentItem.id, 'guns', newGuns);
                                  }}
                                  disabled={!currentItem.taskName || !currentItem.taskName.trim()}
                                  className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-100 transition font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  + 添加枪名
                                </button>
                              </div>
                              {(currentItem.guns || []).map((gun, gIdx) => (
                                <div key={gun.id} className="flex items-center gap-2 bg-gray-50/50 p-2 rounded-lg group/gun">
                                  <input 
                                    ref={el => inputRefs.current[`gun-${currentItem.id}-${gIdx}`] = el}
                                    className="flex-1 h-8 px-2 bg-transparent border-b-2 border-gray-200 focus:border-blue-400 outline-none text-xs transition"
                                    value={gun.name}
                                    placeholder="枪名..."
                                    onChange={(e) => {
                                      const newGuns = [...(currentItem.guns || [])];
                                      newGuns[gIdx] = { ...newGuns[gIdx], name: e.target.value };
                                      setTaskTypeDrafts(prev => ({
                                        ...prev,
                                        [currentItem.id]: { ...(prev[currentItem.id] || {}), designName: currentItem.taskName || '', designGuns: newGuns }
                                      }));
                                      handleItemChange(modalDesignerId, modalDate, currentItem.id, 'guns', newGuns);
                                    }}
                                  />
                                  <input 
                                    ref={el => inputRefs.current[`gunHours-${currentItem.id}-${gIdx}`] = el}
                                    type="number"
                                    step="0.5"
                                    min="0"
                                    className="w-16 h-8 text-center bg-transparent border-b-2 border-gray-200 focus:border-blue-400 outline-none text-xs font-bold text-blue-600 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    value={gun.hours}
                                    placeholder="工时"
                                    onChange={(e) => {
                                      const newGuns = [...(currentItem.guns || [])];
                                      newGuns[gIdx] = { ...newGuns[gIdx], hours: parseFloat(e.target.value) || 0 };
                                      setTaskTypeDrafts(prev => ({
                                        ...prev,
                                        [currentItem.id]: { ...(prev[currentItem.id] || {}), designName: currentItem.taskName || '', designGuns: newGuns }
                                      }));
                                      handleItemChange(modalDesignerId, modalDate, currentItem.id, 'guns', newGuns);
                                    }}
                                  />
                                  <button 
                                    onClick={() => {
                                      const newGuns = (currentItem.guns || []).filter((_, i) => i !== gIdx);
                                      setTaskTypeDrafts(prev => ({
                                        ...prev,
                                        [currentItem.id]: { ...(prev[currentItem.id] || {}), designName: currentItem.taskName || '', designGuns: newGuns }
                                      }));
                                      handleItemChange(modalDesignerId, modalDate, currentItem.id, 'guns', newGuns);
                                    }}
                                    className="p-1 text-red-400 hover:text-red-600 transition"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              ))}
                            </div>
                            )}

                            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-50">
                              <span className="text-[10px] text-gray-400 font-bold uppercase">任务类型:</span>
                              <div className="flex gap-2">
                                {(() => {
                                  // 获取考虑 pendingChanges 后的 leaveType
                                  const currentLeaveType = getItemFieldWithPendingChanges(item.id, 'leaveType') ?? item.leaveType;
                                  
                                  return (
                                    <>
                                      <button
                                        onClick={() => {
                                          rememberCurrentTypeDraft();
                                          const designName = getDesignDraftName();
                                          const designGuns = getDesignDraftGuns();
                                          setPendingChanges(prev => {
                                            const filtered = prev.filter(change => 
                                              !(change.designerId === modalDesignerId && change.date === modalDate && change.itemId === item.id && (change.field === 'leaveType' || change.field === 'taskName' || change.field === 'guns'))
                                            );
                                            return [
                                              ...filtered,
                                              { designerId: modalDesignerId, date: modalDate, itemId: item.id, field: 'leaveType', value: null },
                                              { designerId: modalDesignerId, date: modalDate, itemId: item.id, field: 'taskName', value: designName },
                                              { designerId: modalDesignerId, date: modalDate, itemId: item.id, field: 'guns', value: designGuns }
                                            ];
                                          });
                                        }}
                                        className={`px-3 py-1 text-xs font-bold rounded transition ${!currentLeaveType ? 'bg-gray-100 text-gray-800 border border-gray-400' : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'}`}
                                      >
                                        设计计划
                                      </button>
                                      <button
                                        onClick={() => {
                                          rememberCurrentTypeDraft();
                                          const tripName = getTripDraftName();
                                          setPendingChanges(prev => {
                                            const filtered = prev.filter(change => 
                                              !(change.designerId === modalDesignerId && change.date === modalDate && change.itemId === item.id && (change.field === 'leaveType' || change.field === 'taskName' || change.field === 'guns'))
                                            );
                                            const changes: PendingChange[] = [
                                              ...filtered,
                                              { designerId: modalDesignerId, date: modalDate, itemId: item.id, field: 'guns', value: [] },
                                              { designerId: modalDesignerId, date: modalDate, itemId: item.id, field: 'leaveType', value: 'trip' },
                                              { designerId: modalDesignerId, date: modalDate, itemId: item.id, field: 'taskName', value: tripName }
                                            ];
                                            return changes;
                                          });
                                        }}
                                        className={`px-3 py-1 text-xs font-bold rounded transition ${currentLeaveType === 'trip' ? 'bg-yellow-100 text-yellow-800 border border-yellow-300' : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200'}`}
                                      >
                                        出差
                                      </button>
                                      <button
                                        onClick={() => {
                                          rememberCurrentTypeDraft();
                                          setPendingChanges(prev => {
                                            const filtered = prev.filter(change => 
                                              !(change.designerId === modalDesignerId && change.date === modalDate && change.itemId === item.id && (change.field === 'leaveType' || change.field === 'guns'))
                                            );
                                            return [
                                              ...filtered,
                                              { designerId: modalDesignerId, date: modalDate, itemId: item.id, field: 'guns', value: [] },
                                              { designerId: modalDesignerId, date: modalDate, itemId: item.id, field: 'leaveType', value: 'sick' }
                                            ];
                                          });
                                        }}
                                        className={`px-3 py-1 text-xs font-bold rounded transition ${currentLeaveType === 'sick' ? 'bg-red-100 text-red-700 border border-red-300' : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200'}`}
                                      >
                                        事假
                                      </button>
                                      <button
                                        onClick={() => {
                                          rememberCurrentTypeDraft();
                                          setPendingChanges(prev => {
                                            const filtered = prev.filter(change => 
                                              !(change.designerId === modalDesignerId && change.date === modalDate && change.itemId === item.id && (change.field === 'leaveType' || change.field === 'guns'))
                                            );
                                            return [
                                              ...filtered,
                                              { designerId: modalDesignerId, date: modalDate, itemId: item.id, field: 'guns', value: [] },
                                              { designerId: modalDesignerId, date: modalDate, itemId: item.id, field: 'leaveType', value: 'vacation' }
                                            ];
                                          });
                                        }}
                                        className={`px-3 py-1 text-xs font-bold rounded transition ${currentLeaveType === 'vacation' ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200'}`}
                                      >
                                        休假
                                      </button>
                                      <button
                                        onClick={() => {
                                          rememberCurrentTypeDraft();
                                          setPendingChanges(prev => {
                                            const filtered = prev.filter(change => 
                                              !(change.designerId === modalDesignerId && change.date === modalDate && change.itemId === item.id && (change.field === 'leaveType' || change.field === 'guns'))
                                            );
                                            return [
                                              ...filtered,
                                              { designerId: modalDesignerId, date: modalDate, itemId: item.id, field: 'guns', value: [] },
                                              { designerId: modalDesignerId, date: modalDate, itemId: item.id, field: 'leaveType', value: 'illness' }
                                            ];
                                          });
                                        }}
                                        className={`px-3 py-1 text-xs font-bold rounded transition ${currentLeaveType === 'illness' ? 'bg-pink-100 text-pink-700 border border-pink-300' : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200'}`}
                                      >
                                        病假
                                      </button>
                                    </>
                                  );
                                })()}
                              </div>
                            </div>
                            
                            {isAdmin && !isLeave && !isTrip && (
                            <>
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
                            </>
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
                <div className="text-sm font-bold text-gray-600 ml-4">
                  当日总工时: <span className="text-blue-700 text-lg ml-1">{calculateDailyTotal(modalDesignerId, modalDate).toFixed(1)}</span> H
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">主任务为空、工时为 0，或已填写枪名的工时为 0 时无法保存</span>
                <button
                  onClick={async () => {
                    if (isAddMode) {
                      // 在添加模式下，保存用户输入的任务
                      const guns = selectedTaskType === 'none' ? addModeGuns : [];
                      const hours = guns.length > 0
                        ? guns.reduce((sum, gun) => sum + (parseFloat(String(gun.hours)) || 0), 0)
                        : addModeHours || 0;
                      const leaveType = selectedTaskType === 'none' ? null : selectedTaskType;
                      let taskName = '';
                      
                      if (selectedTaskType === 'trip') {
                        const place = addModeTripPlace.trim();
                        taskName = place ? `${place}出差` : '出差';
                      } else if (selectedTaskType === 'none') {
                        taskName = addModeTaskName.trim() || '未命名';
                      }
                      
                      try {
                        const authHeader = { headers: { Authorization: `Bearer ${token}` } };
                        const res = await axios.post('/api/tasks/item', { 
                          designerId: modalDesignerId, 
                          date: modalDate, 
                          taskName, 
                          leaveType, 
                          hours,
                          color: addModeColor,
                          guns
                        }, authHeader);
                        upsertSheet(res.data.sheet);
                        socketRef.current?.emit('task_updated');
                        setPendingChanges([]);
                        setFocusTarget(null);
                        setModalOpen(false);
                        socketRef.current?.emit('stop_editing');
                        addToast('任务已保存', 'success');
                      } catch (err) {
                        addToast('保存失败', 'error');
                      }
                    } else {
                      // 保存所有待保存的更改
                      try {
                        const currentFocusTarget = focusTarget;
                        if (!currentFocusTarget) return;

                        // 先更新本地 sheets 状态
                        setSheets(prev => {
                          const next = prev.map(sheet => {
                            if (sheet.designerId !== modalDesignerId || !sheet.days?.[modalDate]) return sheet;
                            const dayItems = [...sheet.days[modalDate]];
                            const itemIndex = dayItems.findIndex(i => i.id === currentFocusTarget.itemId);
                            if (itemIndex === -1) return sheet;
                            
                            // 应用所有 pendingChanges 到这个 item
                            const itemChanges = pendingChanges.filter(change => change.itemId === currentFocusTarget.itemId);
                            const updatedItem = { ...dayItems[itemIndex] };
                            itemChanges.forEach(change => {
                              updatedItem[change.field as keyof TaskItem] = change.value;
                            });
                            
                            dayItems[itemIndex] = updatedItem;
                            return { ...sheet, days: { ...sheet.days, [modalDate]: dayItems } };
                          });
                          return next;
                        });
                        
                        // 然后保存到服务器
                        for (const change of pendingChanges) {
                          await saveItem(change.designerId, change.date, change.itemId, change.field, change.value);
                        }
                        
                        // 清空待保存的更改
                        setPendingChanges([]);
                        // 关闭模态框
                        setFocusTarget(null);
                        setModalOpen(false);
                        socketRef.current?.emit('stop_editing');
                        addToast('任务已保存', 'success');
                      } catch (err) {
                        addToast('保存失败', 'error');
                        // 如果保存失败，重新加载数据
                        fetchSheets();
                      }
                    }
                  }}
                  disabled={(() => {
                    if (isAddMode) {
                      if (selectedTaskType === 'none') {
                        const totalGunHours = addModeGuns.reduce((sum, gun) => sum + (parseFloat(String(gun.hours)) || 0), 0);
                        return !addModeTaskName.trim() || hasInvalidNamedGunHours(addModeGuns) || (addModeGuns.length > 0 ? totalGunHours === 0 : addModeHours === 0);
                      }
                      return addModeHours === 0;
                    }
                    if (focusTarget && focusTarget.itemId) {
                      const item = getAllItems(modalDesignerId, modalDate).find(i => i.id === focusTarget.itemId);
                      if (item) {
                        const hours = typeof item.hours === 'number' ? item.hours : (parseFloat(item.hours as string) || 0);
                        const leaveType = item.leaveType;
                        const taskName = item.taskName || '';
                        const hasGuns = item.guns && item.guns.length > 0;
                        
                        if (hasGuns) {
                          const totalGunsHours = (item.guns || []).reduce((sum, g) => sum + (typeof g.hours === 'number' ? g.hours : (parseFloat(g.hours as string) || 0)), 0);
                          return hasInvalidNamedGunHours(item.guns) || totalGunsHours === 0;
                        }
                        
                        if (!leaveType) {
                          return !taskName.trim() || hours === 0;
                        } else {
                          return hours === 0;
                        }
                      }
                    }
                    return calculateDailyTotal(modalDesignerId, modalDate) === 0;
                  })()}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-bold shadow-lg shadow-blue-100 disabled:bg-gray-300 disabled:cursor-not-allowed disabled:hover:bg-gray-300"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
