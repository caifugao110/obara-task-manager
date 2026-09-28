import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { axiosInstance } from '../services/api';

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
  specNumberDigits: number;
  defaultGunHours?: DefaultGunHours;
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
  specNumberDigits: 5,
  defaultGunHours
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
        }
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
