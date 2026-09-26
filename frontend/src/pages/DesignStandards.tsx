import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
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
  Home,
  Shield,
  RefreshCw,
  LogOut,
  Send,
  CheckCircle2,
  MessageSquare,
  FolderOpen,
  Loader2,
  Quote,
  Wifi,
  WifiOff,
  Settings2,
  X,
  Trash2,
  Upload,
  Link as LinkIcon,
  Unlink,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { axiosInstance } from '../services/api';

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
  tenantId?: number | null;
  tenantName?: string | null;
}

interface TenantStatus {
  tenantId: number | null;
  tenantName: string | null;
  reachable: boolean;
  message?: string;
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
  knowledgeBases: KnowledgeBase[];
  tenants?: TenantStatus[];
}

type TabKey = 'search' | 'chat' | 'manage';

/** 单个知识库的答复约束提示词配置（agentId 由后端在同步 WeKnora 智能体后回写） */
interface PromptKbEntry {
  prompt: string;
  agentId?: string;
  updatedAt?: string;
}

/** 答复约束提示词总配置：按知识库维度，仅超级管理员可维护 */
interface PromptConfig {
  enabled: boolean;
  knowledgeBases: Record<string, PromptKbEntry>;
}

const defaultSettings = { enabled: true, allowAdmins: true, allowViewers: false };
const defaultPromptConfig: PromptConfig = { enabled: false, knowledgeBases: {} };

/** 知识库服务状态静默轮询间隔：WeKnora 容器停止 / 重启后页面状态最迟在此周期内更新 */
const STATUS_POLL_INTERVAL_MS = 30000;

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
 * 知识库范围多选下拉框（规范检索 / 智能问答共用）
 *
 * 选中的知识库 ID 会随检索、问答请求传给后端（knowledgeBaseIds），
 * 后端不再使用 .env 中的默认 WEKNORA_KNOWLEDGE_BASE_IDS。
 */
const KbScopeSelect: React.FC<{
  knowledgeBases: KnowledgeBase[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}> = ({ knowledgeBases, selectedIds, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggleId = (id: string) => {
    onChange(
      selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]
    );
  };

  const tenantNames = [...new Set(knowledgeBases.map(kb => kb.tenantName).filter(Boolean))] as string[];
  const multiTenant = tenantNames.length > 1;

  const label =
    selectedIds.length === 0
      ? '选择知识库'
      : selectedIds.length === 1
      ? knowledgeBases.find(kb => kb.id === selectedIds[0])?.name || '1 个知识库'
      : `已选 ${selectedIds.length} 个知识库`;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition max-w-[260px] ${
          selectedIds.length
            ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
            : 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <Database size={14} className="shrink-0" />
        <span className="truncate">{label}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-80 max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl p-2">
          <div className="px-2 py-1.5 text-xs text-gray-400 flex items-center justify-between">
            <span>选择知识库（可多选）</span>
            <button
              type="button"
              className="text-blue-600 hover:text-blue-700 font-medium"
              onClick={() => onChange(knowledgeBases.map(kb => kb.id))}
            >
              全选
            </button>
          </div>
          {knowledgeBases.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs text-gray-400">暂无知识库</div>
          ) : (
            knowledgeBases.map(kb => {
              const checked = selectedIds.includes(kb.id);
              return (
                <label
                  key={kb.id}
                  className="flex items-start gap-2.5 px-2 py-2 rounded-lg hover:bg-blue-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleId(kb.id)}
                    className="mt-0.5 h-4 w-4 accent-blue-600"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm text-gray-700 truncate">{kb.name}</span>
                      {multiTenant && kb.tenantName && (
                        <span
                          className="text-[10px] px-1.5 py-px rounded bg-purple-50 text-purple-600 border border-purple-100 shrink-0"
                          title={`所属工作空间：${kb.tenantName}`}
                        >
                          {kb.tenantName}
                        </span>
                      )}
                      {kb.knowledgeCount !== null && kb.knowledgeCount !== undefined && (
                        <span className="text-[10px] text-gray-400 shrink-0">
                          {kb.knowledgeCount} 篇
                        </span>
                      )}
                    </span>
                    {kb.description && (
                      <span className="block text-xs text-gray-400 truncate">{kb.description}</span>
                    )}
                  </span>
                </label>
              );
            })
          )}
        </div>
      )}
    </div>
  );
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
  // 后端服务（本项目 node 服务）在线状态：socket 连接 + 浏览器网络事件综合判定
  const [backendOnline, setBackendOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const socketRef = useRef<Socket | null>(null);

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

  // 关联知识库弹窗（通过知识库 ID 关联）
  const [showLinkKb, setShowLinkKb] = useState(false);
  const [linkKbId, setLinkKbId] = useState('');
  const [linkingKb, setLinkingKb] = useState(false);

  // 规范检索 / 智能问答使用的知识库范围（由用户手动选择已关联的知识库）
  const [searchKbIds, setSearchKbIds] = useState<string[]>([]);
  const [chatKbIds, setChatKbIds] = useState<string[]>([]);

  // 答复约束提示词（仅超级管理员可维护，按知识库各配一条）
  const [promptConfig, setPromptConfig] = useState<PromptConfig>(defaultPromptConfig);
  const [promptKbId, setPromptKbId] = useState('');
  const [promptDraft, setPromptDraft] = useState('');
  const [promptSaving, setPromptSaving] = useState(false);
  const promptFileRef = useRef<HTMLInputElement | null>(null);
  // 答复约束提示词设置弹窗：由右上角超管名字左侧的按钮触发，在页面中央静态展示
  const [showPromptModal, setShowPromptModal] = useState(false);

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

  // 知识库在线 = 后端在线 且 WeKnora 可达；后端离线时所有知识库操作一并不可用
  const kbOnline = backendOnline && !!status?.reachable;

  /**
   * 问答选择的知识库是否跨越了多个 WeKnora 工作空间。
   * WeKnora 的会话是工作空间级资源，跨空间的知识库无法在同一会话中问答；
   * 纯检索不受此限制（后端会分组扇出后合并结果）。
   */
  const chatCrossTenant = useMemo(() => {
    const ids = new Set(
      chatKbIds
        .map(id => status?.knowledgeBases.find(kb => kb.id === id)?.tenantId)
        .filter(t => t !== undefined && t !== null)
    );
    return ids.size > 1;
  }, [chatKbIds, status]);

  const chatTenantNames = useMemo(() => {
    const names = new Set(
      chatKbIds
        .map(id => status?.knowledgeBases.find(kb => kb.id === id)?.tenantName)
        .filter((n): n is string => !!n)
    );
    return [...names];
  }, [chatKbIds, status]);

  /* ==================== 数据获取 ==================== */

  const fetchSettings = useCallback(async () => {
    try {
      // 走 axiosInstance 自动携带 Authorization，访客视图关闭时裸请求会被 guestViewMiddleware 拦为 401
      const res = await axiosInstance.get('/settings/design-standards');
      setSettings(res.data);
    } catch (err) {
      console.error('Error fetching design-standards settings:', err);
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  const fetchStatus = useCallback(async (options: { silent?: boolean } = {}) => {
    const { silent = false } = options;
    // 定时轮询为静默模式：不触发「连接中 / 刷新转圈」，避免页面周期性闪动
    if (!silent) setStatusLoading(true);
    try {
      const res = await axios.get('/api/design-standards/status', authHeader);
      setBackendOnline(true);
      setStatus(res.data);
    } catch (err: any) {
      // 无 HTTP 响应（ERR_NETWORK / ECONNREFUSED 等）说明后端服务本身不可达；
      // 有响应（如 401/403/500）则说明后端在线，只是知识库侧异常
      setBackendOnline(!!err?.response);
      setStatus({
        enabled: false,
        configured: false,
        reachable: false,
        message: err?.response?.data?.message || '无法连接知识库服务',
        knowledgeBases: [],
      });
    } finally {
      if (!silent) setStatusLoading(false);
    }
  }, [authHeader]);

  /**
   * 操作明确返回「连不上 WeKnora / 请求超时」时，立即把知识库标记为不可用，
   * 不必等待下一次定时轮询；保留知识库列表仅作展示，所有输入会因 reachable=false 被禁用。
   */
  const markKbOffline = useCallback((message?: string, code?: string) => {
    setStatus(prev =>
      prev
        ? { ...prev, reachable: false, message: message || prev.message, ...(code ? { code } : {}) }
        : prev
    );
  }, []);

  /** 判断错误是否为知识库服务侧的连接级故障 */
  const isKbConnectionError = (code?: string) =>
    code === 'WEKNORA_UNREACHABLE' || code === 'WEKNORA_TIMEOUT';

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (settingsLoaded && canViewDesignStandards) fetchStatus();
  }, [settingsLoaded, canViewDesignStandards, fetchStatus]);

  // 后端服务在线状态：socket 连接断开即视为后端离线，重连成功后自动刷新知识库状态
  useEffect(() => {
    if (!token || !canViewDesignStandards) return;
    const socket = io('/', {
      path: '/socket.io',
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 3000,
      timeout: 10000,
      auth: { token },
    });
    socketRef.current = socket;
    let hasConnectedOnce = false;

    socket.on('connect', () => {
      setBackendOnline(true);
      // 断线重连后重新拉取知识库状态（期间 WeKnora 可能也发生过变化）
      if (hasConnectedOnce) fetchStatus();
      hasConnectedOnce = true;
    });
    socket.on('disconnect', () => setBackendOnline(false));
    socket.on('connect_error', () => setBackendOnline(false));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, canViewDesignStandards, fetchStatus]);

  // 浏览器网络事件作为补充判定（本机断网时 socket 事件可能滞后）
  useEffect(() => {
    const handleOnline = () => setBackendOnline(true);
    const handleOffline = () => setBackendOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 知识库服务状态定时轮询：
  // socket 只反映 node 后端的存活，WeKnora 容器退出时后端仍在线，
  // 因此必须周期性调用 /status 主动探测，页面隐藏或本机离线时暂停。
  const pollInFlightRef = useRef(false);
  useEffect(() => {
    if (!canViewDesignStandards) return;

    const silentPoll = async () => {
      if (pollInFlightRef.current || document.hidden || !navigator.onLine) return;
      pollInFlightRef.current = true;
      try {
        await fetchStatus({ silent: true });
      } finally {
        pollInFlightRef.current = false;
      }
    };

    const timer = window.setInterval(silentPoll, STATUS_POLL_INTERVAL_MS);
    // 从其他标签页切回 / 最小化恢复时立即探测一次，尽快修正状态
    const handleVisibility = () => {
      if (!document.hidden) silentPoll();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [canViewDesignStandards, fetchStatus]);

  // 答复约束提示词仅超级管理员可见/可改，因此只在超管身份下加载
  const fetchPromptConfig = useCallback(async () => {
    if (!isSuperAdmin) return;
    try {
      const res = await axios.get('/api/settings/design-standards-prompt', authHeader);
      setPromptConfig({
        enabled: Boolean(res.data?.enabled),
        knowledgeBases: res.data?.knowledgeBases || {},
      });
    } catch (err) {
      console.error('Error fetching design-standards prompt config:', err);
    }
  }, [isSuperAdmin, authHeader]);

  useEffect(() => {
    fetchPromptConfig();
  }, [fetchPromptConfig]);

  // 切换知识库时把草稿同步成该库已保存的提示词
  useEffect(() => {
    if (!promptKbId) return;
    setPromptDraft(promptConfig.knowledgeBases[promptKbId]?.prompt || '');
  }, [promptKbId, promptConfig]);

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
        const data = err?.response?.data;
        addToast(data?.message || '获取文档列表失败', 'error');
        setDocuments([]);
        if (isKbConnectionError(data?.code)) markKbOffline(data?.message, data?.code);
      } finally {
        setDocsLoading(false);
      }
    },
    [authHeader, addToast, markKbOffline]
  );

  // 知识库从不可用恢复为可用时，重新拉取当前选中知识库的文档列表
  const prevReachableRef = useRef<boolean | null>(null);
  useEffect(() => {
    const reachable = !!status?.reachable;
    if (prevReachableRef.current === false && reachable && selectedKb) {
      fetchDocuments(selectedKb);
    }
    prevReachableRef.current = reachable;
  }, [status?.reachable, selectedKb, fetchDocuments]);

  /* ==================== 规范检索 ==================== */

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) {
      addToast('请输入检索内容', 'error');
      return;
    }
    if (!searchKbIds.length) {
      addToast('请先选择要检索的知识库', 'error');
      return;
    }
    setSearching(true);
    setSearched(true);
    try {
      const res = await axios.post(
        '/api/design-standards/search',
        { query: q, knowledgeBaseIds: searchKbIds },
        authHeader
      );
      setHits(res.data.results || []);
    } catch (err: any) {
      const data = err?.response?.data;
      setHits([]);
      addToast(data?.message || '检索失败', 'error');
      if (isKbConnectionError(data?.code)) markKbOffline(data?.message, data?.code);
    } finally {
      setSearching(false);
    }
  };

  /* ==================== 智能问答（SSE 流式） ==================== */

  const handleChat = async () => {
    const q = chatInput.trim();
    if (!q || streaming) return;
    if (!chatKbIds.length) {
      addToast('请先选择问答使用的知识库', 'error');
      return;
    }
    if (chatCrossTenant) {
      addToast('智能问答不支持跨工作空间选择知识库，请只保留同一工作空间下的知识库', 'error');
      return;
    }

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
        body: JSON.stringify({
          query: q,
          sessionId: sessionId || undefined,
          knowledgeBaseIds: chatKbIds,
        }),
      });

      if (!res.ok || !res.body) {
        let message = '问答请求失败';
        let code = '';
        try {
          const data = await res.json();
          message = data.message || message;
          code = data.code || '';
        } catch {
          /* 忽略解析失败 */
        }
        if (isKbConnectionError(code)) markKbOffline(message, code);
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
          // SSE 错误事件携带 code 时（后端在 catch 中透传），立即同步知识库状态
          if (isKbConnectionError(payload.code)) markKbOffline(payload.message, payload.code);
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

  const handleLinkKb = async () => {
    const kbId = linkKbId.trim();
    if (!kbId) {
      addToast('请输入知识库 ID', 'error');
      return;
    }
    setLinkingKb(true);
    try {
      const res = await axios.post(
        '/api/design-standards/knowledge-bases/link',
        { kbId },
        authHeader
      );
      const kb = res.data?.knowledgeBase;
      addToast(`知识库「${kb?.name || kbId}」关联成功`, 'success');
      setShowLinkKb(false);
      setLinkKbId('');
      await fetchStatus();
      if (kb?.id) {
        setSelectedKb(kb.id);
        fetchDocuments(kb.id);
      }
    } catch (err: any) {
      addToast(err?.response?.data?.message || '关联知识库失败', 'error');
    } finally {
      setLinkingKb(false);
    }
  };

  const handleUnlinkKb = async (kbId: string) => {
    const kb = status?.knowledgeBases?.find(k => k.id === kbId);
    if (!window.confirm(`确认取消关联知识库「${kb?.name || kbId}」？该操作仅移除本系统的关联记录，不会删除 WeKnora 中的知识库。`)) return;
    try {
      await axios.delete(`/api/design-standards/knowledge-bases/${kbId}`, authHeader);
      addToast('已取消关联', 'success');
      // 若取消关联的是当前选中的知识库，清空选择
      if (selectedKb === kbId) {
        setSelectedKb('');
        setDocuments([]);
      }
      // 从检索 / 问答范围中移除被取消关联的知识库
      setSearchKbIds(prev => prev.filter(id => id !== kbId));
      setChatKbIds(prev => prev.filter(id => id !== kbId));
      await fetchStatus();
    } catch (err: any) {
      addToast(err?.response?.data?.message || '取消关联失败', 'error');
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

  /* ==================== 答复约束提示词（仅超管） ==================== */

  /**
   * 提交提示词配置。
   * 后端会把每个知识库的提示词同步到 WeKnora 的自定义智能体上
   * （创建/更新/删除），并回写 agentId。
   */
  const persistPromptConfig = async (
    next: PromptConfig,
    successMessage: string
  ): Promise<boolean> => {
    setPromptSaving(true);
    try {
      const res = await axios.put('/api/settings/design-standards-prompt', next, authHeader);
      setPromptConfig({
        enabled: Boolean(res.data?.enabled),
        knowledgeBases: res.data?.knowledgeBases || {},
      });
      const syncErrors: { kbId: string; message: string }[] = res.data?.syncErrors || [];
      if (syncErrors.length) {
        const names = syncErrors
          .map(e => status?.knowledgeBases.find(kb => kb.id === e.kbId)?.name || e.kbId)
          .join('、');
        addToast(`已保存，但以下知识库同步失败：${names}。${syncErrors[0].message}`, 'error');
      } else {
        addToast(successMessage, 'success');
      }
      return true;
    } catch (err: any) {
      addToast(err?.response?.data?.message || '保存答复约束提示词失败', 'error');
      return false;
    } finally {
      setPromptSaving(false);
    }
  };

  const handleSavePrompt = async () => {
    if (!promptKbId) {
      addToast('请先选择知识库', 'error');
      return;
    }
    const prompt = promptDraft.trim();
    if (!prompt) {
      addToast('提示词不能为空，如需取消约束请点击「清除」', 'error');
      return;
    }
    const kbName = status?.knowledgeBases.find(kb => kb.id === promptKbId)?.name || '该知识库';
    await persistPromptConfig(
      {
        enabled: promptConfig.enabled,
        knowledgeBases: {
          ...promptConfig.knowledgeBases,
          [promptKbId]: { prompt },
        },
      },
      `「${kbName}」的答复约束提示词已保存并生效`
    );
  };

  const handleClearPrompt = async (kbId: string) => {
    const kbName = status?.knowledgeBases.find(kb => kb.id === kbId)?.name || '该知识库';
    if (!window.confirm(`确认清除「${kbName}」的答复约束提示词？清除后该库将恢复默认回答风格。`)) {
      return;
    }
    const nextKbs = { ...promptConfig.knowledgeBases };
    delete nextKbs[kbId];
    const ok = await persistPromptConfig(
      { enabled: promptConfig.enabled, knowledgeBases: nextKbs },
      `已清除「${kbName}」的答复约束提示词`
    );
    if (ok && promptKbId === kbId) setPromptDraft('');
  };

  const handleTogglePromptEnabled = async (enabled: boolean) => {
    await persistPromptConfig(
      { enabled, knowledgeBases: promptConfig.knowledgeBases },
      enabled ? '答复约束提示词已启用' : '答复约束提示词已停用（配置保留）'
    );
  };

  /** 从 .md / .markdown / .txt 文件导入提示词内容到编辑框 */
  const handleImportPromptFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复导入同一个文件
    if (!file) return;
    if (file.size > 512 * 1024) {
      addToast('文件过大（超过 512KB），请精简后再导入', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      if (!text.trim()) {
        addToast('文件内容为空', 'error');
        return;
      }
      if (text.length > 20000) {
        addToast(`「${file.name}」超过 20000 字符，已自动截断`, 'error');
      } else {
        addToast(`已导入「${file.name}」的内容`, 'success');
      }
      setPromptDraft(text.slice(0, 20000));
    };
    reader.onerror = () => addToast('读取文件失败', 'error');
    reader.readAsText(file);
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
                !backendOnline
                  ? 'bg-red-100 text-red-700 border-red-300'
                  : statusLoading
                  ? 'bg-gray-100 text-gray-500 border-gray-200'
                  : kbOnline
                  ? 'bg-green-100 text-green-700 border-green-300'
                  : 'bg-amber-100 text-amber-700 border-amber-300'
              }`}
              title={
                !backendOnline
                  ? '后端服务连接断开，请确认本地服务已启动'
                  : statusLoading
                  ? '正在检测知识库服务状态'
                  : kbOnline
                  ? '知识库服务正常'
                  : '后端正常，但 WeKnora 知识库服务不可达'
              }
            >
              {!backendOnline ? (
                <WifiOff size={12} />
              ) : statusLoading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : kbOnline ? (
                <Wifi size={12} />
              ) : (
                <WifiOff size={12} />
              )}
              {!backendOnline
                ? '后端离线'
                : statusLoading
                ? '连接中'
                : kbOnline
                ? '知识库已连接'
                : '知识库未连接'}
            </span>
          </h2>
        </div>

        {user && (
          <div className="flex items-center space-x-4">
            {isSuperAdmin && (
              <button
                type="button"
                title="答复约束提示词设置"
                onClick={() => {
                  setShowPromptModal(true);
                  // 首次打开时默认选中第一个知识库，方便直接编辑
                  if (!promptKbId && status?.knowledgeBases?.length) {
                    setPromptKbId(status.knowledgeBases[0].id);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 text-xs font-semibold transition"
              >
                <Sparkles size={14} className="shrink-0" />
                答复约束提示词
              </button>
            )}
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

      {/* 后端离线提示条（与其他页面离线提示样式一致） */}
      {!backendOnline && (
        <div className="relative z-50 shrink-0 bg-amber-500 text-white px-4 py-2 flex items-center justify-center gap-2 text-xs font-medium border-b border-amber-600 shadow-sm">
          <AlertCircle size={14} className="shrink-0" />
          <span>后端服务连接断开，页面数据暂不可用，服务恢复后将自动重连！</span>
        </div>
      )}

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

              {!backendOnline && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                  <AlertCircle size={16} className="text-red-600 mt-0.5 shrink-0" />
                  <div className="text-xs text-red-700 leading-relaxed">
                    <span className="font-semibold">后端服务未连接：</span>
                    请确认本地任务管理服务（Obara-Task-Management-Service-Console）已启动，恢复后将自动重连，也可点击「刷新状态」重试
                  </div>
                </div>
              )}

              {backendOnline && !kbOnline && !statusLoading && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                  <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
                  <div className="text-xs text-amber-700 leading-relaxed">
                    <span className="font-semibold">知识库服务未就绪：</span>
                    {status?.message || '请确认 WeKnora 容器已启动，且后端已配置 WEKNORA_API_KEY'}
                  </div>
                </div>
              )}

              {kbOnline && !statusLoading && status?.tenants?.some(t => !t.reachable) && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                  <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
                  <div className="text-xs text-amber-700 leading-relaxed">
                    <span className="font-semibold">部分工作空间无法访问：</span>
                    {status.tenants
                      .filter(t => !t.reachable)
                      .map(t => t.tenantName || `工作空间 ${t.tenantId ?? '?'}`)
                      .join('、')}
                    ，该空间下的知识库暂不可检索，请检查对应 API Key 是否有效
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
                  href="https://weknora.weixin.qq.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#07c160] hover:bg-[#06ad56] text-white text-xs font-medium transition"
                >
                  <Home size={14} />
                  WeKnora 官网
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
                  onClick={() => fetchStatus()}
                  disabled={statusLoading}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 hover:border-blue-300 hover:text-blue-600 text-gray-600 text-xs font-medium transition disabled:opacity-50"
                >
                  <RefreshCw size={13} className={statusLoading ? 'animate-spin' : ''} />
                  刷新状态
                </button>
                {kbOnline && status?.knowledgeBases?.length ? (
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
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold text-gray-400">检索范围</span>
              <KbScopeSelect
                knowledgeBases={status?.knowledgeBases || []}
                selectedIds={searchKbIds}
                onChange={setSearchKbIds}
                disabled={!kbOnline}
              />
              {kbOnline && searchKbIds.length === 0 && (
                <span className="text-xs text-red-400">请至少选择一个知识库</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="输入关键词检索设计规范"
                  disabled={!kbOnline}
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none text-sm transition disabled:bg-gray-50 disabled:cursor-not-allowed"
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={searching || !kbOnline || !searchKbIds.length}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                检索
              </button>
            </div>

            {!kbOnline && (
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
            <div className="border-b border-gray-100 px-6 py-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-400">问答知识库</span>
                <KbScopeSelect
                  knowledgeBases={status?.knowledgeBases || []}
                  selectedIds={chatKbIds}
                  onChange={ids => {
                    setChatKbIds(ids);
                    // 切换知识库范围后开启新会话，避免继续沿用旧会话的检索范围
                    if (ids.join(',') !== chatKbIds.join(',')) setSessionId('');
                  }}
                  disabled={!kbOnline}
                />
                {kbOnline && chatKbIds.length === 0 && (
                  <span className="text-xs text-red-400">请至少选择一个知识库</span>
                )}
                {kbOnline && chatCrossTenant && (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-700">
                    <AlertCircle size={12} className="shrink-0" />
                    问答不支持跨工作空间（已选：{chatTenantNames.join('、')}），请只保留同一工作空间
                  </span>
                )}
              </div>
            </div>
            <div className="overflow-y-auto px-6 py-5 space-y-5" style={{ maxHeight: '560px', minHeight: '420px' }}>
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 py-16">
                  <Sparkles size={44} className="text-blue-300 mb-4" />
                  <div className="font-semibold text-gray-500">基于本地知识库的规范问答</div>
                  <p className="text-xs mt-2 max-w-md leading-relaxed">
                    回答由 WeKnora 检索设计规范后生成，并给出引用出处。
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
                  placeholder={kbOnline ? '输入你的问题，Enter 发送，Shift+Enter 换行…' : '知识库未连接'}
                  disabled={!kbOnline || streaming}
                  className="flex-1 resize-none px-4 py-2.5 rounded-xl border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none text-sm transition disabled:bg-gray-50 disabled:cursor-not-allowed"
                />
                <button
                  onClick={handleChat}
                  disabled={
                    !kbOnline ||
                    streaming ||
                    !chatInput.trim() ||
                    !chatKbIds.length ||
                    chatCrossTenant
                  }
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

              <button
                onClick={() => setShowLinkKb(true)}
                disabled={!kbOnline}
                title={kbOnline ? '通过知识库 ID 关联知识库' : '知识库未连接'}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-600 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <LinkIcon size={15} />
                关联知识库
              </button>

              <button
                onClick={() => selectedKb && handleUnlinkKb(selectedKb)}
                disabled={!selectedKb || !kbOnline}
                title={selectedKb ? '取消关联当前知识库' : '请先选择知识库'}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Unlink size={15} />
                取消关联
              </button>
            </div>

            {!kbOnline ? (
              <div className="text-sm text-gray-400 flex items-center gap-2 py-8 justify-center">
                <AlertCircle size={15} />
                知识库未连接
              </div>
            ) : !selectedKb ? (
              <div className="text-sm text-gray-400 text-center py-8">
                {(status?.knowledgeBases || []).length === 0
                  ? '尚未关联知识库，点击上方「关联知识库」输入知识库 ID 进行关联'
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
                <div className="text-sm">该知识库暂无文档，请到 WeKnora 控制台上传规范文件</div>
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
                知识库通过「知识库 ID」关联到本系统，文档的上传、删除与更多管理能力请到 WeKnora 控制台操作。
                文档解析在 WeKnora 中异步进行，状态会经历「解析中 → 已就绪」，完成后即可被检索与问答命中。
              </p>
            </div>

            {/* 关联知识库弹窗（通过知识库 ID 关联） */}
            {showLinkKb && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
                onClick={() => !linkingKb && setShowLinkKb(false)}
              >
                <div
                  className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                      <LinkIcon size={20} className="text-blue-500" />
                      关联知识库
                    </h3>
                    <button
                      onClick={() => setShowLinkKb(false)}
                      disabled={linkingKb}
                      className="text-gray-400 hover:text-gray-600 transition disabled:opacity-50"
                    >
                      <X size={20} />
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 mb-1">
                        知识库 ID <span className="text-red-500">*</span>
                      </label>
                      <input
                        value={linkKbId}
                        onChange={e => setLinkKbId(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !linkingKb && linkKbId.trim()) handleLinkKb();
                        }}
                        disabled={linkingKb}
                        autoFocus
                        placeholder="粘贴 WeKnora 知识库的 ID"
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono focus:border-blue-400 outline-none disabled:opacity-60"
                      />
                    </div>
                    <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700 leading-relaxed">
                      <span className="font-semibold">获取方式：</span>
                      在 WeKnora 控制台（
                      <a
                        href="http://localhost/platform/knowledge-bases"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        http://localhost/platform/knowledge-bases
                      </a>
                      ）打开目标知识库，浏览器地址栏或知识库详情中复制其 ID。
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 mt-6">
                    <button
                      onClick={() => setShowLinkKb(false)}
                      disabled={linkingKb}
                      className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 transition disabled:opacity-50"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleLinkKb}
                      disabled={linkingKb || !linkKbId.trim()}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {linkingKb ? <Loader2 size={15} className="animate-spin" /> : <LinkIcon size={15} />}
                      {linkingKb ? '关联中…' : '关联'}
                    </button>
                  </div>
                </div>
              </div>
            )}
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

        {/* 超级管理员：答复约束提示词设置模态框（点击右上角按钮，在页面中央静态弹出） */}
        {isSuperAdmin && showPromptModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => {
              // 保存同步过程中不允许误关
              if (!promptSaving) setShowPromptModal(false);
            }}
          >
            <div
              className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              {/* 模态头部：标题 + 全局启停开关 + 关闭按钮 */}
              <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-gray-100 shrink-0">
                <h3 className="text-lg font-bold text-gray-800 flex items-center min-w-0">
                  <Sparkles className="mr-2 text-blue-600 shrink-0" size={22} />
                  答复约束提示词
                </h3>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-semibold text-gray-600">
                    {promptConfig.enabled ? '已启用' : '已停用'}
                  </span>
                  <div className="relative inline-block w-12 h-6 align-middle select-none transition duration-200 ease-in">
                    <input
                      type="checkbox"
                      checked={promptConfig.enabled}
                      onChange={e => handleTogglePromptEnabled(e.target.checked)}
                      disabled={promptSaving || !kbOnline}
                      className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer z-10 disabled:opacity-50"
                    />
                    <label
                      className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer ${
                        promptConfig.enabled ? 'bg-blue-500' : 'bg-gray-300'
                      }`}
                    ></label>
                  </div>
                  <button
                    type="button"
                    title="关闭"
                    onClick={() => setShowPromptModal(false)}
                    disabled={promptSaving}
                    className="text-gray-400 hover:text-gray-600 transition disabled:opacity-50"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* 模态正文：内容超高时仅在框内滚动 */}
              <div className="overflow-y-auto px-6 py-5">
                <p className="text-xs text-gray-500 leading-relaxed">
                  为每个知识库单独配置一段系统提示词，约束智能问答的回答风格与格式。启用后，
                  该库的回答将由 WeKnora 的自定义智能体承载，提示词会
                  <span className="font-semibold text-amber-700">完全替换</span>
                  WeKnora 默认提示词（引用出处的展示不受影响，仍由系统单独渲染）。
                  支持 Markdown 格式：可直接粘贴整篇 .md 文档，或从文件导入，内容原样作为系统提示词传给模型。
                  未配置提示词的知识库保持默认行为。
                </p>

            {!kbOnline && (
              <div className="mt-4 mb-4 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-700 leading-relaxed">
                  知识库服务未连接，暂时无法保存提示词（保存时需要同步到 WeKnora 智能体）。已保存的配置仍会正常展示。
                </div>
              </div>
            )}

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
              {/* 左：知识库列表 */}
              <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                <div className="text-xs font-semibold text-gray-400 px-1 mb-2">知识库</div>
                <div className="space-y-1 max-h-[340px] overflow-y-auto">
                  {(status?.knowledgeBases || []).length === 0 && (
                    <div className="px-1 py-6 text-center text-xs text-gray-400">暂无知识库</div>
                  )}
                  {(status?.knowledgeBases || []).map(kb => {
                    const configured = Boolean(promptConfig.knowledgeBases[kb.id]?.prompt);
                    const active = promptKbId === kb.id;
                    return (
                      <button
                        key={kb.id}
                        type="button"
                        onClick={() => setPromptKbId(kb.id)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition ${
                          active
                            ? 'bg-blue-600 text-white font-semibold'
                            : 'text-gray-600 hover:bg-white hover:text-blue-600'
                        }`}
                      >
                        <span className="truncate flex-1">{kb.name}</span>
                        {configured && (
                          <span
                            title="已配置约束提示词"
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              active ? 'bg-white' : 'bg-green-500'
                            }`}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 右：编辑区 */}
              <div className="rounded-xl border border-gray-100 p-4">
                {!promptKbId ? (
                  <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center text-gray-400">
                    <FileText size={32} className="mb-2 text-gray-300" />
                    <div className="text-sm">请从左侧选择一个知识库</div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <FolderOpen size={15} className="text-blue-500 shrink-0" />
                        <span className="text-sm font-semibold text-gray-700 truncate">
                          {status?.knowledgeBases.find(kb => kb.id === promptKbId)?.name || '未命名知识库'}
                        </span>
                        {promptConfig.knowledgeBases[promptKbId]?.prompt && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200 shrink-0">
                            已配置
                          </span>
                        )}
                      </div>
                      {promptConfig.knowledgeBases[promptKbId]?.updatedAt && (
                        <span className="text-[11px] text-gray-400 shrink-0">
                          更新于 {new Date(promptConfig.knowledgeBases[promptKbId].updatedAt as string).toLocaleString('zh-CN')}
                        </span>
                      )}
                    </div>

                    <textarea
                      value={promptDraft}
                      onChange={e => setPromptDraft(e.target.value)}
                      disabled={promptSaving || !kbOnline}
                      rows={14}
                      maxLength={20000}
                      placeholder={'支持 Markdown 格式，可直接粘贴整篇 .md 文档，或点「导入 .md 文件」。例如：\n\n# 角色\n你是欧巴拉设计规范助手，回答必须严格依据检索到的规范条款。\n\n## 输出要求\n- 先给结论，再用 `## 依据` 小节列出条款原文与出处；\n- 涉及尺寸、公差、材质时必须引用具体数值，不得估算；\n- 规范没有明确规定的，直接回答「规范未规定」，不要推测。\n\n## 格式\n用 Markdown 回答：表格用于参数对比，列表用于步骤。'}
                      className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm leading-relaxed focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none resize-y disabled:bg-gray-50 disabled:cursor-not-allowed font-mono"
                    />

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-gray-400">
                        {promptDraft.length} / 20000 字符 · 支持 Markdown · 每次问答取所选知识库中第一个已配置提示词的库生效
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <input
                          ref={promptFileRef}
                          type="file"
                          accept=".md,.markdown,.txt"
                          className="hidden"
                          onChange={handleImportPromptFile}
                        />
                        <button
                          type="button"
                          onClick={() => promptFileRef.current?.click()}
                          disabled={promptSaving || !kbOnline}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50 hover:border-blue-300 hover:text-blue-600 transition disabled:opacity-50"
                        >
                          <Upload size={13} />
                          导入 .md 文件
                        </button>
                        {promptConfig.knowledgeBases[promptKbId]?.prompt && (
                          <button
                            type="button"
                            onClick={() => handleClearPrompt(promptKbId)}
                            disabled={promptSaving}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50 transition disabled:opacity-50"
                          >
                            <Trash2 size={13} />
                            清除
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleSavePrompt}
                          disabled={promptSaving || !kbOnline || !promptDraft.trim()}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {promptSaving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                          {promptSaving ? '保存中…' : '保存并生效'}
                        </button>
                      </div>
                    </div>

                    {promptConfig.knowledgeBases[promptKbId]?.agentId && (
                      <div className="mt-3 text-[11px] text-gray-400 font-mono truncate">
                        WeKnora 智能体 ID：{promptConfig.knowledgeBases[promptKbId].agentId}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 px-6 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]">
        <div className="max-w-6xl mx-auto flex justify-between items-center text-sm text-gray-500">
          <div>本地知识库 · WeKnora</div>
          <div className="flex items-center gap-4">
            <span className="flex items-center">
              <span className="font-medium mr-1">后端服务:</span>
              {backendOnline ? (
                <span className="text-green-600 flex items-center">
                  <span className="w-2 h-2 bg-green-500 rounded-full mr-1"></span>
                  已连接
                </span>
              ) : (
                <span className="text-red-500 flex items-center">
                  <span className="w-2 h-2 bg-red-500 rounded-full mr-1"></span>
                  已断开
                </span>
              )}
            </span>
            <span className="flex items-center">
              <span className="font-medium mr-1">知识库服务:</span>
              {!backendOnline ? (
                <span className="text-gray-400 flex items-center">
                  <span className="w-2 h-2 bg-gray-300 rounded-full mr-1"></span>
                  未知
                </span>
              ) : kbOnline ? (
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
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default DesignStandards;
