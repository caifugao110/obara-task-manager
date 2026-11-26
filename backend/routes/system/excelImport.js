'use strict';
/**
 * 导出文件的反解析：把导出的 HTML / xls 再读回来（识别设计员、日期列、请假行、枪名行）。
 * 之所以自己写，是因为文件常被手工改过，不能只认自己生成的那一份。
 *
 * 由 backend/routes/system/excel.js 拆分而来，代码为原样搬运（未改逻辑）。
 */
const XLSX = require('xlsx');
const crypto = require('crypto');
const { formatDate, getDaysInMonth, parseNumber, sheetHasData } = require('./excelShared');

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

module.exports = {
  normalizeMonthValue,
  getCellText,
  getRenderedDayCount,
  isGroupRow,
  normalizeColor,
  getCellBackground,
  decodeHtmlEntities,
  htmlCellToText,
  getAttr,
  getStyleBackground,
  parseHtmlExportTables,
  getLeaveTypeFromLabel,
  createImportedItem,
  isImportedItemMeaningful,
  finishPendingImportedItem,
  parseRenderedExportSheet,
};
