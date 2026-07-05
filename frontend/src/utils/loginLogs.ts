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

export const getBrowserLabel = (log: LogWithBrowser) => {
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

export const getActionTypeLabel = (action: string) => {
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
