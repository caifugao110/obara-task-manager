import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { axiosInstance } from '../services/api';

export interface SystemSettingsData {
  allowGuestView: boolean;
  allowMultiDevice: boolean;
  allowUserDesignPlanColorMark: boolean;
  allowUserEditOwnTaskColor: boolean;
  specNumberDigits: number;
}

const defaultSettings: SystemSettingsData = {
  allowGuestView: true,
  allowMultiDevice: true,
  allowUserDesignPlanColorMark: true,
  allowUserEditOwnTaskColor: true,
  specNumberDigits: 5,
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
      setSettings({
        ...defaultSettings,
        ...res.data,
        allowUserDesignPlanColorMark: allowOwnDesignPlanColor,
        allowUserEditOwnTaskColor: allowOwnDesignPlanColor,
        specNumberDigits: digits,
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
