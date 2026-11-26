#!/usr/bin/env node
/**
 * Node.js 版本前置校验（零依赖，preinstall 阶段直接跑）
 *
 * 为什么需要它：
 *   package.json 的 engines 默认只是 warning，npm install 不会失败（除非 engine-strict）。
 *   而本项目真正的最低要求来自依赖本身：
 *     - better-sqlite3@13  engines.node >= 22           （低于 22 没有预编译二进制，装完运行直接崩）
 *     - joi@18             engines.node >= 20
 *     - pdf-parse@2.4      engines.node >= 20.16 < 21 || >= 22.3
 *   所以最低可用版本是 22.3。根目录 .npmrc 已开 engine-strict，
 *   这里再做一层，是为了在 node 22.0~22.2 这种「大版本够、小版本不够」的情况下给出人话提示，
 *   而不是把原始依赖路径和 engines 表达式直接甩给用户。
 *
 * 用法：
 *   node tools/check-node-version.js        # 由 preinstall 自动调用
 *   node tools/check-node-version.js --quiet
 *
 * 退出码：0 通过；1 版本过低。
 */
'use strict';

const MIN_MAJOR = 22;
const MIN_MINOR_WHEN_22 = 3; // pdf-parse@2.4 的下限

const quiet = process.argv.includes('--quiet');
const raw = process.versions.node;
const [major, minor] = raw.split('.').map((n) => Number.parseInt(n, 10));

const fail = (lines) => {
  console.error('');
  console.error('  [ERROR] Node.js 版本过低，无法安装本项目依赖');
  for (const line of lines) console.error(`  ${line}`);
  console.error('');
  console.error('  请安装 Node.js 22 LTS（22.3 以上），然后重新执行 npm install：');
  console.error('    https://nodejs.org/en/download');
  console.error('');
  process.exit(1);
};

if (!Number.isInteger(major)) {
  fail([`解析不出当前 Node 版本：${raw}`]);
}

if (major < MIN_MAJOR) {
  fail([
    `当前版本：v${raw}`,
    `最低要求：v${MIN_MAJOR}.0（实测可用 v${MIN_MAJOR}.${MIN_MINOR_WHEN_22}+）`,
    '',
    '  原因：better-sqlite3@13 只提供 Node 22+ 的预编译二进制，',
    '        joi@18 需要 Node 20+，pdf-parse@2.4 需要 Node 20.16+ 或 22.3+。',
  ]);
}

if (major === MIN_MAJOR && Number.isInteger(minor) && minor < MIN_MINOR_WHEN_22) {
  // 大版本够但小版本不够：npm 会因 engine-strict 报错，这里先把原因说清楚
  fail([
    `当前版本：v${raw}`,
    `最低要求：v${MIN_MAJOR}.${MIN_MINOR_WHEN_22}（pdf-parse@2.4 的 engines 声明）`,
    '',
    `  v${MIN_MAJOR}.0 ~ v${MIN_MAJOR}.${MIN_MINOR_WHEN_22 - 1} 的 Node 22 早期版本不在 pdf-parse 的支持范围内。`,
  ]);
}

if (!quiet) {
  console.log(`[OK] Node.js v${raw}（>= ${MIN_MAJOR}.${MIN_MINOR_WHEN_22}）`);
}
