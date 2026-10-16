import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { axiosInstance } from '../services/api';
import {
  BUILTIN_TABLE_GUN_HOURS,
  TableGunHoursMap,
  GunHoursCell,
} from '../utils/gunHoursRules';

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
  randomDesignPlanColor: boolean;
  randomAssignmentColor: boolean;
  defaultGunHours?: DefaultGunHours;
  // 分类 → 表名 → 专用工时（内置值 + 超管覆盖值的合并结果）
  tableGunHours?: TableGunHoursMap;
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
  randomDesignPlanColor: false,
  randomAssignmentColor: false,
  defaultGunHours,
  tableGunHours: BUILTIN_TABLE_GUN_HOURS
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
        defaultGunHours: {
          confirm: mergeGunType('confirm'),
          design: mergeGunType('design'),
          confirmModify: mergeGunType('confirmModify')
        },
        tableGunHours: normalizeTableGunHours(res.data.tableGunHours)
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
