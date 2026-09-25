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
