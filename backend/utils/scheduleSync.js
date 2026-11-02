'use strict';

// 「各产品大日程」与状态跟踪的比对逻辑（纯函数，便于单元测试）。
// 输入：四张工作表解析出的条目 + 现有状态跟踪记录；
// 输出：新增 / 更新 / 一致 / 被锁 的变更清单与统计。

// 只覆盖这些来自表格的字段；营业担当、组长只在「原值为空」时补全，确认数量等人工字段不动
// sheetName 记录该行来自哪张日程表（南京焊钳/上海焊钳/南京焊钳修改/上海焊钳修改），
// 供页面按表筛选——工厂列只有 O/NJG、O/SHA 两个值，区分不出「修改」表。
const SCHEDULE_SOURCE_FIELDS = ['factory', 'sheetName', 'clientName', 'quantity', 'deliveryDate', 'shippedCount'];

function toText(value) {
  return value === undefined || value === null ? '' : String(value);
}

function getItemPlanMonths(item) {
  const months = Array.isArray(item.productionPlanMonths)
    ? item.productionPlanMonths.filter(Boolean)
    : [];
  if (months.length > 0) {
    return Array.from(new Set(months)).sort();
  }
  const fallback = item.productionPlanMonth || (item.deliveryDate ? String(item.deliveryDate).substring(0, 7) : '');
  return fallback ? [fallback] : [];
}

function makeSpecMonthKey(specNumber, month) {
  return `${toText(specNumber).trim().toLowerCase()}__${toText(month).trim()}`;
}

function makeSpecMonthKeys(item) {
  return getItemPlanMonths(item).map(month => makeSpecMonthKey(item.specNumber, month));
}

function fieldsEqual(existing, nextFields) {
  return SCHEDULE_SOURCE_FIELDS.every(field => {
    if (field === 'shippedCount') {
      return (Number(existing.shippedCount) || 0) === nextFields.shippedCount;
    }
    return toText(existing[field]) === toText(nextFields[field]);
  });
}

/**
 * @param {Object} options
 * @param {Array} options.entries 大日程条目（含 specNumber/factory/month/clientText/quantity/deliveryDate/shippedCount）
 * @param {Array} options.items 现有状态跟踪记录
 * @param {number} options.specDigits 系统配置的仕样号位数
 * @param {(itemId: string) => boolean} [options.isLocked] 行是否被他人占用
 * @param {Map<string, {salesPerson?: string, leader?: string}>|Object} [options.responsibles]
 *        仕样号 → 营业担当（由仕样书解析得到），用于新增记录与补全空字段
 * @param {(salesPerson: string) => string} [options.resolveLeader] 营业担当 → 组长
 */
function buildScheduleSyncPlan({ entries, items, specDigits, isLocked, responsibles, resolveLeader }) {
  const digits = specDigits === 6 ? 6 : 5;
  const lockedCheck = typeof isLocked === 'function' ? isLocked : () => false;
  const leaderResolver = typeof resolveLeader === 'function' ? resolveLeader : () => '';

  const lookupResponsible = (specNumber) => {
    if (!responsibles) return null;
    if (typeof responsibles.get === 'function') return responsibles.get(specNumber) || null;
    return responsibles[specNumber] || null;
  };

  const existingByKey = new Map();
  (items || []).forEach(item => {
    makeSpecMonthKeys(item).forEach(key => existingByKey.set(key, item));
  });

  const changes = [];
  const monthCounts = Object.create(null);
  const seenKeys = new Set();
  let skipped = 0;
  let salesFilled = 0;
  let leaderFilled = 0;
  let salesMissing = 0;

  for (const entry of entries || []) {
    const specNumber = toText(entry.specNumber).trim();
    // 有效仕样号：位数与系统配置一致，且该行数量大于 0（过滤 UC/UX 等汇总行）
    if (!/^\d+$/.test(specNumber) || specNumber.length !== digits) {
      skipped++;
      continue;
    }

    const quantity = toText(entry.quantity).trim();
    const quantityValue = Number(quantity);
    if (!quantity || !Number.isFinite(quantityValue) || quantityValue <= 0) {
      skipped++;
      continue;
    }

    const month = toText(entry.month).trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      skipped++;
      continue;
    }

    // 同一仕样号同一月份在四张表里只应出现一次；重复时以先读到的行为准
    const key = makeSpecMonthKey(specNumber, month);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    monthCounts[month] = (monthCounts[month] || 0) + 1;

    const existing = existingByKey.get(key);
    const responsible = lookupResponsible(specNumber);
    const responsibleSales = toText(responsible && responsible.salesPerson).trim();
    const existingSales = toText(existing && existing.salesPerson).trim();
    const existingLeader = toText(existing && existing.leader).trim();
    // 已有营业担当优先（可能是人工校正过的），没有再取仕样书解析值
    const finalSales = existingSales || responsibleSales;
    const finalLeader = existingLeader
      || (finalSales ? toText(leaderResolver(finalSales)).trim() : '')
      || toText(responsible && responsible.leader).trim();

    const nextFields = {
      // 表格缺值时保留原值，避免把人工填过的客户/纳期清空
      factory: entry.factory || existing?.factory || '',
      sheetName: toText(entry.sheetName).trim() || existing?.sheetName || '',
      clientName: toText(entry.clientText).trim() || existing?.clientName || '',
      quantity,
      deliveryDate: entry.deliveryDate || existing?.deliveryDate || '',
      shippedCount: Number(entry.shippedCount) || 0,
      salesPerson: finalSales,
      leader: finalLeader
    };

    if (!finalSales) salesMissing++;

    if (!existing) {
      if (finalSales) salesFilled++;
      if (finalLeader) leaderFilled++;
      changes.push({ action: 'add', specNumber, month, fields: nextFields });
      continue;
    }

    if (lockedCheck(existing.id)) {
      changes.push({ action: 'locked', specNumber, month, itemId: existing.id });
      continue;
    }

    // 只补空字段：人工填过的营业担当/组长一律不动
    const fillFields = {};
    if (!existingSales && finalSales) {
      fillFields.salesPerson = finalSales;
      salesFilled++;
    }
    if (!existingLeader && finalLeader) {
      fillFields.leader = finalLeader;
      leaderFilled++;
    }

    const sourceChanged = !fieldsEqual(existing, nextFields);
    const changed = sourceChanged || Object.keys(fillFields).length > 0;
    changes.push({
      action: changed ? 'update' : 'unchanged',
      specNumber,
      month,
      itemId: existing.id,
      fields: changed ? { ...nextFields, ...fillFields } : undefined
    });
  }

  const countOf = action => changes.filter(change => change.action === action).length;
  const stats = {
    total: changes.length,
    added: countOf('add'),
    updated: countOf('update'),
    unchanged: countOf('unchanged'),
    locked: countOf('locked'),
    skipped,
    salesFilled,
    leaderFilled,
    salesMissing,
    months: Object.keys(monthCounts).sort().map(month => ({ month, count: monthCounts[month] }))
  };

  return { changes, stats };
}

module.exports = {
  buildScheduleSyncPlan,
  SCHEDULE_SOURCE_FIELDS,
  _private: {
    getItemPlanMonths,
    makeSpecMonthKey,
    makeSpecMonthKeys
  }
};
