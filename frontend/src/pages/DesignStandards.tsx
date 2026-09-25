import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import {
  ChevronLeft,
  BookOpen,
  ExternalLink,
  Database,
  Search,
  FileText,
  Sparkles,
  AlertCircle,
  Github,
  Globe,
  Shield,
  RefreshCw,
  LogOut,
  Send,
  Upload,
  Trash2,
  CheckCircle2,
  MessageSquare,
  FolderOpen,
  Loader2,
  Quote,
  Wifi,
  WifiOff,
  Settings2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/* ==================== 类型 ==================== */

interface Toast {
  message: string;
  type: 'success' | 'error';
  id: number;
}

interface SearchHit {
  id: string;
  content: string;
  score: number | null;
  matchType: string;
  knowledgeId: string;
  knowledgeTitle: string;
  chunkIndex: number | null;
  seq: number | null;
  startAt: number | null;
  endAt: number | null;
  metadata?: Record<string, string>;
}

interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  knowledgeCount: number | null;
}

interface DocumentItem {
  id: string;
  title: string;
  fileType: string;
  fileSize: number | null;
  parseStatus: string;
  createdAt: string | null;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  references?: SearchHit[];
  streaming?: boolean;
  error?: boolean;
}

interface WeknoraStatus {
  enabled: boolean;
  configured: boolean;
  reachable: boolean;
  baseUrl?: string;
  message?: string;
  code?: string;
  defaultKnowledgeBaseIds: string[];
  knowledgeBases: KnowledgeBase[];
}

type TabKey = 'search' | 'chat' | 'manage';

const defaultSettings = { enabled: true, allowAdmins: true, allowViewers: false };

/** 把字节数格式化成易读字符串 */
const formatSize = (bytes: number | null) => {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

/**
 * 去除回答文本中的引用标记。
 * WeKnora 会在正文里内联形如 <kb doc="..." chunk_id="..." kb_id="..." /> 的
 * 溯源标签，这里统一清理掉（引用出处已在回答下方单独展示），避免出现裸标签文本。
 */
const stripCitations = (text: string) =>
  (text || '')
    .replace(/[ \t]*<kb\b[^>]*?\/?>/g, '')
    .replace(/[ \t]+([，。；：、！？）])/g, '$1')
    .trim();

/** 解析状态徽标样式 */
const parseStatusStyle = (status: string) => {
  const s = (status || '').toLowerCase();
  if (['success', 'completed', 'done', 'processed', 'finished'].includes(s)) {
    return { cls: 'bg-green-100 text-green-700 border-green-200', label: '已就绪' };
  }
  if (['processing', 'pending', 'running', 'parsing', 'queued'].includes(s)) {
    return { cls: 'bg-amber-100 text-amber-700 border-amber-200', label: '解析中' };
  }
  if (['failed', 'error'].includes(s)) {
    return { cls: 'bg-red-100 text-red-700 border-red-200', label: '解析失败' };
  }
  return { cls: 'bg-gray-100 text-gray-600 border-gray-200', label: status || '未知' };
};

/**
 * 设计规范知识库页面
 *
 * 底层接入本地部署的 WeKnora（https://github.com/Tencent/WeKnora）：
 * - GitHub 仓库: https://github.com/Tencent/WeKnora
 * - 官方网站:    https://weknora.weixin.qq.com/
 *
 * 前端不直接访问 WeKnora，统一经由后端 /api/design-standards/* 代理，
 * 凭证仅保存在后端环境变量中。查看权限与 /work-hours 页面一致，
 * 超级管理员可在底部进行权限设置。
 */
const DesignStandards: React.FC = () => {
  const { user, token, logout } = useAuth();
  const [settings, setSettings] = useState(defaultSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [tab, setTab] = useState<TabKey>('search');
  const [status, setStatus] = useState<WeknoraStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // 规范检索
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searched, setSearched] = useState(false);

  // 智能问答
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [streaming, setStreaming] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // 知识库管理
  const [selectedKb, setSelectedKb] = useState('');
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isSuperAdmin = user?.role === 'superadmin';
  const isAdmin = user?.role === 'admin' || isSuperAdmin;

  const authHeader = useMemo(
    () => (token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    [token]
  );

  const addToast = useCallback((message: string, type: 'success' | 'error') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { message, type, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const canViewDesignStandards = useMemo(() => {
    if (isSuperAdmin) return true;
    if (!settings.enabled) return false;
    if (!user) return false;
    if (user.role === 'admin' && settings.allowAdmins) return true;
    if (user.role === 'user' && settings.allowViewers) return true;
    return false;
  }, [isSuperAdmin, settings, user]);

  const online = !!status?.reachable;

  /* ==================== 数据获取 ==================== */

  const fetchSettings = useCallback(async () => {
    try {
      const res = await axios.get('/api/settings/design-standards');
      setSettings(res.data);
    } catch (err) {
      console.error('Error fetching design-standards settings:', err);
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await axios.get('/api/design-standards/status', authHeader);
      setStatus(res.data);
    } catch (err: any) {
      setStatus({
        enabled: false,
        configured: false,
        reachable: false,
        message: err?.response?.data?.message || '无法连接知识库服务',
        defaultKnowledgeBaseIds: [],
        knowledgeBases: [],
      });
    } finally {
      setStatusLoading(false);
    }
  }, [authHeader]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (settingsLoaded && canViewDesignStandards) fetchStatus();
  }, [settingsLoaded, canViewDesignStandards, fetchStatus]);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages]);

  const fetchDocuments = useCallback(
    async (kbId: string) => {
      if (!kbId) return;
      setDocsLoading(true);
      try {
        const res = await axios.get(
          `/api/design-standards/knowledge-bases/${kbId}/documents`,
          authHeader
        );
        setDocuments(res.data.documents || []);
      } catch (err: any) {
        addToast(err?.response?.data?.message || '获取文档列表失败', 'error');
        setDocuments([]);
      } finally {
        setDocsLoading(false);
      }
    },
    [authHeader, addToast]
  );

  /* ==================== 规范检索 ==================== */

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) {
      addToast('请输入检索内容', 'error');
      return;
    }
    setSearching(true);
    setSearched(true);
    try {
      const res = await axios.post('/api/design-standards/search', { query: q }, authHeader);
      setHits(res.data.results || []);
    } catch (err: any) {
      setHits([]);
      addToast(err?.response?.data?.message || '检索失败', 'error');
    } finally {
      setSearching(false);
    }
  };

  /* ==================== 智能问答（SSE 流式） ==================== */

  const handleChat = async () => {
    const q = chatInput.trim();
    if (!q || streaming) return;

    setChatInput('');
    setMessages(prev => [...prev, { role: 'user', content: q }]);
    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }]);
    setStreaming(true);

    const appendToLast = (patch: (m: ChatMessage) => ChatMessage) => {
      setMessages(prev => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === 'assistant' && next[i].streaming) {
            next[i] = patch(next[i]);
            break;
          }
        }
        return next;
      });
    };

    try {
      const res = await fetch('/api/design-standards/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query: q, sessionId: sessionId || undefined }),
      });

      if (!res.ok || !res.body) {
        let message = '问答请求失败';
        try {
          const data = await res.json();
          message = data.message || message;
        } catch {
          /* 忽略解析失败 */
        }
        throw new Error(message);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      const handleEvent = (payload: any) => {
        if (payload.type === 'session' && payload.sessionId) {
          setSessionId(payload.sessionId);
        } else if (payload.type === 'references' && payload.references?.length) {
          appendToLast(m => ({ ...m, references: payload.references }));
        } else if (payload.type === 'answer' && payload.content) {
          appendToLast(m => ({ ...m, content: m.content + payload.content }));
        } else if (payload.type === 'error') {
          appendToLast(m => ({ ...m, content: m.content || payload.message, error: true }));
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sep;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const dataLine = chunk
            .split('\n')
            .filter(l => l.startsWith('data:'))
            .map(l => l.slice(5).trim())
            .join('');
          if (!dataLine) continue;
          try {
            handleEvent(JSON.parse(dataLine));
          } catch {
            /* 忽略不完整帧 */
          }
        }
      }

      appendToLast(m => ({ ...m, streaming: false }));
    } catch (err: any) {
      appendToLast(m => ({
        ...m,
        streaming: false,
        error: true,
        content: m.content || err.message,
      }));
      addToast(err.message || '问答失败', 'error');
    } finally {
      setStreaming(false);
    }
  };

  /* ==================== 知识库管理 ==================== */

  const handleUpload = async (file: File) => {
    if (!selectedKb) {
      addToast('请先选择知识库', 'error');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await axios.post(`/api/design-standards/knowledge-bases/${selectedKb}/documents`, form, {
        ...authHeader,
        headers: { ...authHeader.headers, 'Content-Type': 'multipart/form-data' },
      });
      addToast(`《${file.name}》已提交解析`, 'success');
      fetchDocuments(selectedKb);
    } catch (err: any) {
      addToast(err?.response?.data?.message || '上传失败', 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteDocument = async (doc: DocumentItem) => {
    if (!window.confirm(`确认删除《${doc.title}》？该操作不可撤销。`)) return;
    try {
      await axios.delete(`/api/design-standards/documents/${doc.id}`, authHeader);
      addToast('文档已删除', 'success');
      setDocuments(prev => prev.filter(d => d.id !== doc.id));
    } catch (err: any) {
      addToast(err?.response?.data?.message || '删除失败', 'error');
    }
  };

  /* ==================== 权限设置（仅超管） ==================== */

  const updateSettings = async (next: Partial<typeof settings>) => {
    const updated = { ...settings, ...next };
    if (next.enabled === false) {
      updated.allowAdmins = false;
      updated.allowViewers = false;
    }
    if (next.enabled === true) {
      updated.allowAdmins = true;
      updated.allowViewers = true;
    }
    if (next.allowAdmins === false && updated.allowViewers) {
      addToast('普通用户权限开启时，不能关闭一般管理员权限', 'error');
      return;
    }
    if (updated.allowViewers) updated.allowAdmins = true;
    setSettings(updated);
    if (!isSuperAdmin) return;

    try {
      await axios.put('/api/settings/design-standards', updated, authHeader);
      addToast('权限设置已保存', 'success');
    } catch (err) {
      console.error('Error saving design-standards settings:', err);
      addToast('保存设计规范知识库权限设置失败', 'error');
    }
  };

  /* ==================== 渲染 ==================== */

  // 加载中
  if (!settingsLoaded) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <RefreshCw className="animate-spin text-blue-600 mb-4" size={48} />
        <div className="text-gray-600 font-medium">正在加载设计规范知识库...</div>
      </div>
    );
  }

  // 无权限访问
  if (!canViewDesignStandards) {
    const isClosed = !settings.enabled;
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col">
        <header className="bg-white shadow-sm px-6 py-2 h-12 flex items-center justify-between border-b border-gray-200">
          <Link to="/" className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 font-bold transition">
            <ChevronLeft size={20} />
            <span>返回工作台</span>
          </Link>
          {user && (
            <button onClick={logout} className="flex items-center space-x-1.5 text-gray-600 hover:text-red-600 text-sm font-semibold transition">
              <LogOut size={18} />
              <span>退出</span>
            </button>
          )}
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <BookOpen size={64} className="mx-auto text-gray-300 mb-4" />
            <h2 className="text-xl font-bold text-gray-600">{isClosed ? '设计规范知识库已关闭' : '暂无权限访问设计规范知识库'}</h2>
            <p className="text-gray-400 mt-2">
              {isClosed ? '请联系超级管理员开启此功能' : '请联系超级管理员开启对应权限'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const tabs: { key: TabKey; label: string; icon: any; adminOnly?: boolean }[] = [
    { key: 'search', label: '规范检索', icon: Search },
    { key: 'chat', label: '智能问答', icon: MessageSquare },
    { key: 'manage', label: '知识库管理', icon: Settings2, adminOnly: true },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex flex-col">
      {/* 顶部 Toast */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-white transition-all duration-300 ${
              toast.type === 'error' ? 'bg-red-500' : 'bg-green-500'
            }`}
          >
            {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        ))}
      </div>

      {/* 顶部导航 */}
      <header className="sticky top-0 z-40 bg-white shadow-md px-6 py-2 h-12 flex items-center justify-between border-b border-gray-200">
        <div className="flex items-center space-x-4">
          <Link to="/" className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 font-bold transition">
            <ChevronLeft size={20} />
            <span>返回工作台</span>
          </Link>
          <div className="h-6 w-[1px] bg-gray-200 mx-2"></div>
          <h2 className="text-xl font-bold text-blue-600 flex items-center">
            <BookOpen className="text-blue-500 mr-2" size={24} />
            设计规范知识库
            <span
              className={`ml-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
                statusLoading
                  ? 'bg-gray-100 text-gray-500 border-gray-200'
                  : online
                  ? 'bg-green-100 text-green-700 border-green-300'
                  : 'bg-red-100 text-red-700 border-red-300'
              }`}
            >
              {statusLoading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : online ? (
                <Wifi size={12} />
              ) : (
                <WifiOff size={12} />
              )}
              {statusLoading ? '连接中' : online ? '已连接' : '未连接'}
            </span>
          </h2>
        </div>

        {user && (
          <div className="flex items-center space-x-4">
            <span className="text-sm font-bold text-red-600">{user.name}</span>
            <button
              onClick={logout}
              className="flex items-center space-x-1.5 text-gray-600 hover:text-red-600 text-sm font-semibold transition"
            >
              <LogOut size={18} />
              <span>退出</span>
            </button>
          </div>
        )}
      </header>

      {/* 主体内容 */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8 pb-24">
        {/* 状态卡 */}
        <section className="bg-white rounded-2xl shadow-sm border border-blue-100 p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-md">
              <BookOpen className="text-white" size={24} />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-gray-800 mb-1">设计规范知识库</h1>
              <p className="text-sm text-gray-500 leading-relaxed">
                基于本地部署的
                <span className="mx-1 font-semibold text-blue-600">WeKnora</span>
                知识库，提供规范检索与智能问答，回答均附带引用出处。
              </p>

              {!online && !statusLoading && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                  <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
                  <div className="text-xs text-amber-700 leading-relaxed">
                    <span className="font-semibold">知识库服务未就绪：</span>
                    {status?.message || '请确认 WeKnora 容器已启动，且后端已配置 WEKNORA_API_KEY'}
                  </div>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <a
                  href="https://github.com/Tencent/WeKnora"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-900 hover:bg-gray-800 text-white text-xs font-medium transition"
                >
                  <Github size={14} />
                  GitHub 仓库
                  <ExternalLink size={11} className="opacity-70" />
                </a>
                <a
                  href="http://localhost"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition"
                >
                  <Globe size={14} />
                  WeKnora 控制台
                  <ExternalLink size={11} className="opacity-70" />
                </a>
                <button
                  onClick={fetchStatus}
                  disabled={statusLoading}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 hover:border-blue-300 hover:text-blue-600 text-gray-600 text-xs font-medium transition disabled:opacity-50"
                >
                  <RefreshCw size={13} className={statusLoading ? 'animate-spin' : ''} />
                  刷新状态
                </button>
                {online && status?.knowledgeBases?.length ? (
                  <span className="text-xs text-gray-400">已接入 {status.knowledgeBases.length} 个知识库</span>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {/* 功能切换 */}
        <div className="flex items-center gap-2 mb-4">
          {tabs
            .filter(t => !t.adminOnly || isAdmin)
            .map(t => {
              const Icon = t.icon;
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => {
                    setTab(t.key);
                    if (t.key === 'manage' && !selectedKb && status?.knowledgeBases?.length) {
                      const first = status.knowledgeBases[0].id;
                      setSelectedKb(first);
                      fetchDocuments(first);
                    }
                  }}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${
                    active
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-white text-gray-600 border border-gray-200 hover:border-blue-300 hover:text-blue-600'
                  }`}
                >
                  <Icon size={16} />
                  {t.label}
                </button>
              );
            })}
        </div>

        {/* ========== 规范检索 ========== */}
        {tab === 'search' && (
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-3">
              <div className="flex-1 relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="输入关键词检索设计规范，例如：枪体材质要求、螺纹公差等级…"
                  disabled={!online}
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none text-sm transition disabled:bg-gray-50 disabled:cursor-not-allowed"
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={searching || !online}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                检索
              </button>
            </div>

            {!online && (
              <div className="mt-4 text-sm text-gray-400 flex items-center gap-2">
                <AlertCircle size={15} />
                知识库未连接，检索功能暂不可用
              </div>
            )}

            {searched && !searching && (
              <div className="mt-6">
                <div className="text-xs text-gray-400 mb-3">
                  共命中 <span className="font-bold text-blue-600">{hits.length}</span> 条规范条款
                </div>
                {hits.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <FileText size={40} className="mx-auto mb-3 text-gray-300" />
                    <div className="text-sm">未命中相关规范，换个说法试试</div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {hits.map(hit => (
                      <article
                        key={hit.id}
                        className="rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm p-4 transition"
                      >
                        <header className="flex items-center justify-between gap-3 mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText size={15} className="text-blue-500 shrink-0" />
                            <span className="text-sm font-semibold text-gray-700 truncate">
                              {hit.knowledgeTitle || '未命名文档'}
                            </span>
                            {hit.chunkIndex !== null && hit.chunkIndex !== undefined && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">
                                第 {hit.chunkIndex + 1} 段
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {hit.matchType && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium">
                                {hit.matchType}
                              </span>
                            )}
                            {hit.score !== null && (
                              <span className="text-[11px] font-mono text-gray-400">{hit.score.toFixed(3)}</span>
                            )}
                          </div>
                        </header>
                        <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap line-clamp-6">
                          {hit.content}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* ========== 智能问答 ========== */}
        {tab === 'chat' && (
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col">
            <div className="overflow-y-auto px-6 py-5 space-y-5" style={{ maxHeight: '560px', minHeight: '420px' }}>
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 py-16">
                  <Sparkles size={44} className="text-blue-300 mb-4" />
                  <div className="font-semibold text-gray-500">基于本地知识库的规范问答</div>
                  <p className="text-xs mt-2 max-w-md leading-relaxed">
                    回答由 WeKnora 检索设计规范后生成，并给出引用出处。
                    试试问：「枪体表面处理的验收标准是什么？」
                  </p>
                </div>
              )}

              {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] ${msg.role === 'user' ? '' : 'w-full'}`}>
                    <div
                      className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.role === 'user'
                          ? 'bg-blue-600 text-white'
                          : msg.error
                          ? 'bg-red-50 text-red-700 border border-red-200'
                          : 'bg-gray-50 text-gray-700 border border-gray-100'
                      }`}
                    >
                      {stripCitations(msg.content) ||
                        (msg.streaming ? (
                          <span className="inline-flex items-center gap-2 text-gray-400">
                            <Loader2 size={14} className="animate-spin" />
                            正在检索规范并生成回答…
                          </span>
                        ) : (
                          ''
                        ))}
                    </div>

                    {msg.references && msg.references.length > 0 && (
                      <div className="mt-3 space-y-2">
                        <div className="text-[11px] font-semibold text-gray-400 flex items-center gap-1">
                          <Quote size={12} />
                          引用出处（{msg.references.length}）
                        </div>
                        {msg.references.map(ref => (
                          <div key={ref.id} className="rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2">
                            <div className="flex items-center gap-2 mb-1">
                              <FileText size={12} className="text-blue-500 shrink-0" />
                              <span className="text-[11px] font-semibold text-blue-700 truncate">
                                {ref.knowledgeTitle || '未命名文档'}
                              </span>
                              {ref.chunkIndex !== null && ref.chunkIndex !== undefined && (
                                <span className="text-[10px] text-blue-400">第 {ref.chunkIndex + 1} 段</span>
                              )}
                            </div>
                            <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-3">{ref.content}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <div className="border-t border-gray-100 px-6 py-4">
              <div className="flex items-end gap-3">
                <textarea
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleChat();
                    }
                  }}
                  rows={2}
                  placeholder={online ? '输入你的问题，Enter 发送，Shift+Enter 换行…' : '知识库未连接'}
                  disabled={!online || streaming}
                  className="flex-1 resize-none px-4 py-2.5 rounded-xl border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none text-sm transition disabled:bg-gray-50 disabled:cursor-not-allowed"
                />
                <button
                  onClick={handleChat}
                  disabled={!online || streaming || !chatInput.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {streaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  发送
                </button>
              </div>
              {messages.length > 0 && (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-gray-400">
                    {sessionId ? `会话 ${sessionId.slice(0, 8)}…` : ''}
                  </span>
                  <button
                    onClick={() => {
                      setMessages([]);
                      setSessionId('');
                    }}
                    className="text-[11px] text-gray-400 hover:text-red-500 transition"
                  >
                    清空对话
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ========== 知识库管理 ========== */}
        {tab === 'manage' && isAdmin && (
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <div className="flex flex-wrap items-center gap-3 mb-5">
              <div className="flex items-center gap-2">
                <FolderOpen size={16} className="text-blue-500" />
                <span className="text-sm font-semibold text-gray-700">知识库</span>
              </div>
              <select
                value={selectedKb}
                onChange={e => {
                  setSelectedKb(e.target.value);
                  fetchDocuments(e.target.value);
                }}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-blue-400 outline-none min-w-[220px]"
              >
                <option value="">请选择知识库</option>
                {(status?.knowledgeBases || []).map(kb => (
                  <option key={kb.id} value={kb.id}>
                    {kb.name}
                  </option>
                ))}
              </select>

              <div className="flex-1" />

              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.doc,.docx,.txt,.md,.xls,.xlsx,.ppt,.pptx"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!selectedKb || uploading || !online}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                上传文档
              </button>
            </div>

            {!online ? (
              <div className="text-sm text-gray-400 flex items-center gap-2 py-8 justify-center">
                <AlertCircle size={15} />
                知识库未连接
              </div>
            ) : !selectedKb ? (
              <div className="text-sm text-gray-400 text-center py-8">
                {(status?.knowledgeBases || []).length === 0
                  ? '尚未创建知识库，请先到 WeKnora 控制台创建'
                  : '请选择一个知识库'}
              </div>
            ) : docsLoading ? (
              <div className="text-sm text-gray-400 flex items-center gap-2 py-8 justify-center">
                <Loader2 size={15} className="animate-spin" />
                加载文档中…
              </div>
            ) : documents.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <Database size={36} className="mx-auto mb-3 text-gray-300" />
                <div className="text-sm">该知识库暂无文档，上传规范文件即可开始构建索引</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                      <th className="py-2 font-medium">文档名称</th>
                      <th className="py-2 font-medium w-24">类型</th>
                      <th className="py-2 font-medium w-24">大小</th>
                      <th className="py-2 font-medium w-24">状态</th>
                      <th className="py-2 font-medium w-20 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map(doc => {
                      const st = parseStatusStyle(doc.parseStatus);
                      return (
                        <tr key={doc.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="py-2.5 pr-4">
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText size={14} className="text-blue-400 shrink-0" />
                              <span className="truncate text-gray-700">{doc.title}</span>
                            </div>
                          </td>
                          <td className="py-2.5 text-gray-500 text-xs uppercase">{doc.fileType || '—'}</td>
                          <td className="py-2.5 text-gray-500 text-xs">{formatSize(doc.fileSize)}</td>
                          <td className="py-2.5">
                            <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${st.cls}`}>
                              {st.label}
                            </span>
                          </td>
                          <td className="py-2.5 text-right">
                            <button
                              onClick={() => handleDeleteDocument(doc)}
                              className="text-gray-400 hover:text-red-500 transition"
                              title="删除"
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-5 flex items-start gap-2 text-xs text-gray-400">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <p>
                文档解析在 WeKnora 中异步进行，上传后状态会经历「解析中 → 已就绪」，完成后即可被检索与问答命中。
                更多管理能力（分块查看、标签、FAQ 等）请到 WeKnora 控制台操作。
              </p>
            </div>
          </section>
        )}

        {/* 超级管理员权限设置区域 */}
        {isSuperAdmin && (
          <section className="mt-8 bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
              <Shield className="mr-2 text-purple-600" size={22} />
              设计规范知识库查看权限设置
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { label: '启用设计规范知识库', detail: 'Global Toggle', key: 'enabled' as const },
                { label: '一般管理员', detail: 'Admin Access', key: 'allowAdmins' as const },
                { label: '普通用户', detail: 'User Access', key: 'allowViewers' as const },
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
                      onChange={e => updateSettings({ [item.key]: e.target.checked })}
                      disabled={!settingsLoaded}
                      className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer z-10"
                    />
                    <label
                      className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer ${
                        settings[item.key] ? 'bg-blue-500' : 'bg-gray-300'
                      }`}
                    ></label>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 px-6 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]">
        <div className="max-w-6xl mx-auto flex justify-between items-center text-sm text-gray-500">
          <div>本地知识库 · WeKnora</div>
          <div className="flex items-center gap-2">
            <span className="font-medium">当前状态:</span>
            {online ? (
              <span className="text-green-600 flex items-center">
                <span className="w-2 h-2 bg-green-500 rounded-full mr-1"></span>
                已连接
              </span>
            ) : (
              <span className="text-red-500 flex items-center">
                <span className="w-2 h-2 bg-red-500 rounded-full mr-1"></span>
                未连接
              </span>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
};

export default DesignStandards;
