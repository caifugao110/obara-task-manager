const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

async function debugPdf(pdfPath) {
  try {
    var buf = fs.readFileSync(pdfPath);
    var pdf = new PDFParse({data: buf});
    var textResult = await pdf.getText();
    var t = (textResult && textResult.text) || '';
    
    var lines = t.split('\n').map(l => l.trim()).filter(l => l);
    
    console.log(`\n=== ${path.basename(pdfPath)} ===`);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.includes('最终客户') || line.includes('中间商') || line.includes('营业担当') || 
          line.includes('技术审核') || line.includes('纳期') || line.includes('数量') ||
          /^\d{4}-\d{2}-\d{2}$/.test(line) || /^\d+$/.test(line)) {
        console.log(`[${i}] "${line}"`);
      }
    }
    
    var dataSectionFound = false;
    console.log('\n--- 数据区域 (完整) ---');
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].includes('最终客户') && lines[i].includes('中间商')) {
        dataSectionFound = true;
        for (var j = i; j < Math.min(i + 20, lines.length); j++) {
          console.log(`[${j}] "${lines[j]}"`);
        }
        break;
      }
    }
    
    if (!dataSectionFound) {
      console.log('未找到数据区域');
    }
  } catch(e) {
    console.error('debugPdf error:', e);
  }
}

async function main() {
  const pdfDir = '../../templates/spec-pdf';
  const files = ['55862.03.PDF', '56735.02.PDF', '57048.01.PDF', '57153.01.PDF', '55606.03.PDF'];
  
  for (const file of files) {
    const pdfPath = path.join(pdfDir, file);
    await debugPdf(pdfPath);
  }
}

main().catch(console.error);