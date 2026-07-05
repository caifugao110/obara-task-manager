import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ChevronLeft,
  RefreshCw,
  Filter,
  Clock,
  User,
  Shield,
  FileText,
  AlertCircle,
  CheckCircle,
  History,
  Download
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getActionTypeLabel, getBrowserLabel } from '../utils/loginLogs';

interface AuditLog {
  id: string;
  userId: string;
  username: string;
  name: string;
  role: string;
  action: string;
  method: string;
  path: string;
  ip: string;
  userAgent: string;
  browserInfo?: {
    summary?: string;
    browser?: string;
    os?: string;
    device?: string;
  };
  requestBody: string | null;
  responseStatus: number;
  responseMessage: string | null;
  durationMs: number;
  timestamp: string;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
  id: number;
}

interface FilterOptions {
  usernames: string[];
  actions: string[];
}

const SystemLogs = () => {
  const { token } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ usernames: [], actions: [] });
  const [filters, setFilters] = useState({
    username: '',
    action: '',
    method: '',
    ip: '',
    from: '',
    to: ''
  });
  const [showFilters, setShowFilters] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const authHeader = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

  const addToast = (message: string, type: 'success' | 'error') => {
    const id = Date.now();
    setToasts(prev => [...prev, { message, type, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  const fetchFilterOptions = useCallback(async () => {
    if (!token) return;
    try {
      const res = await axios.get('/api/system/audit-logs/filter-options', authHeader);
      setFilterOptions(res.data);
    } catch {
      // ignore
    }
  }, [token]);

  const fetchLogs = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
        ...filters
      });
      const res = await axios.get(`/api/system/audit-logs?${params}`, authHeader);
      setLogs(res.data.logs);
      setTotal(res.data.total);
    } catch {
      addToast('无法加载日志', 'error');
    } finally {
      setLoading(false);
    }
  }, [token, page, pageSize, filters]);

  useEffect(() => {
    fetchFilterOptions();
  }, [fetchFilterOptions]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const getMethodColor = (method: string) => {
    const colors: Record<string, string> = {
      GET: 'bg-green-100 text-green-700',
      POST: 'bg-blue-100 text-blue-700',
      PUT: 'bg-yellow-100 text-yellow-700',
      DELETE: 'bg-red-100 text-red-700',
      PATCH: 'bg-purple-100 text-purple-700'
    };
    return colors[method] || 'bg-gray-100 text-gray-700';
  };

  const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return 'text-green-600';
    if (status >= 400 && status < 500) return 'text-yellow-600';
    if (status >= 500) return 'text-red-600';
    return 'text-gray-600';
  };

  const handleFilterChange = (key: keyof typeof filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleResetFilters = () => {
    setFilters({ username: '', action: '', method: '', ip: '', from: '', to: '' });
    setPage(1);
  };

  const handleExport = async () => {
    if (!token) return;
    setExporting(true);
    try {
      const params = new URLSearchParams(filters);
      const res = await axios.get(`/api/system/audit-logs/export?${params}`, {
        ...authHeader,
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `audit-logs-${format(new Date(), 'yyyyMMddHHmmss')}.xls`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      addToast('导出成功', 'success');
    } catch (err: any) {
      if (err.response?.status === 404) {
        addToast('没有可导出的日志', 'error');
      } else {
        addToast('导出失败', 'error');
      }
    } finally {
      setExporting(false);
    }
  };

  const hasActiveFilters = Object.values(filters).some(v => v);

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
          <Link to="/system-settings" className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 font-bold transition">
            <ChevronLeft size={20} />
            <span>返回系统设置</span>
          </Link>
          <div className="h-6 w-[1px] bg-gray-200 mx-2"></div>
          <h2 className="text-xl font-bold text-blue-600 flex items-center">
            <History className="text-blue-500 mr-2" size={24} />
            操作日志
          </h2>
        </div>
      </header>

      <main className="flex-1 p-8 max-w-7xl mx-auto w-full">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="font-bold text-gray-800 flex items-center">
                <FileText className="mr-2 text-gray-500" size={20} />
                所有操作记录
              </h3>
              <p className="text-xs text-gray-400 mt-1">包含所有用户的所有操作信息，按时间倒序排列</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold transition ${showFilters || hasActiveFilters ? 'bg-blue-600 text-white' : 'border border-gray-200 text-gray-700 hover:bg-gray-100'}`}
              >
                <Filter size={15} />
                筛选
                {hasActiveFilters && <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">!</span>}
              </button>
              <button
                onClick={handleExport}
                disabled={exporting}
                className="flex items-center gap-2 px-5 py-3 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white font-bold rounded-xl transition"
              >
                {exporting ? <RefreshCw size={18} className="animate-spin" /> : <Download size={18} />}
                导出日志
              </button>
              <button
                onClick={fetchLogs}
                className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-100 transition"
              >
                <RefreshCw size={15} />
                刷新
              </button>
            </div>
          </div>

          {showFilters && (
            <div className="mb-6 p-4 bg-gray-50 rounded-xl border border-gray-100 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">用户名</label>
                <select
                  value={filters.username}
                  onChange={(e) => handleFilterChange('username', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                >
                  <option value="">全部</option>
                  {filterOptions.usernames.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">操作类型</label>
                <select
                  value={filters.action}
                  onChange={(e) => handleFilterChange('action', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                >
                  <option value="">全部</option>
                  {filterOptions.actions.map(act => (
                    <option key={act} value={act}>{getActionTypeLabel(act).label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">HTTP方法</label>
                <select
                  value={filters.method}
                  onChange={(e) => handleFilterChange('method', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                >
                  <option value="">全部</option>
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">IP地址</label>
                <input
                  type="text"
                  value={filters.ip}
                  onChange={(e) => handleFilterChange('ip', e.target.value)}
                  placeholder="搜索IP"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">开始日期</label>
                <input
                  type="date"
                  value={filters.from}
                  onChange={(e) => handleFilterChange('from', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">结束日期</label>
                <input
                  type="date"
                  value={filters.to}
                  onChange={(e) => handleFilterChange('to', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                />
              </div>
              <div className="col-span-full flex justify-end">
                {hasActiveFilters && (
                  <button
                    onClick={handleResetFilters}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                  >
                    重置筛选条件
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between mb-4 text-sm text-gray-500">
            <span>共 {total} 条记录</span>
            <span>显示第 {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, total)} 条</span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-left sticky top-0">
                <tr>
                  <th className="px-4 py-3 font-bold">时间</th>
                  <th className="px-4 py-3 font-bold">用户</th>
                  <th className="px-4 py-3 font-bold">操作类型</th>
                  <th className="px-4 py-3 font-bold">操作说明</th>
                  <th className="px-4 py-3 font-bold">方法</th>
                  <th className="px-4 py-3 font-bold">IP</th>
                  <th className="px-4 py-3 font-bold">状态码</th>
                  <th className="px-4 py-3 font-bold">耗时</th>
                  <th className="px-4 py-3 font-bold">浏览器信息</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center">
                      <RefreshCw className="inline-block animate-spin text-blue-600 mr-2" size={20} />
                      加载中...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-gray-400">暂无操作记录</td>
                  </tr>
                ) : (
                  logs.map(log => (
                    <tr key={log.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Clock size={14} className="text-gray-400" />
                          {format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <User size={14} className="text-gray-400" />
                          <div>
                            <div className="font-medium text-gray-800">{log.username}</div>
                            <div className="text-xs text-gray-500">{log.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-bold text-gray-800">{getActionTypeLabel(log).label}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-sm max-w-[200px]" title={getActionTypeLabel(log).description}>
                        <div className="flex items-start gap-2">
                          <Shield size={14} className="text-gray-400 mt-0.5" />
                          <span className="truncate">{getActionTypeLabel(log).description}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${getMethodColor(log.method)}`}>
                          {log.method}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs whitespace-nowrap">
                        {log.ip || '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-bold ${getStatusColor(log.responseStatus)}`}>
                          {log.responseStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                        {log.durationMs}ms
                      </td>
                      <td className="px-4 py-3 text-gray-600 max-w-[240px] truncate" title={log.userAgent || getBrowserLabel({ userAgent: log.userAgent, browserInfo: log.browserInfo })}>
                        {getBrowserLabel({ userAgent: log.userAgent, browserInfo: log.browserInfo })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {!loading && total > pageSize && (
            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-100 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                上一页
              </button>
              <div className="flex items-center gap-2">
                {Array.from({ length: Math.min(5, Math.ceil(total / pageSize)) }, (_, i) => {
                  const pageNum = i + 1;
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`w-8 h-8 rounded-lg text-sm font-bold transition ${page === pageNum ? 'bg-blue-600 text-white' : 'border border-gray-200 text-gray-700 hover:bg-gray-100'}`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
                {Math.ceil(total / pageSize) > 5 && (
                  <span className="text-gray-400">...</span>
                )}
              </div>
              <button
                onClick={() => setPage(p => Math.min(Math.ceil(total / pageSize), p + 1))}
                disabled={page >= Math.ceil(total / pageSize)}
                className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-100 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                下一页
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default SystemLogs;
