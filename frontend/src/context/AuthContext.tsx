import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';

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
  logout: () => void;
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

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setForcePasswordChange(false);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('forcePasswordChange');
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  const login = (newToken: string, newUser: User, forceChange?: boolean) => {
    setToken(newToken);
    setUser(newUser);
    setForcePasswordChange(forceChange || false);
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    localStorage.setItem('forcePasswordChange', String(forceChange || false));
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

    const socket = io('/', { path: '/socket.io', reconnection: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('register_user', token);
    });

    socket.on('session_invalidated', (data: { reason?: string }) => {
      alert(data?.reason || '您的账号已在其他设备登录');
      logout();
      window.location.href = '/login';
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
        const response = await axios.get('/api/auth/validate', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const forceChange = response.data.forcePasswordChange;
        if (forceChange !== undefined) {
          setForcePasswordChange(forceChange);
          localStorage.setItem('forcePasswordChange', String(forceChange));
        }
      } catch (err: any) {
        const code = err.response?.data?.code;
        if (code === 'SESSION_INVALIDATED' || code === 'ACCOUNT_DISABLED') {
          if (code === 'ACCOUNT_DISABLED') {
            alert('您的账号已被禁用，请联系管理员');
          } else {
            alert(err.response?.data?.message || '您的账号已在其他设备登录');
          }
          logout();
          window.location.href = '/login';
        }
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
