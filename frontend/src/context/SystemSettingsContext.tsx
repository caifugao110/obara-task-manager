import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { axiosInstance } from '../services/api';
import {
  BUILTIN_TABLE_GUN_HOURS,
  TableGunHoursMap,
  GunHoursCell,
  ExtraTaskHours,
  DEFAULT_EXTRA_TASK_HOURS,
} from '../utils/gunHoursRules';
import {
  DEFAULT_TASK_COLOR_CONFIG,
  mergeTaskColorConfig,
} from '../utils/taskColors';
import type { TaskColorConfig } from '../utils/taskColors';

export interface GunHoursByType {
  C: number;
  X: number;
}

export interface DefaultGunHours {
  confirm: GunHoursByType;
  design: GunHoursByType;
  confirmModify: GunHoursByType;
}

export interface SystemSettingsData {
  allowMultiDevice: boolean;
  allowUserDesignPlanColorMark: boolean;
  allowUserEditOwnTaskColor: boolean;
  allowUserChangePassword: boolean;
  specNumberDigits: number;
  // 操作日志保留条数（超限自动清理最旧记录）
  auditLogMaxRows: number;
  // 任务内容 → 单元格配色体系（系统设置可配置，默认见 DEFAULT_TASK_COLOR_CONFIG）
  taskColorConfig: TaskColorConfig;
  defaultGunHours?: DefaultGunHours;
  // 分类 → 表名 → 专用工时（内置值 + 超管覆盖值的合并结果）
  tableGunHours?: TableGunHoursMap;
  // 设计变更 / 既制审图 的固定工时（不区分 C/X、不套用任何专用规则）
  extraTaskHours?: ExtraTaskHours;
}

const defaultGunHours: DefaultGunHours = {
  confirm: { C: 1.5, X: 2 },
  design: { C: 2.5, X: 3 },
  confirmModify: { C: 0.5, X: 0.75 }
};

const defaultSettings: SystemSettingsData = {
  allowMultiDevice: true,
  allowUserDesignPlanColorMark: true,
  allowUserEditOwnTaskColor: true,
  allowUserChangePassword: false,
  specNumberDigits: 5,
  auditLogMaxRows: 5000,
  taskColorConfig: DEFAULT_TASK_COLOR_CONFIG,
  defaultGunHours,
  tableGunHours: BUILTIN_TABLE_GUN_HOURS,
  extraTaskHours: DEFAULT_EXTRA_TASK_HOURS
};

// 固定工时归一化：非法/缺失时回退默认值（设计变更 1.5h / 既制审图 0.5h）
const normalizeExtraTaskHours = (raw: unknown): ExtraTaskHours => {
  const source = raw && typeof raw === 'object' ? (raw as Partial<ExtraTaskHours>) : {};
  const pick = (key: keyof ExtraTaskHours) => {
    const value = source[key];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 24
      ? value
      : DEFAULT_EXTRA_TASK_HOURS[key];
  };
  return { designChange: pick('designChange'), drawingReview: pick('drawingReview') };
};

// 专用工时归一化：以内置值为底，覆盖服务端返回值；非法/缺失单元格回退内置值
const normalizeTableGunHours = (raw: unknown): TableGunHoursMap => {
  const source = raw && typeof raw === 'object' ? (raw as TableGunHoursMap) : {};
  const result: TableGunHoursMap = {};
  const categories = new Set([...Object.keys(BUILTIN_TABLE_GUN_HOURS), ...Object.keys(source)]);
  categories.forEach(category => {
    const builtinTables = BUILTIN_TABLE_GUN_HOURS[category] || {};
    const rawTables = source[category] || {};
    const tableNames = new Set([...Object.keys(builtinTables), ...Object.keys(rawTables)]);
    const categoryMap: Record<string, GunHoursCell> = {};
    tableNames.forEach(tableName => {
      const rawCell = rawTables[tableName];
      const isValid = rawCell
        && typeof rawCell.confirm === 'number' && Number.isFinite(rawCell.confirm)
        && typeof rawCell.confirmModify === 'number' && Number.isFinite(rawCell.confirmModify)
        && typeof rawCell.design === 'number' && Number.isFinite(rawCell.design);
      if (isValid) {
        categoryMap[tableName] = { ...rawCell };
      } else if (builtinTables[tableName]) {
        categoryMap[tableName] = { ...builtinTables[tableName] };
      }
    });
    if (Object.keys(categoryMap).length > 0) result[category] = categoryMap;
  });
  return result;
};

interface SystemSettingsContextValue {
  settings: SystemSettingsData;
  specNumberDigits: number;
  loading: boolean;
  refreshSettings: () => Promise<void>;
  setSettings: React.Dispatch<React.SetStateAction<SystemSettingsData>>;
}

const SystemSettingsContext = createContext<SystemSettingsContextValue>({
  settings: defaultSettings,
  specNumberDigits: 5,
  loading: true,
  refreshSettings: async () => {},
  setSettings: () => {},
});

export const useSystemSettings = () => useContext(SystemSettingsContext);

export const SystemSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<SystemSettingsData>(defaultSettings);
  const [loading, setLoading] = useState(true);

  const refreshSettings = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/system/settings');
      const allowOwnDesignPlanColor =
        res.data.allowUserDesignPlanColorMark ?? res.data.allowUserEditOwnTaskColor ?? true;
      const digits = res.data.specNumberDigits === 6 ? 6 : 5;
      const rows = Number(res.data.auditLogMaxRows);
      const auditLogMaxRows = Number.isInteger(rows) && rows >= 100 && rows <= 100000 ? rows : 5000;
      const rawGunHours = res.data.defaultGunHours && typeof res.data.defaultGunHours === 'object'
        ? res.data.defaultGunHours
        : {};
      const mergeGunType = (key: 'confirm' | 'design' | 'confirmModify'): GunHoursByType => ({
        C: typeof rawGunHours[key]?.C === 'number' ? rawGunHours[key].C : defaultGunHours[key].C,
        X: typeof rawGunHours[key]?.X === 'number' ? rawGunHours[key].X : defaultGunHours[key].X
      });
      setSettings({
        ...defaultSettings,
        ...res.data,
        allowUserDesignPlanColorMark: allowOwnDesignPlanColor,
        allowUserEditOwnTaskColor: allowOwnDesignPlanColor,
        specNumberDigits: digits,
        auditLogMaxRows,
        defaultGunHours: {
          confirm: mergeGunType('confirm'),
          design: mergeGunType('design'),
          confirmModify: mergeGunType('confirmModify')
        },
        tableGunHours: normalizeTableGunHours(res.data.tableGunHours),
        extraTaskHours: normalizeExtraTaskHours(res.data.extraTaskHours),
        taskColorConfig: mergeTaskColorConfig(res.data.taskColorConfig),
      });
    } catch {
      // 静默失败，保留默认值
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  // 系统设置（含任务内容配色）可能在其他标签页/其他窗口被修改：
  // 页面重新获得焦点或从后台切回时静默重新拉取，保证主页面新增/编辑任务用的是最新配色。
  // 2 秒内最多拉一次，避免频繁切换窗口造成请求风暴。
  useEffect(() => {
    let lastFetchedAt = 0;
    let disposed = false;
    const syncIfStale = () => {
      if (disposed || document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastFetchedAt < 2000) return;
      lastFetchedAt = now;
      void refreshSettings();
    };
    window.addEventListener('focus', syncIfStale);
    document.addEventListener('visibilitychange', syncIfStale);
    return () => {
      disposed = true;
      window.removeEventListener('focus', syncIfStale);
      document.removeEventListener('visibilitychange', syncIfStale);
    };
  }, [refreshSettings]);

  return (
    <SystemSettingsContext.Provider
      value={{
        settings,
        specNumberDigits: settings.specNumberDigits,
        loading,
        refreshSettings,
        setSettings,
      }}
    >
      {children}
    </SystemSettingsContext.Provider>
  );
};

export default SystemSettingsContext;
