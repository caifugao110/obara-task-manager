﻿import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { axiosInstance } from '../services/api';
import { io, Socket } from 'socket.io-client';
import { notifySessionExpired } from '../utils/redirect';

interface User {
  id: string;
  username: string;
  role: 'superadmin' | 'admin' | 'user';
  name: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  authReady: boolean;
  forcePasswordChange: boolean;
  login: (token: string, user: User, forceChange?: boolean) => void;
  logout: () => Promise<void>;
  setForcePasswordChange: (value: boolean) => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [forcePasswordChange, setForcePasswordChange] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // 只清本地状态，不带任何网络调用。供 logout 内部与各处强制退出复用。
  const clearLocalSession = useCallback(() => {
    setToken(null);
    setUser(null);
    setForcePasswordChange(false);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('forcePasswordChange');
    // 写入退出提示，登录页读取后展示「您已安全退出登录」横幅（读取一次即清除）
    sessionStorage.setItem('authNotice', '您已安全退出登录');
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  // 登出必须先通知后端吊销 sessionToken（轮换 user.sessionToken），
  // 否则已签发的 JWT 在 3 天有效期内仍然可用，「禁止多设备登录」也踢不掉旧设备。
  // 这里用未经全局拦截器的裸 axios：令牌已失效时后端返回 401，不应触发
  // 拦截器里的弹窗与跳转——退出流程自己完成跳转即可。
  // 依赖保持为空数组，logout 引用稳定，不会让 useEffect(..., [token, logout]) 反复重跑。
  const logout = useCallback(async () => {
    const currentToken = localStorage.getItem('token');
    try {
      if (currentToken) {
        await axios.post('/api/auth/logout', {}, {
          headers: { Authorization: `Bearer ${currentToken}` },
          timeout: 5000
        });
      }
    } catch {
      // 后端吊销失败（网络不通 / 令牌已失效）也必须完成本地退出，不能把用户卡在页面里
    } finally {
      clearLocalSession();
    }
  }, [clearLocalSession]);

  const login = (newToken: string, newUser: User, forceChange?: boolean) => {
    setToken(newToken);
    setUser(newUser);
    setForcePasswordChange(forceChange || false);
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    localStorage.setItem('forcePasswordChange', String(forceChange || false));
    sessionStorage.removeItem('authNotice');
  };

  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    const savedForceChange = localStorage.getItem('forcePasswordChange');
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
      setForcePasswordChange(savedForceChange === 'true');
    }
    setAuthReady(true);
  }, []);

  useEffect(() => {
    if (!token) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    const socket = io('/', {
      path: '/socket.io',
      reconnection: true,
      auth: { token }
    });
    socketRef.current = socket;

    socket.on('session_invalidated', (data: { reason?: string; timestamp?: string; newLoginIp?: string; newLoginBrowser?: string; newLoginOs?: string; newLoginDevice?: string }) => {
      // notifySessionExpired 自带防重复：等登出请求发完再跳转，
      // 否则导航会中断 /api/auth/logout 的吊销请求
      // 浏览器 / 系统分开展示更准确；桌面端类型（Windows/macOS 已隐含）仅在移动端时提示
      const details = [
        data?.timestamp ? `对方登录时间：${data.timestamp}` : '',
        data?.newLoginIp ? `对方 IP：${data.newLoginIp}` : '',
        data?.newLoginBrowser && !data.newLoginBrowser.startsWith('Unknown') ? `对方浏览器：${data.newLoginBrowser}` : '',
        data?.newLoginOs && !data.newLoginOs.startsWith('Unknown') ? `对方系统：${data.newLoginOs}` : '',
        data?.newLoginDevice === 'Mobile' ? '对方设备类型：移动端' : ''
      ].filter(Boolean);
      notifySessionExpired(
        data?.reason || '您的账号已在其他设备登录',
        logout,
        details.length ? details : undefined
      );
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, logout]);

  useEffect(() => {
    if (!token) return;

    const validateSession = async () => {
      try {
        const response = await axiosInstance.get('/auth/validate', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const forceChange = response.data.forcePasswordChange;
        if (forceChange !== undefined) {
          setForcePasswordChange(forceChange);
          localStorage.setItem('forcePasswordChange', String(forceChange));
        }
        // 同步服务端最新用户信息（特别是 role 变更），确保路由守卫与中间件鉴权一致
        const remoteUser = response.data.user;
        if (remoteUser) {
          setUser(prev => {
            if (
              prev &&
              prev.id === remoteUser.id &&
              prev.username === remoteUser.username &&
              prev.role === remoteUser.role &&
              prev.name === remoteUser.name
            ) {
              return prev;
            }
            const updated = { ...prev, ...remoteUser } as User;
            localStorage.setItem('user', JSON.stringify(updated));
            return updated;
          });
        }
      } catch (err: any) {
        const code = err.response?.data?.code;
        // notifySessionExpired 自带防重复：与响应拦截器、socket 推送同时触发时只弹一次；
        // 传入 logout 保证登出吊销请求发完再跳转
        if (code === 'SESSION_INVALIDATED') {
          notifySessionExpired(err.response?.data?.message || '您的账号已在其他设备登录', logout);
        } else if (code === 'ACCOUNT_DISABLED') {
          notifySessionExpired('您的账号已被禁用，请联系管理员', logout);
        }
        // TOKEN_EXPIRED 等其他 401 已由 axiosInstance 响应拦截器统一提示并跳转
      }
    };

    validateSession();
    const interval = setInterval(validateSession, 60000);
    return () => clearInterval(interval);
  }, [token, logout]);

  return (
    <AuthContext.Provider value={{ user, token, authReady, forcePasswordChange, login, logout, setForcePasswordChange, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
