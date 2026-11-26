'use strict';
/**
 * 导出/导入共用的基础件：表头行高、下载文件名时间戳、工作表与日期/工时小工具。
 * 两个方向都要用，单独放一份，避免 HTML 导出与反解析各写一套口径。
 *
 * 由 backend/routes/system/excel.js 拆分而来，代码为原样搬运（未改逻辑）。
 */

const FIRST_HEADER_ROW_HEIGHT = 36;

const formatDownloadTimestamp = () => {
  const date = new Date();
  const pad = value => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + '-' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
};

const sheetHasData = (sheet) => {
  if (!sheet?.days || typeof sheet.days !== 'object') return false;
  return Object.values(sheet.days).some(items => Array.isArray(items) && items.length > 0);
};

const parseMonthFromSheetName = (name) => {
  const trimmed = String(name || '').trim();
  const isoMatch = trimmed.match(/(\d{4})[-/年](\d{1,2})/);
  if (isoMatch) {
    return { year: parseInt(isoMatch[1], 10), month: parseInt(isoMatch[2], 10) };
  }
  return null;
};

const parseNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = parseFloat(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatHour = (value) => {
  if (value === null || value === undefined || value === '') return '';
  const parsed = parseNumber(value);
  return Number.isInteger(parsed) ? String(parsed) : String(parsed);
};

const getDaysInMonth = (year, month) => new Date(year, month, 0).getDate();

const formatDate = (year, month, day) => {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const getDayName = (year, month, day) => {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(year, month - 1, day).getDay()];
};

const getTaskHours = (item) => {
  const mainHours = parseNumber(item?.hours);
  const gunsHours = (Array.isArray(item?.guns) ? item.guns : []).reduce(
    (sum, gun) => sum + parseNumber(gun?.hours),
    0
  );
  return Array.isArray(item?.guns) && item.guns.length > 0 ? gunsHours : mainHours;
};

const getTaskLabel = (item) => {
  const name = String(item?.taskName || '').trim();
  if (item?.leaveType === 'sick') return '事假';
  if (item?.leaveType === 'vacation') return '休假';
  if (item?.leaveType === 'illness') return '病假';
  if (item?.leaveType === 'trip') {
    if (!name) return '出差';
    return name.endsWith('出差') ? name : `${name}出差`;
  }
  return name || '无';
};

const calculateDailyTotal = (items) => {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    if (['sick', 'vacation', 'illness'].includes(item?.leaveType)) return sum;
    return sum + getTaskHours(item);
  }, 0);
};

module.exports = {
  FIRST_HEADER_ROW_HEIGHT,
  formatDownloadTimestamp,
  sheetHasData,
  parseMonthFromSheetName,
  parseNumber,
  formatHour,
  getDaysInMonth,
  formatDate,
  getDayName,
  getTaskHours,
  getTaskLabel,
  calculateDailyTotal,
};
