'use strict';
/**
 * HTML 版导出：把月份数据渲染成可直接用 Excel 打开的 <table> 页面（含配色与请假/出差行）。
 *
 * 由 backend/routes/system/excel.js 拆分而来，代码为原样搬运（未改逻辑）。
 */
const { getEffectiveIsWeekend } = require('../../utils/workday');
const {

  TRIP_TASK_COLOR,

} = require('../../utils/taskColors');
const { calculateDailyTotal, formatDate, formatHour, getDayName, getDaysInMonth, getTaskLabel } = require('./excelShared');

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const getItemBackground = (item) => {
  if (item?.leaveType === 'sick') return '#fee2e2';
  if (item?.leaveType === 'vacation') return '#dbeafe';
  if (item?.leaveType === 'illness') return '#fce7f3';
  if (item?.leaveType === 'trip') return TRIP_TASK_COLOR;
  return item?.color || '';
};

const renderTaskLines = (items) => {
  const lines = [];

  (Array.isArray(items) ? items : []).forEach(item => {
    const guns = Array.isArray(item?.guns) ? item.guns : [];
    const background = getItemBackground(item);

    lines.push({
      task: getTaskLabel(item),
      hours: guns.length > 0 ? '' : formatHour(item?.hours),
      background
    });

    guns.forEach(gun => {
      lines.push({
        task: String(gun?.name || '').trim() || '未命名',
        hours: formatHour(gun?.hours),
        background
      });
    });
  });

  return lines;
};

const buildMonthHtmlTable = (monthSheets, designers, year, month, monthKey, workdayOverrides = {}) => {
  const daysCount = getDaysInMonth(year, month);
  const columnsCount = 1 + daysCount * 2 + 1;
  const sheetsByDesigner = new Map(monthSheets.map(sheet => [sheet.designerId, sheet]));
  const visibleDesigners = designers
    .filter(designer => !designer.hidden)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const groups = visibleDesigners.reduce((acc, designer) => {
    const groupName = designer.group || '未分组';
    if (!acc[groupName]) acc[groupName] = [];
    acc[groupName].push(designer);
    return acc;
  }, {});
  const sortedGroups = Object.keys(groups).sort();
  const html = [];

  html.push(`<table class="task-sheet" data-month="${escapeHtml(monthKey)}">`);
  html.push('<thead>');
  html.push('<tr>');
  html.push('<th class="designer-header" rowspan="2">设计员</th>');
  for (let day = 1; day <= daysCount; day += 1) {
    const isWeekend = getEffectiveIsWeekend(formatDate(year, month, day), workdayOverrides);
    html.push(`<th class="day-header${isWeekend ? ' weekend' : ''}" colspan="2"><div class="day-name">${getDayName(year, month, day)}</div><div>${day}</div></th>`);
  }
  html.push('<th class="month-total-header" rowspan="2">月总工时</th>');
  html.push('</tr>');
  html.push('<tr>');
  for (let day = 1; day <= daysCount; day += 1) {
    const isWeekend = getEffectiveIsWeekend(formatDate(year, month, day), workdayOverrides);
    html.push(`<th class="sub-header task-col${isWeekend ? ' weekend-sub' : ''}">任务内容</th>`);
    html.push(`<th class="sub-header hour-col${isWeekend ? ' weekend-sub' : ''}">工时</th>`);
  }
  html.push('</tr>');
  html.push('</thead>');
  html.push('<tbody>');

  sortedGroups.forEach(groupName => {
    const designersInGroup = groups[groupName];
    html.push(`<tr><td class="group-row" colspan="${columnsCount}">${escapeHtml(groupName)} <span>(${designersInGroup.length} 人)</span></td></tr>`);

    designersInGroup.forEach(designer => {
      const sheet = sheetsByDesigner.get(designer.id);
      const dayData = [];
      let monthlyTotal = 0;
      let maxLines = 1;

      for (let day = 1; day <= daysCount; day += 1) {
        const date = formatDate(year, month, day);
        const items = Array.isArray(sheet?.days?.[date]) ? sheet.days[date] : [];
        const lines = renderTaskLines(items);
        const dailyTotal = calculateDailyTotal(items);

        dayData.push({ lines, dailyTotal });
        maxLines = Math.max(maxLines, lines.length);
        monthlyTotal += dailyTotal;
      }

      for (let lineIndex = 0; lineIndex < maxLines; lineIndex += 1) {
        html.push('<tr>');
        if (lineIndex === 0) {
          html.push(`<td class="designer-name" rowspan="${maxLines}">${escapeHtml(designer.name)}</td>`);
        }

        dayData.forEach(day => {
          const line = day.lines[lineIndex];
          const backgroundStyle = line?.background ? ` style="background:${escapeHtml(line.background)};"` : '';
          html.push(`<td class="task-cell"${backgroundStyle}>${escapeHtml(line?.task || '')}</td>`);
          html.push(`<td class="hour-cell"${backgroundStyle}>${escapeHtml(line?.hours || '')}</td>`);
        });

        html.push(`<td class="month-total">${lineIndex === 0 ? monthlyTotal.toFixed(1) : ''}</td>`);
        html.push('</tr>');
      }

      html.push('<tr>');
      html.push('<td class="daily-total-title">当日合计</td>');
      dayData.forEach(day => {
        html.push('<td class="daily-total-label"></td>');
        html.push(`<td class="daily-total-value">${formatHour(day.dailyTotal)}</td>`);
      });
      html.push('<td class="daily-total-label"></td>');
      html.push('</tr>');
    });
  });

  html.push('</tbody>');
  html.push('</table>');
  return html.join('');
};

const buildExcelHtml = (monthGroups, designers, workdayOverrides = {}) => {
  const sheetNames = [...monthGroups.keys()].sort();
  const worksheetsXml = sheetNames.map(name => `
    <x:ExcelWorksheet>
      <x:Name>${escapeHtml(name)}</x:Name>
      <x:WorksheetOptions>
        <x:Selected/>
        <x:FreezePanes/>
        <x:FrozenNoSplit/>
        <x:SplitHorizontal>3</x:SplitHorizontal>
        <x:TopRowBottomPane>3</x:TopRowBottomPane>
        <x:SplitVertical>1</x:SplitVertical>
        <x:LeftColumnRightPane>1</x:LeftColumnRightPane>
        <x:ActivePane>0</x:ActivePane>
        <x:Panes>
          <x:Pane>
            <x:Number>3</x:Number>
          </x:Pane>
          <x:Pane>
            <x:Number>1</x:Number>
          </x:Pane>
          <x:Pane>
            <x:Number>2</x:Number>
            <x:ActiveRow>2</x:ActiveRow>
          </x:Pane>
          <x:Pane>
            <x:Number>0</x:Number>
            <x:ActiveRow>3</x:ActiveRow>
            <x:ActiveCol>1</x:ActiveCol>
          </x:Pane>
        </x:Panes>
      </x:WorksheetOptions>
    </x:ExcelWorksheet>
  `).join('');
  const sheetsHtml = sheetNames.map((name, index) => {
    const [year, month] = name.split('-').map(Number);
    const tableHtml = buildMonthHtmlTable(monthGroups.get(name), designers, year, month, name, workdayOverrides);
    return `
      <section class="worksheet">
        ${tableHtml}
      </section>
      ${index < sheetNames.length - 1 ? '<br class="page-break">' : ''}
    `;
  }).join('');

  return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8">
  <!--[if gte mso 9]>
  <xml>
    <x:ExcelWorkbook>
      <x:ExcelWorksheets>${worksheetsXml}</x:ExcelWorksheets>
    </x:ExcelWorkbook>
  </xml>
  <![endif]-->
  <style>
    body { font-family: Arial, "Microsoft YaHei", sans-serif; }
    table.task-sheet { border-collapse: collapse; table-layout: fixed; font-size: 12px; }
    .task-sheet th, .task-sheet td {
      border: .5pt solid #9ca3af;
      padding: 4px 6px;
      vertical-align: middle;
      word-break: break-all;
      white-space: normal;
      mso-number-format: "\\@";
    }
    .task-sheet thead th {
      text-align: center;
      vertical-align: middle;
    }
    .designer-header, .month-total-header {
      width: 76px;
      background: #f3f6f9;
      font-weight: 700;
      text-align: center;
    }
    .day-header {
      width: 242px;
      background: #f8f9fa;
      text-align: center;
      font-weight: 700;
    }
    .day-name { color: #8795a1; font-size: 10px; }
    .sub-header {
      background: #f8f9fa;
      color: #4b5563;
      text-align: center;
      font-weight: 700;
    }
    .weekend { background: #fff2cc; }
    .weekend-sub { background: #fff7dc; }
    .task-col, .task-cell { width: 198px; }
    .hour-col, .hour-cell { width: 44px; }
    .group-row {
      background: #e5e7eb;
      color: #374151;
      font-weight: 700;
      text-align: left;
    }
    .group-row span { color: #6b7280; font-weight: 400; }
    .designer-name {
      background: #ffffff;
      color: #111827;
      font-size: 14px;
      font-weight: 700;
      text-align: center;
      vertical-align: middle;
    }
    .task-cell {
      min-height: 24px;
      text-align: center;
      color: #111827;
    }
    .hour-cell {
      text-align: center;
      color: #003cff;
      font-weight: 700;
    }
    .daily-total-label {
      background: #f8fbff;
      color: #6b7280;
      font-weight: 700;
      text-align: center;
    }
    .daily-total-title {
      background: #f8fbff;
      color: #6b7280;
      font-weight: 700;
      text-align: center;
    }
    .daily-total-value {
      background: #f8fbff;
      color: #003cff;
      font-weight: 700;
      text-align: center;
    }
    .month-total {
      background: #f8f9fa;
      color: #15803d;
      font-weight: 700;
      text-align: center;
    }
    .page-break { page-break-before: always; mso-special-character: line-break; }
  </style>
</head>
<body>
  ${sheetsHtml}
</body>
</html>`;
};

module.exports = {
  escapeHtml,
  getItemBackground,
  renderTaskLines,
  buildMonthHtmlTable,
  buildExcelHtml,
};
