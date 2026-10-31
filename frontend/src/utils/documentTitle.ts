/**
 * 浏览器标签页标题（document.title）
 *
 * 约定：
 * - 主页面（工作台 `/`）使用系统全称；
 * - 其余页面统一为 `OTM-<页面功能>`，便于在多个标签页中快速区分。
 */

export const BASE_TITLE = 'Obara Task Management';

/** 路径 → 页面功能名（不含 OTM- 前缀） */
export const PAGE_TITLES: Record<string, string> = {
  '/': BASE_TITLE,
  '/login': 'OTM-登录',
  '/change-password': 'OTM-修改密码',
  '/admin': 'OTM-用户管理中心',
  '/system-settings': 'OTM-系统设置',
  '/system-logs': 'OTM-操作日志',
  '/design-standards': 'OTM-设计规范知识库',
  '/gun-ledger': 'OTM-焊枪编号台账',
  '/leaderboard': 'OTM-任务报表',
  '/work-hours': 'OTM-工时管理',
  '/status-tracking': 'OTM-状态跟踪表',
};

/** 根据当前路径解析标题；未登记路径回落到主页面标题 */
export const getDocumentTitle = (pathname: string): string => {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return PAGE_TITLES[normalized] ?? BASE_TITLE;
};
