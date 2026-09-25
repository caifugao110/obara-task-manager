/**
 * 设计规范知识库（WeKnora）接入路由
 *
 * 挂载于 /api/design-standards
 *
 * 设计要点：
 *  1. WeKnora 的地址与 API Key 只保留在服务端（backend/.env），不下发浏览器；
 *  2. 读操作沿用页面既有的权限开关设计（settings.designStandards），与 /work-hours 一致；
 *  3. 写操作（关联 / 取消关联知识库）要求一般管理员及以上；
 *  4. 问答走 SSE 流式转发，前端只消费本项目自己的事件格式；
 *  5. 知识库通过「知识库 ID」显式关联：项目数据库中保存已关联的知识库 ID 列表，
 *     状态接口只返回这些已关联的知识库，不再自动列出 WeKnora 中所有知识库，
 *     也不再使用 WEKNORA_KNOWLEDGE_BASE_IDS 作为默认值。
 */

const express = require('express');
const asyncHandler = require('express-async-handler');
const router = express.Router();

const db = require('../db');
const {
  authMiddleware,
  adminMiddleware,
  accessSettingsMiddleware,
} = require('../middleware/auth');
const weknora = require('../utils/weknora');

// 所有接口都需要登录 + 设计规范知识库的访问权限
router.use(authMiddleware, accessSettingsMiddleware('designStandards'));

/** 统一把 WeKnoraError 转成合适的 HTTP 响应 */
const handleError = (res, err, fallbackMessage) => {
  if (err && err.name === 'WeKnoraError') {
    return res.status(err.status || 502).json({
      message: err.message,
      code: err.code,
      details: err.details || undefined,
    });
  }
  console.error('[design-standards]', err);
  return res.status(500).json({ message: fallbackMessage || '知识库服务异常' });
};

/**
 * 取出本次问答应使用的「答复约束」智能体 ID。
 *
 * 提示词按知识库配置（超级管理员在页面维护），启用后每个库对应一个
 * 受管智能体。一次问答可能选中多个知识库，这里取所选范围内第一个
 * 已配置提示词的库；请求仍会把全部所选知识库传给上游，检索范围不受影响。
 */
const resolveConstraintAgentId = (kbIds) => {
  const cfg = db.readDb().settings?.designStandardsPrompt;
  if (!cfg || !cfg.enabled) return '';
  const kbs = cfg.knowledgeBases;
  if (!kbs || typeof kbs !== 'object') return '';
  for (const kbId of kbIds) {
    const entry = kbs[kbId];
    if (entry && entry.agentId && String(entry.prompt || '').trim()) return entry.agentId;
  }
  return '';
};

/** 读取已关联的知识库 ID 列表（保存在项目数据库中） */
const getLinkedKbIds = () => {
  const data = db.readDb();
  const ids = data.settings?.designStandardsLinkedKbIds;
  return Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
};

/** 写入已关联的知识库 ID 列表 */
const setLinkedKbIds = async (ids) => {
  const data = db.readDb();
  if (!data.settings) data.settings = {};
  data.settings.designStandardsLinkedKbIds = [...new Set(ids.map(String).filter(Boolean))];
  await db.writeDb(data);
};

/** 按已关联的 ID 列表逐个解析知识库详情，解析失败的跳过 */
const resolveLinkedKnowledgeBases = async () => {
  const ids = getLinkedKbIds();
  const result = [];
  for (const id of ids) {
    try {
      const kb = await weknora.getKnowledgeBase(id);
      result.push(kb);
    } catch (err) {
      // 某个知识库无法访问时跳过，不影响其他知识库展示
      console.warn(`[design-standards] 跳过无法解析的已关联知识库 ${id}:`, err.message);
    }
  }
  return result;
};

/**
 * GET /api/design-standards/status
 * 返回接入状态与已关联的知识库列表，供页面首屏渲染。
 */
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const status = await weknora.getStatus();
    let knowledgeBases = [];
    if (status.reachable) {
      try {
        knowledgeBases = await resolveLinkedKnowledgeBases();
      } catch (err) {
        status.message = err.message;
      }
    }
    res.json({
      ...status,
      defaultKnowledgeBaseIds: [],
      knowledgeBases,
    });
  })
);

/**
 * GET /api/design-standards/knowledge-bases
 * 返回已关联的知识库列表（与 status 中的 knowledgeBases 一致）
 */
router.get(
  '/knowledge-bases',
  asyncHandler(async (req, res) => {
    try {
      res.json({ knowledgeBases: await resolveLinkedKnowledgeBases() });
    } catch (err) {
      handleError(res, err, '获取知识库列表失败');
    }
  })
);

/**
 * POST /api/design-standards/knowledge-bases/link
 * body: { kbId }   仅管理员及以上
 * 通过知识库 ID 关联知识库：先从 WeKnora 解析该库是否存在，再把 ID 加入关联列表。
 */
router.post(
  '/knowledge-bases/link',
  adminMiddleware,
  asyncHandler(async (req, res) => {
    const kbId = String(req.body?.kbId || '').trim();
    if (!kbId) return res.status(400).json({ message: '知识库 ID 不能为空' });

    const ids = getLinkedKbIds();
    if (ids.includes(kbId)) {
      return res.status(409).json({ message: '该知识库已关联' });
    }

    try {
      const kb = await weknora.getKnowledgeBase(kbId);
      ids.push(kbId);
      await setLinkedKbIds(ids);
      res.status(201).json({ knowledgeBase: kb });
    } catch (err) {
      handleError(res, err, '关联知识库失败');
    }
  })
);

/**
 * DELETE /api/design-standards/knowledge-bases/:kbId   仅管理员及以上
 * 取消关联知识库：仅从项目关联列表中移除 ID，不会删除 WeKnora 中的知识库本身。
 */
router.delete(
  '/knowledge-bases/:kbId',
  adminMiddleware,
  asyncHandler(async (req, res) => {
    const kbId = String(req.params.kbId || '').trim();
    const ids = getLinkedKbIds();
    if (!ids.includes(kbId)) {
      return res.status(404).json({ message: '该知识库未关联' });
    }
    await setLinkedKbIds(ids.filter(id => id !== kbId));
    res.json({ message: '已取消关联' });
  })
);

/**
 * GET /api/design-standards/knowledge-bases/:kbId/documents
 */
router.get(
  '/knowledge-bases/:kbId/documents',
  asyncHandler(async (req, res) => {
    try {
      res.json({ documents: await weknora.listKnowledge(req.params.kbId) });
    } catch (err) {
      handleError(res, err, '获取文档列表失败');
    }
  })
);

/**
 * POST /api/design-standards/search
 * body: { query, knowledgeBaseIds: string[] }
 */
router.post(
  '/search',
  asyncHandler(async (req, res) => {
    const query = String(req.body?.query || '').trim();
    if (!query) return res.status(400).json({ message: '请输入检索内容' });

    const kbIds = Array.isArray(req.body?.knowledgeBaseIds)
      ? req.body.knowledgeBaseIds.map(String).filter(Boolean)
      : [];

    if (!kbIds.length) {
      return res.status(400).json({ message: '未指定知识库，请先关联并选择知识库' });
    }

    try {
      const data = await weknora.search(query, kbIds);
      res.json(data);
    } catch (err) {
      handleError(res, err, '检索失败');
    }
  })
);

/**
 * POST /api/design-standards/chat
 * body: { query, sessionId?, knowledgeBaseIds: string[] }
 *
 * 以 SSE 返回，事件格式（每个事件都是 JSON）：
 *   { type: 'session',   sessionId }        会话 ID，前端保存用于多轮对话
 *   { type: 'references', references: [...] } 命中的规范条款
 *   { type: 'answer',    content }           增量答案文本
 *   { type: 'done' }                          结束
 *   { type: 'error',     message }            出错
 */
router.post(
  '/chat',
  asyncHandler(async (req, res) => {
    const query = String(req.body?.query || '').trim();
    if (!query) return res.status(400).json({ message: '请输入问题' });

    const kbIds = Array.isArray(req.body?.knowledgeBaseIds)
      ? req.body.knowledgeBaseIds.map(String).filter(Boolean)
      : [];

    if (!kbIds.length) {
      return res.status(400).json({ message: '未指定知识库，请先关联并选择知识库' });
    }

    if (!weknora.isConfigured()) {
      return res.status(503).json({ message: '知识库服务未配置，请检查后端 WEKNORA_* 环境变量' });
    }

    // 问答会话是工作空间级资源，所选知识库必须同属一个工作空间。
    // 在写 SSE 响应头之前校验，这样错误可以普通 JSON 返回给前端。
    try {
      await weknora.assertSameTenant(kbIds);
    } catch (err) {
      return handleError(res, err, '知识库选择无效');
    }

    // SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const send = (payload) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    // 客户端断开时中止上游请求。
    // 注意：必须监听 res 而不是 req —— 在 Node/Express 中，req 的 'close'
    // 会在请求体读取完毕后就触发，若监听 req 会导致 SSE 尚未输出就被判定为
    // 「客户端已断开」而立即结束响应（表现为返回 200 但响应体为空）。
    const upstreamController = new AbortController();
    let clientClosed = false;
    res.on('close', () => {
      if (res.writableEnded) return; // 正常结束时无需中止
      clientClosed = true;
      upstreamController.abort();
    });

    try {
      let sessionId = String(req.body?.sessionId || '').trim();
      if (!sessionId) {
        sessionId = await weknora.createSession({ title: query.slice(0, 30), knowledgeBaseIds: kbIds });
      }
      if (clientClosed) return res.end();
      send({ type: 'session', sessionId });

      // 超管配置的答复约束提示词（按知识库），命中则以自定义智能体承载
      const agentId = resolveConstraintAgentId(kbIds);

      let answerBuffer = '';
      let finishReason = 'stop';
      let streamError = '';

      await weknora.streamChat(
        sessionId,
        query,
        kbIds,
        (evt) => {
          if (clientClosed) return;
          if (evt.type === 'references' && evt.references?.length) {
            send({ type: 'references', references: evt.references });
            return;
          }
          if (evt.type === 'answer' && evt.content) {
            answerBuffer += evt.content;
            send({ type: 'answer', content: evt.content });
            return;
          }
          // 上游（例如约束智能体配置有误）会在流里发 error 事件，
          // 且不主动关闭连接，这里记录后由外层统一收尾。
          if (evt.type === 'error') {
            streamError = evt.message || '知识库问答出错';
            return;
          }
          // 记录最终完成事件里的结束原因（如有），不在此处发送 done ——
          // WeKnora 的 agent_query / tool_call / references 等中间事件也会带
          // done=true，逐条转发会产生多个 done，这里统一在流结束后只发一次。
          if (evt.type === 'complete' && evt.finishReason) {
            finishReason = evt.finishReason;
          }
        },
        upstreamController.signal,
        { agentId }
      );

      if (!clientClosed) {
        if (streamError && !answerBuffer) {
          send({ type: 'error', message: streamError });
        } else {
          send({ type: 'done', finishReason });
        }
        res.end();
      }
    } catch (err) {
      if (!clientClosed) {
        const isWeknoraError = err && err.name === 'WeKnoraError';
        const message = isWeknoraError ? err.message : '知识库问答失败，请稍后重试';
        // 透传 code（如 WEKNORA_UNREACHABLE / WEKNORA_TIMEOUT），
        // 供前端立即把页面状态切换为「知识库未连接」，无需等待轮询
        send({ type: 'error', message, ...(isWeknoraError && err.code ? { code: err.code } : {}) });
        res.end();
      }
    }
  })
);

module.exports = router;
