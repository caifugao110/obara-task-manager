import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import {
  AlertCircle,
  Archive,
  Ban,
  CheckCircle,
  ChevronLeft,
  Database,
  Download,
  FileSpreadsheet,
  LogOut,
  PlayCircle,
  Plus,
  Power,
  RefreshCw,
  Settings,
  Shield,
  ShieldAlert,
  Trash2,
  Upload,
  History,
  Search,
  Clock,
  ClipboardList,
  X,
  CalendarDays,
  Palette,
  RotateCcw,
  Save
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { axiosInstance } from '../services/api';
import LoadingScreen from '../components/LoadingScreen';
import { useSystemSettings, SystemSettingsData } from '../context/SystemSettingsContext';
import { getActionLabel, getBrowserLabel, getRoleClassName, getRoleLabel, LoginLog } from '../utils/loginLogs';
import { clearOfflineSheetsCache } from '../utils/offlineSheetsCache';
import {
  DEFAULT_TASK_COLOR_CONFIG,
  TASK_COLOR_FIELDS,
  TASK_TEXT_COLOR,
  TASK_URGENT_TEXT_COLOR,
  isUrgentRestyleType,
  mergeTaskColorConfig,
  normalizeHexColor
} from '../utils/taskColors';
import type { TaskColorConfig, TaskContentType } from '../utils/taskColors';

interface Toast {
  message: string;
  type: 'success' | 'error';
  id: number;
}

// 通用二次确认弹窗的状态（替代原生 window.confirm）
interface ConfirmDialogState {
  title: string;
  tone: 'red' | 'amber';
  warning: string;
  message: React.ReactNode;
  confirmText: string;
  onConfirm: () => Promise<void>;
}

interface IpBlacklistEntry {
  id: string;
  ip: string;
  note?: string;
  createdAt: string;
  createdBy?: { id?: string; username?: string; name?: string };
}

interface IpBlacklistData {
  enabled: boolean;
  entries: IpBlacklistEntry[];
}

interface MaintenanceFile {
  name: string;
  path: string;
  size: number;
  mtime: string;
}

interface YearlyCleanupRecord {
  completedAt: string;
  cutoffYear: number;
  archivedSheets: number;
  removedSheets: number;
  removedTaskItems?: number;
  archiveFile: string | null;
}

interface MaintenanceSettings {
  enabled: boolean;
  dailyBackupEnabled: boolean;
  dailyTaskExportEnabled: boolean;
  dailyGunLedgerExportEnabled: boolean;
  offlineBackupEnabled: boolean;
  backupRetentionDays: number;
  offlineBackupRetentionDays: number;
  taskExportRetentionDays: number;
  gunLedgerExportRetentionDays: number;
  scheduleTimes: string[];
  yearlyCleanupEnabled: boolean;
  yearlyCleanupMonth: number;
  yearlyCleanupCheckDays: number;
  yearlyTaskRetentionYears: number;
  backupDir: string;
  taskExportDir: string;
  gunLedgerExportDir: string;
  yearlyArchiveDir: string;
  offlineBackupDir: string;
  yearlyCleanupHistory?: Record<string, YearlyCleanupRecord>;
}

interface MaintenanceLastRun {
  startedAt?: string;
  finishedAt?: string;
  skipped?: boolean;
  reason?: string;
  backup?: { fileName: string; size: number } | null;
  taskExport?: { fileName?: string; taskSheets?: number; taskItems?: number; skipped?: boolean; reason?: string } | null;
  gunLedgerExport?: { fileName?: string; categories?: number; skipped?: boolean; reason?: string } | null;
  backupCleanup?: { removedCount: number } | null;
  yearlyCleanup?: {
    skipped?: boolean;
    reason?: string;
    cutoffYear?: number;
    archivedSheets?: number;
    removedSheets?: number;
    removedTaskItems?: number;
    archive?: { fileName: string } | null;
  } | null;
  errors?: string[];
}

interface MaintenanceStatus {
  settings: MaintenanceSettings;
  paths: { database: string; backupDir: string; taskExportDir: string; gunLedgerExportDir: string; yearlyArchiveDir: string; offlineBackupDir: string };
  database: {
    dbFileSize: number;
    walSize: number;
    shmSize: number;
    totalDiskSize: number;
    /** 空闲页体积：已删除但尚未归还给操作系统的空间，压缩后才会真正释放 */
    freelistBytes?: number;
    reclaimableBytes?: number;
    tasksJsonSize: number;
    tasksCount: number;
    taskItemsCount: number;
  };
  files: { backups: MaintenanceFile[]; taskExports: MaintenanceFile[]; gunLedgerExports: MaintenanceFile[]; yearlyArchives: MaintenanceFile[]; offlineBackups: MaintenanceFile[] };
  scheduler: { running: boolean; nextRunAt?: string; nextRunAtLocal?: string; timezone?: string; lastRun?: MaintenanceLastRun | null };
}

const defaultMaintenanceSettings: MaintenanceSettings = {
  enabled: true,
  dailyBackupEnabled: true,
  dailyTaskExportEnabled: true,
  dailyGunLedgerExportEnabled: true,
  offlineBackupEnabled: true,
  backupRetentionDays: 30,
  offlineBackupRetentionDays: 7,
  taskExportRetentionDays: 30,
  gunLedgerExportRetentionDays: 30,
  scheduleTimes: ['00:30', '12:30'],
  yearlyCleanupEnabled: true,
  yearlyCleanupMonth: 1,
  yearlyCleanupCheckDays: 10,
  yearlyTaskRetentionYears: 1,
  backupDir: 'backups/database',
  taskExportDir: 'backups/task-exports',
  gunLedgerExportDir: 'backups/gun-ledger-exports',
  yearlyArchiveDir: 'backups/yearly-archives',
  offlineBackupDir: 'backups/offline'
};


const defaultAccessSettings = { enabled: true, allowAdmins: true, allowViewers: false };

/** 单个颜色输入：色块取色 + 十六进制手输 + 单值恢复默认 */
const ColorInput: React.FC<{
  label: string;
  value: string;
  fallback: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}> = ({ label, value, fallback, disabled, onChange }) => {
  const [text, setText] = useState(value);
  React.useEffect(() => { setText(value); }, [value]);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium text-gray-500 w-8 shrink-0">{label}</span>
      <label
        className={`relative w-7 h-7 shrink-0 rounded-md border border-gray-300 shadow-inner overflow-hidden ${disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:ring-2 hover:ring-blue-300'}`}
        style={{ backgroundColor: value }}
        title="点击选色"
      >
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
      </label>
      <input
        value={text}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const next = normalizeHexColor(text, value);
          setText(next);
          onChange(next);
        }}
        className="flex-1 min-w-0 h-7 px-1.5 text-[11px] font-mono text-gray-700 bg-gray-50 border border-gray-200 rounded outline-none focus:ring-1 focus:ring-blue-400 focus:bg-white disabled:opacity-60 disabled:cursor-not-allowed"
      />
      {value.toLowerCase() !== fallback.toLowerCase() && !disabled && (
        <button
          type="button"
          onClick={() => onChange(fallback)}
          className="shrink-0 text-[10px] font-bold text-gray-400 hover:text-blue-600 transition"
          title="恢复该颜色默认值"
        >
          默认
        </button>
      )}
    </div>
  );
};

const SystemSettings = () => {
  const { user, token, logout } = useAuth();
  const { settings, setSettings, refreshSettings } = useSystemSettings();
  const [accessSettings, setAccessSettings] = useState(defaultAccessSettings);
  // 任务内容配色草稿：编辑后点「保存配色」落库，避免连续取色时反复写设置
  const [colorDraft, setColorDraft] = useState<TaskColorConfig>(() => mergeTaskColorConfig(settings.taskColorConfig));
  const [colorSaving, setColorSaving] = useState(false);
  useEffect(() => {
    setColorDraft(mergeTaskColorConfig(settings.taskColorConfig));
  }, [settings.taskColorConfig]);
  const colorDraftDirty = JSON.stringify(colorDraft) !== JSON.stringify(mergeTaskColorConfig(settings.taskColorConfig));

  // 修改某个配色项（每项仅一个底色，文字色固定不可配置）
  const setTaskColorField = (key: keyof TaskColorConfig, value: string) => {
    setColorDraft(prev => ({ ...prev, [key]: value }) as TaskColorConfig);
  };

  // 配色项 → 该底色在表格中的实际文字色（普通黑色；加急的确认图/设计/确认图修改为红色）
  const getPreviewTextColor = (key: keyof TaskColorConfig) => {
    const type = (key.startsWith('urgent')
      ? key.slice('urgent'.length, 'urgent'.length + 1).toLowerCase() + key.slice('urgent'.length + 1)
      : key) as TaskContentType;
    return isUrgentRestyleType(type) ? TASK_URGENT_TEXT_COLOR : TASK_TEXT_COLOR;
  };

  const handleSaveTaskColors = async () => {
    if (!isSuperAdmin) return;
    setColorSaving(true);
    try {
      const ok = await updateSettings({ taskColorConfig: colorDraft });
      // 保存成功后回读服务端归一化后的配置，确保主页面立即用上新配色
      if (ok) await refreshSettings();
    } finally {
      setColorSaving(false);
    }
  };

  // 恢复默认：草稿与系统设置一起改回默认配色（二次确认后立即生效）
  const handleResetTaskColors = () => {
    if (!isSuperAdmin) return;
    setConfirmDialog({
      title: '恢复默认配色',
      tone: 'amber',
      warning: '将把全部任务内容配色改回系统默认值',
      message: '「未勾选任务内容 / 确认图 / 设计 / 确认图修改 / 设计变更 / 既制审图 / 暂停取消」以及三个加急配色的底色都会恢复为系统默认值，并立即保存生效。是否继续？',
      confirmText: '确认恢复',
      onConfirm: async () => {
        const defaults = mergeTaskColorConfig(DEFAULT_TASK_COLOR_CONFIG);
        setColorDraft(defaults);
        setColorSaving(true);
        try {
          const ok = await updateSettings({ taskColorConfig: defaults });
          if (ok) {
            await refreshSettings();
            addToast('任务内容配色已恢复默认', 'success');
          }
        } finally {
          setColorSaving(false);
        }
      },
    });
  };
  const [accessSettingsLoaded, setAccessSettingsLoaded] = useState(false);
  const [loginLogs, setLoginLogs] = useState<LoginLog[]>([]);
  // IP 黑名单：配置数据 / 添加输入框 / 备注 / 提交中
  const [ipBlacklist, setIpBlacklist] = useState<IpBlacklistData>({ enabled: false, entries: [] });
  const [ipInput, setIpInput] = useState('');
  const [ipNote, setIpNote] = useState('');
  const [ipSaving, setIpSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<'data' | 'maintenance' | 'login' | 'logs' | 'plan'>('data');
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [importMonth, setImportMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [importConfirmed, setImportConfirmed] = useState(false);
  const [stExportMonth, setStExportMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [stExportDeliveryMonth, setStExportDeliveryMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [stExportMonthMode, setStExportMonthMode] = useState<'production' | 'delivery'>('production');
  const [whExportMonth, setWhExportMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [maintenanceStatus, setMaintenanceStatus] = useState<MaintenanceStatus | null>(null);
  const [maintenanceSettings, setMaintenanceSettings] = useState<MaintenanceSettings>(defaultMaintenanceSettings);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [maintenanceSaving, setMaintenanceSaving] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  // 操作日志保留条数草稿（日志管理）：输入后点保存才提交，避免逐字触发保存
  const [logRetentionDraft, setLogRetentionDraft] = useState('5000');
  const [logRetentionSaving, setLogRetentionSaving] = useState(false);
  const [showCleanupTasksModal, setShowCleanupTasksModal] = useState(false);
  const [cleanupTasksMode, setCleanupTasksMode] = useState<'single' | 'batch' | 'all'>('single');
  const [cleanupTasksMonth, setCleanupTasksMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [cleanupTasksBeforeMonth, setCleanupTasksBeforeMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [cleanupTasksProcessing, setCleanupTasksProcessing] = useState(false);
  const [showCleanupStModal, setShowCleanupStModal] = useState(false);
  const [cleanupStMode, setCleanupStMode] = useState<'production' | 'delivery' | 'all'>('production');
  const [cleanupStBeforeMonth, setCleanupStBeforeMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [cleanupStProcessing, setCleanupStProcessing] = useState(false);
  // 清理弹窗内嵌二次确认步骤（替代原生 confirm）
  const [cleanupTasksConfirming, setCleanupTasksConfirming] = useState(false);
  const [cleanupStConfirming, setCleanupStConfirming] = useState(false);
  // 通用二次确认弹窗（替代原生 window.confirm）
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [confirmRunning, setConfirmRunning] = useState(false);
  // 焊枪编号台账导出：分类摘要 / 已选分类 / 加载中
  const [gunLedgerCats, setGunLedgerCats] = useState<{ category: string; tables: number; rows: number }[]>([]);
  const [gunExportCats, setGunExportCats] = useState<string[]>([]);
  const [gunCatsLoading, setGunCatsLoading] = useState(false);
  // 焊枪编号台账导入：待导入文件 / 目标分类（现有）/ 是否导入到新分类 / 新分类名 / 已确认
  const [gunPendingFile, setGunPendingFile] = useState<File | null>(null);
  const [gunImportCategory, setGunImportCategory] = useState('');
  const [gunImportAsNew, setGunImportAsNew] = useState(false);
  const [gunImportNewName, setGunImportNewName] = useState('');
  const [gunImportConfirmed, setGunImportConfirmed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gunFileInputRef = useRef<HTMLInputElement>(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  const isOffline = !isOnline;
  const isSuperAdmin = user?.role === 'superadmin';
  const authHeader = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

  const canViewSystemSettings = (() => {
    if (isSuperAdmin) return true;
    if (!accessSettingsLoaded || !accessSettings.enabled) return false;
    if (!user) return false;
    if (user.role === 'admin' && accessSettings.allowAdmins) return true;
    return false;
  })();

  const addToast = (message: string, type: 'success' | 'error') => {
    const id = Date.now();
    setToasts(prev => [...prev, { message, type, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  // 执行通用确认弹窗的动作：执行期间禁用按钮并显示加载，结束后关闭弹窗
  const runConfirmDialog = async () => {
    if (!confirmDialog || confirmRunning) return;
    setConfirmRunning(true);
    try {
      await confirmDialog.onConfirm();
      setConfirmDialog(null);
    } finally {
      setConfirmRunning(false);
    }
  };

  // 网络错误（断网/服务不可达）时标记离线，触发页面禁止编辑
  const markOfflineIfNetworkError = useCallback((err: any) => {
    if (!navigator.onLine || err?.code === 'ERR_NETWORK' || err?.message === 'Network Error') {
      setIsOnline(false);
      return true;
    }
    return false;
  }, []);

  // 离线时拦截一切写操作（修改/导入/维护等）
  const guardOffline = () => {
    if (!isOffline) return false;
    addToast('当前离线，禁止编辑', 'error');
    return true;
  };

  const fetchAccessSettings = useCallback(async () => {
    try {
      // 必须走 axiosInstance 携带 Authorization：接口需登录访问
      const res = await axiosInstance.get('/settings/system-settings');
      setAccessSettings(res.data);
    } catch (err) {
      markOfflineIfNetworkError(err);
      addToast('无法加载权限设置', 'error');
    } finally {
      setAccessSettingsLoaded(true);
    }
  }, [markOfflineIfNetworkError]);

  const fetchSettings = useCallback(async () => {
    await refreshSettings();
    setSettingsLoaded(true);
  }, [refreshSettings]);

  const fetchLoginLogs = useCallback(async () => {
    if (!isSuperAdmin || !token) return;
    try {
      const res = await axios.get('/api/system/admin-login-logs', authHeader);
      setLoginLogs(res.data);
    } catch (err) {
      markOfflineIfNetworkError(err);
      addToast('无法加载登录历史', 'error');
    }
  }, [isSuperAdmin, token, markOfflineIfNetworkError]);

  // IP 黑名单：加载 / 启停 / 批量添加 / 删除
  const fetchIpBlacklist = useCallback(async () => {
    if (!isSuperAdmin || !token) return;
    try {
      const res = await axios.get('/api/system/ip-blacklist', authHeader);
      setIpBlacklist({ enabled: Boolean(res.data?.enabled), entries: Array.isArray(res.data?.entries) ? res.data.entries : [] });
    } catch (err) {
      markOfflineIfNetworkError(err);
      addToast('无法加载 IP 黑名单', 'error');
    }
  }, [isSuperAdmin, token, markOfflineIfNetworkError]);

  const toggleIpBlacklist = async (enabled: boolean) => {
    if (guardOffline()) return;
    setIpBlacklist(prev => ({ ...prev, enabled }));
    try {
      const res = await axios.put('/api/system/ip-blacklist', { enabled }, authHeader);
      setIpBlacklist({ enabled: Boolean(res.data?.enabled), entries: Array.isArray(res.data?.entries) ? res.data.entries : [] });
      addToast(enabled ? 'IP 黑名单已启用，拦截立即生效' : 'IP 黑名单已停用', 'success');
    } catch {
      setIpBlacklist(prev => ({ ...prev, enabled: !enabled }));
      addToast('切换 IP 黑名单状态失败', 'error');
    }
  };

  const handleAddIpBlacklist = async () => {
    if (guardOffline()) return;
    const input = ipInput.trim();
    if (!input) {
      addToast('请输入要拉黑的 IP', 'error');
      return;
    }
    setIpSaving(true);
    try {
      const res = await axios.post('/api/system/ip-blacklist', { ip: input, note: ipNote.trim() }, authHeader);
      const added: IpBlacklistEntry[] = res.data?.added || [];
      const failed: { ip: string; reason: string }[] = res.data?.failed || [];
      if (Array.isArray(res.data?.entries)) {
        setIpBlacklist(prev => ({ ...prev, entries: res.data.entries }));
      }
      if (added.length > 0) {
        addToast(`已加入黑名单 ${added.length} 条规则`, 'success');
        setIpInput('');
        setIpNote('');
      }
      if (failed.length > 0) {
        addToast(`${failed.length} 条规则无效：${failed[0].ip}（${failed[0].reason}）`, 'error');
      }
      if (added.length === 0 && failed.length === 0) {
        addToast('规则已存在，未重复添加', 'success');
      }
    } catch (err: any) {
      addToast(err.response?.data?.message || '添加黑名单失败', 'error');
    } finally {
      setIpSaving(false);
    }
  };

  const handleDeleteIpBlacklist = async (entry: IpBlacklistEntry) => {
    if (guardOffline()) return;
    try {
      const res = await axios.delete(`/api/system/ip-blacklist/${entry.id}`, authHeader);
      setIpBlacklist(prev => ({ ...prev, entries: Array.isArray(res.data?.entries) ? res.data.entries : [] }));
      addToast(`已解除封禁：${entry.ip}`, 'success');
    } catch {
      addToast('删除黑名单规则失败', 'error');
      fetchIpBlacklist();
    }
  };

  // IP 规则类型徽章：精确 IP / 网段 CIDR / 通配符
  const getIpRuleType = (ip: string): { label: string; className: string } => {
    if (ip.includes('/')) return { label: '网段 CIDR', className: 'bg-purple-50 text-purple-600 border-purple-100' };
    if (ip.includes('*')) return { label: '通配符', className: 'bg-amber-50 text-amber-600 border-amber-100' };
    return { label: '精确 IP', className: 'bg-blue-50 text-blue-600 border-blue-100' };
  };

  // 最近登录失败的 IP（去重、排除已在黑名单中的），作为快捷填入候选
  const recentFailedIps = (() => {
    const banned = new Set(ipBlacklist.entries.map(e => e.ip));
    const seen = new Set<string>();
    const result: string[] = [];
    for (const log of loginLogs) {
      const ip = (log.ip || '').trim();
      if (!ip || banned.has(ip) || seen.has(ip)) continue;
      seen.add(ip);
      result.push(ip);
      if (result.length >= 5) break;
    }
    return result;
  })();

  // 获取焊枪编号台账分类摘要（无权限时静默置空，卡片显示空态）
  const fetchGunLedgerCats = useCallback(async () => {
    if (!token) return;
    setGunCatsLoading(true);
    try {
      const res = await axios.get('/api/gun-ledger/summary', authHeader);
      const list: { category: string; tables: number; rows: number }[] = res.data;
      setGunLedgerCats(list);
      // 已选分类以最新摘要为准；首次加载默认全选
      setGunExportCats(prev => {
        const valid = prev.filter(name => list.some(item => item.category === name));
        return valid.length ? valid : list.map(item => item.category);
      });
    } catch (err) {
      markOfflineIfNetworkError(err);
      setGunLedgerCats([]);
      setGunExportCats([]);
    } finally {
      setGunCatsLoading(false);
    }
  }, [token, markOfflineIfNetworkError]);



  const fetchMaintenanceStatus = useCallback(async () => {
    if (!isSuperAdmin || !token) return;
    setMaintenanceLoading(true);
    try {
      const res = await axios.get('/api/system/maintenance', authHeader);
      setMaintenanceStatus(res.data);
      setMaintenanceSettings({ ...defaultMaintenanceSettings, ...res.data.settings });
    } catch (err) {
      markOfflineIfNetworkError(err);
      addToast('数据库维护状态加载失败', 'error');
    } finally {
      setMaintenanceLoading(false);
    }
  }, [isSuperAdmin, token, markOfflineIfNetworkError]);

  useEffect(() => {
    const init = async () => {
      await Promise.all([fetchSettings(), fetchAccessSettings()]);
      await Promise.all([fetchLoginLogs(), fetchIpBlacklist(), fetchMaintenanceStatus(), fetchGunLedgerCats()]);
      setLoading(false);
    };
    init();
  }, [fetchSettings, fetchAccessSettings, fetchLoginLogs, fetchIpBlacklist, fetchMaintenanceStatus, fetchGunLedgerCats]);

  // 日志管理：设置加载完成后同步「操作日志保留条数」草稿
  useEffect(() => {
    if (!settingsLoaded) return;
    setLogRetentionDraft(String(settings.auditLogMaxRows));
  }, [settingsLoaded, settings.auditLogMaxRows]);

  // 网络恢复后自动重新加载数据
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      fetchAccessSettings();
      fetchLoginLogs();
      fetchIpBlacklist();
      fetchMaintenanceStatus();
      fetchGunLedgerCats();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [fetchAccessSettings, fetchLoginLogs, fetchIpBlacklist, fetchMaintenanceStatus, fetchGunLedgerCats]);

  // 后端服务停止/恢复（navigator.onLine 感知不到本机服务停止，由 axiosInstance 拦截器广播）
  useEffect(() => {
    const handleServerUnreachable = () => setIsOnline(false);
    const handleServerOnline = () => {
      setIsOnline(true);
      fetchAccessSettings();
      fetchLoginLogs();
      fetchIpBlacklist();
      fetchMaintenanceStatus();
      fetchGunLedgerCats();
    };
    window.addEventListener('server-unreachable', handleServerUnreachable);
    window.addEventListener('server-online', handleServerOnline);
    return () => {
      window.removeEventListener('server-unreachable', handleServerUnreachable);
      window.removeEventListener('server-online', handleServerOnline);
    };
  }, [fetchAccessSettings, fetchLoginLogs, fetchIpBlacklist, fetchMaintenanceStatus, fetchGunLedgerCats]);

  // 离线期间每 5 秒轻量探测后端是否恢复（成功时拦截器自动广播 server-online）
  useEffect(() => {
    if (!isOffline) return;
    const timer = setInterval(() => {
      axiosInstance.get('/auth/validate').catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [isOffline]);

  useEffect(() => {
    if (!isSuperAdmin && (activeTab === 'login' || activeTab === 'logs' || activeTab === 'maintenance' || activeTab === 'plan')) {
      setActiveTab('data');
    }
  }, [isSuperAdmin, activeTab]);

  const updateSettings = async (next: Partial<SystemSettingsData>) => {
    if (guardOffline()) return false;
    const updated = { ...settings, ...next };
    if (next.allowUserDesignPlanColorMark !== undefined) {
      updated.allowUserEditOwnTaskColor = next.allowUserDesignPlanColorMark;
    }
    setSettings(updated);
    if (!isSuperAdmin) return false;

    try {
      await axios.put('/api/system/settings', updated, authHeader);
      addToast('系统设置已保存', 'success');
      return true;
    } catch {
      addToast('保存系统设置失败', 'error');
      fetchSettings();
      return false;
    }
  };

  // 保存操作日志保留条数（日志管理）：校验 100~100000 的整数后提交
  const handleSaveLogRetention = async () => {
    const rows = Number(logRetentionDraft);
    if (!Number.isInteger(rows) || rows < 100 || rows > 100000) {
      addToast('操作日志保留条数需为 100 ~ 100000 之间的整数', 'error');
      return;
    }
    setLogRetentionSaving(true);
    try {
      await updateSettings({ auditLogMaxRows: rows });
    } finally {
      setLogRetentionSaving(false);
    }
  };

  const updateAccessSettings = async (next: Partial<typeof defaultAccessSettings>) => {
    if (guardOffline()) return;
    const updated = { ...accessSettings, ...next };
    if (next.enabled === false) {
      updated.allowAdmins = false;
      updated.allowViewers = false;
    }
    if (next.enabled === true) {
      updated.allowAdmins = true;
      updated.allowViewers = false;
    }
    updated.allowViewers = false;
    setAccessSettings(updated);
    if (!isSuperAdmin || !token) return;

    try {
      await axios.put('/api/settings/system-settings', updated, authHeader);
      addToast('权限设置已保存', 'success');
    } catch {
      addToast('保存权限设置失败', 'error');
      fetchAccessSettings();
    }
  };

  const handleTaskExport = async () => {
    if (!token) return;
    setExporting(true);
    try {
      const res = await axios.get('/api/system/export-xls', {
        ...authHeader,
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `obara-tasks-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.xls`;
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

  const handleStatusTrackingExport = async () => {
    if (!token) return;
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (stExportMonthMode === 'production') {
        params.append('month', stExportMonth);
      } else {
        params.append('deliveryMonth', stExportDeliveryMonth);
      }
      const res = await axios.get(`/api/status-tracking/export?${params.toString()}`, {
        ...authHeader,
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = format(new Date(), 'yyyyMMddHHmmss');
      const monthVal = stExportMonthMode === 'production' ? stExportMonth : stExportDeliveryMonth;
      link.download = `status-tracking-${monthVal}-${timestamp}.xls`;
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

  const handleWorkHoursExport = async () => {
    if (!token) return;
    setExporting(true);
    try {
      const res = await axios.get(`/api/work-hours/export?month=${whExportMonth}`, {
        ...authHeader,
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `work-hours-${whExportMonth}-${format(new Date(), 'yyyyMMddHHmmss')}.xls`;
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

  // 焊枪编号台账导出：单分类下载 xls；多分类打包 zip（每分类一个独立 xls）
  const handleGunLedgerExport = async () => {
    if (!token) return;
    if (!gunExportCats.length) {
      addToast('请至少选择一个分类', 'error');
      return;
    }
    setExporting(true);
    try {
      const res = await axios.get('/api/gun-ledger/export', {
        ...authHeader,
        params: { categories: gunExportCats.join(',') },
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = format(new Date(), 'yyyyMMddHHmmss');
      link.download = gunExportCats.length === 1
        ? `gun-ledger-${gunExportCats[0]}-${timestamp}.xls`
        : `gun-ledger-export-${timestamp}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      addToast('导出成功', 'success');
    } catch (err: any) {
      markOfflineIfNetworkError(err);
      if (err.response?.status === 404) {
        addToast('没有可导出的数据', 'error');
      } else if (err.response?.status === 403) {
        addToast('没有焊枪编号台账的访问权限', 'error');
      } else {
        addToast('导出失败', 'error');
      }
    } finally {
      setExporting(false);
    }
  };

  const toggleGunExportCat = (name: string) => {
    setGunExportCats(prev => (prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]));
  };

  // 选择导入文件：记录待导入文件，默认目标分类取第一个现有分类
  const handleGunLedgerImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    setGunPendingFile(file);
    setGunImportConfirmed(false);
    setGunImportAsNew(false);
    setGunImportNewName('');
    setGunImportCategory(prev => prev || gunLedgerCats[0]?.category || '');
    if (gunFileInputRef.current) gunFileInputRef.current.value = '';
  };

  const cancelGunLedgerImport = () => {
    setGunPendingFile(null);
    setGunImportConfirmed(false);
    setGunImportAsNew(false);
    setGunImportNewName('');
  };

  // 确认导入：上传工作簿，每个工作表成为目标分类下的一张表（覆盖目标分类）
  const confirmGunLedgerImport = async () => {
    if (guardOffline()) return;
    if (!gunPendingFile || !token) return;

    const targetCategory = (gunImportAsNew ? gunImportNewName : gunImportCategory).trim();
    if (!targetCategory) {
      addToast(gunImportAsNew ? '请填写新分类名称' : '请选择目标分类', 'error');
      return;
    }
    if (targetCategory.length > 30 || /[/\\]/.test(targetCategory)) {
      addToast('分类名需为 1-30 字符，且不能包含 / 与 \\', 'error');
      return;
    }
    if (!gunImportConfirmed) {
      addToast('请先确认导入格式与系统导出格式一致，并知悉导入会覆盖目标分类', 'error');
      return;
    }

    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', gunPendingFile);
      formData.append('category', targetCategory);
      const res = await axios.post('/api/gun-ledger/import', formData, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
      });
      const warnings = res.data.warnings?.length ? `；提示：${res.data.warnings.join('；')}` : '';
      addToast(`导入成功：${res.data.isNewCategory ? '新建分类' : '覆盖分类'}「${res.data.category}」，${res.data.importedTables} 张表 / ${res.data.importedRows} 行${warnings}`, 'success');
      cancelGunLedgerImport();
      fetchGunLedgerCats();
    } catch (err: any) {
      addToast(err.response?.data?.message || '导入失败', 'error');
    } finally {
      setImporting(false);
    }
  };

  const updateMaintenanceField = <K extends keyof MaintenanceSettings>(key: K, value: MaintenanceSettings[K]) => {
    setMaintenanceSettings(prev => ({ ...prev, [key]: value }));
  };

  // 每日执行时间：最多两个时间点，空值自动剔除
  const updateScheduleTime = (index: number, value: string) => {
    setMaintenanceSettings(prev => {
      const next = [prev.scheduleTimes?.[0] || '', prev.scheduleTimes?.[1] || ''];
      next[index] = value;
      return { ...prev, scheduleTimes: next.filter(Boolean).slice(0, 2) };
    });
  };

  const saveMaintenanceSettings = async () => {
    if (guardOffline()) return;
    if (!token) return;
    if (!maintenanceSettings.scheduleTimes || maintenanceSettings.scheduleTimes.length === 0) {
      addToast('请至少设置一个每日执行时间', 'error');
      return;
    }
    setMaintenanceSaving(true);
    try {
      const res = await axios.put('/api/system/maintenance', maintenanceSettings, authHeader);
      setMaintenanceStatus(res.data);
      setMaintenanceSettings({ ...defaultMaintenanceSettings, ...res.data.settings });
      addToast('数据库维护设置已保存', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.message || '数据库维护设置保存失败', 'error');
    } finally {
      setMaintenanceSaving(false);
    }
  };

  // 执行维护操作并刷新状态，返回接口 JSON 供调用方展示具体结果
  const runMaintenanceAction = async (url: string, body: any = {}) => {
    if (guardOffline()) return null;
    if (!token) return null;
    setMaintenanceLoading(true);
    try {
      const res = await axios.post(url, body, authHeader);
      await fetchMaintenanceStatus();
      return res.data;
    } catch (err: any) {
      addToast(err.response?.data?.message || '操作失败', 'error');
      return null;
    } finally {
      setMaintenanceLoading(false);
    }
  };

  const handleBackupNow = async () => {
    const data = await runMaintenanceAction('/api/system/maintenance/backup');
    if (!data) return;
    addToast(`数据库备份已完成：${data.backup.fileName}（${formatFileSize(data.backup.size)}）`, 'success');
  };

  const handleManualGunLedgerExport = async () => {
    const data = await runMaintenanceAction('/api/system/maintenance/export-gun-ledger');
    if (data) addToast(`编号台账已导出：${data.gunLedgerExport.fileName}（共 ${data.gunLedgerExport.categories} 个分类，已打包为 ZIP，每个分类一个 xls）`, 'success');
  };

  const handleCleanupBackupsNow = () => {
    if (guardOffline()) return;
    setConfirmDialog({
      title: '清理过期文件',
      tone: 'amber',
      warning: '将按保留天数删除过期文件',
      message: '将按各项保留天数，清理数据库备份、任务表格导出、编号台账导出、关机备份四个目录中的过期文件。是否继续？',
      confirmText: '确认清理',
      onConfirm: async () => {
        const data = await runMaintenanceAction('/api/system/maintenance/cleanup-backups');
        if (data) addToast(`过期文件清理完成，共删除 ${data.cleanup.removedCount} 个文件`, 'success');
      },
    });
  };

  // 压缩数据库：把删除数据后残留在文件里的空闲页真正归还给操作系统。
  // 不压缩的话，清理任务数据后「数据库占用」不会下降，容易被误判成没清干净。
  const handleCompactDatabase = () => {
    if (guardOffline()) return;
    const reclaimable = maintenanceStatus?.database?.reclaimableBytes || 0;
    setConfirmDialog({
      title: '压缩数据库',
      tone: 'amber',
      warning: '压缩期间数据库会被独占重建',
      message: `将执行 WAL 截断与 VACUUM，把已删除数据占用的空闲空间归还给操作系统${reclaimable > 0 ? `（预计可回收 ${formatFileSize(reclaimable)}）` : ''}。压缩通常只需数秒，期间请避免其他人执行批量导入或清理操作。是否继续？`,
      confirmText: '开始压缩',
      onConfirm: async () => {
        const data = await runMaintenanceAction('/api/system/maintenance/compact');
        if (!data) return;
        const { freedBytes = 0, removedOrphans = 0, after } = data.compaction || {};
        const parts = [`已回收 ${formatFileSize(freedBytes)}`];
        if (removedOrphans > 0) parts.push(`清理残留条目 ${removedOrphans} 条`);
        if (after) parts.push(`当前体积 ${formatFileSize(after.totalDiskSize)}`);
        addToast(`数据库压缩完成：${parts.join('，')}`, 'success');
      },
    });
  };

  const yearlySkipReasonText: Record<string, string> = {
    disabled: '年度清理未启用',
    'outside-cleanup-month': '当前不在检测月份',
    'outside-check-window': '已超过月初检测窗口',
    'already-completed': '本年度清理已完成'
  };

  const handleYearlyCleanupNow = () => {
    if (guardOffline()) return;
    setConfirmDialog({
      title: '强制执行年度清理',
      tone: 'red',
      warning: '此操作不可恢复',
      message: '将忽略检测月份、月初检测窗口及"每年仅执行一次"的限制，立即按当前保留年数执行清理检测：早于临界年份的任务工作表会先永久归档为 JSON，再从数据库删除。是否继续？',
      confirmText: '确认执行',
      onConfirm: async () => {
        const data = await runMaintenanceAction('/api/system/maintenance/yearly-cleanup', { force: true });
        if (!data) return;
        const result = data.yearlyCleanup;
        if (result.skipped) {
          addToast(`年度清理检测已跳过：${yearlySkipReasonText[result.reason || ''] || result.reason}`, 'success');
        } else if (!result.removedSheets) {
          addToast('年度清理检测完成：没有需要归档清理的任务数据', 'success');
        } else {
          addToast(`年度清理完成：归档并删除 ${result.removedSheets} 个工作表（${result.removedTaskItems || 0} 条任务记录）`, 'success');
        }
      },
    });
  };

  const handleManualTaskExport = async () => {
    const data = await runMaintenanceAction('/api/system/maintenance/export-tasks');
    if (data) addToast(`任务表格已导出：${data.taskExport.taskSheets} 个工作表、${data.taskExport.taskItems} 条任务记录`, 'success');
  };

  const handleClearLogs = () => {
    if (guardOffline()) return;
    if (!token) return;
    setConfirmDialog({
      title: '清空日志',
      tone: 'red',
      warning: '此操作不可恢复',
      message: '确定要清空所有登录日志和操作日志吗？清空后无法恢复，请谨慎操作。',
      confirmText: '确认清空',
      onConfirm: async () => {
        setMaintenanceLoading(true);
        try {
          const res = await axios.post('/api/system/maintenance/clear-logs', {}, authHeader);
          addToast(`已清空登录日志 ${res.data.loginLogsCount} 条、操作日志 ${res.data.auditLogsCount} 条`, 'success');
          await fetchLoginLogs();
        } catch (err: any) {
          addToast(err.response?.data?.message || '清空日志失败', 'error');
        } finally {
          setMaintenanceLoading(false);
        }
      },
    });
  };

  // 清理任务数据：由弹窗内嵌二次确认步骤触发（确认后才会调用）
  const handleCleanupTasks = async () => {
    if (guardOffline()) return;
    if (!token) return;
    let payload: any = {};

    if (cleanupTasksMode === 'all') {
      payload = { all: true };
    } else if (cleanupTasksMode === 'single') {
      const [year, month] = cleanupTasksMonth.split('-').map(Number);
      payload = { year, month };
    } else {
      const [year, month] = cleanupTasksBeforeMonth.split('-').map(Number);
      payload = { beforeYear: year, beforeMonth: month };
    }

    setCleanupTasksProcessing(true);
    try {
      const res = await axios.post('/api/system/maintenance/cleanup-tasks', payload, authHeader);
      const { removedSheets = 0, removedItems = 0, remainingSheets = 0, remainingItems = 0, freedBytes = 0 } = res.data || {};

      // 服务端已删库，本地离线缓存若不同步作废，离线状态下会继续渲染旧任务
      clearOfflineSheetsCache();

      if (removedSheets === 0) {
        addToast('所选范围没有任务数据，未做任何删除', 'success');
      } else {
        const freedText = freedBytes > 0 ? `，已回收 ${formatFileSize(freedBytes)} 磁盘空间` : '';
        addToast(
          `已清理 ${removedSheets} 张工作表、${removedItems} 条任务记录${freedText}；剩余 ${remainingSheets} 张工作表、${remainingItems} 条记录`,
          'success'
        );
      }

      setShowCleanupTasksModal(false);
      setCleanupTasksConfirming(false);
      // 刷新数据库占用（压缩后体积会变化）
      fetchMaintenanceStatus();
    } catch (err: any) {
      addToast(err.response?.data?.message || '清理任务数据失败', 'error');
    } finally {
      setCleanupTasksProcessing(false);
    }
  };

  // 清理状态跟踪数据：由弹窗内嵌二次确认步骤触发（确认后才会调用）
  const handleCleanupStatusTracking = async () => {
    if (guardOffline()) return;
    if (!token) return;
    setCleanupStProcessing(true);
    try {
      const payload: any = cleanupStMode === 'all'
        ? { all: true }
        : (() => {
            const [year, month] = cleanupStBeforeMonth.split('-').map(Number);
            return { beforeYear: year, beforeMonth: month, mode: cleanupStMode };
          })();

      const res = await axios.post('/api/status-tracking/cleanup', payload, authHeader);
      const { removedCount = 0, remainingCount = 0 } = res.data || {};

      // 状态跟踪页也会把列表写进 localStorage，清空后要一并作废，
      // 否则离线时那个页面还会用缓存把已删除的记录渲染出来。
      try { localStorage.removeItem('statusTrackingItems'); } catch { /* ignore */ }

      if (removedCount === 0) {
        addToast('所选范围没有状态跟踪数据，未做任何删除', 'success');
      } else {
        addToast(`已清理 ${removedCount} 条状态跟踪数据，剩余 ${remainingCount} 条`, 'success');
      }

      setShowCleanupStModal(false);
      setCleanupStConfirming(false);
    } catch (err: any) {
      addToast(err.response?.data?.message || '清理状态跟踪数据失败', 'error');
    } finally {
      setCleanupStProcessing(false);
    }
  };

  const formatFileSize = (size: number) => {
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`;
    return `${(size / 1024).toFixed(1)} KB`;
  };

  // 年度清理历史按年份倒序，取最近一次执行记录
  const latestYearlyHistory = Object.entries(maintenanceSettings.yearlyCleanupHistory || {})
    .sort((a, b) => b[0].localeCompare(a[0]))[0]?.[1] as YearlyCleanupRecord | undefined;

  const handleTaskImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    setPendingImportFile(file);
    setImportConfirmed(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const cancelTaskImport = () => {
    setPendingImportFile(null);
    setImportConfirmed(false);
  };

  const confirmTaskImport = async () => {
    if (guardOffline()) return;
    if (!pendingImportFile || !token) return;
    if (!importMonth) {
      addToast('请选择要覆盖导入的月份', 'error');
      return;
    }
    if (!importConfirmed) {
      addToast('请先确认导入格式与导出格式一致', 'error');
      return;
    }

    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', pendingImportFile);
      formData.append('month', importMonth);
      const res = await axios.post('/api/system/import-xls', formData, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
      });
      const elapsedSeconds = ((res.data.elapsedMs || 0) / 1000).toFixed(1);
      const skipped = res.data.skippedDesigners?.length
        ? `，跳过新增设计员：${res.data.skippedDesigners.join('、')}`
        : '';
      addToast(`导入成功：覆盖 ${importMonth}，${res.data.importedRows} 条记录，耗时 ${elapsedSeconds}s${skipped}`, 'success');
      cancelTaskImport();
    } catch (err: any) {
      const skipped = err.response?.data?.skippedDesigners?.length
        ? `；已跳过新增设计员：${err.response.data.skippedDesigners.join('、')}`
        : '';
      addToast(`${err.response?.data?.message || '导入失败'}${skipped}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  if (loading || !settingsLoaded || !accessSettingsLoaded) {
    return <LoadingScreen text="正在加载系统设置" skeleton="systemsettings" />;
  }

  if (!canViewSystemSettings) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <Shield className="text-gray-400 mb-4" size={48} />
        <div className="text-gray-600 font-medium mb-4">您没有权限访问系统设置</div>
        <Link to="/" className="text-blue-600 hover:text-blue-800 font-bold">返回工作台</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col">
      <div className="fixed top-12 right-4 z-50 flex flex-col gap-2">
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
          <h2 className="text-xl font-bold text-blue-600 flex items-center">
            <Settings className="text-blue-500 mr-2" size={24} />
            系统设置
          </h2>
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
        <div className="sticky top-12 z-40 bg-amber-500 text-white px-4 py-2 flex items-center justify-center gap-2 text-xs font-medium border-b border-amber-600 shadow-sm">
          <AlertCircle size={14} className="shrink-0" />
          <span>当前处于离线模式，网络恢复后将自动加载最新数据，此页面禁止编辑！</span>
        </div>
      )}

      <div className={`sticky ${isOffline ? 'top-[81px]' : 'top-[48px]'} z-30 bg-white border-b border-gray-200`}>
        <div className="max-w-5xl mx-auto px-8 flex space-x-1">
          <button
            onClick={() => setActiveTab('data')}
            className={`flex items-center gap-2 px-6 py-3 font-bold transition ${activeTab === 'data' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Database size={18} />
            数据管理
          </button>
          {isSuperAdmin && (
            <>
              <button
                onClick={() => setActiveTab('maintenance')}
                className={`flex items-center gap-2 px-6 py-3 font-bold transition ${activeTab === 'maintenance' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <Clock size={18} />
                数据库维护
              </button>
              <button
                onClick={() => setActiveTab('login')}
                className={`flex items-center gap-2 px-6 py-3 font-bold transition ${activeTab === 'login' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <Shield size={18} />
                登录管理
              </button>
              <button
                onClick={() => setActiveTab('logs')}
                className={`flex items-center gap-2 px-6 py-3 font-bold transition ${activeTab === 'logs' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <History size={18} />
                日志管理
              </button>
              <button
                onClick={() => setActiveTab('plan')}
                className={`flex items-center gap-2 px-6 py-3 font-bold transition ${activeTab === 'plan' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <CalendarDays size={18} />
                计划管理
              </button>
            </>
          )}
        </div>
      </div>

      {pendingImportFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-800 flex items-center">
                <Upload className="mr-2 text-blue-600" size={20} />
                确认导入任务数据
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                导入文件必须使用本系统导出的 xls 表格格式；本次只会覆盖你选择的一个月份。
              </p>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                导入前请确认勾选的月份正确。文件中其他月份不会导入；表格里的当日合计和月总工时不会导入，系统会重新计算。
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">选择要覆盖导入的月份</label>
                <input
                  type="month"
                  value={importMonth}
                  onChange={(e) => setImportMonth(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                />
              </div>
              <label className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={importConfirmed}
                  onChange={(e) => setImportConfirmed(e.target.checked)}
                  className="mt-1 h-4 w-4"
                />
                <span className="text-sm text-gray-700">
                  我确认导入文件格式与系统导出的 xls 一致，并且只覆盖所选月份的数据。
                </span>
              </label>
              <div className="text-xs text-gray-400">
                文件：{pendingImportFile.name}
              </div>
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={cancelTaskImport}
                disabled={importing}
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition disabled:opacity-60"
              >
                取消
              </button>
              <button
                onClick={confirmTaskImport}
                disabled={importing || !importConfirmed || !importMonth}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {importing && <RefreshCw size={16} className="animate-spin" />}
                覆盖导入
              </button>
            </div>
          </div>
        </div>
      )}

      {showCleanupTasksModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-800 flex items-center">
                  <Trash2 className="mr-2 text-red-600" size={20} />
                  清理任务数据
                </h3>
                <p className="text-sm text-gray-500 mt-1">选择清理方式，此操作不可恢复。</p>
              </div>
              <button onClick={() => { setShowCleanupTasksModal(false); setCleanupTasksConfirming(false); }} className="p-1 hover:bg-gray-100 rounded">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
                清理后的数据将无法恢复，请谨慎操作！建议先进行数据库备份。
              </div>
              <div className="flex items-center rounded-lg border border-gray-300 overflow-hidden">
                <button
                  type="button"
                  onClick={() => { setCleanupTasksMode('single'); setCleanupTasksConfirming(false); }}
                  className={`px-4 py-2 text-sm font-medium transition ${
                    cleanupTasksMode === 'single'
                      ? 'bg-red-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  按月份清理
                </button>
                <button
                  type="button"
                  onClick={() => { setCleanupTasksMode('batch'); setCleanupTasksConfirming(false); }}
                  className={`px-4 py-2 text-sm font-medium border-l border-gray-300 transition ${
                    cleanupTasksMode === 'batch'
                      ? 'bg-red-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  批量清理
                </button>
                <button
                  type="button"
                  onClick={() => { setCleanupTasksMode('all'); setCleanupTasksConfirming(false); }}
                  className={`px-4 py-2 text-sm font-medium border-l border-gray-300 transition ${
                    cleanupTasksMode === 'all'
                      ? 'bg-red-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  清空全部
                </button>
              </div>
              {cleanupTasksMode === 'all' ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 leading-relaxed">
                  将删除<span className="font-bold">所有月份、所有设计员</span>的任务数据（工作表与任务记录全部清空）。
                  {maintenanceStatus?.database && (
                    <span className="block mt-1 text-red-700/80">
                      当前共 {maintenanceStatus.database.tasksCount} 张工作表、{maintenanceStatus.database.taskItemsCount} 条任务记录。
                    </span>
                  )}
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    {cleanupTasksMode === 'single' ? '选择要清理的月份' : '选择清理时间点（此月份之前的数据将被清理）'}
                  </label>
                  <input
                    type="month"
                    value={cleanupTasksMode === 'single' ? cleanupTasksMonth : cleanupTasksBeforeMonth}
                    onChange={(e) => {
                      setCleanupTasksConfirming(false);
                      if (cleanupTasksMode === 'single') {
                        setCleanupTasksMonth(e.target.value);
                      } else {
                        setCleanupTasksBeforeMonth(e.target.value);
                      }
                    }}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-red-200 focus:border-red-400 outline-none"
                  />
                  <p className="mt-2 text-xs text-gray-400 leading-relaxed">
                    工作表按「任务日期所在月份」归档；若所选月份本身没有录过任务，清理结果为 0 张，属于正常情况。
                  </p>
                </div>
              )}
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex justify-end items-center gap-3">
              {cleanupTasksConfirming ? (
                <>
                  <span className="mr-auto flex items-center gap-1.5 text-xs font-bold text-red-600">
                    <AlertCircle size={14} />
                    确认{cleanupTasksMode === 'all'
                      ? '清空全部月份的'
                      : cleanupTasksMode === 'single'
                        ? `清理 ${cleanupTasksMonth} `
                        : `清理 ${cleanupTasksBeforeMonth} 之前的`}所有任务数据？此操作不可恢复！
                  </span>
                  <button
                    onClick={() => setCleanupTasksConfirming(false)}
                    disabled={cleanupTasksProcessing}
                    className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition disabled:opacity-60"
                  >
                    返回
                  </button>
                  <button
                    onClick={handleCleanupTasks}
                    disabled={cleanupTasksProcessing}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold transition disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {cleanupTasksProcessing && <RefreshCw size={16} className="animate-spin" />}
                    {cleanupTasksProcessing ? '清理中...' : '确认执行清理'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setShowCleanupTasksModal(false)}
                    disabled={cleanupTasksProcessing}
                    className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition disabled:opacity-60"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => setCleanupTasksConfirming(true)}
                    disabled={cleanupTasksProcessing || (cleanupTasksMode !== 'all' && !cleanupTasksMonth && !cleanupTasksBeforeMonth)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold transition disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    确认清理
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showCleanupStModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-800 flex items-center">
                  <Trash2 className="mr-2 text-purple-600" size={20} />
                  清理状态跟踪数据
                </h3>
                <p className="text-sm text-gray-500 mt-1">选择清理时间点和方式，此操作不可恢复。</p>
              </div>
              <button onClick={() => { setShowCleanupStModal(false); setCleanupStConfirming(false); }} className="p-1 hover:bg-gray-100 rounded">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-lg bg-purple-50 border border-purple-200 px-4 py-3 text-sm text-purple-800">
                清理后的数据将无法恢复，请谨慎操作！建议先导出需要保留的数据。
              </div>
              <div className="flex items-center rounded-lg border border-gray-300 overflow-hidden">
                <button
                  type="button"
                  onClick={() => { setCleanupStMode('production'); setCleanupStConfirming(false); }}
                  className={`px-4 py-2 text-sm font-medium transition ${
                    cleanupStMode === 'production'
                      ? 'bg-purple-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  按添加时间月份
                </button>
                <button
                  type="button"
                  onClick={() => { setCleanupStMode('delivery'); setCleanupStConfirming(false); }}
                  className={`px-4 py-2 text-sm font-medium border-l border-gray-300 transition ${
                    cleanupStMode === 'delivery'
                      ? 'bg-purple-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  按纳期月份
                </button>
                <button
                  type="button"
                  onClick={() => { setCleanupStMode('all'); setCleanupStConfirming(false); }}
                  className={`px-4 py-2 text-sm font-medium border-l border-gray-300 transition ${
                    cleanupStMode === 'all'
                      ? 'bg-purple-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  清空全部
                </button>
              </div>
              {cleanupStMode === 'all' ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 leading-relaxed">
                  将删除<span className="font-bold">全部状态跟踪记录</span>（不限添加时间、不限纳期，含已关闭的历史记录）。
                  <span className="block mt-1 text-red-700/80">任务数据不受影响；如需清理任务，请使用上方「清理任务数据」。</span>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    选择清理时间点（此月份之前的数据将被清理）
                  </label>
                  <input
                    type="month"
                    value={cleanupStBeforeMonth}
                    onChange={(e) => { setCleanupStBeforeMonth(e.target.value); setCleanupStConfirming(false); }}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-200 focus:border-purple-400 outline-none"
                  />
                </div>
              )}
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex justify-end items-center gap-3">
              {cleanupStConfirming ? (
                <>
                  <span className="mr-auto flex items-center gap-1.5 text-xs font-bold text-purple-700">
                    <AlertCircle size={14} />
                    {cleanupStMode === 'all'
                      ? '确认清空全部状态跟踪数据？此操作不可恢复！'
                      : `确认清理 ${cleanupStBeforeMonth} 之前的状态跟踪数据（按${cleanupStMode === 'production' ? '添加时间' : '纳期'}月份）？此操作不可恢复！`}
                  </span>
                  <button
                    onClick={() => setCleanupStConfirming(false)}
                    disabled={cleanupStProcessing}
                    className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition disabled:opacity-60"
                  >
                    返回
                  </button>
                  <button
                    onClick={handleCleanupStatusTracking}
                    disabled={cleanupStProcessing}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-bold transition disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {cleanupStProcessing && <RefreshCw size={16} className="animate-spin" />}
                    {cleanupStProcessing ? '清理中...' : '确认执行清理'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setShowCleanupStModal(false)}
                    disabled={cleanupStProcessing}
                    className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition disabled:opacity-60"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => setCleanupStConfirming(true)}
                    disabled={cleanupStProcessing || (cleanupStMode !== 'all' && !cleanupStBeforeMonth)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-bold transition disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    确认清理
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 通用二次确认弹窗（替代原生 window.confirm，与系统其他确认弹窗风格一致） */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !confirmRunning && setConfirmDialog(null)}
          />
          <div className="relative bg-white rounded-xl shadow-2xl w-[440px] max-w-[92vw] border border-gray-200 overflow-hidden">
            <div className={`px-5 py-4 bg-gradient-to-r ${confirmDialog.tone === 'red' ? 'from-red-500 to-red-600' : 'from-amber-500 to-amber-600'} text-white flex items-center justify-between`}>
              <div className="flex items-center gap-2 font-bold text-lg">
                <AlertCircle size={20} />
                {confirmDialog.title}
              </div>
              <button
                className="p-1 rounded hover:bg-white/20 transition disabled:opacity-50"
                onClick={() => setConfirmDialog(null)}
                disabled={confirmRunning}
                title="关闭"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className={`flex items-start gap-3 p-3 rounded-lg border ${confirmDialog.tone === 'red' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                <AlertCircle size={22} className={`${confirmDialog.tone === 'red' ? 'text-red-500' : 'text-amber-500'} shrink-0 mt-0.5`} />
                <div className="text-sm text-gray-700 leading-relaxed">
                  <div className={`font-bold mb-1 ${confirmDialog.tone === 'red' ? 'text-red-700' : 'text-amber-700'}`}>{confirmDialog.warning}</div>
                  <div>{confirmDialog.message}</div>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition disabled:opacity-50"
                onClick={() => setConfirmDialog(null)}
                disabled={confirmRunning}
              >
                取消
              </button>
              <button
                className={`px-5 py-2 rounded-lg text-white font-bold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 ${confirmDialog.tone === 'red' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'}`}
                onClick={runConfirmDialog}
                disabled={confirmRunning}
              >
                {confirmRunning && <RefreshCw size={14} className="animate-spin" />}
                {confirmRunning ? '执行中...' : confirmDialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      <main className={`flex-1 p-8 max-w-5xl mx-auto w-full space-y-8 ${isOffline ? 'offline-locked' : ''}`}>
        {activeTab === 'data' && (
          <>
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-2 flex items-center">
                <FileSpreadsheet className="mr-2 text-green-600" size={22} />
                任务管理
              </h3>
              <p className="text-sm text-gray-500 mb-6">
                {isSuperAdmin
                  ? '\u5bfc\u5165\u6587\u4ef6\u9700\u4e0e\u672c\u7cfb\u7edf\u5bfc\u51fa\u7684 xls \u683c\u5f0f\u4e00\u81f4\uff1b\u6bcf\u6b21\u5bfc\u5165\u53ea\u80fd\u9009\u62e9\u4e00\u4e2a\u6708\u4efd\u8fdb\u884c\u8986\u76d6\u3002'
                  : '\u4e00\u822c\u7ba1\u7406\u5458\u53ef\u5bfc\u51fa\u4efb\u52a1\u6570\u636e\uff1b\u5bfc\u5165\u4efb\u52a1\u6570\u636e\u4ec5\u8d85\u7ea7\u7ba1\u7406\u5458\u53ef\u64cd\u4f5c\u3002'}
              </p>
              <div className="flex flex-wrap gap-4">
                <button
                  onClick={handleTaskExport}
                  disabled={exporting}
                  className="flex items-center gap-2 px-5 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold rounded-xl transition"
                >
                  {exporting ? <RefreshCw size={18} className="animate-spin" /> : <Download size={18} />}
                  {'\u5bfc\u51fa\u4efb\u52a1\u6570\u636e'}
                </button>
                {isSuperAdmin && (
                  <>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={importing}
                      className="flex items-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl transition"
                    >
                      {importing ? <RefreshCw size={18} className="animate-spin" /> : <Upload size={18} />}
                      {'\u5bfc\u5165\u4efb\u52a1\u6570\u636e'}
                    </button>
                    <button
                      onClick={() => setShowCleanupTasksModal(true)}
                      disabled={exporting || importing}
                      className="flex items-center gap-2 px-5 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-bold rounded-xl transition"
                    >
                      <Trash2 size={18} />
                      清理任务数据
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xls,.xlsx"
                      className="hidden"
                      onChange={handleTaskImport}
                    />
                  </>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-2 flex items-center">
                <ClipboardList className="mr-2 text-purple-600" size={22} />
                状态跟踪表
              </h3>
              <p className="text-sm text-gray-500 mb-6">导出状态跟踪表的数据，可以选择按添加时间月份或纳期月份进行筛选导出。</p>
              <div className="flex flex-wrap gap-4 items-center">
                <div className="flex items-center rounded-lg border border-gray-300 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setStExportMonthMode('production')}
                    className={`px-3 py-2 text-sm font-medium transition ${
                      stExportMonthMode === 'production'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    添加时间月份
                  </button>
                  <button
                    type="button"
                    onClick={() => setStExportMonthMode('delivery')}
                    className={`px-3 py-2 text-sm font-medium border-l border-gray-300 transition ${
                      stExportMonthMode === 'delivery'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    纳期月份
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-700">选择月份：</span>
                  <input
                    type="month"
                    value={stExportMonthMode === 'production' ? stExportMonth : stExportDeliveryMonth}
                    onChange={(e) => {
                      if (stExportMonthMode === 'production') {
                        setStExportMonth(e.target.value);
                      } else {
                        setStExportDeliveryMonth(e.target.value);
                      }
                    }}
                    className="px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                  />
                </div>
                <button
                  onClick={handleStatusTrackingExport}
                  disabled={exporting}
                  className="flex items-center gap-2 px-5 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white font-bold rounded-xl transition"
                >
                  {exporting ? <RefreshCw size={18} className="animate-spin" /> : <Download size={18} />}
                  导出状态跟踪表
                </button>
                {isSuperAdmin && (
                  <button
                    onClick={() => setShowCleanupStModal(true)}
                    disabled={exporting}
                    className="flex items-center gap-2 px-5 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-bold rounded-xl transition"
                  >
                    <Trash2 size={18} />
                    清理状态追踪
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-2 flex items-center">
                <Clock className="mr-2 text-orange-600" size={22} />
                工时管理表
              </h3>
              <p className="text-sm text-gray-500 mb-6">按照月份导出，统计每个设计员的月工时（总工时、工作日工时、周末加班工时、出差工时、请假工时），按总工时降序排列。</p>
              <div className="flex flex-wrap gap-4 items-center">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-700">选择月份：</span>
                  <input
                    type="month"
                    value={whExportMonth}
                    onChange={(e) => setWhExportMonth(e.target.value)}
                    className="px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                  />
                </div>
                <button
                  onClick={handleWorkHoursExport}
                  disabled={exporting}
                  className="flex items-center gap-2 px-5 py-3 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white font-bold rounded-xl transition"
                >
                  {exporting ? <RefreshCw size={18} className="animate-spin" /> : <Download size={18} />}
                  导出工时管理表
                </button>
              </div>
            </div>

            {/* 焊枪编号台账：按需选择分类导出（单分类 xls，多分类 zip） */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-2 flex items-center">
                <ClipboardList className="mr-2 text-emerald-600" size={22} />
                焊枪编号台账
              </h3>
              <p className="text-sm text-gray-500 mb-5">按分类导入/导出焊枪编号台账。每个分类是一个 xls 工作簿，分类下的每张表对应一个工作表。导出时：选择 1 个分类下载单个 xls，选择多个分类时打包为 zip。导入时：工作簿内的每个工作表会成为目标分类下的一张表，并覆盖目标分类。</p>
              {gunCatsLoading ? (
                <div className="text-sm text-gray-400 flex items-center gap-2 py-2">
                  <RefreshCw size={14} className="animate-spin" />正在加载分类...
                </div>
              ) : gunLedgerCats.length === 0 ? (
                <div className="text-sm text-gray-400 bg-gray-50 rounded-xl border border-gray-100 p-4">暂无可导出的分类，或当前账号没有焊枪编号台账的访问权限。</div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 mb-5">
                    {gunLedgerCats.map(item => {
                      const checked = gunExportCats.includes(item.category);
                      return (
                        <label
                          key={item.category}
                          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border cursor-pointer text-sm font-bold transition ${checked ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
                        >
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-emerald-600"
                            checked={checked}
                            onChange={() => toggleGunExportCat(item.category)}
                          />
                          {item.category}
                          <span className="text-[10px] font-normal text-gray-400">{item.tables} 表 / {item.rows} 行</span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-3 text-xs font-bold">
                      <button className="text-emerald-600 hover:text-emerald-700 transition" onClick={() => setGunExportCats(gunLedgerCats.map(item => item.category))}>全选</button>
                      <button className="text-gray-400 hover:text-gray-600 transition" onClick={() => setGunExportCats([])}>清空</button>
                    </div>
                    <button
                      onClick={handleGunLedgerExport}
                      disabled={exporting || importing || !gunExportCats.length}
                      className="flex items-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold rounded-xl transition"
                    >
                      {exporting ? <RefreshCw size={18} className="animate-spin" /> : <Download size={18} />}
                      导出焊枪编号台账
                    </button>
                    {isSuperAdmin && (
                      <>
                        <button
                          onClick={() => gunFileInputRef.current?.click()}
                          disabled={importing}
                          className="flex items-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl transition"
                        >
                          {importing ? <RefreshCw size={18} className="animate-spin" /> : <Upload size={18} />}
                          导入焊枪编号台账
                        </button>
                        <input
                          ref={gunFileInputRef}
                          type="file"
                          accept=".xls,.xlsx"
                          className="hidden"
                          onChange={handleGunLedgerImportFile}
                        />
                      </>
                    )}
                  </div>
                </>
              )}

              {/* 导入确认面板 */}
              {gunPendingFile && (
                <div className="mt-5 rounded-xl border-2 border-blue-200 bg-blue-50 p-5 space-y-4">
                  <div className="font-bold text-gray-800 flex items-center gap-2">
                    <Upload size={18} className="text-blue-600" />确认导入焊枪编号台账
                  </div>
                  <div className="text-sm text-gray-600">文件：<span className="font-bold text-gray-800 break-all">{gunPendingFile.name}</span></div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-bold text-gray-700 cursor-pointer">
                      <input type="radio" className="w-4 h-4 accent-blue-600" checked={!gunImportAsNew} onChange={() => setGunImportAsNew(false)} />
                      导入到现有分类：
                    </label>
                    {!gunImportAsNew && (
                      <select
                        value={gunImportCategory}
                        onChange={(e) => setGunImportCategory(e.target.value)}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-200"
                      >
                        {gunLedgerCats.length === 0 && <option value="">（暂无现有分类，请改用新分类）</option>}
                        {gunLedgerCats.map(item => <option key={item.category} value={item.category}>{item.category}（{item.tables} 表 / {item.rows} 行）</option>)}
                      </select>
                    )}
                    <label className="flex items-center gap-2 text-sm font-bold text-gray-700 cursor-pointer pt-1">
                      <input type="radio" className="w-4 h-4 accent-blue-600" checked={gunImportAsNew} onChange={() => setGunImportAsNew(true)} />
                      导入到新分类：
                    </label>
                    {gunImportAsNew && (
                      <input
                        type="text"
                        value={gunImportNewName}
                        onChange={(e) => setGunImportNewName(e.target.value)}
                        placeholder="请输入新分类名称（1-30 字符）"
                        maxLength={30}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    )}
                  </div>
                  <label className="flex items-start gap-2 text-sm text-gray-700 font-bold cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 mt-0.5 accent-blue-600" checked={gunImportConfirmed} onChange={(e) => setGunImportConfirmed(e.target.checked)} />
                    <span>已确认文件格式与系统导出格式一致（每张表一个工作表，含序号/焊枪名/客户/时间/担当/备注表头），并知悉导入将<span className="text-red-600">覆盖目标分类下的全部表格</span>。</span>
                  </label>
                  <div className="flex justify-end gap-2">
                    <button onClick={cancelGunLedgerImport} disabled={importing} className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition disabled:opacity-60">取消</button>
                    <button onClick={confirmGunLedgerImport} disabled={importing} className="flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold transition disabled:opacity-60">
                      {importing && <RefreshCw size={16} className="animate-spin" />}
                      {importing ? '导入中...' : '确认导入'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {isSuperAdmin && (
              <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
                <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
                  <Shield className="mr-2 text-purple-600" size={22} />
                  系统设置查看权限设置
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {[
                    { label: '启用系统设置', detail: 'Global Toggle', key: 'enabled' as const },
                    { label: '一般管理员', detail: 'Admin Access', key: 'allowAdmins' as const }
                  ].map(item => (
                    <div key={item.key} className="flex items-center justify-between p-5 bg-gray-50 rounded-xl border border-gray-100">
                      <div>
                        <div className="font-bold text-gray-700">{item.label}</div>
                        <div className="text-[10px] text-gray-400 font-bold uppercase mt-0.5">{item.detail}</div>
                      </div>
                      <div className="relative inline-block w-12 h-6 align-middle select-none transition duration-200 ease-in">
                        <input
                          type="checkbox"
                          checked={accessSettings[item.key]}
                          onChange={(e) => updateAccessSettings({ [item.key]: e.target.checked })}
                          disabled={!accessSettingsLoaded}
                          className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer z-10"
                        />
                        <label className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer ${accessSettings[item.key] ? 'bg-blue-500' : 'bg-gray-300'}`}></label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'maintenance' && isSuperAdmin && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-lg font-bold text-gray-800 flex items-center">
                    <Database className="mr-2 text-blue-600" size={22} />
                    数据库维护
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">每日 {(maintenanceSettings.scheduleTimes || []).join('、') || '—'} 自动执行已开启的备份与导出任务、清理过期文件。</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={fetchMaintenanceStatus} disabled={maintenanceLoading} className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-60 text-gray-700 font-bold rounded-lg transition">
                    <RefreshCw size={16} className={maintenanceLoading ? 'animate-spin' : ''} />刷新
                  </button>
                  <button onClick={saveMaintenanceSettings} disabled={maintenanceSaving} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-lg transition">
                    {maintenanceSaving ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle size={16} />}保存设置
                  </button>
                </div>
              </div>

              {!maintenanceSettings.enabled && (
                <div className="mb-5 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                  自动维护已停用，每日计划任务不会执行；仍可使用下方的手动维护操作。
                </div>
              )}

              {/* 总开关与执行时间 */}
              <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="flex items-center justify-between font-bold text-gray-700">
                    <span className="flex items-center gap-2"><Clock size={18} className="text-blue-600" />启用自动维护</span>
                    <input type="checkbox" checked={maintenanceSettings.enabled} onChange={(e) => updateMaintenanceField('enabled', e.target.checked)} className="w-5 h-5 accent-blue-600" />
                  </label>
                  <div className="flex items-center gap-2 font-bold text-gray-700">
                    <span className="flex items-center gap-2 whitespace-nowrap">每日执行时间</span>
                    <input type="time" value={maintenanceSettings.scheduleTimes?.[0] || ''} onChange={(e) => updateScheduleTime(0, e.target.value)} className="w-32 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none" />
                    <input type="time" value={maintenanceSettings.scheduleTimes?.[1] || ''} onChange={(e) => updateScheduleTime(1, e.target.value)} className="w-32 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none" />
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-3 leading-relaxed">到达执行时间后，按下方开关备份数据库、导出任务表格与编号台账，并按各项保留天数清理四个目录中的过期文件；总开关停用后所有计划任务跳过。</p>
              </div>

              {/* 每日自动任务：开关、保留天数、存放目录集中在同一张卡片 */}
              <div className="text-sm font-bold text-gray-700 mb-3">每日自动任务</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className={`rounded-xl border border-blue-200 bg-blue-50/40 p-4 ${maintenanceSettings.dailyBackupEnabled ? '' : 'opacity-60'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 font-bold text-gray-800"><Database size={17} className="text-blue-600" />数据库备份</div>
                    <input type="checkbox" checked={maintenanceSettings.dailyBackupEnabled} onChange={(e) => updateMaintenanceField('dailyBackupEnabled', e.target.checked)} className="w-5 h-5 accent-blue-600" />
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed mb-3 min-h-[48px]">使用 SQLite 在线备份 API 生成一致性快照，即使正在写入也安全；备份合并 WAL 后为单个 .db 文件。</p>
                  <label className="block mb-2">
                    <span className="text-xs font-bold text-gray-600">备份保留天数</span>
                    <input type="number" min={1} max={3650} value={maintenanceSettings.backupRetentionDays} onChange={(e) => updateMaintenanceField('backupRetentionDays', Number(e.target.value))} className="mt-1 w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold text-gray-600">备份存放目录（相对后端）</span>
                    <input value={maintenanceSettings.backupDir} onChange={(e) => updateMaintenanceField('backupDir', e.target.value)} className="mt-1 w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
                  </label>
                </div>

                <div className={`rounded-xl border border-green-200 bg-green-50/40 p-4 ${maintenanceSettings.dailyTaskExportEnabled ? '' : 'opacity-60'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 font-bold text-gray-800"><FileSpreadsheet size={17} className="text-green-600" />任务表格导出</div>
                    <input type="checkbox" checked={maintenanceSettings.dailyTaskExportEnabled} onChange={(e) => updateMaintenanceField('dailyTaskExportEnabled', e.target.checked)} className="w-5 h-5 accent-green-600" />
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed mb-3 min-h-[48px]">将所有月份含有数据的任务工作表导出为单个 xls，每个月份对应一个工作表。</p>
                  <label className="block mb-2">
                    <span className="text-xs font-bold text-gray-600">导出文件保留天数</span>
                    <input type="number" min={1} max={3650} value={maintenanceSettings.taskExportRetentionDays} onChange={(e) => updateMaintenanceField('taskExportRetentionDays', Number(e.target.value))} className="mt-1 w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-green-200 focus:border-green-400" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold text-gray-600">导出存放目录（相对后端）</span>
                    <input value={maintenanceSettings.taskExportDir} onChange={(e) => updateMaintenanceField('taskExportDir', e.target.value)} className="mt-1 w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-green-200 focus:border-green-400" />
                  </label>
                </div>

                <div className={`rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 ${maintenanceSettings.dailyGunLedgerExportEnabled ? '' : 'opacity-60'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 font-bold text-gray-800"><ClipboardList size={17} className="text-emerald-600" />编号台账导出</div>
                    <input type="checkbox" checked={maintenanceSettings.dailyGunLedgerExportEnabled} onChange={(e) => updateMaintenanceField('dailyGunLedgerExportEnabled', e.target.checked)} className="w-5 h-5 accent-emerald-600" />
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed mb-3 min-h-[48px]">所有焊枪编号台账分类打包导出为一个 zip，每个分类对应一个独立的 xls 工作簿（分类下每张台账表对应一个工作表）。</p>
                  <label className="block mb-2">
                    <span className="text-xs font-bold text-gray-600">导出文件保留天数</span>
                    <input type="number" min={1} max={3650} value={maintenanceSettings.gunLedgerExportRetentionDays} onChange={(e) => updateMaintenanceField('gunLedgerExportRetentionDays', Number(e.target.value))} className="mt-1 w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold text-gray-600">导出存放目录（相对后端）</span>
                    <input value={maintenanceSettings.gunLedgerExportDir} onChange={(e) => updateMaintenanceField('gunLedgerExportDir', e.target.value)} className="mt-1 w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400" />
                  </label>
                </div>
              </div>

              {/* 年度清理与关机备份 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className={`rounded-xl border border-red-200 bg-red-50/40 p-4 ${maintenanceSettings.yearlyCleanupEnabled ? '' : 'opacity-70'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 font-bold text-gray-800"><Archive size={17} className="text-red-600" />年度任务清理</div>
                    <input type="checkbox" checked={maintenanceSettings.yearlyCleanupEnabled} onChange={(e) => updateMaintenanceField('yearlyCleanupEnabled', e.target.checked)} className="w-5 h-5 accent-red-600" />
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed mb-3">
                    每年在检测月份的前 N 天自动检测一次（每年仅执行一次）；将年份早于「当前年份 − 保留年数」的任务工作表先永久归档为 JSON，再从数据库删除。例如 2027 年 1 月、保留 1 年时，删除 2026 年 1 月之前的数据。
                  </p>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <label className="block">
                      <span className="text-xs font-bold text-gray-600">检测月份（1-12）</span>
                      <input type="number" min={1} max={12} value={maintenanceSettings.yearlyCleanupMonth} onChange={(e) => updateMaintenanceField('yearlyCleanupMonth', Number(e.target.value))} className="mt-1 w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-gray-600">月初检测天数</span>
                      <input type="number" min={1} max={31} value={maintenanceSettings.yearlyCleanupCheckDays} onChange={(e) => updateMaintenanceField('yearlyCleanupCheckDays', Number(e.target.value))} className="mt-1 w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-gray-600">任务保留年数</span>
                      <input type="number" min={1} max={10} value={maintenanceSettings.yearlyTaskRetentionYears} onChange={(e) => updateMaintenanceField('yearlyTaskRetentionYears', Number(e.target.value))} className="mt-1 w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400" />
                    </label>
                  </div>
                  <label className="block mb-3">
                    <span className="text-xs font-bold text-gray-600">永久归档目录（相对后端）</span>
                    <input value={maintenanceSettings.yearlyArchiveDir} onChange={(e) => updateMaintenanceField('yearlyArchiveDir', e.target.value)} className="mt-1 w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400" />
                  </label>
                  <div className="rounded-lg bg-white/80 border border-red-100 px-3 py-2 text-xs text-gray-600">
                    {latestYearlyHistory ? (
                      <>
                        最近一次执行：{format(new Date(latestYearlyHistory.completedAt), 'yyyy-MM-dd')}，临界年份 {latestYearlyHistory.cutoffYear}，
                        {latestYearlyHistory.removedSheets > 0
                          ? <>归档并删除 {latestYearlyHistory.removedSheets} 个工作表（{latestYearlyHistory.removedTaskItems || 0} 条记录）{latestYearlyHistory.archiveFile ? `，归档文件 ${latestYearlyHistory.archiveFile.split(/[\\/]/).pop()}` : ''}</>
                          : '无符合条件的任务数据'}
                      </>
                    ) : '暂无年度清理执行记录'}
                  </div>
                </div>

                <div className={`rounded-xl border border-amber-200 bg-amber-50/40 p-4 ${maintenanceSettings.offlineBackupEnabled ? '' : 'opacity-70'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 font-bold text-gray-800"><Power size={17} className="text-amber-600" />关机自动备份</div>
                    <input type="checkbox" checked={maintenanceSettings.offlineBackupEnabled} onChange={(e) => updateMaintenanceField('offlineBackupEnabled', e.target.checked)} className="w-5 h-5 accent-amber-600" />
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed mb-3">
                    服务器进程关闭时（Ctrl+C、关闭服务控制台、收到 SIGTERM）自动执行一次数据库一致性备份；5 分钟内重复关闭仅备份一次，与每日备份分开存放。
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                    <label className="block">
                      <span className="text-xs font-bold text-gray-600">备份保留天数</span>
                      <input type="number" min={1} max={3650} value={maintenanceSettings.offlineBackupRetentionDays} onChange={(e) => updateMaintenanceField('offlineBackupRetentionDays', Number(e.target.value))} className="mt-1 w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-400" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-gray-600">备份存放目录（相对后端）</span>
                      <input value={maintenanceSettings.offlineBackupDir} onChange={(e) => updateMaintenanceField('offlineBackupDir', e.target.value)} className="mt-1 w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-400" />
                    </label>
                  </div>
                  <div className="rounded-lg bg-white/80 border border-amber-100 px-3 py-2 text-xs text-gray-500">
                    适用于服务意外停止前的最后保障；每日计划执行时也会按上面的保留天数一并清理本目录的过期备份。
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
                <h3 className="font-bold text-gray-800 mb-1 flex items-center gap-2">
                  <PlayCircle size={18} className="text-blue-600" />手动维护
                </h3>
                <p className="text-xs text-gray-400 mb-4">立即在服务器上执行一次，不影响每日计划；执行后状态自动刷新。</p>

                <div className="text-xs font-bold text-gray-500 mb-2">常规操作</div>
                <div className="grid grid-cols-1 gap-2.5 mb-5">
                  <button onClick={handleBackupNow} disabled={maintenanceLoading} className="flex items-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl transition text-left">
                    <Database size={17} />立即备份数据库
                  </button>
                  <button onClick={handleManualTaskExport} disabled={maintenanceLoading} className="flex items-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold rounded-xl transition text-left">
                    <FileSpreadsheet size={17} />立即导出任务数据
                  </button>
                  <button onClick={handleManualGunLedgerExport} disabled={maintenanceLoading} className="flex items-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold rounded-xl transition text-left">
                    <ClipboardList size={17} />立即导出编号台账
                  </button>
                  <button onClick={handleCleanupBackupsNow} disabled={maintenanceLoading} className="flex items-center gap-2 px-4 py-3 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white font-bold rounded-xl transition text-left">
                    <Trash2 size={17} />清理过期文件
                    <span className="ml-auto text-[11px] font-normal opacity-90 text-right">备份 / 任务导出 / 台账导出 / 关机备份</span>
                  </button>
                </div>

                <div className="text-xs font-bold text-red-500 mb-2 flex items-center gap-1"><AlertCircle size={13} />危险操作（不可恢复）</div>
                <div className="grid grid-cols-1 gap-2.5 rounded-xl bg-red-50/60 border border-red-100 p-3">
                  <button onClick={handleYearlyCleanupNow} disabled={maintenanceLoading} className="flex items-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-bold rounded-xl transition text-left">
                    <Archive size={17} />立即执行年度清理检测
                  </button>
                  <button onClick={handleClearLogs} disabled={maintenanceLoading} className="flex items-center gap-2 px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white font-bold rounded-xl transition text-left">
                    <History size={17} />清空所有登录与操作日志
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
                <h3 className="font-bold text-gray-800 mb-4">运行状态</h3>
                <div className="space-y-4 text-sm text-gray-600">
                  {/* 调度器状态 */}
                  <div className="rounded-xl border border-gray-200 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-gray-700">调度器</span>
                      {(() => {
                        const badge = !maintenanceSettings.enabled
                          ? { dot: 'bg-gray-400', text: '已停用', cls: 'bg-gray-100 text-gray-600' }
                          : maintenanceStatus?.scheduler?.running
                            ? { dot: 'bg-blue-500 animate-pulse', text: '正在执行', cls: 'bg-blue-50 text-blue-700' }
                            : { dot: 'bg-green-500', text: '计划中', cls: 'bg-green-50 text-green-700' };
                        return (
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${badge.cls}`}>
                            <span className={`w-2 h-2 rounded-full ${badge.dot}`} />{badge.text}
                          </span>
                        );
                      })()}
                    </div>
                    <div className="mt-2 space-y-1 text-xs">
                      <div className="flex gap-2"><span className="w-16 shrink-0 text-gray-400 font-bold">下次执行</span><span className="text-gray-700">{(maintenanceStatus?.scheduler?.nextRunAtLocal || '').replace(/\s*\(.*\)$/, '') || (maintenanceStatus?.scheduler?.nextRunAt ? format(new Date(maintenanceStatus.scheduler.nextRunAt), 'yyyy-MM-dd HH:mm') : '-')}</span></div>
                      <div className="flex gap-2"><span className="w-16 shrink-0 text-gray-400 font-bold">上次执行</span><span className="text-gray-700">{maintenanceStatus?.scheduler?.lastRun?.finishedAt ? format(new Date(maintenanceStatus.scheduler.lastRun.finishedAt), 'yyyy-MM-dd HH:mm:ss') : '尚无自动执行记录'}</span></div>
                      {maintenanceStatus?.scheduler?.timezone && (
                        <div className="flex gap-2"><span className="w-16 shrink-0 text-gray-400 font-bold">时区</span><span className="text-gray-500">服务器本地时间（{maintenanceStatus.scheduler.timezone}）</span></div>
                      )}
                    </div>

                    {/* 上次计划执行的逐项结果 */}
                    {maintenanceStatus?.scheduler?.lastRun?.finishedAt && (() => {
                      const lr = maintenanceStatus.scheduler.lastRun as MaintenanceLastRun;
                      if (lr.skipped) {
                        return <div className="mt-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-500">本次计划执行已跳过：{lr.reason === 'disabled' ? '自动维护已停用' : lr.reason}</div>;
                      }
                      type Tone = 'ok' | 'off' | 'muted' | 'warn';
                      const toneCls: Record<Tone, string> = {
                        ok: 'text-green-700 bg-green-50',
                        off: 'text-gray-400 bg-gray-50',
                        muted: 'text-gray-500 bg-gray-50',
                        warn: 'text-amber-700 bg-amber-50'
                      };
                      const steps: { label: string; tone: Tone; text: string }[] = [];
                      steps.push(!maintenanceSettings.dailyBackupEnabled
                        ? { label: '数据库备份', tone: 'off', text: '未启用' }
                        : lr.backup ? { label: '数据库备份', tone: 'ok', text: lr.backup.fileName } : { label: '数据库备份', tone: 'muted', text: '未生成' });
                      const te = lr.taskExport;
                      steps.push(!maintenanceSettings.dailyTaskExportEnabled
                        ? { label: '任务表格', tone: 'off', text: '未启用' }
                        : te?.skipped ? { label: '任务表格', tone: 'muted', text: '无任务数据，跳过' }
                        : te ? { label: '任务表格', tone: 'ok', text: `${te.taskSheets} 个工作表 / ${te.taskItems} 条记录` }
                        : { label: '任务表格', tone: 'muted', text: '未生成' });
                      const ge = lr.gunLedgerExport;
                      steps.push(!maintenanceSettings.dailyGunLedgerExportEnabled
                        ? { label: '编号台账', tone: 'off', text: '未启用' }
                        : ge?.skipped ? { label: '编号台账', tone: 'muted', text: '无台账数据，跳过' }
                        : ge ? { label: '编号台账', tone: 'ok', text: `${ge.categories} 个分类已导出` }
                        : { label: '编号台账', tone: 'muted', text: '未生成' });
                      steps.push(lr.backupCleanup
                        ? { label: '过期清理', tone: 'ok', text: `删除 ${lr.backupCleanup.removedCount} 个过期文件` }
                        : { label: '过期清理', tone: 'muted', text: '-' });
                      const yc = lr.yearlyCleanup;
                      steps.push(!maintenanceSettings.yearlyCleanupEnabled
                        ? { label: '年度清理', tone: 'off', text: '未启用' }
                        : !yc ? { label: '年度清理', tone: 'muted', text: '-' }
                        : yc.skipped ? { label: '年度清理', tone: 'muted', text: yearlySkipReasonText[yc.reason || ''] || yc.reason || '已跳过' }
                        : yc.removedSheets ? { label: '年度清理', tone: 'warn', text: `归档删除 ${yc.removedSheets} 个工作表（${yc.removedTaskItems || 0} 条记录）` }
                        : { label: '年度清理', tone: 'ok', text: '无需要清理的数据' });
                      return (
                        <div className="mt-2 space-y-1.5">
                          {steps.map(step => (
                            <div key={step.label} className="flex items-start gap-2 text-xs">
                              <span className="w-16 shrink-0 font-bold text-gray-400 pt-0.5">{step.label}</span>
                              <span className={`px-2 py-0.5 rounded break-all ${toneCls[step.tone]}`}>{step.text}</span>
                            </div>
                          ))}
                          {lr.errors?.length ? (
                            <div className="rounded-lg bg-red-50 border border-red-200 px-2 py-2 text-xs text-red-700">执行错误：{lr.errors.join('；')}</div>
                          ) : null}
                        </div>
                      );
                    })()}
                  </div>

                  {/* 数据库占用 */}
                  <div className="rounded-xl border border-gray-200 p-3 space-y-2">
                    <div className="font-bold text-gray-700 text-xs">数据库占用</div>
                    <div className="text-xs">
                      <span className="font-bold text-blue-600">{maintenanceStatus?.database ? formatFileSize(maintenanceStatus.database.totalDiskSize) : '-'}</span>
                      {maintenanceStatus?.database && (
                        <span className="text-gray-400 ml-2">
                          （主文件 {formatFileSize(maintenanceStatus.database.dbFileSize)}
                          {maintenanceStatus.database.walSize > 0 ? ` + WAL ${formatFileSize(maintenanceStatus.database.walSize)}` : ''}
                          {maintenanceStatus.database.shmSize > 0 ? ` + SHM ${formatFileSize(maintenanceStatus.database.shmSize)}` : ''}）
                        </span>
                      )}
                    </div>
                    <div className="text-xs">
                      <span className="font-bold text-green-600">tasks 集合 {maintenanceStatus?.database ? formatFileSize(maintenanceStatus.database.tasksJsonSize) : '-'}</span>
                      {maintenanceStatus?.database && (
                        <span className="text-gray-400 ml-2">（{maintenanceStatus.database.tasksCount} 个工作表，{maintenanceStatus.database.taskItemsCount} 条任务记录）</span>
                      )}
                    </div>
                    {(maintenanceStatus?.database?.reclaimableBytes || 0) > 0 && (
                      <div className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 text-xs text-amber-800 leading-relaxed">
                        有 <span className="font-bold">{formatFileSize(maintenanceStatus!.database.reclaimableBytes!)}</span> 是已删除数据留下的空闲页，仍占着磁盘。
                        执行「压缩数据库」后才会真正释放。
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-0.5">
                      <button
                        onClick={handleCompactDatabase}
                        disabled={maintenanceLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-bold transition"
                      >
                        <Database size={13} />
                        压缩数据库
                      </button>
                      <span className="text-[11px] text-gray-400 leading-tight">回收空闲页并截断 WAL</span>
                    </div>
                    <div className="text-xs text-gray-500">数据文件：<span className="break-all text-gray-600">{maintenanceStatus?.paths?.database || '-'}</span></div>
                  </div>

                  {/* 存储目录绝对路径 */}
                  <div className="rounded-xl border border-gray-200 p-3">
                    <div className="font-bold text-gray-700 text-xs mb-1.5">存储目录（服务器绝对路径）</div>
                    <div className="space-y-1 text-xs">
                      {[
                        { label: '数据库备份', path: maintenanceStatus?.paths?.backupDir },
                        { label: '任务表格导出', path: maintenanceStatus?.paths?.taskExportDir },
                        { label: '编号台账导出', path: maintenanceStatus?.paths?.gunLedgerExportDir },
                        { label: '年度归档', path: maintenanceStatus?.paths?.yearlyArchiveDir },
                        { label: '关机备份', path: maintenanceStatus?.paths?.offlineBackupDir }
                      ].map(item => (
                        <div key={item.label} className="flex gap-2">
                          <span className="w-20 shrink-0 text-gray-400 font-bold">{item.label}</span>
                          <span className="break-all text-gray-600">{item.path || '-'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
              <h3 className="font-bold text-gray-800 mb-4">最近生成的文件</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {[
                  { title: '数据库备份', icon: <Database size={14} className="text-blue-600" />, files: maintenanceStatus?.files?.backups || [] },
                  { title: '任务表格导出', icon: <FileSpreadsheet size={14} className="text-green-600" />, files: maintenanceStatus?.files?.taskExports || [] },
                  { title: '编号台账导出', icon: <ClipboardList size={14} className="text-emerald-600" />, files: maintenanceStatus?.files?.gunLedgerExports || [] },
                  { title: '年度归档', icon: <Archive size={14} className="text-amber-600" />, files: maintenanceStatus?.files?.yearlyArchives || [] },
                  { title: '关机备份', icon: <Power size={14} className="text-rose-500" />, files: maintenanceStatus?.files?.offlineBackups || [] }
                ].map(group => (
                  <div key={group.title} className="rounded-xl border border-gray-100 bg-gray-50/50 p-3">
                    <h4 className="font-bold text-gray-700 mb-2 flex items-center gap-1.5 text-xs">
                      {group.icon}{group.title}
                      <span className="ml-auto text-[10px] font-normal text-gray-400">{group.files.length}/5</span>
                    </h4>
                    <div className="space-y-2">
                      {group.files.length === 0 ? <div className="text-[11px] text-gray-400 py-1">暂无文件</div> : group.files.map(file => (
                        <div key={file.path} className="rounded-lg bg-white border border-gray-100 p-2">
                          <div className="text-[11px] font-bold text-gray-700 break-all leading-snug">{file.name}</div>
                          <div className="text-[10px] text-gray-400 mt-1">{formatFileSize(file.size)} · {format(new Date(file.mtime), 'MM-dd HH:mm')}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-3">各目录仅展示最近 5 个文件；过期文件由每日计划或「清理过期文件」按钮按各项保留天数删除。</p>
            </div>
          </div>
        )}

        {activeTab === 'login' && (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
              <Shield className="mr-2 text-purple-600" size={22} />
              登录管理
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                { label: '允许多设备同时在线', detail: 'Multi Device', key: 'allowMultiDevice' as const },
                { label: '允许登录用户修改本人设计计划完成状态', detail: 'Own Design Plan Status', key: 'allowUserDesignPlanColorMark' as const },
                { label: '允许用户自主改密', detail: 'Self Password Change', key: 'allowUserChangePassword' as const }
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
                      disabled={!isSuperAdmin}
                      className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer z-10"
                    />
                    <label className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer ${settings[item.key] ? 'bg-blue-500' : 'bg-gray-300'}`}></label>
                  </div>
                </div>
              ))}
            </div>

            {/* IP 黑名单：拦截异常访问来源 */}
            <div className={`mt-8 rounded-xl border p-5 transition ${ipBlacklist.enabled ? 'border-red-200 bg-gradient-to-br from-red-50/70 to-white' : 'border-gray-200 bg-gray-50/60'}`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${ipBlacklist.enabled ? 'bg-red-100 text-red-600' : 'bg-gray-200 text-gray-400'}`}>
                    <ShieldAlert size={20} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-bold text-gray-800">IP 黑名单</h4>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${ipBlacklist.enabled ? 'bg-red-500 text-white border-red-500' : 'bg-white text-gray-400 border-gray-200'}`}>
                        {ipBlacklist.enabled ? '拦截中' : '已停用'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-gray-500">
                      命中黑名单的 IP 将被拒绝访问本系统全部接口与登录；命中登录请求会记录到登录日志。
                      本机 <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px] font-mono">127.0.0.1</code> 永不拦截，避免误封自身出口后无法在服务器本机自救。
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-gray-400 font-medium">共 {ipBlacklist.entries.length} 条规则</span>
                  <div className="relative inline-block w-12 h-6 align-middle select-none transition duration-200 ease-in">
                    <input
                      type="checkbox"
                      checked={ipBlacklist.enabled}
                      onChange={(e) => toggleIpBlacklist(e.target.checked)}
                      disabled={!isSuperAdmin}
                      className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer z-10"
                    />
                    <label className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer ${ipBlacklist.enabled ? 'bg-red-500' : 'bg-gray-300'}`}></label>
                  </div>
                </div>
              </div>

              <div className={`mt-4 rounded-lg border bg-white p-4 ${ipBlacklist.enabled ? 'border-red-100' : 'border-gray-100'}`}>
                <div className="flex flex-col gap-2 lg:flex-row">
                  <div className="relative flex-1">
                    <Ban size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                    <input
                      value={ipInput}
                      onChange={(e) => setIpInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !ipSaving) handleAddIpBlacklist(); }}
                      placeholder="输入 IP，如 192.168.1.100（多个用逗号或空格分隔，可批量添加）"
                      disabled={!isSuperAdmin || ipSaving}
                      className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-sm font-mono text-gray-700 placeholder:font-sans placeholder:text-gray-300 focus:border-red-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-100 disabled:opacity-60"
                    />
                  </div>
                  <input
                    value={ipNote}
                    onChange={(e) => setIpNote(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !ipSaving) handleAddIpBlacklist(); }}
                    placeholder="备注（选填，如：恶意爆破扫描源）"
                    maxLength={100}
                    disabled={!isSuperAdmin || ipSaving}
                    className="w-full lg:w-64 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700 placeholder:text-gray-300 focus:border-red-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-100 disabled:opacity-60"
                  />
                  <button
                    onClick={handleAddIpBlacklist}
                    disabled={!isSuperAdmin || ipSaving || !ipInput.trim()}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-red-500 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-red-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus size={16} />
                    {ipSaving ? '添加中…' : '加入黑名单'}
                  </button>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400">
                  <span className="font-bold text-gray-500">支持格式：</span>
                  <span><code className="px-1 py-0.5 bg-blue-50 text-blue-500 rounded font-mono">精确 IP</code> 192.168.1.100</span>
                  <span><code className="px-1 py-0.5 bg-purple-50 text-purple-500 rounded font-mono">网段 CIDR</code> 192.168.1.0/24</span>
                  <span><code className="px-1 py-0.5 bg-amber-50 text-amber-600 rounded font-mono">通配符</code> 192.168.*.*</span>
                </div>
                {recentFailedIps.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed border-gray-100 pt-3">
                    <span className="text-[11px] font-bold text-gray-500 flex items-center gap-1">
                      <AlertCircle size={12} className="text-amber-500" />
                      最近登录失败 IP，点击快速填入：
                    </span>
                    {recentFailedIps.map(ip => (
                      <button
                        key={ip}
                        onClick={() => setIpInput(prev => (prev.trim() ? `${prev.trim().replace(/[,，;；\s]+$/, '')}, ${ip}` : ip))}
                        className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 font-mono text-[11px] text-gray-600 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                      >
                        {ip}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {ipBlacklist.entries.length === 0 ? (
                <div className="mt-4 flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 bg-white/60 py-8 text-center">
                  <Ban size={28} className="text-gray-200" />
                  <p className="mt-2 text-sm text-gray-400 font-medium">暂无黑名单规则</p>
                  <p className="mt-0.5 text-xs text-gray-300">发现异常访问的 IP 后，在上方输入并加入黑名单</p>
                </div>
              ) : (
                <div className="mt-4 overflow-hidden rounded-lg border border-gray-100 bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-left">
                      <tr>
                        <th className="px-4 py-2.5 font-bold text-xs">IP / 规则</th>
                        <th className="px-4 py-2.5 font-bold text-xs">备注</th>
                        <th className="px-4 py-2.5 font-bold text-xs">添加时间</th>
                        <th className="px-4 py-2.5 font-bold text-xs">操作人</th>
                        <th className="px-4 py-2.5 font-bold text-xs text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ipBlacklist.entries.map(entry => {
                        const ruleType = getIpRuleType(entry.ip);
                        return (
                          <tr key={entry.id} className="border-t border-gray-50 hover:bg-red-50/30">
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-[13px] font-bold text-gray-800">{entry.ip}</span>
                                <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold ${ruleType.className}`}>{ruleType.label}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-gray-500 max-w-[220px] truncate" title={entry.note || ''}>{entry.note || '-'}</td>
                            <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap text-xs">
                              {entry.createdAt ? format(new Date(entry.createdAt), 'yyyy-MM-dd HH:mm') : '-'}
                            </td>
                            <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">{entry.createdBy?.name || entry.createdBy?.username || '-'}</td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                onClick={() => handleDeleteIpBlacklist(entry)}
                                disabled={!isSuperAdmin}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold text-gray-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                                title="解除封禁"
                              >
                                <Trash2 size={13} />
                                解除
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <>
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-gray-800 flex items-center mb-1">
                  <History className="mr-2 text-blue-600" size={22} />
                  操作日志保留条数
                </h3>
                <p className="text-xs text-gray-400">
                  操作日志超过该条数时自动清理最旧的记录，默认 5000 条。
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <input
                  type="number"
                  min={100}
                  max={100000}
                  value={logRetentionDraft}
                  onChange={(e) => setLogRetentionDraft(e.target.value)}
                  disabled={!isSuperAdmin || isOffline}
                  className="w-32 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none disabled:bg-gray-100 disabled:text-gray-400"
                />
                <span className="text-sm text-gray-500">条</span>
                <button
                  onClick={handleSaveLogRetention}
                  disabled={!isSuperAdmin || isOffline || logRetentionSaving}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition"
                >
                  {logRetentionSaving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-gray-800 flex items-center">
                  <History className="mr-2 text-gray-500" size={20} />
                  管理员登录信息
                </h3>
                <p className="text-xs text-gray-400 mt-1">显示最近 10 条管理员登录记录</p>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  to="/system-logs"
                  className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition"
                >
                  <Search size={15} />
                  详细日志
                </Link>
                <button
                  onClick={fetchLoginLogs}
                  className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  <RefreshCw size={14} />
                  刷新
                </button>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-left">
                  <tr>
                    <th className="px-4 py-3 font-bold">时间</th>
                    <th className="px-4 py-3 font-bold">账号</th>
                    <th className="px-4 py-3 font-bold">姓名</th>
                    <th className="px-4 py-3 font-bold">角色</th>
                    <th className="px-4 py-3 font-bold">IP</th>
                    <th className="px-4 py-3 font-bold">浏览器信息</th>
                    <th className="px-4 py-3 font-bold">结果</th>
                  </tr>
                </thead>
                <tbody>
                  {loginLogs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-400">暂无管理员登录记录</td>
                    </tr>
                  ) : (
                    loginLogs.map(log => (
                      <tr key={log.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                          {format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-800">{log.username}</td>
                        <td className="px-4 py-3 text-gray-700">{log.name}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${getRoleClassName(log.role)}`}>
                            {getRoleLabel(log.role)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">{log.ip || '-'}</td>
                        <td className="px-4 py-3 text-gray-600 max-w-[240px] truncate" title={log.userAgent || getBrowserLabel(log)}>
                          {getBrowserLabel(log)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold ${log.success ? 'text-green-600' : 'text-red-600'}`}>
                            {getActionLabel(log)}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          </>
        )}

        {activeTab === 'plan' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
                <CalendarDays className="mr-2 text-blue-600" size={22} />
                仕样号管理
              </h3>
              <div className="space-y-6">
                <div className="flex items-center justify-between p-5 bg-gray-50 rounded-xl border border-gray-100">
                  <div>
                    <div className="font-bold text-gray-700">仕样号位数</div>
                    <div className="text-xs text-gray-400 mt-1">设置全局仕样号的位数，影响所有仕样号输入与校验</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {([5, 6] as const).map(digit => (
                      <button
                        key={digit}
                        onClick={() => updateSettings({ specNumberDigits: digit })}
                        disabled={!isSuperAdmin}
                        className={`px-5 py-2.5 rounded-lg font-bold text-sm transition ${
                          settings.specNumberDigits === digit
                            ? 'bg-blue-600 text-white shadow'
                            : 'bg-white text-gray-600 border border-gray-200 hover:border-blue-300'
                        } ${!isSuperAdmin ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {digit} 位
                      </button>
                    ))}
                  </div>
                </div>
                <div className="text-xs text-gray-400">
                  当前配置：仕样号需输入 <span className="font-bold text-blue-600">{settings.specNumberDigits}</span> 位数字
                </div>
              </div>
            </div>

            {/* 任务内容配色体系：任务表格底色 / 文字色的唯一配置入口 */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
              <div className="px-6 py-5 border-b border-gray-100 bg-gradient-to-r from-slate-50 via-white to-blue-50/50">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold text-gray-800 flex items-center">
                      <Palette className="mr-2 text-blue-600" size={22} />
                      任务内容配色
                    </h3>
                    <p className="text-xs text-gray-500 mt-2 leading-relaxed max-w-2xl">
                      勾选任务内容后，任务表格底色按下方取值；未勾选任务内容时使用「未勾选任务内容」配色（深紫）。
                      任务文字色固定为黑色；只有「确认图 / 设计 / 确认图修改」有「任务加急」状态，加急后整行文字变红（弹窗里的任务内容标签同样变红）。
                      「设计变更 / 既制审图 / 暂停取消」没有加急状态，只能配置常规底色。
                      「暂停/取消」是与五个任务内容并列的独立选项：任务名后缀显示为「暂停/取消」，默认纯红底（#ff0000），
                      工时按 0 计且不计入任何统计，表格中不显示工时。
                      保存后立即生效：主页面新增或重新编辑任务都会使用这里的取值。
                      出差与事假/休假/病假使用各自的固定配色（出差=湖水青），不在此处配置。
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => { handleResetTaskColors(); }}
                      disabled={!isSuperAdmin || colorSaving}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-gray-600 bg-white border border-gray-200 hover:border-blue-300 hover:text-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <RotateCcw size={13} />恢复默认
                    </button>
                    <button
                      type="button"
                      onClick={() => { void handleSaveTaskColors(); }}
                      disabled={!isSuperAdmin || colorSaving || !colorDraftDirty}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white bg-blue-600 shadow-sm hover:bg-blue-700 transition disabled:bg-gray-300 disabled:shadow-none disabled:cursor-not-allowed"
                    >
                      <Save size={13} />{colorSaving ? '保存中...' : colorDraftDirty ? '保存配色' : '已保存'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {(['normal', 'urgent'] as const).map(group => (
                  <div key={group}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${group === 'normal' ? 'bg-slate-100 text-slate-600' : 'bg-red-50 text-red-600 ring-1 ring-red-100'}`}>
                        {group === 'normal' ? '普通任务' : '加急任务'}
                      </span>
                      <span className="text-[11px] text-gray-400">
                        {group === 'normal' ? '按勾选的任务内容取底色' : '加急任务的底色覆盖值'}
                      </span>
                      <span className="flex-1 h-px bg-gray-100" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {TASK_COLOR_FIELDS.filter(field => field.group === group).map(field => {
                        const value = colorDraft[field.key];
                        const fallback = DEFAULT_TASK_COLOR_CONFIG[field.key];
                        const textColor = getPreviewTextColor(field.key);
                        const bgValue = normalizeHexColor(value, fallback);
                        return (
                          <div
                            key={field.key}
                            className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden transition hover:shadow-md hover:border-blue-200"
                          >
                            <div
                              className="px-3 py-2 flex items-center justify-between gap-2"
                              style={{ backgroundColor: value, color: textColor }}
                            >
                              <span className="text-[13px] font-bold truncate">{field.label}</span>
                              <span
                                className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded"
                                style={{ color: textColor, backgroundColor: 'rgba(255,255,255,0.72)' }}
                              >
                                任务示例
                              </span>
                            </div>
                            <div className="p-3 space-y-2">
                              <ColorInput
                                label="底色"
                                value={bgValue}
                                fallback={fallback}
                                disabled={!isSuperAdmin || colorSaving}
                                onChange={(next) => setTaskColorField(field.key, next)}
                              />
                              <div className="flex items-center justify-between gap-2 pt-0.5">
                                <p className="text-[10px] text-gray-400 leading-snug">{field.hint}</p>
                                <span
                                  className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-50 border border-gray-100"
                                  style={{ color: textColor }}
                                >
                                  文字固定
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="px-6 py-3 bg-gray-50/80 border-t border-gray-100 flex items-center gap-2 text-[11px] text-gray-400">
                <AlertCircle size={12} />
                <span>
                  修改后点击「保存配色」生效；「恢复默认」会先二次确认，确认后立即把全部颜色改回系统默认值。
                  {!isSuperAdmin && ' 仅超级管理员可修改配色。'}
                </span>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default SystemSettings;
