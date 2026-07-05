export interface BrowserInfo {
  browser?: string;
  os?: string;
  device?: string;
  summary?: string;
}

export interface LogWithBrowser {
  userAgent?: string;
  browserInfo?: BrowserInfo;
}

export interface LoginLog extends LogWithBrowser {
  id: string;
  userId?: string;
  username: string;
  name?: string;
  role?: string;
  ip?: string;
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

const parseBrowserInfo = (userAgent = ''): BrowserInfo => {
  const ua = String(userAgent);
  let browser = 'Unknown Browser';
  let os = 'Unknown OS';

  if (/Edg\//i.test(ua)) browser = 'Microsoft Edge';
  else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) browser = 'Opera';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && /Version\//i.test(ua)) browser = 'Safari';
  else if (/MSIE|Trident/i.test(ua)) browser = 'Internet Explorer';

  if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  const device = /Mobile|Android|iPhone|iPad|iPod/i.test(ua) ? 'Mobile' : 'Desktop';

  return { browser, os, device, summary: `${browser} / ${os} / ${device}` };
};

export const getBrowserLabel = (log: LogWithBrowser) => {
  if (log.browserInfo?.summary) return log.browserInfo.summary;
  if (log.browserInfo?.browser || log.browserInfo?.os || log.browserInfo?.device) {
    return [log.browserInfo.browser, log.browserInfo.os, log.browserInfo.device].filter(Boolean).join(' / ');
  }
  if (log.userAgent) return parseBrowserInfo(log.userAgent).summary;
  return '-';
};

export const getRoleClassName = (role?: string) => {
  if (role === 'superadmin') return 'bg-purple-100 text-purple-700';
  if (role === 'admin') return 'bg-blue-100 text-blue-700';
  return 'bg-emerald-100 text-emerald-700';
};

interface ActionLog {
  action?: string;
  method?: string;
  path?: string;
}

const normalizeAuditPath = (path = '') => {
  return path
    .split('?')[0]
    .replace(/^\/api\/?/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
};

const routeActionDescriptions: Record<string, { label: string; description: string }> = {
  'POST auth/login': { label: '登录系统', description: '用户登录系统' },
  'POST auth/logout': { label: '退出登录', description: '用户退出系统' },
  'POST auth/change-password': { label: '修改密码', description: '用户修改登录密码' },
  'GET users': { label: '查看用户', description: '查看用户列表或用户详情' },
  'POST users': { label: '创建用户', description: '新增系统用户账号' },
  'PUT users': { label: '更新用户', description: '修改用户账号信息' },
  'DELETE users': { label: '删除用户', description: '删除系统用户账号' },
  'GET designers': { label: '查看设计员', description: '查看设计员列表' },
  'POST designers': { label: '添加设计员', description: '新增设计员信息' },
  'PUT designers': { label: '更新设计员', description: '修改设计员信息' },
  'DELETE designers': { label: '删除设计员', description: '删除设计员信息' },
  'GET tasks': { label: '查看任务', description: '查看任务列表' },
  'POST tasks': { label: '添加任务', description: '新增任务记录' },
  'PUT tasks': { label: '更新任务', description: '修改任务内容或工时' },
  'DELETE tasks': { label: '删除任务', description: '删除任务记录' },
  'GET settings': { label: '查看设置', description: '查看系统设置' },
  'PUT settings': { label: '更新设置', description: '修改系统设置' },
  'GET system/settings': { label: '查看系统设置', description: '查看系统级配置' },
  'PUT system/settings': { label: '更新系统设置', description: '修改系统级配置' },
  'GET system/version': { label: '查看版本', description: '查看系统版本信息' },
  'GET system/export-xls': { label: '导出任务数据', description: '导出任务表格数据' },
  'POST system/import-xls': { label: '导入任务数据', description: '导入任务表格数据' },
  'GET system/audit-logs': { label: '查看日志', description: '查看系统操作日志' },
  'GET audit-logs': { label: '查看日志', description: '查看系统操作日志' },
  'GET system/audit-logs/filter-options': { label: '筛选日志', description: '获取日志筛选选项' },
  'GET audit-logs/filter-options': { label: '筛选日志', description: '获取日志筛选选项' },
  'GET system/audit-logs/export': { label: '导出日志', description: '导出系统操作日志' },
  'GET audit-logs/export': { label: '导出日志', description: '导出系统操作日志' },
  'GET system/login-logs': { label: '查看登录日志', description: '查看用户登录日志' },
  'GET system/admin-login-logs': { label: '查看管理员登录记录', description: '查看管理员最近登录记录' },
  'GET status-tracking/items': { label: '查看状态跟踪', description: '查看状态跟踪数据' },
  'POST status-tracking/items': { label: '添加状态跟踪', description: '新增状态跟踪记录' },
  'PUT status-tracking/items': { label: '更新状态跟踪', description: '修改状态跟踪记录' },
  'DELETE status-tracking/items': { label: '删除状态跟踪', description: '删除状态跟踪记录' },
  'GET status-tracking/export': { label: '导出状态跟踪表', description: '导出状态跟踪表格' },
  'POST status-tracking/import': { label: '导入状态跟踪表', description: '导入状态跟踪表格' },
  'GET work-hours/export': { label: '导出工时管理表', description: '导出工时统计表格' },
  'GET spec/spec-info': { label: '查询仕样信息', description: '查询产品仕样信息' }
};

const getRouteActionLabel = (method?: string, path?: string) => {
  const normalizedMethod = String(method || '').toUpperCase();
  const normalizedPath = normalizeAuditPath(path || '');
  const exact = routeActionDescriptions[`${normalizedMethod} ${normalizedPath}`];
  if (exact) return exact;

  const firstPathPart = normalizedPath.split('/')[0];
  return routeActionDescriptions[`${normalizedMethod} ${firstPathPart}`];
};

export const getActionTypeLabel = (actionOrLog: string | ActionLog) => {
  const log = typeof actionOrLog === 'string' ? { action: actionOrLog } : actionOrLog;
  const action = log.action || '';
  const routeLabel = getRouteActionLabel(log.method, log.path);
  if (routeLabel) return routeLabel;

  const actionRouteMatch = action.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(.+)$/i);
  if (actionRouteMatch) {
    const actionRouteLabel = getRouteActionLabel(actionRouteMatch[1], actionRouteMatch[2]);
    if (actionRouteLabel) return actionRouteLabel;
  }

  const actionDescriptions: Record<string, { label: string; description: string }> = {
    '用户登录': { label: '用户登录', description: '用户通过账号密码登录系统' },
    '用户退出': { label: '用户退出', description: '用户主动退出登录' },
    '修改密码': { label: '修改密码', description: '用户修改个人登录密码' },
    '创建用户': { label: '创建用户', description: '新增系统用户账号' },
    '更新用户': { label: '更新用户', description: '修改已有用户信息' },
    '删除用户': { label: '删除用户', description: '删除系统用户账号' },
    '查看用户': { label: '查看用户', description: '查看用户列表或详情' },
    '添加设计员': { label: '添加设计员', description: '新增设计员信息' },
    '更新设计员': { label: '更新设计员', description: '修改设计员信息' },
    '删除设计员': { label: '删除设计员', description: '删除设计员' },
    '查看设计员': { label: '查看设计员', description: '查看设计员列表' },
    '添加任务': { label: '添加任务', description: '新增任务记录' },
    '更新任务': { label: '更新任务', description: '修改任务信息' },
    '删除任务': { label: '删除任务', description: '删除任务记录' },
    '查看任务': { label: '查看任务', description: '查看任务列表' },
    '更新设置': { label: '更新设置', description: '修改系统设置' },
    '查看设置': { label: '查看设置', description: '查看系统设置' },
    '更新系统设置': { label: '更新系统设置', description: '修改系统级配置' },
    '查看系统设置': { label: '查看系统设置', description: '查看系统级配置' },
    '导出任务数据': { label: '导出任务数据', description: '导出任务表格数据' },
    '导入任务数据': { label: '导入任务数据', description: '导入任务表格数据' },
    '添加状态跟踪记录': { label: '添加状态跟踪记录', description: '新增状态跟踪数据' },
    '更新状态跟踪记录': { label: '更新状态跟踪记录', description: '修改状态跟踪数据' },
    '删除状态跟踪记录': { label: '删除状态跟踪记录', description: '删除状态跟踪数据' },
    '查看状态跟踪记录': { label: '查看状态跟踪记录', description: '查看状态跟踪数据' },
    '导出状态跟踪表': { label: '导出状态跟踪表', description: '导出状态跟踪表格' },
    '导入状态跟踪表': { label: '导入状态跟踪表', description: '导入状态跟踪表格' },
    '导出工时管理表': { label: '导出工时管理表', description: '导出工时统计表格' },
    '查询仕样信息': { label: '查询仕样信息', description: '查询产品仕样信息' },
    '查看日志': { label: '查看日志', description: '查看系统操作日志列表' },
    '筛选日志': { label: '筛选日志', description: '获取日志筛选选项' },
    '导出日志': { label: '导出日志', description: '导出系统操作日志' },
    '查看版本': { label: '查看版本', description: '查看系统版本信息' }
  };
  return actionDescriptions[action] || { label: action.replace(/^GET\s+\/|^POST\s+\/|^PUT\s+\/|^DELETE\s+\/|^PATCH\s+\/|^GET\s|^POST\s|^PUT\s|^DELETE\s|^PATCH\s/g, ''), description: action };
};
