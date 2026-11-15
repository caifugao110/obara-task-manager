'use strict';

/**
 * 共享路径访问状态（系统设置 → 状态监测 → 共享路径访问）
 *
 * 监测页原来只看得到「后端进程自己」的健康度：可用率、流量、内存、数据库体积。
 * 但业务真正跑不动时，往往是进程活着、共享盘掉了——仕样书取号失败、状态跟踪
 * 同步大日程失败，从监测页完全看不出原因，只能去翻后端日志。
 *
 * 这里对两个关键路径做只读探测：
 *   SPEC_SHARE_PATH            仕样书共享目录（目录，取号 / PDF / 设计交付）
 *   PRODUCTION_SCHEDULE_PATH   各产品大日程（文件，状态跟踪的数量 / 纳期 / 已发图）
 *
 * 探测必须廉价且不能拖垮进程，因此：
 *   1. 先探 SMB 端口（445/139）。主机都不可达时直接判定「网络不通」，
 *      不再发 UNC 调用——共享服务器掉线时，一次 stat 要等 Windows 自己那套
 *      30 秒超时，还占着 libuv 线程池的一个线程。
 *      但端口探测只是快速否定：本地防火墙会直接拒绝这条 TCP（EACCES/EPERM），
 *      本机也可能已有可用的 SMB 会话，这两种情况要继续做真实访问（见 HOST_DOWN_CODES）。
 *   2. 真正访问文件系统时套硬时限（默认 2.5 秒），超时只报告「超时」，不无限等。
 *   3. 结果带缓存：成功 30 秒、失败 10 秒。监测页 30 秒自动刷新一次，
 *      否则等于每 30 秒对共享盘做一次全量探测。
 *   4. 全部异步实现：同步 stat 会把事件循环整段占住，监测页自己先「假死」。
 */

const fs = require('fs');
const securityConfig = require('../config/security');
const uncShare = require('./uncShare');

// 单个路径的探测硬时限：共享不可达时宁可报超时，也不能让请求一直挂着
const PROBE_TIMEOUT_MS = Math.max(500, Number(process.env.SHARE_STATUS_PROBE_TIMEOUT_MS) || 2500);
// 端口探测时限：比文件探测更短，目的只是「快速给出主机通不通」
const HOST_PROBE_TIMEOUT_MS = Math.max(300, Number(process.env.SHARE_STATUS_HOST_TIMEOUT_MS) || 1500);
// 缓存：成功的状态 30 秒内直接复用，失败的 10 秒后允许重试
const OK_TTL_MS = Math.max(1000, Number(process.env.SHARE_STATUS_OK_TTL_MS) || 30000);
const FAIL_TTL_MS = Math.max(1000, Number(process.env.SHARE_STATUS_FAIL_TTL_MS) || 10000);

/**
 * 只有这些错误码才说明「主机整体到不了」，可以直接判死、不再发 UNC 调用。
 *
 * EACCES / EPERM 故意不在其中：那是**本地防火墙 / 终端防护拒绝了这条 TCP 探测**
 * （实测 192.168.160.70 就是这种情况，445 探测永远 EACCES，而 net use 会话与
 * 文件读写一直正常）。把它当成「主机不可达」会让监测页长期报红 21 次连续失败，
 * 而状态跟踪页的「同步生产大日程」其实跑得好好的——监测结论必须和真实可用性一致。
 */
const HOST_DOWN_CODES = new Set(['ETIMEDOUT', 'ETIMEOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN', 'ECONNREFUSED', 'ENOTFOUND']);

// 「net use 已建立连接」可以当作可达证据，但记录会一直留着：
// 超过这个时长就不再采信（太旧的记录说明不了现在的连通性），免得端口探测
// 明明说主机掉线、页面却因为一条陈旧的记录去等 SMB 的 30 秒超时。
const RECENT_ENSURE_MS = Math.max(60 * 1000, Number(process.env.SHARE_STATUS_ENSURE_EVIDENCE_MS) || 15 * 60 * 1000);

/**
 * 两个受监测的路径。resolve() 延迟取值：securityConfig 在 require 时已读 .env，
 * 但显式包一层可以让测试通过改环境变量重新加载配置。
 */
const TARGETS = [
  {
    key: 'specShare',
    env: 'SPEC_SHARE_PATH',
    label: '仕样书共享目录',
    scope: '取号、仕样书 PDF、设计交付',
    kind: 'directory',
    resolve: () => securityConfig.spec.sharePath
  },
  {
    key: 'productionSchedule',
    env: 'PRODUCTION_SCHEDULE_PATH',
    label: '各产品大日程',
    scope: '状态跟踪的数量 / 纳期 / 已发图',
    kind: 'file',
    resolve: () => securityConfig.schedule.filePath
  }
];

// key -> 最近一次探测状态；这里保留历史（最近成功/失败时间、连续失败次数），
// 缓存过期后这些字段仍然有用：共享刚恢复时能看出「刚才是掉的」。
const state = new Map();

/** 给任意 Promise 加时限，超时返回 { timedOut: true } 而不是抛错 */
function withDeadline(promise, ms) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  const settled = Promise.resolve(promise).then(
    (value) => ({ timedOut: false, value }),
    (error) => ({ timedOut: false, error })
  );
  return Promise.race([settled, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * 把 errno / Windows 错误码翻译成能直接指导处置的结论。
 * 「无法访问共享」这种提示等于没说，管理员需要知道是网络、权限、还是文件被独占。
 * @param {NodeJS.ErrnoException} error
 * @returns {{ code: string, reason: string, hint: string }}
 */
function classifyError(error) {
  const code = String((error && error.code) || 'ERROR');
  const raw = String((error && error.message) || '').slice(0, 300);

  if (code === 'EBUSY' || /\bEBUSY\b/.test(raw)) {
    return {
      code,
      reason: 'locked',
      hint: '文件被其他程序独占（常见于 Excel 正在打开该文件），关闭后会自动恢复'
    };
  }
  if (code === 'EPERM' || code === 'EACCES') {
    return {
      code,
      reason: 'access-denied',
      hint: '权限或会话被拒：确认后端运行账户（服务/计划任务常为 SYSTEM）已被授予该共享权限，'
        + '或配置 UNC_CREDENTIALS 让后端自行建立连接'
    };
  }
  if (code === 'ENOENT') {
    return {
      code,
      reason: 'not-found',
      hint: '路径不存在：共享目录被改名/删除，或路径拼写与服务器实际共享名不一致'
    };
  }
  if (code === 'ENOTDIR') {
    return {
      code,
      reason: 'not-directory',
      hint: '路径存在但不是目录，请检查配置指向'
    };
  }
  if (code === 'ETIMEDOUT' || code === 'ETIMEOUT') {
    return { code, reason: 'timeout', hint: '访问超时：共享服务器无响应或网络中断' };
  }
  if (code === 'ENOTFOUND' || code === 'ENODEV' || code === 'UNKNOWN' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return {
      code,
      reason: 'unreachable',
      hint: '共享主机不可达：检查服务器是否开机、网段/VPN 是否通、445 端口是否被防火墙拦截'
    };
  }
  return { code, reason: 'error', hint: '访问失败，详细原因见后端日志' };
}

/** 只读探测目标本身：目录看能不能 stat + 读权限，文件额外返回体积与修改时间 */
async function statTarget(target, filePath) {
  const stat = await fs.promises.stat(filePath);

  if (target.kind === 'directory') {
    if (!stat.isDirectory()) {
      const error = new Error('配置指向的不是目录');
      error.code = 'ENOTDIR';
      throw error;
    }
    // 目录能 stat 但未必可读：net use 只建立了连接，共享级权限仍可能拒绝读取，
    // 那种情况下取号会全部失败，而 stat 却是成功的，必须单独确认读权限。
    await fs.promises.access(filePath, fs.constants.R_OK);
    return { isDirectory: true };
  }

  if (!stat.isFile()) {
    const error = new Error('配置指向的不是文件');
    error.code = 'ENOTDIR';
    throw error;
  }
  return { isFile: true, sizeBytes: stat.size, mtimeMs: stat.mtimeMs };
}

/**
 * 探测单个目标。
 * @param {{ key: string, env: string, label: string, scope: string, kind: string, resolve: () => string }} target
 * @returns {Promise<object>}
 */
async function probeTarget(target) {
  const startedAt = Date.now();
  const filePath = String(target.resolve() || '').trim();
  const base = {
    key: target.key,
    env: target.env,
    label: target.label,
    scope: target.scope,
    kind: target.kind,
    path: filePath,
    configured: Boolean(filePath),
    shareRoot: filePath ? uncShare.getShareRoot(filePath) : '',
    host: filePath ? uncShare.getShareHost(filePath) : ''
  };

  const previous = state.get(target.key) || {};

  if (!filePath) {
    return {
      ...base,
      state: 'unconfigured',
      ok: null,
      reason: 'unconfigured',
      hint: `未配置 ${target.env}，该功能在此部署上不可用`,
      elapsedMs: 0,
      checkedAtMs: Date.now(),
      lastOkAtMs: previous.lastOkAtMs || null,
      lastFailAtMs: previous.lastFailAtMs || null,
      failStreak: previous.failStreak || 0,
      hostProbe: null,
      session: null,
      note: '',
      error: null,
      detail: null,
      share: null
    };
  }

  // 1) 先看主机通不通：主机都不通就不发 UNC 调用，避免占住线程池 30 秒。
  //    但端口探测只是「快速否定」的启发式，不能直接当成结论：
  //      - EACCES/EPERM：本地防火墙/终端防护拒绝了这条 TCP 探测，共享往往仍可用
  //        （实测 192.168.160.70 就是这样：445 探测报 EACCES，会话与读写一直正常）；
  //      - 端口探测失败、但本机已有到该主机的 SMB 会话：重定向器可以复用会话读写
  //        ——「net use 已建立共享连接」本身就是可达证据，不能反过来判成不可达。
  //    这两种情况必须继续做真实访问，否则监测页会报「主机不可达」，而实际上
  //    状态跟踪页的「同步生产大日程」是能跑的（见 HOST_DOWN_CODES 注释）。
  const hostProbe = base.host ? await uncShare.probeHost(base.host, HOST_PROBE_TIMEOUT_MS) : null;
  const probeCode = String((hostProbe && hostProbe.code) || '').toUpperCase();
  let session = null;
  let sessionEstablished = false;
  // 「主机不可达」只有在两条证据都成立时才成立：端口探测给出明确的不可达错误码，
  // 且本机没有任何到该主机的会话（有会话就说明曾经连通过，值得再试一次真实访问）。
  let hostDownConfirmed = false;
  if (hostProbe && !hostProbe.ok) {
    // 只在端口探测失败时才读一次 net use 列表：正常路径上不多花这几十毫秒
    session = await uncShare.probeSession(base.host);
    // 实时会话列表只覆盖「显式 net use」的连接；隐式会话（直接访问 UNC 自动建立的）
    // 不在列表里，因此再补一条证据：最近一次 net use 成功且不算太旧。
    // 1219（该服务器已有使用其他凭据的连接）同样算证据——它本身就是 Windows 在说
    // 「这条连接存在」，只是账号对不上；能不能用交给下面真实的 stat 判断。
    const lastEnsure = base.shareRoot ? uncShare.getShareStatus(filePath).lastEnsure : null;
    const ensureAgeMs = lastEnsure ? Date.now() - Date.parse(lastEnsure.at) : Infinity;
    const ensureProvesSession = Boolean(lastEnsure
      && (lastEnsure.ok || String(lastEnsure.errorNo || '') === '1219'));
    const recentEnsureOk = Boolean(ensureProvesSession && ensureAgeMs < RECENT_ENSURE_MS);
    if (recentEnsureOk && !(session && session.established)) {
      session = {
        ...(session || { ok: true, host: base.host, lines: [], message: '' }),
        established: true,
        // 前端据此区分「现在就有这条连接」与「最近一次 net use 成功」
        source: 'net-use-record'
      };
    } else if (session) {
      session = { ...session, source: 'net-use-list' };
    }
    sessionEstablished = Boolean(session && session.established);
    hostDownConfirmed = HOST_DOWN_CODES.has(probeCode) && !sessionEstablished;
    if (hostDownConfirmed) {
      return finalize(base, previous, {
        ok: false,
        state: 'unreachable',
        reason: 'host-unreachable',
        hint: `无法连接 ${base.host} 的 445/139 端口（${hostProbe.code || 'ETIMEDOUT'}）：`
          + '共享服务器离线、网段不通或端口被防火墙拦截',
        elapsedMs: Date.now() - startedAt,
        hostProbe,
        session,
        note: '',
        error: { code: hostProbe.code || 'ETIMEDOUT', message: `端口探测失败（${base.host}）` }
      });
    }
  }

  // 端口探测失败却继续往下走：真实访问的结果才是结论，这段说明会一并回给前端，
  // 免得管理员看到「端口不通」以为共享坏了。
  const portInconclusive = Boolean(hostProbe && !hostProbe.ok);
  const portProbeNote = portInconclusive
    ? (sessionEstablished
      ? `SMB 端口探测不通（${hostProbe.code || 'ETIMEDOUT'}），但本机已有到 ${base.host} 的共享连接，且路径可正常访问，判定为可用`
      : `SMB 端口探测不通（${hostProbe.code || 'ETIMEDOUT'}，多为本地防火墙/终端防护拦截），但共享路径可正常访问，判定为可用`)
    : '';

  // 2) 再真正访问一次文件系统（带硬时限）
  const probe = await withDeadline(statTarget(target, filePath), PROBE_TIMEOUT_MS);

  if (probe.timedOut) {
    return finalize(base, previous, {
      ok: false,
      state: 'timeout',
      reason: 'timeout',
      hint: `访问超过 ${PROBE_TIMEOUT_MS}ms 未返回：共享主机有响应但 SMB 读写卡住，`
        + '常见于共享服务器负载过高或会话失效',
      elapsedMs: Date.now() - startedAt,
      hostProbe,
      session,
      note: '',
      error: { code: 'ETIMEDOUT', message: `探测超时（>${PROBE_TIMEOUT_MS}ms）` }
    });
  }

  if (probe.error) {
    const classified = classifyError(probe.error);
    // 端口明明通（或探测本身不可信），stat 却失败：这不是「主机/网络到不了」，
    // 而是 SMB 会话或权限被拒。classifyError 只看得到错误码（UNKNOWN 在
    // 「服务器不通」和「凭据被拒」两种场景下都会出现），必须结合端口探测与
    // 会话证据修正归因，否则页面会把凭据问题报成「共享主机不可达」，把管理员引向查网络。
    const notAHostProblem = Boolean(hostProbe && hostProbe.ok) || portInconclusive;
    const reason = classified.reason === 'unreachable' && notAHostProblem ? 'session-failed' : classified.reason;
    const hint = reason === 'session-failed'
      ? (hostProbe && hostProbe.ok
        ? '445 端口可连通，但共享访问失败：多为 SMB 会话未建立或凭据被拒。'
          + '请确认后端运行账户已被授予该共享权限，或配置 UNC_CREDENTIALS 让后端自行 net use'
        : `端口探测为 ${probeCode || 'ETIMEDOUT'}（本地防火墙拦截或会话失效），共享访问也失败：`
          + '请确认后端运行账户的共享权限与凭据配置（UNC_CREDENTIALS），或检查服务器当前是否在线')
      : classified.hint;
    return finalize(base, previous, {
      ok: false,
      state: 'fail',
      reason,
      hint,
      elapsedMs: Date.now() - startedAt,
      hostProbe,
      session,
      note: '',
      error: { code: classified.code, message: String(probe.error.message || '').slice(0, 300) }
    });
  }

  return finalize(base, previous, {
    ok: true,
    state: 'ok',
    reason: 'ok',
    hint: '',
    elapsedMs: Date.now() - startedAt,
    hostProbe,
    session,
    // 端口探测不通但访问正常时必须说明，否则这张卡片会被读成「网络有问题」
    note: portProbeNote,
    error: null,
    detail: probe.value || null
  });
}

/**
 * 合并本轮结果与历史记录，写成前端直接可渲染的结构。
 * net use 状态只反映「上一次兜底重建连接」的结果，是排查 1219/凭据问题的关键证据，
 * 因此无论成败都带上。
 */
function finalize(base, previous, result) {
  const checkedAtMs = Date.now();
  // getShareStatus 里同时给出 credentialConfigured 与上一次 net use 的结果
  const share = base.shareRoot ? uncShare.getShareStatus(base.path) : null;

  const record = {
    ...base,
    ...result,
    checkedAtMs,
    lastOkAtMs: result.ok ? checkedAtMs : (previous.lastOkAtMs || null),
    lastFailAtMs: result.ok ? (previous.lastFailAtMs || null) : checkedAtMs,
    // 连续失败次数：一次抖动和持续掉线要区别对待，前端据此把「偶发」与「已断」分开显示
    failStreak: result.ok ? 0 : (previous.failStreak || 0) + 1,
    share
  };
  state.set(base.key, record);
  return record;
}

/**
 * 汇总两个路径的访问状态。
 * @param {{ force?: boolean }} [options] force=true 忽略缓存（页面上的「重新探测」）
 * @returns {Promise<{ serverTimeMs: number, probeTimeoutMs: number, paths: object[] }>}
 */
async function getShareAccess({ force = false } = {}) {
  const now = Date.now();
  const paths = await Promise.all(TARGETS.map(async (target) => {
    const cached = state.get(target.key);
    if (!force && cached && cached.checkedAtMs) {
      const ttl = cached.ok ? OK_TTL_MS : FAIL_TTL_MS;
      if (now - cached.checkedAtMs < ttl) {
        // 缓存命中时不能改 checkedAtMs，否则「多久之前探测的」会一直显示刚刚
        return { ...cached, cached: true };
      }
    }
    return { ...(await probeTarget(target)), cached: false };
  }));

  return {
    serverTimeMs: Date.now(),
    probeTimeoutMs: PROBE_TIMEOUT_MS,
    paths
  };
}

module.exports = {
  getShareAccess,
  // 便于测试：清空历史状态，避免用例之间互相污染
  _private: { TARGETS, state, classifyError, HOST_DOWN_CODES, PROBE_TIMEOUT_MS, OK_TTL_MS, FAIL_TTL_MS }
};
