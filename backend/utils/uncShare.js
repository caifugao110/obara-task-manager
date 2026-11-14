'use strict';

// UNC 共享连接兜底
//
// 背景：后端以 Windows 服务 / 计划任务方式自启时运行在 Session 0（非交互会话）。
// SMB 认证是按登录会话隔离的，Session 0 拿不到登录用户会话里那份共享认证，
// 于是共享盘文件 stat 直接失败（Node 报 EPERM），而用户在资源管理器里却能正常打开。
//
// 这里在读取失败时按配置的凭据执行一次 `net use`，把到该共享的连接建立在
// 后端进程自己的会话里，然后让调用方重试一次。这样「无人登录、开机就跑」的
// 部署方式也能读到共享文件，同时不必把凭据写进启动脚本。
//
// 凭据来源（按优先级）：
//   1. 调用方显式传入 { user, password }（如 PRODUCTION_SCHEDULE_UNC_USER/PASSWORD）
//   2. UNC_CREDENTIALS：通用映射，格式 `\\server\share=用户名:密码`，多项用分号或换行分隔
//
// 安全说明：密码通过 execFile 的参数数组传递（不经 shell，不会被注入），
// 但会短暂出现在进程命令行里。更稳妥的做法是给运行服务的账户直接授予共享权限；
// 凭据配置仅作为服务会话无法复用登录凭据时的兜底。

const path = require('path');
const net = require('net');
const { execFileSync, execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const NET_TIMEOUT_MS = 15000;
// 连接建立成功后，短时间内不再重复执行 net use
const ENSURE_COOLDOWN_MS = 5 * 60 * 1000;

// 值得尝试重建共享连接的错误码：
//   EPERM/EACCES  权限/会话问题（Session 0 拿不到登录凭据时 Windows 多报 EPERM）
//   UNKNOWN       libuv 未映射的 Win32 网络错误（共享不可达、认证被拒）
//   ENOENT/ENODEV 网络提供程序未就绪时把共享当成「不存在」
// EBUSY 是文件被 Excel 独占，net use 无用，不重试。
const AUTH_ERROR_CODES = new Set(['EPERM', 'EACCES', 'ENOENT', 'ENOTFOUND', 'UNKNOWN', 'ENODEV']);

/** shareRoot（小写）→ { at, ok, message, user, shareRoot } */
const ensureState = new Map();

const isWindows = () => process.platform === 'win32';

// 运行后端的 Windows 账户：以服务/计划任务自启时常见为 SYSTEM，
// 而共享权限往往只授给了具体用户——排查 net use 失败时这一项最关键。
function getProcessAccount() {
  const domain = process.env.USERDOMAIN || '';
  const user = process.env.USERNAME || '';
  if (user) return domain ? `${domain}\\${user}` : user;
  try {
    return require('os').userInfo().username || '';
  } catch (error) {
    return '';
  }
}

/**
 * 从 UNC 文件路径取出共享根：\\server\share
 * @param {string} filePath
 * @returns {string} 非 UNC 路径返回空串
 */
function getShareRoot(filePath) {
  const match = /^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)/.exec(String(filePath || '').trim());
  if (!match) return '';
  return `\\\\${match[1]}\\${match[2]}`;
}

/**
 * 解析 UNC_CREDENTIALS：`\\server\share=用户名:密码`，多项用 ; 或换行分隔。
 * 密码里允许出现冒号和等号（只按第一个冒号切分用户与密码）。
 * @param {string} raw
 * @returns {Map<string, {user: string, password: string}>} key 为共享根原样
 */
function parseCredentialMap(raw) {
  const map = new Map();
  String(raw || '')
    .split(/[;\r\n]+/)
    .forEach((entry) => {
      const line = entry.trim();
      if (!line) return;
      const eq = line.indexOf('=');
      if (eq <= 0) return;
      const shareRoot = getShareRoot(line.slice(0, eq).trim());
      if (!shareRoot) return;
      const credential = line.slice(eq + 1);
      const colon = credential.indexOf(':');
      const user = (colon === -1 ? credential : credential.slice(0, colon)).trim();
      const password = colon === -1 ? '' : credential.slice(colon + 1);
      if (!user) return;
      map.set(shareRoot, { user, password });
    });
  return map;
}

/**
 * 按共享根查找配置的凭据（大小写不敏感）。
 * @param {string} shareRoot
 * @param {NodeJS.ProcessEnv} [env]
 */
function resolveCredentials(shareRoot, env = process.env) {
  if (!shareRoot) return null;
  const map = parseCredentialMap(env.UNC_CREDENTIALS);
  const wanted = shareRoot.toLowerCase();
  for (const [key, value] of map) {
    if (key.toLowerCase() === wanted) return value;
  }
  return null;
}

function getNetBinary() {
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  return path.join(systemRoot, 'System32', 'net.exe');
}

/**
 * net use 失败时的兜底文案。
 *
 * execFile 失败且没有 stdout/stderr 时（Windows 常把错误直接写在退出码上），
 * error.message 会把**整条命令行**拼进来，其中含 `/user:账号 密码`。
 * 这段文字会进 console.warn、也会经诊断接口返回给前端，等于把共享密码
 * 明文写进日志与浏览器——必须换成固定文案。
 * @param {string} message error.message
 * @returns {string}
 */
function sanitizeNetUseMessage(message) {
  const value = String(message || '');
  if (/\/user:/i.test(value) || /command failed/i.test(value)) {
    return 'net use 执行失败（无输出，多为共享不可达或凭据被拒）';
  }
  return value.slice(0, 300);
}

/** 把已经落进错误的明文密码抹掉：`/user:xxx pwd` -> `/user:xxx ***` */
function maskNetUsePassword(text) {
  return String(text || '')
    .replace(/(\/user:\S+)\s+\S+/gi, '$1 ***')
    .replace(/(password[=:]\s*)\S+/gi, '$1***');
}

/**
 * 执行 net use，把共享连接建立到当前进程所在的会话。
 * user 为空表示用进程当前凭据连接（服务会话里连接丢失时，这一步常能直接修好）。
 * @param {string} shareRoot
 * @param {string} [user]
 * @param {string} [password]
 * @returns {{ ok: boolean, message: string, errorNo?: string }}
 */
function runNetUse(shareRoot, user, password) {
  // net.exe 的输出是 GBK，这里只用它做「有没有连上」的判断，文字内容仅供排查，
  // 因此按 latin1 解码后只匹配 ASCII 的错误码即可，避免引入额外编码依赖。
  const args = user
    ? ['use', shareRoot, `/user:${user}`, password || '', '/persistent:no']
    : ['use', shareRoot, '/persistent:no'];
  try {
    execFileSync(getNetBinary(), args, {
      timeout: NET_TIMEOUT_MS,
      windowsHide: true,
      encoding: 'latin1',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    // net.exe 成功时回显的是 GBK 中文（按 latin1 读会是乱码），没有信息量，
    // 这里统一给一句可读的说明，失败时才保留原始输出供排查。
    return { ok: true, message: '共享连接建立成功' };
  } catch (error) {
    const raw = `${error.stdout || ''} ${error.stderr || ''}`.replace(/\s+/g, ' ').trim();
    // 1219：同一服务器已存在使用其他凭据的连接。此时共享可能本来就连着，
    // 交给调用方判断是否需要先断开再重连。
    if (/\b1219\b/.test(raw)) {
      return { ok: false, message: '1219 已存在到该服务器的连接（使用了其他凭据）', errorNo: '1219' };
    }
    const codeMatch = raw.match(/\b(5|53|67|86|1326|1331|1909|2202|2250)\b/);
    return {
      ok: false,
      // raw 是 net.exe 自己的输出，不含命令行；为空时才回落 error.message（必须遮蔽密码）
      message: (raw || sanitizeNetUseMessage(error.message)).slice(0, 300),
      errorNo: codeMatch ? codeMatch[1] : ''
    };
  }
}

/**
 * 断开到该服务器的共享连接（\\server）。
 * 仅在「已配置凭据且遇到 1219」时使用：先断开旧连接，才能用新凭据重连。
 *
 * 1219 的成因是当前会话里已经有一条到该服务器的连接（常见于隐式 guest/匿名会话，
 * 由一次普通的 UNC 访问自动建立）。这种连接没有盘符，`net use \\server /delete`
 * 往往会以 2250（找不到网络连接）失败，所以这里按由轻到重逐级降级：
 *   1. net use \\server\IPC$ /delete  —— 精确删掉 IPC 会话
 *   2. net use \\server /delete       —— 删掉该服务器的所有共享连接
 *   3. net use * /delete              —— 兜底：清空本会话全部连接
 * 第 3 步会连带断开本进程用到的其他共享（仕样书$、生产管理部3d 等），
 * 但它们下次被 UNC 访问时会自动重建，因此只在 1、2 都清不掉时才使用。
 * @param {string} shareRoot
 * @returns {{ ok: boolean, message: string, strategy?: string }}
 */
function dropServerSessions(shareRoot) {
  const match = /^[\\/]{2}([^\\/]+)/.exec(String(shareRoot || ''));
  if (!match) return { ok: false, message: '无法解析服务器名' };
  const serverRoot = `\\\\${match[1]}`;
  const attempts = [
    { strategy: 'ipc', args: ['use', `${serverRoot}\\IPC$`, '/delete', '/y'] },
    { strategy: 'server', args: ['use', serverRoot, '/delete', '/y'] },
    { strategy: 'all', args: ['use', '*', '/delete', '/y'] }
  ];
  const failures = [];
  for (const attempt of attempts) {
    try {
      execFileSync(getNetBinary(), attempt.args, {
        timeout: NET_TIMEOUT_MS,
        windowsHide: true,
        encoding: 'latin1',
        stdio: ['ignore', 'pipe', 'pipe']
      });
      return { ok: true, strategy: attempt.strategy, message: `已断开 ${serverRoot} 的旧连接（${attempt.strategy}）` };
    } catch (error) {
      const raw = `${error.stdout || ''} ${error.stderr || ''}`.replace(/\s+/g, ' ').trim();
      failures.push(`${attempt.strategy}: ${(raw || error.message || '').slice(0, 120)}`);
    }
  }
  return { ok: false, message: `断开旧连接失败（${failures.join(' | ')}）` };
}

/**
 * 列出当前会话里到该服务器的连接（诊断用）。
 * net.exe 输出为 GBK，中文会乱码，但远程名与错误码是 ASCII，够判断「是不是同一条会话」。
 * @param {string} shareRoot
 * @returns {{ ok: boolean, lines: string[], message?: string }}
 */
function listConnections(shareRoot) {
  const match = /^[\\/]{2}([^\\/]+)/.exec(String(shareRoot || ''));
  if (!match) return { ok: false, lines: [], message: '无法解析服务器名' };
  try {
    const stdout = execFileSync(getNetBinary(), ['use'], {
      timeout: NET_TIMEOUT_MS,
      windowsHide: true,
      encoding: 'latin1',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const server = match[1].toLowerCase();
    const lines = String(stdout || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && (line.toLowerCase().includes(`\\\\${server}`) || /^\\\\/.test(line)));
    return { ok: true, lines: lines.slice(0, 20) };
  } catch (error) {
    const raw = `${error.stdout || ''} ${error.stderr || ''}`.replace(/\s+/g, ' ').trim();
    return { ok: false, lines: [], message: (raw || error.message || '').slice(0, 200) };
  }
}

/**
 * 确保到目标文件所在共享的连接可用（必要时执行 net use）。
 * @param {string} filePath UNC 文件路径
 * @param {{ user?: string, password?: string, shareRoot?: string, force?: boolean }} [options]
 * @returns {{ attempted: boolean, credsConfigured: boolean, ok: boolean, shareRoot: string,
 *             user?: string, message: string, at?: number, cached?: boolean }}
 */
function ensureShareAccess(filePath, options = {}) {
  const shareRoot = options.shareRoot || getShareRoot(filePath);
  if (!shareRoot) {
    return { attempted: false, credsConfigured: false, ok: false, shareRoot: '', message: '不是 UNC 共享路径' };
  }
  if (!isWindows()) {
    return { attempted: false, credsConfigured: false, ok: false, shareRoot, message: '非 Windows 环境，跳过 net use' };
  }

  const credentials = options.user
    ? { user: options.user, password: options.password || '' }
    : resolveCredentials(shareRoot);
  const credsConfigured = Boolean(credentials);

  // allowCurrentCredentials=false 时，没配凭据就不尝试（单元测试用，避免真连共享盘）
  if (!credentials && options.allowCurrentCredentials === false) {
    return {
      attempted: false,
      credsConfigured: false,
      ok: false,
      shareRoot,
      message: '未配置共享访问凭据（UNC_CREDENTIALS 或 PRODUCTION_SCHEDULE_UNC_USER/PASSWORD）'
    };
  }

  const cacheKey = shareRoot.toLowerCase();
  const cached = ensureState.get(cacheKey);
  if (!options.force && cached && cached.ok && Date.now() - cached.at < ENSURE_COOLDOWN_MS) {
    return { ...cached, attempted: true, credsConfigured, cached: true };
  }

  // 没配凭据时仍用进程当前凭据尝试一次：服务会话里连接丢失（网络抖动、
  // 共享服务器重启）后，这一步通常能直接恢复，无需把密码落到配置里。
  let result = credentials
    ? runNetUse(shareRoot, credentials.user, credentials.password)
    : runNetUse(shareRoot);

  // 1219：该服务器已用别的凭据连上了（例如以 guest 身份），必须断开才能换成配置的账号。
  // 只在配置了凭据时才断开，避免影响同会话里由登录用户建立、正在使用的连接。
  // 断开成功的策略不一定够（先删 IPC 后可能仍是 1219），所以最多再试两轮，逐级加重。
  let droppedSession = null;
  for (let round = 0; round < 2 && result.errorNo === '1219' && credentials; round += 1) {
    const drop = dropServerSessions(shareRoot);
    if (!droppedSession) droppedSession = drop;
    if (!drop.ok) break;
    result = runNetUse(shareRoot, credentials.user, credentials.password);
  }
  const record = {
    at: Date.now(),
    ok: result.ok,
    message: droppedSession ? `${result.message}（${droppedSession.message}）` : result.message,
    errorNo: result.errorNo || '',
    user: credentials ? credentials.user : `（当前进程凭据 ${getProcessAccount()}）`,
    shareRoot
  };
  // 失败时把本会话到该服务器的现有连接一并留档：1219 说明「有一条别人的会话占着」，
  // 这条信息比错误码本身更能说明问题。
  if (!result.ok) {
    const listing = listConnections(shareRoot);
    record.connections = listing.lines;
    if (!listing.ok) record.connectionsError = listing.message;
  }
  ensureState.set(cacheKey, record);
  if (!result.ok) {
    console.warn(`[uncShare] net use ${shareRoot} 失败（${record.user}）: ${result.message}`);
  } else {
    console.log(`[uncShare] net use ${shareRoot} 成功（${record.user}${result.errorNo ? `，${result.errorNo}` : ''}）`);
  }
  return { attempted: true, credsConfigured, ...record };
}

/**
 * 读取操作失败且错误码属于「认证/会话」类时，重建共享连接后重试一次。
 * @template T
 * @param {string} filePath
 * @param {() => T} operation
 * @param {{ user?: string, password?: string, shareRoot?: string }} [options]
 * @returns {{ ok: boolean, value?: T, error?: NodeJS.ErrnoException, ensure?: object }}
 */
function withShareRetry(filePath, operation, options = {}) {
  try {
    return { ok: true, value: operation() };
  } catch (error) {
    if (!AUTH_ERROR_CODES.has(error.code)) return { ok: false, error };

    const ensure = ensureShareAccess(filePath, options);
    // 没配凭据或 net use 失败时不再重试，避免对共享盘做无意义的第二次访问
    if (!ensure.attempted || !ensure.ok) return { ok: false, error, ensure };

    try {
      return { ok: true, value: operation(), ensure };
    } catch (retryError) {
      return { ok: false, error: retryError, ensure };
    }
  }
}

/**
 * 最近一次共享连接状态，供诊断接口/日志使用。
 * @param {string} filePath
 * @param {{ user?: string }} [options] 调用方自带的凭据（如 PRODUCTION_SCHEDULE_UNC_USER），
 *        用来判断「是否配了凭据」，否则只看 UNC_CREDENTIALS 会误报未配置
 */
function getShareStatus(filePath, options = {}) {
  const shareRoot = getShareRoot(filePath);
  const cached = shareRoot ? ensureState.get(shareRoot.toLowerCase()) : null;
  const configured = Boolean(options.user || (shareRoot && resolveCredentials(shareRoot)));
  return {
    shareRoot,
    credentialConfigured: configured,
    lastEnsure: cached
      ? {
        at: new Date(cached.at).toISOString(),
        ok: cached.ok,
        user: cached.user,
        errorNo: cached.errorNo,
        // 兜底再抹一次：确保任何历史记录（或新增的失败分支）都不会把密码带到接口响应里
        message: maskNetUsePassword(cached.message),
        connections: (cached.connections || []).map(maskNetUsePassword),
        connectionsError: cached.connectionsError ? maskNetUsePassword(cached.connectionsError) : cached.connectionsError
      }
      : null
  };
}

// ============================================================
// 异步版本（请求路径专用）
// ------------------------------------------------------------
// 上面的 execFileSync / fs.xxxSync 会把 Node 的事件循环整段占住：
// 共享服务器不可达时一次 stat 就要 30 秒以上，net use 再占满 15 秒超时，
// 期间所有 HTTP 请求（页面加载、任务列表、登录）全部排队，前端只看到「页面很慢」
// 和「查询超时」。请求路径上一律用下面的异步实现，让等待发生在 libuv 线程池里。
// ============================================================

/**
 * 从 UNC 路径取出服务器名（不含共享名）。
 * @param {string} filePath
 * @returns {string} 非 UNC 路径返回空串
 */
function getShareHost(filePath) {
  const match = /^[\\/]{2}([^\\/]+)[\\/]/.exec(String(filePath || '').trim());
  return match ? match[1] : '';
}

/**
 * 端口连通性探测：判断共享服务器到底通不通。
 * 服务器不可达时 SMB 的 stat 要等 Windows 自己的超时（实测 30 秒以上），
 * 先花 1~2 秒探一次 445/139，可以立刻给出「主机不可达」而不是让用户干等。
 * @param {string} host
 * @param {number} [timeoutMs]
 * @returns {Promise<{ ok: boolean, port: number, elapsedMs: number, code: string }>}
 */
async function probeHost(host, timeoutMs = 2000) {
  const startedAt = Date.now();
  const ports = [445, 139];
  const attempt = (port) => new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok, code) => {
      socket.removeAllListeners('connect');
      socket.removeAllListeners('timeout');
      // 保留一个空的 error 监听：destroy() 之后句柄仍可能补发 ECONNRESET /
      // ENOTFOUND，一旦没有监听者，'error' 事件会升级成未捕获异常，
      // 直接把整个后端进程带走（共享盘抖动时尤其容易命中）。
      socket.on('error', () => {});
      socket.destroy();
      resolve({ ok, code: code || '', port });
    };
    socket.setTimeout(Math.max(500, timeoutMs));
    socket.once('connect', () => done(true, ''));
    socket.once('timeout', () => done(false, 'ETIMEDOUT'));
    socket.once('error', (error) => done(false, error.code || 'ERROR'));
  });

  // 两个端口并发探测：串行探两次会让首个请求白等 4 秒
  const results = await Promise.all(ports.map(attempt));
  const hit = results.find(item => item.ok);
  if (hit) return { ok: true, port: hit.port, elapsedMs: Date.now() - startedAt, code: '' };
  return { ok: false, port: 0, elapsedMs: Date.now() - startedAt, code: results[0].code || 'ETIMEDOUT' };
}

async function runNetUseAsync(shareRoot, user, password) {
  const args = user
    ? ['use', shareRoot, `/user:${user}`, password || '', '/persistent:no']
    : ['use', shareRoot, '/persistent:no'];
  try {
    await execFileAsync(getNetBinary(), args, {
      timeout: NET_TIMEOUT_MS,
      windowsHide: true,
      encoding: 'latin1'
    });
    return { ok: true, message: '共享连接建立成功' };
  } catch (error) {
    const raw = `${error.stdout || ''} ${error.stderr || ''}`.replace(/\s+/g, ' ').trim();
    if (/\b1219\b/.test(raw)) {
      return { ok: false, message: '1219 已存在到该服务器的连接（使用了其他凭据）', errorNo: '1219' };
    }
    const codeMatch = raw.match(/\b(5|53|67|86|1326|1331|1909|2202|2250)\b/);
    return {
      ok: false,
      message: (raw || sanitizeNetUseMessage(error.message)).slice(0, 300),
      errorNo: codeMatch ? codeMatch[1] : ''
    };
  }
}

async function dropServerSessionsAsync(shareRoot) {
  const match = /^[\\/]{2}([^\\/]+)/.exec(String(shareRoot || ''));
  if (!match) return { ok: false, message: '无法解析服务器名' };
  const serverRoot = `\\\\${match[1]}`;
  const attempts = [
    { strategy: 'ipc', args: ['use', `${serverRoot}\\IPC$`, '/delete', '/y'] },
    { strategy: 'server', args: ['use', serverRoot, '/delete', '/y'] },
    { strategy: 'all', args: ['use', '*', '/delete', '/y'] }
  ];
  const failures = [];
  for (const attempt of attempts) {
    try {
      await execFileAsync(getNetBinary(), attempt.args, {
        timeout: NET_TIMEOUT_MS,
        windowsHide: true,
        encoding: 'latin1'
      });
      return { ok: true, strategy: attempt.strategy, message: `已断开 ${serverRoot} 的旧连接（${attempt.strategy}）` };
    } catch (error) {
      const raw = `${error.stdout || ''} ${error.stderr || ''}`.replace(/\s+/g, ' ').trim();
      failures.push(`${attempt.strategy}: ${(raw || error.message || '').slice(0, 120)}`);
    }
  }
  return { ok: false, message: `断开旧连接失败（${failures.join(' | ')}）` };
}

async function listConnectionsAsync(shareRoot) {
  const match = /^[\\/]{2}([^\\/]+)/.exec(String(shareRoot || ''));
  if (!match) return { ok: false, lines: [], message: '无法解析服务器名' };
  try {
    const { stdout } = await execFileAsync(getNetBinary(), ['use'], {
      timeout: NET_TIMEOUT_MS,
      windowsHide: true,
      encoding: 'latin1'
    });
    const server = match[1].toLowerCase();
    const lines = String(stdout || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && (line.toLowerCase().includes(`\\\\${server}`) || /^\\\\/.test(line)));
    return { ok: true, lines: lines.slice(0, 20) };
  } catch (error) {
    const raw = `${error.stdout || ''} ${error.stderr || ''}`.replace(/\s+/g, ' ').trim();
    return { ok: false, lines: [], message: (raw || error.message || '').slice(0, 200) };
  }
}

/**
 * ensureShareAccess 的异步版本，语义完全一致（含 1219 逐级断开重连）。
 * @param {string} filePath
 * @param {{ user?: string, password?: string, shareRoot?: string, force?: boolean,
 *           allowCurrentCredentials?: boolean }} [options]
 */
async function ensureShareAccessAsync(filePath, options = {}) {
  const shareRoot = options.shareRoot || getShareRoot(filePath);
  if (!shareRoot) {
    return { attempted: false, credsConfigured: false, ok: false, shareRoot: '', message: '不是 UNC 共享路径' };
  }
  if (!isWindows()) {
    return { attempted: false, credsConfigured: false, ok: false, shareRoot, message: '非 Windows 环境，跳过 net use' };
  }

  const credentials = options.user
    ? { user: options.user, password: options.password || '' }
    : resolveCredentials(shareRoot);
  const credsConfigured = Boolean(credentials);

  if (!credentials && options.allowCurrentCredentials === false) {
    return {
      attempted: false,
      credsConfigured: false,
      ok: false,
      shareRoot,
      message: '未配置共享访问凭据（UNC_CREDENTIALS 或 PRODUCTION_SCHEDULE_UNC_USER/PASSWORD）'
    };
  }

  const cacheKey = shareRoot.toLowerCase();
  const cached = ensureState.get(cacheKey);
  if (!options.force && cached && cached.ok && Date.now() - cached.at < ENSURE_COOLDOWN_MS) {
    return { ...cached, attempted: true, credsConfigured, cached: true };
  }

  let result = credentials
    ? await runNetUseAsync(shareRoot, credentials.user, credentials.password)
    : await runNetUseAsync(shareRoot);

  let droppedSession = null;
  for (let round = 0; round < 2 && result.errorNo === '1219' && credentials; round += 1) {
    const drop = await dropServerSessionsAsync(shareRoot);
    if (!droppedSession) droppedSession = drop;
    if (!drop.ok) break;
    result = await runNetUseAsync(shareRoot, credentials.user, credentials.password);
  }

  const record = {
    at: Date.now(),
    ok: result.ok,
    message: droppedSession ? `${result.message}（${droppedSession.message}）` : result.message,
    errorNo: result.errorNo || '',
    user: credentials ? credentials.user : `（当前进程凭据 ${getProcessAccount()}）`,
    shareRoot
  };
  if (!result.ok) {
    const listing = await listConnectionsAsync(shareRoot);
    record.connections = listing.lines;
    if (!listing.ok) record.connectionsError = listing.message;
  }
  ensureState.set(cacheKey, record);
  if (!result.ok) {
    console.warn(`[uncShare] net use ${shareRoot} 失败（${record.user}）: ${record.message}`);
  } else {
    console.log(`[uncShare] net use ${shareRoot} 成功（${record.user}${record.errorNo ? `，${record.errorNo}` : ''}）`);
  }
  return { attempted: true, credsConfigured, ...record };
}

/**
 * withShareRetry 的异步版本：读取失败且错误码属于认证/会话类时，重建连接后重试一次。
 * @template T
 * @param {string} filePath
 * @param {() => Promise<T>} operation
 * @param {{ user?: string, password?: string, shareRoot?: string }} [options]
 * @returns {Promise<{ ok: boolean, value?: T, error?: NodeJS.ErrnoException, ensure?: object }>}
 */
async function withShareRetryAsync(filePath, operation, options = {}) {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    if (!AUTH_ERROR_CODES.has(error.code)) return { ok: false, error };

    const ensure = await ensureShareAccessAsync(filePath, options);
    if (!ensure.attempted || !ensure.ok) return { ok: false, error, ensure };

    try {
      return { ok: true, value: await operation(), ensure };
    } catch (retryError) {
      return { ok: false, error: retryError, ensure };
    }
  }
}

module.exports = {
  getShareRoot,
  getShareHost,
  parseCredentialMap,
  resolveCredentials,
  ensureShareAccess,
  withShareRetry,
  getShareStatus,
  probeHost,
  ensureShareAccessAsync,
  withShareRetryAsync,
  _private: {
    AUTH_ERROR_CODES,
    ENSURE_COOLDOWN_MS,
    ensureState,
    sanitizeNetUseMessage,
    maskNetUsePassword
  }
};
