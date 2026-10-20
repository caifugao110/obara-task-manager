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

// 后端可达性标记：仅在状态翻转时广播全局事件，避免每次请求都触发页面回调。
// 后端进程停止时浏览器网络仍在线（navigator.onLine=true），各页面靠监听
// server-unreachable / server-online 事件进入/退出离线模式。
let serverReachable = true;

/**
 * 判断一次请求失败是否意味着「后端服务本身不可达」。
 *
 * 只认 ERR_NETWORK 是不够的：当前端与后端之间隔着代理时，后端进程停止并不会让连接
 * 直接失败，而是由代理回一个 5xx —— 开发环境的 Vite 代理会返回 Content-Type 为
 * text/plain 的空 body 500，生产反向代理（nginx 等）通常是 502/503/504。
 * 这类响应没有应用层语义，是「后端不在」的信号；若只看 ERR_NETWORK，
 * serverReachable 会永远保持 true，页面也就永远显示在线。
 *
 * 后端自己抛出的 5xx 会带 application/json 的错误体，属于应用层错误，
 * 不能据此判定服务不可达，因此用 Content-Type 区分。
 */
const isBackendUnreachable = (error: AxiosError): boolean => {
  // 没有任何响应 = 连不上（ERR_NETWORK / 超时 / 代理断开）
  if (!error.response) return true;
  const { status, headers } = error.response;
  if (status < 500) return false;
  const contentType = String(headers?.['content-type'] ?? '');
  return !contentType.includes('application/json');
};

// 响应拦截器 - 处理错误
axiosInstance.interceptors.response.use(
  (response) => {
    if (!serverReachable) {
      serverReachable = true;
      window.dispatchEvent(new CustomEvent('server-online'));
    }
    return response;
  },
  (error: AxiosError) => {
    if (serverReachable && isBackendUnreachable(error)) {
      serverReachable = false;
      window.dispatchEvent(new CustomEvent('server-unreachable'));
    }

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

// 探针选用未鉴权且不写审计日志的 session-policy：审计中间件只对 req.user 存在的请求落库，
// 该路由不挂 authMiddleware，因此 5 秒一次的探测不会污染操作日志
//（/auth/validate 会被记录为「验证登录」，不能高频调用）。
const HEARTBEAT_PATH = '/auth/session-policy';

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export const startBackendHeartbeat = () => {
  // 全局单例：重复调用（如 StrictMode 下重复挂载）不应再起一个定时器
  if (heartbeatTimer !== null) return;

  const probe = async () => {
    // 页面在后台时不必探测，避免所有后台标签页空转；切回前台由下面的监听立即补一次
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      await axiosInstance.get(HEARTBEAT_PATH);
      // 恢复方向交给响应拦截器（仅在 serverReachable 翻转时广播 server-online），
      // 避免各页面的「已重新连接」提示被反复弹出
    } catch (err: any) {
      // 与拦截器共用同一判定：既覆盖网络层失败，也覆盖代理在后端停止时回的 5xx。
      // 有响应且是应用层错误（如鉴权失败）说明服务仍在运行，不算不可达。
      if (isBackendUnreachable(err)) {
        serverReachable = false;
        // 每轮都广播，而不是只依赖拦截器的「翻转时广播」：
        // 页面可能在服务已经不可达之后才挂载，只广播一次会让它错过并一直误显示在线
        window.dispatchEvent(new CustomEvent('server-unreachable'));
      }
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
