export type WorkdayOverrideType = 'workday' | 'weekend';
export type WorkdayOverrides = Record<string, WorkdayOverrideType>;

export const normalizeWorkdayOverrides = (value: unknown): WorkdayOverrides => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.entries(value).reduce<WorkdayOverrides>((normalized, [date, type]) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && (type === 'workday' || type === 'weekend')) {
      normalized[date] = type;
    }
    return normalized;
  }, {});
};

export const getEffectiveIsWeekend = (date: string, naturalIsWeekend: boolean, overrides: WorkdayOverrides) => {
  const override = overrides[date];
  if (override === 'workday') return false;
  if (override === 'weekend') return true;
  return naturalIsWeekend;
};

export const getWorkdayOverrideLabel = (naturalIsWeekend: boolean) => (
  naturalIsWeekend ? '将今日设为普通工作日' : '将今日设为周末加班日'
);
