#!/usr/bin/env node
/**
 * 文件体量棘轮（ratchet）：只降不升
 *
 * 背景：Dashboard/index.tsx 已经 6800 行，GunLedger 4600 行，SystemSettings 3400 行。
 * 直接把「单文件不超过 500 行」写成硬性检查会让整个仓库立刻红灯，谁都不会去修；
 * 只在代码评审里说「注意别写太大」又完全不生效。这里用棘轮：
 *   - 现有超标文件登记在 tools/file-size-baseline.json，作为**该文件的当前上限**；
 *   - 文件再变大 → 失败（拦住「继续往巨石里塞」）；
 *   - 文件变小 → 通过，并提示把基线改小（锁定这次瘦身成果）；
 *   - 新文件超过硬阈值 → 失败（新代码没有历史包袱，没理由一上来就两千行）。
 *
 * 用法：
 *   node tools/check-file-size.js            # 检查（CI / 提交前）
 *   node tools/check-file-size.js --update   # 按当前实际行数重写基线（拆完文件后执行）
 *   node tools/check-file-size.js --list     # 只打印超标文件与余量
 *
 * 退出码：0 通过；1 有文件变大或新超标。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'file-size-baseline.json');

/** 新文件的硬上限：超过这个行数就不该出现在一次提交里 */
const HARD_LIMIT = 500;
/** 基线文件收录的门槛：低于这个值的文件不登记，避免基线变成一个巨大的数字墙 */
const BASELINE_FLOOR = 400;

/** 统计范围：业务源码。测试文件、构建产物、第三方包、运行期数据不计入 */
const SCAN_DIRS = ['frontend/src', 'backend'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js']);
const SKIP_DIR_NAMES = new Set(['node_modules', 'vendor', 'dist', 'coverage', '.tmp', 'backups', 'logs']);
const SKIP_FILE_PATTERNS = [
  /\.test\.(ts|tsx|js)$/,
  /\.spec\.(ts|tsx|js)$/,
  /[\\/]__tests__[\\/]/,
  /[\\/]tests[\\/]/,
];

const walk = (relDir) => {
  const out = [];
  const absDir = path.join(ROOT, relDir);
  if (!fs.existsSync(absDir)) return out;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const rel = path.posix.join(relDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      out.push(...walk(rel));
      continue;
    }
    if (!EXTENSIONS.has(path.extname(entry.name))) continue;
    if (SKIP_FILE_PATTERNS.some((re) => re.test(rel))) continue;
    out.push(rel);
  }
  return out;
};

const countLines = (rel) => {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // 末尾是否有换行不影响行数：统一按换行符切分后统计非空结尾
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.length;
};

const measure = () => {
  const files = SCAN_DIRS.flatMap(walk);
  const sizes = new Map();
  for (const rel of files) sizes.set(rel, countLines(rel));
  return sizes;
};

const readBaseline = () => {
  if (!fs.existsSync(BASELINE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  } catch (err) {
    console.error(`[ERROR] 基线文件解析失败：${BASELINE_PATH}`);
    console.error(`        ${err.message}`);
    process.exit(1);
  }
};

const writeBaseline = (sizes) => {
  const entries = [...sizes.entries()]
    .filter(([, lines]) => lines >= BASELINE_FLOOR)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const json = {};
  for (const [rel, lines] of entries) json[rel] = lines;
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  console.log(`已写入基线：${entries.length} 个文件（>= ${BASELINE_FLOOR} 行），最大 ${entries[0] ? `${entries[0][1]} 行` : '-'}`);
};

const main = () => {
  const args = process.argv.slice(2);
  const sizes = measure();

  if (args.includes('--update')) {
    writeBaseline(sizes);
    return;
  }

  if (args.includes('--list')) {
    const rows = [...sizes.entries()].filter(([, lines]) => lines > HARD_LIMIT).sort((a, b) => b[1] - a[1]);
    for (const [rel, lines] of rows) console.log(`${String(lines).padStart(6)}  ${rel}`);
    console.log(`共 ${rows.length} 个文件超过 ${HARD_LIMIT} 行`);
    return;
  }

  const baseline = readBaseline();
  const grown = [];
  const tooBigNew = [];
  const shrunk = [];

  for (const [rel, lines] of sizes) {
    const cap = baseline[rel];
    if (typeof cap === 'number') {
      if (lines > cap) grown.push({ rel, lines, cap });
      else if (lines < cap) shrunk.push({ rel, lines, cap });
      continue;
    }
    if (lines > HARD_LIMIT) tooBigNew.push({ rel, lines });
  }

  // 基线里已经删掉的文件不用报错，但提示清掉，否则基线会越积越旧
  const removed = Object.keys(baseline).filter((rel) => !sizes.has(rel));

  if (shrunk.length > 0) {
    console.log('已瘦身（建议运行 node tools/check-file-size.js --update 锁定成果）：');
    for (const { rel, lines, cap } of shrunk) console.log(`  -${String(cap - lines).padStart(4)} 行  ${rel}  ${cap} → ${lines}`);
    console.log('');
  }

  if (removed.length > 0) {
    console.log('基线中存在但已不存在的文件（--update 时会自动清掉）：');
    for (const rel of removed) console.log(`  ${rel}`);
    console.log('');
  }

  const problems = [];
  for (const { rel, lines, cap } of grown) {
    problems.push(`${rel}: ${lines} 行，超过基线 ${cap} 行（多了 ${lines - cap} 行）`);
  }
  for (const { rel, lines } of tooBigNew) {
    problems.push(`${rel}: ${lines} 行，新文件超过 ${HARD_LIMIT} 行上限`);
  }

  if (problems.length > 0) {
    console.error('文件体量检查未通过：');
    for (const p of problems) console.error(`  - ${p}`);
    console.error('');
    console.error('处理方式：');
    console.error('  1. 新功能写进新的子组件 / 自定义 hook，不要继续加进已有的巨石文件；');
    console.error('  2. 确实必须增长（例如补注释、加类型定义）时，用 --update 更新基线，并在提交信息里说明原因；');
    console.error('  3. 超过 500 行的新文件请先拆分再提交。');
    process.exit(1);
  }

  const watched = Object.keys(baseline).length;
  console.log(`文件体量检查通过：${sizes.size} 个源文件，${watched} 个纳入基线，无文件变大。`);
};

main();
