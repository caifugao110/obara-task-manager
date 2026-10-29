import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff, CheckCircle, ShieldCheck, Check,
  FileText, Settings2, Folder, Atom, Award, FlaskConical, Cpu, Medal } from 'lucide-react';
import { sanitizeRedirect } from '../utils/redirect';

// 全部样式类加 login- 前缀，避免污染全局命名空间
const loginStyles = `
.login-page { min-height: 100vh; display: flex; flex-direction: column; color: #ffffff; position: relative; overflow: hidden;
  background: linear-gradient(135deg, #022c22 0%, #064e3b 14%, #065f46 26%, #047857 40%, #059669 54%, #07c05f 68%, #10b981 82%, #34d399 92%, #6ee7b7 100%); }
.login-deco { position: fixed; border-radius: 50%; pointer-events: none; filter: blur(70px);
  animation: login-deco-drift 22s ease-in-out infinite alternate; }
.login-deco-a { width: 560px; height: 560px; top: -180px; left: -160px;
  background: radial-gradient(circle, rgba(255,255,255,0.20), transparent 70%); }
.login-deco-b { width: 640px; height: 640px; bottom: -240px; right: -180px;
  background: radial-gradient(circle, rgba(110,231,183,0.42), transparent 70%); animation-delay: -8s; }
@keyframes login-deco-drift { from { transform: translate3d(0,0,0) scale(1); } to { transform: translate3d(26px,-20px,0) scale(1.07); } }

/* 背景装饰层：漂浮线性图标 + 流动虚线网络（参考页同款动效） */
.login-bg-art { position: fixed; inset: 0; z-index: 1; pointer-events: none; overflow: hidden; }
.login-bg-icon { position: absolute; color: rgba(255,255,255,0.13);
  animation: login-icon-float 15s ease-in-out infinite alternate; will-change: transform; }
@keyframes login-icon-float {
  0%   { transform: translate3d(0,0,0) rotate(-4deg); opacity: 0.85; }
  50%  { opacity: 1; }
  100% { transform: translate3d(14px,-22px,0) rotate(4deg); opacity: 0.85; }
}
.login-bg-net { position: absolute; inset: 0; width: 100%; height: 100%; }
.login-bg-net path { fill: none; stroke: rgba(255,255,255,0.14); stroke-width: 2;
  stroke-dasharray: 11 17; stroke-linecap: round; animation: login-net-flow 26s linear infinite; }
.login-bg-net path:nth-child(2) { animation-duration: 34s; animation-direction: reverse; }
.login-bg-net path:nth-child(3) { animation-duration: 42s; }
@keyframes login-net-flow { to { stroke-dashoffset: -560; } }
.login-bg-net circle { fill: rgba(255,255,255,0.18); animation: login-net-pulse 7s ease-in-out infinite; }
@keyframes login-net-pulse { 0%,100% { opacity: 0.35; } 50% { opacity: 1; } }
.login-deco-grid { position: fixed; inset: 0; pointer-events: none; opacity: 0.35;
  background-image: linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px);
  background-size: 64px 64px;
  mask-image: radial-gradient(ellipse 85% 75% at 50% 45%, black 20%, transparent 80%);
  -webkit-mask-image: radial-gradient(ellipse 85% 75% at 50% 45%, black 20%, transparent 80%); }

.login-header { position: relative; z-index: 3; display: flex; align-items: center; justify-content: space-between;
  padding: 22px 52px; gap: 16px; }
.login-brand { display: flex; align-items: center; gap: 14px; color: #ffffff; }
.login-brand-word { position: relative; font-family: 'Century Gothic', 'Futura', 'Bahnschrift', 'Segoe UI', system-ui, sans-serif;
  font-size: 29px; font-weight: 700; letter-spacing: 0.26em; padding-right: 0.26em; line-height: 1;
  text-transform: uppercase; -webkit-font-smoothing: antialiased;
  background: linear-gradient(94deg, #ffffff 0%, #f2fffa 32%, #c8f8e2 62%, #8ceec6 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 3px 14px rgba(2,44,34,0.34)); }
.login-brand-word::before { content: ''; position: absolute; left: 0; right: 0.26em; bottom: -7px; height: 2px;
  background: linear-gradient(90deg, rgba(255,255,255,0.9), rgba(140,238,198,0.75) 45%, rgba(140,238,198,0));
  border-radius: 2px; }
.login-brand-dot { width: 9px; height: 9px; border-radius: 50%;
  background: radial-gradient(circle at 32% 30%, #e2fff4, #34d399 52%, #0b7d52 100%);
  box-shadow: 0 0 12px rgba(52,211,153,0.75), 0 0 3px rgba(255,255,255,0.9); }

.login-status-pill { display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 999px;
  background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.24);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  font-size: 11px; letter-spacing: 0.16em; font-weight: 700; color: rgba(255,255,255,0.94); }
.login-blink-dot { width: 7px; height: 7px; border-radius: 50%; animation: login-blink 1.6s ease-in-out infinite; }
@keyframes login-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

.login-main { position: relative; z-index: 2; flex: 1;
  display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(420px, 1fr); align-items: center;
  gap: 32px; width: 100%; margin: 0 auto; padding: 4px 52px 28px; }

.login-hero { width: 100%; max-width: 620px; animation: login-rise-in 0.6s cubic-bezier(0.22,1,0.36,1) both; }
.login-hero h1 { font-size: clamp(19px, 1.2vw, 24px); line-height: 1.32; font-weight: 600; letter-spacing: 0.01em;
  color: #ffffff; text-shadow: 0 2px 24px rgba(2,44,34,0.28); }
.login-hero-sub { margin-top: 10px; font-size: 13px; line-height: 1.7; color: rgba(255,255,255,0.82); }
.login-hero-intro { margin-top: 14px; max-width: 600px; font-size: 13px; line-height: 1.9;
  color: rgba(255,255,255,0.76); letter-spacing: 0.01em; text-align: justify; }
.login-tags { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
.login-tag { padding: 6px 15px; border-radius: 999px; font-size: 12.5px; font-weight: 500; color: rgba(255,255,255,0.95);
  background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.28);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }

.login-visual { margin-top: 28px; padding: 16px; border-radius: 22px;
  background: linear-gradient(160deg, rgba(255,255,255,0.52), rgba(255,255,255,0.26));
  border: 1px solid rgba(255,255,255,0.5);
  box-shadow: 0 26px 60px rgba(2,44,34,0.3); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
.login-visual-inner { border-radius: 16px; background: rgba(255,255,255,0.97); padding: 24px 24px 26px;
  box-shadow: 0 14px 34px rgba(6,78,59,0.12); }
.login-visual-title { font-size: 20px; font-weight: 600; color: #0b3b2b; letter-spacing: 0.01em; }
.login-visual-sub { margin-top: 7px; font-size: 11.5px; color: #6b8a7d; }
.login-flow { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 20px; }
.login-flow-col { border-radius: 12px; padding: 15px 10px 17px; border: 1px solid transparent; }
.login-flow-col--plan { background: #fef7e6; border-color: #fbe6b3; }
.login-flow-col--track { background: #eef4ff; border-color: #cfe0fa; }
.login-flow-col--ledger { background: #e6f8f4; border-color: #b9e8dc; }
.login-flow-col--spec { background: #eafaf1; border-color: #c2eed8; }
.login-flow-col-title { font-size: 12.5px; font-weight: 700; text-align: center; white-space: nowrap; }
.login-flow-col--plan .login-flow-col-title { color: #b06512; }
.login-flow-col--track .login-flow-col-title { color: #1d5fb0; }
.login-flow-col--ledger .login-flow-col-title { color: #0d7a63; }
.login-flow-col--spec .login-flow-col-title { color: #07804a; }
.login-flow-chips { display: flex; flex-direction: column; gap: 9px; margin-top: 13px; }
.login-flow-chip { padding: 6px 7px; border-radius: 999px; background: rgba(255,255,255,0.94);
  border: 1px solid rgba(15,52,40,0.08); font-size: 10.5px; line-height: 1.35; text-align: center; color: #43594f; }
.login-flow-arrow { margin-top: 16px; text-align: center; font-size: 13px; color: #079b52; letter-spacing: 0.08em; }
.login-flow-cta { margin-top: 10px; border-radius: 999px; padding: 12px 12px; text-align: center;
  background: linear-gradient(90deg, #07c05f, #10b981); color: #ffffff;
  font-size: 13px; font-weight: 600; letter-spacing: 0.04em; box-shadow: 0 10px 24px rgba(7,192,95,0.32); }

.login-panel { display: flex; justify-content: center; }
.login-card { width: 100%; max-width: 480px; padding: 40px; border-radius: 16px;
  background: rgba(255,255,255,0.97); color: rgba(0,0,0,0.88);
  box-shadow: 0 10px 40px rgba(0,0,0,0.15);
  animation: login-rise-in 0.65s cubic-bezier(0.22,1,0.36,1) 0.08s both; }
@keyframes login-rise-in { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

.login-card-title { font-size: 24px; font-weight: 600; text-align: center; color: rgba(0,0,0,0.9); letter-spacing: 0.01em; }
.login-card-sub { margin-top: 8px; font-size: 13px; line-height: 1.65; text-align: center; color: rgba(0,0,0,0.45); }

.login-hint { margin-top: 20px; padding: 11px 14px; border-radius: 8px; text-align: center;
  background: rgba(7,192,95,0.09); color: #05803f; font-size: 13px; line-height: 1.6; }

.login-alert { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border-radius: 8px;
  margin-top: 16px; font-size: 13px; font-weight: 600; line-height: 1.55; }
.login-alert--error { background: #fef2f2; border: 1px solid #fecaca; color: #b42318; }
.login-alert--notice { background: #eafaf1; border: 1px solid #b6ebcd; color: #05803f; }
.login-alert--warn { background: #fffaeb; border: 1px solid #fbe0a6; color: #a86a0b; }

.login-form { display: flex; flex-direction: column; gap: 18px; margin-top: 26px; }
.login-label { display: block; margin-bottom: 8px; font-size: 14px; font-weight: 500; color: rgba(0,0,0,0.86); }
.login-required { margin-right: 4px; color: #f56c6c; }
.login-input { width: 100%; height: 46px; padding: 0 14px; border-radius: 8px;
  background: #ffffff; border: 1px solid #e7e7e7; color: #111827; font-size: 14px;
  outline: none; transition: border-color 0.18s, box-shadow 0.18s; }
.login-input::placeholder { color: #9aa4ae; }
.login-input:focus { border-color: #07c05f; box-shadow: 0 0 0 3px rgba(7,192,95,0.12); }
.login-input:disabled { background: #f5f6f7; color: #9ca3af; cursor: not-allowed; }
.login-input--with-action { padding-right: 46px; }

.login-eye { position: absolute; top: 0; right: 0; height: 100%; padding: 0 14px; display: flex; align-items: center;
  color: #8a949e; outline: none; transition: color 0.18s; }
.login-eye:hover, .login-eye:focus { color: #07c05f; }

.login-btn { position: relative; overflow: hidden; width: 100%; height: 46px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  background: #07c05f; color: #ffffff; font-size: 16px; font-weight: 600;
  transition: background 0.18s ease, transform 0.12s ease, filter 0.18s ease; }
.login-btn:hover:not(:disabled) { background: #06b055; }
.login-btn:active:not(:disabled) { transform: scale(0.985); }
.login-btn:disabled { opacity: 0.65; cursor: not-allowed; }

.login-policy { margin-top: 22px; display: flex; align-items: center; justify-content: center; gap: 6px;
  font-size: 12px; color: rgba(0,0,0,0.42); text-align: center; }

.login-features { margin-top: 20px; padding-top: 18px; border-top: 1px solid #eff1f0;
  display: flex; flex-direction: column; gap: 13px; }
.login-feature { display: flex; align-items: center; gap: 10px; font-size: 13px; line-height: 1.4; color: rgba(0,0,0,0.6); }
.login-feature-icon { width: 22px; height: 22px; border-radius: 50%; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  background: #e9f9f0; color: #07c05f; box-shadow: inset 0 0 0 1px rgba(7,192,95,0.14); }

.login-shake { animation: login-shake-x 0.45s cubic-bezier(0.36,0.07,0.19,0.97) both; }
@keyframes login-shake-x { 10%,90% { transform: translateX(-1px); } 20%,80% { transform: translateX(2px); }
  30%,50%,70% { transform: translateX(-3px); } 40%,60% { transform: translateX(3px); } }

.login-footer { position: relative; z-index: 2; padding: 14px 52px 18px; text-align: center;
  border-top: 1px solid rgba(255,255,255,0.16); color: rgba(255,255,255,0.66); }
.login-footer p { margin: 2px 0; }
.login-footer-slogan { font-size: 13px; letter-spacing: 0.06em; color: rgba(255,255,255,0.78); }
.login-footer-copy { font-size: 12px; }

@media (max-width: 1080px) {
  .login-main { grid-template-columns: minmax(0, 1fr); justify-items: center; padding: 4px 24px 32px; }
  .login-hero { display: none; }
  .login-header { padding: 20px 24px; }
  .login-footer { padding: 14px 24px 18px; }
}
@media (max-width: 520px) {
  .login-card { padding: 28px 22px; border-radius: 14px; }
  .login-header { padding: 16px 18px; }
  .login-main { padding: 4px 16px 28px; }
}

@media (prefers-reduced-motion: reduce) {
  .login-blink-dot { animation: none !important; }
  .login-hero, .login-card { animation: none !important; opacity: 1 !important; transform: none !important; }
  .login-shake { animation: none !important; }
  .login-deco, .login-bg-icon, .login-bg-net path, .login-bg-net circle { animation: none !important; }
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
      <div className="login-deco login-deco-a" />
      <div className="login-deco login-deco-b" />
      <div className="login-deco-grid" />

      {/* 背景动效：漂浮线性图标 + 流动虚线网络 */}
      <div className="login-bg-art" aria-hidden="true">
        <svg className="login-bg-net" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
          <path d="M 210 330 C 350 250, 470 380, 640 305 C 790 240, 900 360, 1080 300" />
          <path d="M 260 520 C 430 590, 600 455, 790 505 C 940 545, 1080 450, 1250 520" />
          <path d="M 420 700 C 560 760, 700 640, 880 705 C 1000 745, 1130 660, 1300 720" />
          <path d="M 120 430 C 200 385, 260 470, 360 420" />
          <circle cx="640" cy="305" r="4" />
          <circle cx="790" cy="505" r="4" />
          <circle cx="880" cy="705" r="4" />
          <circle cx="1080" cy="300" r="3" />
        </svg>
        <FileText className="login-bg-icon" style={{ top: '10%', left: '42%', width: 78, height: 78, animationDelay: '-2s' }} />
        <ShieldCheck className="login-bg-icon" style={{ top: '7%', left: '62%', width: 56, height: 56, animationDelay: '-6s', animationDuration: '13s' }} />
        <Settings2 className="login-bg-icon" style={{ top: '36%', left: '78%', width: 92, height: 92, animationDelay: '-9s', animationDuration: '18s' }} />
        <Folder className="login-bg-icon" style={{ top: '62%', left: '31%', width: 64, height: 64, animationDelay: '-4s', animationDuration: '14s' }} />
        <Atom className="login-bg-icon" style={{ top: '72%', left: '58%', width: 52, height: 52, animationDelay: '-11s', animationDuration: '17s' }} />
        <Award className="login-bg-icon" style={{ top: '16%', left: '89%', width: 46, height: 46, animationDelay: '-7s', animationDuration: '12s' }} />
        <FlaskConical className="login-bg-icon" style={{ top: '78%', left: '7%', width: 44, height: 44, animationDelay: '-13s' }} />
        <Cpu className="login-bg-icon" style={{ top: '46%', left: '6%', width: 38, height: 38, animationDelay: '-5s', animationDuration: '16s' }} />
        <Medal className="login-bg-icon" style={{ top: '46%', left: '94%', width: 40, height: 40, animationDelay: '-10s', animationDuration: '19s' }} />
      </div>

      <header className="login-header">
        <div className="login-brand">
          <span className="login-brand-word">OBARA</span>
          <span className="login-brand-dot" />
        </div>
        <div className="login-status-pill">
          <span className="login-blink-dot" style={{ background: isOffline ? '#fca5a5' : '#34d399' }} />
          {isOffline ? 'SYSTEM OFFLINE' : 'SYSTEM ONLINE'}
        </div>
      </header>

      <main className="login-main">
        <section className="login-hero">
          <h1>Obara 任务管理系统</h1>
          <p className="login-hero-sub">技术开发二部 · 任务协同与进度管理平台</p>
          <p className="login-hero-intro">
            Obara 任务管理系统是一款本地部署的 Excel 风格任务与工时管理工具，集成任务录入、工时统计、状态追踪、焊枪台账、
            设计规范知识库检索与问答、报表查询、权限控制与数据导入导出等能力，支持多人实时协作、离线浏览与操作审计。
          </p>
          <div className="login-tags">
            <span className="login-tag">任务管理</span>
            <span className="login-tag">进度跟踪</span>
            <span className="login-tag">智能台账</span>
            <span className="login-tag">设计规范知识库</span>
          </div>

          <div className="login-visual">
            <div className="login-visual-inner">
              <div className="login-visual-title">任务全流程协同</div>
              <div className="login-visual-sub">计划、执行、统计一体化，数据实时贯通</div>
              <div className="login-flow">
                <div className="login-flow-col login-flow-col--plan">
                  <div className="login-flow-col-title">计划排期</div>
                  <div className="login-flow-chips">
                    <span className="login-flow-chip">任务创建</span>
                    <span className="login-flow-chip">责任分工</span>
                    <span className="login-flow-chip">交付节点</span>
                  </div>
                </div>
                <div className="login-flow-col login-flow-col--track">
                  <div className="login-flow-col-title">进度跟踪</div>
                  <div className="login-flow-chips">
                    <span className="login-flow-chip">状态跟踪</span>
                    <span className="login-flow-chip">节点提醒</span>
                    <span className="login-flow-chip">逾期预警</span>
                  </div>
                </div>
                <div className="login-flow-col login-flow-col--ledger">
                  <div className="login-flow-col-title">智能台账</div>
                  <div className="login-flow-chips">
                    <span className="login-flow-chip">台账录入</span>
                    <span className="login-flow-chip">编号规则</span>
                    <span className="login-flow-chip">台账初始化</span>
                  </div>
                </div>
                <div className="login-flow-col login-flow-col--spec">
                  <div className="login-flow-col-title">设计规范知识库</div>
                  <div className="login-flow-chips">
                    <span className="login-flow-chip">规范检索</span>
                    <span className="login-flow-chip">智能问答</span>
                    <span className="login-flow-chip">知识归档</span>
                  </div>
                </div>
              </div>
              <div className="login-flow-arrow">↓</div>
              <div className="login-flow-cta">数据看板 · 决策支撑</div>
            </div>
          </div>
        </section>

        <section className="login-panel">
          <div className={`login-card ${shake ? 'login-shake' : ''}`}>
            <div className="login-card-title">登录</div>
            <div className="login-card-sub">Obara 任务管理系统 · 技术开发二部</div>

            {isOffline && (
              <div className="login-alert login-alert--warn">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <div>当前网络离线，无法登录，网络恢复后自动解除限制</div>
              </div>
            )}

            {error && (
              <div className="login-alert login-alert--error">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <div>{error}</div>
              </div>
            )}

            {notice && !error && (
              <div className="login-alert login-alert--notice">
                <CheckCircle size={18} className="mt-0.5 shrink-0" />
                <div>{notice}</div>
              </div>
            )}

            <div className="login-hint">首次登录或密码被管理员重置后，系统会要求您设置新密码。</div>

            <form onSubmit={handleSubmit} className="login-form">
              <div>
                <label className="login-label" htmlFor="login-username">
                  <span className="login-required">*</span>用户名
                </label>
                <input
                  id="login-username"
                  type="text"
                  className="login-input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入您的登录账号"
                  disabled={isOffline}
                  required
                />
              </div>

              <div>
                <label className="login-label" htmlFor="login-password">
                  <span className="login-required">*</span>密码
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    className="login-input login-input--with-action"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入您的登录密码"
                    disabled={isOffline}
                    required
                  />
                  <button
                    type="button"
                    className="login-eye"
                    onClick={() => setShowPassword((visible) => !visible)}
                    onMouseDown={(e) => e.preventDefault()}
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    title={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button type="submit" className="login-btn" disabled={loading || isOffline}>
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>
                    <span>正在验证...</span>
                  </>
                ) : (
                  <span>登录</span>
                )}
              </button>
            </form>

            {sessionPolicy && (
              <div className="login-policy">
                <ShieldCheck size={14} className="shrink-0" />
                <span>为保障账号安全，系统每 {sessionPolicy.displayText}需要重新登录一次</span>
              </div>
            )}

            <div className="login-features">
              {[
                '任务表格录入，多人实时协作',
                '工时统计与任务状态全程可追溯',
                '焊枪台账编号与台账初始化',
                '设计规范知识库检索与智能问答',
              ].map((text) => (
                <div className="login-feature" key={text}>
                  <span className="login-feature-icon">
                    <Check size={13} strokeWidth={2.6} />
                  </span>
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="login-footer">
        <p className="login-footer-slogan">以客户为中心 关怀员工 鼓励创新 纳新去旧</p>
        <p className="login-footer-copy">版权所有 © 1994-{new Date().getFullYear()} 小原（南京）机电有限公司</p>
      </footer>
    </div>
  );
};

export default Login;
