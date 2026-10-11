import axios from 'axios';
import { buildLoginUrl, notifySessionExpired } from './redirect';

export const setupAxiosInterceptors = (onForceLogout?: (message: string) => void) => {
  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      const code = error.response?.data?.code;
      const message = error.response?.data?.message;
      const { pathname } = window.location;
      // 已在登录页/改密页时不再提示与跳转，否则会以当前 URL 为回跳目标造成重定向死循环
      const onAuthPage = pathname.endsWith('/login') || pathname.endsWith('/change-password');

      if (error.response?.status === 403 && code === 'ACCOUNT_DISABLED') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        const msg = '您的账号已被禁用，请联系管理员';
        if (onForceLogout) {
          onForceLogout(msg);
          window.location.href = buildLoginUrl();
        } else {
          notifySessionExpired(msg);
        }
      }

      // 401 统一处理：会话已失效（Token 过期 / 被顶下线 / 账号禁用）。
      // 原来只处理被顶下线且为静默跳转，Token 到期被登出时用户毫无感知；
      // 现在统一弹出原因提示后再跳转登录页（notifySessionExpired 自带防重复）
      if (error.response?.status === 401 && !onAuthPage) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        const msg = code === 'ACCOUNT_DISABLED'
          ? '您的账号已被禁用，请联系管理员'
          : code === 'SESSION_INVALIDATED'
            ? (message || '您的账号已在其他设备登录')
            : '登录状态已失效，请重新登录';
        if (onForceLogout) {
          onForceLogout(msg);
          window.location.href = buildLoginUrl();
        } else {
          notifySessionExpired(msg);
        }
      }

      return Promise.reject(error);
    }
  );
};
