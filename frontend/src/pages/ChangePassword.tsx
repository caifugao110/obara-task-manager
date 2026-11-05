import React, { useMemo, useState, useEffect } from 'react';
import { axiosInstance } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, AlertCircle, CheckCircle, Check, ShieldCheck, Eye, EyeOff, WifiOff } from 'lucide-react';
import { sanitizeRedirect } from '../utils/redirect';
import { PWD_INPUT_CLASS, PWD_EYE_BTN_CLASS, PWD_PRIMARY_BTN_CLASS, PWD_STRENGTH_META, scorePassword } from '../utils/passwordFieldStyles';

const ChangePassword = () => {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [visiblePasswords, setVisiblePasswords] = useState({
    old: false,
    new: false,
    confirm: false
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const isOffline = !isOnline;
  const { setForcePasswordChange } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTarget = sanitizeRedirect(searchParams.get('redirect'));

  // 浏览器网络 + 后端服务可达性监听：离线时禁止提交表单
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

  // 强度与一致性提示：仅作即时反馈，提交校验仍以后端为准
  const strength = useMemo(() => scorePassword(newPassword), [newPassword]);
  const strengthMeta = PWD_STRENGTH_META[strength] ?? PWD_STRENGTH_META[0];
  const confirmMatched = confirmPassword.length > 0 && confirmPassword === newPassword;
  const confirmMismatched = confirmPassword.length > 0 && confirmPassword !== newPassword;

  const togglePasswordVisibility = (field: keyof typeof visiblePasswords) => {
    setVisiblePasswords((current) => ({
      ...current,
      [field]: !current[field]
    }));
  };

  const renderPasswordInput = (
    id: string,
    field: keyof typeof visiblePasswords,
    value: string,
    onChange: (value: string) => void,
    placeholder: string,
    autoComplete: string,
    autoFocus = false,
    invalid = false
  ) => (
    <div className="group relative">
      <Lock
        size={16}
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-[#217346]"
      />
      <input
        id={id}
        type={visiblePasswords[field] ? 'text' : 'password'}
        className={`${PWD_INPUT_CLASS} ${invalid ? '!border-red-300 !bg-red-50/50' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        disabled={isOffline}
        required
      />
      <button
        type="button"
        className={PWD_EYE_BTN_CLASS}
        onClick={() => togglePasswordVisibility(field)}
        onMouseDown={(e) => e.preventDefault()}
        aria-label={visiblePasswords[field] ? '隐藏密码' : '显示密码'}
        title={visiblePasswords[field] ? '隐藏密码' : '显示密码'}
      >
        {visiblePasswords[field] ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    if (!oldPassword || !newPassword) {
      setError('请填写所有字段');
      return;
    }

    if (isOffline) {
      setError('当前网络离线，无法修改密码，请待网络恢复后重试');
      return;
    }

    setLoading(true);
    try {
      await axiosInstance.post('/auth/change-password', {
        oldPassword,
        newPassword
      });

      setSuccess('密码修改成功，正在进入系统...');
      setForcePasswordChange(false);
      localStorage.removeItem('forcePasswordChange');

      setTimeout(() => {
        navigate(redirectTarget, { replace: true });
      }, 1500);
    } catch (err: any) {
      setError(err.response?.data?.message || '密码修改失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-100 via-[#f3f5f4] to-slate-200/70">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[440px]">
          <div className="overflow-hidden rounded-2xl bg-white shadow-[0_24px_64px_-16px_rgba(15,23,42,0.22)] ring-1 ring-slate-900/5">
            <div className="px-7 pb-5 pt-7">
              <div className="flex items-start gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#2c8f57] to-[#1a5c38] text-white shadow-lg shadow-[#217346]/25">
                  <Lock size={20} strokeWidth={2.2} />
                </div>
                <div className="min-w-0 pt-0.5">
                  <h1 className="text-[17px] font-bold leading-6 text-slate-900">修改登录密码</h1>
                  <p className="mt-1 text-xs leading-5 text-slate-500">首次登录请设置新密码，建议字母与数字组合、不少于 8 位</p>
                </div>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col" noValidate>
              <div className="space-y-4 px-7">
                {isOffline && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-amber-100 bg-amber-50 px-3.5 py-3 text-amber-700">
                    <WifiOff size={16} className="mt-0.5 shrink-0" />
                    <div className="text-[13px] font-medium leading-5">
                      当前网络离线，暂时无法修改密码，网络恢复后自动解除限制
                    </div>
                  </div>
                )}

                {error && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-red-100 bg-red-50 px-3.5 py-3 text-red-600">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <div className="text-[13px] font-medium leading-5">{error}</div>
                  </div>
                )}

                {success && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-3 text-emerald-700">
                    <CheckCircle size={16} className="mt-0.5 shrink-0" />
                    <div className="text-[13px] font-medium leading-5">{success}</div>
                  </div>
                )}

                <div className="space-y-2">
                  <label htmlFor="cp-old" className="block text-[13px] font-semibold text-slate-700">当前密码</label>
                  {renderPasswordInput('cp-old', 'old', oldPassword, setOldPassword, '请输入当前密码', 'current-password', true)}
                </div>

                <div className="h-px bg-slate-100" />

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="cp-new" className="block text-[13px] font-semibold text-slate-700">新密码</label>
                    <span className={`text-[11px] font-semibold ${strengthMeta.text || 'text-slate-400'}`}>
                      {strengthMeta.label || '强度'}
                    </span>
                  </div>
                  {renderPasswordInput('cp-new', 'new', newPassword, setNewPassword, '请输入新密码', 'new-password')}
                  {newPassword.length > 0 && (
                    <div className="flex items-center gap-1.5 pt-0.5">
                      {[1, 2, 3, 4].map((level) => (
                        <span
                          key={level}
                          className={`pwd-strength-seg h-1 flex-1 rounded-full ${strength >= level ? strengthMeta.color : 'bg-slate-200'}`}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="cp-confirm" className="block text-[13px] font-semibold text-slate-700">确认新密码</label>
                    {confirmMatched && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                        <Check size={12} strokeWidth={3} />
                        两次输入一致
                      </span>
                    )}
                    {confirmMismatched && <span className="text-[11px] font-semibold text-red-500">两次输入不一致</span>}
                  </div>
                  {renderPasswordInput(
                    'cp-confirm',
                    'confirm',
                    confirmPassword,
                    setConfirmPassword,
                    '请再次输入新密码',
                    'new-password',
                    false,
                    confirmMismatched
                  )}
                </div>
              </div>

              <div className="mt-6 border-t border-slate-100 bg-slate-50/80 px-7 py-4">
                <button type="submit" disabled={loading || isOffline} className={`${PWD_PRIMARY_BTN_CLASS} h-11`}>
                  {loading ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      <span>正在修改...</span>
                    </>
                  ) : (
                    <span>确认修改</span>
                  )}
                </button>
                <p className="mt-2.5 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                  <ShieldCheck size={12} />
                  修改成功后自动进入系统
                </p>
              </div>
            </form>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200/70 bg-white/60 py-5">
        <div className="space-y-1.5 text-center">
          <p className="text-sm font-medium text-slate-600">以客户为中心 关怀员工 鼓励创新 纳新去旧</p>
          <p className="text-xs text-slate-400">版权所有 © 1994-{new Date().getFullYear()} 小原（南京）机电有限公司</p>
        </div>
      </footer>
    </div>
  );
};

export default ChangePassword;
