import axios from 'axios';
import { buildLoginUrl } from './redirect';

export const setupAxiosInterceptors = (onForceLogout?: (message: string) => void) => {
  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      const code = error.response?.data?.code;
      const message = error.response?.data?.message;

      if (error.response?.status === 403 && code === 'ACCOUNT_DISABLED') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        alert('您的账号已被禁用，请联系管理员');
        window.location.href = buildLoginUrl();
      }

      if (error.response?.status === 401 && code === 'SESSION_INVALIDATED') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        const msg = message || '您的账号已在其他设备登录';
        if (onForceLogout) {
          onForceLogout(msg);
        } else {
          alert(msg);
        }
        window.location.href = buildLoginUrl();
      }

      return Promise.reject(error);
    }
  );
};
