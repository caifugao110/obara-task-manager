#!/usr/bin/env node
/**
 * 生成 weknora/.env（从 .env.example 复制并自动填入随机密钥）
 *
 * - 若 .env 已存在且已配置密钥，则跳过（幂等，不会覆盖已有配置）；
 * - 若 .env 不存在则基于 .env.example 创建；
 * - JWT_SECRET 生成 64 位十六进制，SYSTEM_AES_KEY 生成 32 个字符。
 *
 * 用法：node scripts/gen-env.js [--force]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dir = path.join(__dirname, '..');
const envPath = path.join(dir, '.env');
const examplePath = path.join(dir, '.env.example');
const force = process.argv.includes('--force');

const randHex = (bytes) => crypto.randomBytes(bytes).toString('hex');

function main() {
  if (!fs.existsSync(examplePath)) {
    console.error(`[ERROR] 缺少 ${examplePath}`);
    process.exit(1);
  }

  if (fs.existsSync(envPath) && !force) {
    const existing = fs.readFileSync(envPath, 'utf-8');
    const hasJwt = /^JWT_SECRET=\S+/m.test(existing);
    const hasAes = /^SYSTEM_AES_KEY=\S+/m.test(existing);
    if (hasJwt && hasAes) {
      console.log('[OK] weknora/.env 已存在且密钥齐全，跳过生成（--force 可强制重置密钥）。');
      return;
    }
    // 补全缺失的密钥，其余配置保留
    let next = existing;
    if (!hasJwt) {
      next = next.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${randHex(32)}`);
      if (!/^JWT_SECRET=\S+/m.test(next)) next += `\nJWT_SECRET=${randHex(32)}\n`;
    }
    if (!hasAes) {
      next = next.replace(/^SYSTEM_AES_KEY=.*$/m, `SYSTEM_AES_KEY=${randHex(16)}`);
      if (!/^SYSTEM_AES_KEY=\S+/m.test(next)) next += `\nSYSTEM_AES_KEY=${randHex(16)}\n`;
    }
    fs.writeFileSync(envPath, next, 'utf-8');
    console.log('[OK] 已补全 weknora/.env 缺失的密钥。');
    return;
  }

  let content = fs.readFileSync(examplePath, 'utf-8');
  content = content.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${randHex(32)}`);
  content = content.replace(/^SYSTEM_AES_KEY=.*$/m, `SYSTEM_AES_KEY=${randHex(16)}`);
  fs.writeFileSync(envPath, content, 'utf-8');
  console.log('[OK] 已生成 weknora/.env（含随机 JWT_SECRET / SYSTEM_AES_KEY）。');
}

main();
