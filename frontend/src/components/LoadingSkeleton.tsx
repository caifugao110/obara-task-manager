import type { ComponentType } from 'react';
import { DashboardSkeleton } from './skeletons/dashboard';
import { LeaderboardSkeleton } from './skeletons/leaderboard';
import { WorkHoursSkeleton } from './skeletons/workHours';
import { StatusTrackingSkeleton } from './skeletons/statusTracking';
import { DesignStandardsSkeleton } from './skeletons/designStandards';
import { GunLedgerSkeleton } from './skeletons/gunLedger';
import { SystemSettingsSkeleton } from './skeletons/systemSettings';

/**
 * 各页面的加载骨架屏 —— 版式对齐真实页面，避免加载完成时布局跳变。
 *
 * 实现按页面拆在 ./skeletons/ 下（每个页面一个文件，公共块在 primitives.tsx），
 * 这里只保留「页面 → 骨架组件」的映射与类型定义；要改某个页面的骨架，去对应文件。
 *
 * 拆分理由：原文件 1671 行、7 个页面的版式混在一处，改一处要翻整份文件确认
 * 有没有同名的基础块被别的页面共用（Bar / PageHeader 这类）。
 */
export type SkeletonKind =
  | 'dashboard'
  | 'leaderboard'
  | 'workhours'
  | 'statustracking'
  | 'designstandards'
  | 'gunledger'
  | 'systemsettings';

export const SKELETONS: Record<SkeletonKind, ComponentType> = {
  dashboard: DashboardSkeleton,
  leaderboard: LeaderboardSkeleton,
  workhours: WorkHoursSkeleton,
  statustracking: StatusTrackingSkeleton,
  designstandards: DesignStandardsSkeleton,
  gunledger: GunLedgerSkeleton,
  systemsettings: SystemSettingsSkeleton,
};

export {
  DashboardSkeleton,
  LeaderboardSkeleton,
  WorkHoursSkeleton,
  StatusTrackingSkeleton,
  DesignStandardsSkeleton,
  GunLedgerSkeleton,
  SystemSettingsSkeleton,
};

export default DashboardSkeleton;
