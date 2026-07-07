const path = require('path');
const XLSX = require('xlsx');

const ALLOWED_EXTENSIONS = ['.xls', '.xlsx'];
const ALLOWED_CONTENT_TYPES = [
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream'
];

const MALICIOUS_FORMULA_PATTERNS = [
  /^=.*[`'"]?(?:cmd|powershell|bash|sh|python|perl|ruby|php|node|wget|curl|ncat|nc|netcat|exec|system|eval)\s*[`'"]?/i,
  /^=.*[`'"]?(?:http|ftp|file|smb|\\\\)\s*[`'"]?/i,
  /^=.*(?:script:|javascript:|vbscript:|data:)/i,
  /^=.*[`'"]?(?:rm|del|erase|format|mkfs|chmod|chown)\s*[`'"]?/i,
  /^=.*[`'"]?(?:\|\||&&|;|\n|\r)\s*[`'"]?/i,
  /^=.*(?:GET|POST|PUT|DELETE)\s+/i,
  /^=.*(?:WScript\.Shell|Shell\.Application|ActiveXObject)/i,
  /^=.*(?:CreateObject|GetObject)/i
];

const MAX_ROWS = 10000;
const MAX_SHEETS = 10;
const MAX_CELLS_PER_ROW = 100;

function getFileExtension(filename) {
  if (!filename) return '';
  return path.extname(filename).toLowerCase();
}

function validateFileType(filename, mimetype) {
  const extension = getFileExtension(filename);
  
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return { valid: false, error: `不支持的文件类型: ${extension}，仅支持 .xls 和 .xlsx` };
  }
  
  if (mimetype && !ALLOWED_CONTENT_TYPES.includes(mimetype.toLowerCase())) {
    return { valid: false, error: `不支持的内容类型: ${mimetype}` };
  }
  
  return { valid: true };
}

function sanitizeCellValue(value) {
  if (typeof value !== 'string') return value;
  
  let sanitized = value.trim();
  
  if (MALICIOUS_FORMULA_PATTERNS.some(pattern => pattern.test(sanitized))) {
    return "'" + sanitized;
  }
  
  if (sanitized.startsWith('=') || sanitized.startsWith('+') || sanitized.startsWith('-') || sanitized.startsWith('@')) {
    return "'" + sanitized;
  }
  
  return sanitized;
}

function validateWorkbookStructure(workbook) {
  if (!workbook || !workbook.SheetNames) {
    return { valid: false, error: '无效的工作簿' };
  }
  
  if (workbook.SheetNames.length > MAX_SHEETS) {
    return { valid: false, error: `工作表数量超过限制（最大 ${MAX_SHEETS} 个）` };
  }
  
  let totalRows = 0;
  
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
    const rowCount = range.e.r + 1;
    
    if (rowCount > MAX_ROWS) {
      return { valid: false, error: `工作表 ${sheetName} 的行数超过限制（最大 ${MAX_ROWS} 行）` };
    }
    
    totalRows += rowCount;
    
    const colCount = range.e.c + 1;
    if (colCount > MAX_CELLS_PER_ROW) {
      return { valid: false, error: `工作表 ${sheetName} 的列数超过限制（最大 ${MAX_CELLS_PER_ROW} 列）` };
    }
  }
  
  return { valid: true };
}

function scanForMaliciousContent(workbook) {
  const maliciousCells = [];
  
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    
    for (let rowIndex = 0; rowIndex < rawRows.length; rowIndex++) {
      const row = rawRows[rowIndex];
      if (!Array.isArray(row)) continue;
      
      for (let colIndex = 0; colIndex < row.length; colIndex++) {
        const cellValue = String(row[colIndex] || '').trim();
        
        if (MALICIOUS_FORMULA_PATTERNS.some(pattern => pattern.test(cellValue))) {
          maliciousCells.push({
            sheet: sheetName,
            row: rowIndex + 1,
            col: String.fromCharCode(65 + colIndex),
            value: cellValue.substring(0, 100) + (cellValue.length > 100 ? '...' : '')
          });
        }
      }
    }
  }
  
  if (maliciousCells.length > 0) {
    return {
      safe: false,
      message: `检测到 ${maliciousCells.length} 个潜在恶意公式`,
      details: maliciousCells.slice(0, 10)
    };
  }
  
  return { safe: true };
}

function sanitizeWorkbook(workbook) {
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
    
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellAddress = XLSX.utils.encode_cell({ r, c });
        const cell = worksheet[cellAddress];
        
        if (cell && typeof cell.v === 'string') {
          const sanitized = sanitizeCellValue(cell.v);
          if (sanitized !== cell.v) {
            cell.v = sanitized;
            cell.t = 's';
            delete cell.f;
          }
        }
      }
    }
  }
  
  return workbook;
}

module.exports = {
  validateFileType,
  validateWorkbookStructure,
  scanForMaliciousContent,
  sanitizeWorkbook,
  sanitizeCellValue,
  MAX_ROWS,
  MAX_SHEETS,
  MAX_CELLS_PER_ROW
};