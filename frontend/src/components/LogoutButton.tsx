import React from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/**
 * 全站统一的「退出」按钮。
 *
 * 为什么抽成组件：登录后各页面（主页面 / 用户管理 / 任务报表 / 工时管理 /
 * 状态跟踪表 / 焊机台账 / 系统设置 / 设计规范）各写一份外观相同的按钮，
 * 之前的离线改造就漏掉了所有页头里的退出入口（页头不在 `.offline-locked` 容器内）。
 * 收在一处后，离线规则只有一个实现，后续新增页面也不会再漏。
 *
 * 离线时禁用的原因：退出会先调 `/api/auth/logout` 吊销会话，然后跳登录页；
 * 离线时后端不可达，跳过去也登录不回来，用户会被卡在登录页。
 * 因此离线期间保持会话、等网络恢复后再退出（本地状态不会被清掉）。
 */
export interface LogoutButtonProps {
  /** 当前是否处于离线模式（各页面的离线判定口径不同，由调用方传入） */
  offline: boolean;
  /**
   * 外观变体：
   * - light：白底页头（蓝灰文字，hover 变红）
   * - onDark：深色/品牌色页头（白色文字，hover 变浅红）
   * - icon：只有图标（主页面右上角）
   */
  variant?: 'light' | 'onDark' | 'icon';
  /** 图标尺寸，默认 18（icon 变体默认 20，与主页面其它图标按钮一致） */
  iconSize?: number;
}

const BASE_CLASS: Record<NonNullable<LogoutButtonProps['variant']>, string> = {
  light: 'flex items-center space-x-1.5 text-sm font-semibold transition',
  onDark: 'flex items-center space-x-1.5 text-sm font-semibold transition',
  icon: 'rounded transition',
};

const ONLINE_CLASS: Record<NonNullable<LogoutButtonProps['variant']>, string> = {
  light: 'text-gray-600 hover:text-red-600',
  onDark: 'text-white hover:text-red-300',
  icon: 'p-1.5 hover:bg-red-600',
};

// 离线：灰化 + 禁止光标；不依赖 hover，避免看起来还能点
const OFFLINE_CLASS: Record<NonNullable<LogoutButtonProps['variant']>, string> = {
  light: 'text-gray-400 opacity-50 cursor-not-allowed',
  onDark: 'text-white/60 cursor-not-allowed',
  icon: 'p-1.5 text-white/50 cursor-not-allowed',
};

const OFFLINE_TITLE = '当前离线，无法退出登录（请先恢复网络连接）';

const LogoutButton: React.FC<LogoutButtonProps> = ({
  offline,
  variant = 'light',
  iconSize,
}) => {
  const { logout } = useAuth();
  const size = iconSize ?? (variant === 'icon' ? 20 : 18);

  return (
    <button
      type="button"
      onClick={logout}
      // disabled 已经在浏览器层面拦掉点击，onClick 留作可读语义
      disabled={offline}
      title={offline ? OFFLINE_TITLE : '退出登录'}
      aria-label="退出登录"
      className={`${BASE_CLASS[variant]} ${offline ? OFFLINE_CLASS[variant] : ONLINE_CLASS[variant]}`}
    >
      <LogOut size={size} />
      {variant !== 'icon' && <span>退出</span>}
    </button>
  );
};

export default LogoutButton;
