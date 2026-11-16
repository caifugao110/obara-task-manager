'use strict';

// 「各产品大日程」与状态跟踪的比对逻辑（纯函数，便于单元测试）。
// 输入：四张工作表解析出的条目 + 现有状态跟踪记录；
// 输出：新增 / 更新 / 一致 / 被锁 的变更清单与统计，以及「旧月份遗留行」的清理计划。
//
// 判等口径（关键）：
//   大日程按「月份块」组织，同一个订单在计划调整后会从 11 月块挪到 12 月块、纳期跟着改。
//   如果只按「仕样号 + 月份」判等，每次挪动都会新增一行、旧行永远留在原月份，
//   页面上就出现两行一模一样的记录（同一仕样号、同一纳期、同一数量）。
//   因此这里加了一条认领规则：新条目在「仕样号 + 月份」上找不到记录时，
//   若存在同仕样号、同纳期、且月份已不在本次大日程里的旧记录，就把那条旧记录
//   顺延到新月份（更新而不是新增）；其余的旧月份遗留行交给清理计划删除。

// 只覆盖这些来自表格的字段；营业担当、组长只在「原值为空」时补全，确认数量等人工字段不动
// sheetName 记录该行来自哪张日程表（南京焊钳/上海焊钳/南京焊钳修改/上海焊钳修改），
// 供页面按表筛选——工厂列只有 O/NJG、O/SHA 两个值，区分不出「修改」表。
const SCHEDULE_SOURCE_FIELDS = ['factory', 'sheetName', 'clientName', 'quantity', 'deliveryDate', 'shippedCount'];

// 人工维护字段：清理遗留行时，旧行里这些值要并到保留行上，不能随删除丢掉。
// 注意不含「未下种数/未下数量/未确认数」——这三列是页面按
// 确认种数-下图种数、确认数量-已发图、数量-确认数量实时算出来的派生值，
// 存下来的旧值并过去只会污染新行（例如把 10 月计划的 102 未确认数搬到 12 月）。
const MANUAL_TEXT_FIELDS = ['salesPerson', 'leader', 'feedbackPlan', 'drawingPlanStatus'];
const MANUAL_NUMERIC_FIELDS = [
  'feedbackVarieties',
  'confirmedQuantity',
  'confirmedVarieties',
  'drawnVarieties'
];

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

// 记录里最新的月份：用来在同仕样号的多条遗留行里挑「最接近当前计划」的那条
function latestMonth(item) {
  const months = getItemPlanMonths(item);
  return months.length ? months[months.length - 1] : '';
}

// 月份换算成序号：比较两条记录在时间上差几个月
function monthIndex(month) {
  const [year, mon] = toText(month).split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(mon)) return Number.NEGATIVE_INFINITY;
  return year * 12 + mon;
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
 * 过滤出有效条目：位数与系统配置一致、数量 > 0、月份格式正确，
 * 并按「仕样号 + 月份」去重（同一仕样号同一月份在四张表里只应出现一次，以先读到的为准）。
 */
function normalizeEntries(entries, specDigits) {
  const digits = specDigits === 6 ? 6 : 5;
  const validEntries = [];
  const entryKeys = new Set();
  const monthCounts = Object.create(null);
  let skipped = 0;

  for (const entry of entries || []) {
    const specNumber = toText(entry.specNumber).trim();
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

    const key = makeSpecMonthKey(specNumber, month);
    if (entryKeys.has(key)) continue;
    entryKeys.add(key);
    monthCounts[month] = (monthCounts[month] || 0) + 1;
    validEntries.push({ entry, key, specNumber, month, quantity });
  }

  return { validEntries, entryKeys, monthCounts, skipped };
}

// 旧行里的人工字段，只在保留行还空着的时候并过来
function pickMergeFields(survivor, source) {
  const fields = {};
  MANUAL_TEXT_FIELDS.forEach(field => {
    if (!toText(survivor[field]).trim() && toText(source[field]).trim()) {
      fields[field] = source[field];
    }
  });
  MANUAL_NUMERIC_FIELDS.forEach(field => {
    if (!(Number(survivor[field]) > 0) && Number(source[field]) > 0) {
      fields[field] = Number(source[field]);
    }
  });
  return fields;
}

// 本次同步新插入的行在清理计划里用这个前缀占位：它们还没进库，只能用「仕样号__月份」定位
const PLANNED_ID_PREFIX = '__planned__';

/**
 * 「旧月份遗留行」清理计划（只读，不落库）。
 *
 * 一条记录的所有月份都不在本次大日程里，说明它已被新月份块里的同一订单取代；
 * 只要该仕样号仍在大日程中出现，这条就是重复行——把人工字段并到保留行后删掉。
 * 仕样号已经完全不在大日程里的记录不动：那是历史数据，删掉没有任何东西可对照。
 *
 * @param {Object} options
 * @param {Array} options.items 现有状态跟踪记录（可含本次将要新增的占位行）
 * @param {Set<string>} options.entryKeys 本次大日程的有效「仕样号__月份」集合
 * @param {Set<string>} [options.skipIds] 已在本次同步中被顺延认领的记录（不能当遗留行删掉）
 * @param {(itemId: string) => boolean} [options.isLocked]
 */
function planLeftoverCleanup({ items, entryKeys, skipIds, isLocked }) {
  const lockedCheck = typeof isLocked === 'function' ? isLocked : () => false;
  const skip = skipIds instanceof Set ? skipIds : new Set(skipIds || []);
  const keys = entryKeys instanceof Set ? entryKeys : new Set();

  const isLive = (item) => getItemPlanMonths(item)
    .some(month => keys.has(makeSpecMonthKey(item.specNumber, month)));

  // 现行记录按仕样号归组：旧行的人工字段要并到这些行上
  const liveBySpec = new Map();
  (items || []).forEach(item => {
    if (skip.has(item.id)) return;
    const specNumber = toText(item.specNumber).trim();
    if (!specNumber || !isLive(item)) return;
    const specKey = specNumber.toLowerCase();
    if (!liveBySpec.has(specKey)) liveBySpec.set(specKey, []);
    liveBySpec.get(specKey).push(item);
  });

  const merges = [];
  const removals = [];

  (items || []).forEach(item => {
    if (skip.has(item.id)) return;
    const specNumber = toText(item.specNumber).trim();
    if (!specNumber) return; // 没有仕样号的记录无法与大日程对照，不参与自动清理
    if (isLive(item)) return;
    if (lockedCheck(item.id)) return; // 行锁中的跳过，等下次同步再清

    // 人工字段优先并到「月份最接近它」的现行记录：例如 58073 同时有 11 月、
    // 12 月两条现行记录时，10 月的旧行应该并给 11 月那条。
    const liveSiblings = liveBySpec.get(specNumber.toLowerCase()) || [];
    // 仕样号已完全不在大日程里：历史数据，没有现行记录可对照，保留不动
    if (liveSiblings.length === 0) return;

    const target = monthIndex(latestMonth(item));
    let best = null;
    let bestGap = Infinity;
    liveSiblings.forEach(candidate => {
      const gap = Math.abs(monthIndex(latestMonth(candidate)) - target);
      if (gap < bestGap) { best = candidate; bestGap = gap; }
    });

    if (best) {
      const survivorIsPlanned = String(best.id || '').startsWith(PLANNED_ID_PREFIX);
      if (survivorIsPlanned) {
        // 新增行还没进库，只能用「仕样号__月份」定位，等它落库后再合并字段
        const fields = pickMergeFields(best, item);
        if (Object.keys(fields).length) {
          merges.push({
            targetKey: makeSpecMonthKey(specNumber, getItemPlanMonths(best)[0]),
            fields,
            fromId: item.id,
            specNumber
          });
        }
      } else if (lockedCheck(best.id)) {
        // 保留行正被别人编辑，人工字段没地方并：这条先留着，等下次同步
        return;
      } else {
        const fields = pickMergeFields(best, item);
        if (Object.keys(fields).length) {
          merges.push({ targetId: best.id, fields, fromId: item.id, specNumber });
        }
      }
    }

    removals.push({
      id: item.id,
      specNumber,
      months: getItemPlanMonths(item),
      quantity: item.quantity,
      deliveryDate: item.deliveryDate
    });
  });

  return { merges, removals };
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
  const lockedCheck = typeof isLocked === 'function' ? isLocked : () => false;
  const leaderResolver = typeof resolveLeader === 'function' ? resolveLeader : () => '';

  const lookupResponsible = (specNumber) => {
    if (!responsibles) return null;
    if (typeof responsibles.get === 'function') return responsibles.get(specNumber) || null;
    return responsibles[specNumber] || null;
  };

  const itemList = items || [];
  const { validEntries, entryKeys, monthCounts, skipped } = normalizeEntries(entries, specDigits);

  const existingByKey = new Map();
  itemList.forEach(item => {
    makeSpecMonthKeys(item).forEach(key => existingByKey.set(key, item));
  });

  // 「月份已不在本次大日程里」的旧记录，按「仕样号__纳期」建索引：
  // 新条目在月份上找不到记录时，用它来认领同一个订单，避免顺延成新行。
  const leftoverBySpecDate = new Map();
  itemList.forEach(item => {
    const months = getItemPlanMonths(item);
    if (months.length === 0) return;
    if (months.some(month => entryKeys.has(makeSpecMonthKey(item.specNumber, month)))) return;
    const deliveryDate = toText(item.deliveryDate).trim();
    if (!deliveryDate) return;
    const indexKey = `${toText(item.specNumber).trim()}__${deliveryDate}`;
    const prev = leftoverBySpecDate.get(indexKey);
    if (!prev || latestMonth(item) > latestMonth(prev)) {
      leftoverBySpecDate.set(indexKey, item);
    }
  });

  const changes = [];
  const adoptedIds = new Set();
  let salesFilled = 0;
  let leaderFilled = 0;
  let salesMissing = 0;
  let moved = 0;

  for (const { entry, key, specNumber, month, quantity } of validEntries) {
    let existing = existingByKey.get(key) || null;
    let adopted = false;

    if (!existing) {
      const entryDeliveryDate = toText(entry.deliveryDate).trim();
      const candidate = entryDeliveryDate
        ? leftoverBySpecDate.get(`${specNumber}__${entryDeliveryDate}`)
        : null;
      if (candidate && !adoptedIds.has(candidate.id)) {
        existing = candidate;
        adopted = true;
      }
    }
    // 先占位：即使这条记录被锁（本次不写），后面的条目也不能再认领同一条
    if (adopted) adoptedIds.add(existing.id);

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
      factory: entry.factory || (existing && existing.factory) || '',
      sheetName: toText(entry.sheetName).trim() || (existing && existing.sheetName) || '',
      clientName: toText(entry.clientText).trim() || (existing && existing.clientName) || '',
      quantity,
      deliveryDate: entry.deliveryDate || (existing && existing.deliveryDate) || '',
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

    if (adopted) {
      // 认领旧月份记录：更新来源字段并把月份顺延到本次月份，不再新增一行
      moved++;
      changes.push({
        action: 'update',
        specNumber,
        month,
        itemId: existing.id,
        moveMonth: true,
        fields: { ...nextFields, ...fillFields }
      });
      continue;
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

  // 本次将要新增的行一起交给清理计划：否则「旧行 + 刚补上的新行」这一组会被判成
  // 「没有现行记录」而躲过清理，用户点完同步还是看到两行一样的记录
  const plannedNew = changes
    .filter(change => change.action === 'add')
    .map(change => ({
      id: `${PLANNED_ID_PREFIX}${change.specNumber}__${change.month}`,
      specNumber: change.specNumber,
      productionPlanMonth: change.month,
      productionPlanMonths: [change.month],
      ...change.fields
    }));

  // 顺延认领过的记录已经算「现行」，不能再当遗留行清掉
  const cleanup = planLeftoverCleanup({
    items: itemList.concat(plannedNew),
    entryKeys,
    skipIds: adoptedIds,
    isLocked: lockedCheck
  });

  const countOf = action => changes.filter(change => change.action === action).length;
  const stats = {
    total: changes.length,
    added: countOf('add'),
    updated: countOf('update'),
    unchanged: countOf('unchanged'),
    locked: countOf('locked'),
    skipped,
    // 其中「按仕样号+纳期把旧月份记录顺延过来」的条数（已计入 updated）
    moved,
    // 将清理的旧月份遗留行条数
    cleanupRemoved: cleanup.removals.length,
    salesFilled,
    leaderFilled,
    salesMissing,
    months: Object.keys(monthCounts).sort().map(month => ({ month, count: monthCounts[month] }))
  };

  return { changes, stats, cleanup };
}

module.exports = {
  buildScheduleSyncPlan,
  planLeftoverCleanup,
  normalizeEntries,
  SCHEDULE_SOURCE_FIELDS,
  _private: {
    getItemPlanMonths,
    makeSpecMonthKey,
    makeSpecMonthKeys
  }
};
