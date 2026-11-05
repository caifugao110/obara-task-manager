/**
 * API 服务层
 *
 * 对外只暴露配置好拦截器的 axios 实例：请求自动附带 token，
 * 响应统一处理「后端不可达」「账号禁用」「会话失效」三类情况。
 *
 * 这里刻意不再维护 authAPI / usersAPI / tasksAPI 之类的分组封装：
 * 各页面历史上一直直接使用 axiosInstance + 路径字符串调用，
 * 分组封装长期零引用、且与真实调用点逐渐脱节（接口契约出现两份互相矛盾的来源）。
 * 保持单一入口，避免出现「看起来在用、实际没人用」的伪 API 层。
 */

import axios, { AxiosError } from 'axios';
import { notifySessionExpired } from '../utils/redirect';

// ==================== Axios 配置 ====================

const API_BASE_URL = '/api';

const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器 - 添加 Token
axiosInstance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// ==================== 后端可达性 ====================

// 可达性的**判定权只给心跳**（见文末 startBackendHeartbeat），业务请求不参与掉线判定。
//
// 原因：axios 的超时（ECONNABORTED / ETIMEDOUT）没有 response，早期版本把它和
// 「连不上」归成一类，于是任何一个慢接口（同步生产大日程、大 PDF 解析、DB 写锁、
// 共享盘抖动）都会让整站闪一下离线：弹「网络已断开，已自动保存数据」、禁用所有编辑，
// 5 秒后心跳又把状态改回在线。用户看到的是「网络抖动」，真实原因被这层误报盖住了。
//
// 现在业务请求只保留「恢复」方向：只要有一个请求成功，就立即退出离线态。
let serverReachable = true;

// 连接层面的失败：说明根本没连上，而不是「连上了但慢」
const CONNECTION_FAILURE_CODES = new Set([
  'ERR_NETWORK',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_REFUSED',
  'ECONNRESET',
  'ECONNREFUSED',
]);

const isTimeoutError = (error: AxiosError): boolean => {
  const code = String(error.code ?? '');
  return code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ERR_CANCELED';
};

/**
 * 判断一次失败是否意味着「连不上后端」。
 *
 * 关键：**超时不算**。超时只能证明「这个接口慢」，不能证明服务不在；
 * 后端进程停止时代理通常回 5xx 空 body（Vite 是 500 text/plain，nginx 是 502/503/504），
 * 这类响应没有应用层语义，才是「后端不在」的信号。
 * 后端自己抛出的 5xx 会带 application/json 的错误体，属于应用层错误，不能据此判定。
 */
const isBackendUnreachable = (error: AxiosError): boolean => {
  if (isTimeoutError(error)) return false;
  if (error.code && CONNECTION_FAILURE_CODES.has(String(error.code))) return true;
  if (!error.response) return false;
  const { status, headers } = error.response;
  if (status < 500) return false;
  const contentType = String(headers?.['content-type'] ?? '');
  return !contentType.includes('application/json');
};

// 心跳的判定比业务请求严一档：它是固定 3 秒的轻量探针，等不到响应就说明服务不健康，
// 因此超时、以及「没有响应但错误码未知」也算失败（连续两次才真正判离线，见下）。
const isHeartbeatFailure = (error: AxiosError): boolean =>
  isBackendUnreachable(error) || isTimeoutError(error) || !error.response;

// 响应拦截器：
// - 成功 → 只负责「恢复」（可能是离线期间唯一成功的请求）
// - 失败 → 只处理账号禁用 / 会话失效；掉线判定交给心跳，避免误报
axiosInstance.interceptors.response.use(
  (response) => {
    if (!serverReachable) {
      serverReachable = true;
      window.dispatchEvent(new CustomEvent('server-online'));
    }
    return response;
  },
  (error: AxiosError) => {
    // 处理账号禁用情况
    if (error.response?.status === 403) {
      const data = error.response.data as any;
      if (data?.code === 'ACCOUNT_DISABLED') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        notifySessionExpired('您的账号已被禁用，请联系管理员');
      }
    }
    
    // 处理 401：会话已失效（Token 过期 / 被顶下线 / 账号禁用）。
    // 原来静默清理后跳转，Token 到期被登出时用户毫无感知；
    // 现在统一弹出原因提示后再跳转登录页（notifySessionExpired 自带防重复）
    if (error.response?.status === 401) {
      const data = error.response.data as any;
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      // 已在登录页/改密页时不再提示与跳转，否则会以当前 URL 为回跳目标造成重定向死循环
      const { pathname } = window.location;
      const onAuthPage = pathname.endsWith('/login') || pathname.endsWith('/change-password');
      if (!onAuthPage) {
        const msg = data?.code === 'ACCOUNT_DISABLED'
          ? '您的账号已被禁用，请联系管理员'
          : data?.code === 'SESSION_INVALIDATED'
            ? (data?.message || '您的账号已在其他设备登录')
            : '登录状态已失效，请重新登录';
        notifySessionExpired(msg);
      }
    }
    
    return Promise.reject(error);
  }
);

// ==================== 全局后端心跳 ====================

// 空闲页面没有任何请求流量时 serverReachable 永远不会翻转：登录后唯一的周期性请求是
// AuthContext 每 60 秒一次的会话校验，意味着后端停服最多要 60–70 秒后才被察觉
// （登录页此前更是全程无流量，完全感知不到）。这里统一挂一个全局心跳，无论登录与否都在运行，
// 把「发现停服」与「发现恢复」都压到一个心跳周期内，各页面无须再各自轮询探测。
const HEARTBEAT_INTERVAL_MS = 5000;

// 心跳单独用 3 秒超时（不能沿用实例上的 10 秒：一轮探针比离线阈值还长，
// 「连续两次失败」就永远凑不满）。3 秒 + 1 个间隔 ≈ 6 秒内确认掉线。
const HEARTBEAT_TIMEOUT_MS = 3000;

// 连续两次探不通才判离线：单次失败可能只是浏览器/代理的一次抖动，
// 连续两轮（≥6 秒）都失败，基本可以确定后端不在了。
const HEARTBEAT_FAILURE_THRESHOLD = 2;

// 探针选用未鉴权且不写审计日志的 session-policy：审计中间件只对 req.user 存在的请求落库，
// 该路由不挂 authMiddleware，因此 5 秒一次的探测不会污染操作日志
//（/auth/validate 会被记录为「验证登录」，不能高频调用）。
const HEARTBEAT_PATH = '/auth/session-policy';

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let consecutiveHeartbeatFailures = 0;

export const startBackendHeartbeat = () => {
  // 全局单例：重复调用（如 StrictMode 下重复挂载）不应再起一个定时器
  if (heartbeatTimer !== null) return;

  const probe = async () => {
    // 页面在后台时不必探测，避免所有后台标签页空转；切回前台由下面的监听立即补一次
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      await axiosInstance.get(HEARTBEAT_PATH, { timeout: HEARTBEAT_TIMEOUT_MS });
      consecutiveHeartbeatFailures = 0;
      // 恢复方向在拦截器里处理（同一份 serverReachable 状态，不会重复广播）
    } catch (err: any) {
      // 有响应且是应用层错误（如 401/403）说明服务仍在运行，不算掉线
      if (!isHeartbeatFailure(err)) {
        consecutiveHeartbeatFailures = 0;
        return;
      }
      consecutiveHeartbeatFailures += 1;
      if (consecutiveHeartbeatFailures < HEARTBEAT_FAILURE_THRESHOLD) return;
      serverReachable = false;
      // 每轮都广播，而不是只在翻转时广播一次：页面可能在服务已经不可达之后才挂载，
      // 只广播一次会让它错过并一直误显示在线（页面内部的 toast 各自做了去重）
      window.dispatchEvent(new CustomEvent('server-unreachable'));
    }
  };

  probe();
  heartbeatTimer = setInterval(probe, HEARTBEAT_INTERVAL_MS);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) probe();
    });
  }
};

export { axiosInstance };
export default axiosInstance;
