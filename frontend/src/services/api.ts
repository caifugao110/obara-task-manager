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
    // 网络层失败（后端停止/不可达/请求超时）说明服务已不可达
    if (serverReachable && !error.response && (
      error.code === 'ERR_NETWORK' ||
      error.code === 'ECONNABORTED' ||
      error.message === 'Network Error'
    )) {
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

export { axiosInstance };
export default axiosInstance;
