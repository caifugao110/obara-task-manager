import React, { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  RefreshCw,
  Filter,
  Clock,
  User,
  Shield,
  FileText,
  AlertCircle,
  CheckCircle,
  Download
} from 'lucide-react';
import { axiosInstance } from '../services/api';
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

interface OperationLogPanelProps {
  /** 外部提示通道：嵌入系统设置时复用父页面的 toast，避免出现两套浮层 */
  notify?: (message: string, type: 'success' | 'error') => void;
  /** 表头吸顶时距视口顶部的偏移（px）：需让开页面顶部固定的标题栏与标签栏 */
  stickyTop?: number;
}

/**
 * 操作日志明细面板（筛选 / 导出 / 列表 / 分页），嵌在系统设置「操作日志」标签页内。
 * 标题栏与表头随整页滚动吸附在页面标签栏下方，滚动时始终能看到列名。
 * 刷新时保留上一批数据、只标记「刷新中」，避免表体高度塌陷导致页面跳动。
 */
const OperationLogPanel: React.FC<OperationLogPanelProps> = ({ notify, stickyTop = 96 }) => {
  const { token } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  // loading 只用于首次加载（此时还没有任何行，可以显示占位行）
  const [loading, setLoading] = useState(true);
  // refreshing 用于已有数据时的再次拉取：不清空列表，只做轻量提示
  const [refreshing, setRefreshing] = useState(false);
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
  // 离线状态：综合浏览器 online/offline 事件、后端可达性广播与请求失败判定
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const isOffline = !isOnline;

  // 吸顶标题栏的实际高度：表头 sticky 偏移要让开它（标题换行/缩放时会变，用 ResizeObserver 跟随）
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(80);

  const addToast = (message: string, type: 'success' | 'error') => {
    if (notify) {
      notify(message, type);
      return;
    }
    const id = Date.now();
    setToasts(prev => [...prev, { message, type, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  // 离线时统一拦截操作（本面板为查看类页面，离线禁止导出、刷新、筛选等操作）
  const guardOffline = () => {
    if (!isOffline) return false;
    addToast('当前离线，禁止操作', 'error');
    return true;
  };

  // 请求失败且属于网络不可达时标记离线（页面已有数据时继续只读展示）
  const markOfflineIfNetworkError = useCallback((err: any) => {
    if (typeof navigator !== 'undefined' && (!navigator.onLine || err?.code === 'ERR_NETWORK' || err?.message === 'Network Error')) {
      setIsOnline(false);
      return true;
    }
    return false;
  }, []);

  const fetchFilterOptions = useCallback(async () => {
    if (!token) return;
    try {
      const res = await axiosInstance.get('/system/audit-logs/filter-options');
      setFilterOptions(res.data);
    } catch (err) {
      // 离线/服务不可达时静默处理（离线提示条已说明状态）
      markOfflineIfNetworkError(err);
    }
  }, [token, markOfflineIfNetworkError]);

  const fetchLogs = useCallback(async () => {
    if (!token) return;
    // 已有数据时只标记「刷新中」，不清空列表：表体高度不变，滚动位置也就不会跳
    setRefreshing(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
        ...filters
      });
      const res = await axiosInstance.get(`/system/audit-logs?${params}`);
      setLogs(res.data.logs);
      setTotal(res.data.total);
    } catch (err) {
      if (!markOfflineIfNetworkError(err)) addToast('无法加载日志', 'error');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [token, page, pageSize, filters, markOfflineIfNetworkError]);

  useEffect(() => {
    fetchFilterOptions();
  }, [fetchFilterOptions]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // 网络恢复/断开（浏览器事件 + 后端可达性广播）：恢复到在线后自动重新加载
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      fetchLogs();
      fetchFilterOptions();
    };
    const handleOffline = () => setIsOnline(false);
    const handleServerUnreachable = () => setIsOnline(false);
    const handleServerOnline = () => {
      setIsOnline(true);
      fetchLogs();
      fetchFilterOptions();
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('server-unreachable', handleServerUnreachable);
    window.addEventListener('server-online', handleServerOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('server-unreachable', handleServerUnreachable);
      window.removeEventListener('server-online', handleServerOnline);
    };
  }, [fetchLogs, fetchFilterOptions]);

  // 离线期间每 5 秒轻量探测后端是否恢复（成功时拦截器自动广播 server-online）
  useEffect(() => {
    if (!isOffline) return;
    const timer = setInterval(() => {
      axiosInstance.get('/auth/validate').catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [isOffline]);

  // 进入离线状态：关闭筛选面板，避免离线期间产生无法生效的筛选操作
  useEffect(() => {
    if (isOnline) return;
    setShowFilters(false);
  }, [isOnline]);

  // 量取吸顶标题栏高度：表头 sticky 偏移 = 标签栏偏移 + 标题栏高度（窗口缩放/换行时会变）
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const measure = () => setToolbarHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
    if (guardOffline()) return;
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleResetFilters = () => {
    if (guardOffline()) return;
    setFilters({ username: '', action: '', method: '', ip: '', from: '', to: '' });
    setPage(1);
  };

  const handleExport = async () => {
    if (!token || guardOffline()) return;
    setExporting(true);
    try {
      const params = new URLSearchParams(filters);
      const res = await axiosInstance.get(`/system/audit-logs/export?${params}`, {
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `操作日志-${format(new Date(), 'yyyyMMddHHmmss')}.xls`;
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
    <div className="bg-white rounded-2xl shadow-lg border border-gray-100">
      {!notify && (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
          {toasts.map(toast => (
            <div key={toast.id} className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-white transition-all duration-300 ${toast.type === 'error' ? 'bg-red-500' : 'bg-green-500'}`}>
              {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
              <span className="text-sm font-medium">{toast.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* 吸顶标题栏：与表头一起钉在页面标签栏下方；高度由 ResizeObserver 量取后传给表头做偏移 */}
      <div
        ref={toolbarRef}
        style={{ top: stickyTop }}
        className="sticky z-20 flex flex-wrap items-center justify-between gap-3 rounded-t-2xl border-b border-gray-100 bg-white px-6 py-4"
      >
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <FileText className="text-blue-600" size={22} />
            <span>所有操作记录</span>
            {refreshing && !loading && (
              <span className="flex items-center gap-1 text-xs font-medium text-blue-500">
                <RefreshCw size={12} className="animate-spin" />
                刷新中…
              </span>
            )}
          </h3>
          <p className="text-xs text-gray-400 mt-1">记录数据变更（新增/修改/删除/导入）与敏感操作（登录、导出等），常规页面浏览不记录，按操作时间由新到旧排列</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            onClick={() => { if (guardOffline()) return; setShowFilters(!showFilters); }}
            disabled={isOffline}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold transition disabled:opacity-60 disabled:cursor-not-allowed ${showFilters || hasActiveFilters ? 'bg-blue-600 text-white' : 'border border-gray-200 text-gray-700 hover:bg-gray-100'}`}
          >
            <Filter size={15} />
            筛选
            {hasActiveFilters && <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">!</span>}
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || isOffline}
            className="flex items-center gap-2 px-5 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded-xl transition"
          >
            {exporting ? <RefreshCw size={18} className="animate-spin" /> : <Download size={18} />}
            导出日志
          </button>
          <button
            onClick={() => { if (guardOffline()) return; fetchLogs(); }}
            disabled={isOffline || refreshing}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-100 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>
      </div>

      <div className="p-6">
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
            <label className="block text-xs font-bold text-gray-500 mb-1">请求方法</label>
            <select
              value={filters.method}
              onChange={(e) => handleFilterChange('method', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
            >
              <option value="">全部</option>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">IP地址</label>
            <input
              type="text"
              value={filters.ip}
              onChange={(e) => handleFilterChange('ip', e.target.value)}
              placeholder="请输入IP地址"
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
        <span>显示第 {total === 0 ? 0 : (page - 1) * pageSize + 1} - {Math.min(page * pageSize, total)} 条</span>
      </div>

      {/* 容器在桌面端不建立滚动上下文（md:overflow-x-visible），表头才能相对视口吸顶；
          窄屏保留横向滚动，牺牲吸顶换取列不被压缩 */}
      <div className="overflow-x-auto rounded-xl border border-gray-100 md:overflow-x-visible">
        <table className="w-full text-sm">
          <thead
            className="sticky z-10 bg-gray-50 text-gray-500 text-left shadow-[0_1px_0_0_rgba(0,0,0,0.08)]"
            style={{ top: stickyTop + toolbarHeight }}
          >
            <tr>
              <th className="px-4 py-3 font-bold">时间</th>
              <th className="px-4 py-3 font-bold">用户</th>
              <th className="px-4 py-3 font-bold">操作说明</th>
              <th className="px-4 py-3 font-bold">请求方法</th>
              <th className="px-4 py-3 font-bold">IP地址</th>
              <th className="px-4 py-3 font-bold">状态码</th>
              <th className="px-4 py-3 font-bold">耗时</th>
              <th className="px-4 py-3 font-bold">浏览器信息</th>
            </tr>
          </thead>
          {/* 只让数据行淡出，表头保持不透明，避免吸顶时透出后面的行 */}
          <tbody className={`transition-opacity duration-200 ${refreshing && !loading ? 'opacity-60' : ''}`}>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center">
                  <RefreshCw className="inline-block animate-spin text-blue-600 mr-2" size={20} />
                  加载中...
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">暂无操作记录</td>
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
            onClick={() => { if (guardOffline()) return; setPage(p => Math.max(1, p - 1)); }}
            disabled={page === 1 || isOffline}
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
                  onClick={() => { if (guardOffline()) return; setPage(pageNum); }}
                  disabled={isOffline}
                  className={`w-8 h-8 rounded-lg text-sm font-bold transition disabled:opacity-60 disabled:cursor-not-allowed ${page === pageNum ? 'bg-blue-600 text-white' : 'border border-gray-200 text-gray-700 hover:bg-gray-100'}`}
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
            onClick={() => { if (guardOffline()) return; setPage(p => Math.min(Math.ceil(total / pageSize), p + 1)); }}
            disabled={page >= Math.ceil(total / pageSize) || isOffline}
            className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-100 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            下一页
          </button>
        </div>
      )}
      </div>
    </div>
  );
};

export default OperationLogPanel;
