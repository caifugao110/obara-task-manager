/**
 * WeKnora 知识库 API 客户端（支持多工作空间 / 多 API Key）
 *
 * 负责与本地部署的 WeKnora（https://github.com/Tencent/WeKnora）通信。
 * 所有调用都在服务端完成，凭证（API Key）不会下发到浏览器。
 *
 * WeKnora 的 API Key 按工作空间（tenant）隔离：一个 Key 只能访问
 * 所属工作空间内的知识库。为了同时接入多个工作空间，本模块维护一个
 * 「客户端列表」，每个 Key 对应一个客户端：
 *   - listKnowledgeBases() 会并行查询所有 Key 并合并结果（附带工作空间信息）；
 *   - 检索（search）按知识库所属工作空间分组并行扇出，再合并排序；
 *   - 会话 / 问答要求所选知识库同属一个工作空间（WeKnora 会话本身是
 *     工作空间级资源，无法跨空间）；
 *   - 文档删除 / 重新解析等不带 kbId 的操作按 Key 依次尝试（403/404 换下一个）。
 *
 * 相关环境变量（backend/.env）：
 *   WEKNORA_ENABLED              是否启用接入（默认 false，避免未部署时反复报错）
 *   WEKNORA_BASE_URL             WeKnora 后端 API 根地址，默认 http://127.0.0.1:8080/api/v1
 *   WEKNORA_API_KEY              主工作空间 API Key（建库等写操作也使用该 Key）
 *   WEKNORA_EXTRA_API_KEYS       其他工作空间的 API Key，多个用英文逗号分隔
 *   WEKNORA_KNOWLEDGE_BASE_IDS   默认检索的知识库 ID，多个用英文逗号分隔
 *   WEKNORA_TIMEOUT_MS           普通请求超时（毫秒），默认 60000
 */

const BASE_URL = (process.env.WEKNORA_BASE_URL || 'http://127.0.0.1:8080/api/v1').replace(/\/+$/, '');
const PRIMARY_API_KEY = (process.env.WEKNORA_API_KEY || '').trim();
const EXTRA_API_KEYS = String(process.env.WEKNORA_EXTRA_API_KEYS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const TIMEOUT_MS = Number(process.env.WEKNORA_TIMEOUT_MS || 60000);

const isEnabled = () => String(process.env.WEKNORA_ENABLED || '').toLowerCase() === 'true';

/**
 * 客户端注册表（懒加载、单例）。
 * 每个 client: { key, tenantId, tenantName, reachable, identityChecked, kbIndex }
 *  - kbIndex: Map<kbId, 归一化后的知识库对象>，由 listKnowledgeBases 刷新
 */
let clients = null;
function getClients() {
  if (clients) return clients;
  const keys = [...new Set([PRIMARY_API_KEY, ...EXTRA_API_KEYS].filter(Boolean))];
  clients = keys.map((key) => ({
    key,
    tenantId: null,
    tenantName: null,
    reachable: null,
    identityChecked: false,
    lastError: null,
    kbIndex: new Map(),
  }));
  return clients;
}

const isConfigured = () => isEnabled() && getClients().length > 0;

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
 * @param {object} options { method, body, signal, timeoutMs, raw, apiKey }
 */
async function request(
  path,
  { method = 'GET', body, signal, timeoutMs = TIMEOUT_MS, raw = false, apiKey } = {}
) {
  if (!isEnabled()) {
    throw new WeKnoraError('WeKnora 接入未启用（WEKNORA_ENABLED 不为 true）', {
      code: 'WEKNORA_DISABLED',
      status: 503,
    });
  }
  const key = (apiKey || PRIMARY_API_KEY || '').trim();
  if (!key) {
    throw new WeKnoraError('未配置 WeKnora API Key（WEKNORA_API_KEY / WEKNORA_EXTRA_API_KEYS）', {
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

  const headers = { 'X-API-Key': key };
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

/** 查询并缓存某个 Key 所属的工作空间身份 */
async function ensureIdentity(client, force = false) {
  if (client.identityChecked && !force) return client;
  client.identityChecked = true;
  try {
    const me = await request('/auth/me', { apiKey: client.key, timeoutMs: 8000 });
    const data = (me && me.data) || me || {};
    const tenant = data.tenant || {};
    const user = data.user || {};
    client.tenantId = tenant.id ?? null;
    client.tenantName = tenant.name || user.username || null;
    client.reachable = true;
    client.lastError = null;
  } catch (err) {
    client.reachable = false;
    client.lastError = err.message;
  }
  return client;
}

/**
 * 按 Key 顺序依次尝试请求；仅当上游返回 403/404 时换下一个 Key
 * （用于删除/重新解析这类不带 kbId 的操作）。
 */
async function requestAcrossKeys(path, options = {}) {
  const cs = getClients();
  let lastErr = null;
  for (const client of cs) {
    try {
      return await request(path, { ...options, apiKey: client.key });
    } catch (err) {
      if (err && err.name === 'WeKnoraError' && (err.status === 403 || err.status === 404)) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new WeKnoraError('没有可用的 WeKnora API Key', { status: 503 });
}

/** 健康检查：校验所有 Key，返回整体与各工作空间状态 */
async function getStatus() {
  if (!isEnabled()) {
    return { enabled: false, configured: false, reachable: false, message: '接入未启用' };
  }
  const cs = getClients();
  if (!cs.length) {
    return { enabled: true, configured: false, reachable: false, message: '未配置 API Key' };
  }
  await Promise.all(cs.map((c) => ensureIdentity(c)));
  const tenants = cs.map((c) => ({
    tenantId: c.tenantId,
    tenantName: c.tenantName,
    reachable: !!c.reachable,
    message: c.lastError || undefined,
  }));
  const reachableCount = cs.filter((c) => c.reachable).length;
  return {
    enabled: true,
    configured: true,
    reachable: reachableCount > 0,
    baseUrl: BASE_URL,
    tenants,
    message: reachableCount === 0 ? cs[0].lastError || '所有 API Key 均无法连接' : undefined,
  };
}

/** 用指定客户端拉取知识库列表并更新其 kbIndex */
async function listKnowledgeBasesFor(client) {
  const data = await request('/knowledge-bases', { apiKey: client.key });
  const list = (data && (data.data || data.list || data)) || [];
  const normalized = (Array.isArray(list) ? list : []).map((kb) => ({
    id: kb.id,
    name: pick(kb, 'name', 'title') || '(未命名知识库)',
    description: kb.description || '',
    knowledgeCount: pick(kb, 'knowledge_count', 'knowledgeCount', 'file_count') ?? null,
    createdAt: kb.created_at || kb.createdAt || null,
    tenantId: client.tenantId,
    tenantName: client.tenantName,
  }));
  client.kbIndex = new Map(normalized.map((kb) => [kb.id, kb]));
  return normalized;
}

/**
 * 知识库列表（跨所有工作空间合并）。
 * 任一 Key 查询失败时返回其他工作空间的结果；全部失败时抛出首个错误。
 */
async function listKnowledgeBases() {
  const cs = getClients();
  if (!cs.length) {
    throw new WeKnoraError('未配置 WeKnora API Key', {
      code: 'WEKNORA_NO_API_KEY',
      status: 503,
    });
  }
  await Promise.all(cs.map((c) => ensureIdentity(c)));

  const settled = await Promise.allSettled(cs.map((c) => listKnowledgeBasesFor(c)));
  const merged = [];
  let firstError = null;
  settled.forEach((r) => {
    if (r.status === 'fulfilled') merged.push(...r.value);
    else if (!firstError) firstError = r.reason;
  });
  if (!merged.length && firstError) throw firstError;
  return merged;
}

/**
 * 解析某个知识库 ID 所属的客户端。
 * 先走各客户端 kbIndex 缓存；未命中则刷新一次列表；仍未命中则逐个 Key 探测。
 */
async function resolveClient(kbId) {
  const cs = getClients();
  let hit = cs.find((c) => c.kbIndex.has(kbId));
  if (hit) return hit;

  try {
    await listKnowledgeBases();
  } catch {
    /* 列表整体失败时继续走逐个探测 */
  }
  hit = cs.find((c) => c.kbIndex.has(kbId));
  if (hit) return hit;

  for (const client of cs) {
    try {
      await request(`/knowledge-bases/${encodeURIComponent(kbId)}`, {
        apiKey: client.key,
        timeoutMs: 8000,
      });
      return client;
    } catch (err) {
      // 403/404 说明该 Key 无权或库不在此工作空间，继续试下一个
      if (err && err.name === 'WeKnoraError' && (err.status === 403 || err.status === 404)) {
        continue;
      }
      throw err;
    }
  }
  return null;
}

/**
 * 把一批知识库 ID 解析成按工作空间分组的结果：
 * [{ client, ids: string[] }]
 */
async function resolveGroups(kbIds) {
  const groups = new Map();
  for (const kbId of kbIds) {
    const client = await resolveClient(kbId);
    if (!client) {
      throw new WeKnoraError(
        `知识库 ${kbId} 无法访问：请确认它存在，且已为其所属工作空间配置 API Key`,
        { code: 'WEKNORA_KB_FORBIDDEN', status: 403 }
      );
    }
    if (!groups.has(client.key)) groups.set(client.key, { client, ids: [] });
    groups.get(client.key).ids.push(kbId);
  }
  return [...groups.values()];
}

/**
 * 校验一批知识库 ID 同属一个工作空间（问答会话要求）。
 * @returns {Promise<{client:object, ids:string[]}>}
 */
async function assertSameTenant(kbIds) {
  const groups = await resolveGroups(kbIds);
  if (groups.length > 1) {
    const names = groups
      .map((g) => g.client.tenantName || `工作空间 ${g.client.tenantId || '?'}`)
      .join('、');
    throw new WeKnoraError(
      `智能问答所选知识库必须属于同一个工作空间，当前选择跨越了：${names}。请只选择同一工作空间下的知识库。`,
      { code: 'WEKNORA_MULTI_TENANT', status: 400 }
    );
  }
  return groups[0];
}

/** 新建知识库（固定写入主 Key 所属工作空间） */
async function createKnowledgeBase({ name, description = '' }) {
  const data = await request('/knowledge-bases', {
    method: 'POST',
    body: { name, description },
    apiKey: PRIMARY_API_KEY,
  });
  const kb = (data && (data.data || data)) || {};
  return { id: kb.id, name: pick(kb, 'name', 'title') || name, description: kb.description || '' };
}

/** 知识库下的文档列表（自动选择对应工作空间的 Key） */
async function listKnowledge(kbId) {
  const client = await resolveClient(kbId);
  if (!client) {
    throw new WeKnoraError(`知识库 ${kbId} 无法访问`, {
      code: 'WEKNORA_KB_FORBIDDEN',
      status: 403,
    });
  }
  const data = await request(
    `/knowledge-bases/${encodeURIComponent(kbId)}/knowledge`,
    { apiKey: client.key }
  );
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
  const client = await resolveClient(kbId);
  if (!client) {
    throw new WeKnoraError(`知识库 ${kbId} 无法访问`, {
      code: 'WEKNORA_KB_FORBIDDEN',
      status: 403,
    });
  }
  const form = new FormData();
  const blob = new Blob([buffer], { type: mimetype || 'application/octet-stream' });
  form.append('file', blob, filename);
  return request(`/knowledge-bases/${encodeURIComponent(kbId)}/knowledge/file`, {
    method: 'POST',
    body: form,
    apiKey: client.key,
    timeoutMs: 300000, // 大文件解析较慢
  });
}

/** 删除知识条目（不知道所属工作空间，按 Key 依次尝试） */
async function deleteKnowledge(knowledgeId) {
  return requestAcrossKeys(`/knowledge/${encodeURIComponent(knowledgeId)}`, { method: 'DELETE' });
}

/** 重新解析 */
async function reparseKnowledge(knowledgeId) {
  return requestAcrossKeys(`/knowledge/${encodeURIComponent(knowledgeId)}`, { method: 'POST' });
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

/** 单个工作空间内的纯检索 */
async function searchWithClient(client, query, knowledgeBaseIds) {
  const data = await request('/knowledge-search', {
    method: 'POST',
    body: {
      query,
      knowledge_base_ids: knowledgeBaseIds,
    },
    apiKey: client.key,
  });
  const list = (data && (data.data || data.results)) || [];
  return (Array.isArray(list) ? list : []).map(normalizeSearchResult);
}

/**
 * 纯检索（不经过大模型总结），支持跨工作空间：
 * 按知识库所属工作空间分组并行扇出，合并后按相关度降序排序。
 * @param {string} query
 * @param {string[]} knowledgeBaseIds
 */
async function search(query, knowledgeBaseIds = defaultKnowledgeBaseIds()) {
  const groups = await resolveGroups(knowledgeBaseIds);
  const settled = await Promise.allSettled(
    groups.map((g) => searchWithClient(g.client, query, g.ids))
  );
  const merged = [];
  let firstError = null;
  settled.forEach((r) => {
    if (r.status === 'fulfilled') merged.push(...r.value);
    else if (!firstError) firstError = r.reason;
  });
  if (!merged.length && firstError) throw firstError;
  merged.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  return {
    results: merged,
    meta: { merged: groups.length > 1, groups: groups.length },
  };
}

/** 创建会话（问答需要一个 session_id，会话是工作空间级资源） */
async function createSession({ title = '', knowledgeBaseIds = [] } = {}) {
  const { client } = await assertSameTenant(knowledgeBaseIds);
  const body = { title };
  if (knowledgeBaseIds.length) body.knowledge_base_ids = knowledgeBaseIds;
  const data = await request('/sessions', { method: 'POST', body, apiKey: client.key });
  const session = (data && (data.data || data)) || {};
  return session.id;
}

/**
 * 流式 RAG 问答。
 * 内部逐行解析 WeKnora 的 SSE（event: message / data: JSON），
 * 并把归一化后的事件交给 onEvent 回调。
 * 所选知识库必须同属一个工作空间。
 *
 * @param {string} sessionId
 * @param {string} query
 * @param {string[]} knowledgeBaseIds
 * @param {(evt: object) => void} onEvent
 * @param {AbortSignal} [signal]
 */
async function streamChat(sessionId, query, knowledgeBaseIds = defaultKnowledgeBaseIds(), onEvent, signal) {
  if (!isConfigured()) {
    throw new WeKnoraError('WeKnora 未配置（需要 WEKNORA_ENABLED=true 与至少一个 API Key）', {
      code: 'WEKNORA_NOT_CONFIGURED',
      status: 503,
    });
  }

  const { client } = await assertSameTenant(knowledgeBaseIds);

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
    apiKey: client.key,
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
  assertSameTenant,
  normalizeSearchResult,
};
