import axios from 'axios';

// Setup axios interceptors
export const setupAxiosInterceptors = () => {
  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response?.status === 403 && error.response?.data?.code === 'ACCOUNT_DISABLED') {
        // User account is disabled, force logout
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        
        // Show alert and redirect to login
        alert('您的账号已被禁用，请联系管理员');
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }
  );
};
