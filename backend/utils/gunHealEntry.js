/**
 * 焊枪编号台账 · 仕样自愈的比对结果构造（纯函数）
 *
 * 台账的「客户」列来自 /spec/spec-info 的 clientName（形如 `58249>O/客户名-项目名`），
 * 自愈只做一件事：把与仕样书不一致的客户名找出来，交给前端挑选后再写回。
 *
 * 为什么明细不逐行回传：一个仕样号可能对应几十上百个枪名（历史累计），
 * 几万个仕样号 × 每行明细会撑爆响应体。这里只保留「不同的现客户名样本 + 样本枪名 + 涉及表」，
 * 足够让管理员判断要不要改，行数仍精确（itemCount 全量统计，不受样本截断影响）。
 */

const GUN_HEAL_SAMPLE_GUNS = 6;        // 单个仕样号回传的样本枪名数量
const GUN_HEAL_MAX_ROW_SAMPLES = 3;    // 单个仕样号回传的不同「现客户名」数量

const collapseSpace = (value) => String(value || '').replace(/\s+/g, ' ').trim();

/**
 * @param {string} specNumber 仕样号
 * @param {Array<{category:string,tableName:string,gunName:string,customer:string}>} rows 该仕样号涉及的台账行
 * @param {{resolved:boolean,clientName?:string,code?:string,message?:string}} resolution 仕样书解析结果
 * @returns {{
 *   specNumber:string, status:'outdated'|'ok'|'unresolved', resolved:boolean,
 *   expectedClient:string, code:string, message:string,
 *   itemCount:number, rowCount:number, distinctCurrent:number,
 *   samples:Array<{from:string,count:number}>, gunNames:string[], tableNames:string[]
 * }}
 */
function buildGunHealSpecEntry(specNumber, rows, resolution) {
  const expectedClient = String((resolution && resolution.clientName) || '').trim();
  const entry = {
    specNumber,
    status: 'unresolved',
    resolved: Boolean(resolution && resolution.resolved && expectedClient),
    expectedClient,
    code: (resolution && resolution.code) || '',
    message: (resolution && resolution.message) || '',
    itemCount: 0,
    rowCount: Array.isArray(rows) ? rows.length : 0,
    distinctCurrent: 0,
    samples: [],
    gunNames: [],
    tableNames: []
  };

  if (!entry.resolved) {
    // 解析成功但拿不到客户名（只有纳期）：也归入「无法核对」，并给出准确原因
    if (resolution && resolution.resolved && !expectedClient) {
      entry.code = 'NO_CLIENT';
      entry.message = '仕样书中未找到客户名';
    }
    return entry;
  }

  const currentCounts = new Map();
  const tableSet = new Set();
  (Array.isArray(rows) ? rows : []).forEach(row => {
    const current = String((row && row.customer) || '').trim();
    // 客户名一致（忽略多余空白）就是最新；空客户名在分组阶段已被排除，这里只做兜底
    if (!current || collapseSpace(current) === collapseSpace(expectedClient)) return;

    entry.itemCount += 1;
    currentCounts.set(current, (currentCounts.get(current) || 0) + 1);

    const gunName = String(row.gunName || '').trim();
    if (gunName && entry.gunNames.length < GUN_HEAL_SAMPLE_GUNS) entry.gunNames.push(gunName);

    const category = String(row.category || '').trim();
    const tableName = String(row.tableName || '').trim();
    const label = category && tableName ? `${category} / ${tableName}` : (tableName || category);
    if (label && !tableSet.has(label)) {
      tableSet.add(label);
      entry.tableNames.push(label);
    }
  });

  entry.distinctCurrent = currentCounts.size;
  entry.samples = [...currentCounts.entries()]
    .slice(0, GUN_HEAL_MAX_ROW_SAMPLES)
    .map(([from, count]) => ({ from, count }));
  entry.status = entry.itemCount > 0 ? 'outdated' : 'ok';
  return entry;
}

module.exports = {
  buildGunHealSpecEntry,
  collapseSpace,
  GUN_HEAL_SAMPLE_GUNS,
  GUN_HEAL_MAX_ROW_SAMPLES
};
