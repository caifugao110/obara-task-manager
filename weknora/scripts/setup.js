#!/usr/bin/env node
/**
 * WeKnora 一键初始化脚本（幂等，可重复执行）
 *
 * 完成以下全部工作，使 obara-task-manager 的「设计规范知识库」开箱即用：
 *   1. 注册 / 登录 WeKnora 管理员
 *   2. 配置对话模型（DeepSeek）与向量模型（智谱 embedding-3）
 *   3. 创建知识库（★ 建库时即绑定 embedding / summary 模型，
 *      这是 WeKnora 的硬性要求：事后用 PUT 补绑不会生效，
 *      否则文档解析报 "failed to get embedding model: model ID cannot be empty"）
 *   4. 创建全权限 API Key（已有可用 Key 时自动复用）
 *   5. 上传默认知识库文件（knowledge/电极使用规范.pdf）并等待解析完成
 *   6. 把 WEKNORA_* 配置写入 backend/.env
 *
 * 用法：
 *   node scripts/setup.js --deepseek-key sk-xxx --zhipu-key xxx.yyy
 *   # 或用环境变量 DEEPSEEK_API_KEY / BIGMODEL_API_KEY
 *   # 两者都缺且处于交互终端时，脚本会提示输入
 *
 * 可选参数：
 *   --base-url <url>        WeKnora API 根地址（默认 http://127.0.0.1:8080/api/v1）
 *   --backend-env <path>    目标 backend/.env 路径（默认 ../../backend/.env）
 *   --email / --password    管理员账号（默认 admin@obara.local / Obara@WeKnora2026）
 *   --kb-name <name>        知识库名称（默认「设计规范库」）
 *   --file <path>           默认上传文件（默认 ../knowledge/电极使用规范.pdf）
 *   --no-upload             跳过默认文件上传
 *   --no-env                跳过写入 backend/.env
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

/* ==================== 参数 ==================== */

function parseArgs() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[key] = val;
    }
  }
  return out;
}

const args = parseArgs();
const DIR = path.join(__dirname, '..'); // weknora/
const PROJECT_ROOT = path.join(DIR, '..'); // obara-task-manager/

const BASE = (args['base-url'] || process.env.WEKNORA_BASE_URL || 'http://127.0.0.1:8080/api/v1').replace(/\/+$/, '');
const BACKEND_ENV = path.resolve(args['backend-env'] || path.join(PROJECT_ROOT, 'backend', '.env'));

const ADMIN_USERNAME = args.username || process.env.WEKNORA_ADMIN_USERNAME || 'admin';
const ADMIN_EMAIL = args.email || process.env.WEKNORA_ADMIN_EMAIL || 'admin@obara.local';
const ADMIN_PASSWORD = args.password || process.env.WEKNORA_ADMIN_PASSWORD || 'Obara@WeKnora2026';

const DEEPSEEK_MODEL = args['deepseek-model'] || 'deepseek-flash';
const EMBEDDING_MODEL = args['embedding-model'] || 'embedding-3';
const EMBEDDING_DIM = Number(args['embedding-dim'] || 2048);

const KB_NAME = args['kb-name'] || '设计规范库';
const KB_DESC = args['kb-desc'] || '存放机械设计规范、国家标准、行业标准与企业内部设计准则。';

const DEFAULT_FILE = path.resolve(args.file || path.join(DIR, 'knowledge', '电极使用规范.pdf'));
const NO_UPLOAD = !!args['no-upload'];
const NO_ENV = !!args['no-env'];
const PARSE_TIMEOUT_MS = Number(args['parse-timeout'] || 10 * 60 * 1000);

const log = (...a) => console.log(...a);
const fail = (msg) => {
  console.error(`\n[ERROR] ${msg}`);
  process.exit(1);
};

/* ==================== 工具 ==================== */

async function api(p, { method = 'GET', body, token, apiKey, form, timeoutMs = 60000 } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (apiKey) headers['X-API-Key'] = apiKey;
  let payload;
  if (form) {
    payload = form; // FormData，boundary 自动处理
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${BASE}${p}`, { method, headers, body: payload, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    fail(`无法连接 WeKnora（${BASE}${p}）：${err.message}\n请先启动容器：cd weknora && docker compose up -d`);
  }
  clearTimeout(timer);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

const pick = (obj, ...keys) => {
  for (const k of keys) {
    const v = k.split('.').reduce((o, kk) => (o == null ? o : o[kk]), obj);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function promptSecret(question) {
  if (!process.stdin.isTTY) return '';
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return String(answer || '').trim();
}

/** 幂等写入 backend/.env 中的一组 KEY=VALUE */
function upsertEnvFile(file, entries) {
  let content = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  if (content && !content.endsWith('\n')) content += '\n';
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(content)) content = content.replace(re, line);
    else content += `${line}\n`;
  }
  fs.writeFileSync(file, content, 'utf-8');
}

/** 从 backend/.env 读取已有的 WEKNORA_API_KEY（用于复用判断） */
function readExistingEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/* ==================== 主流程 ==================== */

async function main() {
  log('='.repeat(64));
  log('WeKnora 初始化（obara-task-manager 设计规范知识库）');
  log('='.repeat(64));
  log(`API 地址: ${BASE}`);

  // ---------- 0. 健康检查（/health 在服务根路径，不在 /api/v1 下） ----------
  try {
    const root = BASE.replace(/\/api\/v1$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${root}/health`, { signal: controller.signal });
    clearTimeout(timer);
    log(res.ok ? '  ✔ WeKnora 服务在线' : `  ! /health 返回 ${res.status}，继续尝试`);
  } catch {
    fail(`无法连接 WeKnora（${BASE}）。请先启动容器：cd weknora && docker compose up -d`);
  }

  let DEEPSEEK_KEY = args['deepseek-key'] || process.env.DEEPSEEK_API_KEY || '';
  let ZHIPU_KEY = args['zhipu-key'] || process.env.BIGMODEL_API_KEY || '';

  // ---------- 1. 注册 / 登录 ----------
  log('\n[1/6] 准备管理员账号...');
  const reg = await api('/auth/register', {
    method: 'POST',
    body: { username: ADMIN_USERNAME, email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  log(reg.ok ? `  ✔ 已注册账号 ${ADMIN_EMAIL}` : '  · 账号已存在，直接登录');

  const login = await api('/auth/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (!login.ok) fail(`登录失败：HTTP ${login.status} ${JSON.stringify(login.data).slice(0, 300)}`);
  const token = pick(login.data, 'data.token', 'token', 'data.access_token');
  if (!token) fail(`登录响应中没有 token：${JSON.stringify(login.data).slice(0, 300)}`);
  log('  ✔ 登录成功');

  // 空间（tenant）ID：登录响应里未必有，统一从 /tenants 取（data.items 结构）
  const tenants = await api('/tenants', { token });
  const tenantArr = pick(tenants.data, 'data.items', 'data', 'items', 'list') || [];
  const tenantId = Array.isArray(tenantArr) && tenantArr.length
    ? tenantArr[0].id
    : pick(tenants.data, 'data.id', 'data.tenant.id');
  if (!tenantId) fail(`未能确定空间 ID：${JSON.stringify(tenants.data).slice(0, 300)}`);
  log(`  · 空间 ID: ${tenantId}`);

  // ---------- 2. 模型配置 ----------
  log('\n[2/6] 配置模型...');
  const modelList = await api('/models', { token });
  const models = (pick(modelList.data, 'data', 'list') || []).filter((m) => m && m.type);
  const findByType = (type) => models.find((m) => m.type === type);

  let qaModel = findByType('KnowledgeQA');
  let embedModel = findByType('Embedding');

  if (qaModel) {
    log(`  · 已存在对话模型（${qaModel.name}），复用`);
  } else {
    if (!DEEPSEEK_KEY) DEEPSEEK_KEY = await promptSecret('请输入 DeepSeek API Key（sk-...）: ');
    if (!DEEPSEEK_KEY) fail('缺少 DeepSeek API Key（--deepseek-key 或 DEEPSEEK_API_KEY）');
    const r = await api('/models', {
      method: 'POST',
      token,
      body: {
        name: DEEPSEEK_MODEL,
        display_name: `DeepSeek ${DEEPSEEK_MODEL}`,
        type: 'KnowledgeQA',
        source: 'remote',
        description: '设计规范问答用大模型（DeepSeek 官方 API）',
        parameters: {
          base_url: 'https://api.deepseek.com/v1',
          api_key: DEEPSEEK_KEY,
          provider: 'deepseek',
        },
      },
    });
    if (!r.ok) fail(`创建对话模型失败：HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
    qaModel = pick(r.data, 'data') || r.data;
    log(`  ✔ 已创建对话模型 ${DEEPSEEK_MODEL} (id=${qaModel.id})`);
  }

  if (embedModel) {
    log(`  · 已存在向量模型（${embedModel.name}），复用`);
  } else {
    if (!ZHIPU_KEY) ZHIPU_KEY = await promptSecret('请输入智谱 BigModel API Key: ');
    if (!ZHIPU_KEY) fail('缺少智谱 API Key（--zhipu-key 或 BIGMODEL_API_KEY）');
    const r = await api('/models', {
      method: 'POST',
      token,
      body: {
        name: EMBEDDING_MODEL,
        display_name: `智谱 ${EMBEDDING_MODEL}`,
        type: 'Embedding',
        source: 'remote',
        description: '设计规范向量化模型（智谱 BigModel）',
        parameters: {
          base_url: 'https://open.bigmodel.cn/api/paas/v4',
          api_key: ZHIPU_KEY,
          provider: 'zhipu',
          embedding_parameters: { dimension: EMBEDDING_DIM, truncate_prompt_tokens: 0 },
        },
      },
    });
    if (!r.ok) fail(`创建向量模型失败：HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
    embedModel = pick(r.data, 'data') || r.data;
    log(`  ✔ 已创建向量模型 ${EMBEDDING_MODEL} (id=${embedModel.id})`);
  }

  // ---------- 3. 知识库（建库时必须绑定模型） ----------
  log('\n[3/6] 准备知识库...');
  const kbListRes = await api('/knowledge-bases', { token });
  const kbList = pick(kbListRes.data, 'data', 'list') || [];
  let kb = (Array.isArray(kbList) ? kbList : []).find((k) => pick(k, 'name', 'title') === KB_NAME);

  if (kb) {
    const bound = pick(kb, 'embedding_model_id', 'embeddingModelId');
    log(`  · 已存在知识库「${KB_NAME}」(id=${kb.id})${bound ? '' : '，⚠ 未绑定向量模型，文档解析会失败，建议删除后由本脚本重建'}`);
  } else {
    const created = await api('/knowledge-bases', {
      method: 'POST',
      token,
      body: {
        name: KB_NAME,
        description: KB_DESC,
        // ★ 关键：建库时绑定模型，PUT 后补无效
        embedding_model_id: embedModel.id,
        summary_model_id: qaModel.id,
      },
    });
    if (!created.ok) fail(`创建知识库失败：HTTP ${created.status} ${JSON.stringify(created.data).slice(0, 300)}`);
    kb = pick(created.data, 'data', 'knowledge_base') || created.data;
    log(`  ✔ 已创建知识库「${KB_NAME}」(id=${kb.id})，已绑定向量/对话模型`);
  }
  const kbId = kb.id;

  // ---------- 4. API Key（已有可用 Key 则复用） ----------
  log('\n[4/6] 准备 API Key...');
  const existingEnv = readExistingEnv(BACKEND_ENV);
  let apiKey = existingEnv.WEKNORA_API_KEY || '';

  if (apiKey) {
    const probe = await api('/auth/me', { apiKey, timeoutMs: 10000 });
    if (probe.ok) {
      log('  · backend/.env 中已有可用 API Key，复用');
    } else {
      log('  · 已有 API Key 失效，重新创建');
      apiKey = '';
    }
  }

  if (!apiKey) {
    const keyRes = await api(`/tenants/${tenantId}/api-keys`, {
      method: 'POST',
      token,
      body: { name: 'obara-task-manager', full_access: true },
    });
    if (!keyRes.ok) fail(`创建 API Key 失败：HTTP ${keyRes.status} ${JSON.stringify(keyRes.data).slice(0, 300)}`);
    apiKey = pick(keyRes.data, 'data.token', 'data.key', 'token', 'data.api_key', 'key') || '';
    if (!apiKey) fail(`创建成功但未解析到 token：${JSON.stringify(keyRes.data).slice(0, 300)}`);
    log(`  ✔ 已创建 API Key: ${apiKey.slice(0, 10)}…`);
  }

  // ---------- 5. 上传默认知识库文件并等待解析 ----------
  if (!NO_UPLOAD) {
    log('\n[5/6] 上传默认知识库文件...');
    if (!fs.existsSync(DEFAULT_FILE)) {
      log(`  ! 默认文件不存在：${DEFAULT_FILE}，跳过上传`);
    } else {
      const fileName = path.basename(DEFAULT_FILE);
      const listRes = await api(`/knowledge-bases/${kbId}/knowledge`, { apiKey });
      const docs = pick(listRes.data, 'data', 'list') || [];
      const docArr = Array.isArray(docs) ? docs : [];
      const exists = docArr.find((d) => pick(d, 'title', 'file_name', 'fileName', 'name') === fileName);

      if (exists) {
        log(`  · 知识库中已存在《${fileName}》(id=${exists.id})，跳过上传`);
      } else {
        const buf = fs.readFileSync(DEFAULT_FILE);
        const form = new FormData();
        form.append('file', new Blob([buf], { type: 'application/pdf' }), fileName);
        const up = await api(`/knowledge-bases/${kbId}/knowledge/file`, {
          method: 'POST',
          apiKey,
          form,
          timeoutMs: 300000,
        });
        if (!up.ok) fail(`上传失败：HTTP ${up.status} ${JSON.stringify(up.data).slice(0, 300)}`);
        const docId = pick(up.data, 'data.id', 'id');
        log(`  ✔ 已上传《${fileName}》(id=${docId})，等待解析...`);

        // 轮询解析状态
        const t0 = Date.now();
        let status = 'pending';
        while (Date.now() - t0 < PARSE_TIMEOUT_MS) {
          await sleep(5000);
          const cur = await api(`/knowledge-bases/${kbId}/knowledge`, { apiKey });
          const arr = pick(cur.data, 'data', 'list') || [];
          const doc = (Array.isArray(arr) ? arr : []).find((d) => d.id === docId);
          status = pick(doc || {}, 'parse_status', 'parseStatus', 'status') || 'unknown';
          if (['completed', 'success', 'done', 'processed', 'enabled'].includes(String(status).toLowerCase())) break;
          if (['failed', 'error'].includes(String(status).toLowerCase())) {
            fail(`文档解析失败（parse_status=${status}）。请到 WeKnora 控制台查看原因。`);
          }
          process.stdout.write(`  · 解析中（${status}）...\r`);
        }
        if (!['completed', 'success', 'done', 'processed', 'enabled'].includes(String(status).toLowerCase())) {
          log(`\n  ! 等待解析超时（${PARSE_TIMEOUT_MS / 60000} 分钟），当前状态 ${status}，可稍后在控制台确认`);
        } else {
          log(`  ✔ 解析完成（parse_status=${status}）`);
        }
      }
    }
  } else {
    log('\n[5/6] 按 --no-upload 跳过文件上传');
  }

  // ---------- 6. 写入 backend/.env ----------
  if (!NO_ENV) {
    log('\n[6/6] 写入 backend/.env ...');
    upsertEnvFile(BACKEND_ENV, {
      WEKNORA_ENABLED: 'true',
      WEKNORA_BASE_URL: BASE,
      WEKNORA_API_KEY: apiKey,
      WEKNORA_KNOWLEDGE_BASE_IDS: kbId,
      WEKNORA_TIMEOUT_MS: '60000',
    });
    log(`  ✔ 已更新 ${BACKEND_ENV}`);
    log('  ! 注意：backend 为 node server.js（非 nodemon），需重启后端才会加载新配置');
  } else {
    log('\n[6/6] 按 --no-env 跳过写入 backend/.env');
  }

  // ---------- 摘要 ----------
  log('\n' + '-'.repeat(64));
  log('初始化完成：');
  log(`  WeKnora 控制台 : http://localhost:${process.env.FRONTEND_PORT || 80}`);
  log(`  管理员账号     : ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  log(`  知识库         : ${KB_NAME} (id=${kbId})`);
  log(`  API Key        : ${apiKey.slice(0, 10)}…（已写入 backend/.env）`);
  log('-'.repeat(64));
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)));
