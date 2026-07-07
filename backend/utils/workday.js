const OVERRIDE_WORKDAY = 'workday';
const OVERRIDE_WEEKEND = 'weekend';

const isDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

const normalizeWorkdayOverrides = (overrides = {}) => {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return {};

  return Object.entries(overrides).reduce((normalized, [date, type]) => {
    if (isDateKey(date) && [OVERRIDE_WORKDAY, OVERRIDE_WEEKEND].includes(type)) {
      normalized[date] = type;
    }
    return normalized;
  }, {});
};

const isNaturalWeekend = (dateStr) => {
  const date = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  return [0, 6].includes(date.getDay());
};

const getEffectiveIsWeekend = (dateStr, overrides = {}) => {
  const date = String(dateStr).slice(0, 10);
  const normalized = normalizeWorkdayOverrides(overrides);
  if (normalized[date] === OVERRIDE_WORKDAY) return false;
  if (normalized[date] === OVERRIDE_WEEKEND) return true;
  return isNaturalWeekend(date);
};

module.exports = {
  OVERRIDE_WORKDAY,
  OVERRIDE_WEEKEND,
  normalizeWorkdayOverrides,
  isNaturalWeekend,
  getEffectiveIsWeekend
};
