import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { axiosInstance } from '../../services/api';
import { isAxiosError } from 'axios';
import type { Socket } from 'socket.io-client';
import { useAuth } from '../../context/AuthContext';
import { useSystemSettings } from '../../context/SystemSettingsContext';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, UserCog, ChevronLeft, ChevronRight, RefreshCw, AlertCircle, CheckCircle, Plus, Trash2, FileSpreadsheet, ChevronDown, ChevronUp, X, GripVertical, Clock, Settings, BookOpen, ClipboardList, Crosshair, Lock, Eye, EyeOff, Maximize2, Minimize2, HelpCircle, Keyboard, Move, MousePointerClick, Hand, Copy, Zap } from 'lucide-react';
import { format, getDaysInMonth, startOfMonth, addDays, isWeekend } from 'date-fns';
import { useDebounce } from '../../utils/debounce';
import { acquireSocket } from '../../utils/socketClient';
import { OFFLINE_SHEETS_CACHE_KEY } from '../../utils/offlineSheetsCache';
import { getEffectiveIsWeekend, getWorkdayOverrideLabel, normalizeWorkdayOverrides, WorkdayOverrides, WorkdayOverrideType } from '../../utils/workdayOverrides';
import { resolveAutoFillHours, GunLocation } from '../../utils/gunHoursRules';
import {
  detectTaskContentType,
  getTaskBaseColor,
  getTaskDisplayColors,
  getLeaveRowColors,
  supportsUrgent,
  PAUSED_TASK_SUFFIX,
  TASK_CONTENT_TYPES,
  TASK_TEXT_COLOR,
  TASK_URGENT_TEXT_COLOR,
} from '../../utils/taskColors';
import {
    DndContext,
    DragOverlay,
  } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import SortableTask from './components/SortableTask';
import DroppableCell from './components/DroppableCell';
import QuickConfirmModifyModal from './components/QuickConfirmModifyModal';
import { useEditingSessions } from './hooks/useEditingSessions';
import LoadingScreen from '../../components/LoadingScreen';
import { useTaskHistory } from './hooks/useTaskHistory';
import { useGunDragDrop } from './hooks/useGunDragDrop';
import { defaultAccessSettings } from './constants';
import {
  taskSelectionKey,
  editingSessionKey,
  isEditableKeyboardTarget,
  isWhiteTaskColor,
  extractSpecNumber,
  splitDesignTaskName,
  getDeliveryDateSuffix,
  getDesignPlanClientName,
  buildSyncedSpecTaskName,
  hasInvalidNamedGunHours,
  hasDuplicateGunNames,
  getHoursInputValue,
  getGunHoursTotalInputValue,
  isMeaningfulTask,
  getTaskHours,
  buildTaskMetadataTitle,
  syncGunsWithTaskColor,
} from './utils';
import type {
  GunItem,
  TaskItem,
  TaskSheet,
  SpecInfoResponse,
  Designer,
  TaskField,
  PendingChange,
  EditingSession,
  BatchReplaceMatch,
  SelectedTask,
  Toast,
} from './types';

// 主任务「任务内容」复选框对应的类型（6 个并列选项）：
// 确认图 / 设计 / 确认图修改 按枪名规则取工时，且支持「任务加急」；
// 设计变更 / 既制审图 取系统设置中的固定工时；
// 暂停/取消 是独立状态：任务名后缀 + 纯红底，工时按 0 计、不计入统计。
type DesignTaskType = 'none' | 'confirm' | 'design' | 'confirmModify' | 'designChange' | 'drawingReview' | 'paused';

const Dashboard = () => {
  const { user, token, logout } = useAuth();
  const { specNumberDigits, settings: systemSettings, refreshSettings } = useSystemSettings();
  // 进入主页时回读一次系统设置：保证在 /system-settings 保存的配色立刻生效（含其他标签页保存的情况）
  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings]);
  // 任务内容配色体系：按「任务内容后缀 + 加急」派生单元格底色与文字色（白色=已完成时保留白底）
  const getItemDisplayColors = useCallback(
    (item: TaskItem) => getTaskDisplayColors(systemSettings.taskColorConfig, item),
    [systemSettings.taskColorConfig]
  );
  const location = useLocation();
  const navigate = useNavigate();
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
  const [allowUserDesignPlanColorMark, setAllowUserDesignPlanColorMark] = useState(true);
  const [allowUserChangePassword, setAllowUserChangePassword] = useState(false);
  const [leaderboardAccess, setLeaderboardAccess] = useState(defaultAccessSettings);
  const [workHoursAccess, setWorkHoursAccess] = useState(defaultAccessSettings);
  const [statusTrackingAccess, setStatusTrackingAccess] = useState(defaultAccessSettings);
  const [designStandardsAccess, setDesignStandardsAccess] = useState(defaultAccessSettings);
  const [gunLedgerAccess, setGunLedgerAccess] = useState(defaultAccessSettings);
  const [systemSettingsAccess, setSystemSettingsAccess] = useState(defaultAccessSettings);
  const [workdayOverrides, setWorkdayOverrides] = useState<WorkdayOverrides>({});
  const [updatingWorkdayOverrideDate, setUpdatingWorkdayOverrideDate] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const addToast = useCallback((message: string, type: 'success' | 'error') => {
    const id = Date.now();
    setToasts(prev => [...prev, { message, type, id }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);
  const [selectedDesignerId, setSelectedDesignerId] = useState<string>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDate, setModalDate] = useState<string | null>(null);
  const [modalDesignerId, setModalDesignerId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<TaskItem[] | null>(null);
  const clipboardRef = useRef<TaskItem[] | null>(null);
  useEffect(() => {
    clipboardRef.current = clipboard;
  }, [clipboard]);
  const [focusTarget, setFocusTarget] = useState<{itemId: string, type: 'task' | 'hours' | 'gun' | 'gunHours', gunIndex?: number} | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<SelectedTask[]>([]);
  const selectedTasksRef = useRef<SelectedTask[]>([]);
  useEffect(() => {
    selectedTasksRef.current = selectedTasks;
  }, [selectedTasks]);
  const [selectedCell, setSelectedCell] = useState<{designerId: string, date: string} | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const handledJumpKeyRef = useRef<string | null>(null);
  const hasShownDisconnectToast = useRef(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [offlineCacheUsed, setOfflineCacheUsed] = useState(false);
  const [versionInfo, setVersionInfo] = useState<{ currentVersion: string; hasUpdate: boolean; latestVersion: string | null } | null>(null);
  const [clientInfo, setClientInfo] = useState<{ ip: string; browser: string; summary: string; lastLoginAt?: string | null; previousLoginAt?: string | null } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // 操作说明弹窗（仅管理员可见入口）
  const [helpGuideOpen, setHelpGuideOpen] = useState(false);
  // 快捷添加「确认图修改」弹窗（连按两次 Shift，仅管理员）
  const [quickModifyOpen, setQuickModifyOpen] = useState(false);
  const [batchReplaceOpen, setBatchReplaceOpen] = useState(false);
  const [batchFindText, setBatchFindText] = useState('');
  const [batchReplaceText, setBatchReplaceText] = useState('');
  const [batchReplaceAllTable, setBatchReplaceAllTable] = useState(false);
  const [batchReplaceLoading, setBatchReplaceLoading] = useState(false);
  const [batchSearchLoading, setBatchSearchLoading] = useState(false);
  const [batchMatches, setBatchMatches] = useState<BatchReplaceMatch[]>([]);
  const [batchMatchCount, setBatchMatchCount] = useState(0);
  const [batchSearchDone, setBatchSearchDone] = useState(false);
  // 点击"定位"后模态框临时半透明，方便透过模态框查看底部表格中的目标任务
  const [batchLocateDimmed, setBatchLocateDimmed] = useState(false);
  const batchLocateRestoreTimerRef = useRef<number | null>(null);

  // 修改密码模态框
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [visiblePasswords, setVisiblePasswords] = useState({ old: false, new: false, confirm: false });
  const [changePasswordError, setChangePasswordError] = useState('');
  const [changePasswordSuccess, setChangePasswordSuccess] = useState('');
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const isOfflineMode = !isOnline || offlineCacheUsed;
  const canEditTasks = isAdmin && !isOfflineMode;
  // 经 ref 暴露给 socket 监听使用：该监听所在 effect 不能把 canEditTasks 放进依赖
  // （会导致 socket 反复解绑重绑），用 ref 避免闭包捕获到过期值。
  const canEditTasksRef = useRef(canEditTasks);
  canEditTasksRef.current = canEditTasks;
  // 只读用户的延迟全量刷新：合并窗口计时器 + 页面在后台期间挂起的刷新标记
  const deferredRefreshTimerRef = useRef<number | null>(null);
  const pendingFullRefreshRef = useRef(false);
  const isOfflineModeRef = useRef(isOfflineMode);

  useEffect(() => {
    isOfflineModeRef.current = isOfflineMode;
  }, [isOfflineMode]);

  // 操作说明弹窗：Esc 关闭
  useEffect(() => {
    if (!helpGuideOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setHelpGuideOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [helpGuideOpen]);

  // 批量操作模态框关闭时恢复透明度并清理定位恢复计时器
  useEffect(() => {
    if (batchReplaceOpen) return;
    setBatchLocateDimmed(false);
    if (batchLocateRestoreTimerRef.current) {
      window.clearTimeout(batchLocateRestoreTimerRef.current);
      batchLocateRestoreTimerRef.current = null;
    }
  }, [batchReplaceOpen]);

  // 普通用户且在设计人员列表中时，打开主页面默认只显示本人任务；
  // 管理员（admin/superadmin）且在设计人员列表中时，默认筛选显示其所在分组
  const autoFilteredDesignerRef = useRef(false);
  useEffect(() => {
    if (autoFilteredDesignerRef.current) return;
    if (!user || designers.length === 0) return;
    autoFilteredDesignerRef.current = true;
    if (jumpTarget) return; // 带 URL 任务跳转参数时不按人员/分组筛选，确保目标任务可见
    const targetName = String(user.name || '').trim().toLowerCase();
    if (!targetName) return;
    const matched = designers.find(d => String(d.name || '').trim().toLowerCase() === targetName);
    if (!matched) return;
    if (user.role === 'user') {
      setSelectedDesignerId(matched.id);
    } else {
      const group = matched.group || '未分组';
      setSelectedDesignerId(`group:${group}`);
      // 默认展开其所在分组，避免历史折叠状态导致看不到成员
      setCollapsedGroups(prev => {
        if (!prev[group]) return prev;
        const next = { ...prev, [group]: false };
        localStorage.setItem('collapsedGroups', JSON.stringify(next));
        return next;
      });
    }
  }, [user, designers, jumpTarget]);

  // 获取版本信息
  useEffect(() => {
    axiosInstance.get('/system/version')
      .then(res => setVersionInfo(res.data))
      .catch(() => {});
  }, []);

  // 获取当前登录用户的客户端信息（IP、浏览器）
  useEffect(() => {
    axiosInstance.get('/auth/client-info')
      .then(res => setClientInfo(res.data))
      .catch(() => {});
  }, []);

  // 同步全屏状态（支持通过 Esc 等方式退出）
  // 注意：浏览器 F11 走的是原生全屏，不触发 fullscreenchange、也不设置 fullscreenElement，
  // 因此在下方拦截 F11 按键改走 toggleFullscreen()（Fullscreen API），
  // 使 F11 与右下角按钮效果一致、按钮文字可正确同步为「退出全屏」
  useEffect(() => {
    const syncFullscreenState = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', syncFullscreenState);
    syncFullscreenState();
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  // 切换全屏显示
  const toggleFullscreen = useCallback(async () => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
      webkitCancelFullScreen?: () => Promise<void> | void;
    };
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    try {
      if (document.fullscreenElement || doc.webkitFullscreenElement) {
        const exit = doc.exitFullscreen?.bind(doc) || doc.webkitExitFullscreen?.bind(doc) || doc.webkitCancelFullScreen?.bind(doc);
        await exit?.();
      } else {
        const request = el.requestFullscreen?.bind(el) || el.webkitRequestFullscreen?.bind(el);
        await request?.();
      }
    } catch {
      // 浏览器拒绝全屏请求时忽略（例如非用户手势触发）
    }
  }, []);

  // F11 拦截：改走 toggleFullscreen()（Fullscreen API），等价于点击右下角全屏按钮，
  // 从而让按钮文字与 F11 全屏状态保持同步（原生 F11 不触发 fullscreenchange）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        void toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleFullscreen]);

  // Input refs for modal focus
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const {
    setEditingSessions,
    getCellSessions,
    getBlockingEditingSession,
    warnIfCellLocked,
    startEditingCell,
    stopEditingCell,
  } = useEditingSessions({ user, socketRef, addToast });

  const canViewEditingUser = user?.role === 'superadmin' || user?.role === 'admin';

  const daysInMonth = getDaysInMonth(currentDate);
  const firstDayOfMonth = startOfMonth(currentDate);

  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => {
    const date = addDays(firstDayOfMonth, i);
    const fullDate = format(date, 'yyyy-MM-dd');
    const naturalIsWeekend = isWeekend(date);
    return {
      fullDate,
      dayNum: i + 1,
      naturalIsWeekend,
      isWeekend: getEffectiveIsWeekend(fullDate, naturalIsWeekend, workdayOverrides),
      dayName: format(date, 'EEE')
    };
  }), [daysInMonth, firstDayOfMonth, workdayOverrides]);

  const handleWorkdayOverrideChange = async (date: string, naturalIsWeekend: boolean, checked: boolean) => {
    if (!isAdmin || !token) return;

    const type: WorkdayOverrideType | null = checked
      ? (naturalIsWeekend ? 'workday' : 'weekend')
      : null;

    setUpdatingWorkdayOverrideDate(date);
    try {
      const res = await axiosInstance.put('/settings/workday-overrides', { date, type });
      setWorkdayOverrides(normalizeWorkdayOverrides(res.data));
      socketRef.current?.emit('task_updated');
      addToast('工作日设置已保存', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.message || '保存工作日设置失败', 'error');
      fetchWorkdayOverrides();
    } finally {
      setUpdatingWorkdayOverrideDate(null);
    }
  };

  const filteredDesigners = useMemo(() => {
    if (selectedDesignerId.startsWith('group:')) {
      const g = selectedDesignerId.slice('group:'.length);
      return designers.filter(d => (d.group || '未分组') === g && !d.hidden);
    }
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

  const designerDropdownGroups = useMemo(() => {
    const groups: Record<string, Designer[]> = {};
    designers.forEach(d => {
      const g = d.group || '未分组';
      if (!groups[g]) groups[g] = [];
      groups[g].push(d);
    });
    return Object.keys(groups).sort().map(name => ({ name, members: groups[name] }));
  }, [designers]);

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

  // URL 定位链接指向的任务不存在（人员缺失/日期无效/任务已删除）时，重定向回主页面（replace 清除查询参数）
  useEffect(() => {
    if (!jumpTarget || loading) return;
    const [year, month] = jumpTarget.date.split('-').map(Number);
    const designerExists = designers.some(d => d.id === jumpTarget.designerId);
    const sheet = sheets.find(s => s.designerId === jumpTarget.designerId);
    const targetExists = sheet?.days?.[jumpTarget.date]?.some(item => item.id === jumpTarget.itemId);
    if (!year || !month || !designerExists || !targetExists) {
      addToast('链接指向的任务不存在，已返回主页面', 'error');
      navigate('/', { replace: true });
    }
  }, [jumpTarget, loading, sheets, designers, navigate, addToast]);

  // 将今日列滚动到视图中央展示（打开主页面自动定位、点击左下角状态手动定位均复用）
  // 日期表头始终渲染且带有 data-date，整月无任务（sheets 为空）、当日无任务或分组全部折叠时也能定位到今日列
  const scrollTodayColumnIntoView = useCallback(() => {
    const now = new Date();
    if (currentDate.getFullYear() !== now.getFullYear() || currentDate.getMonth() !== now.getMonth()) return false;
    const todayStr = format(now, 'yyyy-MM-dd');
    const target = document.querySelector(`[data-date="${todayStr}"]`) as HTMLElement | null;
    if (!target) return false;
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    return true;
  }, [currentDate]);

  const todayColumnScrolledRef = useRef(false);
  useEffect(() => {
    if (todayColumnScrolledRef.current) return;
    if (loading) return;
    if (jumpTarget) return; // 带 URL 跳转参数时由跳转逻辑负责定位
    const now = new Date();
    if (currentDate.getFullYear() !== now.getFullYear() || currentDate.getMonth() !== now.getMonth()) return;
    todayColumnScrolledRef.current = true;
    const timer = window.setTimeout(() => {
      scrollTodayColumnIntoView();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [loading, sheets, designers, currentDate, jumpTarget, scrollTodayColumnIntoView]);

  // 点击左下角状态指示（就绪/离线）时定位到今日列，不触发任何重连或数据刷新
  // 连按两次 Ctrl 的快捷操作复用同一入口，行为与点击完全一致
  const handleFooterStatusClick = useCallback(() => {
    if (loading) return;
    window.setTimeout(() => {
      scrollTodayColumnIntoView();
    }, 0);
  }, [loading, scrollTodayColumnIntoView]);

  // 快捷操作：连按两次 Ctrl（间隔 400ms 内）= 点击左下角状态指示「定位到今日任务」
  // 只要两次 Ctrl 之间插入了其它按键（Ctrl+C 等组合键）或鼠标按下（Ctrl+单击多选、Ctrl+拖动复制），
  // 即打断判定并重新计数，避免与录入类快捷键冲突
  useEffect(() => {
    const DOUBLE_CTRL_INTERVAL = 400;
    let lastCtrlAt = 0;
    let ctrlComboUsed = false;

    const resetTap = () => { lastCtrlAt = 0; };

    const handleDoubleCtrlKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        if (e.repeat || ctrlComboUsed) return;
        const now = Date.now();
        if (lastCtrlAt && now - lastCtrlAt <= DOUBLE_CTRL_INTERVAL) {
          resetTap();
          if (loading) return;
          if (!scrollTodayColumnIntoView()) {
            addToast('当前不在本月视图，无法定位今日任务', 'error');
          }
        } else {
          lastCtrlAt = now;
        }
        return;
      }
      // 按住 Ctrl 时按下其它键（Ctrl+C / Ctrl+V 等）会打断双击判定，避免误触
      if (e.ctrlKey || e.metaKey) ctrlComboUsed = true;
      resetTap();
    };

    const handleDoubleCtrlKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') ctrlComboUsed = false;
    };

    // Ctrl+单击多选任务、Ctrl+拖动复制等鼠标组合操作同样打断判定
    const handleDoubleCtrlMouseDown = () => { resetTap(); };

    window.addEventListener('keydown', handleDoubleCtrlKeyDown);
    window.addEventListener('keyup', handleDoubleCtrlKeyUp);
    window.addEventListener('mousedown', handleDoubleCtrlMouseDown);
    return () => {
      window.removeEventListener('keydown', handleDoubleCtrlKeyDown);
      window.removeEventListener('keyup', handleDoubleCtrlKeyUp);
      window.removeEventListener('mousedown', handleDoubleCtrlMouseDown);
    };
  }, [loading, scrollTodayColumnIntoView, addToast]);

  // 快捷添加「确认图修改」：连按两次 Shift（间隔 400ms 内）呼出枪名搜索弹窗，仅管理员生效
  // 两次 Shift 之间插入其它按键（Shift+字母、Shift+Tab 等组合键）或鼠标按下都会打断判定；
  // Shift 是打字常用键，光标在输入框内时不参与判定，避免录入时误弹
  useEffect(() => {
    if (!isAdmin) return;
    const DOUBLE_SHIFT_INTERVAL = 400;
    let lastShiftAt = 0;
    let shiftComboUsed = false;

    const resetTap = () => { lastShiftAt = 0; };

    const isTypingTarget = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && !!el.closest('input, textarea, select, [contenteditable="true"]');
    };

    const handleDoubleShiftKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        if (e.repeat || shiftComboUsed) return;
        if (isTypingTarget()) return;
        const now = Date.now();
        if (lastShiftAt && now - lastShiftAt <= DOUBLE_SHIFT_INTERVAL) {
          resetTap();
          if (quickModifyOpen || modalOpen || helpGuideOpen || batchReplaceOpen || changePasswordOpen) return;
          if (isOfflineMode) {
            addToast('当前离线，禁止编辑', 'error');
            return;
          }
          e.preventDefault();
          setQuickModifyOpen(true);
        } else {
          lastShiftAt = now;
        }
        return;
      }
      // 按住 Shift 时按下其它键（Shift+字母 / Shift+Tab 等）打断判定
      if (e.shiftKey) shiftComboUsed = true;
      resetTap();
    };

    const handleDoubleShiftKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftComboUsed = false;
    };

    // Shift+单击（多选、Shift+点击链接）同样打断判定
    const handleDoubleShiftMouseDown = () => { resetTap(); };

    window.addEventListener('keydown', handleDoubleShiftKeyDown);
    window.addEventListener('keyup', handleDoubleShiftKeyUp);
    window.addEventListener('mousedown', handleDoubleShiftMouseDown);
    return () => {
      window.removeEventListener('keydown', handleDoubleShiftKeyDown);
      window.removeEventListener('keyup', handleDoubleShiftKeyUp);
      window.removeEventListener('mousedown', handleDoubleShiftMouseDown);
    };
  }, [isAdmin, isOfflineMode, quickModifyOpen, modalOpen, helpGuideOpen, batchReplaceOpen, changePasswordOpen, addToast]);



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
  // 是否在任务名称后显示/添加纳期（[M/D]），默认不勾选
  const [showDeadline, setShowDeadline] = useState(false);
  // 新增模式下查询到的纳期标签字符串（如 "[9/15]"），用于在输入框右侧预览显示
  const [addModeDeadlineTag, setAddModeDeadlineTag] = useState<string | null>(null);
  // 是否手动输入纳期（仅在勾选"显示纳期"后可用），默认不勾选
  const [manualDeadline, setManualDeadline] = useState(false);
  // 手动输入的纳期原始值（如 "9/15"），保存/同步时自动包装为 [M/D]
  const [manualDeadlineInput, setManualDeadlineInput] = useState<string>('');
  const [selectedTaskType, setSelectedTaskType] = useState<'none' | 'trip' | 'sick' | 'vacation' | 'illness'>('none');
  const [addModeTaskName, setAddModeTaskName] = useState<string>('');
  const [addModeTripPlace, setAddModeTripPlace] = useState<string>('');
  const [addModeHours, setAddModeHours] = useState<string>('');
  const [addModeGuns, setAddModeGuns] = useState<GunItem[]>([]);
  // 自动获取枪名：通过仕样号在 gun-ledger 中查找匹配枪名
  const [autoGunLookupLoading, setAutoGunLookupLoading] = useState(false);
  const [autoGunLookupResults, setAutoGunLookupResults] = useState<{ gunName: string; customer: string; tableName: string; category: string; used?: boolean }[] | null>(null);
  const [autoGunLookupContext, setAutoGunLookupContext] = useState<'add' | 'edit' | null>(null);
  const [autoGunLookupItemId, setAutoGunLookupItemId] = useState<string | null>(null);
  const [autoGunLookupChecked, setAutoGunLookupChecked] = useState<Set<number>>(new Set());
  // 任务加急：勾选后整行改用加急配色；确认图 / 设计 / 确认图修改 的文字同时变红
  const [urgentDraft, setUrgentDraft] = useState(false);
  const [addModeTaskType, setAddModeTaskType] = useState<DesignTaskType>('none');
  // 新增模式是否勾选了「暂停/取消」：勾选后工时按 0 计，且不再显示工时
  const addModePaused = addModeTaskType === 'paused';
  const [taskTypeDrafts, setTaskTypeDrafts] = useState<Record<string, { designName?: string; designGuns?: GunItem[]; tripName?: string; taskType?: DesignTaskType }>>({});
  const addModeSpecLookupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addModeSpecLookupSeqRef = useRef(0);

  const clearAddModeSpecLookup = () => {
    addModeSpecLookupSeqRef.current += 1;
    if (addModeSpecLookupTimeoutRef.current) {
      clearTimeout(addModeSpecLookupTimeoutRef.current);
      addModeSpecLookupTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (addModeSpecLookupTimeoutRef.current) {
        clearTimeout(addModeSpecLookupTimeoutRef.current);
      }
    };
  }, []);

  // 枪名 → 所在台账分类/表 的索引（打开弹窗时刷新），用于匹配该表专用默认工时
  const [gunLocations, setGunLocations] = useState<Record<string, GunLocation>>({});

  const fetchGunLocations = useCallback(async () => {
    if (!token) return;
    try {
      const res = await axiosInstance.get(
        '/gun-ledger/gun-name-locations',
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const locations = res.data?.locations;
      if (locations && typeof locations === 'object') setGunLocations(locations);
    } catch {
      // 无台账访问权限或拉取失败时静默降级为 C/X 回退 + 兜底
    }
  }, [token]);

  // 根据任务类型 + 枪名获取默认工时：
  // 设计变更 / 既制审图 → 系统设置中的固定工时（不分 C/X、不套用专用规则）；
  // 其余三类 → 枪名所在表专用规则 → C/X 机型回退 → 固定兜底（2 / 0.75 / 3）；请假、出差等返回 null
  const getDefaultGunHoursFor = (
    taskType: DesignTaskType,
    gunName: string
  ): number | null => {
    const name = String(gunName || '').trim();
    const location = name ? (gunLocations[name] || null) : null;
    return resolveAutoFillHours(taskType, name, location, systemSettings);
  };

  // 切换任务内容时重算枪名工时：已填枪名的行一律覆盖为新任务内容对应的工时
  // （枪名为空的行保持原样；没有枪名时不写总工时，由用户手动输入总工时）
  const applyTaskTypeToGuns = (
    guns: GunItem[],
    taskType: DesignTaskType
  ): GunItem[] => {
    if (taskType === 'none') return guns;
    return guns.map(gun => {
      if (!String(gun.name || '').trim()) return gun;
      const hours = getDefaultGunHoursFor(taskType, gun.name);
      return hours !== null ? { ...gun, hours } : gun;
    });
  };

  // 枪名变化时的工时处理：
  // 1. 工时空缺 → 按新枪名 + 当前任务内容补默认工时；
  // 2. 工时是自动填充值（等于旧枪名的默认工时）→ 跟随新枪名切换；
  // 3. 工时是手动输入的 → 保留，不覆盖。
  const fillHoursForGunName = (
    gun: GunItem,
    nextName: string,
    taskType: DesignTaskType
  ): GunItem => {
    const nextHours = getDefaultGunHoursFor(taskType, nextName);
    const nextGun = { ...gun, name: nextName };
    if (nextHours === null) return nextGun;
    const currentHours = String(gun.hours ?? '').trim();
    if (currentHours === '') return { ...nextGun, hours: nextHours };
    const prevAutoHours = getDefaultGunHoursFor(taskType, gun.name);
    const numericHours = parseFloat(currentHours);
    return prevAutoHours !== null && numericHours === prevAutoHours
      ? { ...nextGun, hours: nextHours }
      : nextGun;
  };

  // 从任务名后缀反推任务内容（编辑模式复选框依赖任务名后缀）
  const getTaskTypeFromName = (taskName?: string): DesignTaskType => {
    const name = String(taskName || '');
    if (name.includes(PAUSED_TASK_SUFFIX) || name.includes('暂停')) return 'paused';
    if (name.includes('设计变更')) return 'designChange';
    if (name.includes('既制审图')) return 'drawingReview';
    if (name.includes('确认图修改')) return 'confirmModify';
    if (name.includes('确认图')) return 'confirm';
    if (name.includes('设计')) return 'design';
    return 'none';
  };

  const openModal = (designerId: string, date: string, addMode: boolean = false) => {
    if (!canEditTasks) {
      if (isOfflineMode) addToast('当前离线，禁止编辑', 'error');
      return;
    }
    // 新增主任务不占用编辑会话：不影响他人编辑/新增该单元格的其他主任务
    // 刷新枪名所在表索引，保证专用工时规则匹配到最新台账
    fetchGunLocations();
    setModalDesignerId(designerId);
    setModalDate(date);
    setFocusTarget(null);
    setIsAddMode(addMode);
    setSelectedTaskType('none');
    setAddModeTaskName('');
    setAddModeTripPlace('');
    setAddModeHours('');
    setAddModeGuns([]);
    setUrgentDraft(false);
    setAddModeTaskType('none');
    // 新增任务默认勾选「显示纳期」：任务名里能提取到仕样号时自动带上 [M/D]
    setShowDeadline(true);
    setAddModeDeadlineTag(null);
    setManualDeadline(false);
    setManualDeadlineInput('');
    clearAddModeSpecLookup();
    // 关闭自动获取枪名面板，避免上次查询残留
    setAutoGunLookupLoading(false);
    setAutoGunLookupResults(null);
    setAutoGunLookupContext(null);
    setAutoGunLookupItemId(null);
    setAutoGunLookupChecked(new Set());
    setTaskTypeDrafts({});
    setModalOpen(true);
  };

  const onTaskClick = (item: TaskItem, designerId: string, date: string, type: 'task' | 'hours' | 'gun' | 'gunHours', gunIndex?: number) => {
    if (!canEditTasks) {
      if (isOfflineMode) addToast('当前离线，禁止编辑', 'error');
      return;
    }
    if (warnIfCellLocked(designerId, date, item.id)) return;
    startEditingCell(designerId, date, item.id);
    setModalDesignerId(designerId);
    setModalDate(date);
    setFocusTarget({ itemId: item.id, type, gunIndex });
    setIsAddMode(false);
    setUrgentDraft(Boolean(item.urgent));
    // 记住该任务原有的纳期状态：任务名以 [M/D] 结尾则勾选"显示纳期"
    setShowDeadline(/\[\d{1,2}\/\d{1,2}\]\s*$/.test((item.taskName || '').trim()));
    setManualDeadline(false);
    setManualDeadlineInput('');
    // 关闭自动获取枪名面板，避免上次查询残留
    setAutoGunLookupLoading(false);
    setAutoGunLookupResults(null);
    setAutoGunLookupContext(null);
    setAutoGunLookupItemId(null);
    setAutoGunLookupChecked(new Set());
    setTaskTypeDrafts({});
    setModalOpen(true);
  };

  // 自动获取枪名：根据仕样号在 gun-ledger 中查找匹配的枪名
  // 匹配规则：行 customer 字段等于仕样号 OR 等于仕样号对应的客户名
  const runAutoGunLookup = async (specNumber: string, context: 'add' | 'edit', itemId?: string) => {
    if (!specNumber) return;
    setAutoGunLookupLoading(true);
    setAutoGunLookupResults(null);
    setAutoGunLookupContext(context);
    setAutoGunLookupItemId(itemId ?? null);
    setAutoGunLookupChecked(new Set());
    try {
      // 并发拉取仕样信息和枪台账数据
      const [specInfo, ledgerRes] = await Promise.all([
        fetchSpecInfo(specNumber),
        axiosInstance.get('/gun-ledger'),
      ]);
      const clientName = specInfo.success && specInfo.clientName ? specInfo.clientName.trim() : '';
      const data = ledgerRes.data || {};
      const categories: Record<string, any[]> = data.categories || {};
      const matches: { gunName: string; customer: string; tableName: string; category: string; used?: boolean }[] = [];
      Object.entries(categories).forEach(([cat, tables]) => {
        (tables || []).forEach((table: any) => {
          (table.rows || []).forEach((row: any) => {
            const c = (row.customer || '').trim();
            const g = (row.gunName || '').trim();
            if (!g) return; // 焊枪名为空跳过
            // customer 等于仕样号 或 等于客户名时视为命中
            if (c === specNumber || (clientName && c === clientName)) {
              matches.push({ gunName: g, customer: c, tableName: table.name || '', category: cat });
            }
          });
        });
      });
      // 标记已被主任务使用的枪名（与台账页天蓝色标识含义一致）；拉取失败不影响匹配结果
      const usedRes = await axiosInstance.get('/tasks/used-gun-names').catch(() => null);
      const usedSet = new Set<string>((usedRes?.data?.gunNames || []).map((n: string) => String(n).trim()));
      matches.forEach(m => { m.used = usedSet.has(m.gunName); });
      setAutoGunLookupResults(matches);
      if (matches.length === 0) {
        addToast(`未在枪台账中找到仕样号 ${specNumber} 对应的枪名`, 'error');
      } else {
        addToast(`已找到 ${matches.length} 个匹配枪名`, 'success');
      }
    } catch {
      addToast('获取枪台账数据失败', 'error');
    } finally {
      setAutoGunLookupLoading(false);
    }
  };

  // 应用选中的自动枪名到当前模式
  // 创建模式：追加到 addModeGuns；编辑模式：追加到 currentItem.guns 并触发 handleItemChange
  const autoGunGunLookupPicked = (): string[] => {
    if (!autoGunLookupResults) return [];
    return autoGunLookupResults
      .filter((_, idx) => autoGunLookupChecked.has(idx))
      .map(r => r.gunName);
  };

  const applyAutoGunLookup = () => {
    if (!autoGunLookupResults || autoGunLookupChecked.size === 0) return;
    const picked = autoGunGunLookupPicked();
    if (autoGunLookupContext === 'add') {
      const newGuns = picked.map(name => ({ id: `gun-new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name, hours: '' }));
      setAddModeGuns(prev => [
        ...prev,
        ...applyTaskTypeToGuns(newGuns, addModeTaskType)
      ]);
      addToast(`已添加 ${picked.length} 个枪名`, 'success');
    } else if (autoGunLookupContext === 'edit' && autoGunLookupItemId) {
      const itemId = autoGunLookupItemId;
      const designerId = modalDesignerId;
      const date = modalDate;
      if (!designerId || !date) return;
      const item = getAllItems(designerId, date).find(i => i.id === itemId);
      const currentItem = item ? getItemWithPendingChanges(item) : null;
      if (!currentItem) return;
      const baseGuns = currentItem.guns || [];
      // 新追加的枪名按当前任务内容自动补工时，已有枪名的工时保持不变
      const lookupTaskType = getTaskTypeFromName(currentItem.taskName);
      const newGuns: GunItem[] = [
        ...baseGuns,
        ...picked.map(name => fillHoursForGunName(
          { id: `gun-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: '', hours: '' },
          name,
          lookupTaskType
        )),
      ];
      setTaskTypeDrafts(prev => ({
        ...prev,
        [itemId]: { ...(prev[itemId] || {}), designName: currentItem.taskName || '', designGuns: newGuns }
      }));
      handleItemChange(designerId, date, itemId, 'guns', newGuns);
      addToast(`已追加 ${picked.length} 个枪名`, 'success');
    }
    // 关闭面板
    setAutoGunLookupResults(null);
    setAutoGunLookupContext(null);
    setAutoGunLookupItemId(null);
    setAutoGunLookupChecked(new Set());
  };

  const toggleAutoGunLookupChecked = (idx: number) => {
    setAutoGunLookupChecked(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // 删除枪名并记录操作以便撤销
  const onDeleteGun = (item: TaskItem, designerId: string, date: string, gunIndex: number) => {
    if (!canEditTasks) {
      if (isOfflineMode) addToast('当前离线，禁止编辑', 'error');
      return;
    }
    if (warnIfCellLocked(designerId, date, item.id)) return;
    const newGuns = (item.guns || []).filter((_, i) => i !== gunIndex);
    // 记录删除枪名的操作，以便撤销
    addToHistory('deleteGun', {
      designerId,
      date,
      itemId: item.id,
      gunIndex,
      originalGuns: item.guns
    });
    handleItemChange(designerId, date, item.id, 'guns', newGuns);
    addToast('枪名已删除', 'success');
  };

  // 上移/下移枪名（连同其工时）顺序
  const onMoveGun = (item: TaskItem, designerId: string, date: string, gunIndex: number, direction: 'up' | 'down') => {
    if (!canEditTasks) {
      if (isOfflineMode) addToast('当前离线，禁止编辑', 'error');
      return;
    }
    if (warnIfCellLocked(designerId, date, item.id)) return;
    const guns = item.guns || [];
    const target = direction === 'up' ? gunIndex - 1 : gunIndex + 1;
    if (gunIndex < 0 || gunIndex >= guns.length || target < 0 || target >= guns.length) return;
    const newGuns = [...guns];
    [newGuns[gunIndex], newGuns[target]] = [newGuns[target], newGuns[gunIndex]];
    addToHistory('fieldChange', {
      designerId,
      date,
      itemId: item.id,
      field: 'guns',
      newValue: newGuns,
      originalValue: guns
    });
    handleItemChange(designerId, date, item.id, 'guns', newGuns);
  };

  // 移动单个枪名到其他主任务（支持跨人员/跨日期；newIndex 为空时追加到目标 guns 最下面）；
  // targetItemId 为空 + createTaskName 时，表示落点单元格没有主任务，先按源主任务名称新建再移入
  const onMoveGunToTask = async (args: {
    sourceDesignerId: string;
    sourceDate: string;
    sourceItemId: string;
    sourceGunIndex: number;
    gunId: string;
    targetDesignerId: string;
    targetDate: string;
    targetItemId: string;
    createTaskName?: string;
    newIndex?: number;
    sourceItemSnapshot?: TaskItem;
  }) => {
    if (!canEditTasks) {
      if (isOfflineMode) addToast('当前离线，禁止编辑', 'error');
      return;
    }
    const { sourceDesignerId, sourceDate, sourceItemId, sourceGunIndex, gunId, targetDesignerId, targetDate, targetItemId, createTaskName, newIndex } = args;

    // 先落盘源/目标单元格此前的挂起编辑，并取消尚未触发的防抖保存，
    // 避免旧 guns 数组延迟回写覆盖本次移动结果
    const flushCellPending = async (dId: string, dt: string) => {
      const list = pendingChanges.filter(c => c.designerId === dId && c.date === dt);
      for (const change of list) {
        await saveItem(change.designerId, change.date, change.itemId, change.field, change.value);
      }
      if (list.length > 0) {
        setPendingChanges(prev => prev.filter(c => !(c.designerId === dId && c.date === dt)));
      }
    };
    await flushCellPending(sourceDesignerId, sourceDate);
    if (targetDesignerId !== sourceDesignerId || targetDate !== sourceDate) {
      await flushCellPending(targetDesignerId, targetDate);
    }
    debouncedSave.cancel();

    try {
      const res = await axiosInstance.post('/tasks/move-gun', {
        sourceDesignerId,
        sourceDate,
        sourceItemId,
        gunId,
        targetDesignerId,
        targetDate,
        targetItemId,
        // 仅在需要新建主任务时下发（后端据此判断是否落点是空白单元格）
        ...(createTaskName !== undefined ? { createTaskName } : {}),
        newIndex
      });
      if (res.data.sourceSheet) upsertSheet(res.data.sourceSheet);
      if (res.data.targetSheet) upsertSheet(res.data.targetSheet);
      const targetItemCreated = Boolean(res.data.targetItemCreated);
      addToHistory('moveGunBetweenItems', {
        sourceDesignerId,
        sourceDate,
        sourceItemId,
        sourceGunIndex,
        targetDesignerId,
        targetDate,
        // 新建主任务时以服务端返回的新 id 为准（撤销把枪名移回后该主任务会自动删除，重做需按名称重建）
        targetItemId: res.data.targetItemId || targetItemId,
        targetItemCreated,
        createdTaskName: targetItemCreated ? (createTaskName ?? '') : undefined,
        gunId,
        newIndex,
        // 源主任务因最后一个枪名被移走而被删除时，记录快照供撤销重建
        sourceItemDeleted: Boolean(res.data.sourceItemDeleted),
        sourceItemSnapshot: res.data.sourceItemDeleted ? args.sourceItemSnapshot : undefined
      });
      socketRef.current?.emit('task_updated');
      addToast(res.data.message || '枪名已移动到目标主任务', 'success');
    } catch (err: any) {
      console.error('移动枪名失败:', err?.response?.data || err);
      addToast(err?.response?.data?.message || '移动失败', 'error');
      fetchSheets();
    }
  };

  // 上移/下移主任务（同一天单元格内与相邻任务交换顺序）
  const onMoveTask = async (item: TaskItem, designerId: string, date: string, direction: 'up' | 'down') => {
    if (!canEditTasks) {
      if (isOfflineMode) addToast('当前离线，禁止编辑', 'error');
      return;
    }
    if (warnIfCellLocked(designerId, date, item.id)) return;
    // 按显示顺序找到相邻任务，再换算成完整数组中的目标索引（兼容被隐藏的空任务）
    const visibleItems = getItems(designerId, date);
    const visIdx = visibleItems.findIndex(i => i.id === item.id);
    const targetVisIdx = direction === 'up' ? visIdx - 1 : visIdx + 1;
    if (visIdx < 0 || visIdx >= visibleItems.length || targetVisIdx < 0 || targetVisIdx >= visibleItems.length) return;
    const targetItem = visibleItems[targetVisIdx];
    const rawTargetIdx = getAllItems(designerId, date).findIndex(i => i.id === targetItem.id);
    if (rawTargetIdx === -1) return;
    try {
      const res = await axiosInstance.post('/tasks/move', {
        sourceDesignerId: designerId,
        sourceDate: date,
        itemId: item.id,
        targetDesignerId: designerId,
        targetDate: date,
        newIndex: rawTargetIdx
      });
      if (res.data.sourceSheet) upsertSheet(res.data.sourceSheet);
      if (res.data.targetSheet) upsertSheet(res.data.targetSheet);
      addToHistory('batchMove', {
        items: [{ sourceDesignerId: designerId, sourceDate: date, targetDesignerId: designerId, targetDate: date, itemId: item.id }]
      });
      emitTaskUpdated(designerId);
    } catch (err: any) {
      console.error('移动任务失败:', err?.response?.data || err);
      addToast(err?.response?.data?.message || '移动失败', 'error');
      fetchSheets();
    }
  };

  // 上移/下移设计员（同组内与相邻人员交换顺序，跨组不移动），保存后一次性写回全部人员顺序
  const onMoveDesigner = async (designer: Designer, direction: 'up' | 'down') => {
    if (!canEditTasks) {
      if (isOfflineMode) addToast('当前离线，禁止编辑', 'error');
      return;
    }
    const group = designer.group || '未分组';
    // 以当前页面显示顺序找同组相邻人员（搜索过滤时只和可见的相邻人员交换）
    const visibleGroupIds = (designersByGroup[group] || []).map(d => d.id);
    const visIdx = visibleGroupIds.indexOf(designer.id);
    if (visIdx < 0) return;
    const targetId = direction === 'up' ? visibleGroupIds[visIdx - 1] : visibleGroupIds[visIdx + 1];
    if (!targetId) return;

    // 在完整人员列表中交换这两个人在本组内的位置，其他人员位置不变
    const groupIds = designers.filter(d => (d.group || '未分组') === group).map(d => d.id);
    const from = groupIds.indexOf(designer.id);
    const to = groupIds.indexOf(targetId);
    if (from === -1 || to === -1) return;

    const nextGroupIds = arrayMove(groupIds, from, to);
    const groupOf = new Map(designers.map(d => [d.id, d.group || '未分组']));
    let ptr = 0;
    const nextIds = designers.map(d => d.id).map(id => (groupOf.get(id) === group ? nextGroupIds[ptr++] : id));

    const byId = new Map(designers.map(d => [d.id, d]));
    setDesigners(nextIds.map(id => byId.get(id)).filter(Boolean) as Designer[]);

    try {
      await axiosInstance.post('/designers/reorder', { ids: nextIds });
    } catch (err) {
      addToast('排序保存失败', 'error');
      fetchData();
    }
  };

  const onDeleteTask = (item: TaskItem, designerId: string, date: string) => {
    if (!canEditTasks) {
      if (isOfflineMode) addToast('当前离线，禁止编辑', 'error');
      return;
    }
    if (warnIfCellLocked(designerId, date, item.id)) return;
    deleteSelectedTasks({ item, designerId, date });
  };

  const warnIfOfflineEdit = () => {
    if (!isOfflineModeRef.current) return false;
    addToast('当前离线，禁止编辑', 'error');
    return true;
  };

  const isPureFiveDigitSpecNumber = (value: string) => new RegExp(`^\\d{${specNumberDigits}}$`).test(value.trim());

  const fetchSpecInfo = async (specNumber: string): Promise<SpecInfoResponse> => {
    try {
      const res = await axiosInstance.post('/spec/spec-info', { specNumber }, { timeout: 15000 });
      return res.data;
    } catch (err) {
      if (isAxiosError(err) && err.code === 'ECONNABORTED') {
        return { success: false, message: '获取仕样信息超时(超过15秒)' };
      }
      return { success: false, message: '无法连接到服务器' };
    }
  };
 
  // 从后端 PDF 解析器获取仕样号的纳期
  // Fetch delivery date (纳期) for a spec number from the backend PDF parser
  const fetchSpecDeliveryDate = async (specNumber: string): Promise<{ success: boolean; date?: string; message?: string }> => {
    try {
      const res = await axiosInstance.post('/spec/delivery-date', { specNumber }, { timeout: 10000 });
      return res.data;
    } catch (err) {
      if (isAxiosError(err) && err.code === 'ECONNABORTED') {
        return { success: false, message: '获取纳期超时(超过10秒)' };
      }
      return { success: false, message: '无法连接到服务器' };
    }
  };


  const resolvePureSpecTaskName = async (taskName: string): Promise<string> => {
    const { baseName, typeSuffix } = splitDesignTaskName(taskName);
    if (!isPureFiveDigitSpecNumber(baseName)) return taskName;

    let nextTaskName = `${baseName}${typeSuffix}`.trim();
    let specInfo: SpecInfoResponse | null = null;

    const infoResult = await fetchSpecInfo(baseName);
    if (infoResult.success) {
      specInfo = infoResult;
      const clientName = getDesignPlanClientName(infoResult, baseName);
      if (clientName) {
        nextTaskName = `${clientName}${typeSuffix}`;
      } else {
        addToast(`未找到仕样号 ${baseName} 的客户信息`, 'error');
      }
    } else {
      addToast(infoResult.message || `未找到仕样号 ${baseName} 的客户信息`, 'error');
    }

    if (showDeadline && !manualDeadline) {
      const deliveryDate = specInfo?.deliveryDate || (await fetchSpecDeliveryDate(baseName)).date;
      const deliverySuffix = getDeliveryDateSuffix(deliveryDate);
      if (deliverySuffix) {
        return `${nextTaskName.replace(/\s*\[\d{1,2}\/\d{1,2}\]$/, '').trim()} ${deliverySuffix}`;
      }

      addToast(`未找到仕样号 ${baseName} 的纳期信息`, 'error');
    }

    return nextTaskName;
  };

  const scheduleAddModeSpecAutoFill = (value: string) => {
    clearAddModeSpecLookup();

    const specNumber = value.trim();
    if (!isPureFiveDigitSpecNumber(specNumber)) return;

    const lookupSeq = addModeSpecLookupSeqRef.current;
    addModeSpecLookupTimeoutRef.current = setTimeout(async () => {
      const specInfo = await fetchSpecInfo(specNumber);
      if (lookupSeq !== addModeSpecLookupSeqRef.current) return;

      if (specInfo.success && specInfo.clientName?.trim()) {
        const clientName = getDesignPlanClientName(specInfo, specNumber);
        setAddModeTaskName(current => current.trim() === specNumber ? clientName : current);
        // 如果已勾选"显示纳期"，优先复用仕样信息中的纳期，仅在缺失时单独查询
        if (showDeadline && !manualDeadline) {
          const deliveryDate = specInfo.deliveryDate || (await fetchSpecDeliveryDate(specNumber)).date;
          const suffix = getDeliveryDateSuffix(deliveryDate);
          setAddModeDeadlineTag(suffix);
        }
        return;
      }

      addToast(specInfo.message || `未找到仕样号 ${specNumber} 的客户信息`, 'error');
    }, 500);
  };
 
  const upsertSheet = useCallback((incoming: TaskSheet) => {
    setSheets(prev => {
      const next = prev.filter(s => !(s.designerId === incoming.designerId && s.month === incoming.month && s.year === incoming.year));
      next.push(incoming);
      return next;
    });
  }, []);

  // 通知其他客户端刷新数据。
  // 传入 designerId 时走增量广播：服务端只回传该设计师的工时表，其他客户端直接本地
  // 合并，无需重新拉取整月数据（30 人在线时这是主要开销来源）。
  // 不传 designerId 时退化为全量刷新，用于批量操作、跨设计师移动、工作日设置变更等
  // 影响范围不明确或不止一张表的场景。
  //
  // currentDate 经 ref 读取而非进入依赖数组：本函数被大量 useCallback 引用，若随月份
  // 变化产生新引用，那些 useCallback 的依赖数组都要跟着改，漏改一处就会广播旧月份。
  // 用 ref 保证本函数引用永久稳定。
  const currentDateRef = useRef(currentDate);
  currentDateRef.current = currentDate;
  const emitTaskUpdated = useCallback((designerId?: string) => {
    if (!designerId) {
      socketRef.current?.emit('task_updated');
      return;
    }
    const d = currentDateRef.current;
    socketRef.current?.emit('task_updated', {
      designerId,
      month: d.getMonth() + 1,
      year: d.getFullYear()
    });
  }, []);

  // 快捷添加「确认图修改」成功后：本地合并最新工时表，并通知其他客户端刷新
  // （目标月份与当前视图不同时不能并入本地 sheets，否则同设计员会被另一月份的
  // 表覆盖导致当前视图串月；此时只广播全量刷新）
  const handleQuickModifyCreated = useCallback(
    ({ designerId, date, itemId, sheet }: { designerId: string; date: string; itemId?: string; sheet?: TaskSheet }) => {
      const [year, month] = String(date).split('-').map(Number);
      const current = currentDateRef.current;
      const sameMonth = current.getFullYear() === year && current.getMonth() + 1 === month;
      if (sheet && sameMonth) upsertSheet(sheet);
      if (sameMonth) {
        emitTaskUpdated(designerId);
      } else {
        emitTaskUpdated();
      }
      // 新增的任务就在当前视图里时，滚动到该任务行（行未渲染则静默跳过）
      if (!sameMonth || !itemId) return;
      window.setTimeout(() => {
        const escapeSelector = globalThis.CSS?.escape || ((value: string) => value.replace(/"/g, '\\"'));
        const target = document.querySelector(
          `[data-task-id="${escapeSelector(itemId)}"][data-designer-id="${escapeSelector(designerId)}"][data-date="${escapeSelector(date)}"]`
        ) as HTMLElement | null;
        target?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }, 260);
    },
    [upsertSheet, emitTaskUpdated]
  );

  const fetchSheets = useCallback(async () => {
    try {
      const month = currentDate.getMonth() + 1;
      const year = currentDate.getFullYear();
      const res = await axiosInstance.get(`/tasks?month=${month}&year=${year}`);
      setSheets(res.data);
    } catch (err: any) {
      console.error('Error fetching tasks:', err);
      addToast('无法获取任务数据', 'error');
    }
  }, [currentDate, token]);

  const handleUserDesignPlanColorMark = useCallback(async (item: TaskItem, designerId: string, date: string, action: 'white' | 'restore') => {
    if (!user || !token) return;
    if (warnIfOfflineEdit()) return;
    if (warnIfCellLocked(designerId, date, item.id)) return;

    socketRef.current?.emit('start_editing', {
      designerId,
      date,
      userId: user.id,
      username: user.username,
      name: user.name,
      mode: 'colorMark',
      itemId: item.id,
      gunIndex: null
    });

    try {
      const value = action === 'white' ? '#ffffff' : '__restore__';
      const res = await axiosInstance.put('/tasks/item', { designerId, date, itemId: item.id, field: 'color', value });
      if (res.data.sheet) {
        upsertSheet(res.data.sheet);
      }
      emitTaskUpdated(designerId);
      addToast(action === 'white' ? '该任务标记为已完成' : '该任务标记为未完成', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.message || '任务完成状态更新失败', 'error');
      fetchSheets();
    } finally {
      setTimeout(() => {
        socketRef.current?.emit('stop_editing', { designerId, date });
      }, 800);
    }
  }, [fetchSheets, token, upsertSheet, user, warnIfCellLocked]);

  const handleGunColorMark = useCallback(async (item: TaskItem, designerId: string, date: string, gunIndex: number, action: 'white' | 'restore') => {
    if (!user || !token) return;
    if (warnIfOfflineEdit()) return;
    if (warnIfCellLocked(designerId, date, item.id)) return;

    socketRef.current?.emit('start_editing', {
      designerId,
      date,
      userId: user.id,
      username: user.username,
      name: user.name,
      mode: 'colorMark',
      itemId: item.id,
      gunIndex
    });

    try {
      const value = action === 'white' ? '#ffffff' : '__restore__';
      const res = await axiosInstance.put('/tasks/item', { designerId, date, itemId: item.id, field: 'gunColor', value, gunIndex });
      if (res.data.sheet) {
        upsertSheet(res.data.sheet);
      }
      emitTaskUpdated(designerId);
      addToast(action === 'white' ? '该任务标记为已完成' : '该任务标记为未完成', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.message || '枪名任务完成状态更新失败', 'error');
      fetchSheets();
    } finally {
      setTimeout(() => {
        socketRef.current?.emit('stop_editing', { designerId, date });
      }, 800);
    }
  }, [fetchSheets, token, upsertSheet, user, warnIfCellLocked]);

  // Offline cache: save current sheets to localStorage
  // key 与清理逻辑共用（数据管理里清理任务后需要作废这份缓存）
  const saveSheetsToLocalStorage = useCallback((data: TaskSheet[]) => {
    try {
      localStorage.setItem(OFFLINE_SHEETS_CACHE_KEY, JSON.stringify({
        sheets: data,
        timestamp: Date.now(),
        cachedMonth: currentDate.getMonth() + 1,
        cachedYear: currentDate.getFullYear()
      }));
    } catch (e) {
      console.warn('Failed to save offline cache:', e);
    }
  }, [currentDate]);

  const loadSheetsFromLocalStorage = useCallback((): TaskSheet[] | null => {
    try {
      const cached = localStorage.getItem(OFFLINE_SHEETS_CACHE_KEY);
      if (!cached) return null;
      const parsed = JSON.parse(cached);
      return parsed?.sheets ?? null;
    } catch (e) {
      console.warn('Failed to load offline cache:', e);
      return null;
    }
  }, []);

  const { addToHistory } = useTaskHistory({ token, upsertSheet, fetchSheets, canEditTasks, isOfflineMode, addToast, socketRef });

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;

      if (batchReplaceOpen) {
        setBatchReplaceOpen(false);
        return;
      }

      if (modalOpen) {
        setModalOpen(false);
        stopEditingCell(modalDesignerId, modalDate);
      }
    };

    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('keydown', handleEsc);
    };
  }, [batchReplaceOpen, modalOpen, modalDesignerId, modalDate, stopEditingCell]);

  const fetchWorkdayOverrides = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/settings/workday-overrides');
      setWorkdayOverrides(normalizeWorkdayOverrides(res.data));
    } catch (err) {
      console.error('Error fetching workday overrides:', err);
      addToast('无法加载工作日设置', 'error');
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      const designersRes = await axiosInstance.get('/designers', headers ? { headers } : undefined);
      setDesigners(Array.isArray(designersRes.data) ? designersRes.data : []);
      await Promise.all([fetchSheets(), fetchWorkdayOverrides()]);
    } catch (err: any) {
      console.error('Error fetching data:', err);
      if (!navigator.onLine || err?.code === 'ERR_NETWORK' || err?.message === 'Network Error') {
        const cachedSheets = loadSheetsFromLocalStorage();
        if (cachedSheets && cachedSheets.length > 0) {
          setSheets(cachedSheets);
          setOfflineCacheUsed(true);
          setIsOnline(false);
        }
      } else {
        addToast('数据加载失败', 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [fetchSheets, fetchWorkdayOverrides, token, loadSheetsFromLocalStorage]);

  useEffect(() => {
    Promise.all([
      axiosInstance.get('/system/settings'),
      axiosInstance.get('/settings/leaderboard'),
      axiosInstance.get('/settings/work-hours'),
      axiosInstance.get('/settings/status-tracking'),
      axiosInstance.get('/settings/system-settings'),
      axiosInstance.get('/settings/design-standards'),
      axiosInstance.get('/settings/gun-ledger')
    ])
      .then(([systemRes, leaderboardRes, workHoursRes, statusTrackingRes, systemSettingsRes, designStandardsRes, gunLedgerRes]) => {
        setAllowUserDesignPlanColorMark(systemRes.data.allowUserDesignPlanColorMark ?? systemRes.data.allowUserEditOwnTaskColor ?? true);
        setAllowUserChangePassword(systemRes.data.allowUserChangePassword === true);
        setLeaderboardAccess(leaderboardRes.data || defaultAccessSettings);
        setWorkHoursAccess(workHoursRes.data || defaultAccessSettings);
        setStatusTrackingAccess(statusTrackingRes.data || defaultAccessSettings);
        setSystemSettingsAccess(systemSettingsRes.data || defaultAccessSettings);
        setDesignStandardsAccess(designStandardsRes.data || defaultAccessSettings);
        setGunLedgerAccess(gunLedgerRes.data || defaultAccessSettings);
      })
      .finally(() => setSystemSettingsLoaded(true));
  }, [user]);

  useEffect(() => {
    if (!systemSettingsLoaded) return;
    fetchData();

    if (token) {
      // 共享连接：AuthContext 启动时已建连，这里复用同一条，不再额外开一条 WebSocket
      const handle = acquireSocket(token);
      socketRef.current = handle.socket;

      handle.on('task_refreshed', (payload?: { sheets?: TaskSheet[] }) => {
        // 增量：服务端已回传受影响的工时表，直接本地合并，
        // 无需重新拉取整月数据，也无需重拉工作日设置。
        const incoming = payload?.sheets;
        if (Array.isArray(incoming) && incoming.length > 0) {
          // 只合并属于当前查看月份的工时表：其余月份的变更与当前视图无关，
          // 合并进来会白白触发级联 effect 与离线缓存写入。
          // currentDate 走 ref 读取，避免闭包捕获到过期月份。
          const month = currentDateRef.current.getMonth() + 1;
          const year = currentDateRef.current.getFullYear();
          incoming.forEach(sheet => {
            if (!sheet || sheet.month !== month || sheet.year !== year) return;
            upsertSheet(sheet);
          });
          return;
        }
        // 无范围信息（批量操作 / 工作日设置变更 / 数据维护）：需要全量刷新。
        // 只读用户占在线人数的大部分且不需要亚秒级实时性，合并到 3 秒刷新一次；
        // 页面在后台时直接跳过，切回前台再补刷一次。
        if (!canEditTasksRef.current) {
          if (document.visibilityState === 'hidden') {
            pendingFullRefreshRef.current = true;
            return;
          }
          if (deferredRefreshTimerRef.current === null) {
            deferredRefreshTimerRef.current = window.setTimeout(() => {
              deferredRefreshTimerRef.current = null;
              fetchSheets();
              fetchWorkdayOverrides();
            }, 3000);
          }
          return;
        }
        fetchSheets();
        fetchWorkdayOverrides();
      });

      handle.on('connect', () => {
        setIsOnline(true);
        setOfflineCacheUsed(false);
        hasShownDisconnectToast.current = false;
        addToast('服务器已重新连接', 'success');
      });

      handle.on('reconnect', (attempt: number) => {
        setIsOnline(true);
        setOfflineCacheUsed(false);
        hasShownDisconnectToast.current = false;
        addToast(`服务器重连成功 (第${attempt}次尝试)`, 'success');
      });

      handle.on('connect_error', () => {
        setIsOnline(false);
        if (!hasShownDisconnectToast.current && !offlineCacheUsed) {
          hasShownDisconnectToast.current = true;
          saveSheetsToLocalStorage(sheets);
          addToast('服务器连接断开，已自动保存数据', 'error');
        }
      });
      // editing_state 是连接期快照：共享连接可能早于本页挂载建立，
      // 事件不会重放，因此注册后用缓存补一次初始编辑锁状态
      const applyEditingState = (sessions: EditingSession[]) => {
        const next: Record<string, EditingSession> = {};
        (Array.isArray(sessions) ? sessions : []).forEach(session => {
          if (!session?.designerId || !session?.date) return;
          next[editingSessionKey(session.designerId, session.date, session.itemId)] = session;
        });
        setEditingSessions(next);
      };
      handle.on('editing_state', applyEditingState);
      const cachedEditingState = handle.getSnapshot<EditingSession[]>('editing_state');
      if (cachedEditingState) applyEditingState(cachedEditingState);

      handle.on('user_editing', (data: EditingSession) => {
        if (!data?.designerId || !data?.date) return;
        setEditingSessions(prev => ({
          ...prev,
          [editingSessionKey(data.designerId, data.date, data.itemId)]: data
        }));
      });

      handle.on('editing_blocked', (data: EditingSession) => {
        if (!data?.designerId || !data?.date) return;
        setEditingSessions(prev => ({
          ...prev,
          [editingSessionKey(data.designerId, data.date, data.itemId)]: data
        }));
        setSelectedCell(null);
        setSelectedTasks([]);
        setModalOpen(false);
        const blockedTarget = data.itemId ? '该任务' : '该区域';
        addToast(`${data.name || data.username} ${data.mode === 'colorMark' ? `正在修改${blockedTarget}的完成状态` : `正在编辑${blockedTarget}`}，暂无法操作`, 'error');
      });

      handle.on('user_stopped_editing', (data: { designerId: string, date: string, userId: string }) => {
        if (!data?.designerId || !data?.date) return;
        setEditingSessions(prev => {
          // 停止消息不带 itemId：移除该用户在此单元格内的全部主任务会话
          const entries = Object.entries(prev).filter(([, session]) =>
            session.designerId === data.designerId && session.date === data.date && session.userId === data.userId
          );
          if (entries.length === 0) return prev;
          const next = { ...prev };
          entries.forEach(([key]) => { delete next[key]; });
          return next;
        });
      });

      return () => {
        if (deferredRefreshTimerRef.current !== null) {
          window.clearTimeout(deferredRefreshTimerRef.current);
          deferredRefreshTimerRef.current = null;
        }
        handle.release();
      };
    } else {
      setIsOnline(true);
    }
    // token 必须进依赖：共享连接按 token 复用，若 token 变了而 effect 不重跑，
    // 本页会一直持有 AuthContext 已释放并销毁的旧 socket，收不到任何事件
  }, [fetchData, fetchSheets, fetchWorkdayOverrides, systemSettingsLoaded, user, token, upsertSheet]);

  // Online/offline event listeners
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setOfflineCacheUsed(false);
      hasShownDisconnectToast.current = false;
      addToast('网络已连接', 'success');
      setTimeout(() => {
        fetchData();
      }, 1000);
    };
    const handleOffline = () => {
      setIsOnline(false);
      if (!hasShownDisconnectToast.current) {
        hasShownDisconnectToast.current = true;
        saveSheetsToLocalStorage(sheets);
        addToast('网络已断开，已自动保存数据', 'error');
      }
    };
    // 后端 HTTP 可达性（全局心跳广播）：socket 之外的第二判定源。
    // 后端恢复时只清理离线标记，不重复弹提示——socket 重连已自带「服务器已重新连接」
    const handleServerOnline = () => {
      setIsOnline(true);
      setOfflineCacheUsed(false);
      hasShownDisconnectToast.current = false;
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('server-unreachable', handleOffline);
    window.addEventListener('server-online', handleServerOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('server-unreachable', handleOffline);
      window.removeEventListener('server-online', handleServerOnline);
    };
  }, [fetchData, sheets, user]);

  // 页面重新可见时，补上在后台期间被跳过的刷新
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (!pendingFullRefreshRef.current) return;
      pendingFullRefreshRef.current = false;
      if (deferredRefreshTimerRef.current !== null) {
        window.clearTimeout(deferredRefreshTimerRef.current);
        deferredRefreshTimerRef.current = null;
      }
      fetchSheets();
      fetchWorkdayOverrides();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [fetchSheets, fetchWorkdayOverrides]);

  // Save sheets to localStorage for offline use
  // 只在离线时写：在线状态下这份缓存无人读取（数据以服务端为准），而每次 sheets
  // 变化都同步 JSON.stringify 全量写入会阻塞主线程——别人每编辑一次就触发一次。
  // 用 debounce 合并离线期间的连续编辑，避免逐条写入。
  // 断网瞬间的数据由 online/offline 与 connect_error 事件里即时写入兜住。
  useEffect(() => {
    if (sheets.length === 0 || isOnline) return;
    const timer = window.setTimeout(() => saveSheetsToLocalStorage(sheets), 800);
    return () => window.clearTimeout(timer);
  }, [sheets, isOnline, saveSheetsToLocalStorage]);

  // Load cached sheets when offline and fetchData returned no data
  useEffect(() => {
    if (!loading && sheets.length === 0 && (!isOnline || offlineCacheUsed)) {
      const cachedSheets = loadSheetsFromLocalStorage();
      if (cachedSheets && cachedSheets.length > 0) {
        setSheets(cachedSheets);
        setOfflineCacheUsed(true);
      }
    }
  }, [loading, isOnline, sheets, loadSheetsFromLocalStorage]);


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
      if (warnIfOfflineEdit()) return;
      if (!user) return;
      const payloads = getSelectedTaskPayloads({ item, designerId, date });
      if (payloads.length === 0) return;
      if (payloads.some(payload => warnIfCellLocked(payload.designerId, payload.date, payload.item.id))) return;
      
      setClipboard(payloads.map(payload => payload.item));
      addToast('剪切已准备', 'success');
      
      try {
        for (const payload of payloads) {
          await axiosInstance.delete('/tasks/item', { data: { designerId: payload.designerId, date: payload.date, itemId: payload.item.id } });
        }
        addToHistory('batchDelete', {
          items: payloads.map(payload => ({ designerId: payload.designerId, date: payload.date, item: payload.item }))
        });
        fetchSheets();
        socketRef.current?.emit('task_updated');
        stopEditingCell();
        setSelectedTasks([]);
        setSelectedCell(null);
      } catch (err) {
        addToast('剪切失败', 'error');
      }
    };

    const handleTaskPaste = async (e: Event) => {
      const customEvent = e as CustomEvent;
      const { designerId, date } = customEvent.detail;
      if (warnIfOfflineEdit()) return;
      if (!user) return;
      if (!clipboardRef.current || clipboardRef.current.length === 0) {
        addToast('请先复制任务', 'error');
        return;
      }
      if (warnIfCellLocked(designerId, date)) return;
      addToast('任务已复制', 'success');
      try {
        const res = await axiosInstance.post('/tasks/item/batch', { 
          designerId, 
          date, 
          items: clipboardRef.current
        });
        addToHistory('batchAdd', {
          items: (res.data.items || []).map((created: TaskItem, idx: number) => ({ 
            designerId, 
            date, 
            itemId: created.id,
            item: clipboardRef.current?.[idx]
          }))
        });
        upsertSheet(res.data.sheet);
        emitTaskUpdated(designerId);
        stopEditingCell(designerId, date);
        setSelectedTasks([]);
        setSelectedCell(null);
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
  }, [clipboard, user, token, fetchSheets, upsertSheet, sheets, canEditTasks, isOfflineMode]);

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

  const {
    sensors,
    collisionDetection,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    setGunDropTargetState,
    setTaskDropTargetState,
    taskDragCtrlRef,
    activeTask,
    setActiveTask,
    activeGun,
    setActiveGun,
    gunDropTarget,
    taskDropTarget,
    setIsDragging,
    setIsOverDelete,
  } = useGunDragDrop({
    canEditTasks,
    warnIfCellLocked,
    getAllItems,
    getVisibleItems: getItems,
    getSelectedTaskPayloads,
    token,
    addToHistory,
    upsertSheet,
    fetchSheets,
    stopEditingCell,
    addToast,
    onMoveGunToTask,
    setSelectedTasks,
    setSelectedCell,
    socketRef,
  });

  const gunDropInvalid = Boolean(gunDropTarget?.invalid && !gunDropTarget?.isSelf);
  const gunDropSelf = Boolean(gunDropTarget?.isSelf);
  // 目标主任务没有任何枪名：同样不可放置，浮层提示文案与「重复枪名」区分
  const gunDropNoGuns = Boolean(gunDropTarget?.noGuns && !gunDropTarget?.isSelf);
  // 枪名拖拽扫过可新建主任务的位置：空白单元格整格高亮，或已有任务单元格最下方的加号高亮，
  // 松手后按源主任务名称新建主任务
  const gunDropCreateCell = Boolean(gunDropTarget?.create);
  const gunDropCreateAppend = Boolean(gunDropTarget?.create && gunDropTarget?.append);
  const taskDropDuplicate = Boolean(taskDropTarget?.duplicate);

  useEffect(() => {
    if (!isOfflineMode) return;
    setSelectedCell(null);
    setSelectedTasks([]);
    setActiveTask(null);
    setActiveGun(null);
    setIsDragging(false);
    setIsOverDelete(false);
    setPendingChanges([]);
    if (modalOpen) {
      setModalOpen(false);
      stopEditingCell(modalDesignerId, modalDate);
    } else {
      stopEditingCell();
    }
  }, [isOfflineMode, modalOpen, modalDesignerId, modalDate, stopEditingCell]);


  const deleteSelectedTasks = useCallback(async (fallback?: { item: TaskItem; designerId: string; date: string }) => {
    if (!canEditTasks) {
      if (isOfflineMode) addToast('当前离线，禁止编辑', 'error');
      return;
    }
    if (warnIfOfflineEdit()) return;

    const selections = fallback
      ? getSelectedTaskPayloads(fallback)
      : selectedTasksRef.current
          .map(selection => {
            const item = getAllItems(selection.designerId, selection.date).find(task => task.id === selection.itemId);
            return item ? { item, designerId: selection.designerId, date: selection.date } : null;
          })
          .filter(Boolean) as { item: TaskItem; designerId: string; date: string }[];

    if (selections.length === 0) return;
    if (selections.some(selection => warnIfCellLocked(selection.designerId, selection.date, selection.item.id))) return;

    try {
      for (const selection of selections) {
        await axiosInstance.delete('/tasks/item', { data: { designerId: selection.designerId, date: selection.date, itemId: selection.item.id }
        });
      }

      if (selections.length === 1) {
        const [selection] = selections;
        addToHistory('delete', { designerId: selection.designerId, date: selection.date, item: selection.item });
      } else {
        addToHistory('batchDelete', {
          items: selections.map(selection => ({ designerId: selection.designerId, date: selection.date, item: selection.item }))
        });
      }

      fetchSheets();
      socketRef.current?.emit('task_updated');
      stopEditingCell();
      setSelectedTasks([]);
      setSelectedCell(null);
      addToast(selections.length === 1 ? '任务已删除' : `已删除 ${selections.length} 个任务`, 'success');
    } catch (err) {
      addToast('删除任务失败', 'error');
    }
  }, [canEditTasks, isOfflineMode, token, fetchSheets, stopEditingCell, warnIfCellLocked, sheets]);

  useEffect(() => {
    const handleSelectedTasksDelete = (e: KeyboardEvent) => {
      if (e.key !== 'Delete') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (modalOpen || batchReplaceOpen || isEditableKeyboardTarget(e.target)) return;
      if (selectedTasksRef.current.length === 0) return;

      e.preventDefault();
      deleteSelectedTasks();
    };

    window.addEventListener('keydown', handleSelectedTasksDelete);
    return () => window.removeEventListener('keydown', handleSelectedTasksDelete);
  }, [deleteSelectedTasks, modalOpen, batchReplaceOpen]);

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
      (updatedItem as any)[change.field] = change.value;
    });
    return updatedItem;
  };

  // 当前弹窗内可加急的主任务：新增模式看已勾选的任务内容；编辑模式看当前主任务
  const getUrgentTargetItems = (): TaskItem[] => {
    if (isAddMode) return [];
    if (!modalDesignerId || !modalDate) return [];
    const cellItems = getAllItems(modalDesignerId, modalDate).map(item => getItemWithPendingChanges(item));
    return focusTarget ? cellItems.filter(item => item.id === focusTarget.itemId) : cellItems;
  };

  const isUrgentAvailable = () => {
    // 只有「确认图 / 设计 / 确认图修改」有加急状态；
    // 设计变更 / 既制审图 / 暂停取消 没有加急状态
    if (isAddMode) return supportsUrgent(addModeTaskType);
    return getUrgentTargetItems().some(item => !item.leaveType && supportsUrgent(detectTaskContentType(item.taskName)));
  };

  // 任务加急切换：新增模式只改草稿；编辑模式同步写入待保存更改
  const handleUrgentToggle = (next: boolean) => {
    setUrgentDraft(next);
    if (isAddMode || !modalDesignerId || !modalDate) return;
    const targets = getUrgentTargetItems();
    if (targets.length === 0) return;
    const ids = new Set(targets.map(item => item.id));
    setPendingChanges(prev => [
      ...prev.filter(change => !(ids.has(change.itemId) && change.field === 'urgent')),
      ...targets.map(item => ({
        designerId: modalDesignerId,
        date: modalDate,
        itemId: item.id,
        field: 'urgent' as TaskField,
        value: next,
      })),
    ]);
  };

  // 「暂停/取消」与其它任务内容并列，走同一套勾选逻辑（任务名后缀 + paused 标记）：
  // 勾选时取消加急、工时按 0 计；取消勾选后回到普通任务内容配色。
  const applyPausedState = (itemId: string, next: boolean) => {
    if (isAddMode || !modalDesignerId || !modalDate) return;
    const changes: PendingChange[] = [
      { designerId: modalDesignerId, date: modalDate, itemId, field: 'paused', value: next },
    ];
    if (next) {
      changes.push({ designerId: modalDesignerId, date: modalDate, itemId, field: 'urgent', value: false });
      changes.push({ designerId: modalDesignerId, date: modalDate, itemId, field: 'hours', value: 0 });
    }
    setPendingChanges(prev => [
      ...prev.filter(change => !(change.itemId === itemId && (change.field === 'paused' || change.field === 'urgent')))
        .filter(change => !(next && change.itemId === itemId && change.field === 'hours')),
      ...changes,
    ]);
  };

 
  const calculateDailyTotal = (designerId: string, date: string) => {
    const items = getItems(designerId, date);
    return items.reduce((sum, it) => {
      // Skip leave tasks from hour calculation
      if (it.leaveType === 'sick' || it.leaveType === 'vacation' || it.leaveType === 'illness') return sum;

      return sum + getTaskHours(it);
    }, 0);
  };

  const calculateMonthlyTotal = (designerId: string) => {
    const sheet = sheetByDesignerId[designerId];
    if (!sheet?.days) return 0;
    return Object.entries(sheet.days).reduce((sum, [date]) => sum + calculateDailyTotal(designerId, date), 0);
  };

  const monthlyFooterStats = useMemo(() => {
    const visibleDesignerIds = new Set(filteredDesigners.map(d => d.id));
    return sheets.reduce(
      (stats, sheet) => {
        if (!visibleDesignerIds.has(sheet.designerId)) return stats;

        (Object.entries(sheet.days || {}) as [string, TaskItem[]][]).forEach(([date, items]) => {
          const isWeekendDate = getEffectiveIsWeekend(date, isWeekend(new Date(`${date}T00:00:00`)), workdayOverrides);
          (Array.isArray(items) ? items : []).filter(isMeaningfulTask).forEach(item => {
            const hours = getTaskHours(item);
            if (item.leaveType === 'sick' || item.leaveType === 'vacation' || item.leaveType === 'illness') {
              stats.leaveHours += hours;
              return;
            }
            if (item.leaveType === 'trip') {
              stats.tripHours += hours;
              if (isWeekendDate) stats.weekendOvertimeHours += hours;
              return;
            }
            stats.designTaskCount += 1;
            if (isWeekendDate) stats.weekendOvertimeHours += hours;
          });
        });

        return stats;
      },
      { designTaskCount: 0, weekendOvertimeHours: 0, tripHours: 0, leaveHours: 0 }
    );
  }, [filteredDesigners, sheets, workdayOverrides]);

  const formatFooterHours = (hours: number) => `${Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)} h`;

  // 上次登录时间：精确到分钟（本地时区），格式 YYYY-MM-DD HH:mm
  const formatLoginTime = (iso?: string | null): string => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  // 优先展示本次登录之前的那次登录；首次登录（无历史）时回退为本次登录时间
  const lastLoginText = formatLoginTime(clientInfo?.previousLoginAt || clientInfo?.lastLoginAt);

  const saveItem = async (designerId: string, date: string, itemId: string, field: TaskField, value: any) => {
    if (warnIfOfflineEdit()) return;
    try {
      let nextValue = field === 'taskName' && typeof value === 'string'
        ? await resolvePureSpecTaskName(value)
        : value;
      // guns 字段：归一化 hours（空串/NaN -> 0），并在存在「有枪名但工时<=0」时静默跳过保存
      // 这样编辑任务时点击"手动添加枪名"或仅填枪名未填工时不会弹出"输入格式不正确"等错误提示，
      // 与创建主任务时一致——保存按钮已通过 hasInvalidNamedGunHours 校验禁用
      if (field === 'guns' && Array.isArray(nextValue)) {
        const normalizedGuns = nextValue.map((g: any) => ({
          ...g,
          hours: typeof g.hours === 'number' && !isNaN(g.hours)
            ? g.hours
            : (parseFloat(String(g.hours ?? '')) || 0)
        }));
        const hasInvalid = normalizedGuns.some((g: any) => {
          const name = String(g.name || '').trim();
          if (!name) return false;
          const hours = typeof g.hours === 'number' ? g.hours : (parseFloat(String(g.hours)) || 0);
          return hours <= 0;
        });
        // 枪名重复（后端会 400）时同样静默跳过保存：保留本地输入并标红，
        // 避免「拒绝 -> 重新拉取」把用户输入的名字冲掉变成未命名枪名
        if (hasInvalid || hasDuplicateGunNames(normalizedGuns)) {
          // 静默跳过本次保存：用户在保存按钮被禁用前不应看到错误提示
          setPendingChanges(prev => prev.filter(c => !(c.designerId === designerId && c.date === date && c.itemId === itemId && c.field === field)));
          return;
        }
        nextValue = normalizedGuns;
      }
      const res = await axiosInstance.put('/tasks/item', { designerId, date, itemId, field, value: nextValue });
      if (res.data.sheet) {
        upsertSheet(res.data.sheet);
      }
      emitTaskUpdated(designerId);
      setPendingChanges(prev => prev.filter(c => !(c.designerId === designerId && c.date === date && c.itemId === itemId && c.field === field)));
    } catch (err: any) {
      console.error('Error saving item:', err);
      addToast(err.response?.data?.message || '保存失败', 'error');
      fetchSheets();
    }
  };

  const debouncedSave = useDebounce(saveItem, 500);

  // 存储待保存的任务更改
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);

  const resetBatchSearchResults = () => {
    setBatchMatches([]);
    setBatchMatchCount(0);
    setBatchSearchDone(false);
  };

  const getBatchReplacePayload = () => ({
    findText: batchFindText,
    replaceText: batchReplaceText,
    allTable: batchReplaceAllTable,
    month: currentDate.getMonth() + 1,
    year: currentDate.getFullYear()
  });

  const getRequestErrorMessage = (err: any, fallback: string) => {
    if (err.response?.data?.message) return err.response.data.message;
    if (err.response?.status === 404) return `${fallback}：接口不存在，请重启后端服务后重试`;
    if (err.message) return `${fallback}：${err.message}`;
    return fallback;
  };

  const openBatchReplaceDialog = async () => {
    if (warnIfOfflineEdit()) return;
    if (pendingChanges.length > 0) {
      const changes = [...pendingChanges];
      for (const change of changes) {
        await saveItem(change.designerId, change.date, change.itemId, change.field, change.value);
      }
      setPendingChanges([]);
    }

    if (modalDesignerId && modalDate) {
      stopEditingCell(modalDesignerId, modalDate);
    }
    setModalOpen(false);
    setFocusTarget(null);
    setBatchReplaceOpen(true);
  };

  const handleBatchSearch = async () => {
    if (warnIfOfflineEdit()) return;
    if (!batchFindText) {
      addToast('请输入查找字符', 'error');
      return;
    }

    setBatchSearchLoading(true);
    try {
      const res = await axiosInstance.post('/tasks/batch-replace/search', getBatchReplacePayload());
      setBatchMatches(Array.isArray(res.data.matches) ? res.data.matches : []);
      setBatchMatchCount(res.data.matchCount || 0);
      setBatchSearchDone(true);
    } catch (err: any) {
      addToast(getRequestErrorMessage(err, '查找失败'), 'error');
    } finally {
      setBatchSearchLoading(false);
    }
  };

  // 点击查找结果时定位到底部表格中的目标任务：
  // 确保行可见（人员筛选/分组折叠）、选中高亮并滚动到该单元格，批量操作模态框保持打开。
  const handleBatchLocate = (match: BatchReplaceMatch) => {
    const designer = designers.find(d => d.id === match.designerId);
    if (!designer) return;

    // 若该人员当前被筛选条件隐藏（如"全部"下被隐藏，或筛选成了其他人/其他分组），则切换筛选到该人员
    const rowVisible = selectedDesignerId === 'all'
      ? !designer.hidden
      : selectedDesignerId.startsWith('group:')
        ? (designer.group || '未分组') === selectedDesignerId.slice('group:'.length) && !designer.hidden
        : selectedDesignerId === match.designerId;
    if (!rowVisible) setSelectedDesignerId(match.designerId);

    // 展开该人员所在分组
    const group = designer.group || '未分组';
    if (collapsedGroups[group]) {
      setCollapsedGroups(prev => {
        const next = { ...prev, [group]: false };
        localStorage.setItem('collapsedGroups', JSON.stringify(next));
        return next;
      });
    }

    // 选中任务以蓝色边框高亮
    setSelectedTasks([{ itemId: match.itemId, designerId: match.designerId, date: match.date }]);

    // 模态框透明度降为 20%，便于透过模态框查看底部定位结果；鼠标移回模态框或 3 秒后恢复
    setBatchLocateDimmed(true);
    if (batchLocateRestoreTimerRef.current) window.clearTimeout(batchLocateRestoreTimerRef.current);
    batchLocateRestoreTimerRef.current = window.setTimeout(() => {
      setBatchLocateDimmed(false);
      batchLocateRestoreTimerRef.current = null;
    }, 3000);

    // 等待表格重渲染后滚动定位
    window.setTimeout(() => {
      const escapeSelector = globalThis.CSS?.escape || ((value: string) => value.replace(/"/g, '\\"'));
      const target = document.querySelector(
        `[data-task-id="${escapeSelector(match.itemId)}"][data-designer-id="${escapeSelector(match.designerId)}"][data-date="${escapeSelector(match.date)}"]`
      ) as HTMLElement | null;
      target?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }, 120);
  };

  const handleBatchReplace = async () => {
    if (warnIfOfflineEdit()) return;
    if (!batchFindText) {
      addToast('请输入查找字符', 'error');
      return;
    }

    setBatchReplaceLoading(true);
    try {
      const res = await axiosInstance.post('/tasks/batch-replace', getBatchReplacePayload());

      await fetchSheets();
      socketRef.current?.emit('task_updated');
      setBatchReplaceOpen(false);
      resetBatchSearchResults();
      addToast(`批量替换完成：替换了 ${res.data.itemCount || 0} 个任务`, 'success');
    } catch (err: any) {
      addToast(getRequestErrorMessage(err, '批量替换失败'), 'error');
    } finally {
      setBatchReplaceLoading(false);
    }
  };

  // 处理任务项的字段变更，将更改存入 pendingChanges 并实时更新界面。
  // 此函数会触发后端 API 调用，自动更新任务的 `updatedAt` 和 `updatedBy` 字段。
  // 所有操作都会记录到历史中以便撤销。
  // options.immediate=true 时跳过防抖直接保存（防抖为单槽，连续多次调用只有最后一次生效，
  // 一次性修改多个字段的场景需顺序 await 保存，避免后到的响应把尚未保存的字段回滚）
  const handleItemChange = (
    designerId: string,
    date: string,
    itemId: string,
    field: TaskField,
    raw: any,
    options?: { immediate?: boolean }
  ): Promise<void> | undefined => {
    // 获取原始值以便撤销
    if (warnIfOfflineEdit()) return;
    const sheet = sheets.find(s => s.designerId === designerId);
    const items = sheet?.days?.[date];
    const item = items?.find(i => i.id === itemId);
    const originalValue = item?.[field as keyof TaskItem];
    setSheets(prev => {
      const next = prev.map(sheet => {
        if (sheet.designerId !== designerId) return sheet;
        const dayItems = Array.isArray(sheet.days?.[date]) ? sheet.days[date] : [];
        const idx = dayItems.findIndex(i => i.id === itemId);
        if (idx === -1) return sheet;
        const updatedItems = [...dayItems];
        const targetItem = updatedItems[idx];
        // 主任务改色时子枪名颜色一并跟随（本地先同步，避免等接口返回才变色）
        updatedItems[idx] = field === 'color' && typeof raw === 'string' && raw && raw !== '__restore__' && !isWhiteTaskColor(raw)
          ? { ...targetItem, color: raw, guns: syncGunsWithTaskColor(targetItem.guns, raw) }
          : { ...targetItem, [field]: raw };
        return { ...sheet, days: { ...sheet.days, [date]: updatedItems } };
      });
      return next;
    });

    // 存储待保存的更改
    let value = raw;
    if (field === 'hours') {
      const parsed = parseFloat(raw);
      value = isNaN(parsed) ? 0 : parsed;
    }
    
    // 记录操作到历史，以便撤销
    addToHistory('fieldChange', {
      designerId,
      date,
      itemId,
      field,
      newValue: value,
      originalValue
    });
    
    setPendingChanges(prev => {
      const filtered = prev.filter(change => !(change.designerId === designerId && change.date === date && change.itemId === itemId && change.field === field));
      return [...filtered, { designerId, date, itemId, field, value }];
    });
    if (options?.immediate) return saveItem(designerId, date, itemId, field, value);
    debouncedSave(designerId, date, itemId, field, value);
  };

  // 编辑模式切换任务内容：任务名后缀 + 枪名工时 + 总工时一起同步。
  // - 有枪名：逐个枪名按新任务内容重算工时，总工时 = 各枪名工时之和；
  // - 无枪名：只改任务名后缀，总工时留给用户手动输入（不自动赋值）。
  // 顺序：枪名 → 工时 → 任务名（任务名最后，避免前两步的响应把尚未保存的任务名回滚）。
  const applyTaskTypeToItem = async (
    itemId: string,
    taskType: DesignTaskType,
    guns: GunItem[],
    newName: string
  ) => {
    if (!modalDesignerId || !modalDate) return;
    const namedGuns = (guns || []).filter(gun => String(gun.name || '').trim());
    if (namedGuns.length > 0) {
      const nextGuns = applyTaskTypeToGuns(guns, taskType);
      const totalHours = nextGuns.reduce((sum, gun) => {
        const parsed = typeof gun.hours === 'number' ? gun.hours : parseFloat(String(gun.hours));
        return sum + (Number.isFinite(parsed) ? parsed : 0);
      }, 0);
      await handleItemChange(modalDesignerId, modalDate, itemId, 'guns', nextGuns, { immediate: true });
      await handleItemChange(modalDesignerId, modalDate, itemId, 'hours', Number(totalHours.toFixed(2)), { immediate: true });
    }
    handleItemChange(modalDesignerId, modalDate, itemId, 'taskName', newName);
  };

  // 切换"显示纳期"复选框
  // - 新增模式：勾选时查询仕样号纳期并在输入框右侧预览显示；取消勾选则清除
  // - 编辑模式：勾选则查询仕样号纳期并追加 [M/D]；取消勾选则移除已有的 [M/D]
  const handleDeadlineToggle = async (checked: boolean) => {
    if (isAddMode) {
      if (!checked) {
        setShowDeadline(false);
        setAddModeDeadlineTag(null);
        setManualDeadline(false);
        setManualDeadlineInput('');
        return;
      }
      // 勾选：必须能从任务名中提取到指定位数的仕样号
      const specNo = extractSpecNumber(addModeTaskName);
      if (!specNo || specNo.length !== specNumberDigits) {
        addToast(`请先在任务名中输入${specNumberDigits}位数仕样号`, 'error');
        return;
      }
      setShowDeadline(true);
      const result = await fetchSpecDeliveryDate(specNo);
      const suffix = result.success ? getDeliveryDateSuffix(result.date) : null;
      if (suffix) {
        setAddModeDeadlineTag(suffix);
      } else {
        // 未在PDF中找到纳期信息：保持"显示纳期"勾选，自动打开"手动输入"，由用户决定是否填写
        addToast(result.message || `未找到仕样号 ${specNo} 的纳期信息`, 'error');
        setAddModeDeadlineTag(null);
        setManualDeadline(true);
        setManualDeadlineInput('');
      }
      return;
    }
    if (!modalDesignerId || !modalDate) return;

    const targets = (focusTarget
      ? getAllItems(modalDesignerId, modalDate).filter(i => i.id === focusTarget.itemId)
      : getAllItems(modalDesignerId, modalDate)
    )
      .map(i => getItemWithPendingChanges(i))
      .filter(i => !i.leaveType && (i.taskName || '').trim());

    if (!checked) {
      // 立即取消勾选并移除已有的纳期后缀
      setShowDeadline(false);
      setManualDeadline(false);
      setManualDeadlineInput('');
      targets.forEach(i => {
        const raw = (i.taskName || '').trim();
        if (/\[\d{1,2}\/\d{1,2}\]\s*$/.test(raw)) {
          handleItemChange(modalDesignerId, modalDate, i.id, 'taskName', raw.replace(/\s*\[\d{1,2}\/\d{1,2}\]\s*$/, '').trim());
        }
      });
      return;
    }

    // 勾选：立即给出勾选反馈，再异步查询纳期；全部失败时保持勾选并自动打开"手动输入"
    setShowDeadline(true);
    let addedAny = false;
    for (const i of targets) {
      const raw = (i.taskName || '').trim();
      if (/\[\d{1,2}\/\d{1,2}\]\s*$/.test(raw)) { addedAny = true; continue; }
      const specNo = extractSpecNumber(raw);
      if (!specNo) {
        addToast('未能从任务名称中提取仕样号，无法获取纳期', 'error');
        continue;
      }
      addToast(`正在获取仕样号 ${specNo} 的纳期...`, 'success');
      const result = await fetchSpecDeliveryDate(specNo);
      const suffix = result.success ? getDeliveryDateSuffix(result.date) : null;
      if (suffix) {
        const base = raw.replace(/\s*\[\d{1,2}\/\d{1,2}\]\s*$/, '').trim();
        handleItemChange(modalDesignerId, modalDate, i.id, 'taskName', `${base} ${suffix}`);
        addedAny = true;
        addToast(`纳期已添加: ${suffix}`, 'success');
      } else {
        addToast(result.message || `未找到仕样号 ${specNo} 的纳期信息`, 'error');
      }
    }
    if (!addedAny) {
      setManualDeadline(true);
      setManualDeadlineInput('');
    }
  };

  // 切换"手动输入"复选框
  // - 勾选：从已有纳期（新增模式 addModeDeadlineTag / 编辑模式任务名后缀）预填到输入框
  // - 取消勾选：清空手动输入值
  const handleManualDeadlineToggle = (checked: boolean) => {
    setManualDeadline(checked);
    if (!checked) {
      setManualDeadlineInput('');
      return;
    }
    // 预填：优先使用已查询到的纳期
    if (isAddMode) {
      if (addModeDeadlineTag) {
        const m = addModeDeadlineTag.match(/^\[(\d{1,2}\/\d{1,2})\]$/);
        setManualDeadlineInput(m ? m[1] : '');
      }
      return;
    }
    if (modalDesignerId && modalDate) {
      const items = getAllItems(modalDesignerId, modalDate).map(i => getItemWithPendingChanges(i));
      const focused = focusTarget ? items.find(i => i.id === focusTarget.itemId) : null;
      const source = focused || items.find(i => /\[\d{1,2}\/\d{1,2}\]\s*$/.test((i.taskName || '').trim()));
      if (source) {
        const m = (source.taskName || '').match(/\[(\d{1,2}\/\d{1,2})\]\s*$/);
        setManualDeadlineInput(m ? m[1] : '');
      }
    }
  };

  const deleteItem = async (designerId: string, date: string, itemId: string) => {
    if (warnIfOfflineEdit()) return;
    try {
      // Get the item data before deletion for undo
      const item = getItems(designerId, date).find(i => i.id === itemId);
      const res = await axiosInstance.delete('/tasks/item', { data: { designerId, date, itemId } });
      upsertSheet(res.data.sheet);
      emitTaskUpdated(designerId);
      
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

  if (!systemSettingsLoaded || loading) return <LoadingScreen skeleton />;


  const handlePaste = async (designerId: string, date: string) => {
    if (warnIfOfflineEdit()) return;
    if (!clipboard || !user) return;
    if (warnIfCellLocked(designerId, date)) return;
    addToast('任务已复制', 'success');
    try {
      const res = await axiosInstance.post('/tasks/item/batch', { 
        designerId, 
        date, 
        items: clipboard 
      });
      
      upsertSheet(res.data.sheet);
      addToHistory('batchAdd', {
        items: (res.data.items || []).map((created: TaskItem, idx: number) => ({ 
          designerId, 
          date, 
          itemId: created.id,
          item: clipboard?.[idx]
        }))
      });
      emitTaskUpdated(designerId);
      stopEditingCell(designerId, date);
      setSelectedTasks([]);
      setSelectedCell(null);
    } catch (err) {
      addToast('粘贴失败', 'error');
    }
  };

  const isSuperAdmin = user?.role === 'superadmin';

  const canShowAccessLink = (access: typeof defaultAccessSettings) => {
    if (isSuperAdmin) return true;
    if (!access.enabled) return false;
    if (!user) return false;
    if (user.role === 'admin') return access.allowAdmins;
    if (user.role === 'user') return access.allowViewers;
    return false;
  };

  const canShowSystemSettingsLink = () => {
    if (isSuperAdmin) return true;
    if (!systemSettingsAccess.enabled) return false;
    return user?.role === 'admin' && systemSettingsAccess.allowAdmins;
  };


  const hasRealtimeUpdates = Boolean(token);
  const footerStatusDotClass = !hasRealtimeUpdates
    ? 'bg-amber-500'
    : isOnline
      ? 'bg-green-500'
      : 'bg-red-500';
  const footerStatusTextClass = !hasRealtimeUpdates ? 'text-amber-600' : '';
  const footerStatusText = !hasRealtimeUpdates
    ? '需手动刷新获取最新状态'
    : isOnline
      ? '就绪'
      : '离线';

  // 任务类型非"设计计划"时隐藏批量操作/显示纳期/手动输入（新增+编辑模式均适用）
  // 新增模式：selectedTaskType !== 'none'；编辑模式：正在编辑的任务带有 leaveType
  const editingItemForOptions = !isAddMode && focusTarget?.itemId && modalDesignerId && modalDate
    ? getAllItems(modalDesignerId, modalDate).find(i => i.id === focusTarget.itemId) || null
    : null;
  const editingItemLeaveType = editingItemForOptions ? getItemWithPendingChanges(editingItemForOptions).leaveType : null;
  const hideTaskTypeOptions = isAddMode
    ? selectedTaskType !== 'none'
    : !!editingItemLeaveType;

  return (
    <div className="h-screen overflow-hidden bg-[#f3f3f3] flex flex-col font-sans">
      {/* Toast（下移至标题栏下方，避免遮挡顶部标题栏） */}
      <div className="fixed top-16 right-4 z-50 flex flex-col gap-2">
        {toasts.map(toast => (
          <div key={toast.id} className={`flex items-center gap-2 px-4 py-3 rounded shadow-lg text-white transition-all duration-300 ${toast.type === 'error' ? 'bg-red-600' : 'bg-green-600'}`}>
            {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        ))}
      </div>

      <header className="shrink-0 bg-[#217346] text-white px-6 py-2 flex items-center justify-between shadow-md">
        
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2">
            <img src="/favicon.ico" alt="Obara" className="w-6 h-6" />
            <a
              href="https://caifugao110.github.io/obara-task-manager/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-lg font-bold tracking-tight hover:underline"
            >
              Obara 任务管理系统
            </a>
          </div>
          <div className="flex items-center bg-[#1a5c38] rounded p-0.5 ml-4">
            <button onClick={() => changeMonth(-1)} className="p-1 hover:bg-[#217346] rounded transition">
              <ChevronLeft size={18} />
            </button>
            <span className="relative px-4 font-bold text-sm min-w-[110px] text-center cursor-pointer hover:bg-[#217346] rounded transition">
              {format(currentDate, 'yyyy年 MM月')}
              <input
                type="month"
                className="delivery-date-input"
                value={format(currentDate, 'yyyy-MM')}
                onChange={(e) => {
                  if (e.target.value) {
                    const [y, m] = e.target.value.split('-').map(Number);
                    setCurrentDate(new Date(y, m - 1, 1));
                  }
                }}
              />
            </span>
            <button onClick={() => changeMonth(1)} className="p-1 hover:bg-[#217346] rounded transition">
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="relative">
            <select
              value={selectedDesignerId}
              onChange={(e) => setSelectedDesignerId(e.target.value)}
              className="w-[100px] appearance-none bg-[#1a5c38] text-white text-sm font-medium px-3 py-1.5 pr-8 rounded border-none outline-none cursor-pointer hover:bg-[#237a47] transition"
            >
              <option value="all">全部人员</option>
              {designerDropdownGroups.map(g => (
                <React.Fragment key={g.name}>
                  <option value={`group:${g.name}`} style={{ color: '#d97706', fontWeight: 700 }}>{g.name}</option>
                  {g.members.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </React.Fragment>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-white/80" size={14} />
          </div>
          {canShowAccessLink(leaderboardAccess) && (
              <Link
                to="/leaderboard"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a5c38] hover:bg-[#237a47] rounded transition text-white text-sm font-medium"
              >
                <FileSpreadsheet size={16} className="text-blue-200" />
                <span>任务报表</span>
              </Link>
          )}
          {canShowAccessLink(workHoursAccess) && (
              <Link
                to="/work-hours"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a5c38] hover:bg-[#237a47] rounded transition text-white text-sm font-medium"
              >
                <Clock size={16} className="text-amber-200" />
                <span>工时管理</span>
              </Link>
          )}
          {canShowAccessLink(statusTrackingAccess) && (
              <Link
                to="/status-tracking"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a5c38] hover:bg-[#237a47] rounded transition text-white text-sm font-medium"
              >
                <Clock size={16} className="text-blue-200" />
                <span>状态跟踪表</span>
              </Link>
          )}
          {canShowAccessLink(designStandardsAccess) && (
            <Link
              to="/design-standards"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a5c38] hover:bg-[#237a47] rounded transition text-white text-sm font-medium"
            >
              <BookOpen size={16} className="text-emerald-200" />
              <span>设计规范知识库</span>
            </Link>
          )}
          {canShowAccessLink(gunLedgerAccess) && (
            <Link
              to="/gun-ledger"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a5c38] hover:bg-[#237a47] rounded transition text-white text-sm font-medium"
            >
              <ClipboardList size={16} className="text-emerald-200" />
              <span>焊枪编号台账</span>
            </Link>
          )}
        </div>

        <div className="flex items-center space-x-4">
          {versionInfo && (
            <span className="text-xs opacity-80 font-mono" title={`当前版本: ${versionInfo.currentVersion}`}>
              当前版本 {versionInfo.currentVersion}
            </span>
          )}
          {user && (
            <>
              {allowUserChangePassword ? (
                <button
                  type="button"
                  onClick={() => {
                    setOldPassword('');
                    setNewPassword('');
                    setConfirmPassword('');
                    setVisiblePasswords({ old: false, new: false, confirm: false });
                    setChangePasswordError('');
                    setChangePasswordSuccess('');
                    setChangePasswordOpen(true);
                  }}
                  title="点击可进行密码修改"
                  className="text-sm font-bold text-red-500 hover:text-red-300 transition cursor-pointer px-1 py-0.5 rounded"
                >
                  {user.name}
                </button>
              ) : (
                <span className="text-sm font-bold text-red-500 px-1 py-0.5 cursor-default select-none">
                  {user.name}
                </span>
              )}
              {canShowSystemSettingsLink() && (
                <Link to="/system-settings" target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-[#1a5c38] rounded transition" title="系统设置">
                  <Settings size={20} className="text-purple-200" />
                </Link>
              )}
              <div className="h-6 w-[1px] bg-white/20"></div>
              {isAdmin && (
                <Link to="/admin" target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-[#1a5c38] rounded transition" title="用户管理">
                  <UserCog size={20} />
                </Link>
              )}
              <button onClick={logout} className="p-1.5 hover:bg-red-600 rounded transition" title="退出">
                <LogOut size={20} />
              </button>
            </>
          )}
        </div>
      </header>

      {!isOnline && (
        <div className="relative z-50 shrink-0 bg-amber-500 text-white px-4 py-2 flex items-center justify-center gap-2 text-xs font-medium border-b border-amber-600 shadow-sm">
          <AlertCircle size={14} className="shrink-0" />
          <span>当前处于离线模式，正在使用本地缓存数据，网络恢复后将自动加载最新数据，此页面禁止编辑！</span>
        </div>
      )}

      {versionInfo?.hasUpdate && (
        <div className="relative z-50 shrink-0 bg-blue-600 text-white px-4 py-2 flex items-center justify-center gap-2 text-xs font-medium border-b border-blue-700 shadow-sm">
          <AlertCircle size={14} className="shrink-0" />
          <span>
            检测到新版本 {versionInfo.latestVersion}，当前版本为 {versionInfo.currentVersion}。
            请联系超级管理员重启程序以更新到最新版本。
          </span>
        </div>
      )}


      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={() => { setGunDropTargetState(null); setTaskDropTargetState(null); taskDragCtrlRef.current = false; }}
      >


        <main className="flex-1 min-h-0 overflow-hidden p-0">
          <div className="h-full bg-white shadow-sm border border-b-0 border-gray-300 overflow-hidden" ref={tableContainerRef}>
            <div className="h-full overflow-auto">
              <table className="border-collapse text-[12px] w-full">
              <thead className="text-xs">
                <tr className="bg-[#f8f9fa] text-gray-600 h-16 table-header-row">
                  <th className="sticky left-0 bg-[#f8f9fa] border border-gray-300 w-24 min-w-[6rem] font-bold text-center shadow-[1px_0_0_0_#d1d5db] z-50">设计员</th>
                  {days.map(d => (
                    <th key={d.fullDate} data-date={d.fullDate} colSpan={2} className={`group/date sticky top-0 border border-gray-300 min-w-[336px] text-center font-bold z-40 ${d.isWeekend ? 'bg-[#fff2cc]' : ''}`}>
                      <div className="text-[10px] opacity-60">{d.dayName}</div>
                      <div>{d.dayNum}</div>
                      {isAdmin && (
                        <label className="mt-1 hidden items-center justify-center gap-1 text-[10px] font-semibold text-gray-600 leading-none cursor-pointer select-none group-hover/date:flex group-focus-within/date:flex">
                          <input
                            type="checkbox"
                            checked={Boolean(workdayOverrides[d.fullDate])}
                            disabled={updatingWorkdayOverrideDate === d.fullDate}
                            onChange={(e) => handleWorkdayOverrideChange(d.fullDate, d.naturalIsWeekend, e.target.checked)}
                            className="h-3 w-3 cursor-pointer disabled:cursor-not-allowed"
                          />
                          <span>{getWorkdayOverrideLabel(d.naturalIsWeekend)}</span>
                        </label>
                      )}
                    </th>
                  ))}
                  <th className="sticky right-0 bg-[#f8f9fa] border border-gray-300 w-24 min-w-[6rem] font-bold text-center shadow-[-1px_0_0_0_#d1d5db] z-50">月总工时</th>
                </tr>
                <tr className="bg-[#f8f9fa] text-gray-500 text-[10px] h-6 table-header-row-secondary">
                  <th className="sticky left-0 top-16 bg-[#f8f9fa] border border-gray-300 min-w-[6rem] shadow-[1px_0_0_0_#d1d5db] z-40"></th>
                  {days.map(d => (
                    <React.Fragment key={`sub-${d.fullDate}`}>
                      <th className={`sticky top-16 border border-gray-300 w-[18rem] z-30 ${d.isWeekend ? 'bg-[#fff2cc]' : 'bg-[#f8f9fa]'}`}>任务内容</th>
                      <th className={`sticky top-16 border border-gray-300 w-12 z-30 ${d.isWeekend ? 'bg-[#fff2cc]' : 'bg-[#f8f9fa]'}`}>工时</th>
                    </React.Fragment>
                  ))}
                  <th className="sticky right-0 top-16 bg-[#f8f9fa] border border-gray-300 min-w-[6rem] shadow-[-1px_0_0_0_#d1d5db] z-40"></th>
                </tr>
              </thead>
              {sortedGroups.map(group => (
                <React.Fragment key={group}>
                  <tbody>
                    <tr className="group/grp cursor-pointer transition-colors bg-gray-200 group-hover/grp:bg-gray-300" onClick={() => toggleGroup(group)}>
                      {/* td1: 固定列 + 固定分组名，高 z-index 让溢出内容盖在 td2 上 */}
                      <td className="sticky left-0 top-[88px] z-[30] relative overflow-visible p-0 border border-gray-300 bg-gray-200 group-hover/grp:bg-gray-300 shadow-[1px_0_0_0_#d1d5db]">
                        {/* 占位：撑出 td 高度，不参与列宽 */}
                        <div style={{ height: 29 }} />
                        {/* 实际内容：绝对定位，不撑宽 td1，允许溢出到右边 */}
                        <div className="absolute left-0 top-0 flex items-center gap-2 whitespace-nowrap px-3 py-1.5 font-black text-gray-700 bg-gray-200 group-hover/grp:bg-gray-300">
                          {collapsedGroups[group] ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                          <span>{group}</span>
                          <span className="text-[10px] font-normal opacity-60 ml-2">({designersByGroup[group].length} 人)</span>
                        </div>
                      </td>
                      {/* td2: 剩余列，z-[25] 高于月总工时列(z-20)使其被分组行覆盖，但低于 td1(z-[30])不遮挡分组名溢出 */}
                      <td colSpan={days.length * 2 + 1} className="sticky top-[88px] z-[25] border border-gray-300 bg-gray-200 group-hover/grp:bg-gray-300"></td>
                    </tr>
                  </tbody>

                  {!collapsedGroups[group] && (
                    designersByGroup[group].map((d, groupIndex) => {
                      const groupMembers = designersByGroup[group];
                      const canMoveDesigner = canEditTasks && (groupIndex > 0 || groupIndex < groupMembers.length - 1);
                      const canMoveDesignerUp = canEditTasks && groupIndex > 0;
                      const canMoveDesignerDown = canEditTasks && groupIndex < groupMembers.length - 1;
                      return (
                        <tbody key={d.id}>
                              <tr className="align-top hover:bg-blue-50/20 group/row transition-colors">
                                <td className="sticky left-0 z-20 bg-white border border-gray-300 px-2 py-3 min-w-[6rem] font-bold text-gray-800 text-center align-middle shadow-[1px_0_0_0_#d1d5db] group-hover/row:bg-blue-50">
                                  {/* 姓名悬停时才显示上移/下移按钮（样式与显示逻辑同主任务行的上下移按钮）：
                                      按钮绝对定位在姓名正下方（锚点是姓名自身，不是整个姓名格），不占布局，
                                      姓名始终在格子正中、列宽不变；姓名格给最小高度，当天没有任何任务时行也不会太矮。
                                      有按钮时底部预留 22px（按钮 18 + 间距 4），让「姓名+按钮」整体在格子里居中 */}
                                  <div className={`group/designer inline-flex items-center justify-center min-h-[56px] ${canMoveDesigner ? 'pb-[22px]' : ''}`}>
                                    <div className="relative inline-block text-base font-bold text-gray-900 whitespace-nowrap">
                                      {d.name}
                                      {canMoveDesigner && (
                                        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 flex items-center gap-1 whitespace-nowrap opacity-0 group-hover/designer:opacity-100 transition-opacity">
                                          {canMoveDesignerUp && (
                                            <button
                                              type="button"
                                              className="h-[18px] w-[18px] flex items-center justify-center rounded bg-blue-100 text-blue-600 border border-blue-300 shadow-sm hover:bg-blue-600 hover:text-white hover:border-blue-700 transition-colors"
                                              title="上移"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                onMoveDesigner(d, 'up');
                                              }}
                                            >
                                              <ChevronUp size={14} strokeWidth={3} />
                                            </button>
                                          )}
                                          {canMoveDesignerDown && (
                                            <button
                                              type="button"
                                              className="h-[18px] w-[18px] flex items-center justify-center rounded bg-blue-100 text-blue-600 border border-blue-300 shadow-sm hover:bg-blue-600 hover:text-white hover:border-blue-700 transition-colors"
                                              title="下移"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                onMoveDesigner(d, 'down');
                                              }}
                                            >
                                              <ChevronDown size={14} strokeWidth={3} />
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                {days.map(day => {
                                  const items = getItems(d.id, day.fullDate);
                                  // 单元格内全部编辑会话：按主任务粒度展示标记；itemId 为空的是旧版整格会话
                                  const cellSessions = getCellSessions(d.id, day.fullDate);
                                  const legacyCellSession = cellSessions.find(s => s.userId !== user?.id && s.itemId == null) || null;
                                  const isCellLocked = Boolean(getBlockingEditingSession(d.id, day.fullDate));
                                  const isCellSelected = selectedCell?.designerId === d.id && selectedCell?.date === day.fullDate;
                                  // 单元格内容一律顶部对齐：本格内容少、同行其他格子更高时，任务行贴着格子上沿排，
                                  // 不做垂直居中（居中会让无任务内容的主任务悬在格子中间，与相邻格子的行位置错开）
                                  // 主任务拖拽扫过本单元格时的预插入位置：itemId 命中某条主任务 → 其上方显示标记线；
                                  // itemId 为 null → 最下方显示追加标记线；duplicate 时红色（复制内容重复）
                                  const cellTaskDrop = taskDropTarget && taskDropTarget.designerId === d.id && taskDropTarget.date === day.fullDate ? taskDropTarget : null;
                                  const showAppendMarker = Boolean(cellTaskDrop && cellTaskDrop.itemId === null);
                                  // 枪名拖拽扫过本单元格：整格无主任务 → 整格高亮（松手新建）；
                                  // 已有主任务但指针停在最下方加号上 → 只高亮加号（松手在该格最下面新建）
                                  const gunCreate = gunDropTarget?.create && gunDropTarget.designerId === d.id && gunDropTarget.date === day.fullDate;
                                  const isGunCreateCell = Boolean(gunCreate && !gunDropTarget?.append);
                                  const isGunCreatePlus = Boolean(gunCreate && gunDropTarget?.append);
                                  return (
                                    <DroppableCell 
                                      key={`${d.id}-${day.fullDate}`}
                                      designerId={d.id}
                                      date={day.fullDate}
                                      colSpan={2}
                                      className={`border border-gray-300 p-0 align-top ${day.isWeekend ? 'bg-[#fff2cc]/10' : ''} min-h-[40px] min-w-[21rem] relative group/cell task-cell${isCellLocked ? ' task-cell--locked' : ''}${isGunCreateCell ? ' ring-2 ring-inset ring-emerald-500 bg-emerald-50/50' : ''}`}
                                      onClick={(e: React.MouseEvent) => {
                                        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('flex') && !(e.target as HTMLElement).closest('[data-task-id]')) {
                                          setSelectedTasks([]);
                                          setSelectedCell(null);
                                          stopEditingCell();
                                        }
                                      }}
                                    >
                                      <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
                                        <div className="task-cell-list flex flex-col min-h-[40px]">
                                          {items.map((item, itemIndex) => {
                                            const canMarkColor = Boolean(
                                              token &&
                                              !isOfflineMode &&
                                              !item.leaveType &&
                                              (
                                                (user?.role === 'admin' || user?.role === 'superadmin') ||
                                                (user?.role === 'user' &&
                                                  allowUserDesignPlanColorMark &&
                                                  String(d.name || '').trim() === String(user.name || '').trim())
                                              )
                                            );
                                            return (
                                              <SortableTask
                                                key={item.id}
                                                item={item}
                                                designerId={d.id}
                                                date={day.fullDate}
                                                isAdmin={canEditTasks}
                                                canMarkColor={canMarkColor}
                                                canMoveUp={canEditTasks && items.length > 1 && itemIndex > 0}
                                                canMoveDown={canEditTasks && items.length > 1 && itemIndex < items.length - 1}
                                                onTaskClick={onTaskClick}
                                                onDeleteGun={onDeleteGun}
                                                onMoveGun={onMoveGun}
                                                onMoveTask={onMoveTask}
                                                onDeleteTask={onDeleteTask}
                                                onMarkColor={handleUserDesignPlanColorMark}
                                                onMarkGunColor={handleGunColorMark}
                                                selectedTasks={selectedTasks}
                                                metadataTitle={buildTaskMetadataTitle(item)}
                                                gunDropTarget={gunDropTarget && !gunDropTarget.isSelf && gunDropTarget.designerId === d.id && gunDropTarget.date === day.fullDate && gunDropTarget.itemId === item.id ? (gunDropTarget.invalid ? 'invalid' : 'valid') : null}
                                                taskInsertMarker={cellTaskDrop && cellTaskDrop.itemId === item.id ? (cellTaskDrop.duplicate ? 'invalid' : 'valid') : null}
                                                editingMarkSession={cellSessions.find(s => s.userId !== user?.id && s.itemId === item.id && (canViewEditingUser || s.mode === 'colorMark')) || null}
                                                onSelectTask={(itemId, designerId, date, append) => {
                                                  if (!canEditTasks) return;
                                                  if (warnIfCellLocked(designerId, date, itemId)) return;
                                                  handleSelectTask(itemId, designerId, date, append);
                                                  setSelectedCell(null);
                                                  startEditingCell(designerId, date, itemId);
                                                }}
                                              />
                                            );
                                          })}
                                          {/* 主任务拖拽扫过本单元格但未命中任何主任务：最下方显示追加位置标记线 */}
                                          {showAppendMarker && (
                                            <div
                                              className="pointer-events-none"
                                              style={{
                                                height: 4,
                                                margin: '0 2px',
                                                borderRadius: 2,
                                                backgroundColor: cellTaskDrop?.duplicate ? '#ef4444' : '#16a34a',
                                                boxShadow: cellTaskDrop?.duplicate
                                                  ? '0 0 0 1px rgba(239,68,68,0.55), 0 1px 4px rgba(239,68,68,0.5)'
                                                  : '0 0 0 1px rgba(22,163,74,0.55), 0 1px 4px rgba(22,163,74,0.5)',
                                              }}
                                            />
                                          )}
                                          {/* 加号区：默认隐藏，仅当指针停在本格空白处时显形（见 index.css 的 .task-cell-plus 规则）；
                                              指针停在已有任务行上时不显示。data-cell-plus 供枪名拖拽命中判定：
                                              拖到加号上松手 → 按源主任务名称在本格最下面新建主任务 */}
                                          {canEditTasks && (
                                            <div
                                              data-cell-plus="1"
                                              className={`task-cell-plus min-h-[24px] flex items-start justify-center pt-[3px] rounded transition-colors ${isCellLocked ? 'cursor-not-allowed' : 'cursor-pointer'}${isGunCreatePlus ? ' ring-2 ring-inset ring-emerald-500 !opacity-100 bg-emerald-50' : ''}`}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                // 新增主任务不受他人主任务级编辑影响，仅旧版整格会话会拦截
                                                if (warnIfCellLocked(d.id, day.fullDate)) return;
                                                setSelectedCell({ designerId: d.id, date: day.fullDate });
                                                setSelectedTasks([]);
                                              }}
                                              onDoubleClick={(e) => {
                                                e.stopPropagation();
                                                if (warnIfCellLocked(d.id, day.fullDate)) return;
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
                                              title={isCellSelected ? "双击此处添加任务" : ""}
                                            >
                                              <span
                                                className={`inline-flex items-center justify-center h-[18px] w-[18px] rounded-full ring-1 shadow-sm transition-colors ${isCellLocked
                                                  ? 'bg-gray-100 text-gray-400 ring-gray-300'
                                                  : isGunCreatePlus
                                                    ? 'bg-emerald-600 text-white ring-emerald-700 shadow-md'
                                                    : 'bg-blue-100 text-blue-600 ring-blue-400 hover:bg-blue-600 hover:text-white hover:ring-blue-700 hover:shadow-md'
                                                  }`}
                                              >
                                                <Plus size={12} strokeWidth={3.5} />
                                              </span>
                                            </div>
                                          )}
                                          {/* 整格红色罩层仅保留给旧版整格会话；主任务级会话在对应任务行内显示标记 */}
                                          {user && legacyCellSession && (canViewEditingUser || legacyCellSession.mode === 'colorMark') && (
                                            <div className="absolute inset-0 bg-red-200/85 flex items-center justify-center z-10">
                                              <span className="text-xs font-bold text-white bg-red-600 px-2 py-1 rounded border border-red-700 shadow-sm">
                                                {legacyCellSession.name || legacyCellSession.username} {legacyCellSession.mode === 'colorMark' ? '正在修改任务完成状态' : '正在编辑'}
                                              </span>
                                            </div>
                                          )}
                                        </div>
                                      </SortableContext>
                                    </DroppableCell>
                                  );
                                })}
                                <td className="sticky right-0 z-20 bg-[#f8f9fa] border border-gray-300 px-2 py-3 min-w-[6rem] font-bold text-center text-green-700 shadow-[-1px_0_0_0_#d1d5db] group-hover/row:bg-green-50">
                                  {calculateMonthlyTotal(d.id).toFixed(1)}
                                </td>
                              </tr>
                              <tr className="bg-blue-50/10 text-[10px]">
                                <td className="sticky left-0 z-20 bg-blue-50 border border-gray-300 px-2 py-0.5 min-w-[6rem] font-bold text-gray-500 text-center whitespace-nowrap shadow-[1px_0_0_0_#d1d5db]">
                                  当日合计
                                </td>
                                {days.map(day => (
                                  <td key={`total-${d.id}-${day.fullDate}`} colSpan={2} className={`border border-gray-300 px-1 py-0.5 text-center font-bold text-blue-600 ${day.isWeekend ? 'bg-[#fff2cc]/20' : ''}`}>
                                    {calculateDailyTotal(d.id, day.fullDate)}
                                  </td>
                                ))}
                                <td className="sticky right-0 z-20 bg-blue-50 border border-gray-300 min-w-[6rem] shadow-[-1px_0_0_0_#d1d5db]"></td>
                              </tr>
                        </tbody>
                      );
                    })
                  )}
                </React.Fragment>
              ))}
              </table>
            </div>
            </div>
        </main>

        <DragOverlay>
          {activeTask && (
            <div className="relative">
              {/* 重复提示（移动/复制共用）：浮在拖拽主任务的正上方 */}
              {taskDropDuplicate && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    bottom: '100%',
                    marginBottom: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    whiteSpace: 'nowrap',
                    fontSize: 11,
                    lineHeight: '16px',
                    fontWeight: 700,
                    color: '#ffffff',
                    backgroundColor: '#dc2626',
                    border: '1px solid #b91c1c',
                    borderRadius: 4,
                    padding: '1px 6px',
                    boxShadow: '0 2px 6px rgba(220,38,38,0.45)',
                  }}
                >
                  <AlertCircle size={11} />
                  重复任务
                </div>
              )}
              {/* 等比复刻整个主任务：主任务行 + 全部枪名行（枪名格+工时格） */}
              <div className={`flex border ${taskDropDuplicate ? 'border-red-400' : 'border-blue-400'} shadow-2xl rounded opacity-90 scale-105 bg-white overflow-hidden pointer-events-none`}>
                <div className="w-[18rem] border-r border-gray-200 flex flex-col bg-white">
                  <div
                    className="px-1.5 py-1.5 min-h-[28px] flex items-center break-all leading-relaxed text-[11px] font-medium"
                    style={(() => {
                      const dragColors = getItemDisplayColors(activeTask.item);
                      const dragLeave = getLeaveRowColors(activeTask.item.leaveType);
                      return { backgroundColor: dragLeave?.bg || dragColors.bg, color: dragLeave ? dragLeave.text : dragColors.text };
                    })()}
                  >
                    {(() => {
                      const item = activeTask.item;
                      if (item.leaveType === 'sick') return <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">事假</span>;
                      if (item.leaveType === 'vacation') return <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">休假</span>;
                      if (item.leaveType === 'illness') return <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-pink-100 text-pink-700">病假</span>;
                      if (item.leaveType === 'trip') {
                        const name = (item.taskName || '').trim();
                        if (!name) return <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 border border-teal-300">出差</span>;
                        return <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 border border-teal-300">{name.endsWith('出差') ? name : `${name}出差`}</span>;
                      }
                      return item.taskName || <span className="text-gray-300 italic">无</span>;
                    })()}
                  </div>
                  {(activeTask.item.guns || []).map((gun) => (
                    <div
                      key={gun.id}
                      className="px-2 py-1 min-h-[24px] flex items-center text-[11px] font-medium border-t border-gray-200/50"
                      style={{ backgroundColor: isWhiteTaskColor(gun.color) ? '#ffffff' : getItemDisplayColors(activeTask.item).bg }}
                    >
                      {gun.name || '未命名'}
                    </div>
                  ))}
                </div>
                <div className="w-12 flex flex-col bg-white">
                  <div
                    className="px-1 py-1.5 min-h-[28px] flex items-center justify-center font-mono text-blue-700 font-bold"
                    style={{
                      backgroundColor: getItemDisplayColors(activeTask.item).bg,
                      color: getItemDisplayColors(activeTask.item).urgent ? getItemDisplayColors(activeTask.item).text : undefined,
                    }}
                  >
                    {activeTask.item.guns && activeTask.item.guns.length > 0 ? '' : activeTask.item.hours}
                  </div>
                  {(activeTask.item.guns || []).map((gun) => (
                    <div
                      key={gun.id}
                      className="px-1 py-1 min-h-[24px] flex items-center justify-center font-mono text-blue-700 font-bold border-t border-gray-200/50"
                      style={{
                        backgroundColor: isWhiteTaskColor(gun.color) ? '#ffffff' : getItemDisplayColors(activeTask.item).bg,
                        color: getItemDisplayColors(activeTask.item).urgent ? getItemDisplayColors(activeTask.item).text : undefined,
                      }}
                    >
                      {gun.hours}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {activeGun && (
            <div
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                pointerEvents: 'none',
                filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.22))',
                // DragOverlay 根容器宽高锁定为激活节点（手柄按钮），必须显式给整行尺寸，
                // 否则内容会被压缩成手柄大小（约 21px 宽的空白小矩形）
                width: activeGun.dims ? activeGun.dims.width : 200,
                height: activeGun.dims ? activeGun.dims.height : 24,
                flexShrink: 0,
                transform:
                  activeGun.dims && (activeGun.dims.offsetX || activeGun.dims.offsetY)
                    ? `translate(${activeGun.dims.offsetX || 0}px, ${activeGun.dims.offsetY || 0}px)`
                    : undefined,
              }}
            >
              {/* 落点可新建主任务：空白单元格（整格高亮）或已有任务单元格最下方的加号（加号高亮）；
                  提示松手后会按源主任务名称新建主任务 */}
              {gunDropCreateCell && !gunDropInvalid && !gunDropSelf && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    bottom: '100%',
                    marginBottom: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                    fontSize: 11,
                    lineHeight: '16px',
                    fontWeight: 700,
                    color: '#ffffff',
                    backgroundColor: '#16a34a',
                    border: '1px solid #15803d',
                    borderRadius: 4,
                    padding: '1px 6px',
                    boxShadow: '0 2px 6px rgba(22,163,74,0.45)',
                  }}
                >
                  <Plus size={11} />
                  {gunDropCreateAppend ? '松手在下方新建主任务' : '松手新建主任务'}
                </div>
              )}
              {/* 禁止/重复提示：浮在拖拽枪名的正上方（而非右侧），更醒目 */}
              {(gunDropInvalid || gunDropSelf) && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    bottom: '100%',
                    marginBottom: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                    fontSize: 11,
                    lineHeight: '16px',
                    fontWeight: 700,
                    color: '#ffffff',
                    backgroundColor: gunDropSelf ? '#4b5563' : '#dc2626',
                    border: `1px solid ${gunDropSelf ? '#374151' : '#b91c1c'}`,
                    borderRadius: 4,
                    padding: '1px 6px',
                    boxShadow: gunDropSelf
                      ? '0 2px 6px rgba(75,85,99,0.45)'
                      : '0 2px 6px rgba(220,38,38,0.45)',
                  }}
                >
                  <AlertCircle size={11} />
                  {gunDropSelf ? '同任务内请用箭头' : gunDropNoGuns ? '目标无枪名，不能移入' : '重复枪名'}
                </div>
              )}
              {/* 等比复刻原枪名行：枪名格 + 工时格，宽高与原行一致，内容显示实际枪名与工时 */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  width: activeGun.dims ? activeGun.dims.width : 200,
                  height: activeGun.dims ? activeGun.dims.height : 24,
                  flexShrink: 0,
                  backgroundColor: activeGun.gun.color && !isWhiteTaskColor(activeGun.gun.color) ? activeGun.gun.color : '#ffffff',
                  border: `1px solid ${gunDropInvalid ? '#f87171' : gunDropSelf ? '#9ca3af' : '#93c5fd'}`,
                  borderRadius: 3,
                  overflow: 'hidden',
                  fontSize: 11,
                  whiteSpace: 'nowrap',
                }}
              >
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 8px',
                    backgroundColor: 'transparent',
                    fontWeight: 500,
                    overflow: 'hidden',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', color: gunDropInvalid ? '#dc2626' : '#111827' }}>
                    {activeGun.gun.name || '未命名'}
                  </span>
                </div>
                <div
                  style={{
                    width: activeGun.dims ? activeGun.dims.hoursWidth : 48,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'transparent',
                    borderLeft: '1px solid rgba(0,0,0,0.08)',
                    fontFamily: 'monospace',
                    color: '#1d4ed8',
                    fontWeight: 700,
                  }}
                >
                  {activeGun.gun.hours}
                </div>
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <footer className="shrink-0 bg-[#f3f3f3] border-t border-gray-300 px-4 py-1 flex justify-between items-center text-[11px] text-gray-500">
        <div className="flex items-center space-x-4">
          <button
            type="button"
            onClick={handleFooterStatusClick}
            title="点击或连按两次 Ctrl 定位到今日任务"
            className="flex items-center gap-1.5 hover:text-gray-700 transition-colors cursor-pointer focus:outline-none"
          >
            <div className={`w-2 h-2 rounded-full ${footerStatusDotClass}`}></div>
            <span className={footerStatusTextClass}>{footerStatusText}</span>
            <kbd className="ml-0.5 px-1 py-[1px] text-[10px] font-mono leading-none text-gray-400 bg-white/70 border border-gray-300 rounded shadow-sm">Ctrl×2</kbd>
          </button>
          <div className="w-[1px] h-3 bg-gray-300"></div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold">本月任务条目:</span>
            <span>{monthlyFooterStats.designTaskCount} 条</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold">本月周末加班:</span>
            <span>{formatFooterHours(monthlyFooterStats.weekendOvertimeHours)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold">本月员工出差:</span>
            <span>{formatFooterHours(monthlyFooterStats.tripHours)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold">本月员工请假:</span>
            <span>{formatFooterHours(monthlyFooterStats.leaveHours)}</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {clientInfo && (
            <>
              {lastLoginText && (
                <>
                  <span className="font-medium" title="上一次成功登录的时间（精确到分钟）">上次登录: {lastLoginText}</span>
                  <div className="w-[1px] h-3 bg-gray-300"></div>
                </>
              )}
              <span className="font-medium" title={clientInfo.summary}>IP: {clientInfo.ip || '未知'}</span>
              <div className="w-[1px] h-3 bg-gray-300"></div>
              <span className="font-medium" title={clientInfo.summary}>{clientInfo.browser}</span>
            </>
          )}
          {isAdmin && (
            <>
              <div className="w-[1px] h-3 bg-gray-300"></div>
              <button
                type="button"
                onClick={() => setHelpGuideOpen(true)}
                title="操作说明：任务录入方式"
                className="flex items-center justify-center w-[18px] h-[18px] rounded-full border border-gray-300 bg-white/70 text-gray-500 hover:text-white hover:bg-[#217346] hover:border-[#217346] hover:shadow-sm transition-all cursor-pointer focus:outline-none"
              >
                <HelpCircle size={12} strokeWidth={2.2} />
              </button>
            </>
          )}
          <div className="w-[1px] h-3 bg-gray-300"></div>
          <button
            type="button"
            onClick={() => { void toggleFullscreen(); }}
            title={isFullscreen ? '退出全屏显示（Esc）' : '全屏显示'}
            className="flex items-center gap-1 font-medium hover:text-gray-700 transition-colors cursor-pointer focus:outline-none"
          >
            {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            <span>{isFullscreen ? '退出全屏' : '全屏'}</span>
          </button>
        </div>
      </footer>

      {isAdmin && (
        <QuickConfirmModifyModal
          open={quickModifyOpen}
          onClose={() => setQuickModifyOpen(false)}
          designers={designers}
          gunLocations={gunLocations}
          addToast={addToast}
          onCreated={handleQuickModifyCreated}
        />
      )}

      {helpGuideOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setHelpGuideOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-[820px] max-w-[94vw] max-h-[92vh] flex flex-col overflow-hidden border border-gray-200">
            <div className="relative flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-[#1c6638] via-[#217346] to-[#2a8a57] text-white shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white/15 border border-white/25">
                  <HelpCircle size={18} />
                </div>
                <div>
                  <div className="font-bold text-base leading-tight">操作说明</div>
                  <div className="text-[11px] opacity-80 leading-tight mt-0.5">任务录入：拖拽与快捷键两种方式</div>
                </div>
              </div>
              <button
                onClick={() => setHelpGuideOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/20 transition cursor-pointer"
                title="关闭（Esc）"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-auto px-5 py-6 bg-gray-50/70 space-y-5">
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-green-50/60">
                  <span className="flex items-center justify-center w-6 h-6 rounded-md bg-[#217346] text-white">
                    <Move size={14} />
                  </span>
                  <span className="font-bold text-sm text-gray-800">拖拽录入</span>
                  <span className="text-[11px] text-gray-400 ml-auto">鼠标即可完成全部录入</span>
                </div>
                <ul className="divide-y divide-gray-100">
                  <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                    <span className="flex items-center justify-center w-7 h-7 rounded-md bg-blue-50 text-blue-600 shrink-0">
                      <MousePointerClick size={15} />
                    </span>
                    <div className="text-[13px] text-gray-700">
                      <span className="font-bold text-gray-800">双击空白单元格</span>
                      <span className="mx-1.5 text-gray-300">|</span>
                      快速新增该员工当天的任务
                    </div>
                  </li>
                  <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                    <span className="flex items-center justify-center w-7 h-7 rounded-md bg-green-50 text-green-600 shrink-0">
                      <GripVertical size={15} />
                    </span>
                    <div className="text-[13px] text-gray-700">
                      <span className="font-bold text-gray-800">拖动任务整行</span>
                      <span className="mx-1.5 text-gray-300">|</span>
                      移动到其他成员 / 日期或调整顺序（绿色插入线提示落点）
                    </div>
                  </li>
                  <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                    <span className="flex items-center justify-center w-7 h-7 rounded-md bg-amber-50 text-amber-600 shrink-0">
                      <Copy size={15} />
                    </span>
                    <div className="text-[13px] text-gray-700">
                      <span className="font-bold text-gray-800">按住 <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[11px] font-mono text-gray-700 shadow-sm">Ctrl</kbd> 拖动任务</span>
                      <span className="mx-1.5 text-gray-300">|</span>
                      复制到目标位置（内容重复时红色提示）
                    </div>
                  </li>
                  <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                    <span className="flex items-center justify-center w-7 h-7 rounded-md bg-purple-50 text-purple-600 shrink-0">
                      <Hand size={15} />
                    </span>
                    <div className="text-[13px] text-gray-700">
                      <span className="font-bold text-gray-800">拖动枪名右侧手柄</span>
                      <span className="mx-1.5 text-gray-300">|</span>
                      移入其他主任务，也可拖到空白格或加号上新建
                    </div>
                  </li>
                </ul>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-green-50/60">
                  <span className="flex items-center justify-center w-6 h-6 rounded-md bg-[#217346] text-white">
                    <Keyboard size={14} />
                  </span>
                  <span className="font-bold text-sm text-gray-800">快捷键录入</span>
                  <span className="text-[11px] text-gray-400 ml-auto">选中任务后生效</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2">
                  <ul className="divide-y divide-gray-100 md:border-r md:border-gray-100">
                    <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                      <span className="flex items-center gap-1 shrink-0 w-[128px] whitespace-nowrap">
                        <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[11px] font-mono text-gray-700 shadow-sm">单击</kbd>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[11px] font-mono text-gray-700 shadow-sm">Ctrl+单击</kbd>
                      </span>
                      <div className="text-[13px] text-gray-700">选中 / 多选任务</div>
                    </li>
                    <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                      <span className="flex items-center gap-1 shrink-0 w-[128px] whitespace-nowrap">
                        <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[11px] font-mono text-gray-700 shadow-sm">Ctrl+C</kbd>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[11px] font-mono text-gray-700 shadow-sm">Ctrl+X</kbd>
                      </span>
                      <div className="text-[13px] text-gray-700">复制 / 剪切选中任务</div>
                    </li>
                    <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                      <span className="flex items-center gap-1 shrink-0 w-[128px] whitespace-nowrap">
                        <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[11px] font-mono text-gray-700 shadow-sm">Ctrl+V</kbd>
                      </span>
                      <div className="text-[13px] text-gray-700">粘贴到目标单元格</div>
                    </li>
                    <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                      <span className="flex items-center gap-1 shrink-0 w-[128px] whitespace-nowrap">
                        <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[11px] font-mono text-gray-700 shadow-sm">Delete</kbd>
                      </span>
                      <div className="text-[13px] text-gray-700">删除选中任务</div>
                    </li>
                  </ul>
                  <ul className="divide-y divide-gray-100 border-t border-gray-100 md:border-t-0">
                    <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                      <span className="flex items-center gap-1 shrink-0 w-[128px] whitespace-nowrap">
                        <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[11px] font-mono text-gray-700 shadow-sm">Ctrl+Z</kbd>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[11px] font-mono text-gray-700 shadow-sm">Ctrl+Y</kbd>
                      </span>
                      <div className="text-[13px] text-gray-700">撤销 / 重做（亦可 Ctrl+Shift+Z）</div>
                    </li>
                    <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                      <span className="flex items-center gap-1 shrink-0 w-[128px] whitespace-nowrap">
                        <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[11px] font-mono text-gray-700 shadow-sm">双击任务</kbd>
                      </span>
                      <div className="text-[13px] text-gray-700">编辑任务详情</div>
                    </li>
                    <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                      <span className="flex items-center gap-1 shrink-0 w-[128px] whitespace-nowrap">
                        <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[11px] font-mono text-gray-700 shadow-sm">Esc</kbd>
                      </span>
                      <div className="text-[13px] text-gray-700">关闭弹出窗口</div>
                    </li>
                  </ul>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-green-50/60">
                  <span className="flex items-center justify-center w-6 h-6 rounded-md bg-[#217346] text-white">
                    <Crosshair size={14} />
                  </span>
                  <span className="font-bold text-sm text-gray-800">界面快捷操作</span>
                  <span className="text-[11px] text-gray-400 ml-auto">任意位置均可触发</span>
                </div>
                <ul className="divide-y divide-gray-100">
                  <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                    <span className="shrink-0 w-[92px]">
                      <kbd className="inline-block px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[11px] font-mono text-gray-700 shadow-sm">Ctrl×2</kbd>
                    </span>
                    <div className="text-[13px] text-gray-700">连按两次，定位到今日任务（等同点击左下角状态）</div>
                  </li>
                  <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                    <span className="shrink-0 w-[92px]">
                      <kbd className="inline-block px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[11px] font-mono text-gray-700 shadow-sm">Shift×2</kbd>
                    </span>
                    <div className="text-[13px] text-gray-700">连按两次，快速添加确认图修改（仅管理员）</div>
                  </li>
                  <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                    <span className="shrink-0 w-[92px]">
                      <kbd className="inline-block px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[11px] font-mono text-gray-700 shadow-sm">F11</kbd>
                    </span>
                    <div className="text-[13px] text-gray-700">全屏 / 退出全屏</div>
                  </li>
                </ul>
              </div>
            </div>

            <div className="shrink-0 px-5 py-2.5 border-t border-gray-100 bg-white flex items-center gap-1.5 text-[11px] text-gray-400">
              <AlertCircle size={12} />
              <span>以上录入操作仅管理员可用；点击遮罩或按 Esc 关闭本窗口</span>
            </div>
          </div>
        </div>
      )}

      {modalOpen && modalDate && modalDesignerId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setModalOpen(false); stopEditingCell(modalDesignerId, modalDate); }} />
          <div className="relative bg-white rounded-lg shadow-2xl w-[960px] max-w-[96vw] max-h-[90vh] flex flex-col border-2 border-gray-200">
            <div className="relative flex items-center justify-between px-4 py-3 border-b-2 border-gray-200 bg-[#217346] text-white rounded-t-lg">
              <div>
                <div className="font-bold text-lg">{designers.find(d => d.id === modalDesignerId)?.name}</div>
                <div className="text-xs opacity-80">{modalDate}</div>
              </div>
              <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3">
                {!hideTaskTypeOptions && (() => {
                  // 任务加急：默认不勾选；必须先勾选任意任务内容才能勾选
                  const urgentEnabled = canEditTasks && isUrgentAvailable();
                  return (
                    <label
                      className={`flex items-center gap-1.5 text-sm font-bold select-none ${urgentEnabled ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}
                      title={urgentEnabled
                        ? '勾选后整行改用加急配色；确认图 / 设计 / 确认图修改 的文字同时变红'
                        : '只有「确认图 / 设计 / 确认图修改」有加急状态；设计变更 / 既制审图 / 暂停取消 没有加急'}
                    >
                      <input
                        type="checkbox"
                        checked={urgentDraft}
                        onChange={(e) => handleUrgentToggle(e.target.checked)}
                        disabled={!urgentEnabled}
                        className="w-4 h-4 cursor-pointer accent-red-500 disabled:cursor-not-allowed"
                      />
                      <span className="inline-flex items-center gap-1 text-red-200">
                        <Zap size={13} className="shrink-0" />
                        任务加急
                      </span>
                    </label>
                  );
                })()}
                {canEditTasks && !hideTaskTypeOptions && (
                  <button
                    onClick={() => { void openBatchReplaceDialog(); }}
                    className="px-4 py-1.5 bg-white/15 hover:bg-white/25 border border-white/30 rounded text-sm font-bold transition"
                  >
                    批量操作
                  </button>
                )}
                {!hideTaskTypeOptions && (() => {
                  // 新增模式下「显示纳期」默认勾选：仅当还没填仕样号且当前未勾选时才禁用，
                  // 已勾选状态下允许直接取消，避免出现「勾着却点不动」的死状态
                  const specMissing = isAddMode && extractSpecNumber(addModeTaskName)?.length !== specNumberDigits;
                  const deadlineDisabled = specMissing && !showDeadline;
                  return (
                    <label
                      className={`flex items-center gap-1.5 text-sm font-bold select-none ${deadlineDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                      title={specMissing && showDeadline ? `任务名中需包含${specNumberDigits}位数仕样号才能自动带出纳期` : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={showDeadline}
                        onChange={(e) => { void handleDeadlineToggle(e.target.checked); }}
                        disabled={deadlineDisabled}
                        className="w-4 h-4 cursor-pointer accent-white disabled:cursor-not-allowed"
                      />
                      显示纳期
                    </label>
                  );
                })()}
                {showDeadline && !hideTaskTypeOptions && (
                  <label className="flex items-center gap-1.5 text-sm font-bold select-none cursor-pointer">
                    <input
                      type="checkbox"
                      checked={manualDeadline}
                      onChange={(e) => { handleManualDeadlineToggle(e.target.checked); }}
                      className="w-4 h-4 cursor-pointer accent-white"
                    />
                    手动输入
                  </label>
                )}
              </div>
              <button onClick={() => { 
                // 清空待保存的更改
                setPendingChanges([]);
                // 关闭模态框
                setModalOpen(false); 
                stopEditingCell(modalDesignerId, modalDate); 
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
                      <div className={`flex flex-col gap-2 p-4 bg-white rounded-xl border-2 border-gray-200 shadow-sm hover:border-blue-300 transition group/item h-fit min-w-0 ${isLeave ? 'bg-gradient-to-r from-red-50 to-blue-50' : isTrip ? 'bg-gradient-to-r from-teal-50 to-white' : ''}`}>
                        {isLeave ? (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-bold px-3 py-1.5 rounded-lg ${selectedTaskType === 'sick' ? 'bg-red-100 text-red-700 border border-red-300' : selectedTaskType === 'vacation' ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-pink-100 text-pink-700 border border-pink-300'}`}>
                                {selectedTaskType === 'sick' ? '🏖️ 事假' : selectedTaskType === 'vacation' ? '🌴 休假' : '🤒 病假'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-24">
                                <label className="text-sm font-bold text-gray-500 uppercase">请假工时</label>
                                <input
                                  ref={el => inputRefs.current['hours-new'] = el}
                                  type="number"
                                  step="0.5"
                                  min="0"
                                  className="w-full h-10 text-center bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 transition font-bold text-blue-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:bg-white"
                                  value={addModeHours}
                                  placeholder=""
                                  onChange={(e) => setAddModeHours(e.target.value)}
                                />
                              </div>
                              <button
                                onClick={() => {
                                  setModalOpen(false);
                                  stopEditingCell(modalDesignerId, modalDate);
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
                              <span className="text-sm font-bold px-3 py-1.5 rounded-lg bg-teal-100 text-teal-800 border border-teal-300">
                                ✈️ 出差
                              </span>
                              <button
                                onClick={() => {
                                  setModalOpen(false);
                                  stopEditingCell(modalDesignerId, modalDate);
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
                                <label className="text-sm font-bold text-gray-500 uppercase">地点/客户</label>
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
                                <label className="text-sm font-bold text-gray-500 uppercase">工时</label>
                                <input
                                  ref={el => inputRefs.current['hours-new'] = el}
                                  type="number"
                                  step="0.5"
                                  min="0"
                                  className="w-full h-10 text-center bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 transition font-bold text-blue-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:bg-white"
                                  value={addModeHours}
                                  placeholder=""
                                  onChange={(e) => setAddModeHours(e.target.value)}
                                />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {/* 任务内容：6 个复选项固定并排一行（窄屏时横向滚动，不换行） */}
                            <div className="flex items-center gap-2.5 flex-nowrap overflow-x-auto pb-0.5">
                              <label className="text-sm font-bold text-gray-500 uppercase shrink-0">任务内容</label>
                              {TASK_CONTENT_TYPES.map(({ key, label }) => {
                                // 标签做成和表格单元格一样的小色块：底色 = 该任务内容的表格填充色
                                const swatchColor = getTaskBaseColor(systemSettings.taskColorConfig, key, urgentDraft);
                                const checked = addModeTaskType === key;
                                // 勾选「任务加急」后，三种可加急的任务内容（确认图/设计/确认图修改）文字统一变红，
                                // 不只是当前勾选的那一个
                                const labelTextColor = urgentDraft && supportsUrgent(key) ? TASK_URGENT_TEXT_COLOR : TASK_TEXT_COLOR;
                                return (
                                  <label
                                    key={key}
                                    className="flex items-center gap-1.5 shrink-0 whitespace-nowrap cursor-pointer"
                                    title={key === 'paused' ? '工时按 0 计、不计入统计；任务名后缀显示为「暂停/取消」' : undefined}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setAddModeTaskType(key);
                                          setAddModeGuns(prev => applyTaskTypeToGuns(prev, key));
                                          // 设计变更 / 既制审图 / 暂停取消 没有加急状态
                                          if (!supportsUrgent(key)) setUrgentDraft(false);
                                        } else if (checked) {
                                          setAddModeTaskType('none');
                                          setUrgentDraft(false);
                                        }
                                      }}
                                      className="w-4 h-4 rounded border-gray-300 cursor-pointer accent-blue-600"
                                    />
                                    <span
                                      className="text-sm font-bold px-1.5 py-0.5 rounded border border-black/5"
                                      style={{ backgroundColor: swatchColor, color: labelTextColor }}
                                    >
                                      {label}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                            {/* 第二行：任务名 + 纳期 + 总工时 + 删除 */}
                            <div className="flex items-center gap-1.5 min-w-0">
                              <input
                                ref={el => inputRefs.current['task-new'] = el}
                                className="flex-1 min-w-0 h-10 px-3 bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white transition"
                                value={addModeTaskName}
                                onChange={(e) => {
                                  const nextValue = e.target.value;
                                  setAddModeTaskName(nextValue);
                                  scheduleAddModeSpecAutoFill(nextValue);
                                }}
                                placeholder={`输入完整任务名称或者${specNumberDigits}位数仕样号自动对应`}
                                autoFocus
                              />
                              {showDeadline && (
                                manualDeadline ? (
                                  <input
                                    type="text"
                                    className="shrink-0 w-16 h-10 px-2 text-xs font-bold text-red-600 bg-red-50 border-2 border-red-200 rounded-lg text-center outline-none focus:ring-2 focus:ring-red-400 focus:bg-white transition"
                                    placeholder="M/D"
                                    value={manualDeadlineInput}
                                    onChange={(e) => setManualDeadlineInput(e.target.value)}
                                    autoFocus
                                  />
                                ) : (addModeDeadlineTag && (
                                  <span
                                    className="shrink-0 px-2 py-1 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg whitespace-nowrap"
                                    title="纳期"
                                  >
                                    {addModeDeadlineTag}
                                  </span>
                                ))
                              )}
                              <span className="shrink-0 text-xs font-bold text-gray-500">总工时</span>
                              <input
                                ref={el => inputRefs.current['hours-new'] = el}
                                type="number"
                                step="0.5"
                                min="0"
                                className={`w-20 shrink-0 h-10 text-center bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 transition font-bold text-blue-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${addModeGuns.length > 0 || addModePaused ? 'opacity-50 cursor-not-allowed' : 'focus:bg-white'}`}
                                value={addModePaused ? '' : (addModeGuns.length > 0 ? getGunHoursTotalInputValue(addModeGuns) : addModeHours)}
                                placeholder=""
                                onChange={(e) => setAddModeHours(e.target.value)}
                                disabled={addModeGuns.length > 0 || addModePaused}
                                title={addModePaused ? '已勾选「暂停/取消」：工时按 0 计，不计入统计' : undefined}
                              />
                            <button
                              onClick={() => {
                                setModalOpen(false);
                                stopEditingCell(modalDesignerId, modalDate);
                                addToast('任务已取消', 'error');
                              }}
                              className="p-2 text-gray-300 hover:text-red-600 transition"
                              title="删除任务"
                            >
                              <Trash2 size={20} />
                            </button>
                            </div>
                          </div>
                        )}

                        {!isLeave && !isTrip && (
                        <div className="mt-2 pl-4 border-l-2 border-gray-100 flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">枪名</span>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => {
                                  const specNo = extractSpecNumber(addModeTaskName);
                                  if (!specNo || specNo.length !== specNumberDigits) {
                                    addToast(`请先在任务内容中输入${specNumberDigits}位数仕样号`, 'error');
                                    return;
                                  }
                                  runAutoGunLookup(specNo, 'add');
                                }}
                                disabled={!addModeTaskName.trim() || autoGunLookupLoading}
                                className="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-1 rounded hover:bg-emerald-100 transition font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                title="根据仕样号在枪台账中查找匹配枪名"
                              >
                                {autoGunLookupLoading && autoGunLookupContext === 'add' ? '查询中...' : '自动获取枪名'}
                              </button>
                              <button
                                onClick={() => {
                                  setAddModeGuns(prev => [...prev, { id: `gun-new-${Date.now()}`, name: '', hours: '' }]);
                                }}
                                className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-100 transition font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={!addModeTaskName.trim()}
                              >
                                手动添加枪名
                              </button>
                            </div>
                          </div>
                          {/* 自动获取枪名结果面板 */}
                          {autoGunLookupContext === 'add' && (autoGunLookupLoading || autoGunLookupResults) && (
                            <div className="bg-emerald-50/50 border border-emerald-200 rounded-lg p-2 flex flex-col gap-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-emerald-700">
                                  {autoGunLookupLoading ? '正在查询枪台账...' : `找到 ${autoGunLookupResults?.length || 0} 个匹配枪名`}
                                </span>
                                {autoGunLookupResults && autoGunLookupResults.length > 0 && (
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      onClick={() => setAutoGunLookupChecked(new Set(autoGunLookupResults.map((_, i) => i)))}
                                      className="text-[10px] text-emerald-700 hover:underline"
                                    >
                                      全选
                                    </button>
                                    <button
                                      onClick={() => setAutoGunLookupChecked(new Set())}
                                      className="text-[10px] text-gray-500 hover:underline"
                                    >
                                      清空
                                    </button>
                                  </div>
                                )}
                              </div>
                              {autoGunLookupResults && autoGunLookupResults.length > 0 && (
                                <>
                                  <div className="max-h-40 overflow-y-auto flex flex-col gap-0.5">
                                    {autoGunLookupResults.map((r, idx) => {
                                      const checked = autoGunLookupChecked.has(idx);
                                      return (
                                        <label key={idx} className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-emerald-100/60 text-xs ${checked ? 'bg-emerald-100' : ''}`}>
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => toggleAutoGunLookupChecked(idx)}
                                            className="w-3 h-3 accent-emerald-600"
                                          />
                                          <span className={`font-bold ${r.used ? 'text-sky-600' : 'text-gray-800'}`}>{r.gunName}</span>
                                          <span className="text-[10px] text-gray-400">[{r.category} / {r.tableName}]</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                  <div className="flex items-center gap-1.5 pt-1 border-t border-emerald-200">
                                    <button
                                      onClick={applyAutoGunLookup}
                                      disabled={autoGunLookupChecked.size === 0}
                                      className="text-[10px] bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-700 transition font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      添加选中 ({autoGunLookupChecked.size})
                                    </button>
                                    <button
                                      onClick={() => {
                                        setAutoGunLookupResults(null);
                                        setAutoGunLookupContext(null);
                                        setAutoGunLookupChecked(new Set());
                                      }}
                                      className="text-[10px] text-gray-500 hover:text-gray-700 px-2 py-1"
                                    >
                                      取消
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                          {addModeGuns.map((gun, gIdx) => {
                            // 与其他枪名重复（非空）时标红并禁用保存
                            const trimmedName = String(gun.name || '').trim();
                            const isDuplicateName = trimmedName !== '' && addModeGuns.some((g, i) => i !== gIdx && String(g?.name || '').trim() === trimmedName);
                            return (
                            <div key={gun.id} className="flex items-center gap-2 bg-gray-50/50 p-2 rounded-lg group/gun">
                              <input
                                ref={el => inputRefs.current[`gun-new-${gIdx}`] = el}
                                className={`flex-1 h-8 px-2 bg-transparent border-b-2 outline-none text-xs transition ${isDuplicateName ? 'border-red-400 focus:border-red-500 text-red-600' : 'border-gray-200 focus:border-blue-400'}`}
                                value={gun.name}
                                placeholder="枪名..."
                                title={isDuplicateName ? '枪名重复，请修改后再保存' : undefined}
                                onChange={(e) => {
                                  const nextName = e.target.value;
                                  setAddModeGuns(prev => {
                                    const next = [...prev];
                                    next[gIdx] = fillHoursForGunName(next[gIdx], nextName, addModeTaskType);
                                    return next;
                                  });
                                }}
                              />
                              <input
                                ref={el => inputRefs.current[`gunHours-new-${gIdx}`] = el}
                                type="number"
                                step="0.5"
                                min="0"
                                className="w-16 h-8 text-center bg-transparent border-b-2 border-gray-200 focus:border-blue-400 outline-none text-xs font-bold text-blue-600 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50"
                                value={addModePaused ? '' : (gun.hours || '')}
                                placeholder="工时"
                                disabled={addModePaused}
                                title={addModePaused ? '已勾选「暂停/取消」：工时按 0 计，不计入统计' : undefined}
                                onChange={(e) => {
                                  setAddModeGuns(prev => {
                                    const next = [...prev];
                                    next[gIdx] = { ...next[gIdx], hours: e.target.value };
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
                            );
                          })}
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
                                setSelectedTaskType('trip');
                              }}
                              className={`px-3 py-1 text-xs font-bold rounded transition ${selectedTaskType === 'trip' ? 'bg-teal-100 text-teal-800 border border-teal-300' : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'}`}
                            >
                              出差
                            </button>
                            <button
                              onClick={() => {
                                setSelectedTaskType('sick');
                              }}
                              className={`px-3 py-1 text-xs font-bold rounded transition ${selectedTaskType === 'sick' ? 'bg-red-100 text-red-700 border border-red-300' : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'}`}
                            >
                              事假
                            </button>
                            <button
                              onClick={() => {
                                setSelectedTaskType('vacation');
                              }}
                              className={`px-3 py-1 text-xs font-bold rounded transition ${selectedTaskType === 'vacation' ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'}`}
                            >
                              休假
                            </button>
                            <button
                              onClick={() => {
                                setSelectedTaskType('illness');
                              }}
                              className={`px-3 py-1 text-xs font-bold rounded transition ${selectedTaskType === 'illness' ? 'bg-pink-100 text-pink-700 border border-pink-300' : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'}`}
                            >
                              病假
                            </button>
                          </div>
                        </div>

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
                        // 「暂停/取消」：任务名后缀或 paused 标记任一命中即视为暂停（工时按 0 计且不显示）
                        const itemPaused = getTaskTypeFromName(currentItem.taskName) === 'paused' || Boolean(currentItem.paused);
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
                          <div key={currentItem.id} className={`flex flex-col gap-2 p-4 bg-white rounded-xl border-2 border-gray-200 shadow-sm hover:border-blue-300 transition group/item h-fit min-w-0 ${isLeave ? 'bg-gradient-to-r from-red-50 to-blue-50' : isTrip ? 'bg-gradient-to-r from-teal-50 to-white' : ''}`}>
                            {isLeave ? (
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className={`text-sm font-bold px-3 py-1.5 rounded-lg ${currentItem.leaveType === 'sick' ? 'bg-red-100 text-red-700 border border-red-300' : currentItem.leaveType === 'vacation' ? 'bg-blue-100 text-blue-700 border border-blue-300' : currentItem.leaveType === 'illness' ? 'bg-pink-100 text-pink-700 border border-pink-300' : ''}`}>
                                    {currentItem.leaveType === 'sick' ? '🏖️ 事假' : currentItem.leaveType === 'vacation' ? '🌴 休假' : currentItem.leaveType === 'illness' ? '🤒 病假' : ''}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="w-24">
                                    <label className="text-sm font-bold text-gray-500 uppercase">请假工时</label>
                                    <input
                                      ref={el => inputRefs.current[`hours-${currentItem.id}`] = el}
                                      type="number"
                                      step="0.5"
                                      min="0"
                                      className="w-full h-10 text-center bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 transition font-bold text-blue-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:bg-white"
                                      value={getHoursInputValue(currentItem.hours)}
                                      onChange={(e) => handleItemChange(modalDesignerId, modalDate, currentItem.id, 'hours', e.target.value)}
                                      placeholder=""
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
                                  <span className="text-sm font-bold px-3 py-1.5 rounded-lg bg-teal-100 text-teal-800 border border-teal-300">
                                    ✈️ 出差
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
                                    <label className="text-sm font-bold text-gray-500 uppercase">地点/客户</label>
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
                                    <label className="text-sm font-bold text-gray-500 uppercase">工时</label>
                                    <input
                                      ref={el => inputRefs.current[`hours-${currentItem.id}`] = el}
                                      type="number"
                                      step="0.5"
                                      min="0"
                                      className="w-full h-10 text-center bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 transition font-bold text-blue-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:bg-white"
                                      value={getHoursInputValue(currentItem.hours)}
                                      onChange={(e) => handleItemChange(modalDesignerId, modalDate, currentItem.id, 'hours', e.target.value)}
                                      placeholder=""
                                    />
                                  </div>
                                </div>
                              </div>
                            ) : (
                            <div className="flex flex-col gap-2">
                              {/* 任务内容：6 个复选项固定并排一行（窄屏时横向滚动，不换行） */}
                              <div className="flex items-center gap-2.5 flex-nowrap overflow-x-auto pb-0.5">
                                <label className="text-sm font-bold text-gray-500 uppercase shrink-0">任务内容</label>
                                {(() => {
                                  const baseName = currentItem.taskName.replace(/\s+(确认图|设计|确认图修改|设计变更|既制审图|暂停\/取消)?\s*(\[\d+\/\d+\])?$/, '');
                                  const deadlineMatch = currentItem.taskName.match(/(\[\d+\/\d+\])$/);
                                  const deadline = deadlineMatch ? ` ${deadlineMatch[1]}` : '';
                                  // 暂停/取消 是独立状态：任务名后缀 + paused 标记（兼容历史只带标记的数据）
                                  const checkedState: Record<string, boolean> = {
                                    confirm: currentItem.taskName.includes('确认图') && !currentItem.taskName.includes('确认图修改'),
                                    design: currentItem.taskName.includes('设计') && !currentItem.taskName.includes('确认图') && !currentItem.taskName.includes('设计变更'),
                                    confirmModify: currentItem.taskName.includes('确认图修改'),
                                    designChange: currentItem.taskName.includes('设计变更'),
                                    drawingReview: currentItem.taskName.includes('既制审图'),
                                    paused: itemPaused,
                                  };
                                  return TASK_CONTENT_TYPES.map(({ key, label }) => {
                                    // 标签做成和表格单元格一样的小色块：底色 = 该任务内容的表格填充色
                                    const swatchColor = getTaskBaseColor(systemSettings.taskColorConfig, key, urgentDraft);
                                    const checked = checkedState[key];
                                    // 勾选「任务加急」后，三种可加急的任务内容（确认图/设计/确认图修改）文字统一变红，
                                    // 不只是当前勾选的那一个
                                    const labelTextColor = urgentDraft && supportsUrgent(key) ? TASK_URGENT_TEXT_COLOR : TASK_TEXT_COLOR;
                                    return (
                                      <label
                                        key={key}
                                        className="flex items-center gap-1.5 shrink-0 whitespace-nowrap cursor-pointer"
                                        title={key === 'paused' ? '工时按 0 计、不计入统计；任务名后缀显示为「暂停/取消」' : undefined}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={(e) => {
                                            const nextType: DesignTaskType = e.target.checked ? key : 'none';
                                            let newName = baseName + deadline;
                                            if (e.target.checked) {
                                              newName = `${baseName} ${label}${deadline}`;
                                            }
                                            setTaskTypeDrafts(prev => ({
                                              ...prev,
                                              [currentItem.id]: { ...(prev[currentItem.id] || {}), designName: baseName, designGuns: currentItem.guns || [], taskType: nextType }
                                            }));
                                            if (nextType === 'paused') {
                                              // 暂停/取消：取消加急、工时归零，只改任务名后缀
                                              if (urgentDraft) handleUrgentToggle(false);
                                              applyPausedState(currentItem.id, true);
                                              handleItemChange(modalDesignerId, modalDate, currentItem.id, 'taskName', newName);
                                              return;
                                            }
                                            // 离开暂停状态时清掉 paused 标记
                                            if (itemPaused) applyPausedState(currentItem.id, false);
                                            if (nextType === 'none') {
                                              // 取消任务内容后加急失去意义，一并取消
                                              if (urgentDraft) handleUrgentToggle(false);
                                              handleItemChange(modalDesignerId, modalDate, currentItem.id, 'taskName', newName);
                                            } else {
                                              // 设计变更 / 既制审图 没有加急状态
                                              if (!supportsUrgent(nextType) && urgentDraft) handleUrgentToggle(false);
                                              void applyTaskTypeToItem(currentItem.id, nextType, currentItem.guns || [], newName);
                                            }
                                          }}
                                          className="w-4 h-4 rounded border-gray-300 cursor-pointer accent-blue-600"
                                        />
                                        <span
                                          className="text-sm font-bold px-1.5 py-0.5 rounded border border-black/5"
                                          style={{ backgroundColor: swatchColor, color: labelTextColor }}
                                        >
                                          {label}
                                        </span>
                                      </label>
                                    );
                                  });
                                })()}
                              </div>
                              {/* 第二行：任务名 + 纳期 + 总工时 + 操作 */}
                              <div className="flex items-center gap-1.5 min-w-0">
                                <input
                                  ref={el => inputRefs.current[`task-${currentItem.id}`] = el}
                                  className="flex-1 min-w-0 h-10 px-3 bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white transition"
                                  value={currentItem.taskName.replace(/\s+(确认图|设计|确认图修改|设计变更|既制审图|暂停\/取消)?\s*(\[\d+\/\d+\])?$/, '')}
                                  onChange={(e) => {
                                    const typeMatch = currentItem.taskName.match(/(\s+(确认图|设计|确认图修改|设计变更|既制审图|暂停\/取消))?\s*(\[\d+\/\d+\])?$/);
                                    const typeSuffix = typeMatch ? (typeMatch[1] || '') : '';
                                    const deadlineMatch = currentItem.taskName.match(/(\[\d+\/\d+\])$/);
                                    let deadline = deadlineMatch ? ` ${deadlineMatch[1]}` : '';
                                    // 如果已勾选显示纳期，但新的任务名中无法提取指定位数仕样号，自动取消勾选并移除纳期后缀
                                    if (showDeadline && extractSpecNumber(e.target.value)?.length !== specNumberDigits) {
                                      setShowDeadline(false);
                                      deadline = '';
                                    }
                                    const newName = e.target.value + typeSuffix + deadline;
                                    setTaskTypeDrafts(prev => ({
                                      ...prev,
                                      [currentItem.id]: { ...(prev[currentItem.id] || {}), designName: e.target.value, designGuns: currentItem.guns || [] }
                                    }));
                                    handleItemChange(modalDesignerId, modalDate, currentItem.id, 'taskName', newName);
                                  }}
                                  placeholder={`输入完整任务名称或者${specNumberDigits}位数仕样号自动对应`}
                                />
                                {showDeadline && (() => {
                                  if (manualDeadline) {
                                    const deadlineMatch = (currentItem.taskName || '').match(/\[(\d{1,2}\/\d{1,2})\]\s*$/);
                                    const currentVal = manualDeadlineInput || (deadlineMatch ? deadlineMatch[1] : '');
                                    return (
                                      <input
                                        type="text"
                                        className="shrink-0 w-16 h-10 px-2 text-xs font-bold text-red-600 bg-red-50 border-2 border-red-200 rounded-lg text-center outline-none focus:ring-2 focus:ring-red-400 focus:bg-white transition"
                                        placeholder="M/D"
                                        value={currentVal}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setManualDeadlineInput(val);
                                          const m = val.match(/^(\d{1,2})\/(\d{1,2})$/);
                                          if (m) {
                                            const base = (currentItem.taskName || '').replace(/\s*\[\d{1,2}\/\d{1,2}\]\s*$/, '').trim();
                                            handleItemChange(modalDesignerId, modalDate, currentItem.id, 'taskName', `${base} [${m[1]}/${m[2]}]`);
                                          }
                                        }}
                                      />
                                    );
                                  }
                                  const deadlineTag = (currentItem.taskName || '').match(/(\[\d{1,2}\/\d{1,2}\])\s*$/);
                                  return deadlineTag ? (
                                    <span
                                      className="shrink-0 px-2 py-1 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg whitespace-nowrap"
                                      title="纳期"
                                    >
                                      {deadlineTag[1]}
                                    </span>
                                  ) : null;
                                })()}
                                <span className="shrink-0 text-xs font-bold text-gray-500">总工时</span>
                                <input
                                  ref={el => inputRefs.current[`hours-${currentItem.id}`] = el}
                                  type="number"
                                  step="0.5"
                                  min="0"
                                  className={`w-20 shrink-0 h-10 text-center bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 transition font-bold text-blue-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${hasGuns || itemPaused ? 'opacity-50 cursor-not-allowed' : 'focus:bg-white'}`}
                                value={itemPaused ? '' : (hasGuns ? getGunHoursTotalInputValue(currentItem.guns) : getHoursInputValue(currentItem.hours))}
                                onChange={(e) => !hasGuns && handleItemChange(modalDesignerId, modalDate, currentItem.id, 'hours', e.target.value)}
                                disabled={hasGuns || itemPaused}
                                title={itemPaused ? '已勾选「暂停/取消」：工时按 0 计，不计入统计' : undefined}
                                placeholder=""
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => deleteItem(modalDesignerId, modalDate, currentItem.id)}
                                  className="p-2 text-gray-300 hover:text-red-600 transition"
                                  title="删除任务"
                                >
                                  <Trash2 size={20} />
                                </button>
                              </div>
                              </div>
                            </div>
                            )}

                            {!isLeave && !isTrip && (
                            <div className="mt-2 pl-4 border-l-2 border-gray-100 flex flex-col gap-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">枪名</span>
                                <div className="flex flex-wrap items-center justify-end gap-1.5">
                                  <button
                                    onClick={async () => {
                                      const specNo = extractSpecNumber(currentItem.taskName);
                                      if (!specNo) {
                                        addToast('未能从任务名称中提取仕样号', 'error');
                                        return;
                                      }

                                      addToast(`正在同步仕样号 ${specNo} 的客户名和纳期...`, 'success');
                                      const specInfo = await fetchSpecInfo(specNo);
                                      if (!specInfo.success) {
                                        addToast(specInfo.message || '获取仕样信息失败', 'error');
                                        return;
                                      }

                                      const clientName = getDesignPlanClientName(specInfo, specNo);
                                      if (!clientName) {
                                        addToast(`未找到仕样号 ${specNo} 的客户信息`, 'error');
                                        return;
                                      }

                                      let deliverySuffix: string | null = null;
                                      if (manualDeadline) {
                                        const m = manualDeadlineInput.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
                                        if (m) {
                                          deliverySuffix = `[${m[1]}/${m[2]}]`;
                                        } else {
                                          addToast('手动纳期格式不正确，请输入 M/D 格式（如 9/15）', 'error');
                                          return;
                                        }
                                      } else {
                                        let deliveryDate = specInfo.deliveryDate;
                                        if (!deliveryDate) {
                                          const deliveryResult = await fetchSpecDeliveryDate(specNo);
                                          if (deliveryResult.success && deliveryResult.date) {
                                            deliveryDate = deliveryResult.date;
                                          } else {
                                            addToast(deliveryResult.message || '获取纳期失败', 'error');
                                            return;
                                          }
                                        }
                                        deliverySuffix = getDeliveryDateSuffix(deliveryDate);
                                        if (!deliverySuffix) {
                                          addToast(`未找到仕样号 ${specNo} 的纳期信息`, 'error');
                                          return;
                                        }
                                      }

                                      let updatedCount = 0;
                                      sheets.forEach(sheet => {
                                        Object.entries(sheet.days || {}).forEach(([date, items]) => {
                                          (items || []).forEach(item => {
                                            const itemSpecNo = extractSpecNumber(item.taskName);
                                            if (itemSpecNo === specNo) {
                                              const newName = buildSyncedSpecTaskName(item.taskName || '', specInfo, specNo, deliverySuffix);
                                              handleItemChange(sheet.designerId, date, item.id, 'taskName', newName);
                                              updatedCount++;
                                            }
                                          });
                                        });
                                      });

                                      addToast(`相同仕样号同步完成: ${deliverySuffix}（已更新 ${updatedCount} 个任务）`, 'success');
                                    }}
                                    className="px-2 py-1 text-[10px] bg-violet-50 text-violet-600 rounded hover:bg-violet-100 transition font-bold whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="按仕样号同步更新所有相同仕样号任务的客户名与纳期"
                                    disabled={!currentItem.taskName || !currentItem.taskName.trim()}
                                  >
                                    相同仕样号同步更新
                                  </button>
                                  <button
                                    onClick={() => {
                                      const specNo = extractSpecNumber(currentItem.taskName);
                                      if (!specNo || specNo.length !== specNumberDigits) {
                                        addToast(`未能从任务名称中提取${specNumberDigits}位数仕样号`, 'error');
                                        return;
                                      }
                                      runAutoGunLookup(specNo, 'edit', currentItem.id);
                                    }}
                                    disabled={!currentItem.taskName || !currentItem.taskName.trim() || autoGunLookupLoading}
                                    className="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-1 rounded hover:bg-emerald-100 transition font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="根据仕样号在枪台账中查找匹配枪名"
                                  >
                                    {autoGunLookupLoading && autoGunLookupContext === 'edit' && autoGunLookupItemId === currentItem.id ? '查询中...' : '自动获取枪名'}
                                  </button>
                                  <button
                                    onClick={() => {
                                      const newGuns = [...(currentItem.guns || []), { id: `gun-${Date.now()}`, name: '', hours: '' }];
                                      setTaskTypeDrafts(prev => ({
                                        ...prev,
                                        [currentItem.id]: { ...(prev[currentItem.id] || {}), designName: currentItem.taskName || '', designGuns: newGuns }
                                      }));
                                      handleItemChange(modalDesignerId, modalDate, currentItem.id, 'guns', newGuns);
                                    }}
                                    disabled={!currentItem.taskName || !currentItem.taskName.trim()}
                                    className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-100 transition font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    手动添加枪名
                                  </button>
                                </div>
                              </div>
                              {/* 自动获取枪名结果面板（编辑模式：在原有枪名之上显示，方便对比） */}
                              {autoGunLookupContext === 'edit' && autoGunLookupItemId === currentItem.id && (autoGunLookupLoading || autoGunLookupResults) && (
                                <div className="bg-emerald-50/50 border border-emerald-200 rounded-lg p-2 flex flex-col gap-1.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-emerald-700">
                                      {autoGunLookupLoading ? '正在查询枪台账...' : `找到 ${autoGunLookupResults?.length || 0} 个匹配枪名`}
                                    </span>
                                    {autoGunLookupResults && autoGunLookupResults.length > 0 && (
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          onClick={() => setAutoGunLookupChecked(new Set(autoGunLookupResults.map((_, i) => i)))}
                                          className="text-[10px] text-emerald-700 hover:underline"
                                        >
                                          全选
                                        </button>
                                        <button
                                          onClick={() => setAutoGunLookupChecked(new Set())}
                                          className="text-[10px] text-gray-500 hover:underline"
                                        >
                                          清空
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  {autoGunLookupResults && autoGunLookupResults.length > 0 && (
                                    <>
                                      <div className="max-h-40 overflow-y-auto flex flex-col gap-0.5">
                                        {autoGunLookupResults.map((r, idx) => {
                                          const checked = autoGunLookupChecked.has(idx);
                                          const existing = (currentItem.guns || []).some(g => (g.name || '').trim() === r.gunName);
                                          return (
                                            <label key={idx} className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${checked ? 'bg-emerald-100' : 'hover:bg-emerald-100/60'} ${existing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                                              <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleAutoGunLookupChecked(idx)}
                                                disabled={existing}
                                                className="w-3 h-3 accent-emerald-600"
                                              />
                                              <span className={`font-bold ${r.used ? 'text-sky-600' : 'text-gray-800'}`}>{r.gunName}</span>
                                              {existing && <span className="text-[10px] text-gray-400">(已存在)</span>}
                                              <span className="text-[10px] text-gray-400">[{r.category} / {r.tableName}]</span>
                                            </label>
                                          );
                                        })}
                                      </div>
                                      <div className="flex items-center gap-1.5 pt-1 border-t border-emerald-200">
                                        <button
                                          onClick={applyAutoGunLookup}
                                          disabled={autoGunLookupChecked.size === 0}
                                          className="text-[10px] bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-700 transition font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                          追加选中 ({autoGunLookupChecked.size})
                                        </button>
                                        <button
                                          onClick={() => {
                                            setAutoGunLookupResults(null);
                                            setAutoGunLookupContext(null);
                                            setAutoGunLookupItemId(null);
                                            setAutoGunLookupChecked(new Set());
                                          }}
                                          className="text-[10px] text-gray-500 hover:text-gray-700 px-2 py-1"
                                        >
                                          取消
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              )}
                              {(currentItem.guns || []).map((gun, gIdx) => {
                                // 与其他枪名重复（非空）时标红并禁用保存
                                const trimmedName = String(gun.name || '').trim();
                                const isDuplicateName = trimmedName !== '' && (currentItem.guns || []).some((g, i) => i !== gIdx && String(g?.name || '').trim() === trimmedName);
                                return (
                                <div key={gun.id} className="flex items-center gap-2 bg-gray-50/50 p-2 rounded-lg group/gun">
                                  <input
                                    ref={el => inputRefs.current[`gun-${currentItem.id}-${gIdx}`] = el}
                                    className={`flex-1 h-8 px-2 bg-transparent border-b-2 outline-none text-xs transition ${isDuplicateName ? 'border-red-400 focus:border-red-500 text-red-600' : 'border-gray-200 focus:border-blue-400'}`}
                                    value={gun.name}
                                    placeholder="枪名..."
                                    title={isDuplicateName ? '枪名重复，请修改后再保存' : undefined}
                                    onChange={(e) => {
                                      const newGuns = [...(currentItem.guns || [])];
                                      newGuns[gIdx] = fillHoursForGunName(
                                        newGuns[gIdx],
                                        e.target.value,
                                        getTaskTypeFromName(currentItem.taskName)
                                      );
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
                                    className="w-16 h-8 text-center bg-transparent border-b-2 border-gray-200 focus:border-blue-400 outline-none text-xs font-bold text-blue-600 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50"
                                    value={itemPaused ? '' : (gun.hours || '')}
                                    placeholder="工时"
                                    disabled={itemPaused}
                                    title={itemPaused ? '已勾选「暂停/取消」：工时按 0 计，不计入统计' : undefined}
                                    onChange={(e) => {
                                      const newGuns = [...(currentItem.guns || [])];
                                      newGuns[gIdx] = { ...newGuns[gIdx], hours: e.target.value };
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
                                );
                              })}
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
                                        className={`px-3 py-1 text-xs font-bold rounded transition ${currentLeaveType === 'trip' ? 'bg-teal-100 text-teal-800 border border-teal-300' : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200'}`}
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
                    if (warnIfOfflineEdit()) return;
                    if (isAddMode) {
                      const guns = selectedTaskType === 'none' ? addModeGuns : [];
                      const leaveType = selectedTaskType === 'none' ? null : selectedTaskType;
                      // 暂停/取消：工时直接按 0 保存，不计入统计
                      const savedPaused = leaveType === null && addModeTaskType === 'paused';
                      const hours = savedPaused
                        ? 0
                        : guns.length > 0
                          ? guns.reduce((sum, gun) => sum + (parseFloat(String(gun.hours)) || 0), 0)
                          : parseFloat(addModeHours) || 0;
                      let taskName = '';
                      let fetchedSpecInfo: SpecInfoResponse | null = null;
                      
                      if (selectedTaskType === 'trip') {
                        const place = addModeTripPlace.trim();
                        taskName = place ? `${place}出差` : '出差';
                      } else if (selectedTaskType === 'none') {
                        const trimmedTaskName = addModeTaskName.trim();
                        const pureSpecNumber = isPureFiveDigitSpecNumber(trimmedTaskName) ? trimmedTaskName : null;
                        taskName = trimmedTaskName || '未命名';

                        if (pureSpecNumber) {
                          const specInfo = await fetchSpecInfo(pureSpecNumber);
                          if (specInfo.success) {
                            fetchedSpecInfo = specInfo;
                            const clientName = getDesignPlanClientName(specInfo, pureSpecNumber);
                            if (clientName) {
                              taskName = clientName;
                            } else {
                              addToast(`未找到仕样号 ${pureSpecNumber} 的客户信息`, 'error');
                            }
                          } else {
                            addToast(specInfo.message || `未找到仕样号 ${pureSpecNumber} 的客户信息`, 'error');
                          }
                        }

                        if (addModeTaskType === 'confirm') {
                          taskName += ' 确认图';
                        } else if (addModeTaskType === 'design') {
                          taskName += ' 设计';
                        } else if (addModeTaskType === 'confirmModify') {
                          taskName += ' 确认图修改';
                        } else if (addModeTaskType === 'designChange') {
                          taskName += ' 设计变更';
                        } else if (addModeTaskType === 'drawingReview') {
                          taskName += ' 既制审图';
                        } else if (addModeTaskType === 'paused') {
                          taskName += ` ${PAUSED_TASK_SUFFIX}`;
                        }
                      }
                      
                      if (showDeadline && selectedTaskType === 'none' && taskName && taskName !== '未命名') {
                        if (manualDeadline && manualDeadlineInput.trim()) {
                          const m = manualDeadlineInput.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
                          if (m) {
                            taskName = taskName.replace(/\s*\[\d{1,2}\/\d{1,2}\]$/, '') + ` [${m[1]}/${m[2]}]`;
                          } else {
                            addToast('手动纳期格式不正确，请输入 M/D 格式（如 9/15）', 'error');
                          }
                        } else if (!manualDeadline) {
                          const specNo = extractSpecNumber(taskName);
                          if (specNo) {
                            const result = fetchedSpecInfo?.specNumber === specNo && fetchedSpecInfo.deliveryDate
                              ? { success: true, date: fetchedSpecInfo.deliveryDate }
                              : await fetchSpecDeliveryDate(specNo);
                            if (result.success && result.date) {
                              const dateMatch = result.date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
                              if (dateMatch) {
                                const month = parseInt(dateMatch[2], 10);
                                const day = parseInt(dateMatch[3], 10);
                                const dateStr = `[${month}/${day}]`;
                                taskName = taskName.replace(/\s*\[(\d{1,2})\/(\d{1,2})\]$/, '') + ' ' + dateStr;
                              }
                            } else {
                              addToast(`未找到仕样号 ${specNo} 的纳期信息`, 'error');
                            }
                          }
                        }
                      }
                      
                      try {
                        // 任务内容配色体系：底色由勾选的任务内容 + 是否加急决定
                        const savedUrgent = leaveType || savedPaused ? false : urgentDraft;
                        const res = await axiosInstance.post('/tasks/item', { 
                          designerId: modalDesignerId, 
                          date: modalDate, 
                          taskName, 
                          leaveType, 
                          hours,
                          color: getTaskDisplayColors(systemSettings.taskColorConfig, {
                            taskName,
                            urgent: savedUrgent,
                            paused: savedPaused,
                          }).bg,
                          urgent: savedUrgent,
                          paused: savedPaused,
                          guns
                        });
                        upsertSheet(res.data.sheet);
                        emitTaskUpdated(modalDesignerId ?? undefined);
                        setPendingChanges([]);
                        setFocusTarget(null);
                        setModalOpen(false);
                        stopEditingCell(modalDesignerId, modalDate);
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
                              (updatedItem as any)[change.field] = change.value;
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
                        stopEditingCell(modalDesignerId, modalDate);
                        addToast('任务已保存', 'success');
                      } catch (err) {
                        addToast('保存失败', 'error');
                        // 如果保存失败，重新加载数据
                        fetchSheets();
                      }
                    }
                  }}
                  disabled={(() => {
                    if (!canEditTasks) return true;
                    if (isAddMode) {
                      if (selectedTaskType === 'none') {
                        const totalGunHours = addModeGuns.reduce((sum, gun) => sum + (parseFloat(String(gun.hours)) || 0), 0);
                        const parsedHours = parseFloat(addModeHours);
                        const hasValidHours = !isNaN(parsedHours) && parsedHours > 0;
                        // 暂停/取消：工时固定为 0，只要求任务名
                        if (addModePaused) return !addModeTaskName.trim();
                        return !addModeTaskName.trim() || hasInvalidNamedGunHours(addModeGuns) || hasDuplicateGunNames(addModeGuns) || (addModeGuns.length > 0 ? totalGunHours === 0 : !hasValidHours);
                      }
                      const parsedHours = parseFloat(addModeHours);
                      return isNaN(parsedHours) || parsedHours <= 0;
                    }
                    // 编辑模式：单元格内任一主任务（含挂起更改）存在重复枪名时禁止保存
                    const cellItems = getAllItems(modalDesignerId, modalDate).map(i => getItemWithPendingChanges(i));
                    if (cellItems.some(i => hasDuplicateGunNames(i.guns))) return true;
                    if (focusTarget && focusTarget.itemId) {
                      const item = cellItems.find(i => i.id === focusTarget.itemId);
                      if (item) {
                        const hours = typeof item.hours === 'number' ? item.hours : parseFloat(item.hours as string);
                        const leaveType = item.leaveType;
                        const taskName = item.taskName || '';
                        const hasGuns = item.guns && item.guns.length > 0;
                        
                        // 暂停/取消：工时固定为 0，只要求任务名
                        if (item.paused || getTaskTypeFromName(item.taskName) === 'paused') {
                          return !(taskName || '').trim();
                        }

                        if (hasGuns) {
                          const totalGunsHours = (item.guns || []).reduce((sum, g) => sum + (typeof g.hours === 'number' ? g.hours : (parseFloat(g.hours as string) || 0)), 0);
                          return hasInvalidNamedGunHours(item.guns) || hasDuplicateGunNames(item.guns) || totalGunsHours === 0;
                        }
                        
                        const hasValidHours = !isNaN(hours) && hours > 0;
                        if (!leaveType) {
                          return !taskName.trim() || !hasValidHours;
                        } else {
                          return !hasValidHours;
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

      {batchReplaceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/35"
            onClick={() => {
              if (!batchReplaceLoading) setBatchReplaceOpen(false);
            }}
          />
          <div
            className="relative w-[540px] max-w-[94vw] bg-white rounded-lg shadow-2xl border-2 border-gray-200 overflow-hidden"
            style={{ opacity: batchLocateDimmed ? 0.2 : 1, transition: 'opacity 0.3s ease' }}
            onMouseEnter={() => {
              if (batchLocateRestoreTimerRef.current) {
                window.clearTimeout(batchLocateRestoreTimerRef.current);
                batchLocateRestoreTimerRef.current = null;
              }
              setBatchLocateDimmed(false);
            }}
          >
            <div className="flex items-center justify-between px-4 py-3 bg-[#217346] text-white">
              <div className="font-bold text-base">批量操作</div>
              <button
                onClick={() => setBatchReplaceOpen(false)}
                disabled={batchReplaceLoading}
                className="p-1 hover:bg-red-600 rounded transition disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1.5">查找字符</label>
                <input
                  className="w-full h-10 px-3 bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white transition"
                  value={batchFindText}
                  onChange={(e) => {
                    setBatchFindText(e.target.value);
                    resetBatchSearchResults();
                  }}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1.5">替换为</label>
                <input
                  className="w-full h-10 px-3 bg-gray-50 border-2 border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white transition"
                  value={batchReplaceText}
                  onChange={(e) => {
                    setBatchReplaceText(e.target.value);
                    resetBatchSearchResults();
                  }}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
                <span className="text-sm font-bold text-gray-700">全表</span>
                <button
                  type="button"
                  onClick={() => {
                    setBatchReplaceAllTable(prev => !prev);
                    resetBatchSearchResults();
                  }}
                  className={`relative h-6 w-11 rounded-full transition ${batchReplaceAllTable ? 'bg-blue-600' : 'bg-gray-300'}`}
                  aria-pressed={batchReplaceAllTable}
                >
                  <span
                    className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${batchReplaceAllTable ? 'left-6' : 'left-1'}`}
                  />
                </button>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white">
                <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
                  <div className="text-sm font-bold text-gray-700">
                    {batchSearchDone
                      ? `找到 ${batchMatches.length} 个任务，${batchMatchCount} 处字符`
                      : '查找结果'}
                  </div>
                  <button
                    onClick={handleBatchSearch}
                    disabled={!canEditTasks || batchSearchLoading || batchReplaceLoading || !batchFindText}
                    className="px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {batchSearchLoading ? '查找中...' : '查找'}
                  </button>
                </div>
                <div className="max-h-56 overflow-auto">
                  {!batchSearchDone ? (
                    <div className="px-3 py-6 text-sm text-gray-400 text-center">点击查找后显示命中的任务</div>
                  ) : batchMatches.length === 0 ? (
                    <div className="px-3 py-6 text-sm text-gray-400 text-center">未找到匹配任务</div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {batchMatches.map(match => (
                        <div
                          key={`${match.designerId}-${match.date}-${match.itemId}`}
                          className="px-3 py-2 hover:bg-blue-50/60 cursor-pointer transition group/match"
                          onClick={() => handleBatchLocate(match)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleBatchLocate(match);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          title="点击定位到底部表格中的该任务"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-bold text-gray-800 truncate">{match.taskName || '无任务名'}</div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[11px] text-gray-500">{match.designerName} · {match.date}</span>
                              <span className="hidden group-hover/match:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[11px] font-bold">
                                <Crosshair size={11} />定位
                              </span>
                            </div>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {match.fields.map((field, index) => {
                              // 枪名直接显示完整枪名；任务名匹配显示其仕样号（无仕样号时回退为"任务名"）
                              const badgeLabel = field.field === 'gunName'
                                ? `枪名${field.text}`
                                : (() => {
                                    const spec = extractSpecNumber(field.text || '');
                                    return spec ? `任务仕样号${spec}` : '任务名';
                                  })();
                              return (
                                <span key={`${field.field}-${index}`} className="px-2 py-0.5 rounded bg-yellow-50 text-yellow-800 border border-yellow-200 text-[11px]">
                                  {badgeLabel}：{field.count} 处
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t-2 border-gray-200 bg-gray-50">
              <button
                onClick={() => setBatchReplaceOpen(false)}
                disabled={batchReplaceLoading}
                className="px-4 py-2 text-sm font-bold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 transition disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleBatchReplace}
                disabled={!canEditTasks || batchReplaceLoading || !batchFindText}
                className="px-5 py-2 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {batchReplaceLoading ? '处理中...' : '替换'}
              </button>
            </div>
          </div>
        </div>
      )}

      {changePasswordOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => { if (!changePasswordLoading) setChangePasswordOpen(false); }}
          />
          <div className="relative w-[480px] max-w-[94vw] bg-white rounded-lg shadow-2xl border-2 border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-[#217346] text-white">
              <div className="flex items-center gap-2">
                <Lock size={18} />
                <span className="font-bold text-base">修改密码</span>
              </div>
              <button
                type="button"
                onClick={() => { if (!changePasswordLoading) setChangePasswordOpen(false); }}
                disabled={changePasswordLoading}
                className="p-1 hover:bg-red-600 rounded transition disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setChangePasswordError('');
                setChangePasswordSuccess('');

                if (!oldPassword || !newPassword) {
                  setChangePasswordError('请填写所有字段');
                  return;
                }
                if (newPassword !== confirmPassword) {
                  setChangePasswordError('两次输入的密码不一致');
                  return;
                }

                setChangePasswordLoading(true);
                try {
                  await axiosInstance.post('/auth/change-password', {
                    oldPassword,
                    newPassword
                  });
                  setChangePasswordSuccess('密码修改成功');
                  setOldPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                  setVisiblePasswords({ old: false, new: false, confirm: false });
                  setTimeout(() => setChangePasswordOpen(false), 1500);
                } catch (err: any) {
                  setChangePasswordError(err.response?.data?.message || '密码修改失败');
                } finally {
                  setChangePasswordLoading(false);
                }
              }}
              className="p-5 space-y-4"
            >
              {changePasswordError && (
                <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-lg flex items-start gap-2">
                  <AlertCircle size={18} className="mt-0.5 shrink-0" />
                  <div className="text-sm font-medium">{changePasswordError}</div>
                </div>
              )}
              {changePasswordSuccess && (
                <div className="bg-green-50 border border-green-200 text-green-600 p-3 rounded-lg flex items-start gap-2">
                  <CheckCircle size={18} className="mt-0.5 shrink-0" />
                  <div className="text-sm font-medium">{changePasswordSuccess}</div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">当前密码</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                    <Lock size={16} />
                  </div>
                  <input
                    type={visiblePasswords.old ? 'text' : 'password'}
                    className="w-full pl-10 pr-11 py-2.5 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#217346] focus:border-[#217346] outline-none text-gray-800 font-medium transition placeholder-gray-400"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    placeholder="请输入当前密码"
                    required
                    autoFocus
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-600 outline-none transition"
                    onClick={() => setVisiblePasswords((c) => ({ ...c, old: !c.old }))}
                    onMouseDown={(e) => e.preventDefault()}
                    tabIndex={-1}
                  >
                    {visiblePasswords.old ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">新密码</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                    <Lock size={16} />
                  </div>
                  <input
                    type={visiblePasswords.new ? 'text' : 'password'}
                    className="w-full pl-10 pr-11 py-2.5 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#217346] focus:border-[#217346] outline-none text-gray-800 font-medium transition placeholder-gray-400"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="请输入新密码"
                    required
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-600 outline-none transition"
                    onClick={() => setVisiblePasswords((c) => ({ ...c, new: !c.new }))}
                    onMouseDown={(e) => e.preventDefault()}
                    tabIndex={-1}
                  >
                    {visiblePasswords.new ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">确认新密码</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                    <Lock size={16} />
                  </div>
                  <input
                    type={visiblePasswords.confirm ? 'text' : 'password'}
                    className="w-full pl-10 pr-11 py-2.5 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#217346] focus:border-[#217346] outline-none text-gray-800 font-medium transition placeholder-gray-400"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="请再次输入新密码"
                    required
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-600 outline-none transition"
                    onClick={() => setVisiblePasswords((c) => ({ ...c, confirm: !c.confirm }))}
                    onMouseDown={(e) => e.preventDefault()}
                    tabIndex={-1}
                  >
                    {visiblePasswords.confirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { if (!changePasswordLoading) setChangePasswordOpen(false); }}
                  disabled={changePasswordLoading}
                  className="px-4 py-2 text-sm font-bold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 transition disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={changePasswordLoading}
                  className={`px-5 py-2 text-sm font-bold text-white bg-[#217346] rounded-lg hover:bg-[#1a5c38] transition flex items-center gap-2 ${changePasswordLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                  {changePasswordLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>修改中...</span>
                    </>
                  ) : (
                    <span>确认修改</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
