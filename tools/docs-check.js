#!/usr/bin/env node
/**
 * 文档一致性自检（零依赖，Node 22 直接跑）
 *
 * 用法：
 *   node tools/docs-check.js          # 检查全部项目
 *   node tools/docs-check.js links    # 只查链接与锚点
 *   node tools/docs-check.js api      # 只查接口清单
 *   node tools/docs-check.js env      # 只查环境变量
 *   node tools/docs-check.js pages    # 只查页面清单
 *
 * 做五件事：
 *   1. links  相对链接指向的文件是否存在、锚点是否与标题匹配（按 GitHub 的 slug 规则）
 *   2. api    backend/routes/*.js 的真实路由 <-> docs/API.md 记录的端点，双向比对
 *   3. env    backend 代码读取的 process.env.* 是否都在文档里出现过
 *   4. pages  frontend/src/App.tsx 的路由 <-> README「主要页面」表
 *   5. paths  文档里用反引号标注的仓库路径是否真实存在
 *
 * 退出码 0 表示全部通过，1 表示有差异（可直接用于 CI 或提交前检查）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = ['README.md', 'CHANGELOG.md', 'docs/README.md', 'docs/API.md', 'docs/DEPLOYMENT.md', 'docs/DEVELOPMENT.md', 'docs/TOOLS.md', 'docs/USER-GUIDE.md', 'weknora/README.md'];

const problems = [];
const report = [];
function fail(scope, msg) {
  problems.push(`[${scope}] ${msg}`);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function walk(dir, filter) {
  const out = [];
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'vendor') continue;
      out.push(...walk(rel, filter));
    } else if (!filter || filter(rel)) {
      out.push(rel);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. 链接与锚点
// ---------------------------------------------------------------------------
// GitHub 的标题锚点规则：小写 → 去掉标点 → 空格换连字符；中文原样保留
function slug(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[`*_[\]()]/g, '')
    .replace(/[^\w\u4e00-\u9fff -]/g, '')
    .replace(/ /g, '-');
}

function anchorsOf(rel) {
  const set = new Set();
  for (const line of read(rel).split(/\r?\n/)) {
    const m = line.match(/^#{1,6}\s+(.*)$/);
    if (m) set.add(slug(m[1]));
  }
  return set;
}

function checkLinks() {
  const cache = new Map();
  for (const doc of DOCS) cache.set(doc, anchorsOf(doc));

  for (const doc of DOCS) {
    const base = path.posix.dirname(doc);
    // 代码块与行内代码里的 [text](url) 是示例，不是真链接，先剔除
    const text = read(doc)
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`\n]*`/g, '');
    const re = /\[([^\]]*)\]\(([^)\s]+)\)/g;
    let m;
    while ((m = re.exec(text))) {
      const url = m[2];
      if (/^(https?:|mailto:)/.test(url)) continue;
      if (url.startsWith('#')) {
        if (!cache.get(doc).has(slug(url.slice(1)))) fail('links', `${doc}: 锚点不存在 ${url}`);
        continue;
      }
      const [file, frag] = url.split('#');
      const target = path.posix.normalize(path.posix.join(base, file));
      if (!fs.existsSync(path.join(ROOT, target))) {
        fail('links', `${doc}: 文件不存在 ${url}`);
        continue;
      }
      if (frag) {
        const targetAnchors = cache.get(target) || anchorsOf(target);
        cache.set(target, targetAnchors);
        if (!targetAnchors.has(slug(frag))) fail('links', `${doc}: 目标锚点不存在 ${url}`);
      }
    }
  }
  report.push(`links   已检查 ${DOCS.length} 份文档的链接与锚点`);
}

// ---------------------------------------------------------------------------
// 2. 接口清单：server.js 的挂载前缀 + routes/*.js 的 router.xxx
// ---------------------------------------------------------------------------
function realRoutes() {
  const server = read('backend/server.js');
  const mounts = new Map();
  const mountRe = /app\.use\(\s*['"](\/api[^'"]*)['"]\s*,\s*(\w+)\s*\)/g;
  let m;
  while ((m = mountRe.exec(server))) mounts.set(m[2], m[1]);

  const norm = (s) => s.replace(/Routes$/, '').replace(/s$/, '');
  const byFile = new Map();
  for (const [variable, prefix] of mounts) byFile.set(norm(variable), prefix);

  const routes = new Set();
  for (const file of walk('backend/routes', (f) => f.endsWith('.js'))) {
    const base = norm(path.posix.basename(file, '.js'));
    const prefix = byFile.get(base);
    if (!prefix) {
      fail('api', `${file}: 在 server.js 里找不到对应的 app.use 挂载`);
      continue;
    }
    const src = read(file);
    const re = /router\.(get|post|put|patch|delete)\(\s*['"]([^'"]*)['"]/g;
    let r;
    while ((r = re.exec(src))) {
      routes.add(`${r[1].toUpperCase()} ${(prefix + r[2]).replace(/\/+$/, '') || prefix}`);
    }
    // router.route('/x').get().post() 链式写法
    const chainRe = /router\.route\(\s*['"]([^'"]+)['"]\s*\)([\s\S]{0,400}?);/g;
    let c;
    while ((c = chainRe.exec(src))) {
      for (const meth of c[2].matchAll(/\.(get|post|put|patch|delete)\(/g)) {
        routes.add(`${meth[1].toUpperCase()} ${(prefix + c[1]).replace(/\/+$/, '') || prefix}`);
      }
    }
  }
  return routes;
}

function documentedRoutes() {
  const text = read('docs/API.md');
  const out = new Set();
  const strip = (p) => (p.replace(/\/+$/, '') || '/');
  // `GET /api/settings/*` 这类通配写法表示「整个前缀都适用」，不是具体端点，跳过
  for (const m of text.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+`?(\/api\/[A-Za-z0-9_\-/:{}]+)`?/g)) {
    if (m[2].endsWith('/') || text[m.index + m[0].length] === '*') continue;
    out.add(`${m[1]} ${strip(m[2])}`);
  }
  for (const m of text.matchAll(/\|\s*`(\/api\/[A-Za-z0-9_\-/:{}]+)`\s*\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|/g)) {
    if (m[1].endsWith('/') || m[1].includes('*')) continue;
    out.add(`${m[2]} ${strip(m[1])}`);
  }
  return out;
}

function checkApi() {
  const real = realRoutes();
  const doc = documentedRoutes();
  for (const r of real) if (!doc.has(r)) fail('api', `代码有、API.md 未记录：${r}`);
  for (const d of doc) if (!real.has(d)) fail('api', `API.md 有、代码里找不到：${d}`);
  report.push(`api     代码 ${real.size} 个端点 / API.md ${doc.size} 条记录`);
}

// ---------------------------------------------------------------------------
// 3. 环境变量：代码读取的变量必须出现在文档里
// ---------------------------------------------------------------------------
// 由 shell 或 Node 自己注入、无需在文档中说明的变量
const IGNORED_ENV = new Set(['NODE_ENV', 'USERNAME', 'USERDOMAIN', 'PORT']);

function checkEnv() {
  const code = new Set();
  for (const file of walk('backend', (f) => f.endsWith('.js'))) {
    const src = read(file);
    for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) code.add(m[1]);
  }
  const docsText = DOCS.map(read).join('\n');
  for (const v of code) {
    if (IGNORED_ENV.has(v)) continue;
    if (!docsText.includes(v)) fail('env', `代码读取但文档未提及：${v}`);
  }
  report.push(`env     代码读取 ${code.size} 个环境变量（忽略 ${IGNORED_ENV.size} 个由运行时注入的）`);
}

// ---------------------------------------------------------------------------
// 4. 页面清单：App.tsx 的路由必须出现在 README「主要页面」表
// ---------------------------------------------------------------------------
function checkPages() {
  const app = read('frontend/src/App.tsx');
  const routes = new Set();
  for (const m of app.matchAll(/^\s*path="([^"]+)"/gm)) routes.add(m[1]);
  const readme = read('README.md');
  const section = readme.split('## 主要页面')[1].split('\n## ')[0];
  for (const r of routes) {
    if (r === '*') continue;
    if (!section.includes(`\`${r}\``)) fail('pages', `路由未写进 README「主要页面」表：${r}`);
  }
  report.push(`pages   App.tsx ${routes.size} 条路由`);
}

// ---------------------------------------------------------------------------
// 5. 路径存在性：文档里 `backend/routes/x.js` 这种反引号路径要真的存在
// ---------------------------------------------------------------------------
const PATH_PREFIXES = ['backend/', 'frontend/', 'docs/', 'tools/', 'weknora/', 'control/', '.github/'];
// 运行时才生成或作为示例的路径，不做存在性校验
const PATH_ALLOW = ['logs/', 'frontend/src/pages/NewPage.tsx'];

function checkPaths() {
  let checked = 0;
  for (const doc of DOCS) {
    const text = read(doc).replace(/```[\s\S]*?```/g, '');
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const raw = m[1].trim();
      if (!PATH_PREFIXES.some((p) => raw.startsWith(p))) continue;
      if (/[*<>{}|$]/.test(raw)) continue; // 通配、模板、变量
      if (PATH_ALLOW.some((p) => raw.startsWith(p))) continue;
      if (!raw.includes('.')) continue; // 目录引用不校验（目录可能被 .gitignore 忽略）
      checked += 1;
      if (!fs.existsSync(path.join(ROOT, raw))) fail('paths', `${doc}: 引用的路径不存在 ${raw}`);
    }
  }
  report.push(`paths   校验 ${checked} 处反引号标注的仓库路径`);
}

// ---------------------------------------------------------------------------
const only = process.argv[2];
const tasks = { links: checkLinks, api: checkApi, env: checkEnv, pages: checkPages, paths: checkPaths };
const selected = only ? [only] : Object.keys(tasks);
if (only && !tasks[only]) {
  console.error(`未知参数：${only}（可选 ${Object.keys(tasks).join(' / ')}）`);
  process.exit(2);
}

for (const name of selected) tasks[name]();

console.log(report.join('\n'));
if (problems.length) {
  console.error(`\n发现 ${problems.length} 处不一致：`);
  for (const p of problems) console.error('  - ' + p);
  console.error('\n改完请重新运行：node tools/docs-check.js');
  process.exit(1);
}
console.log('\n全部通过：文档与代码一致。');
