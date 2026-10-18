/**
 * 测试入口：npm test（根目录 npm run test:backend 也会走到这里）
 *
 * 分两部分执行：
 *   1. tests/unit/*.test.js —— 纯函数单元测试（node:test），不依赖数据库与外网
 *   2. tests/smoke-relational.js —— 关系表 CRUD 冒烟测试，会写入数据，
 *      因此在数据库「快照副本」上运行，绝不触碰生产 data.db
 *
 * 任一部分失败都以非 0 退出码结束，便于接入 CI。
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const backendRoot = path.resolve(__dirname, '..');
const tmpDir = path.join(__dirname, '.tmp');

// config/security.js 在被 require 时若发现 JWT_SECRET 缺失会直接 process.exit(1)。
// 测试环境通常没有生产 .env，这里补一个一次性值；
// dotenv 不会覆盖已存在的环境变量，因此有真实配置时仍以真实配置为准。
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production';

const runNode = (args, extraEnv = {}) => {
  const result = spawnSync(process.execPath, args, {
    cwd: backendRoot,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv }
  });
  if (result.error) {
    console.error(`[test] 无法启动子进程: ${result.error.message}`);
    return false;
  }
  return result.status === 0;
};

/**
 * 生成生产库的只读快照，供冒烟测试使用。
 * 用 VACUUM INTO 而不是直接复制文件：WAL 模式下直接拷 .db 会丢掉尚未
 * checkpoint 的提交，也可能拷到写一半的中间状态。
 */
const createSnapshotDb = () => {
  fs.mkdirSync(tmpDir, { recursive: true });
  const target = path.join(tmpDir, `smoke-${Date.now()}.db`);
  const sourcePath = path.resolve(backendRoot, process.env.SQLITE_DB_PATH || './data.db');

  if (fs.existsSync(sourcePath)) {
    try {
      const Database = require('better-sqlite3');
      const source = new Database(sourcePath, { readonly: true });
      // 单引号在 SQL 字符串字面量中需转义为两个单引号
      source.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
      source.close();
    } catch (err) {
      console.warn(`[test] 无法生成数据库快照（${err.message}），冒烟测试将在空库上运行`);
    }
  }
  return target;
};

const cleanup = () => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[test] 清理临时目录失败: ${err.message}`);
  }
};

const main = () => {
  console.log('[test] 1/2 单元测试 (tests/unit)');
  // 用 glob 而非目录：node --test 在本版本下把裸目录参数当作入口脚本去 require
  const unitOk = runNode(['--test', 'tests/unit/*.test.js']);

  console.log('\n[test] 2/2 关系表冒烟测试 (tests/smoke-relational.js, 使用数据库快照)');
  const snapshot = createSnapshotDb();
  const smokeOk = runNode([path.join('tests', 'smoke-relational.js')], {
    SMOKE_DB_PATH: snapshot,
    SQLITE_DB_PATH: snapshot
  });
  cleanup();

  console.log('\n================ 测试结果 ================');
  console.log(`单元测试:   ${unitOk ? '通过' : '失败'}`);
  console.log(`冒烟测试:   ${smokeOk ? '通过' : '失败'}`);
  console.log('==========================================');

  process.exit(unitOk && smokeOk ? 0 : 1);
};

main();
