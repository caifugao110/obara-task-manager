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
  Search
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getActionLabel, getBrowserLabel, getRoleClassName, getRoleLabel, LoginLog } from '../utils/loginLogs';

interface SystemSettingsData {
  allowGuestView: boolean;
  allowMultiDevice: boolean;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
  id: number;
}

const defaultSettings: SystemSettingsData = { allowGuestView: true, allowMultiDevice: true };

const SystemSettings = () => {
  const { user, token, logout } = useAuth();
  const [settings, setSettings] = useState<SystemSettingsData>(defaultSettings);
  const [loginLogs, setLoginLogs] = useState<LoginLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [importMonth, setImportMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [importConfirmed, setImportConfirmed] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isSuperAdmin = user?.role === 'superadmin';
  const authHeader = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

  const addToast = (message: string, type: 'success' | 'error') => {
    const id = Date.now();
    setToasts(prev => [...prev, { message, type, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  const fetchSettings = useCallback(async () => {
    try {
      const res = await axios.get('/api/system/settings');
      setSettings(res.data);
    } catch {
      addToast('无法加载系统设置', 'error');
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  const fetchLoginLogs = useCallback(async () => {
    if (!isSuperAdmin || !token) return;
    try {
      const res = await axios.get('/api/system/login-logs?limit=20', authHeader);
      setLoginLogs(res.data);
    } catch {
      addToast('无法加载登录历史', 'error');
    }
  }, [isSuperAdmin, token]);

  useEffect(() => {
    const init = async () => {
      await fetchSettings();
      await fetchLoginLogs();
      setLoading(false);
    };
    init();
  }, [fetchSettings, fetchLoginLogs]);

  const updateSettings = async (next: Partial<SystemSettingsData>) => {
    const updated = { ...settings, ...next };
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

  const handleExport = async () => {
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

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;

    setPendingImportFile(file);
    setImportConfirmed(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const cancelImport = () => {
    setPendingImportFile(null);
    setImportConfirmed(false);
  };

  const confirmImport = async () => {
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
      cancelImport();
    } catch (err: any) {
      const skipped = err.response?.data?.skippedDesigners?.length
        ? `；已跳过新增设计员：${err.response.data.skippedDesigners.join('、')}`
        : '';
      addToast(`${err.response?.data?.message || '导入失败'}${skipped}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  if (loading || !settingsLoaded) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <RefreshCw className="animate-spin text-blue-600 mb-4" size={48} />
        <div className="text-gray-600 font-medium">正在加载系统设置...</div>
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

      {pendingImportFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-800 flex items-center">
                <Upload className="mr-2 text-blue-600" size={20} />
                确认导入数据
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
                onClick={cancelImport}
                disabled={importing}
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition disabled:opacity-60"
              >
                取消
              </button>
              <button
                onClick={confirmImport}
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
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-2 flex items-center">
            <Download className="mr-2 text-green-600" size={22} />
            数据导入 / 导出
          </h3>
          <p className="text-sm text-gray-500 mb-6">导入文件需与本系统导出的 xls 格式一致；每次导入只能选择一个月份进行覆盖。</p>
          <div className="flex flex-wrap gap-4">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-2 px-5 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold rounded-xl transition"
            >
              {exporting ? <RefreshCw size={18} className="animate-spin" /> : <Download size={18} />}
              导出为 xls 表格
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl transition"
            >
              {importing ? <RefreshCw size={18} className="animate-spin" /> : <Upload size={18} />}
              从 xls 表格导入
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xls,.xlsx"
              className="hidden"
              onChange={handleImport}
            />
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
            <Shield className="mr-2 text-purple-600" size={22} />
            登录管理
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {[
              { label: '允许未登录用户查看主页面', detail: 'Guest View', key: 'allowGuestView' as const },
              { label: '允许多设备同时在线', detail: 'Multi Device', key: 'allowMultiDevice' as const }
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

          <div className="border-t border-gray-100 pt-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="font-bold text-gray-800 flex items-center">
                  <History className="mr-2 text-gray-500" size={20} />
                  最新登录信息
                </h4>
                <p className="text-xs text-gray-400 mt-1">显示最近 20 条所有登录用户记录</p>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  to="/login-logs"
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
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-400">暂无登录记录</td>
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
        </div>
      </main>
    </div>
  );
};

export default SystemSettings;
