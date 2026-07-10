import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import {
  AlertCircle,
  CheckCircle,
  ChevronLeft,
  Download,
  LogOut,
  RefreshCw,
  Settings,
  Shield,
  Upload,
  History,
  Search,
  Database,
  Clock,
  FileSpreadsheet,
  ClipboardList
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getActionLabel, getBrowserLabel, getRoleClassName, getRoleLabel, LoginLog } from '../utils/loginLogs';

interface SystemSettingsData {
  allowGuestView: boolean;
  allowMultiDevice: boolean;
  allowUserDesignPlanColorMark: boolean;
  allowUserEditOwnTaskColor?: boolean;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
  id: number;
}

interface MaintenanceFile {
  name: string;
  path: string;
  size: number;
  mtime: string;
}

interface MaintenanceSettings {
  enabled: boolean;
  dailyBackupEnabled: boolean;
  dailyTaskExportEnabled: boolean;
  backupRetentionDays: number;
  scheduleTime: string;
  yearlyCleanupEnabled: boolean;
  yearlyCleanupMonth: number;
  yearlyCleanupCheckDays: number;
  yearlyTaskRetentionYears: number;
  backupDir: string;
  taskExportDir: string;
  yearlyArchiveDir: string;
}

interface MaintenanceStatus {
  settings: MaintenanceSettings;
  paths: { database: string; backupDir: string; taskExportDir: string; yearlyArchiveDir: string };
  files: { backups: MaintenanceFile[]; taskExports: MaintenanceFile[]; yearlyArchives: MaintenanceFile[] };
  scheduler: { running: boolean; nextRunAt?: string; lastRun?: any };
}

const defaultMaintenanceSettings: MaintenanceSettings = {
  enabled: true,
  dailyBackupEnabled: true,
  dailyTaskExportEnabled: true,
  backupRetentionDays: 30,
  scheduleTime: '00:30',
  yearlyCleanupEnabled: true,
  yearlyCleanupMonth: 1,
  yearlyCleanupCheckDays: 10,
  yearlyTaskRetentionYears: 1,
  backupDir: 'backups/database',
  taskExportDir: 'backups/task-exports',
  yearlyArchiveDir: 'backups/yearly-archives'
};

const defaultSettings: SystemSettingsData = { allowGuestView: true, allowMultiDevice: true, allowUserDesignPlanColorMark: true, allowUserEditOwnTaskColor: true };
const defaultAccessSettings = { enabled: true, allowAdmins: true, allowViewers: false };

const SystemSettings = () => {
  const { user, token, logout } = useAuth();
  const [settings, setSettings] = useState<SystemSettingsData>(defaultSettings);
  const [accessSettings, setAccessSettings] = useState(defaultAccessSettings);
  const [accessSettingsLoaded, setAccessSettingsLoaded] = useState(false);
  const [loginLogs, setLoginLogs] = useState<LoginLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<'data' | 'maintenance' | 'login' | 'logs'>('data');
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const fetchAccessSettings = useCallback(async () => {
    try {
      const res = await axios.get('/api/settings/system-settings');
      setAccessSettings(res.data);
    } catch {
      addToast('无法加载权限设置', 'error');
    } finally {
      setAccessSettingsLoaded(true);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await axios.get('/api/system/settings');
      const allowOwnDesignPlanColor = res.data.allowUserDesignPlanColorMark ?? res.data.allowUserEditOwnTaskColor ?? true;
      setSettings({
        ...defaultSettings,
        ...res.data,
        allowUserDesignPlanColorMark: allowOwnDesignPlanColor,
        allowUserEditOwnTaskColor: allowOwnDesignPlanColor
      });
    } catch {
      addToast('无法加载系统设置', 'error');
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  const fetchLoginLogs = useCallback(async () => {
    if (!isSuperAdmin || !token) return;
    try {
      const res = await axios.get('/api/system/admin-login-logs', authHeader);
      setLoginLogs(res.data);
    } catch {
      addToast('无法加载登录历史', 'error');
    }
  }, [isSuperAdmin, token]);



  const fetchMaintenanceStatus = useCallback(async () => {
    if (!isSuperAdmin || !token) return;
    setMaintenanceLoading(true);
    try {
      const res = await axios.get('/api/system/maintenance', authHeader);
      setMaintenanceStatus(res.data);
      setMaintenanceSettings({ ...defaultMaintenanceSettings, ...res.data.settings });
    } catch {
      addToast('\u6743\u9650\u8bbe\u7f6e\u52a0\u8f7d\u5931\u8d25', 'error');
    } finally {
      setMaintenanceLoading(false);
    }
  }, [isSuperAdmin, token]);

  useEffect(() => {
    const init = async () => {
      await Promise.all([fetchSettings(), fetchAccessSettings()]);
      await Promise.all([fetchLoginLogs(), fetchMaintenanceStatus()]);
      setLoading(false);
    };
    init();
  }, [fetchSettings, fetchAccessSettings, fetchLoginLogs, fetchMaintenanceStatus]);

  useEffect(() => {
    if (!isSuperAdmin && (activeTab === 'login' || activeTab === 'logs' || activeTab === 'maintenance')) {
      setActiveTab('data');
    }
  }, [isSuperAdmin, activeTab]);

  const updateSettings = async (next: Partial<SystemSettingsData>) => {
    const updated = { ...settings, ...next };
    if (next.allowUserDesignPlanColorMark !== undefined) {
      updated.allowUserEditOwnTaskColor = next.allowUserDesignPlanColorMark;
    }
    setSettings(updated);
    if (!isSuperAdmin) return;

    try {
      await axios.put('/api/system/settings', updated, authHeader);
      addToast('系统设置已保存', 'success');
    } catch {
      addToast('保存系统设置失败', 'error');
      fetchSettings();
    }
  };

  const updateAccessSettings = async (next: Partial<typeof defaultAccessSettings>) => {
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
      if (err.response?.status === 404) {
        addToast('没有可导出的数据', 'error');
      } else {
        addToast('导出失败', 'error');
      }
    } finally {
      setExporting(false);
    }
  };

  const updateMaintenanceField = <K extends keyof MaintenanceSettings>(key: K, value: MaintenanceSettings[K]) => {
    setMaintenanceSettings(prev => ({ ...prev, [key]: value }));
  };

  const saveMaintenanceSettings = async () => {
    if (!token) return;
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

  const runMaintenanceAction = async (url: string, successMessage: string, body: any = {}) => {
    if (!token) return;
    setMaintenanceLoading(true);
    try {
      await axios.post(url, body, authHeader);
      addToast(successMessage, 'success');
      await fetchMaintenanceStatus();
    } catch (err: any) {
      addToast(err.response?.data?.message || '操作失败', 'error');
    } finally {
      setMaintenanceLoading(false);
    }
  };

  const handleManualTaskExport = async () => {
    await runMaintenanceAction('/api/system/maintenance/export-tasks', '\u4efb\u52a1\u8868\u683c\u5df2\u5bfc\u51fa');
  };

  const formatFileSize = (size: number) => {
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`;
    return `${(size / 1024).toFixed(1)} KB`;
  };

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
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <RefreshCw className="animate-spin text-blue-600 mb-4" size={48} />
        <div className="text-gray-600 font-medium">正在加载系统设置...</div>
      </div>
    );
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
            <Settings className="text-blue-500 mr-2" size={24} />
            系统设置
          </h2>
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

      <div className="sticky top-[73px] z-30 bg-white border-b border-gray-200">
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

      <main className="flex-1 p-8 max-w-5xl mx-auto w-full space-y-8">
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
              <p className="text-sm text-gray-500 mb-6">导出状态跟踪表的数据，可以选择按生产计划月份或纳期月份进行筛选导出。</p>
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
                    生产计划月份
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
                  <p className="text-sm text-gray-500 mt-1">默认每天 00:30 备份数据库、导出任务数据，并清理 30 天前的普通备份。</p>
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

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                {[
                  { label: '启用自动维护', key: 'enabled' as const },
                  { label: '每日数据库备份', key: 'dailyBackupEnabled' as const },
                  { label: '每日任务表格导出', key: 'dailyTaskExportEnabled' as const },
                  { label: '年度任务清理', key: 'yearlyCleanupEnabled' as const }
                ].map(item => (
                  <label key={item.key} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100 font-bold text-gray-700">
                    {item.label}
                    <input type="checkbox" checked={Boolean(maintenanceSettings[item.key])} onChange={(e) => updateMaintenanceField(item.key, e.target.checked as any)} className="w-5 h-5 accent-blue-600" />
                  </label>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
                <label className="block"><span className="text-sm font-bold text-gray-700">每日执行时间</span><input type="time" value={maintenanceSettings.scheduleTime} onChange={(e) => updateMaintenanceField('scheduleTime', e.target.value)} className="mt-2 w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 outline-none" /></label>
                <label className="block"><span className="text-sm font-bold text-gray-700">备份保留天数</span><input type="number" min={1} value={maintenanceSettings.backupRetentionDays} onChange={(e) => updateMaintenanceField('backupRetentionDays', Number(e.target.value))} className="mt-2 w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 outline-none" /></label>
                <label className="block"><span className="text-sm font-bold text-gray-700">年度检测月份</span><input type="number" min={1} max={12} value={maintenanceSettings.yearlyCleanupMonth} onChange={(e) => updateMaintenanceField('yearlyCleanupMonth', Number(e.target.value))} className="mt-2 w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 outline-none" /></label>
                <label className="block"><span className="text-sm font-bold text-gray-700">月初检测天数</span><input type="number" min={1} max={31} value={maintenanceSettings.yearlyCleanupCheckDays} onChange={(e) => updateMaintenanceField('yearlyCleanupCheckDays', Number(e.target.value))} className="mt-2 w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 outline-none" /></label>
                <label className="block"><span className="text-sm font-bold text-gray-700">任务保留年数</span><input type="number" min={1} max={10} value={maintenanceSettings.yearlyTaskRetentionYears} onChange={(e) => updateMaintenanceField('yearlyTaskRetentionYears', Number(e.target.value))} className="mt-2 w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 outline-none" /></label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-5">
                <label className="block"><span className="text-sm font-bold text-gray-700">数据库备份目录</span><input value={maintenanceSettings.backupDir} onChange={(e) => updateMaintenanceField('backupDir', e.target.value)} className="mt-2 w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 outline-none" /></label>
                <label className="block"><span className="text-sm font-bold text-gray-700">任务导出目录</span><input value={maintenanceSettings.taskExportDir} onChange={(e) => updateMaintenanceField('taskExportDir', e.target.value)} className="mt-2 w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 outline-none" /></label>
                <label className="block"><span className="text-sm font-bold text-gray-700">年度永久归档目录</span><input value={maintenanceSettings.yearlyArchiveDir} onChange={(e) => updateMaintenanceField('yearlyArchiveDir', e.target.value)} className="mt-2 w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 outline-none" /></label>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
                <h3 className="font-bold text-gray-800 mb-4">手动维护</h3>
                <div className="grid grid-cols-1 gap-3">
                  <button onClick={() => runMaintenanceAction('/api/system/maintenance/backup', '数据库备份已完成')} disabled={maintenanceLoading} className="px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl transition">立即备份数据库</button>
                  <button onClick={handleManualTaskExport} disabled={maintenanceLoading || exporting} className="px-4 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold rounded-xl transition">立即导出任务数据</button>
                  <button onClick={() => runMaintenanceAction('/api/system/maintenance/cleanup-backups', '过期备份已清理')} disabled={maintenanceLoading} className="px-4 py-3 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white font-bold rounded-xl transition">清理过期备份</button>
                  <button onClick={() => runMaintenanceAction('/api/system/maintenance/yearly-cleanup', '年度任务清理检测已完成', { force: true })} disabled={maintenanceLoading} className="px-4 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-bold rounded-xl transition">执行年度清理检测</button>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
                <h3 className="font-bold text-gray-800 mb-4">运行状态</h3>
                <div className="space-y-3 text-sm text-gray-600">
                  <div><span className="font-bold text-gray-700">下次执行：</span>{maintenanceStatus?.scheduler?.nextRunAt ? format(new Date(maintenanceStatus.scheduler.nextRunAt), 'yyyy-MM-dd HH:mm') : '-'}</div>
                  <div><span className="font-bold text-gray-700">数据库：</span><span className="break-all">{maintenanceStatus?.paths?.database || '-'}</span></div>
                  <div><span className="font-bold text-gray-700">备份目录：</span><span className="break-all">{maintenanceStatus?.paths?.backupDir || '-'}</span></div>
                  <div><span className="font-bold text-gray-700">任务导出：</span><span className="break-all">{maintenanceStatus?.paths?.taskExportDir || '-'}</span></div>
                  <div><span className="font-bold text-gray-700">年度归档：</span><span className="break-all">{maintenanceStatus?.paths?.yearlyArchiveDir || '-'}</span></div>
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-amber-800">年度清理会先永久归档将删除的数据；例如 2027 年 1 月会删除 2026 年 1 月之前的任务数据。</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {[
                { title: '最近数据库备份', files: maintenanceStatus?.files?.backups || [] },
                { title: '最近任务导出', files: maintenanceStatus?.files?.taskExports || [] },
                { title: '年度永久归档', files: maintenanceStatus?.files?.yearlyArchives || [] }
              ].map(group => (
                <div key={group.title} className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
                  <h3 className="font-bold text-gray-800 mb-4">{group.title}</h3>
                  <div className="space-y-3">
                    {group.files.length === 0 ? <div className="text-sm text-gray-400">暂无文件</div> : group.files.map(file => (
                      <div key={file.path} className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                        <div className="text-sm font-bold text-gray-700 break-all">{file.name}</div>
                        <div className="text-xs text-gray-400 mt-1">{formatFileSize(file.size)} · {format(new Date(file.mtime), 'yyyy-MM-dd HH:mm')}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
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
                { label: '允许未登录用户查看主页面', detail: 'Guest View', key: 'allowGuestView' as const },
                { label: '允许多设备同时在线', detail: 'Multi Device', key: 'allowMultiDevice' as const },
                { label: '允许登录用户修改本人设计计划标记颜色', detail: 'Own Design Plan Color', key: 'allowUserDesignPlanColorMark' as const }
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
          </div>
        )}

        {activeTab === 'logs' && (
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
        )}
      </main>
    </div>
  );
};

export default SystemSettings;
