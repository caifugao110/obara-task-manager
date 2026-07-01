export interface BrowserInfo {
  browser?: string;
  os?: string;
  device?: string;
  summary?: string;
}

export interface LoginLog {
  id: string;
  userId?: string;
  username: string;
  name?: string;
  role?: string;
  ip?: string;
  userAgent?: string;
  browserInfo?: BrowserInfo;
  success: boolean;
  action?: string;
  reason?: string;
  timestamp: string;
}

export const getActionLabel = (log: LoginLog) => {
  if (!log.success) return log.reason || '登录失败';
  if (log.action === 'forced_previous_logout') return '登录（踢出其他设备）';
  return '登录成功';
};

export const getRoleLabel = (role?: string) => {
  if (role === 'superadmin') return '超级管理员';
  if (role === 'admin') return '管理员';
  if (role === 'user') return '普通用户';
  return '未知角色';
};

export const getBrowserLabel = (log: LoginLog) => {
  if (log.browserInfo?.summary) return log.browserInfo.summary;
  if (log.browserInfo?.browser || log.browserInfo?.os || log.browserInfo?.device) {
    return [log.browserInfo.browser, log.browserInfo.os, log.browserInfo.device].filter(Boolean).join(' / ');
  }
  return log.userAgent || '-';
};

export const getRoleClassName = (role?: string) => {
  if (role === 'superadmin') return 'bg-purple-100 text-purple-700';
  if (role === 'admin') return 'bg-blue-100 text-blue-700';
  return 'bg-emerald-100 text-emerald-700';
};
