const express = require('express');
const router = express.Router();
const db = require('../db');
const taskStore = require('../taskStore');
const { authMiddleware, superAdminMiddleware, accessSettingsMiddleware } = require('../middleware/auth');
const asyncHandler = require('express-async-handler');
const XLSX = require('xlsx');
const { applyExportStyles, buildAutoColumns } = require('../utils/exportWorkbook');
const { getEffectiveIsWeekend, normalizeWorkdayOverrides } = require('../utils/workday');
const { sanitizeAoaRows } = require('../utils/fileUploadSecurity');

router.get('/export', [authMiddleware, accessSettingsMiddleware('workHours')], asyncHandler(async (req, res) => {
  const { month, group, excludeWeekendOvertime, excludeVacationLeave } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ message: '请选择月份（格式：YYYY-MM）' });
  }

  // 导出要与页面「实际显示」完全一致：页面上的两个显示开关（不含周末加班 / 不含休假）
  // 也要带到导出里，否则导出的数字和屏幕上的数字对不上。
  const toFlag = value => value === '1' || value === 'true';
  const skipWeekendOvertime = toFlag(excludeWeekendOvertime);
  const skipVacationLeave = toFlag(excludeVacationLeave);

  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr, 10);
  const m = parseInt(monthStr, 10);

  const data = db.readDb();
  // 分组可选：前端「月度工时统计」按分组显示时，导出也要与页面口径一致。
  // 未传 group（或传 all）时保持原行为，导出全部设计人员。
  const groupFilter = typeof group === 'string' ? group.trim() : '';
  const filterByGroup = groupFilter && groupFilter !== 'all';
  const designers = (data.designers || []).filter(designer =>
    !filterByGroup || (designer.group || '').trim() === groupFilter
  );
  if (designers.length === 0) {
    return res.status(404).json({ message: '没有可导出的数据' });
  }
  const workdayOverrides = normalizeWorkdayOverrides(data.settings?.workdayOverrides);

  const monthTasks = taskStore.listSheets({ month: m, year });

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
        // 「暂停/取消」任务工时沿用当前值，不为 0 时与普通任务一样计入统计
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
          if (!skipVacationLeave) {
            designerData.vacationDays += itemHours;
          }
          return;
        }
        if (item.leaveType === 'illness') {
          designerData.illnessDays += itemHours;
          return;
        }

        // 「不含周末加班」时，周末日期上的任务整体不计入（与页面显示口径一致）
        if (skipWeekendOvertime && isWeekendDate) return;

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

  // 按导出后的「总工时」倒序，与页面排名一致
  const sortedData = Array.from(hoursMap.values()).sort((a, b) => b.hours - a.hours);

  // 列随显示开关联动：不含周末加班时，「工作日工时 / 周末加班工时」两列没有意义（总工时本身就是工作日工时），
  // 直接去掉，导出的表和屏幕上的列表列一致，不给两份重复数字。
  const columns = [
    { key: 'designerName', label: '设计员' },
    { key: 'hours', label: '总工时' },
    ...(skipWeekendOvertime
      ? []
      : [
        { key: 'workdayHours', label: '工作日工时' },
        { key: 'weekendHours', label: '周末加班工时' }
      ]),
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
  const worksheet = XLSX.utils.aoa_to_sheet(sanitizeAoaRows(worksheetData), { sheetStubs: true });
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
