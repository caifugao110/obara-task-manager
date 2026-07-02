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
    <div className="min-h-screen flex flex-col bg-[#f3f3f3]">
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-[#217346] rounded-xl shadow-md mb-4">
              <LogIn className="text-white" size={32} />
            </div>
            <h2 className="text-2xl font-bold text-gray-800 tracking-tight">Obara 任务管理系统</h2>
            <p className="mt-2">
              <span className="inline-block bg-gradient-to-r from-[#217346] to-[#2d8f5e] text-white text-xs font-bold px-4 py-1 rounded-full tracking-wider">
                技术开发二部
              </span>
            </p>
          </div>

          <div className="bg-white shadow-sm border border-gray-300 p-8 rounded-lg">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 p-4 rounded-lg mb-6 flex items-start gap-3">
                <AlertCircle size={20} className="mt-0.5 shrink-0" />
                <div className="text-sm font-bold">{error}</div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">用户名</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                    <User size={18} />
                  </div>
                  <input 
                    type="text" 
                    className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#217346] focus:border-[#217346] outline-none text-gray-800 font-medium transition placeholder-gray-400"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="请输入您的登录账号"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">密码</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                    <Lock size={18} />
                  </div>
                  <input 
                    type="password" 
                    className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#217346] focus:border-[#217346] outline-none text-gray-800 font-medium transition placeholder-gray-400"
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
                className={`w-full bg-[#217346] text-white py-3 rounded-lg font-bold text-base hover:bg-[#1a5c38] transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-2 ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    <span>正在验证...</span>
                  </>
                ) : (
                  <span>登录</span>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>

      <footer className="py-6 border-t border-gray-300 bg-white">
        <div className="text-center space-y-2">
          <p className="text-gray-600 text-sm font-medium">以客户为中心 关怀员工 鼓励创新 纳新去旧</p>
          <p className="text-gray-500 text-xs">版权所有 © 1994-{new Date().getFullYear()} 小原（南京）机电有限公司</p>
        </div>
      </footer>
    </div>
  );
};

export default Login;
