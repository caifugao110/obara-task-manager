/**
 * 登录回跳工具
 * 未登录访问受保护页面时跳转 /login?redirect=<原路径>，
 * 登录（或强制改密）成功后返回原页面。
 */

/** 获取当前页面完整路径（含查询参数与 hash） */
export const getCurrentPath = (): string =>
  window.location.pathname + window.location.search + window.location.hash;

/** 构造登录页地址，并携带 redirect 回跳参数 */
export const buildLoginUrl = (target: string = getCurrentPath()): string =>
  `/login?redirect=${encodeURIComponent(target)}`;

/**
 * 校验回跳地址，仅允许站内绝对路径，防止开放重定向：
 * - 必须以单个 / 开头（拒绝 //host 协议相对地址、/\\ 绕过、http(s):// 外链）
 * - 不允许跳回登录页或改密页，避免循环
 * 任何不合法值均回退到首页
 */
export const sanitizeRedirect = (raw: string | null | undefined): string => {
  if (!raw || !raw.startsWith('/')) return '/';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  if (raw === '/login' || raw.startsWith('/login?') || raw.startsWith('/login#')) return '/';
  if (raw === '/change-password' || raw.startsWith('/change-password?') || raw.startsWith('/change-password#')) {
    return '/';
  }
  return raw;
};

// 会话失效提示防重复标记：socket 踢下线、多个并发请求的 401、60s 轮询校验
// 可能同时触发，只允许第一条弹出提示并跳转（跳转是整页刷新，标记随之重置）
let sessionNoticeShown = false;

// 弹窗自动返回登录页的倒计时秒数
const SESSION_MODAL_COUNTDOWN = 5;

/** 会话失效自定义模态弹窗（替代原生 alert）：返回用户确认后的 Promise */
const showSessionModal = (message: string, details?: string[]): Promise<void> =>
  new Promise<void>((resolve) => {
    // 弹窗入场动画（id 去重，避免重复注入 <style>）
    if (!document.getElementById('session-modal-style')) {
      const style = document.createElement('style');
      style.id = 'session-modal-style';
      style.textContent =
        '@keyframes session-modal-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}';
      document.head.appendChild(style);
    }

    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      right: '0',
      bottom: '0',
      zIndex: '2147483647',
      background: 'rgba(15, 23, 42, 0.5)',
      backdropFilter: 'blur(2px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px',
      fontFamily: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      background: '#ffffff',
      borderRadius: '12px',
      boxShadow: '0 20px 40px -12px rgba(0, 0, 0, 0.35)',
      width: '100%',
      maxWidth: '360px',
      padding: '24px',
      textAlign: 'center',
      animation: 'session-modal-in 0.18s ease-out'
    });

    // 警告图标（与登录页告警样式同语义：红底圆形 + alert-circle 图标）
    const iconWrap = document.createElement('div');
    Object.assign(iconWrap.style, {
      width: '56px',
      height: '56px',
      borderRadius: '50%',
      background: '#fef2f2',
      border: '1px solid #fecaca',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      margin: '0 auto 16px'
    });
    iconWrap.innerHTML =
      '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/>' +
      '<line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

    const msgEl = document.createElement('div');
    msgEl.textContent = message;
    Object.assign(msgEl.style, {
      fontSize: '15px',
      fontWeight: '700',
      color: '#1f2937',
      lineHeight: '1.6',
      marginBottom: details?.length ? '12px' : '20px'
    });
    card.append(iconWrap, msgEl);

    // 详情区（如被顶下线时的对方登录时间 / IP / 设备）
    if (details?.length) {
      const box = document.createElement('div');
      Object.assign(box.style, {
        background: '#f9fafb',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '10px 14px',
        marginBottom: '20px',
        textAlign: 'left'
      });
      details.forEach((line) => {
        const row = document.createElement('div');
        row.textContent = line;
        Object.assign(row.style, { fontSize: '12px', color: '#6b7280', lineHeight: '1.9' });
        box.appendChild(row);
      });
      card.appendChild(box);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '重新登录';
    Object.assign(btn.style, {
      width: '100%',
      padding: '10px 0',
      border: 'none',
      borderRadius: '8px',
      background: '#217346',
      color: '#ffffff',
      fontSize: '14px',
      fontWeight: '700',
      cursor: 'pointer'
    });
    btn.onmouseenter = () => { btn.style.background = '#1a5c38'; };
    btn.onmouseleave = () => { btn.style.background = '#217346'; };
    card.appendChild(btn);

    const hint = document.createElement('div');
    hint.textContent = `${SESSION_MODAL_COUNTDOWN} 秒后自动返回登录页`;
    Object.assign(hint.style, { fontSize: '12px', color: '#9ca3af', marginTop: '10px' });
    card.appendChild(hint);

    overlay.appendChild(card);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.appendChild(overlay);

    let settled = false;
    let timer: number | undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') finish();
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) window.clearInterval(timer);
      window.removeEventListener('keydown', onKey);
      overlay.remove();
      document.body.style.overflow = prevOverflow;
      resolve();
    };
    btn.addEventListener('click', finish);
    window.addEventListener('keydown', onKey);
    btn.focus();

    // 倒计时自动跳转：会话已失效，避免弹窗被忽略后长期停留在无效页面
    let remain = SESSION_MODAL_COUNTDOWN;
    timer = window.setInterval(() => {
      remain -= 1;
      if (remain <= 0) {
        finish();
      } else {
        hint.textContent = `${remain} 秒后自动返回登录页`;
      }
    }, 1000);
  });

/** 会话失效统一出口：弹出原因提示（防重复）并跳转登录页（携带回跳地址）。
 * 覆盖 Token 过期、被顶下线、账号禁用等所有「被登出」场景。
 * @param message 提示文案
 * @param beforeRedirect 跳转前的收尾动作（如调用 logout 通知后端吊销会话）
 * @param details 展示在详情区的补充信息（如对方登录时间 / IP / 设备）
 */
export const notifySessionExpired = async (
  message: string,
  beforeRedirect?: () => Promise<void> | void,
  details?: string[]
): Promise<void> => {
  if (sessionNoticeShown) return;
  sessionNoticeShown = true;
  await showSessionModal(message, details);
  if (beforeRedirect) {
    // 必须等收尾动作（登出吊销请求）发完再跳转，否则导航会中断该请求
    await Promise.resolve(beforeRedirect()).finally(() => {
      window.location.href = buildLoginUrl();
    });
  } else {
    window.location.href = buildLoginUrl();
  }
};
