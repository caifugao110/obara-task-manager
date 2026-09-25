/**
 * 设计规范知识库（WeKnora）接入路由
 *
 * 挂载于 /api/design-standards
 *
 * 设计要点：
 *  1. WeKnora 的地址与 API Key 只保留在服务端（backend/.env），不下发浏览器；
 *  2. 读操作沿用页面既有的权限开关设计（settings.designStandards），与 /work-hours 一致；
 *  3. 写操作（建库 / 上传 / 删除 / 重新解析）要求一般管理员及以上；
 *  4. 问答走 SSE 流式转发，前端只消费本项目自己的事件格式。
 */

const express = require('express');
const multer = require('multer');
const asyncHandler = require('express-async-handler');
const router = express.Router();

const {
  authMiddleware,
  adminMiddleware,
  accessSettingsMiddleware,
} = require('../middleware/auth');
const weknora = require('../utils/weknora');

// 文件先收到内存再转发给 WeKnora，不落本地磁盘
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

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
 * GET /api/design-standards/status
 * 返回接入状态与知识库列表，供页面首屏渲染。
 */
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const status = await weknora.getStatus();
    let knowledgeBases = [];
    if (status.reachable) {
      try {
        knowledgeBases = await weknora.listKnowledgeBases();
      } catch (err) {
        status.message = err.message;
      }
    }
    const configuredIds = weknora.defaultKnowledgeBaseIds();
    res.json({
      ...status,
      defaultKnowledgeBaseIds: configuredIds,
      knowledgeBases,
    });
  })
);

/**
 * GET /api/design-standards/knowledge-bases
 */
router.get(
  '/knowledge-bases',
  asyncHandler(async (req, res) => {
    try {
      res.json({ knowledgeBases: await weknora.listKnowledgeBases() });
    } catch (err) {
      handleError(res, err, '获取知识库列表失败');
    }
  })
);

/**
 * POST /api/design-standards/knowledge-bases
 * body: { name, description? }   仅管理员及以上
 */
router.post(
  '/knowledge-bases',
  adminMiddleware,
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: '知识库名称不能为空' });
    const description = String(req.body?.description || '').trim();
    try {
      const kb = await weknora.createKnowledgeBase({ name, description });
      res.status(201).json({ knowledgeBase: kb });
    } catch (err) {
      handleError(res, err, '创建知识库失败');
    }
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
 * POST /api/design-standards/knowledge-bases/:kbId/documents
 * multipart/form-data，字段名 file   仅管理员及以上
 */
router.post(
  '/knowledge-bases/:kbId/documents',
  adminMiddleware,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ message: '请选择要上传的文件' });
    try {
      const result = await weknora.uploadDocument(req.params.kbId, {
        buffer: req.file.buffer,
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
      });
      res.status(201).json({ message: '文件已提交解析', result });
    } catch (err) {
      handleError(res, err, '上传文档失败');
    }
  })
);

/**
 * DELETE /api/design-standards/documents/:knowledgeId   仅管理员及以上
 */
router.delete(
  '/documents/:knowledgeId',
  adminMiddleware,
  asyncHandler(async (req, res) => {
    try {
      await weknora.deleteKnowledge(req.params.knowledgeId);
      res.json({ message: '已删除' });
    } catch (err) {
      handleError(res, err, '删除文档失败');
    }
  })
);

/**
 * POST /api/design-standards/documents/:knowledgeId/reparse   仅管理员及以上
 */
router.post(
  '/documents/:knowledgeId/reparse',
  adminMiddleware,
  asyncHandler(async (req, res) => {
    try {
      await weknora.reparseKnowledge(req.params.knowledgeId);
      res.json({ message: '已触发重新解析' });
    } catch (err) {
      handleError(res, err, '重新解析失败');
    }
  })
);

/**
 * POST /api/design-standards/search
 * body: { query, knowledgeBaseIds?: string[] }
 */
router.post(
  '/search',
  asyncHandler(async (req, res) => {
    const query = String(req.body?.query || '').trim();
    if (!query) return res.status(400).json({ message: '请输入检索内容' });

    const kbIds = Array.isArray(req.body?.knowledgeBaseIds) && req.body.knowledgeBaseIds.length
      ? req.body.knowledgeBaseIds.map(String)
      : weknora.defaultKnowledgeBaseIds();

    if (!kbIds.length) {
      return res.status(400).json({ message: '未指定知识库，请先在 WeKnora 中创建知识库并配置默认知识库 ID' });
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
 * body: { query, sessionId?, knowledgeBaseIds? }
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

    const kbIds = Array.isArray(req.body?.knowledgeBaseIds) && req.body.knowledgeBaseIds.length
      ? req.body.knowledgeBaseIds.map(String)
      : weknora.defaultKnowledgeBaseIds();

    if (!kbIds.length) {
      return res.status(400).json({ message: '未指定知识库，请先在 WeKnora 中创建知识库并配置默认知识库 ID' });
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

      let answerBuffer = '';
      let finishReason = 'stop';

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
          // 记录最终完成事件里的结束原因（如有），不在此处发送 done ——
          // WeKnora 的 agent_query / tool_call / references 等中间事件也会带
          // done=true，逐条转发会产生多个 done，这里统一在流结束后只发一次。
          if (evt.type === 'complete' && evt.finishReason) {
            finishReason = evt.finishReason;
          }
        },
        upstreamController.signal
      );

      if (!clientClosed) {
        send({ type: 'done', finishReason });
        res.end();
      }
    } catch (err) {
      if (!clientClosed) {
        const message =
          err && err.name === 'WeKnoraError' ? err.message : '知识库问答失败，请稍后重试';
        send({ type: 'error', message });
        res.end();
      }
    }
  })
);

module.exports = router;
