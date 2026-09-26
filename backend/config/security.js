const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const isProduction = () => (process.env.NODE_ENV || 'development') === 'production';

const parseOriginList = () => {
  const originEnv = process.env.CORS_ORIGIN || '';
  if (!originEnv.trim()) {
    // 未配置时回退为 '*'（仅限开发/内网调试）。生产环境应显式配置 CORS_ORIGIN 白名单。
    if (isProduction()) {
      console.warn('[SECURITY WARNING] CORS_ORIGIN is not set in production. ' +
        'Falling back to wildcard origin without credentials. Set CORS_ORIGIN to an explicit allowlist.');
    }
    return ['*'];
  }
  return originEnv.split(',').map(o => o.trim()).filter(Boolean);
};

const corsOrigins = parseOriginList();
// 通配符 '*' 与 credentials: true 的组合既违反 CORS 规范（浏览器拒绝），也是最宽松配置；
// 本项目使用 Bearer Token 鉴权而非 Cookie，通配符场景下无需 credentials。
const corsAllowCredentials = !corsOrigins.includes('*');

if (!process.env.JWT_SECRET) {
  console.error('[SECURITY ERROR] JWT_SECRET is not set in environment variables.');
  console.error('Please set JWT_SECRET in your .env file before starting the server.');
  process.exit(1);
}

const securityConfig = {
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    issuer: process.env.JWT_ISSUER || 'obara-task-manager',
    audience: process.env.JWT_AUDIENCE || 'obara-task-manager-api'
  },
  cors: {
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: corsAllowCredentials
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
    max: parseInt(process.env.RATE_LIMIT_MAX) || 20
  },
  gitee: {
    token: process.env.GITEE_TOKEN || '',
    repoOwner: process.env.GITEE_REPO_OWNER || '',
    repoName: process.env.GITEE_REPO_NAME || ''
  },
  server: {
    port: parseInt(process.env.PORT) || 5000,
    environment: process.env.NODE_ENV || 'development'
  },
  database: {
    // 遗留 JSON 数据库路径（仅用于首次迁移导入，迁移完成后可删除）
    legacyJsonPath: process.env.DB_PATH || './db.json',
    // SQLite 数据库路径
    sqlitePath: process.env.SQLITE_DB_PATH || './data.db'
  },
  spec: {
    sharePath: process.env.SPEC_SHARE_PATH || '\\\\192.168.160.6\\仕样书$'
  }
};

module.exports = securityConfig;
