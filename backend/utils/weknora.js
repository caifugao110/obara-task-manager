/**
 * WeKnora 知识库 API 客户端
 *
 * 负责与本地部署的 WeKnora（https://github.com/Tencent/WeKnora）通信。
 * 所有调用都在服务端完成，凭证（API Key）不会下发到浏览器。
 *
 * 相关环境变量（backend/.env）：
 *   WEKNORA_ENABLED              是否启用接入（默认 false，避免未部署时反复报错）
 *   WEKNORA_BASE_URL             WeKnora 后端 API 根地址，默认 http://127.0.0.1:8080/api/v1
 *   WEKNORA_API_KEY              WeKnora 空间 API Key（在 WeKnora「设置 → API Keys」创建）
 *   WEKNORA_KNOWLEDGE_BASE_IDS   默认检索的知识库 ID，多个用英文逗号分隔
 *   WEKNORA_TIMEOUT_MS           普通请求超时（毫秒），默认 60000
 */

const BASE_URL = (process.env.WEKNORA_BASE_URL || 'http://127.0.0.1:8080/api/v1').replace(/\/+$/, '');
const API_KEY = (process.env.WEKNORA_API_KEY || '').trim();
const TIMEOUT_MS = Number(process.env.WEKNORA_TIMEOUT_MS || 60000);

const isEnabled = () => String(process.env.WEKNORA_ENABLED || '').toLowerCase() === 'true';
const isConfigured = () => isEnabled() && !!API_KEY;

/** 解析默认知识库 ID 列表 */
const defaultKnowledgeBaseIds = () =>
  String(process.env.WEKNORA_KNOWLEDGE_BASE_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** 统一的错误类型，便于路由层区分「未配置」「连不上」「上游报错」 */
class WeKnoraError extends Error {
  constructor(message, { code = 'WEKNORA_ERROR', status = 502, details = null } = {}) {
    super(message);
    this.name = 'WeKnoraError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** 归一化路径，兼容新旧两版字段命名 */
const pick = (obj, ...keys) => {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
};

/**
 * 发起普通 JSON 请求
 * @param {string} path   形如 /knowledge-bases
 * @param {object} options { method, body, signal, timeoutMs, raw }
 */
async function request(path, { method = 'GET', body, signal, timeoutMs = TIMEOUT_MS, raw = false } = {}) {
  if (!isEnabled()) {
    throw new WeKnoraError('WeKnora 接入未启用（WEKNORA_ENABLED 不为 true）', {
      code: 'WEKNORA_DISABLED',
      status: 503,
    });
  }
  if (!API_KEY) {
    throw new WeKnoraError('未配置 WeKnora API Key（WEKNORA_API_KEY）', {
      code: 'WEKNORA_NO_API_KEY',
      status: 503,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // 调用方传入的 signal 与本地超时控制器联动
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const headers = { 'X-API-Key': API_KEY };
  let payload;
  if (body !== undefined) {
    if (body instanceof FormData) {
      payload = body; // 交给 undici 自动带 boundary
    } else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: payload,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
    throw new WeKnoraError(
      aborted ? 'WeKnora 请求超时' : `无法连接 WeKnora（${BASE_URL}）：${err.message}`,
      { code: aborted ? 'WEKNORA_TIMEOUT' : 'WEKNORA_UNREACHABLE' }
    );
  }
  clearTimeout(timer);

  if (raw) return res;

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    const upstreamMsg =
      (data && (data.message || data.error || data.msg)) || `HTTP ${res.status}`;
    throw new WeKnoraError(`WeKnora 返回错误：${upstreamMsg}`, {
      code: 'WEKNORA_UPSTREAM_ERROR',
      status: res.status >= 400 && res.status < 500 ? res.status : 502,
      details: data,
    });
  }

  return data;
}

/** 健康检查：读取当前身份，验证地址与 Key 是否有效 */
async function getStatus() {
  if (!isEnabled()) {
    return { enabled: false, configured: false, reachable: false, message: '接入未启用' };
  }
  if (!API_KEY) {
    return { enabled: true, configured: false, reachable: false, message: '未配置 API Key' };
  }
  try {
    const me = await request('/auth/me', { timeoutMs: 8000 });
    const user = (me && (me.data || me.user || me)) || {};
    return {
      enabled: true,
      configured: true,
      reachable: true,
      baseUrl: BASE_URL,
      user: { name: pick(user, 'username', 'name', 'email'), email: user.email },
    };
  } catch (err) {
    return {
      enabled: true,
      configured: true,
      reachable: false,
      baseUrl: BASE_URL,
      message: err.message,
      code: err.code,
    };
  }
}

/** 知识库列表 */
async function listKnowledgeBases() {
  const data = await request('/knowledge-bases');
  const list = (data && (data.data || data.list || data)) || [];
  return (Array.isArray(list) ? list : []).map((kb) => ({
    id: kb.id,
    name: pick(kb, 'name', 'title') || '(未命名知识库)',
    description: kb.description || '',
    knowledgeCount: pick(kb, 'knowledge_count', 'knowledgeCount', 'file_count') ?? null,
    createdAt: kb.created_at || kb.createdAt || null,
  }));
}

/** 新建知识库 */
async function createKnowledgeBase({ name, description = '' }) {
  const data = await request('/knowledge-bases', {
    method: 'POST',
    body: { name, description },
  });
  const kb = (data && (data.data || data)) || {};
  return { id: kb.id, name: pick(kb, 'name', 'title') || name, description: kb.description || '' };
}

/** 知识库下的文档列表 */
async function listKnowledge(kbId) {
  const data = await request(`/knowledge-bases/${encodeURIComponent(kbId)}/knowledge`);
  const list = (data && (data.data || data.list || data)) || [];
  return (Array.isArray(list) ? list : []).map((item) => ({
    id: item.id,
    title: pick(item, 'title', 'file_name', 'fileName', 'name') || '(未命名)',
    fileType: pick(item, 'file_type', 'fileType', 'type') || '',
    fileSize: pick(item, 'file_size', 'fileSize', 'size') ?? null,
    parseStatus: pick(item, 'parse_status', 'parseStatus', 'status') || 'unknown',
    createdAt: item.created_at || item.createdAt || null,
  }));
}

/** 上传文档到指定知识库（multipart/form-data） */
async function uploadDocument(kbId, { buffer, filename, mimetype }) {
  const form = new FormData();
  const blob = new Blob([buffer], { type: mimetype || 'application/octet-stream' });
  form.append('file', blob, filename);
  return request(`/knowledge-bases/${encodeURIComponent(kbId)}/knowledge/file`, {
    method: 'POST',
    body: form,
    timeoutMs: 300000, // 大文件解析较慢
  });
}

/** 删除知识条目 */
async function deleteKnowledge(knowledgeId) {
  return request(`/knowledge/${encodeURIComponent(knowledgeId)}`, { method: 'DELETE' });
}

/** 重新解析 */
async function reparseKnowledge(knowledgeId) {
  return request(`/knowledge/${encodeURIComponent(knowledgeId)}/reparse`, { method: 'POST' });
}

/**
 * WeKnora 命中方式（内部枚举 MatchType）。
 * 上游返回的是数字，这里映射成中文标签，便于前端直接展示。
 */
const MATCH_TYPE_LABELS = {
  0: '向量检索',
  1: '关键词',
  2: '邻近分块',
  3: '历史对话',
  4: '父分块',
  5: '关联分块',
  6: '知识图谱',
  7: '联网检索',
  8: '直接加载',
  9: '数据分析',
};

/** 归一化命中方式：既兼容数字枚举，也兼容上游直接返回的字符串 */
function normalizeMatchType(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    return MATCH_TYPE_LABELS[Number(value)] || String(value);
  }
  return String(value);
}

/** 把 WeKnora 的检索结果归一化成前端好用的结构 */
function normalizeSearchResult(item) {
  const metadata = item.metadata || {};
  return {
    id: item.id,
    content: item.content || '',
    score: typeof item.score === 'number' ? item.score : null,
    matchType: normalizeMatchType(pick(item, 'match_type', 'matchType')),
    knowledgeId: pick(item, 'knowledge_id', 'knowledgeId') || '',
    knowledgeTitle: pick(item, 'knowledge_title', 'knowledgeTitle') || metadata.knowledge_title || '',
    chunkIndex: pick(item, 'chunk_index', 'chunkIndex') ?? null,
    seq: item.seq ?? null,
    startAt: pick(item, 'start_at', 'startAt') ?? null,
    endAt: pick(item, 'end_at', 'endAt') ?? null,
    chunkType: pick(item, 'chunk_type', 'chunkType') || '',
    metadata,
  };
}

/**
 * 纯检索（不经过大模型总结）
 * @param {string} query
 * @param {string[]} knowledgeBaseIds
 */
async function search(query, knowledgeBaseIds = defaultKnowledgeBaseIds()) {
  const data = await request('/knowledge-search', {
    method: 'POST',
    body: {
      query,
      knowledge_base_ids: knowledgeBaseIds,
    },
  });
  const list = (data && (data.data || data.results)) || [];
  return {
    results: (Array.isArray(list) ? list : []).map(normalizeSearchResult),
    meta: (data && data.meta) || null,
  };
}

/** 创建会话（问答需要一个 session_id） */
async function createSession({ title = '', knowledgeBaseIds = [] } = {}) {
  const body = { title };
  if (knowledgeBaseIds.length) body.knowledge_base_ids = knowledgeBaseIds;
  const data = await request('/sessions', { method: 'POST', body });
  const session = (data && (data.data || data)) || {};
  return session.id;
}

/**
 * 流式 RAG 问答。
 * 内部逐行解析 WeKnora 的 SSE（event: message / data: JSON），
 * 并把归一化后的事件交给 onEvent 回调。
 *
 * @param {string} sessionId
 * @param {string} query
 * @param {string[]} knowledgeBaseIds
 * @param {(evt: object) => void} onEvent
 * @param {AbortSignal} [signal]
 */
async function streamChat(sessionId, query, knowledgeBaseIds = defaultKnowledgeBaseIds(), onEvent, signal) {
  if (!isConfigured()) {
    throw new WeKnoraError('WeKnora 未配置（需要 WEKNORA_ENABLED=true 与 WEKNORA_API_KEY）', {
      code: 'WEKNORA_NOT_CONFIGURED',
      status: 503,
    });
  }

  const res = await request(`/knowledge-chat/${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    body: {
      query,
      knowledge_base_ids: knowledgeBaseIds,
      channel: 'api',
      disable_title: true,
    },
    signal,
    raw: true,
    timeoutMs: 300000,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new WeKnoraError(`WeKnora 问答请求失败：HTTP ${res.status} ${text.slice(0, 200)}`, {
      code: 'WEKNORA_CHAT_ERROR',
      status: 502,
    });
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const reader = res.body.getReader();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE 以空行分隔事件块
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      const dataLines = chunk
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim());
      if (!dataLines.length) continue;

      const payload = dataLines.join('\n');
      if (payload === '[DONE]') continue;

      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }
      onEvent(normalizeStreamEvent(parsed));
    }
  }
}

/** 归一化单个流式事件 */
function normalizeStreamEvent(raw) {
  const type = raw.response_type || raw.responseType || '';
  const references = raw.knowledge_references || raw.knowledgeReferences;
  return {
    type,
    content: raw.content || '',
    done: !!raw.done,
    id: raw.id || '',
    sessionId: raw.session_id || raw.sessionId || '',
    assistantMessageId: raw.assistant_message_id || raw.assistantMessageId || '',
    finishReason: raw.finish_reason || raw.finishReason || '',
    references: Array.isArray(references) ? references.map(normalizeSearchResult) : undefined,
    usage: raw.usage || undefined,
  };
}

module.exports = {
  WeKnoraError,
  isEnabled,
  isConfigured,
  defaultKnowledgeBaseIds,
  getStatus,
  listKnowledgeBases,
  createKnowledgeBase,
  listKnowledge,
  uploadDocument,
  deleteKnowledge,
  reparseKnowledge,
  search,
  createSession,
  streamChat,
  normalizeSearchResult,
};
