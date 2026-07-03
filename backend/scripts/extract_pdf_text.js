const fs = require('fs');
const path = require('path');

async function extractText() {
  const pdfPath = path.join(__dirname, '..', 'templates', 'spec-pdf', '57048.01.PDF');
  if (!fs.existsSync(pdfPath)) {
    console.log('PDF文件不存在:', pdfPath);
    return;
  }

  try {
    const pdfParseModule = require('pdf-parse');
    const PDFParse = pdfParseModule.PDFParse;
    const buf = fs.readFileSync(pdfPath);
    const pdf = new PDFParse({data: buf});
    const result = await pdf.getText();
    const text = result.text || '';
    
    console.log('=== PDF原始文本 ===');
    console.log(text);
    console.log('\n=== 按行分割 ===');
    const lines = text.split('\n').map((line, index) => `${index + 1}: "${line.trim()}"`);
    console.log(lines.join('\n'));
  } catch (e) {
    console.error('提取失败:', e);
  }
}

extractText();
