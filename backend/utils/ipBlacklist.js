/* IP 黑名单工具：规则解析 / 匹配 / Express 拦截中间件
 *
 * 支持三种规则格式（存入前必须通过 validateIpPattern 校验）：
 *   1. 精确 IP     —— 192.168.1.100 / 2001:db8::1
 *   2. CIDR 网段   —— 192.168.1.0/24、2001:db8::/32
 *   3. IPv4 通配符 —— 192.168.*.*（按段匹配，仅限 IPv4）
 *
 * 安全设计：
 *   - IPv4-mapped IPv6（::ffff:a.b.c.d）统一归一为 IPv4，避免同一地址
 *     因表达形式不同绕过匹配；
 *   - 中间件放行本机回环地址（127.0.0.1/::1），防止管理员误封自身
 *     出口 IP 后无法进入系统自救（服务器本机的运维操作永不被拦截）；
 *   - 规则缓存 15 秒 TTL + 写入时主动失效，避免每请求读库。
 */
const db = require('../db');

const BLACKLIST_CACHE_TTL_MS = 15 * 1000;
const MAX_BLACKLIST_ENTRIES = 500;
const MAX_IP_PATTERN_LENGTH = 45; // IPv6 最长 45 字符（含 IPv4-mapped）；CIDR/通配符不会更长

const normalizeIp = (ip) => {
  const trimmed = String(ip || '').trim();
  // trust proxy='loopback' 下 Express 可能给出 IPv4-mapped 形式（::ffff:1.2.3.4）
  return trimmed.replace(/^::ffff:/i, '');
};

const isLoopbackIp = (ip) => {
  const normalized = normalizeIp(ip);
  return normalized === '127.0.0.1' || normalized === '::1';
};

const parseIpv4 = (ip) => {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const num = Number(part);
    if (num > 255) return null;
    // 禁止前导零写法（01.2.3.4），不同解析器语义不一致，避免歧义
    if (part.length > 1 && part.startsWith('0')) return null;
    value = (value << 8n) + BigInt(num);
  }
  return value; // 32bit 无符号
};

// 展开 IPv6 为 8 组 16bit（支持 :: 缩写与末尾点分 IPv4 段）
const expandIpv6 = (ip) => {
  if (!ip.includes(':')) return null;
  if (ip.includes('%')) return null; // zone id 不支持
  if ((ip.match(/::/g) || []).length > 1) return null;

  let head = ip;
  let tailGroups = [];
  // 末尾点分 IPv4（如 ::ffff:1.2.3.4 的 1.2.3.4 部分）折算成 2 组
  const v4Match = ip.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Match) {
    const v4 = parseIpv4(v4Match[2]);
    if (v4 === null) return null;
    tailGroups = [(v4 >> 16n) & 0xffffn, v4 & 0xffffn];
    head = v4Match[1];
  }

  const halves = head.split('::');
  let groups;
  if (halves.length === 2) {
    const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
    const right = halves[1] ? halves[1].split(':').filter(Boolean) : [];
    const fill = 8 - left.length - right.length - tailGroups.length;
    if (fill < 0) return null;
    groups = [...left, ...Array(fill).fill('0'), ...right];
  } else if (halves[0] === head) {
    groups = head.split(':').filter(Boolean);
  } else {
    return null;
  }
  groups = [...groups, ...tailGroups];
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) + BigInt(parseInt(group, 16));
  }
  return value; // 128bit
};

// 把任意 IP 转为 { family, value }；IPv4 值为 32bit，IPv6 值为 128bit
const parseIp = (ip) => {
  const normalized = normalizeIp(ip);
  if (!normalized) return null;
  if (normalized.includes(':')) {
    const value = expandIpv6(normalized);
    return value === null ? null : { family: 6, value };
  }
  const value = parseIpv4(normalized);
  return value === null ? null : { family: 4, value };
};

/**
 * 校验单条黑名单规则格式；返回 { ok, type, normalized } 或 { ok: false, reason }
 * type: 'exact' | 'cidr' | 'wildcard'
 */
const validateIpPattern = (raw) => {
  const pattern = String(raw || '').trim();
  if (!pattern) return { ok: false, reason: '规则为空' };
  if (pattern.length > MAX_IP_PATTERN_LENGTH) return { ok: false, reason: '规则过长' };

  if (pattern.includes('/')) {
    const [addr, prefixRaw] = pattern.split('/');
    if (!addr || prefixRaw === undefined || !/^\d{1,3}$/.test(prefixRaw)) {
      return { ok: false, reason: 'CIDR 前缀长度格式不正确' };
    }
    const prefix = Number(prefixRaw);
    const isV6 = addr.includes(':');
    const maxPrefix = isV6 ? 128 : 32;
    if (prefix > maxPrefix) {
      return { ok: false, reason: `CIDR 前缀长度需在 0-${maxPrefix} 之间` };
    }
    if (addr.includes('*')) return { ok: false, reason: 'CIDR 地址段不支持通配符' };
    const parsed = parseIp(addr);
    if (!parsed) return { ok: false, reason: 'CIDR 地址格式不正确' };
    return { ok: true, type: 'cidr', normalized: `${normalizeIp(addr)}/${prefix}` };
  }

  if (pattern.includes('*')) {
    const parts = pattern.split('.');
    if (parts.length !== 4) return { ok: false, reason: '通配符规则需为 IPv4 四段格式，如 192.168.*.*' };
    for (const part of parts) {
      if (part === '*') continue;
      if (!/^\d{1,3}$/.test(part) || Number(part) > 255) {
        return { ok: false, reason: '通配符规则中每段需为 * 或 0-255 数字' };
      }
      if (part.length > 1 && part.startsWith('0')) return { ok: false, reason: '通配符规则中不允许前导零' };
    }
    return { ok: true, type: 'wildcard', normalized: parts.join('.') };
  }

  const parsed = parseIp(pattern);
  if (!parsed) return { ok: false, reason: 'IP 地址格式不正确' };
  return { ok: true, type: 'exact', normalized: normalizeIp(pattern) };
};

const matchCidr = (parsedIp, cidr) => {
  const [addr, prefixRaw] = cidr.split('/');
  const parsedBase = parseIp(addr);
  if (!parsedBase || parsedBase.family !== parsedIp.family) return false;
  const bits = parsedBase.family === 4 ? 32n : 128n;
  const prefix = BigInt(Number(prefixRaw));
  if (prefix === 0n) return true;
  const shift = bits - prefix;
  return (parsedIp.value >> shift) === (parsedBase.value >> shift);
};

const matchWildcard = (parsedIp, wildcard) => {
  if (parsedIp.family !== 4) return false;
  const ipParts = normalizeIpParts(parsedIp);
  const ruleParts = wildcard.split('.');
  return ruleParts.every((part, i) => part === '*' || Number(part) === Number(ipParts[i]));
};

const normalizeIpParts = (parsedIp) => {
  const value = parsedIp.value;
  return [
    (value >> 24n) & 0xffn,
    (value >> 16n) & 0xffn,
    (value >> 8n) & 0xffn,
    value & 0xffn
  ].map(v => v.toString());
};

/** 判断 IP 是否命中某条规则（rule 为已归一化的规则字符串） */
const matchIp = (ip, rule) => {
  const parsed = parseIp(ip);
  if (!parsed) return false;
  if (rule.includes('/')) return matchCidr(parsed, rule);
  if (rule.includes('*')) return matchWildcard(parsed, rule);
  const target = parseIp(rule);
  if (!target || target.family !== parsed.family) return false;
  return target.value === parsed.value;
};

const defaultBlacklist = () => ({ enabled: false, entries: [] });

// 读取并兜底规范化 settings.ipBlacklist
const readBlacklist = () => {
  const data = db.readDb();
  const stored = data.settings?.ipBlacklist;
  const blacklist = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : defaultBlacklist();
  return {
    enabled: blacklist.enabled === true,
    entries: Array.isArray(blacklist.entries) ? blacklist.entries : []
  };
};

// 缓存：读多写少，15s TTL 兜底；写接口调用 invalidateBlacklistCache() 立即生效
let cache = { data: null, loadedAt: 0 };
const getCachedBlacklist = () => {
  const now = Date.now();
  if (cache.data && now - cache.loadedAt < BLACKLIST_CACHE_TTL_MS) return cache.data;
  cache = { data: readBlacklist(), loadedAt: now };
  return cache.data;
};
const invalidateBlacklistCache = () => {
  cache = { data: null, loadedAt: 0 };
};

/**
 * 全局拦截中间件：命中黑名单的 IP 访问任意 /api 接口返回 403。
 * - OPTIONS 预检与回环地址放行；
 * - 命中 POST /api/auth/login 时额外写入一条登录失败日志，便于在
 *   登录管理界面直观看到拦截记录。
 */
const middleware = (req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  const ip = req.ip || req.socket?.remoteAddress || '';
  if (isLoopbackIp(ip)) return next();

  const blacklist = getCachedBlacklist();
  if (!blacklist.enabled || blacklist.entries.length === 0) return next();

  const hit = blacklist.entries.find(entry => entry?.ip && matchIp(ip, entry.ip));
  if (!hit) return next();

  if (req.method === 'POST' && req.path === '/auth/login') {
    try {
      const data = db.readDb();
      data.loginLogs = Array.isArray(data.loginLogs) ? data.loginLogs : [];
      data.loginLogs.push({
        id: require('crypto').randomUUID(),
        username: String(req.body?.username || ''),
        ip: normalizeIp(ip),
        userAgent: req.headers['user-agent'] || '',
        success: false,
        reason: 'IP 已被列入黑名单',
        timestamp: new Date().toISOString()
      });
      if (data.loginLogs.length > 2000) data.loginLogs = data.loginLogs.slice(-2000);
      db.writeDb(data).catch(() => {});
    } catch { /* 日志失败不阻断拦截响应 */ }
  }

  return res.status(403).json({
    message: '您的 IP 已被列入黑名单，无法访问本系统',
    code: 'IP_BANNED'
  });
};

module.exports = {
  normalizeIp,
  isLoopbackIp,
  validateIpPattern,
  matchIp,
  defaultBlacklist,
  readBlacklist,
  getCachedBlacklist,
  invalidateBlacklistCache,
  middleware,
  MAX_BLACKLIST_ENTRIES
};
