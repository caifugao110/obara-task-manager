import React, { useState } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { LogIn, User, Lock, AlertCircle } from 'lucide-react';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await axios.post('/api/auth/login', { username, password });
      login(response.data.token, response.data.user);
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.message || '登录失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl shadow-lg shadow-blue-200 mb-4">
            <LogIn className="text-white" size={32} />
          </div>
          <h2 className="text-3xl font-black text-gray-800 tracking-tight">Obara Task Manager</h2>
          <p className="text-gray-400 mt-2 font-medium">任务管理系统 • 技术开发二部</p>
        </div>

        {/* Login Form */}
        <div className="bg-white p-8 rounded-2xl shadow-xl border border-gray-100">
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-xl mb-6 flex items-start gap-3 animate-shake">
              <AlertCircle size={20} className="mt-0.5 shrink-0" />
              <div className="text-sm font-bold">{error}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-1.5">
              <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">用户名</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                  <User size={18} />
                </div>
                <input 
                  type="text" 
                  className="w-full pl-11 pr-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none text-gray-800 font-bold transition placeholder-gray-300"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入您的登录账号"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">密码</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                  <Lock size={18} />
                </div>
                <input 
                  type="password" 
                  className="w-full pl-11 pr-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none text-gray-800 font-bold transition placeholder-gray-300"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入您的登录密码"
                  required
                />
              </div>
            </div>

            <button 
              type="submit" 
              disabled={loading}
              className={`w-full bg-blue-600 text-white py-4 rounded-xl font-black text-lg shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-2 ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>正在验证...</span>
                </>
              ) : (
                <span>立即登录</span>
              )}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-gray-50 text-center">
            <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-100 px-4 py-2 rounded-lg">
              <AlertCircle size={14} className="text-amber-600" />
              <span className="text-xs font-bold text-amber-700">管理人员和普通用户可登录</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-gray-400 text-xs font-medium">
          &copy; 2026 Obara Corporation. All rights reserved.
        </p>
      </div>
    </div>
  );
};

export default Login;
