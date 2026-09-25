#!/usr/bin/env node
/**
 * WeKnora 一键初始化脚本（幂等，可重复执行）
 *
 * 完成以下工作，使 obara-task-manager 的「设计规范知识库」可以接入：
 *   1. 注册 / 登录 WeKnora 管理员
 *   2. 配置对话模型（DeepSeek）与向量模型（智谱 embedding-3）
 *   3. 创建全权限 API Key（已有可用 Key 时自动复用）
 *   4. 把 WEKNORA_* 配置写入 backend/.env
 *
 * 注意：本脚本不再创建默认知识库、也不再上传默认文档。
 * 知识库由用户在 WeKnora 控制台（http://localhost/platform/knowledge-bases）
 * 自行创建，然后在 obara-task-manager 的「设计规范知识库 → 知识库管理」页面
 * 通过「知识库 ID」进行关联。
 *
 * 用法：
 *   node scripts/setup.js --deepseek-key sk-xxx --zhipu-key xxx.yyy
 *
 * 模型 API Key 取值优先级（只有全部缺失且处于交互终端时才提示输入）：
 *   1. 命令行参数 --deepseek-key / --zhipu-key
 *   2. 环境变量 DEEPSEEK_API_KEY / BIGMODEL_API_KEY
 *   3. 配置文件 weknora/.env 中的同名项（推荐：写一次，免除输入）
 *   4. 交互式询问
 *
 * 可选参数：
 *   --base-url <url>        WeKnora API 根地址（默认 http://127.0.0.1:8080/api/v1）
 *   --backend-env <path>    目标 backend/.env 路径（默认 ../../backend/.env）
 *   --email / --password    管理员账号（默认 admin@obara.local / Obara@WeKnora2026）
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

/** 解析 weknora/.env（KEY=VALUE，忽略注释与空行），作为配置的兜底来源 */
function loadEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const fileEnv = loadEnvFile(path.join(DIR, '.env'));

/** 取值优先级：--命令行参数 > 进程环境变量 > weknora/.env > 默认值 */
const cfg = (argKey, envKey, fileKey, dft) =>
  args[argKey] || process.env[envKey] || fileEnv[fileKey || envKey] || dft;

const BASE = (args['base-url'] || process.env.WEKNORA_BASE_URL || 'http://127.0.0.1:8080/api/v1').replace(/\/+$/, '');
const BACKEND_ENV = path.resolve(args['backend-env'] || path.join(PROJECT_ROOT, 'backend', '.env'));

const ADMIN_USERNAME = cfg('username', 'WEKNORA_ADMIN_USERNAME', null, 'admin');
const ADMIN_EMAIL = cfg('email', 'WEKNORA_ADMIN_EMAIL', null, 'admin@obara.local');
const ADMIN_PASSWORD = cfg('password', 'WEKNORA_ADMIN_PASSWORD', null, 'Obara@WeKnora2026');

const DEEPSEEK_MODEL = args['deepseek-model'] || 'deepseek-flash';
const EMBEDDING_MODEL = args['embedding-model'] || 'embedding-3';
const EMBEDDING_DIM = Number(args['embedding-dim'] || 2048);

const NO_ENV = !!args['no-env'];

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

  let DEEPSEEK_KEY = args['deepseek-key'] || process.env.DEEPSEEK_API_KEY || fileEnv.DEEPSEEK_API_KEY || '';
  let ZHIPU_KEY = args['zhipu-key'] || process.env.BIGMODEL_API_KEY || fileEnv.BIGMODEL_API_KEY || '';

  // ---------- 1. 注册 / 登录 ----------
  log('\n[1/4] 准备管理员账号...');
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
  log('\n[2/4] 配置模型...');
  const modelList = await api('/models', { token });
  const models = (pick(modelList.data, 'data', 'list') || []).filter((m) => m && m.type);
  const findByType = (type) => models.find((m) => m.type === type);

  let qaModel = findByType('KnowledgeQA');
  let embedModel = findByType('Embedding');

  if (qaModel) {
    log(`  · 已存在对话模型（${qaModel.name}），复用`);
  } else {
    if (!DEEPSEEK_KEY) DEEPSEEK_KEY = await promptSecret('请输入 DeepSeek API Key（sk-...，可写入 weknora/.env 的 DEEPSEEK_API_KEY 免除输入）: ');
    if (!DEEPSEEK_KEY) fail('缺少 DeepSeek API Key（--deepseek-key / DEEPSEEK_API_KEY 环境变量 / weknora/.env 均可）');
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
    if (!ZHIPU_KEY) ZHIPU_KEY = await promptSecret('请输入智谱 BigModel API Key（可写入 weknora/.env 的 BIGMODEL_API_KEY 免除输入）: ');
    if (!ZHIPU_KEY) fail('缺少智谱 API Key（--zhipu-key / BIGMODEL_API_KEY 环境变量 / weknora/.env 均可）');
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

  // ---------- 3. API Key（已有可用 Key 则复用） ----------
  log('\n[3/4] 准备 API Key...');
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

  // ---------- 4. 写入 backend/.env ----------
  if (!NO_ENV) {
    log('\n[4/4] 写入 backend/.env ...');
    upsertEnvFile(BACKEND_ENV, {
      WEKNORA_ENABLED: 'true',
      WEKNORA_BASE_URL: BASE,
      WEKNORA_API_KEY: apiKey,
      WEKNORA_TIMEOUT_MS: '60000',
    });
    log(`  ✔ 已更新 ${BACKEND_ENV}`);
    log('  ! 注意：backend 为 node server.js（非 nodemon），需重启后端才会加载新配置');
  } else {
    log('\n[4/4] 按 --no-env 跳过写入 backend/.env');
  }

  // ---------- 摘要 ----------
  log('\n' + '-'.repeat(64));
  log('初始化完成：');
  log(`  WeKnora 控制台 : http://localhost:${process.env.FRONTEND_PORT || 80}`);
  log(`  管理员账号     : ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  log(`  API Key        : ${apiKey.slice(0, 10)}…（已写入 backend/.env）`);
  log('');
  log('  下一步：在 WeKnora 控制台创建知识库，然后在 obara-task-manager 的');
  log('  「设计规范知识库 → 知识库管理」页面通过「知识库 ID」关联该知识库。');
  log('-'.repeat(64));
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)));
