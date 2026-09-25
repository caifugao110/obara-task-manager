// 焊枪编号台账导出：将分类数据构建为 SpreadsheetML(.xls) 工作簿。
// 布局约定：每张表对应一个工作表（sheet 名为表名），整个分类构成一个工作簿。
// 每个工作表结构：第 0 行列表头（序号/焊枪名/客户/时间/担当/备注），其余为数据行。
const XLSX = require('xlsx');

const HEADERS = ['序号', '焊枪名', '客户', '时间', '担当', '备注'];
const COL_WIDTHS = [
  { wpx: 56 },
  { wpx: 120 },
  { wpx: 420 },
  { wpx: 96 },
  { wpx: 80 },
  { wpx: 220 }
];

const HEADER_HEIGHT = 24;
const DATA_HEIGHT = 20;
const NOTE_HEIGHT = 22;

const cellKey = (row, col) => `${row}:${col}`;

// 文件名安全片段：去掉 Windows 非法字符（分类名校验仅拦截了 / 与 \）
const safeFilePart = (name) => String(name || '')
  .replace(/[\\/:*?"<>|]/g, '_')
  .replace(/\s+/g, ' ')
  .trim() || 'untitled';

// 工作表名基础清洗：最长 31 字符且不能包含 :\/?*[]（不处理重名）
const sanitizeSheetBase = (name) => {
  const base = Array.from(String(name || '未命名'))
    .slice(0, 31)
    .join('')
    .replace(/[\\/?*[\]:]/g, '_');
  return base || '未命名';
};

// 工作表名：清洗后同名自动追加 ~n 去重
const makeSheetName = (preferred, usedNames) => {
  const base = sanitizeSheetBase(preferred);
  let candidate = base;
  let seq = 1;
  while (usedNames.has(candidate)) {
    const suffix = `~${seq}`;
    candidate = `${Array.from(base).slice(0, 31 - suffix.length).join('')}${suffix}`;
    seq += 1;
  }
  usedNames.add(candidate);
  return candidate;
};

// 跨分类重名时：使用「分类-表名」形式，优先保留表名（截短分类）
const makePrefixedSheetName = (category, tableName, usedNames) => {
  const cat = Array.from(String(category || ''));
  const tn = Array.from(String(tableName || ''));
  const sep = '-';
  let preferred;
  if (cat.length + sep.length + tn.length <= 31) {
    preferred = `${cat.join('')}${sep}${tn.join('')}`;
  } else {
    const room = 31 - sep.length - tn.length;
    if (room >= 3) preferred = `${cat.slice(0, room).join('')}${sep}${tn.join('')}`;
    else preferred = tn.slice(0, 31).join('');
  }
  return makeSheetName(preferred, usedNames);
};

// 行数据归一化：字段转字符串，序号取数值，按序号升序（DB 已保证 1..N 连续）
const normalizeTableRows = (rows = []) => rows
  .map((r, index) => ({
    serialNumber: Number.isFinite(Number(r?.serialNumber)) ? Number(r.serialNumber) : index + 1,
    gunName: String(r?.gunName || ''),
    customer: String(r?.customer || ''),
    time: String(r?.time || ''),
    responsiblePerson: String(r?.responsiblePerson || ''),
    remarks: String(r?.remarks || '')
  }))
  .sort((a, b) => a.serialNumber - b.serialNumber);

const getCategories = (gunLedger) => Object.keys(gunLedger?.categories || {});

// 单张表的工作表布局
const buildTableLayout = (table) => {
  const aoaRows = [HEADERS.slice()];
  const styleMap = new Map();
  const rowHeights = new Map();

  for (let col = 0; col < HEADERS.length; col += 1) {
    styleMap.set(cellKey(0, col), 'gheader');
  }
  rowHeights.set(0, HEADER_HEIGHT);

  const dataRows = normalizeTableRows(table.rows);
  if (!dataRows.length) {
    aoaRows.push(['暂无记录', '', '', '', '', '']);
    for (let col = 0; col < HEADERS.length; col += 1) {
      styleMap.set(cellKey(1, col), 'gnote');
    }
    rowHeights.set(1, NOTE_HEIGHT);
    return { aoaRows, styleMap, rowHeights };
  }

  dataRows.forEach((data, index) => {
    const row = index + 1;
    const even = index % 2 === 0;
    const centerStyle = even ? 'gdata' : 'gdataA';
    const leftStyle = even ? 'gdataL' : 'gdataLA';
    aoaRows.push([
      data.serialNumber,
      data.gunName,
      data.customer,
      data.time,
      data.responsiblePerson,
      data.remarks
    ]);
    styleMap.set(cellKey(row, 0), centerStyle);
    styleMap.set(cellKey(row, 1), centerStyle);
    styleMap.set(cellKey(row, 2), leftStyle);
    styleMap.set(cellKey(row, 3), centerStyle);
    styleMap.set(cellKey(row, 4), centerStyle);
    styleMap.set(cellKey(row, 5), leftStyle);
    rowHeights.set(row, DATA_HEIGHT);
  });

  return { aoaRows, styleMap, rowHeights };
};

// 空分类提示工作表的布局（表头 + 单条提示）
const buildEmptyCategoryLayout = () => {
  const aoaRows = [HEADERS.slice(), ['该分类下暂无表格', '', '', '', '', '']];
  const styleMap = new Map();
  const rowHeights = new Map();
  for (let col = 0; col < HEADERS.length; col += 1) {
    styleMap.set(cellKey(0, col), 'gheader');
    styleMap.set(cellKey(1, col), 'gnote');
  }
  rowHeights.set(0, HEADER_HEIGHT);
  rowHeights.set(1, NOTE_HEIGHT);
  return { aoaRows, styleMap, rowHeights };
};

// 追加一个「表 → 工作表」
const appendTableSheet = (workbook, sheetName, table, usedNames, sheetInfoMap) => {
  const name = makeSheetName(sheetName, usedNames);
  const layout = buildTableLayout(table);
  const worksheet = XLSX.utils.aoa_to_sheet(layout.aoaRows);
  worksheet['!cols'] = COL_WIDTHS;
  XLSX.utils.book_append_sheet(workbook, worksheet, name);
  sheetInfoMap.set(name, { layout });
};

const borderXml = [
  '<Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFBFBF"/>',
  '<Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFBFBF"/>',
  '<Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFBFBF"/>',
  '<Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFBFBF"/>'
].join('');

const buildStyleDefinitions = () => {
  const borders = `<Borders>${borderXml}</Borders>`;
  const style = (id, inner) => `<Style ss:ID="${id}">${inner}</Style>`;

  return [
    // 列表头
    style('gheader', [
      '<Alignment ss:Horizontal="Center" ss:Vertical="Center"/>',
      borders,
      '<Font ss:Bold="1" ss:Color="#FFFFFF"/>',
      '<Interior ss:Color="#305496" ss:Pattern="Solid"/>',
      '<NumberFormat ss:Format="General"/>'
    ].join('')),
    // 数据行（居中，白底/浅蓝斑马纹）
    style('gdata', [
      '<Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>',
      borders,
      '<Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>',
      '<NumberFormat ss:Format="General"/>'
    ].join('')),
    style('gdataA', [
      '<Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>',
      borders,
      '<Interior ss:Color="#F2F7FC" ss:Pattern="Solid"/>',
      '<NumberFormat ss:Format="General"/>'
    ].join('')),
    // 数据行（左对齐换行：客户、备注）
    style('gdataL', [
      '<Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1" ss:Indent="1"/>',
      borders,
      '<Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>',
      '<NumberFormat ss:Format="General"/>'
    ].join('')),
    style('gdataLA', [
      '<Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1" ss:Indent="1"/>',
      borders,
      '<Interior ss:Color="#F2F7FC" ss:Pattern="Solid"/>',
      '<NumberFormat ss:Format="General"/>'
    ].join('')),
    // 空提示行
    style('gnote', [
      '<Alignment ss:Horizontal="Center" ss:Vertical="Center"/>',
      borders,
      '<Font ss:Italic="1" ss:Color="#7F8C8D"/>',
      '<Interior ss:Color="#F8F9FA" ss:Pattern="Solid"/>',
      '<NumberFormat ss:Format="General"/>'
    ].join(''))
  ].join('');
};

const patchStyles = (xml) => xml.replace('</Styles>', `${buildStyleDefinitions()}</Styles>`);

// 按样式表为每个单元格注入 ss:StyleID，并按行设置固定高度
const patchCellsAndRows = (xml, sheetInfoMap) => {
  const worksheetRegex = /<Worksheet ss:Name="([^"]+)">([\s\S]*?)<\/Worksheet>/g;
  return xml.replace(worksheetRegex, (worksheetXml, sheetName, worksheetBody) => {
    const info = sheetInfoMap.get(sheetName);
    if (!info) return worksheetXml;

    let rowIndex = -1;
    const patchedBody = worksheetBody.replace(/<Row\b([^>]*)>([\s\S]*?)<\/Row>/g, (_rowXml, rowAttrs, rowBody) => {
      const rowIndexMatch = rowAttrs.match(/ss:Index="(\d+)"/);
      rowIndex = rowIndexMatch ? parseInt(rowIndexMatch[1], 10) - 1 : rowIndex + 1;

      let colIndex = -1;
      const patchedCells = rowBody.replace(/<Cell\b([^>]*)>/g, (cellOpen, cellAttrs) => {
        const colIndexMatch = cellAttrs.match(/ss:Index="(\d+)"/);
        colIndex = colIndexMatch ? parseInt(colIndexMatch[1], 10) - 1 : colIndex + 1;
        const styleId = info.layout.styleMap.get(cellKey(rowIndex, colIndex));
        if (!styleId) return cellOpen;
        if (/ss:StyleID="[^"]*"/.test(cellAttrs)) {
          return `<Cell${cellAttrs.replace(/ss:StyleID="[^"]*"/, `ss:StyleID="${styleId}"`)}>`;
        }
        return `<Cell ss:StyleID="${styleId}"${cellAttrs}>`;
      });

      let nextAttrs = rowAttrs.replace(/\s+ss:(?:AutoFitHeight|Height)="[^"]*"/g, '');
      const height = info.layout.rowHeights.get(rowIndex);
      if (height) nextAttrs += ` ss:AutoFitHeight="0" ss:Height="${height}"`;
      return `<Row${nextAttrs}>${patchedCells}</Row>`;
    });

    return `<Worksheet ss:Name="${sheetName}">${patchedBody}</Worksheet>`;
  });
};

// 首行冻结：向每个工作表注入 SpreadsheetML 冻结窗格设置（冻结顶部 1 行）
const FREEZE_PANES_XML = '<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions>';

const patchFreezePanes = (xml) => xml.replace(/<\/Worksheet>/g, `${FREEZE_PANES_XML}</Worksheet>`);

const writeWorkbook = (sheetInfoMap, workbook) => {
  let xml = XLSX.write(workbook, { type: 'string', bookType: 'xlml' });
  xml = patchStyles(xml);
  xml = patchCellsAndRows(xml, sheetInfoMap);
  xml = patchFreezePanes(xml);
  return Buffer.from(xml, 'utf8');
};

// 单个分类 → 一个工作簿（每张表一个工作表；空分类给一个提示工作表）
const buildCategoryBuffer = (gunLedger, categoryName) => {
  const workbook = XLSX.utils.book_new();
  const usedNames = new Set();
  const sheetInfoMap = new Map();
  const tables = gunLedger?.categories?.[categoryName] || [];

  if (!tables.length) {
    const name = makeSheetName(categoryName, usedNames);
    const layout = buildEmptyCategoryLayout();
    const worksheet = XLSX.utils.aoa_to_sheet(layout.aoaRows);
    worksheet['!cols'] = COL_WIDTHS;
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
    sheetInfoMap.set(name, { layout });
  } else {
    tables.forEach((table) => appendTableSheet(workbook, table.name, table, usedNames, sheetInfoMap));
  }

  return writeWorkbook(sheetInfoMap, workbook);
};

// 全部分类 → 一个大工作簿（每张表一个工作表；跨分类重名时后出现者加分类前缀）
const buildCombinedBuffer = (gunLedger) => {
  const workbook = XLSX.utils.book_new();
  const usedNames = new Set();
  const sheetInfoMap = new Map();
  let tableCount = 0;

  getCategories(gunLedger).forEach((categoryName) => {
    const tables = gunLedger?.categories?.[categoryName] || [];
    tables.forEach((table) => {
      const plain = sanitizeSheetBase(table.name);
      if (!usedNames.has(plain)) {
        appendTableSheet(workbook, table.name, table, usedNames, sheetInfoMap);
      } else {
        const name = makePrefixedSheetName(categoryName, table.name, usedNames);
        const layout = buildTableLayout(table);
        const worksheet = XLSX.utils.aoa_to_sheet(layout.aoaRows);
        worksheet['!cols'] = COL_WIDTHS;
        XLSX.utils.book_append_sheet(workbook, worksheet, name);
        sheetInfoMap.set(name, { layout });
      }
      tableCount += 1;
    });
  });

  // 所有分类都没有表：补一个提示工作表，保证工作簿有效
  if (tableCount === 0) {
    const name = makeSheetName('说明', usedNames);
    const layout = buildEmptyCategoryLayout();
    const worksheet = XLSX.utils.aoa_to_sheet(layout.aoaRows);
    worksheet['!cols'] = COL_WIDTHS;
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
    sheetInfoMap.set(name, { layout });
  }

  return writeWorkbook(sheetInfoMap, workbook);
};

// 轻量摘要：供系统设置页面列出分类
const buildSummary = (gunLedger) => getCategories(gunLedger).map((categoryName) => {
  const tables = gunLedger?.categories?.[categoryName] || [];
  return {
    category: categoryName,
    tables: tables.length,
    rows: tables.reduce((sum, table) => sum + (Array.isArray(table.rows) ? table.rows.length : 0), 0)
  };
});

// ===== 导入解析 =====

// 文本字段安全处理：拦截公式注入，去掉首尾空白
const sanitizeImportText = (value) => {
  let text = String(value ?? '').trim();
  if (/^=|^\+|^-|^@/.test(text) || /^(?:cmd|exec|dde|external|hyperlink|im|mquery|odbc|ole|powerview|rtd|sheet|webservice|whatif)\s*\(/i.test(text)) {
    text = `'${text}`;
  }
  return text;
};

const normalizeHeaderLabel = (value) => String(value ?? '').replace(/\s/g, '');

/**
 * 解析导入的工作簿：每个工作表视为一张表（表名取 sheet 名）。
 * 要求工作表内含表头行（至少有“焊枪名”列），表头之后的行为数据。
 * @returns {{ tables: Array<{name:string, rows: GunRowDraft[]}>, warnings: string[] }}
 */
const parseImportedWorkbook = (workbook) => {
  const tables = [];
  const warnings = [];

  (workbook?.SheetNames || []).forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    const headerIndex = rawRows.findIndex(row => row.some(cell => normalizeHeaderLabel(cell).includes('焊枪名')));
    if (headerIndex === -1) {
      warnings.push(`工作表「${sheetName}」缺少表头（未找到“焊枪名”列），已跳过`);
      return;
    }

    const header = rawRows[headerIndex].map(normalizeHeaderLabel);
    const colOf = (label) => header.findIndex(h => h.includes(label));
    const iSerial = colOf('序号');
    const iGun = colOf('焊枪名');
    const iCustomer = colOf('客户');
    const iTime = colOf('时间');
    const iResp = colOf('担当');
    const iRemarks = colOf('备注');

    if (iGun === -1) {
      warnings.push(`工作表「${sheetName}」表头缺少“焊枪名”列，已跳过`);
      return;
    }

    const rows = [];
    rawRows.slice(headerIndex + 1).forEach((rawRow) => {
      const get = (i) => (i >= 0 ? sanitizeImportText(rawRow[i]) : '');
      const gunName = get(iGun);
      const customer = get(iCustomer);
      const time = get(iTime);
      const responsiblePerson = get(iResp);
      const remarks = get(iRemarks);
      // 整行全空则跳过
      if (!gunName && !customer && !time && !responsiblePerson && !remarks) return;
      const serialRaw = iSerial >= 0 ? String(rawRow[iSerial] ?? '').trim() : '';
      rows.push({
        serialNumber: /^\d+$/.test(serialRaw) ? parseInt(serialRaw, 10) : null,
        gunName,
        customer,
        time,
        responsiblePerson,
        remarks
      });
    });

    tables.push({ name: sheetName, rows });
  });

  return { tables, warnings };
};

module.exports = {
  safeFilePart,
  getCategories,
  buildSummary,
  buildCategoryBuffer,
  buildCombinedBuffer,
  parseImportedWorkbook,
  sanitizeImportText
};
