'use strict';
/**
 * 版本号计算（本地 git 提交日期 + 当日计数）与 Gitee 远端比对。
 * 注意 __dirname 已从 routes/ 变成 routes/system/，所以 PROJECT_ROOT 要往上多退一层。
 *
 * 由 backend/routes/system.js 拆分而来，代码为原样搬运（未改逻辑）。
 */
const path = require('path');
const { execFileSync } = require('child_process');
const https = require('https');
const securityConfig = require('../../config/security');

// 项目根目录（backend/routes/ -> ../../）
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

// 使用 execFileSync + 参数数组：不经 shell 解析，杜绝命令注入
const runGit = (args, options = {}) => {
  try {
    return execFileSync('git', args, {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      timeout: 10000,
      ...options
    }).trim();
  } catch {
    return null;
  }
};

const computeLocalVersion = () => {
  try {
    const commitDate = runGit(['log', '-1', '--format=%cd', '--date=format:%y-%m-%d']);
    if (!commitDate) {
      return '未知';
    }
    const fullDate = runGit(['log', '-1', '--format=%cd', '--date=format:%Y-%m-%d']);
    let commitCount = 0;
    if (fullDate) {
      const countStr = runGit(['rev-list', '--count', `--since=${fullDate} 00:00:00`, `--until=${fullDate} 23:59:59`, 'HEAD']);
      commitCount = parseInt(countStr, 10) || 0;
    }
    let version = commitDate;
    if (commitCount > 1) {
      version = `${commitDate}-V${commitCount}`;
    }
    return version;
  } catch {
    return '未知';
  }
};

// 版本号带 30 秒 TTL 缓存：启动时算一次的常量无法反映 git pull 后的
// 新 HEAD（后端未重启时 nodemon 可能没触发重启或直接不是用 nodemon
// 启动的），每次请求动态算 + 短缓存既保证实时又不会每次 exec git。
let _versionCache = null;
let _versionCacheUntil = 0;
const getLocalVersion = () => {
  const now = Date.now();
  if (_versionCache && now < _versionCacheUntil) return _versionCache;
  _versionCache = computeLocalVersion();
  _versionCacheUntil = now + 30_000;
  return _versionCache;
};

const fetchGiteeLatestCommit = () => {
  return new Promise((resolve) => {
    const { token, repoOwner, repoName } = securityConfig.gitee;
    if (!token || !repoOwner || !repoName) {
      resolve(null);
      return;
    }

    const getLatestCommit = () => {
      return new Promise((resolve) => {
        const options = {
          hostname: 'gitee.com',
          path: `/api/v5/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/commits?sha=main&per_page=1`,
          method: 'GET',
          headers: {
            'Authorization': `token ${token}`,
            'User-Agent': 'Obara-Task-Manager'
          },
          timeout: 5000
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const commits = JSON.parse(data);
              if (Array.isArray(commits) && commits.length > 0) {
                const commit = commits[0];
                const commitDate = new Date(commit.commit.committer.date);
                const fullDate = commitDate.toISOString().split('T')[0];
                const dateStr = fullDate.slice(2);
                resolve({ date: dateStr, fullDate });
              } else {
                resolve(null);
              }
            } catch {
              resolve(null);
            }
          });
        });

        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.end();
      });
    };

    const getCommitCountForDate = (fullDate) => {
      return new Promise((resolve) => {
        const since = `${fullDate}T00:00:00+08:00`;
        const until = `${fullDate}T23:59:59+08:00`;
        const options = {
          hostname: 'gitee.com',
          path: `/api/v5/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/commits?sha=main&since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&per_page=100`,
          method: 'GET',
          headers: {
            'Authorization': `token ${token}`,
            'User-Agent': 'Obara-Task-Manager'
          },
          timeout: 5000
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const commits = JSON.parse(data);
              if (Array.isArray(commits)) {
                resolve(commits.length);
              } else {
                resolve(1);
              }
            } catch {
              resolve(1);
            }
          });
        });

        req.on('error', () => resolve(1));
        req.on('timeout', () => { req.destroy(); resolve(1); });
        req.end();
      });
    };

    getLatestCommit().then((result) => {
      if (!result) {
        resolve(null);
        return;
      }

      getCommitCountForDate(result.fullDate).then((count) => {
        let version = result.date;
        if (count > 1) {
          version = `${result.date}-V${count}`;
        }
        resolve({ date: version, fullDate: result.fullDate, commitCount: count });
      });
    });
  });
};

const compareVersions = (v1, v2) => {
  const parseVersion = (version) => {
    const parts = String(version || '').split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);
    const vMatch = parts[3]?.match(/^V(\d+)$/);
    const versionNum = vMatch ? parseInt(vMatch[1], 10) : 0;
    return { year: isNaN(year) ? 0 : year, month: isNaN(month) ? 0 : month, day: isNaN(day) ? 0 : day, versionNum: isNaN(versionNum) ? 0 : versionNum };
  };

  const p1 = parseVersion(v1);
  const p2 = parseVersion(v2);

  if (p1.year !== p2.year) return p1.year - p2.year;
  if (p1.month !== p2.month) return p1.month - p2.month;
  if (p1.day !== p2.day) return p1.day - p2.day;
  return p1.versionNum - p2.versionNum;
};

module.exports = {
  PROJECT_ROOT,
  runGit,
  computeLocalVersion,
  _versionCache,
  _versionCacheUntil,
  getLocalVersion,
  fetchGiteeLatestCommit,
  compareVersions,
};
