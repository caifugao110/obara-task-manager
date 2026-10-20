import React, { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LogIn, User, Lock, AlertCircle, Eye, EyeOff, CheckCircle, ShieldCheck } from 'lucide-react';
import { sanitizeRedirect } from '../utils/redirect';

// 全部样式类加 login- 前缀，避免污染全局命名空间
const loginStyles = `
.login-page { min-height: 100vh; display: flex; flex-direction: column; background: #050b14; color: #e2e8f0; position: relative; overflow: hidden; }
.login-bg-base { position: fixed; inset: 0; pointer-events: none;
  background:
    radial-gradient(ellipse 80% 60% at 20% 8%, rgba(33,115,70,0.20), transparent 60%),
    radial-gradient(ellipse 70% 60% at 82% 92%, rgba(16,80,120,0.24), transparent 62%),
    #050b14; }
.login-grid-bg { position: fixed; inset: 0; pointer-events: none;
  background-image: linear-gradient(rgba(56,189,248,0.05) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(56,189,248,0.05) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(ellipse 72% 62% at 50% 45%, black 30%, transparent 78%);
  -webkit-mask-image: radial-gradient(ellipse 72% 62% at 50% 45%, black 30%, transparent 78%);
  animation: login-grid-drift 14s linear infinite; }
@keyframes login-grid-drift { to { background-position: 44px 44px, 44px 44px; } }
.login-blob { position: fixed; border-radius: 50%; filter: blur(90px); opacity: 0.5; pointer-events: none; }
.login-blob-1 { width: 480px; height: 480px; top: -140px; left: -120px;
  background: radial-gradient(circle, rgba(33,115,70,0.55), transparent 65%);
  animation: login-blob-float 11s ease-in-out infinite; }
.login-blob-2 { width: 420px; height: 420px; bottom: -160px; right: -100px;
  background: radial-gradient(circle, rgba(45,143,94,0.40), transparent 65%);
  animation: login-blob-float 13s ease-in-out -4s infinite reverse; }
.login-blob-3 { width: 300px; height: 300px; top: 38%; right: 10%;
  background: radial-gradient(circle, rgba(56,189,248,0.26), transparent 65%);
  animation: login-blob-float 15s ease-in-out -8s infinite; }
@keyframes login-blob-float { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(30px,-40px) scale(1.08); } }
.login-particle { position: fixed; bottom: -12px; border-radius: 50%;
  background: rgba(110,231,183,0.85); box-shadow: 0 0 6px rgba(110,231,183,0.9);
  animation: login-particle-rise linear infinite; pointer-events: none; }
@keyframes login-particle-rise { to { transform: translateY(-108vh); } }
.login-bg-scan { position: fixed; inset: 0; pointer-events: none;
  background: linear-gradient(115deg, transparent 42%, rgba(110,231,183,0.05) 50%, transparent 58%);
  animation: login-scan 6.5s ease-in-out infinite; }
@keyframes login-scan { 0% { transform: translateX(-60%); } 60%,100% { transform: translateX(60%); } }

.login-enter { animation: login-rise-in 0.7s cubic-bezier(0.22,1,0.36,1) both; }
.login-enter-delay-1 { animation-delay: 0.10s; }
@keyframes login-rise-in { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: translateY(0); } }

.login-title-gradient {
  background: linear-gradient(90deg, #6ee7b7, #34d399, #a7f3d0, #34d399, #6ee7b7);
  background-size: 220% 100%; -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: login-shimmer 5s linear infinite; }
@keyframes login-shimmer { to { background-position: 220% 0; } }

.login-logo { position: relative; display: inline-flex; }
.login-logo-glow { position: absolute; inset: -18px; border-radius: 28px; pointer-events: none;
  background: radial-gradient(circle, rgba(52,211,153,0.40), transparent 70%);
  animation: login-pulse 3.2s ease-in-out infinite; }
@keyframes login-pulse { 0%,100% { opacity: 0.55; transform: scale(1); } 50% { opacity: 1; transform: scale(1.12); } }
.login-logo-ring { position: absolute; inset: -10px; border-radius: 24px; pointer-events: none;
  border: 1px dashed rgba(110,231,183,0.35); animation: login-ring-spin 14s linear infinite; }
@keyframes login-ring-spin { to { transform: rotate(360deg); } }

.login-status { position: fixed; top: 18px; right: 22px; z-index: 40;
  display: flex; align-items: center; gap: 8px;
  font-size: 11px; letter-spacing: 0.18em; font-weight: 700; }
.login-blink-dot { width: 8px; height: 8px; border-radius: 50%;
  animation: login-blink 1.6s ease-in-out infinite; }
@keyframes login-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }

.login-card { position: relative; background: rgba(13,23,38,0.72);
  backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
  border: 1px solid rgba(110,231,183,0.14); border-radius: 18px; padding: 34px;
  box-shadow: 0 24px 70px rgba(0,0,0,0.5);
  transform-style: preserve-3d; transition: transform 0.15s ease-out; will-change: transform; }
.login-scanline { position: absolute; top: 0; left: 8%; right: 8%; height: 1px; pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(110,231,183,0.55), transparent); }
.login-corner { position: absolute; width: 18px; height: 18px; pointer-events: none;
  border-color: rgba(110,231,183,0.5); border-style: solid; }
.login-corner-tl { top: -1px; left: -1px; border-width: 2px 0 0 2px; border-radius: 6px 0 0 0; }
.login-corner-tr { top: -1px; right: -1px; border-width: 2px 2px 0 0; border-radius: 0 6px 0 0; }
.login-corner-bl { bottom: -1px; left: -1px; border-width: 0 0 2px 2px; border-radius: 0 0 0 6px; }
.login-corner-br { bottom: -1px; right: -1px; border-width: 0 2px 2px 0; border-radius: 0 0 6px 0; }

.login-label { display: block; font-size: 11px; font-weight: 700; color: rgba(167,243,208,0.55);
  text-transform: uppercase; letter-spacing: 0.16em; margin-left: 4px; margin-bottom: 6px; }
.login-input { width: 100%; background: rgba(8,15,28,0.8); border: 1px solid rgba(148,163,184,0.22);
  border-radius: 10px; color: #e2e8f0; outline: none; font-weight: 500;
  transition: border-color 0.2s, box-shadow 0.2s; }
.login-input::placeholder { color: rgba(100,116,139,0.7); }
.login-input:focus { border-color: #34d399;
  box-shadow: 0 0 0 3px rgba(52,211,153,0.15), 0 0 18px rgba(52,211,153,0.12); }
.login-input:disabled { opacity: 0.55; cursor: not-allowed; }

.login-btn { position: relative; overflow: hidden; width: 100%; border-radius: 10px;
  background: linear-gradient(90deg, #217346, #2d8f5e); color: #fff;
  padding: 12px 0; font-weight: 700; font-size: 15px;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  transition: transform 0.15s ease, filter 0.2s; }
.login-btn::after { content: ''; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.22) 50%, transparent 70%);
  transform: translateX(-120%); animation: login-btn-sheen 3.2s ease-in-out infinite; }
@keyframes login-btn-sheen { 0% { transform: translateX(-120%); } 55%,100% { transform: translateX(120%); } }
.login-btn:hover:not(:disabled) { filter: brightness(1.1); }
.login-btn:active:not(:disabled) { transform: scale(0.98); }
.login-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.login-shake { animation: login-shake-x 0.45s cubic-bezier(0.36,0.07,0.19,0.97) both; }
@keyframes login-shake-x { 10%,90% { transform: translateX(-1px); } 20%,80% { transform: translateX(2px); }
  30%,50%,70% { transform: translateX(-3px); } 40%,60% { transform: translateX(3px); } }

@media (prefers-reduced-motion: reduce) {
  .login-grid-bg, .login-blob, .login-particle, .login-bg-scan,
  .login-logo-glow, .login-logo-ring, .login-blink-dot, .login-title-gradient { animation: none !important; }
  .login-btn::after { animation: none !important; }
  .login-enter, .login-enter-delay-1 { animation: none !important; opacity: 1 !important; transform: none !important; }
}
`;

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [sessionPolicy, setSessionPolicy] = useState<{ displayText: string } | null>(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [shake, setShake] = useState(false);
  const isOffline = !isOnline;
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTarget = sanitizeRedirect(searchParams.get('redirect'));

  // 3D 倾斜：直写 style.transform + requestAnimationFrame，避免高频 setState 整树重渲染
  const cardRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  // 粒子参数用 useMemo 固定，避免每次渲染随机值变化导致动画重置
  const particles = useMemo(() => Array.from({ length: 22 }, (_, i) => ({
    id: i,
    left: `${(i * 37 + 13) % 100}%`,
    size: 2 + ((i * 7) % 3),
    duration: `${9 + ((i * 13) % 11)}s`,
    delay: `${(i * 17) % 12}s`,
    opacity: 0.25 + ((i * 29) % 40) / 100,
  })), []);

  // 浏览器网络 + 后端服务可达性监听：离线时禁止提交登录表单
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleServerUnreachable = () => setIsOnline(false);
    const handleServerOnline = () => setIsOnline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('server-unreachable', handleServerUnreachable);
    window.addEventListener('server-online', handleServerOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('server-unreachable', handleServerUnreachable);
      window.removeEventListener('server-online', handleServerOnline);
    };
  }, []);

  useEffect(() => {
    // 退出登录提示：由 AuthContext 登出时写入 sessionStorage，读取一次即清除
    const authNotice = sessionStorage.getItem('authNotice');
    if (authNotice) {
      setNotice(authNotice);
      sessionStorage.removeItem('authNotice');
    }
    // 会话有效期政策：读取后端配置（JWT_EXPIRES_IN），动态展示重新登录周期
    axios.get('/api/auth/session-policy')
      .then(res => setSessionPolicy(res.data))
      .catch(() => setSessionPolicy({ displayText: '3 天' }));
  }, []);

  const handleTiltMove = (e: React.MouseEvent) => {
    const card = cardRef.current;
    if (!card) return;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = card.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      card.style.transform = `perspective(1100px) rotateX(${(-py * 5).toFixed(2)}deg) rotateY(${(px * 5).toFixed(2)}deg)`;
    });
  };

  const handleTiltLeave = () => {
    const card = cardRef.current;
    if (!card) return;
    cancelAnimationFrame(rafRef.current);
    card.style.transform = 'perspective(1100px) rotateX(0deg) rotateY(0deg)';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (isOffline) {
      setError('当前网络离线，无法登录，请待网络恢复后重试');
      return;
    }
    setLoading(true);
    try {
      const response = await axios.post('/api/auth/login', { username, password });
      login(response.data.token, response.data.user, response.data.forcePasswordChange);
      if (response.data.forcePasswordChange) {
        navigate(`/change-password?redirect=${encodeURIComponent(redirectTarget)}`, { replace: true });
      } else {
        navigate(redirectTarget, { replace: true });
      }
    } catch (err: any) {
      if (!navigator.onLine || err?.code === 'ERR_NETWORK' || err?.message === 'Network Error') {
        setIsOnline(false);
      }
      setError(err.response?.data?.message || '登录失败，请检查网络连接');
      // 错误抖动：重触发动画
      setShake(true);
      setTimeout(() => setShake(false), 500);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <style>{loginStyles}</style>
      <div className="login-bg-base" />
      <div className="login-grid-bg" />
      <div className="login-blob login-blob-1" />
      <div className="login-blob login-blob-2" />
      <div className="login-blob login-blob-3" />
      {particles.map(p => (
        <span
          key={p.id}
          className="login-particle"
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            opacity: p.opacity,
            animationDuration: p.duration,
            animationDelay: p.delay,
          }}
        />
      ))}
      <div className="login-bg-scan" />

      <div className={`login-status ${isOffline ? 'text-red-400/80' : 'text-emerald-400/70'}`}>
        <span className={`login-blink-dot ${isOffline ? 'bg-red-400' : 'bg-emerald-400'}`} />
        {isOffline ? 'SYSTEM OFFLINE' : 'SYSTEM ONLINE'}
      </div>

      <div className="flex-1 flex items-center justify-center px-4 relative z-10">
        <div className="max-w-md w-full">
          <div className="text-center mb-8 login-enter">
            <div className="login-logo mb-5">
              <span className="login-logo-glow" />
              <span className="login-logo-ring" />
              <div className="relative inline-flex items-center justify-center w-16 h-16 bg-[#217346] rounded-2xl shadow-lg">
                <LogIn className="text-white" size={32} />
              </div>
            </div>
            <h2 className="text-2xl font-bold tracking-tight login-title-gradient">Obara 任务管理系统</h2>
            <p className="mt-3">
              <span className="inline-block bg-gradient-to-r from-[#217346] to-[#2d8f5e] text-white text-xs font-bold px-4 py-1 rounded-full tracking-wider shadow-[0_0_18px_rgba(52,211,153,0.35)]">
                技术开发二部
              </span>
            </p>
          </div>

          <div
            className="login-enter login-enter-delay-1"
            style={{ perspective: '1100px' }}
            onMouseMove={handleTiltMove}
            onMouseLeave={handleTiltLeave}
          >
            <div ref={cardRef} className={`login-card ${shake ? 'login-shake' : ''}`}>
              <span className="login-scanline" />
              <span className="login-corner login-corner-tl" />
              <span className="login-corner login-corner-tr" />
              <span className="login-corner login-corner-bl" />
              <span className="login-corner login-corner-br" />

              {isOffline && (
                <div className="bg-amber-500/10 border border-amber-400/30 text-amber-300 p-4 rounded-lg mb-6 flex items-start gap-3">
                  <AlertCircle size={20} className="mt-0.5 shrink-0" />
                  <div className="text-sm font-bold">当前网络离线，无法登录，网络恢复后自动解除限制</div>
                </div>
              )}

              {error && (
                <div className="bg-red-500/10 border border-red-400/30 text-red-300 p-4 rounded-lg mb-6 flex items-start gap-3">
                  <AlertCircle size={20} className="mt-0.5 shrink-0" />
                  <div className="text-sm font-bold">{error}</div>
                </div>
              )}

              {notice && !error && (
                <div className="bg-emerald-500/10 border border-emerald-400/30 text-emerald-300 p-4 rounded-lg mb-6 flex items-start gap-3">
                  <CheckCircle size={20} className="mt-0.5 shrink-0" />
                  <div className="text-sm font-bold">{notice}</div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="login-label">用户名</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500">
                      <User size={18} />
                    </div>
                    <input
                      type="text"
                      className="login-input pl-11 pr-4 py-3"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="请输入您的登录账号"
                      disabled={isOffline}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="login-label">密码</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500">
                      <Lock size={18} />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="login-input pl-11 pr-12 py-3"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="请输入您的登录密码"
                      disabled={isOffline}
                      required
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 px-4 flex items-center text-slate-500 hover:text-slate-300 focus:text-emerald-400 outline-none transition"
                      onClick={() => setShowPassword((visible) => !visible)}
                      onMouseDown={(e) => e.preventDefault()}
                      aria-label={showPassword ? '隐藏密码' : '显示密码'}
                      title={showPassword ? '隐藏密码' : '显示密码'}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-2 ml-1">首次登录或密码被管理员重置后，系统会要求您设置新密码。</p>
                </div>

                <button type="submit" className="login-btn" disabled={loading || isOffline}>
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

              {sessionPolicy && (
                <p className="mt-5 text-xs text-slate-500 flex items-center justify-center gap-1.5">
                  <ShieldCheck size={14} className="shrink-0" />
                  <span>为保障账号安全，系统每 {sessionPolicy.displayText}需要重新登录一次</span>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <footer className="py-6 border-t border-white/10 relative z-10">
        <div className="text-center space-y-2">
          <p className="text-slate-400 text-sm font-medium">以客户为中心 关怀员工 鼓励创新 纳新去旧</p>
          <p className="text-slate-500 text-xs">版权所有 © 1994-{new Date().getFullYear()} 小原（南京）机电有限公司</p>
        </div>
      </footer>
    </div>
  );
};

export default Login;
