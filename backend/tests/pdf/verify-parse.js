// 临时验证脚本：对全部仕样书PDF运行5类专用解析规则，输出结果供人工核对
const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');
const specPdfParser = require('../../utils/specPdfParser');

// 人工核对用的期望值（基于对PDF原始文本的分析）
const EXPECTED = {
  '57475.04.PDF': { specNumber: '57475', middleMan: '鑫燕隆', finalClient: '埃及MMM', projectName: 'S05&S06', quantity: '80', deliveryDate: '2026-11-10', salesPerson: '茅舒', isModification: false },
  '57597.01.PDF': { specNumber: '57597', middleMan: 'O/IND', finalClient: 'RNAIPL-RB3K2', projectName: '260801-04', quantity: '90', deliveryDate: '2026-09-30', salesPerson: '吴露鹭', isModification: false },
  '55526.03.PDF': { specNumber: '55526', middleMan: '', finalClient: '宁德振华', projectName: 'AS5PR项目（上奥）', quantity: '22', deliveryDate: '2026-05-06', salesPerson: '熊飞', isModification: false },
  '55606.03.PDF': { specNumber: '55606', middleMan: 'DEMC', finalClient: '通用金桥新厂', projectName: 'UR060增加焊枪', quantity: '2', deliveryDate: '2026-05-18', salesPerson: '沈雨帆', isModification: false },
  '55862.03.PDF': { specNumber: '55862', middleMan: '中汽工程', finalClient: '上汽金桥', projectName: 'SHD', quantity: '80', deliveryDate: '2026-07-15', salesPerson: '梁科研', isModification: true },
  '57868.02.PDF': { specNumber: '57868', middleMan: '上海晓奥', finalClient: '吉利白俄罗斯', projectName: 'SX21二期', quantity: '14', deliveryDate: '2026-11-05', salesPerson: '李守健', isModification: false },
  '56735.02.PDF': { specNumber: '56735', middleMan: '南京凯微', finalClient: '上汽郑州一厂', projectName: 'ZS32PHEV', quantity: '5', deliveryDate: '2026-08-03', salesPerson: '梁科研', isModification: true },
  '56750.03.PDF': { specNumber: '56750', middleMan: 'O/IND', finalClient: 'JBM SANAND-NEEL METAL-TATA', projectName: '260525-06', quantity: '14', deliveryDate: '2026-07-30', salesPerson: '吴露鹭', isModification: false },
  '56956.02.PDF': { specNumber: '56956', middleMan: '安川首钢上海分公司', finalClient: '', projectName: '26-SR5287 T60纵梁焊钳', quantity: '9', deliveryDate: '2026-07-20', salesPerson: '吴方盛', isModification: false },
  '56985.03.PDF': { specNumber: '56985', middleMan: '', finalClient: '宁德振华', projectName: 'AS5PM项目（上奥）', quantity: '29', deliveryDate: '2026-07-28', salesPerson: '熊飞', isModification: false },
  '57048.01.PDF': { specNumber: '57048', middleMan: '东风设备', finalClient: '东风股份', projectName: '27款小VAN车', quantity: '6', deliveryDate: '2026-09-01', salesPerson: '贾银鑫', isModification: false },
  '57153.01.PDF': { specNumber: '57153', middleMan: '合肥普格思', finalClient: '安徽江淮', projectName: '', quantity: '2', deliveryDate: '2026-07-29', salesPerson: '王会永', isModification: true },
  '57157.01.PDF': { specNumber: '57157', middleMan: 'O/IND', finalClient: 'JBM-PUNE-Z121', projectName: '260211-03', quantity: '3', deliveryDate: '2026-07-29', salesPerson: '吴露鹭', isModification: false },
  '57278.03.PDF': { specNumber: '57278', middleMan: '广西原南', finalClient: '上汽通用五菱', projectName: 'EQ100RMCE', quantity: '12', deliveryDate: '2026-09-02', salesPerson: '郭涛', isModification: false },
  '57908.02.PDF': { specNumber: '57908', middleMan: 'O/FRA', finalClient: 'STELLANTIS SPAIN', projectName: 'P1J C-26-08-5618', quantity: '25', deliveryDate: '2026-10-20', salesPerson: '张晟隽', isModification: false },
  '57195.03.PDF': { specNumber: '57195', middleMan: '', finalClient: '福建元晟', projectName: 'LPH项目468', quantity: '5', deliveryDate: '2026-07-23', salesPerson: '吴方盛', isModification: false }
};

async function main() {
  const pdfDir = path.join(__dirname, '..', '..', 'templates', 'spec-pdf');
  const files = fs.readdirSync(pdfDir).filter(f => f.endsWith('.PDF')).sort();

  var passCount = 0;
  var failCount = 0;

  for (const file of files) {
    const buf = fs.readFileSync(path.join(pdfDir, file));
    const pdf = new PDFParse({ data: buf });
    const textResult = await pdf.getText();
    await pdf.destroy();
    const t = (textResult && textResult.text) || '';
    const lines = t.split('\n').map(l => l.trim()).filter(l => l);

    const category = specPdfParser.detectSpecCategory(lines);
    const info = category ? specPdfParser.extractSpecInfoByCategory(lines, category) : null;

    const exp = EXPECTED[file] || {};
    const problems = [];
    if (!category) problems.push('类别未命中');
    if (!info) problems.push('解析返回空');
    if (info) {
      const dstr = info.deliveryDate ? (info.deliveryDate.year + '-' + String(info.deliveryDate.month).padStart(2, '0') + '-' + String(info.deliveryDate.day).padStart(2, '0')) : null;
      const actual = {
        specNumber: info.specNumber, middleMan: info.middleMan, finalClient: info.finalClient,
        projectName: info.projectName, quantity: info.quantity, deliveryDate: dstr,
        salesPerson: info.salesPerson, isModification: info.isModification
      };
      for (const key of Object.keys(exp)) {
        if ((actual[key] || '') !== (exp[key] || '')) {
          problems.push(key + ': 期望[' + exp[key] + '] 实际[' + actual[key] + ']');
        }
      }
    }

    if (problems.length === 0) passCount++;
    else failCount++;

    console.log((problems.length === 0 ? 'PASS' : 'FAIL') + ' | ' + file + ' | 类别=' + category +
      ' | 客户名=' + (info ? [info.middleMan, info.finalClient].filter(Boolean).join('_') + (info.projectName ? '-' + info.projectName : '') : ''));
    for (const p of problems) console.log('       -> ' + p);
  }

  console.log('\n通过 ' + passCount + ' / ' + files.length + '，失败 ' + failCount);
}

main().catch(e => { console.error(e); process.exit(1); });
