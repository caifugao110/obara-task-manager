/**
 * 主页面工时表的离线缓存（localStorage）。
 *
 * 原先这个 key 直接写在 Dashboard 内部。数据管理里的「清理任务数据」必须能同步
 * 作废这份缓存：否则清理完成后，只要页面处于离线锁定或接口偶发失败，Dashboard
 * 就会拿缓存把「已经被清掉」的任务重新渲染出来，看起来像没清干净。
 */
export const OFFLINE_SHEETS_CACHE_KEY = 'obara_offline_sheets_cache';

export const clearOfflineSheetsCache = () => {
  try {
    localStorage.removeItem(OFFLINE_SHEETS_CACHE_KEY);
  } catch {
    // 隐私模式 / 存储被禁用时 localStorage 可能不可写，忽略即可
  }
};
