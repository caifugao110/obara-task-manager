'use strict';

// 断网备份接口（POST /api/system/maintenance/offline-backup）的一次性令牌。
//
// 背景：该接口原先用「来源 socket 是否为 127.0.0.1」匿名放行本机运维脚本，
// 但前端经 Vite/nginx 代理转发后，局域网请求的源地址也会变成 127.0.0.1，
// 于是任何人都能匿名触发备份（反复调用可写满磁盘）。
//
// 现在改为：后端启动时生成随机令牌并写入 logs/offline-backup.token，
// stop.bat 读取后通过 X-Offline-Backup-Token 请求头传入；
// 校验通过即轮换令牌，保证同一个令牌只能使用一次。

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TOKEN_FILE = path.resolve(__dirname, '../../logs/offline-backup.token');

let currentToken = '';

const writeTokenFile = () => {
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, currentToken, { mode: 0o600 });
  } catch (error) {
    // 写盘失败不影响接口本身（超级管理员仍可调用），只是 stop.bat 无法自动备份
    console.warn('[offline-backup] 写入一次性令牌文件失败，stop.bat 将无法自动触发备份:', error.message);
  }
};

const rotate = () => {
  currentToken = crypto.randomBytes(32).toString('base64url');
  writeTokenFile();
};

const safeEqual = (candidate, expected) => {
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(String(expected || ''));
  if (a.length !== b.length || b.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
};

/**
 * 校验并消费一次性令牌：匹配成功后立即轮换，旧令牌永久失效。
 * @param {string} candidate 调用方通过 X-Offline-Backup-Token 传入的令牌
 * @returns {boolean} 是否为当前有效令牌
 */
const consumeToken = (candidate) => {
  if (!safeEqual(candidate, currentToken)) return false;
  rotate();
  return true;
};

rotate();

module.exports = { consumeToken, TOKEN_FILE };
