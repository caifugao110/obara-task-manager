const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

async function extractSpecInfoFromPdf(pdfPath) {
  try {
    var buf = fs.readFileSync(pdfPath);
    var pdf = new PDFParse({data: buf});
    var textResult = await pdf.getText();
    var t = (textResult && textResult.text) || '';
    var lines = t.split('\n').map(l => l.trim()).filter(l => l);
    
    console.log(`\n=== ${path.basename(pdfPath)} ===`);
    console.log('--- 所有行 ---');
    
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      console.log(`${i}: "${line}"`);
      
      if (line.includes('最终客户') && line.includes('中间商')) {
        console.log('\n--- 数据区域 ---');
        for (var dj = i; dj < lines.length && dj < i + 15; dj++) {
          var dataLine = lines[dj];
          if (!dataLine) continue;
          console.log(`${dj}: "${dataLine}"`);
          if (dataLine.includes('营业担当') && dataLine.includes('营业审核')) break;
          if (dataLine.includes('技术审核')) break;
        }
        break;
      }
    }
    
  } catch(e) {
    console.error('extractSpecInfoFromPdf error:', e);
  }
}

async function main() {
  const pdfDir = '../../templates/spec-pdf';
  const files = fs.readdirSync(pdfDir).filter(f => f.endsWith('.PDF'));
  
  for (const file of files) {
    const pdfPath = path.join(pdfDir, file);
    await extractSpecInfoFromPdf(pdfPath);
  }
}

main().catch(console.error);