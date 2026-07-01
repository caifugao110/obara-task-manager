import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import {
  AlertCircle,
  CheckCircle,
  ChevronLeft,
  Filter,
  History,
  LogOut,
  RefreshCw,
  RotateCcw,
  Search
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getActionLabel, getBrowserLabel, getRoleClassName, getRoleLabel, LoginLog } from '../utils/loginLogs';

interface Filters {
  username: string;
  role: string;
  success: string;
  ip: string;
  browser: string;
  from: string;
  to: string;
  limit: string;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
  id: number;
}

const defaultFilters: Filters = {
  username: '',
  role: 'all',
  success: 'all',
  ip: '',
  browser: '',
  from: '',
  to: '',
  limit: '200'
};

const LoginLogs = () => {
  const { user, token, logout } = useAuth();
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(defaultFilters);
  const [logs, setLogs] = useState<LoginLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const authHeader = useMemo(() => token ? { headers: { Authorization: `Bearer ${token}` } } : {}, [token]);

  const addToast = (message: string, type: 'success' | 'error') => {
    const id = Date.now();
    setToasts(prev => [...prev, { message, type, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  const buildQuery = (targetFilters: Filters) => {
    const params = new URLSearchParams();
    Object.entries(targetFilters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return params.toString();
  };

  const fetchLogs = useCallback(async (targetFilters: Filters) => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await axios.get(`/api/system/login-logs?${buildQuery(targetFilters)}`, authHeader);
      setLogs(res.data);
    } catch {
      addToast('无法加载登录日志', 'error');
    } finally {
      setLoading(false);
    }
  }, [authHeader, token]);

  useEffect(() => {
    fetchLogs(defaultFilters);
  }, [fetchLogs]);

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedFilters(filters);
    fetchLogs(filters);
  };

  const resetFilters = () => {
    setFilters(defaultFilters);
    setAppliedFilters(defaultFilters);
    fetchLogs(defaultFilters);
  };

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
          <Link to="/system-settings" className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 font-bold transition">
            <ChevronLeft size={20} />
            <span>返回系统设置</span>
          </Link>
          <div className="h-6 w-[1px] bg-gray-200 mx-2"></div>
          <h2 className="text-xl font-bold text-blue-600 flex items-center">
            <History className="text-blue-500 mr-2" size={24} />
            登录日志
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

      <main className="flex-1 p-8 max-w-7xl mx-auto w-full space-y-6">
        <section className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-bold text-gray-800 flex items-center">
              <Filter className="mr-2 text-blue-600" size={22} />
              筛选条件
            </h3>
            <button
              onClick={() => fetchLogs(appliedFilters)}
              className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-bold"
            >
              <RefreshCw size={15} />
              刷新
            </button>
          </div>

          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <label className="block">
              <span className="block text-xs font-bold text-gray-500 mb-1.5">账号 / 姓名</span>
              <input
                value={filters.username}
                onChange={(e) => updateFilter('username', e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                placeholder="输入账号或姓名"
              />
            </label>

            <label className="block">
              <span className="block text-xs font-bold text-gray-500 mb-1.5">角色</span>
              <select
                value={filters.role}
                onChange={(e) => updateFilter('role', e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none bg-white"
              >
                <option value="all">全部角色</option>
                <option value="superadmin">超级管理员</option>
                <option value="admin">管理员</option>
                <option value="user">普通用户</option>
              </select>
            </label>

            <label className="block">
              <span className="block text-xs font-bold text-gray-500 mb-1.5">登录结果</span>
              <select
                value={filters.success}
                onChange={(e) => updateFilter('success', e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none bg-white"
              >
                <option value="all">全部结果</option>
                <option value="true">成功</option>
                <option value="false">失败</option>
              </select>
            </label>

            <label className="block">
              <span className="block text-xs font-bold text-gray-500 mb-1.5">IP</span>
              <input
                value={filters.ip}
                onChange={(e) => updateFilter('ip', e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                placeholder="输入 IP 片段"
              />
            </label>

            <label className="block">
              <span className="block text-xs font-bold text-gray-500 mb-1.5">浏览器信息</span>
              <input
                value={filters.browser}
                onChange={(e) => updateFilter('browser', e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                placeholder="Chrome / Windows / Mobile"
              />
            </label>

            <label className="block">
              <span className="block text-xs font-bold text-gray-500 mb-1.5">开始日期</span>
              <input
                type="date"
                value={filters.from}
                onChange={(e) => updateFilter('from', e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
              />
            </label>

            <label className="block">
              <span className="block text-xs font-bold text-gray-500 mb-1.5">结束日期</span>
              <input
                type="date"
                value={filters.to}
                onChange={(e) => updateFilter('to', e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
              />
            </label>

            <label className="block">
              <span className="block text-xs font-bold text-gray-500 mb-1.5">显示条数</span>
              <select
                value={filters.limit}
                onChange={(e) => updateFilter('limit', e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none bg-white"
              >
                <option value="50">50 条</option>
                <option value="100">100 条</option>
                <option value="200">200 条</option>
                <option value="500">500 条</option>
              </select>
            </label>

            <div className="md:col-span-2 xl:col-span-4 flex flex-wrap gap-3 pt-2">
              <button
                type="submit"
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition"
              >
                <Search size={16} />
                查询
              </button>
              <button
                type="button"
                onClick={resetFilters}
                className="flex items-center gap-2 px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg transition"
              >
                <RotateCcw size={16} />
                重置
              </button>
            </div>
          </form>
        </section>

        <section className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-800">日志列表</h3>
            <span className="text-sm text-gray-400">共 {logs.length} 条</span>
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
                  <th className="px-4 py-3 font-bold min-w-[210px]">浏览器信息</th>
                  <th className="px-4 py-3 font-bold">结果</th>
                  <th className="px-4 py-3 font-bold min-w-[260px]">User Agent</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                      <RefreshCw className="inline-block animate-spin mr-2" size={18} />
                      正在加载登录日志...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-gray-400">没有符合条件的登录记录</td>
                  </tr>
                ) : (
                  logs.map(log => (
                    <tr key={log.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-800">{log.username}</td>
                      <td className="px-4 py-3 text-gray-700">{log.name || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${getRoleClassName(log.role)}`}>
                          {getRoleLabel(log.role)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs whitespace-nowrap">{log.ip || '-'}</td>
                      <td className="px-4 py-3 text-gray-600">{getBrowserLabel(log)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold whitespace-nowrap ${log.success ? 'text-green-600' : 'text-red-600'}`}>
                          {getActionLabel(log)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs max-w-[360px] truncate" title={log.userAgent || ''}>
                        {log.userAgent || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
};

export default LoginLogs;
