const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const crypto = require('crypto');
const db = require('../db');
const { authMiddleware, superAdminMiddleware } = require('../middleware/auth');
const Joi = require('joi');
const asyncHandler = require('express-async-handler');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const defaultSystemSettings = { allowGuestView: true, allowMultiDevice: true };
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

const systemSettingsSchema = Joi.object({
  allowGuestView: Joi.boolean().required(),
  allowMultiDevice: Joi.boolean().required()
});

const loginLogQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(500).default(200),
  username: Joi.string().allow('').max(60).default(''),
  role: Joi.string().valid('all', 'superadmin', 'admin', 'user').default('all'),
  success: Joi.string().valid('all', 'true', 'false').default('all'),
  browser: Joi.string().allow('').max(80).default(''),
  ip: Joi.string().allow('').max(80).default(''),
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional()
});

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
  if (item?.leaveType === 'trip') return '#fef9c3';
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

const buildMonthHtmlTable = (monthSheets, designers, year, month, monthKey) => {
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
    const isWeekend = [0, 6].includes(new Date(year, month - 1, day).getDay());
    html.push(`<th class="day-header${isWeekend ? ' weekend' : ''}" colspan="2"><div class="day-name">${getDayName(year, month, day)}</div><div>${day}</div></th>`);
  }
  html.push('<th class="month-total-header" rowspan="2">月总工时</th>');
  html.push('</tr>');
  html.push('<tr>');
  for (let day = 1; day <= daysCount; day += 1) {
    const isWeekend = [0, 6].includes(new Date(year, month - 1, day).getDay());
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

const buildExcelHtml = (monthGroups, designers) => {
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
    const tableHtml = buildMonthHtmlTable(monthGroups.get(name), designers, year, month, name);
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

const cellKey = (row, col) => `${row}:${col}`;

const buildMonthWorkbookData = (monthSheets, designers, year, month) => {
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
  const rows = [];
  const merges = [];
  const styleMap = new Map();

  const applyStyleRange = (row, startCol, endCol, styleId) => {
    for (let col = startCol; col <= endCol; col += 1) {
      styleMap.set(cellKey(row, col), styleId);
    }
  };

  const headerRow = ['设计员'];
  const subHeaderRow = [''];
  styleMap.set(cellKey(0, 0), 's100');
  styleMap.set(cellKey(1, 0), 's100');

  for (let day = 1; day <= daysCount; day += 1) {
    const isWeekend = [0, 6].includes(new Date(year, month - 1, day).getDay());
    const dayStyle = isWeekend ? 's104' : 's100';
    const subStyle = isWeekend ? 's105' : 's100';
    const startCol = 1 + (day - 1) * 2;

    headerRow.push(`${getDayName(year, month, day)}\n${day}`, '');
    subHeaderRow.push('任务内容', '工时');
    merges.push({ s: { r: 0, c: startCol }, e: { r: 0, c: startCol + 1 } });
    styleMap.set(cellKey(0, startCol), dayStyle);
    styleMap.set(cellKey(0, startCol + 1), dayStyle);
    styleMap.set(cellKey(1, startCol), subStyle);
    styleMap.set(cellKey(1, startCol + 1), subStyle);
  }

  headerRow.push('月总工时');
  subHeaderRow.push('');
  styleMap.set(cellKey(0, columnsCount - 1), 's100');
  styleMap.set(cellKey(1, columnsCount - 1), 's100');
  rows.push(headerRow, subHeaderRow);

  sortedGroups.forEach(groupName => {
    const designersInGroup = groups[groupName];
    const groupRowIndex = rows.length;
    rows.push([`${groupName} (${designersInGroup.length} 人)`, ...Array(columnsCount - 1).fill('')]);
    merges.push({ s: { r: groupRowIndex, c: 0 }, e: { r: groupRowIndex, c: columnsCount - 1 } });
    applyStyleRange(groupRowIndex, 0, columnsCount - 1, 's101');

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

      const designerStartRow = rows.length;
      for (let lineIndex = 0; lineIndex < maxLines; lineIndex += 1) {
        const row = [lineIndex === 0 ? designer.name : ''];
        styleMap.set(cellKey(rows.length, 0), 's102');

        dayData.forEach((day, dayIndex) => {
          const line = day.lines[lineIndex];
          const taskCol = 1 + dayIndex * 2;
          const color = normalizeColor(line?.background || '');
          const styleId = color ? `color_${color.slice(1)}` : 's103';
          row.push(line?.task || '', line?.hours || '');
          styleMap.set(cellKey(rows.length, taskCol), styleId);
          styleMap.set(cellKey(rows.length, taskCol + 1), styleId);
        });

        row.push(lineIndex === 0 ? monthlyTotal.toFixed(1) : '');
        styleMap.set(cellKey(rows.length, columnsCount - 1), 's106');
        rows.push(row);
      }

      if (maxLines > 1) {
        merges.push({ s: { r: designerStartRow, c: 0 }, e: { r: designerStartRow + maxLines - 1, c: 0 } });
      }

      const totalRowIndex = rows.length;
      const totalRow = ['当日合计'];
      styleMap.set(cellKey(totalRowIndex, 0), 's107');
      dayData.forEach((day, dayIndex) => {
        totalRow.push('', day.dailyTotal ? formatHour(day.dailyTotal) : '');
        const taskCol = 1 + dayIndex * 2;
        styleMap.set(cellKey(totalRowIndex, taskCol), 's107');
        styleMap.set(cellKey(totalRowIndex, taskCol + 1), 's108');
      });
      totalRow.push('');
      styleMap.set(cellKey(totalRowIndex, columnsCount - 1), 's107');
      rows.push(totalRow);
    });
  });

  return { rows, merges, styleMap };
};

const buildStyleDefinitions = (styleIds) => {
  const border = '<Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders>';
  const alignment = '<Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>';
  const font = (color = '', bold = false) => `<Font${bold ? ' ss:Bold="1"' : ''}${color ? ` ss:Color="${color}"` : ''}/>`;
  const interior = color => color ? `<Interior ss:Color="${color}" ss:Pattern="Solid"/>` : '';
  const style = (id, fill = '', textColor = '', bold = false) => `<Style ss:ID="${id}">${alignment}${border}${font(textColor, bold)}${interior(fill)}<NumberFormat ss:Format="General"/></Style>`;

  const fixed = [
    style('s100', '#f8f9fa', '', true),
    style('s101', '#e5e7eb', '', true),
    style('s102', '#ffffff', '', true),
    style('s103', '#ffffff'),
    style('s104', '#fff2cc', '', true),
    style('s105', '#fff7dc', '', true),
    style('s106', '#f8f9fa', '#15803d', true),
    style('s107', '#f8fbff', '#6b7280', true),
    style('s108', '#f8fbff', '#003cff', true)
  ];

  const colorStyles = [...styleIds]
    .filter(id => id.startsWith('color_'))
    .sort()
    .map(id => style(id, `#${id.slice(6)}`));

  return fixed.concat(colorStyles).join('');
};

const patchXlmlWorksheetOptions = (xml) => {
  const options = '<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>3</SplitHorizontal><TopRowBottomPane>3</TopRowBottomPane><SplitVertical>1</SplitVertical><LeftColumnRightPane>1</LeftColumnRightPane><ActivePane>0</ActivePane><Panes><Pane><Number>3</Number></Pane><Pane><Number>1</Number></Pane><Pane><Number>2</Number><ActiveRow>2</ActiveRow></Pane><Pane><Number>0</Number><ActiveRow>3</ActiveRow><ActiveCol>1</ActiveCol></Pane></Panes></WorksheetOptions>';
  return xml.replace(/<\/Worksheet>/g, `${options}</Worksheet>`);
};

const patchXlmlStyles = (xml, styleIds) => {
  const styles = buildStyleDefinitions(styleIds);
  return xml.replace('</Styles>', `${styles}</Styles>`);
};

const patchXlmlCellStyles = (xml, sheetStyleMaps) => {
  const worksheetRegex = /<Worksheet ss:Name="([^"]+)">([\s\S]*?)<\/Worksheet>/g;
  return xml.replace(worksheetRegex, (worksheetXml, sheetName, worksheetBody) => {
    const styleMap = sheetStyleMaps.get(sheetName);
    if (!styleMap) return worksheetXml;

    let rowIndex = -1;
    const patchedBody = worksheetBody.replace(/<Row\b([^>]*)>([\s\S]*?)<\/Row>/g, (rowXml, rowAttrs, rowBody) => {
      const rowIndexMatch = rowAttrs.match(/ss:Index="(\d+)"/);
      rowIndex = rowIndexMatch ? parseInt(rowIndexMatch[1], 10) - 1 : rowIndex + 1;
      let colIndex = -1;
      const patchedRowBody = rowBody.replace(/<Cell\b([^>]*)>/g, (cellOpen, cellAttrs) => {
        const colIndexMatch = cellAttrs.match(/ss:Index="(\d+)"/);
        colIndex = colIndexMatch ? parseInt(colIndexMatch[1], 10) - 1 : colIndex + 1;
        const styleId = styleMap.get(cellKey(rowIndex, colIndex));
        if (!styleId) return cellOpen;
        if (/ss:StyleID="[^"]*"/.test(cellAttrs)) {
          return `<Cell${cellAttrs.replace(/ss:StyleID="[^"]*"/, `ss:StyleID="${styleId}"`)}>`;
        }
        return `<Cell ss:StyleID="${styleId}"${cellAttrs}>`;
      });
      let nextRowAttrs = rowAttrs;
      if (rowIndex === 0) {
        nextRowAttrs = nextRowAttrs
          .replace(/\s+ss:Height="[^"]*"/, '')
          .replace(/\s+ss:AutoFitHeight="[^"]*"/, '');
        nextRowAttrs += ` ss:Height="${FIRST_HEADER_ROW_HEIGHT}" ss:AutoFitHeight="0"`;
      }
      return `<Row${nextRowAttrs}>${patchedRowBody}</Row>`;
    });

    return `<Worksheet ss:Name="${sheetName}">${patchedBody}</Worksheet>`;
  });
};

const buildExcelXml = (monthGroups, designers) => {
  const workbook = XLSX.utils.book_new();
  const sheetStyleMaps = new Map();
  const allStyleIds = new Set();

  [...monthGroups.keys()].sort().forEach(key => {
    const [year, month] = key.split('-').map(Number);
    const { rows, merges, styleMap } = buildMonthWorkbookData(monthGroups.get(key), designers, year, month);
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!merges'] = merges;
    worksheet['!cols'] = [
      { wpx: 80 },
      ...Array.from({ length: getDaysInMonth(year, month) }, () => [{ wpx: 198 }, { wpx: 44 }]).flat(),
      { wpx: 80 }
    ];
    styleMap.forEach(styleId => allStyleIds.add(styleId));
    sheetStyleMaps.set(key, styleMap);
    XLSX.utils.book_append_sheet(workbook, worksheet, key);
  });

  let xml = XLSX.write(workbook, { type: 'string', bookType: 'xlml' });
  xml = patchXlmlStyles(xml, allStyleIds);
  xml = patchXlmlCellStyles(xml, sheetStyleMaps);
  xml = patchXlmlWorksheetOptions(xml);
  return xml;
};

const normalizeMonthValue = (value) => {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{1,2})$/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  if (!year || month < 1 || month > 12) return null;
  return { year, month, key: `${year}-${String(month).padStart(2, '0')}` };
};

const getCellText = (row, index) => String(row?.[index] ?? '').trim();

const getRenderedDayCount = (rawRows, headerIndex, fallbackDaysCount) => {
  const headerRow = rawRows[headerIndex] || [];
  const subHeaderRow = rawRows[headerIndex + 1] || [];
  const maxColumns = Math.max(headerRow.length, subHeaderRow.length);
  let dayCount = 0;

  for (let col = 1; col < maxColumns; col += 2) {
    const dayHeader = getCellText(headerRow, col);
    const taskHeader = getCellText(subHeaderRow, col);
    const hourHeader = getCellText(subHeaderRow, col + 1);

    if ([dayHeader, taskHeader, hourHeader].includes('月总工时')) break;
    if (taskHeader === '任务内容' && hourHeader === '工时') {
      dayCount += 1;
      continue;
    }
    if (dayCount > 0 && !dayHeader && !taskHeader && !hourHeader) break;
  }

  return dayCount || fallbackDaysCount;
};

const isGroupRow = (row, dataColumnsEnd) => {
  const first = getCellText(row, 0);
  if (!first || first === '设计员' || first === '当日合计') return false;
  const restHasValue = row.slice(1, dataColumnsEnd).some(cell => String(cell ?? '').trim() !== '');
  return !restHasValue;
};

const normalizeColor = (value) => {
  const raw = String(value || '').replace(/^#/, '').trim();
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`;
  if (/^[0-9a-fA-F]{8}$/.test(raw)) return `#${raw.slice(2).toLowerCase()}`;
  return '';
};

const getCellBackground = (worksheet, rowIndex, colIndex) => {
  const fallbackColor = worksheet?.__cellBackgrounds?.get(`${rowIndex}:${colIndex}`);
  if (fallbackColor) return fallbackColor;
  const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })];
  return normalizeColor(
    cell?.s?.fgColor?.rgb ||
    cell?.s?.fill?.fgColor?.rgb ||
    cell?.s?.patternType?.fgColor?.rgb ||
    ''
  );
};

const decodeHtmlEntities = (value) => String(value || '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));

const htmlCellToText = (html) => {
  return decodeHtmlEntities(
    String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  ).trim();
};

const getAttr = (attrs, name) => {
  const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = String(attrs || '').match(pattern);
  return match ? (match[2] || match[3] || match[4] || '') : '';
};

const getStyleBackground = (attrs) => {
  const style = getAttr(attrs, 'style');
  const match = style.match(/background(?:-color)?\s*:\s*([^;]+)/i);
  return match ? normalizeColor(match[1]) : '';
};

const parseHtmlExportTables = (buffer) => {
  const html = buffer.toString('utf8').replace(/^\uFEFF/, '');
  if (!/<table\b/i.test(html)) return [];

  const tables = [];
  const tableRegex = /<table\b([^>]*)>([\s\S]*?)<\/table>/gi;
  let tableMatch;

  while ((tableMatch = tableRegex.exec(html))) {
    const tableAttrs = tableMatch[1] || '';
    const tableBody = tableMatch[2] || '';
    if (!/task-sheet/i.test(tableAttrs) && !/设计员/.test(tableBody)) continue;

    const rawRows = [];
    const cellBackgrounds = new Map();
    const rowSpans = new Map();
    const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    let rowIndex = 0;

    while ((rowMatch = rowRegex.exec(tableBody))) {
      const row = [];
      const occupied = new Set();

      rowSpans.forEach((remaining, colIndex) => {
        if (remaining > 0) {
          row[colIndex] = '';
          occupied.add(colIndex);
        }
      });

      const cellRegex = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
      let cellMatch;
      let colIndex = 0;

      while ((cellMatch = cellRegex.exec(rowMatch[1] || ''))) {
        while (occupied.has(colIndex) || row[colIndex] !== undefined) colIndex += 1;

        const attrs = cellMatch[2] || '';
        const text = htmlCellToText(cellMatch[3]);
        const colspan = Math.max(parseInt(getAttr(attrs, 'colspan'), 10) || 1, 1);
        const rowspan = Math.max(parseInt(getAttr(attrs, 'rowspan'), 10) || 1, 1);
        const background = getStyleBackground(attrs);

        for (let offset = 0; offset < colspan; offset += 1) {
          row[colIndex + offset] = offset === 0 ? text : '';
          if (background) cellBackgrounds.set(`${rowIndex}:${colIndex + offset}`, background);
          if (rowspan > 1) rowSpans.set(colIndex + offset, rowspan - 1);
        }

        colIndex += colspan;
      }

      rowSpans.forEach((remaining, col) => {
        if (remaining <= 1) rowSpans.delete(col);
        else rowSpans.set(col, remaining - 1);
      });

      rawRows.push(row);
      rowIndex += 1;
    }

    tables.push({
      monthKey: getAttr(tableAttrs, 'data-month'),
      rawRows,
      worksheet: { __cellBackgrounds: cellBackgrounds }
    });
  }

  return tables;
};

const getLeaveTypeFromLabel = (label) => {
  if (label === '事假') return 'sick';
  if (label === '休假') return 'vacation';
  if (label === '病假') return 'illness';
  if (label.endsWith('出差')) return 'trip';
  return null;
};

const createImportedItem = ({ taskName, hours, leaveType = null, color = '', guns = [] }) => ({
  id: crypto.randomUUID(),
  taskName: String(taskName || ''),
  hours: parseNumber(hours),
  leaveType,
  color: color || '',
  guns
});

const isImportedItemMeaningful = (item) => {
  if (!item) return false;
  if (item.leaveType) {
    if (item.leaveType === 'trip') return Boolean(String(item.taskName || '').trim() && parseNumber(item.hours) > 0);
    return true;
  }

  const taskName = String(item.taskName || '').trim();
  if (!taskName) return false;

  if (Array.isArray(item.guns) && item.guns.length > 0) {
    return item.guns.some(gun => String(gun?.name || '').trim() && parseNumber(gun?.hours) > 0);
  }

  return parseNumber(item.hours) > 0;
};

const finishPendingImportedItem = (item) => {
  if (!item) return null;
  item.guns = (Array.isArray(item.guns) ? item.guns : []).filter(gun => (
    String(gun?.name || '').trim() && parseNumber(gun?.hours) > 0
  ));
  if (item.guns.length > 0) {
    item.hours = item.guns.reduce((sum, gun) => sum + parseNumber(gun.hours), 0);
  }
  return isImportedItemMeaningful(item) ? item : null;
};

const parseRenderedExportSheet = ({ worksheet, rawRows, targetMonth, designerByName, skippedDesigners }) => {
  const daysCount = getDaysInMonth(targetMonth.year, targetMonth.month);
  const headerIndex = rawRows.findIndex(row => getCellText(row, 0) === '设计员');
  if (headerIndex < 0) return { sheetMap: new Map(), importedRows: 0 };
  const renderedDaysCount = getRenderedDayCount(rawRows, headerIndex, daysCount);
  const daysToParse = Math.min(daysCount, renderedDaysCount);
  const dataColumnsEnd = 1 + daysToParse * 2;

  const sheetMap = new Map();
  let importedRows = 0;
  let rowIndex = headerIndex + 2;

  while (rowIndex < rawRows.length) {
    const row = rawRows[rowIndex] || [];
    const first = getCellText(row, 0);

    if (!first || isGroupRow(row, dataColumnsEnd) || first === '当日合计') {
      rowIndex += 1;
      continue;
    }

    const block = [];
    rowIndex += 1;
    block.push({ rowIndex: rowIndex - 1, row });

    while (rowIndex < rawRows.length) {
      const nextRow = rawRows[rowIndex] || [];
      const nextFirst = getCellText(nextRow, 0);
      if (nextFirst === '当日合计') break;
      if (nextFirst && isGroupRow(nextRow, dataColumnsEnd)) break;
      if (nextFirst && !['', '当日合计'].includes(nextFirst)) break;
      block.push({ rowIndex, row: nextRow });
      rowIndex += 1;
    }

    if (rowIndex < rawRows.length && getCellText(rawRows[rowIndex], 0) === '当日合计') {
      rowIndex += 1;
    }

    const designer = designerByName.get(first);
    if (!designer) {
      skippedDesigners.add(first);
      continue;
    }

    const importedSheet = {
      designerId: designer.id,
      month: targetMonth.month,
      year: targetMonth.year,
      days: {}
    };

    for (let day = 1; day <= daysToParse; day += 1) {
      const date = formatDate(targetMonth.year, targetMonth.month, day);
      const taskCol = 1 + (day - 1) * 2;
      const hourCol = taskCol + 1;
      const dayItems = [];
      let pendingGunItem = null;

      block.forEach(({ rowIndex: absoluteRowIndex, row: blockRow }) => {
        const taskText = getCellText(blockRow, taskCol);
        const hourText = getCellText(blockRow, hourCol);
        if (!taskText && !hourText) return;

        const color = getCellBackground(worksheet, absoluteRowIndex, taskCol);
        const leaveType = getLeaveTypeFromLabel(taskText);

        if (leaveType) {
          const finished = finishPendingImportedItem(pendingGunItem);
          if (finished) dayItems.push(finished);
          pendingGunItem = null;
          const leaveItem = createImportedItem({
            taskName: leaveType === 'trip' ? taskText : '',
            hours: parseNumber(hourText),
            leaveType,
            color
          });
          if (isImportedItemMeaningful(leaveItem)) dayItems.push(leaveItem);
          return;
        }

        if (taskText && !hourText) {
          const finished = finishPendingImportedItem(pendingGunItem);
          if (finished) dayItems.push(finished);
          pendingGunItem = createImportedItem({ taskName: taskText, hours: 0, color, guns: [] });
          return;
        }

        if (pendingGunItem && taskText && hourText) {
          const pendingColor = normalizeColor(pendingGunItem.color);
          const lineColor = normalizeColor(color);
          const sameTaskColor = !pendingColor || !lineColor || pendingColor === lineColor;
          if (sameTaskColor && parseNumber(hourText) > 0) {
            pendingGunItem.guns.push({
              id: crypto.randomUUID(),
              name: taskText,
              hours: parseNumber(hourText)
            });
            return;
          }
        }

        const finished = finishPendingImportedItem(pendingGunItem);
        if (finished) dayItems.push(finished);
        pendingGunItem = null;

        if (taskText && hourText && parseNumber(hourText) > 0) {
          dayItems.push(createImportedItem({ taskName: taskText, hours: parseNumber(hourText), color }));
        }
      });

      const finished = finishPendingImportedItem(pendingGunItem);
      if (finished) dayItems.push(finished);

      if (dayItems.length > 0) {
        importedSheet.days[date] = dayItems;
        importedRows += dayItems.length;
      }
    }

    if (sheetHasData(importedSheet)) {
      sheetMap.set(designer.id, importedSheet);
    }
  }

  return { sheetMap, importedRows };
};

router.get('/settings', asyncHandler(async (req, res) => {
  const data = db.readDb();
  res.json(data.settings?.system || defaultSystemSettings);
}));

router.put('/settings', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const { error, value } = systemSettingsSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const data = db.readDb();
  if (!data.settings) data.settings = {};
  data.settings.system = value;
  await db.writeDb(data);
  res.json(value);
}));

router.get('/login-logs', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const { error, value } = loginLogQuerySchema.validate(req.query, { stripUnknown: true, convert: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const data = db.readDb();
  const fromTime = value.from ? new Date(value.from).getTime() : null;
  const toTime = value.to ? new Date(value.to).getTime() + 24 * 60 * 60 * 1000 - 1 : null;
  const usernameKeyword = value.username.trim().toLowerCase();
  const browserKeyword = value.browser.trim().toLowerCase();
  const ipKeyword = value.ip.trim().toLowerCase();

  const logs = (data.loginLogs || [])
    .filter(log => {
      const timestamp = new Date(log.timestamp).getTime();
      const browserText = [
        log.browserInfo?.summary,
        log.browserInfo?.browser,
        log.browserInfo?.os,
        log.browserInfo?.device,
        log.userAgent
      ].filter(Boolean).join(' ').toLowerCase();

      if (value.role !== 'all' && log.role !== value.role) return false;
      if (value.success !== 'all' && String(Boolean(log.success)) !== value.success) return false;
      if (usernameKeyword) {
        const userText = `${log.username || ''} ${log.name || ''}`.toLowerCase();
        if (!userText.includes(usernameKeyword)) return false;
      }
      if (browserKeyword && !browserText.includes(browserKeyword)) return false;
      if (ipKeyword && !String(log.ip || '').toLowerCase().includes(ipKeyword)) return false;
      if (fromTime && timestamp < fromTime) return false;
      if (toTime && timestamp > toTime) return false;
      return true;
    })
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, value.limit);
  res.json(logs);
}));

router.get('/export-xls', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const data = db.readDb();
  const tasks = data.tasks || [];
  const designers = data.designers || [];
  const exportSheets = tasks.filter(sheetHasData);

  if (exportSheets.length === 0) {
    return res.status(404).json({ message: '没有可导出的数据' });
  }

  const monthGroups = new Map();
  exportSheets.forEach(sheet => {
    const key = `${sheet.year}-${String(sheet.month).padStart(2, '0')}`;
    if (!monthGroups.has(key)) monthGroups.set(key, []);
    monthGroups.get(key).push(sheet);
  });

  const xml = buildExcelXml(monthGroups, designers);
  const buffer = Buffer.from(xml, 'utf8');
  const filename = `obara-tasks-${formatDownloadTimestamp()}.xls`;
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}));

router.post('/import-xls', [authMiddleware, superAdminMiddleware, upload.single('file')], asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  if (!req.file) {
    return res.status(400).json({ message: '请上传 xls/xlsx 文件' });
  }

  const targetMonth = normalizeMonthValue(req.body.month);
  if (!targetMonth) {
    return res.status(400).json({ message: '请选择要导入覆盖的月份（格式：YYYY-MM）' });
  }

  let workbook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellStyles: true });
  } catch {
    workbook = null;
  }

  const data = db.readDb();
  if (!data.tasks) data.tasks = [];
  const designers = data.designers || [];
  const designerByName = new Map(designers.map(d => [String(d.name || '').trim(), d]));
  const skippedDesigners = new Set();

  let importedRows = 0;
  const mergedSheetMap = new Map();

  if (workbook) {
    workbook.SheetNames.forEach(sheetName => {
      const parsed = parseMonthFromSheetName(sheetName);
      if (parsed && (parsed.year !== targetMonth.year || parsed.month !== targetMonth.month)) return;

      const worksheet = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
      if (rawRows.length <= 2) return;

      const parsedRendered = parseRenderedExportSheet({
        worksheet,
        rawRows,
        targetMonth,
        designerByName,
        skippedDesigners
      });

      importedRows += parsedRendered.importedRows;
      parsedRendered.sheetMap.forEach((sheet, designerId) => {
        if (!mergedSheetMap.has(designerId)) {
          mergedSheetMap.set(designerId, {
            designerId,
            month: targetMonth.month,
            year: targetMonth.year,
            days: {}
          });
        }

        const merged = mergedSheetMap.get(designerId);
        Object.entries(sheet.days || {}).forEach(([date, items]) => {
          if (!merged.days[date]) merged.days[date] = [];
          merged.days[date] = merged.days[date].concat(items);
        });
      });
    });
  } else {
    const htmlTables = parseHtmlExportTables(req.file.buffer);
    if (htmlTables.length === 0) {
      return res.status(400).json({ message: '无法解析表格文件，请检查格式' });
    }

    htmlTables.forEach(table => {
      const rawRows = table.rawRows || [];
      const parsedRendered = parseRenderedExportSheet({
        worksheet: table.worksheet,
        rawRows,
        targetMonth,
        designerByName,
        skippedDesigners
      });

      importedRows += parsedRendered.importedRows;
      parsedRendered.sheetMap.forEach((sheet, designerId) => {
        if (!mergedSheetMap.has(designerId)) {
          mergedSheetMap.set(designerId, {
            designerId,
            month: targetMonth.month,
            year: targetMonth.year,
            days: {}
          });
        }

        const merged = mergedSheetMap.get(designerId);
        Object.entries(sheet.days || {}).forEach(([date, items]) => {
          if (!merged.days[date]) merged.days[date] = [];
          merged.days[date] = merged.days[date].concat(items);
        });
      });
    });
  }

  if (mergedSheetMap.size === 0) {
    return res.status(400).json({
      message: `文件中没有可导入的 ${targetMonth.key} 数据，请确认导入格式与系统导出的 xls 一致`,
      skippedDesigners: [...skippedDesigners],
      elapsedMs: Date.now() - startedAt
    });
  }

  mergedSheetMap.forEach((importedSheet, designerId) => {
    if (!sheetHasData(importedSheet)) return;

    const existingIndex = data.tasks.findIndex(
      t => t.designerId === designerId && t.month === targetMonth.month && t.year === targetMonth.year
    );
    const normalized = {
      id: `sheet-${designerId}-${targetMonth.year}-${targetMonth.month}`,
      designerId,
      month: targetMonth.month,
      year: targetMonth.year,
      days: importedSheet.days
    };

    if (existingIndex >= 0) {
      data.tasks[existingIndex] = normalized;
    } else {
      data.tasks.push(normalized);
    }
  });

  await db.writeDb(data);

  const io = req.app.get('io');
  if (io) io.emit('task_refreshed');

  res.json({
    message: '导入成功',
    importedMonths: [targetMonth.key],
    importedRows,
    skippedDesigners: [...skippedDesigners],
    elapsedMs: Date.now() - startedAt
  });
}));

module.exports = router;
