const normalizeAuditPath = (routePath = '') => {
  return String(routePath)
    .split('?')[0]
    .replace(/^\/api\/?/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
};

const routeActionDisplays = {
  'POST auth/login': { label: '登录系统', description: '用户登录系统' },
  'POST auth/logout': { label: '退出登录', description: '用户退出系统' },
  'POST auth/change-password': { label: '修改密码', description: '用户修改登录密码' },
  'POST change-password': { label: '修改密码', description: '用户修改登录密码' },

  'GET ': { label: '查看任务', description: '查看任务列表' },
  'GET users': { label: '查看用户', description: '查看用户列表或用户详情' },
  'POST users': { label: '创建用户', description: '新增系统用户账号' },
  'PUT users': { label: '更新用户', description: '修改用户账号信息' },
  'DELETE users': { label: '删除用户', description: '删除系统用户账号' },

  'GET designers': { label: '查看设计员', description: '查看设计员列表' },
  'GET designers/manage': { label: '管理设计员', description: '查看设计员管理列表' },
  'GET manage': { label: '管理设计员', description: '查看设计员管理列表' },
  'POST designers': { label: '添加设计员', description: '新增设计员信息' },
  'PUT designers': { label: '更新设计员', description: '修改设计员信息' },
  'DELETE designers': { label: '删除设计员', description: '删除设计员信息' },

  'GET tasks': { label: '查看任务', description: '查看任务列表' },
  'POST tasks/item': { label: '添加任务', description: '新增任务记录' },
  'POST item': { label: '添加任务', description: '新增任务记录' },
  'POST tasks/item/batch': { label: '批量添加任务', description: '批量新增任务记录' },
  'POST item/batch': { label: '批量添加任务', description: '批量新增任务记录' },
  'POST tasks/batch-replace/search': { label: '查询批量替换', description: '查询任务批量替换匹配项' },
  'POST batch-replace/search': { label: '查询批量替换', description: '查询任务批量替换匹配项' },
  'POST tasks/batch-replace': { label: '批量替换任务', description: '批量替换任务内容或枪名' },
  'POST batch-replace': { label: '批量替换任务', description: '批量替换任务内容或枪名' },
  'POST tasks': { label: '添加任务', description: '新增任务记录' },
  'PUT tasks/item': { label: '更新任务', description: '修改任务内容或工时' },
  'PUT item': { label: '更新任务', description: '修改任务内容或工时' },
  'PUT tasks': { label: '更新任务', description: '修改任务内容或工时' },
  'DELETE tasks/item': { label: '删除任务', description: '删除任务记录' },
  'DELETE item': { label: '删除任务', description: '删除任务记录' },
  'DELETE tasks': { label: '删除任务', description: '删除任务记录' },

  'GET settings': { label: '查看设置', description: '查看系统设置' },
  'GET settings/leaderboard': { label: '查看排行榜设置', description: '查看工时排行访问设置' },
  'PUT settings/leaderboard': { label: '更新排行榜设置', description: '修改工时排行访问设置' },
  'PUT leaderboard': { label: '更新排行榜设置', description: '修改工时排行访问设置' },
  'GET settings/work-hours': { label: '查看工时设置', description: '查看工时管理访问设置' },
  'PUT settings/work-hours': { label: '更新工时设置', description: '修改工时管理访问设置' },
  'PUT work-hours': { label: '更新工时设置', description: '修改工时管理访问设置' },
  'GET settings/status-tracking': { label: '查看状态跟踪设置', description: '查看状态跟踪访问设置' },
  'PUT settings/status-tracking': { label: '更新状态跟踪设置', description: '修改状态跟踪访问设置' },
  'PUT status-tracking': { label: '更新状态跟踪设置', description: '修改状态跟踪访问设置' },
  'GET settings/system-settings': { label: '查看系统设置权限', description: '查看系统设置页面访问权限' },
  'PUT settings/system-settings': { label: '更新系统设置权限', description: '修改系统设置页面访问权限' },
  'PUT system-settings': { label: '更新系统设置权限', description: '修改系统设置页面访问权限' },
  'PUT settings': { label: '更新设置', description: '修改系统设置' },
  'GET system/settings': { label: '查看系统设置', description: '查看系统级配置' },
  'PUT system/settings': { label: '更新系统设置', description: '修改系统级配置' },
  'GET system/version': { label: '查看版本', description: '查看系统版本信息' },
  'GET system/export-xls': { label: '导出任务数据', description: '导出任务表格数据' },
  'GET export': { label: '导出任务数据', description: '导出任务表格数据' },
  'POST system/import-xls': { label: '导入任务数据', description: '导入任务表格数据' },

  'GET system/audit-logs': { label: '查看日志', description: '查看系统操作日志' },
  'GET audit-logs': { label: '查看日志', description: '查看系统操作日志' },
  'GET system/audit-logs/filter-options': { label: '筛选日志', description: '获取日志筛选选项' },
  'GET audit-logs/filter-options': { label: '筛选日志', description: '获取日志筛选选项' },
  'GET system/audit-logs/export': { label: '导出日志', description: '导出系统操作日志' },
  'GET audit-logs/export': { label: '导出日志', description: '导出系统操作日志' },
  'GET system/login-logs': { label: '查看登录日志', description: '查看用户登录日志' },
  'GET system/admin-login-logs': { label: '查看管理员登录记录', description: '查看管理员最近登录记录' },
  'GET admin-login-logs': { label: '查看管理员登录记录', description: '查看管理员最近登录记录' },

  'GET status-tracking/items': { label: '查看状态跟踪', description: '查看状态跟踪数据' },
  'GET items': { label: '查看状态跟踪', description: '查看状态跟踪数据' },
  'POST status-tracking/items': { label: '添加状态跟踪', description: '新增状态跟踪记录' },
  'POST items': { label: '添加状态跟踪', description: '新增状态跟踪记录' },
  'POST status-tracking/items/bulk': { label: '批量导入状态跟踪', description: '批量新增或更新状态跟踪记录' },
  'POST items/bulk': { label: '批量导入状态跟踪', description: '批量新增或更新状态跟踪记录' },
  'PUT status-tracking/items': { label: '更新状态跟踪', description: '修改状态跟踪记录' },
  'PUT items': { label: '更新状态跟踪', description: '修改状态跟踪记录' },
  'DELETE status-tracking/items': { label: '删除状态跟踪', description: '删除状态跟踪记录' },
  'DELETE items': { label: '删除状态跟踪', description: '删除状态跟踪记录' },
  'GET status-tracking/export': { label: '导出状态跟踪表', description: '导出状态跟踪表格' },
  'POST status-tracking/import': { label: '导入状态跟踪表', description: '导入状态跟踪表格' },

  'GET work-hours/export': { label: '导出工时管理表', description: '导出工时统计表格' },
  'GET spec/spec-info': { label: '查询仕样信息', description: '查询产品仕样信息' },
  'POST spec/spec-info': { label: '查询仕样信息', description: '查询产品仕样信息' },
  'POST spec-info': { label: '查询仕样信息', description: '查询产品仕样信息' },
  'POST designers/reorder': { label: '重新排序设计员', description: '重新排序设计员列表' },
  'POST reorder': { label: '重新排序设计员', description: '重新排序设计员列表' },
  'POST tasks/move': { label: '移动任务', description: '移动任务到其他位置' },
  'POST move': { label: '移动任务', description: '移动任务到其他位置' },
  'POST spec/delivery-date': { label: '查询交期', description: '查询产品交期信息' },
  'POST delivery-date': { label: '查询交期', description: '查询产品交期信息' },
  'POST spec/spec-raw-text': { label: '查询仕样原文', description: '查询产品仕样原始文本' },
  'POST spec-raw-text': { label: '查询仕样原文', description: '查询产品仕样原始文本' },
  'POST designers/batch-delete': { label: '批量删除设计员', description: '批量删除设计员信息' },
  'POST users/batch-delete': { label: '批量删除用户', description: '批量删除用户账号' },
  'POST batch-delete': { label: '批量删除', description: '批量删除记录' },
  'POST tasks/sync': { label: '同步任务', description: '同步任务数据' },
  'POST status-tracking/sync': { label: '同步状态跟踪', description: '同步状态跟踪数据' },
  'POST sync': { label: '同步数据', description: '同步数据到服务器' },
  'POST status-tracking/import/check': { label: '检查导入文件', description: '检查状态跟踪导入文件' },
  'POST import/check': { label: '检查导入文件', description: '检查导入文件格式' },
  'POST import': { label: '导入数据', description: '导入数据表格' },
  'GET auth/validate': { label: '验证登录', description: '验证用户登录状态' },
  'GET validate': { label: '验证登录', description: '验证用户登录状态' },
  'GET settings/leader-rules': { label: '查看组长规则', description: '查看组长分配规则配置' },
  'GET leader-rules': { label: '查看组长规则', description: '查看组长分配规则配置' },
  'PUT settings/leader-rules': { label: '更新组长规则', description: '修改组长分配规则配置' },
  'PUT leader-rules': { label: '更新组长规则', description: '修改组长分配规则配置' },
  'POST ': { label: '添加记录', description: '新增数据记录' }
};

const resourceActionDisplays = {
  users: routeActionDisplays,
  designers: routeActionDisplays,
  tasks: routeActionDisplays,
  settings: routeActionDisplays
};

const legacyActionDescriptions = {
  登录系统: '用户登录系统',
  用户登录: '用户登录系统',
  退出登录: '用户退出系统',
  用户退出: '用户退出系统',
  修改密码: '用户修改登录密码',
  'change-password': '用户修改登录密码',
  'auth/change-password': '用户修改登录密码',
  创建用户: '新增系统用户账号',
  更新用户: '修改用户账号信息',
  删除用户: '删除系统用户账号',
  查看用户: '查看用户列表或用户详情',
  添加设计员: '新增设计员信息',
  更新设计员: '修改设计员信息',
  删除设计员: '删除设计员信息',
  查看设计员: '查看设计员列表',
  管理设计员: '查看设计员管理列表',
  重新排序设计员: '重新排序设计员列表',
  添加任务: '新增任务记录',
  更新任务: '修改任务内容或工时',
  删除任务: '删除任务记录',
  查看任务: '查看任务列表',
  批量添加任务: '批量新增任务记录',
  查询批量替换: '查询任务批量替换匹配项',
  批量替换任务: '批量替换任务内容或枪名',
  移动任务: '移动任务到其他位置',
  更新设置: '修改系统设置',
  查看设置: '查看系统设置',
  查看排行榜设置: '查看工时排行访问设置',
  更新排行榜设置: '修改工时排行访问设置',
  查看工时设置: '查看工时管理访问设置',
  更新工时设置: '修改工时管理访问设置',
  查看状态跟踪设置: '查看状态跟踪访问设置',
  更新状态跟踪设置: '修改状态跟踪访问设置',
  查看系统设置权限: '查看系统设置页面访问权限',
  更新系统设置权限: '修改系统设置页面访问权限',
  更新系统设置: '修改系统级配置',
  查看系统设置: '查看系统级配置',
  导出任务数据: '导出任务表格数据',
  导入任务数据: '导入任务表格数据',
  添加状态跟踪: '新增状态跟踪记录',
  更新状态跟踪: '修改状态跟踪记录',
  删除状态跟踪: '删除状态跟踪记录',
  查看状态跟踪: '查看状态跟踪数据',
  批量导入状态跟踪: '批量新增或更新状态跟踪记录',
  导出状态跟踪表: '导出状态跟踪表格',
  导入状态跟踪表: '导入状态跟踪表格',
  导出工时管理表: '导出工时统计表格',
  查询仕样信息: '查询产品仕样信息',
  查看日志: '查看系统操作日志',
  筛选日志: '获取日志筛选选项',
  导出日志: '导出系统操作日志',
  查看登录日志: '查看用户登录日志',
  查看管理员登录记录: '查看管理员最近登录记录',
  查看版本: '查看系统版本信息',
  reorder: '重新排序设计员列表',
  move: '移动任务到其他位置',
  '查询交期': '查询产品交期信息',
  '查询仕样原文': '查询产品仕样原始文本',
  '批量删除': '批量删除记录',
  '批量删除设计员': '批量删除设计员信息',
  '批量删除用户': '批量删除用户账号',
  '同步数据': '同步数据到服务器',
  '同步状态跟踪': '同步状态跟踪数据',
  '检查导入文件': '检查导入文件格式',
  '导入数据': '导入数据表格',
  '验证登录': '验证用户登录状态',
  '查看组长规则': '查看组长分配规则配置',
  '更新组长规则': '修改组长分配规则配置',
  '添加记录': '新增数据记录'
};

const getBrowserInfo = (userAgent = '') => {
  const ua = String(userAgent);
  let browser = 'Unknown Browser';
  let browserVersion = '';
  let os = 'Unknown OS';
  let osVersion = '';

  const matchEdge = ua.match(/Edg\/(\d+)/i);
  const matchOpera = ua.match(/OPR\/(\d+)/i) || ua.match(/Opera\/(\d+)/i);
  const matchChrome = ua.match(/Chrome\/(\d+)/i);
  const matchFirefox = ua.match(/Firefox\/(\d+)/i);
  const matchSafari = ua.match(/Version\/(\d+)/i);
  const matchIE = ua.match(/MSIE (\d+)/i) || ua.match(/Trident\/.*rv:(\d+)/i);

  if (matchEdge) { browser = 'Microsoft Edge'; browserVersion = matchEdge[1]; }
  else if (matchOpera) { browser = 'Opera'; browserVersion = matchOpera[1]; }
  else if (matchChrome && !/Chromium/i.test(ua)) { browser = 'Chrome'; browserVersion = matchChrome[1]; }
  else if (matchFirefox) { browser = 'Firefox'; browserVersion = matchFirefox[1]; }
  else if (matchSafari && /Safari\//i.test(ua)) { browser = 'Safari'; browserVersion = matchSafari[1]; }
  else if (matchIE) { browser = 'Internet Explorer'; browserVersion = matchIE[1]; }

  if (/Windows NT 10\.0/i.test(ua)) { os = 'Windows 10'; osVersion = '10'; }
  else if (/Windows NT 11\.0/i.test(ua)) { os = 'Windows 11'; osVersion = '11'; }
  else if (/Windows NT 6\.3/i.test(ua)) { os = 'Windows 8.1'; osVersion = '8.1'; }
  else if (/Windows NT 6\.2/i.test(ua)) { os = 'Windows 8'; osVersion = '8'; }
  else if (/Windows NT 6\.1/i.test(ua)) { os = 'Windows 7'; osVersion = '7'; }
  else if (/Windows NT/i.test(ua)) { os = 'Windows'; }
  else if (/Android (\d+\.\d+)/i.test(ua)) { os = 'Android'; osVersion = ua.match(/Android (\d+\.\d+)/i)[1]; }
  else if (/iPhone OS (\d+_\d+)/i.test(ua)) { os = 'iOS'; osVersion = ua.match(/iPhone OS (\d+_\d+)/i)[1].replace('_', '.'); }
  else if (/iPad.*OS (\d+_\d+)/i.test(ua)) { os = 'iPadOS'; osVersion = ua.match(/iPad.*OS (\d+_\d+)/i)[1].replace('_', '.'); }
  else if (/Mac OS X (\d+_\d+)/i.test(ua)) { os = 'macOS'; osVersion = ua.match(/Mac OS X (\d+_\d+)/i)[1].replace('_', '.'); }
  else if (/Linux/i.test(ua)) { os = 'Linux'; }

  const device = /Mobile|Android|iPhone|iPad|iPod/i.test(ua) ? 'Mobile' : 'Desktop';

  const browserFull = browserVersion ? `${browser} ${browserVersion}` : browser;
  const osFull = osVersion ? `${os} ${osVersion}` : os;

  return { browser, browserVersion, os, osVersion, device, summary: `${browserFull} / ${osFull} / ${device}` };
};

const getRouteActionDisplay = (method = '', routePath = '') => {
  const normalizedPath = normalizeAuditPath(routePath);
  const normalizedMethod = String(method || '').toUpperCase();
  const key = `${normalizedMethod} ${normalizedPath}`;

  if (routeActionDisplays[key]) return routeActionDisplays[key];

  const pathParts = normalizedPath.split('/');
  if (pathParts.length > 1) {
    const collectionKey = `${normalizedMethod} ${pathParts.slice(0, -1).join('/')}`;
    if (routeActionDisplays[collectionKey]) return routeActionDisplays[collectionKey];
  }

  // Handle DELETE with numeric ID (e.g., /1782891992539)
  if (normalizedMethod === 'DELETE' && /^\d+$/.test(normalizedPath)) {
    return { label: '删除记录', description: '删除数据记录' };
  }

  const firstPathPart = normalizedPath.split('/')[0];
  const resourceKey = `${normalizedMethod} ${firstPathPart}`;
  if (resourceActionDisplays[firstPathPart]?.[resourceKey]) {
    return resourceActionDisplays[firstPathPart][resourceKey];
  }

  return null;
};

const getAuditActionDisplay = (log = {}) => {
  const routeDisplay = getRouteActionDisplay(log.method, log.path);
  if (routeDisplay) return routeDisplay;

  const action = String(log.action || '').trim();
  const actionRouteMatch = action.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(.+)$/i);
  if (actionRouteMatch) {
    const actionRouteDisplay = getRouteActionDisplay(actionRouteMatch[1], actionRouteMatch[2]);
    if (actionRouteDisplay) return actionRouteDisplay;
  }

  if (action) {
    return {
      label: action,
      description: legacyActionDescriptions[action] || action
    };
  }

  return {
    label: log.method && log.path ? `${log.method} ${log.path}` : '未知操作',
    description: '未识别的操作记录'
  };
};

const getBrowserLabel = (log = {}) => {
  if (log.browserInfo?.summary) return log.browserInfo.summary;
  if (log.browserInfo?.browser || log.browserInfo?.os || log.browserInfo?.device) {
    return [log.browserInfo.browser, log.browserInfo.os, log.browserInfo.device].filter(Boolean).join(' / ');
  }
  if (log.userAgent) return getBrowserInfo(log.userAgent).summary;
  return '-';
};

module.exports = {
  getAuditActionDisplay,
  getBrowserInfo,
  getBrowserLabel,
  getRouteActionDisplay
};
