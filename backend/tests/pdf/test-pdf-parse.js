const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

function isSkipDataLine(line) {
  var s = (line || '').trim();
  if (!s) return true;
  if (/^[\u2713\u2610\u25a1\u2611\uf0fc\u2705\u270b\s]+$/.test(s)) return true;
  return false;
}

function parseDateQuantityLine(line) {
  var dateStr = '';
  var qtyStr = '';
  var parts = line.split(/\s+/);
  for (var i = 0; i < parts.length; i++) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(parts[i])) {
      dateStr = parts[i];
    } else if (/^\d+$/.test(parts[i])) {
      qtyStr = parts[i];
    }
  }
  return { dateStr, qtyStr };
}

async function extractSpecInfoFromPdf(pdfPath) {
  try {
    var buf = fs.readFileSync(pdfPath);
    var pdf = new PDFParse({data: buf});
    var textResult = await pdf.getText();
    var t = (textResult && textResult.text) || '';
    
    var info = {
      specNumber: '',
      middleMan: '',
      finalClient: '',
      projectName: '',
      quantity: '',
      deliveryDate: null,
      salesPerson: '',
      isModification: false,
      clientName: ''
    };

    var lines = t.split('\n').map(l => l.trim()).filter(l => l);
    var headerText = lines.slice(0, 3).join('');
    info.isModification = headerText.includes('客户仕样书') && headerText.includes('修改');

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      var specNumMatch = line.match(/计划编号.*?(\d{5,})/);
      if (specNumMatch) {
        info.specNumber = specNumMatch[1];
      }

      var projectNameMatch = line.match(/项目名称\s+(.+)/);
      if (projectNameMatch) {
        info.projectName = projectNameMatch[1].trim();
      }

      if (line.includes('最终客户') && line.includes('中间商')) {
        if (lines[i + 1]) {
          var planMatch = lines[i + 1].match(/(\d{5,})/);
          if (planMatch) info.specNumber = planMatch[1];
        }

        var dataLines = [];
        for (var dj = i + 2; dj < lines.length && dj < i + 15; dj++) {
          var dataLine = lines[dj];
          if (!dataLine) continue;
          if (dataLine.includes('营业担当') && dataLine.includes('营业审核')) {
            break;
          }
          if (dataLine.includes('技术审核')) break;
          if (isSkipDataLine(dataLine)) continue;
          dataLines.push(dataLine);
        }

        var dateQtyLineIndex = -1;
        for (var k = 0; k < dataLines.length; k++) {
          var dq = parseDateQuantityLine(dataLines[k]);
          if (dq.dateStr || dq.qtyStr) {
            dateQtyLineIndex = k;
            if (dq.dateStr) {
              info.deliveryDate = dq.dateStr;
            }
            if (dq.qtyStr) info.quantity = dq.qtyStr;
            break;
          }
        }

        if (dateQtyLineIndex >= 1) {
          var prevLine = dataLines[dateQtyLineIndex - 1].trim();
          var dateQtyLine = dataLines[dateQtyLineIndex].trim();
          
          if (!prevLine.includes('')) {
            if (/^\d{11}/.test(dateQtyLine)) {
              if (dateQtyLineIndex >= 2) {
                var twoLinesAbove = dataLines[dateQtyLineIndex - 2].trim();
                if (!/^[\u4e00-\u9fa5]{2,4}$/.test(twoLinesAbove) && !twoLinesAbove.includes('')) {
                  info.middleMan = twoLinesAbove;
                }
              }
            } else {
              info.middleMan = prevLine;
            }
          }
        }

        var finalClientCandidates = [];
        var salesPersonCandidates = [];
        
        if (dateQtyLineIndex >= 0) {
          for (var k = dateQtyLineIndex + 1; k < dataLines.length; k++) {
            var dl = dataLines[k].trim();
            
            if (dl.includes('总图号') || dl.includes('总审核') || dl.includes('总品号') || 
                dl.includes('总工时') || dl.includes('总设计类型') || dl.includes('控制2设计') || dl.includes('控制1设计')) {
              continue;
            }
            
            if (dl.includes('设计') || dl.includes('项目')) {
              if (!info.projectName) {
                info.projectName = dl;
              }
              continue;
            }
            
            var parts = dl.split(/\s{2,}|\t/).filter(p => p.trim());
            for (var p = 0; p < parts.length; p++) {
              var part = parts[p].trim();
              if (part && !part.includes('')) {
                if (/^[\u4e00-\u9fa5]{2,4}$/.test(part) && !part.includes('技术') && !part.includes('审核')) {
                  salesPersonCandidates.push({ text: part, position: k });
                } else {
                  finalClientCandidates.push({ text: part, position: k });
                }
              }
            }
          }
        }

        if (finalClientCandidates.length > 0) {
          info.finalClient = finalClientCandidates[0].text;
        }
        
        if (salesPersonCandidates.length > 0) {
          info.salesPerson = salesPersonCandidates[salesPersonCandidates.length - 1].text;
        }
        
        if (!info.finalClient && salesPersonCandidates.length >= 2) {
          info.finalClient = salesPersonCandidates[0].text;
          info.salesPerson = salesPersonCandidates[salesPersonCandidates.length - 1].text;
        }
        
        if (info.salesPerson) {
          info.salesPerson = info.salesPerson.replace(/^[A-Za-z]+\s*/, '').trim();
        }
      }
    }

    var n = info.specNumber;
    if (info.middleMan && info.finalClient && info.projectName) {
      info.clientName = `${n}>${info.middleMan}_${info.finalClient}-${info.projectName}`;
    } else if (info.middleMan && info.finalClient) {
      info.clientName = `${n}>${info.middleMan}_${info.finalClient}`;
    } else if (info.middleMan && info.projectName) {
      info.clientName = `${n}>${info.middleMan}-${info.projectName}`;
    } else if (info.middleMan) {
      info.clientName = `${n}>${info.middleMan}`;
    } else if (info.finalClient && info.projectName) {
      info.clientName = `${n}>${info.finalClient}-${info.projectName}`;
    } else if (info.finalClient) {
      info.clientName = `${n}>${info.finalClient}`;
    }

    return info;
  } catch(e) {
    console.error('extractSpecInfoFromPdf error:', e);
    return null;
  }
}

async function main() {
  const pdfDir = '../../templates/spec-pdf';
  const files = fs.readdirSync(pdfDir).filter(f => f.endsWith('.PDF'));
  
  console.log('='.repeat(100));
  console.log('PDF文件解析结果');
  console.log('='.repeat(100));
  console.log(`\n${'文件名'.padEnd(20)} | ${'客户名称'.padEnd(50)} | ${'数量'.padEnd(6)} | ${'纳期'.padEnd(12)} | ${'营业担当'.padEnd(8)} | ${'是否修改'}`);
  console.log('-'.repeat(100));
  
  for (const file of files) {
    const pdfPath = path.join(pdfDir, file);
    const info = await extractSpecInfoFromPdf(pdfPath);
    
    if (info) {
      const fileName = file.padEnd(20);
      const clientName = (info.clientName || '').padEnd(50);
      const quantity = (info.quantity || '').padEnd(6);
      const deliveryDate = (info.deliveryDate || '').padEnd(12);
      const salesPerson = (info.salesPerson || '').padEnd(8);
      const isModification = info.isModification ? '是' : '否';
      
      console.log(`${fileName} | ${clientName} | ${quantity} | ${deliveryDate} | ${salesPerson} | ${isModification}`);
    } else {
      console.log(`${file.padEnd(20)} | 解析失败`);
    }
  }
  
  console.log('\n' + '='.repeat(100));
}

main().catch(console.error);