const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, superAdminMiddleware, accessSettingsMiddleware } = require('../middleware/auth');
const asyncHandler = require('express-async-handler');
const XLSX = require('xlsx');
const { applyExportStyles, buildAutoColumns } = require('../utils/exportWorkbook');
const { getEffectiveIsWeekend, normalizeWorkdayOverrides } = require('../utils/workday');

router.get('/export', [authMiddleware, accessSettingsMiddleware('systemSettings')], asyncHandler(async (req, res) => {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ message: '请选择月份（格式：YYYY-MM）' });
  }

  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr, 10);
  const m = parseInt(monthStr, 10);

  const data = db.readDb();
  const designers = data.designers || [];
  const tasks = data.tasks || [];
  const workdayOverrides = normalizeWorkdayOverrides(data.settings?.workdayOverrides);

  const monthTasks = tasks.filter(t => t.year === year && t.month === m);

  if (monthTasks.length === 0) {
    return res.status(404).json({ message: '没有可导出的数据' });
  }

  const hoursMap = new Map();

  designers.forEach(designer => {
    hoursMap.set(designer.id, {
      designerId: designer.id,
      designerName: designer.name,
      hours: 0,
      workdayHours: 0,
      designHours: 0,
      workdayDesignHours: 0,
      tripHours: 0,
      workdayTripHours: 0,
      sickDays: 0,
      vacationDays: 0,
      illnessDays: 0
    });
  });

  monthTasks.forEach(sheet => {
    const designerData = hoursMap.get(sheet.designerId);
    if (!designerData) return;

    Object.entries(sheet.days || {}).forEach(([date, items]) => {
      items.forEach(item => {
        const itemHours = typeof item.hours === 'number' ? item.hours : (parseFloat(item.hours) || 0);
        const isWeekendDate = getEffectiveIsWeekend(date, workdayOverrides);
        const gunsHours = (item.guns || []).reduce((sum, gun) => {
          return sum + (typeof gun.hours === 'number' ? gun.hours : (parseFloat(gun.hours) || 0));
        }, 0);
        const taskHours = item.guns && item.guns.length > 0 ? gunsHours : itemHours;

        if (item.leaveType === 'sick') {
          designerData.sickDays += itemHours;
          return;
        }
        if (item.leaveType === 'vacation') {
          designerData.vacationDays += itemHours;
          return;
        }
        if (item.leaveType === 'illness') {
          designerData.illnessDays += itemHours;
          return;
        }

        designerData.hours += taskHours;
        if (!isWeekendDate) {
          designerData.workdayHours += taskHours;
        }
        if (item.leaveType === 'trip') {
          designerData.tripHours += taskHours;
          if (!isWeekendDate) {
            designerData.workdayTripHours += taskHours;
          }
          return;
        }

        designerData.designHours += taskHours;
        if (!isWeekendDate) {
          designerData.workdayDesignHours += taskHours;
        }
      });
    });
  });

  const sortedData = Array.from(hoursMap.values()).sort((a, b) => b.hours - a.hours);

  const columns = [
    { key: 'designerName', label: '设计员' },
    { key: 'hours', label: '总工时' },
    { key: 'workdayHours', label: '工作日工时' },
    { key: 'weekendHours', label: '周末加班工时' },
    { key: 'tripHours', label: '出差工时' },
    { key: 'leaveHours', label: '请假工时' }
  ];

  const headerRow = columns.map(col => col.label);
  const dataRows = sortedData.map(item => {
    const weekendHours = item.hours - item.workdayHours;
    const leaveHours = item.sickDays + item.vacationDays + item.illnessDays;
    const rowData = { ...item, weekendHours, leaveHours };
    return columns.map(col => {
      if (['hours', 'workdayHours', 'weekendHours', 'tripHours', 'leaveHours'].includes(col.key)) {
        return rowData[col.key] === 0 ? '' : rowData[col.key].toFixed(1);
      }
      return rowData[col.key] || '';
    });
  });

  const worksheetData = [headerRow, ...dataRows];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData, { sheetStubs: true });
  worksheet['!cols'] = buildAutoColumns(worksheetData, { min: 70, max: 160 });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, month);

  const xml = applyExportStyles(XLSX.write(workbook, { type: 'string', bookType: 'xlml' }), { freezeFirstColumn: true });
  const buffer = Buffer.from(xml, 'utf8');

  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="work-hours-${month}.xls"`);
  res.send(buffer);
}));

module.exports = router;
