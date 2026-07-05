const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const getDisplayLength = (value) => {
  const text = value == null ? '' : String(value);
  return text.split(/\r?\n/).reduce((max, line) => {
    const length = Array.from(line).reduce((sum, char) => {
      return sum + (char.charCodeAt(0) > 255 ? 2 : 1);
    }, 0);
    return Math.max(max, length);
  }, 0);
};

const buildAutoColumns = (rows, options = {}) => {
  const min = options.min || 48;
  const max = options.max || 260;
  const charPx = options.charPx || 8;
  const padding = options.padding || 22;
  const columnCount = rows.reduce((maxCount, row) => Math.max(maxCount, row.length), 0);

  return Array.from({ length: columnCount }, (_, columnIndex) => {
    const maxLength = rows.reduce((length, row) => {
      return Math.max(length, getDisplayLength(row[columnIndex]));
    }, 0);
    return { wpx: clamp(maxLength * charPx + padding, min, max) };
  });
};

const borderXml = [
  '<Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9E2F3"/>',
  '<Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9E2F3"/>',
  '<Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9E2F3"/>',
  '<Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9E2F3"/>'
].join('');

const exportStyles = [
  '<Style ss:ID="exportHeader">',
  '<Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>',
  '<Font ss:Bold="1" ss:Color="#FFFFFF"/>',
  '<Interior ss:Color="#305496" ss:Pattern="Solid"/>',
  `<Borders>${borderXml}</Borders>`,
  '<NumberFormat ss:Format="General"/>',
  '</Style>',
  '<Style ss:ID="exportRowOdd">',
  '<Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>',
  '<Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>',
  `<Borders>${borderXml}</Borders>`,
  '<NumberFormat ss:Format="General"/>',
  '</Style>',
  '<Style ss:ID="exportRowEven">',
  '<Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>',
  '<Interior ss:Color="#EAF2F8" ss:Pattern="Solid"/>',
  `<Borders>${borderXml}</Borders>`,
  '<NumberFormat ss:Format="General"/>',
  '</Style>'
].join('');

const applyCellStyle = (rowXml, styleId) => {
  return rowXml.replace(/<Cell\b([^>]*)>/g, (_match, attrs) => {
    const cleanedAttrs = attrs.replace(/\s*ss:StyleID="[^"]*"/g, '');
    return `<Cell ss:StyleID="${styleId}"${cleanedAttrs}>`;
  });
};

const getFreezeOptions = (freezeFirstColumn) => {
  if (freezeFirstColumn) {
    return '<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><SplitVertical>1</SplitVertical><LeftColumnRightPane>1</LeftColumnRightPane><ActivePane>0</ActivePane><Panes><Pane><Number>3</Number></Pane><Pane><Number>1</Number></Pane><Pane><Number>2</Number><ActiveRow>0</ActiveRow></Pane><Pane><Number>0</Number><ActiveRow>1</ActiveRow><ActiveCol>1</ActiveCol></Pane></Panes></WorksheetOptions>';
  }

  return '<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane><Panes><Pane><Number>3</Number></Pane><Pane><Number>2</Number><ActiveRow>1</ActiveRow></Pane></Panes></WorksheetOptions>';
};

const applyExportStyles = (xml, options = {}) => {
  const freezeTopRow = options.freezeTopRow !== false;
  const freezeFirstColumn = Boolean(options.freezeFirstColumn);
  let rowNumber = 0;

  let styledXml = xml.replace('</Styles>', `${exportStyles}</Styles>`);
  styledXml = styledXml.replace(/<Row\b([^>]*)>([\s\S]*?)<\/Row>/g, (_match, attrs, cells) => {
    rowNumber += 1;
    const styleId = rowNumber === 1 ? 'exportHeader' : rowNumber % 2 === 0 ? 'exportRowOdd' : 'exportRowEven';
    const height = rowNumber === 1 ? 28 : 22;
    const rowAttrs = attrs.includes('ss:Height=') ? attrs : `${attrs} ss:AutoFitHeight="0" ss:Height="${height}"`;
    return `<Row${rowAttrs}>${applyCellStyle(cells, styleId)}</Row>`;
  });

  if (freezeTopRow) {
    styledXml = styledXml.replace(/<\/Worksheet>/g, `${getFreezeOptions(freezeFirstColumn)}</Worksheet>`);
  }

  return styledXml;
};

module.exports = {
  applyExportStyles,
  buildAutoColumns
};
