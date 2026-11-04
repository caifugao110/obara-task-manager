'use strict';

// 「同步生产大日程」的服务层：按钮手动同步与数据库维护的定时任务共用同一套流程。
//
// 流程分两遍：
//   1. 先按大日程 + 现有记录算出变更清单，得到「哪些仕样号还缺营业担当」；
//   2. 只为这些仕样号解析仕样书 PDF（有缓存，重复同步几乎不耗时），拿到营业担当后再算一遍，
//      由组长规则推出组长，最终只补空字段，不覆盖人工维护的值。
// 两遍的好处是：已经填过营业担当的月份不会再去碰共享盘上的 PDF。

const crypto = require('crypto');
const db = require('../db');
const productionSchedule = require('./productionSchedule');
const specInfoLookup = require('./specInfoLookup');
const { buildScheduleSyncPlan, _private: scheduleSyncPrivate } = require('./scheduleSync');
const { resolveLeader } = require('./leaderRules');
const { calculateDesignDeliveryDays } = require('./designDelivery');

class ScheduleUnavailableError extends Error {
  constructor(filePath, status = {}) {
    // 消息里带上真实错误码与处置建议：Session 0 的服务进程没有共享凭据、
    // 文件被 Excel 独占、路径写错，三种情况的处理方式完全不同。
    super(productionSchedule.getUnavailableMessage());
    this.name = 'ScheduleUnavailableError';
    this.code = 'SCHEDULE_UNAVAILABLE';
    this.filePath = filePath;
    this.detail = status.lastError || null;
    this.share = status.share || null;
  }
}

const getSpecDigits = () => {
  try {
    const digits = db.readSettings()?.system?.specNumberDigits;
    return digits === 6 ? 6 : 5;
  } catch (error) {
    return 5;
  }
};

const getLeaderRules = (data) => (data && data.settings ? data.settings.leaderRules : null);

// 默认行锁判定：被任何人占用就跳过，避免定时任务冲掉别人正在编辑的行
const defaultIsLocked = (itemId) => {
  try {
    const { getStatusTrackingLock } = require('./statusTrackingLocks');
    return Boolean(getStatusTrackingLock(itemId));
  } catch (error) {
    return false;
  }
};

const readEntriesOrThrow = async () => {
  const entries = await productionSchedule.getAllScheduleEntries({ forceReload: true });
  if (!entries) {
    const status = productionSchedule.getScheduleStatus();
    throw new ScheduleUnavailableError(status.filePath, status);
  }
  return entries;
};

/**
 * 生成同步计划（只读，不落库）。
 * @param {{ isLocked?: (itemId: string) => boolean }} [options]
 */
async function buildSyncPlan({ isLocked } = {}) {
  const entries = await readEntriesOrThrow();
  const data = db.readDb();
  const items = data.statusTrackingItems || [];
  const specDigits = getSpecDigits();
  const leaderRules = getLeaderRules(data);
  const resolveLeaderFor = (salesPerson) => resolveLeader(salesPerson, leaderRules);
  const lockedCheck = typeof isLocked === 'function' ? isLocked : defaultIsLocked;

  // 第一遍：不解析 PDF，先看哪些记录确实缺营业担当
  const preliminary = buildScheduleSyncPlan({
    entries, items, specDigits, isLocked: lockedCheck, resolveLeader: resolveLeaderFor
  });
  const itemById = new Map(items.map(item => [item.id, item]));
  const specNumbersToResolve = new Set();
  for (const change of preliminary.changes) {
    if (change.action === 'locked') continue;
    if (change.action === 'add') {
      specNumbersToResolve.add(change.specNumber);
      continue;
    }
    const existing = itemById.get(change.itemId);
    if (existing && !String(existing.salesPerson || '').trim()) {
      specNumbersToResolve.add(change.specNumber);
    }
  }

  const lookup = await specInfoLookup.resolveSalesPersons(Array.from(specNumbersToResolve));

  // 第二遍：带上营业担当算最终变更
  const final = buildScheduleSyncPlan({
    entries,
    items,
    specDigits,
    isLocked: lockedCheck,
    responsibles: lookup.responsibles,
    resolveLeader: resolveLeaderFor
  });

  return {
    data,
    entries,
    changes: final.changes,
    stats: {
      ...final.stats,
      salesLookup: {
        specs: lookup.stats.requested,
        resolved: lookup.stats.resolved,
        missingPdf: lookup.stats.missingPdf,
        noSalesPerson: lookup.stats.noSalesPerson,
        failed: lookup.stats.failed,
        shareAvailable: lookup.stats.shareAvailable
      }
    },
    filePath: productionSchedule.getScheduleStatus().filePath
  };
}

const buildNewItem = (change, nowIso) => {
  const fields = change.fields;
  return {
    id: crypto.randomUUID(),
    factory: fields.factory,
    sheetName: fields.sheetName || '',
    clientName: fields.clientName,
    specNumber: change.specNumber,
    productionPlanMonth: change.month,
    productionPlanMonths: [change.month],
    quantity: fields.quantity,
    deliveryDate: fields.deliveryDate,
    shippedCount: fields.shippedCount,
    unconfirmedCount: 0,
    totalVarieties: 0,
    feedbackVarieties: 0,
    feedbackPlan: '',
    drawingPlanStatus: '',
    confirmedQuantity: 0,
    confirmedVarieties: 0,
    drawnVarieties: 0,
    undrawnVarieties: 0,
    undrawnQuantity: 0,
    unconfirmedQuantity: 0,
    salesPerson: fields.salesPerson || '',
    leader: fields.leader || '',
    designDeliveryDays: calculateDesignDeliveryDays(fields.deliveryDate),
    createdAt: nowIso,
    updatedAt: nowIso
  };
};

/**
 * 执行同步：改库并返回最新数据（广播由调用方负责）。
 *
 * 注意：计划阶段要解析仕样书（首次数秒），期间别人可能正在改同一批记录，
 * 因此不能把计划阶段那份库快照写回去。这里在落库前重新读库：
 *   - 按「仕样号 + 月份」重新对齐，计划里的新增若已被他人插入则退化为更新；
 *   - 营业担当/组长写库前再判一次空值，避免覆盖这几秒内人工输入的值；
 *   - 行锁再判一次，跳过正在被编辑的行。
 *
 * @param {{ isLocked?: (itemId: string) => boolean }} [options]
 */
async function applySyncPlan({ isLocked } = {}) {
  const plan = await buildSyncPlan({ isLocked });
  const { changes, stats } = plan;

  if (!stats.added && !stats.updated) {
    return { ...plan, applied: false };
  }

  const lockedCheck = typeof isLocked === 'function' ? isLocked : defaultIsLocked;
  const { makeSpecMonthKey, getItemPlanMonths } = scheduleSyncPrivate;

  const data = db.readDb();
  if (!Array.isArray(data.statusTrackingItems)) data.statusTrackingItems = [];
  const byKey = new Map();
  const byId = new Map();
  data.statusTrackingItems.forEach((item) => {
    byId.set(item.id, item);
    getItemPlanMonths(item).forEach(month => byKey.set(makeSpecMonthKey(item.specNumber, month), item));
  });

  const nowIso = new Date().toISOString();

  // 来源字段直接覆盖；营业担当/组长只在当前仍为空时补，保护并发中的人工输入
  const applyFields = (target, fields) => {
    const { salesPerson, leader, ...sourceFields } = fields;
    Object.assign(target, sourceFields, {
      designDeliveryDays: calculateDesignDeliveryDays(fields.deliveryDate),
      updatedAt: nowIso
    });
    if (salesPerson && !String(target.salesPerson || '').trim()) target.salesPerson = salesPerson;
    if (leader && !String(target.leader || '').trim()) target.leader = leader;
  };

  for (const change of changes) {
    if (change.action !== 'add' && change.action !== 'update') continue;
    const key = makeSpecMonthKey(change.specNumber, change.month);

    if (change.action === 'add') {
      const raced = byKey.get(key);
      if (raced) {
        // 计划之后已被别人插入同一仕样号+月份：改为更新，不产生重复行
        if (!lockedCheck(raced.id)) applyFields(raced, change.fields);
        continue;
      }
      const newItem = buildNewItem(change, nowIso);
      data.statusTrackingItems.push(newItem);
      byKey.set(key, newItem);
      byId.set(newItem.id, newItem);
      continue;
    }

    const target = byId.get(change.itemId) || byKey.get(key);
    if (!target) continue;
    if (lockedCheck(target.id)) continue;
    applyFields(target, change.fields);
  }

  await db.writeDb(data);
  return { ...plan, data, applied: true };
}

module.exports = {
  buildSyncPlan,
  applySyncPlan,
  ScheduleUnavailableError
};
