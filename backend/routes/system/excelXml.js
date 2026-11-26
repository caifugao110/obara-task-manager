'use strict';
/**
 * Excel XML（SpreadsheetML）版导出：带样式表的工作簿，用 XLSX 生成后按表头高度与样式索引打补丁。
 *
 * 由 backend/routes/system/excel.js 拆分而来，代码为原样搬运（未改逻辑）。
 */
const XLSX = require('xlsx');
const { getEffectiveIsWeekend } = require('../../utils/workday');
const { sanitizeAoaRows } = require('../../utils/fileUploadSecurity');
const { FIRST_HEADER_ROW_HEIGHT, calculateDailyTotal, formatDate, formatHour, getDayName, getDaysInMonth } = require('./excelShared');
const { renderTaskLines } = require('./excelHtml');
const { normalizeColor } = require('./excelImport');

const cellKey = (row, col) => `${row}:${col}`;

const buildMonthWorkbookData = (monthSheets, designers, year, month, workdayOverrides = {}) => {
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
    const isWeekend = getEffectiveIsWeekend(formatDate(year, month, day), workdayOverrides);
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

const buildExcelXml = (monthGroups, designers, workdayOverrides = {}) => {
  const workbook = XLSX.utils.book_new();
  const sheetStyleMaps = new Map();
  const allStyleIds = new Set();

  [...monthGroups.keys()].sort().forEach(key => {
    const [year, month] = key.split('-').map(Number);
    const { rows, merges, styleMap } = buildMonthWorkbookData(monthGroups.get(key), designers, year, month, workdayOverrides);
    const worksheet = XLSX.utils.aoa_to_sheet(sanitizeAoaRows(rows));
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

module.exports = {
  cellKey,
  buildMonthWorkbookData,
  buildStyleDefinitions,
  patchXlmlWorksheetOptions,
  patchXlmlStyles,
  patchXlmlCellStyles,
  buildExcelXml,
};
