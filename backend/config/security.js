const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const parseOriginList = () => {
  const originEnv = process.env.CORS_ORIGIN || '';
  if (!originEnv.trim()) return ['*'];
  return originEnv.split(',').map(o => o.trim()).filter(Boolean);
};

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
    origin: parseOriginList(),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
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
    path: process.env.DB_PATH || './db.json'
  },
  spec: {
    sharePath: process.env.SPEC_SHARE_PATH || '\\\\192.168.160.6\\仕样书$'
  }
};

module.exports = securityConfig;
