const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, guestViewMiddleware } = require('../middleware/auth');
const Joi = require('joi');
const asyncHandler = require('express-async-handler');

const normalizeDate = (dateStr) => {
  if (typeof dateStr !== 'string') return dateStr;
  return dateStr.length >= 10 ? dateStr.slice(0, 10) : dateStr;
};

const normalizeName = (value) => String(value || '').trim();

const normalizeColorValue = (value) => String(value || '').trim().toLowerCase();

const isWhiteColor = (value) => {
  const normalized = normalizeColorValue(value);
  return normalized === '#ffffff' || normalized === '#fff' || normalized === 'white';
};

const gunSchema = Joi.object({
  id: Joi.string().required(),
  name: Joi.string().allow('').default(''),
  hours: Joi.number().min(0).default(0),
  color: Joi.string().allow('').default(''),
  colorBeforeUserMark: Joi.string().allow('').default(''),
  colorMarkedBy: Joi.object({
    id: Joi.string().required(),
    username: Joi.string().allow(''),
    name: Joi.string().allow('')
  }).optional()
});

const validateNamedGunHours = (guns) => {
  if (!Array.isArray(guns)) return null;
  const invalidGun = guns.find(gun => {
    const name = String(gun?.name || '').trim();
    if (!name) return false;
    const hours = typeof gun.hours === 'number' ? gun.hours : (parseFloat(gun.hours) || 0);
    return hours <= 0;
  });
  return invalidGun ? '枪名存在时，每个枪名的工时都必须大于 0' : null;
};

const getUserMeta = (user) => ({
  id: user.id,
  username: user.username,
  name: user.name || user.username
});

const withCreateMeta = (item, user) => {
  const now = new Date().toISOString();
  const userMeta = getUserMeta(user);
  return {
    ...item,
    createdAt: now,
    createdBy: userMeta,
    updatedAt: now,
    updatedBy: userMeta
  };
};

const touchItem = (item, user) => {
  item.updatedAt = new Date().toISOString();
  item.updatedBy = getUserMeta(user);
};

const canUserMarkDesignPlanColor = (data, user, designerId, item) => {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'superadmin') {
    return !item?.leaveType;
  }
  if (user.role !== 'user') return false;
  if (!data.settings?.system?.allowUserDesignPlanColorMark && !data.settings?.system?.allowUserEditOwnTaskColor) return false;
  if (item?.leaveType) return false;

  const designer = (data.designers || []).find(d => d.id === designerId);
  if (!designer) return false;

  return normalizeName(designer.name) !== '' && normalizeName(designer.name) === normalizeName(user.name);
};

const canUserMarkGunColor = (data, user, designerId, item) => {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'superadmin') {
    return !item?.leaveType;
  }
  if (user.role !== 'user') return false;
  if (!data.settings?.system?.allowUserDesignPlanColorMark && !data.settings?.system?.allowUserEditOwnTaskColor) return false;
  if (item?.leaveType) return false;

  const designer = (data.designers || []).find(d => d.id === designerId);
  if (!designer) return false;

  return normalizeName(designer.name) !== '' && normalizeName(designer.name) === normalizeName(user.name);
};

const createItemSchema = Joi.object({
  designerId: Joi.string().required(),
  date: Joi.string().isoDate().required(),
  taskName: Joi.string().allow('').default(''),
  hours: Joi.number().min(0).default(0),
  color: Joi.string().allow('').default(''),
  guns: Joi.array().items(gunSchema).default([]),
  leaveType: Joi.string().valid('sick', 'vacation', 'illness', 'trip', null).allow(null).default(null),
  fontSize: Joi.string().allow('').default(''),
  textColor: Joi.string().allow('').default('')
});

const updateItemSchema = Joi.object({
  designerId: Joi.string().required(),
  date: Joi.string().isoDate().required(),
  itemId: Joi.string().required(),
  field: Joi.string().valid('taskName', 'hours', 'color', 'guns', 'leaveType', 'fontSize', 'textColor', 'gunColor').required(),
  value: Joi.alternatives().try(
    Joi.string().allow(''), 
    Joi.number().min(0),
    Joi.array().items(gunSchema),
    Joi.string().valid('sick', 'vacation', 'illness', 'trip', null).allow(null)
  ).required(),
  gunIndex: Joi.number().integer().min(0).optional()
});

const deleteItemSchema = Joi.object({
  designerId: Joi.string().required(),
  date: Joi.string().isoDate().required(),
  itemId: Joi.string().required()
});

const moveItemSchema = Joi.object({
  sourceDesignerId: Joi.string().required(),
  sourceDate: Joi.string().isoDate().required(),
  itemId: Joi.string().required(),
  targetDesignerId: Joi.string().required(),
  targetDate: Joi.string().isoDate().required(),
  newIndex: Joi.number().integer().min(0).optional()
});

const batchReplaceSchema = Joi.object({
  findText: Joi.string().min(1).required(),
  replaceText: Joi.string().allow('').default(''),
  allTable: Joi.boolean().default(false),
  month: Joi.number().integer().min(1).max(12).when('allTable', {
    is: false,
    then: Joi.required(),
    otherwise: Joi.optional()
  }),
  year: Joi.number().integer().min(1900).max(9999).when('allTable', {
    is: false,
    then: Joi.required(),
    otherwise: Joi.optional()
  })
});

const getMonthYearFromDate = (dateStr) => {
  const date = normalizeDate(dateStr);
  const d = new Date(`${date}T00:00:00`);
  return { month: d.getMonth() + 1, year: d.getFullYear() };
};

const getOrCreateSheet = (data, designerId, month, year) => {
  if (!data.tasks) data.tasks = [];
  let sheet = data.tasks.find(t => t.designerId === designerId && t.month === month && t.year === year);
  if (!sheet) {
    sheet = { id: `sheet-${designerId}-${year}-${month}`, designerId, month, year, days: {} };
    data.tasks.push(sheet);
  }
  if (!sheet.days || typeof sheet.days !== 'object') sheet.days = {};
  return sheet;
};

const countLiteral = (value, findText) => {
  if (typeof value !== 'string' || !value.includes(findText)) return 0;
  return value.split(findText).length - 1;
};

const getBatchReplaceTargetSheets = (data, allTable, month, year) => {
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  return allTable ? tasks : tasks.filter(sheet => sheet.month === month && sheet.year === year);
};

const findBatchReplaceMatches = (data, findText, allTable, month, year) => {
  const designerMap = new Map((data.designers || []).map(designer => [designer.id, designer.name]));
  const matches = [];
  let matchCount = 0;

  getBatchReplaceTargetSheets(data, allTable, month, year).forEach(sheet => {
    if (!sheet.days || typeof sheet.days !== 'object') return;

    Object.entries(sheet.days).forEach(([date, items]) => {
      if (!Array.isArray(items)) return;

      items.forEach(item => {
        const fields = [];
        const taskNameCount = countLiteral(item.taskName, findText);
        if (taskNameCount > 0) {
          fields.push({ field: 'taskName', label: '任务名', text: item.taskName, count: taskNameCount });
          matchCount += taskNameCount;
        }

        if (Array.isArray(item.guns)) {
          item.guns.forEach((gun, index) => {
            const gunNameCount = countLiteral(gun.name, findText);
            if (gunNameCount > 0) {
              fields.push({ field: 'gunName', label: `枪名 ${index + 1}`, text: gun.name, count: gunNameCount });
              matchCount += gunNameCount;
            }
          });
        }

        if (fields.length > 0) {
          matches.push({
            designerId: sheet.designerId,
            designerName: designerMap.get(sheet.designerId) || sheet.designerId,
            date,
            itemId: item.id,
            taskName: item.taskName || '',
            fields
          });
        }
      });
    });
  });

  return { matches, itemCount: matches.length, matchCount };
};

router.get('/', guestViewMiddleware, asyncHandler(async (req, res) => {
  const { month, year, designerId, summary } = req.query;
  const data = db.readDb();

  let tasks = data.tasks || [];

  if (designerId) {
    tasks = tasks.filter(t => t.designerId === designerId);
  }

  if (month && year) {
    const m = parseInt(month);
    const y = parseInt(year);
    tasks = tasks.filter(t => t.month === m && t.year === y);
  }

  if (summary === 'true') {
    const summaryData = tasks.map(sheet => {
      const totalItems = Object.values(sheet.days || {}).reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0);
      return {
        id: sheet.id,
        designerId: sheet.designerId,
        month: sheet.month,
        year: sheet.year,
        hasData: totalItems > 0,
        itemCount: totalItems,
        dates: Object.keys(sheet.days || {}).sort()
      };
    });
    res.json(summaryData);
    return;
  }

  res.json(tasks);
}));

router.post('/item/batch', authMiddleware, asyncHandler(async (req, res) => {
  const { designerId, date: rawDate, items: pasteItems } = req.body;
  if (!designerId || !rawDate || !Array.isArray(pasteItems)) {
    return res.status(400).json({ message: '输入参数不正确' });
  }

  const date = normalizeDate(rawDate);
  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isAdmin) {
    return res.status(403).json({ message: '只有管理员可以编辑表格' });
  }

  const data = db.readDb();
  const { month, year } = getMonthYearFromDate(date);
  const sheet = getOrCreateSheet(data, designerId, month, year);

  if (!sheet.days[date]) sheet.days[date] = [];
  
  const addedItems = [];
  for (const item of pasteItems) {
    const gunError = validateNamedGunHours(item.guns);
    if (gunError) {
      return res.status(400).json({ message: gunError });
    }

    const newItem = withCreateMeta({
      id: `item-${Date.now().toString()}${Math.random().toString(36).slice(2, 9)}`,
      taskName: item.taskName || '',
      hours: typeof item.hours === 'number' ? item.hours : (parseFloat(item.hours) || 0),
      color: item.color || '',
      guns: Array.isArray(item.guns) ? item.guns : [],
      leaveType: item.leaveType || null,
      fontSize: item.fontSize || '',
      textColor: item.textColor || ''
    }, req.user);
    sheet.days[date].push(newItem);
    addedItems.push(newItem);
  }

  await db.writeDb(data);
  res.status(201).json({ sheetId: sheet.id, designerId, month, year, date, items: addedItems, sheet });
}));

router.post('/item', authMiddleware, asyncHandler(async (req, res) => {
  const { error, value: validated } = createItemSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const { designerId, date: rawDate, taskName, hours, color, guns } = validated;
  const date = normalizeDate(rawDate);
  const gunError = validateNamedGunHours(guns);
  if (gunError) {
    return res.status(400).json({ message: gunError });
  }

  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isAdmin) {
    return res.status(403).json({ message: '只有管理员可以编辑表格' });
  }

  const data = db.readDb();
  const { month, year } = getMonthYearFromDate(date);
  const sheet = getOrCreateSheet(data, designerId, month, year);

  if (!sheet.days[date]) sheet.days[date] = [];
  const item = withCreateMeta({
    id: `item-${Date.now().toString()}${Math.random().toString(36).slice(2, 9)}`,
    taskName,
    hours,
    color,
    guns,
    leaveType: validated.leaveType || null,
    fontSize: validated.fontSize || '',
    textColor: validated.textColor || ''
  }, req.user);
  sheet.days[date].push(item);

  await db.writeDb(data);
  res.status(201).json({ sheetId: sheet.id, designerId, month, year, date, item, sheet });
}));

router.post('/batch-replace/search', authMiddleware, asyncHandler(async (req, res) => {
  const { error, value: validated } = batchReplaceSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isAdmin) {
    return res.status(403).json({ message: '只有管理员可以编辑表格' });
  }

  const { findText, allTable, month, year } = validated;
  const data = db.readDb();
  const result = findBatchReplaceMatches(data, findText, allTable, month, year);

  res.json({
    ...result,
    scope: allTable ? 'all' : 'month'
  });
}));

router.post('/batch-replace', authMiddleware, asyncHandler(async (req, res) => {
  const { error, value: validated } = batchReplaceSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isAdmin) {
    return res.status(403).json({ message: '只有管理员可以编辑表格' });
  }

  const { findText, replaceText, allTable, month, year } = validated;
  const data = db.readDb();
  const targetSheets = getBatchReplaceTargetSheets(data, allTable, month, year);

  let replacementCount = 0;
  let itemCount = 0;
  const updatedSheetIds = new Set();

  const replaceLiteral = (value) => {
    if (typeof value !== 'string' || !value.includes(findText)) {
      return { value, count: 0 };
    }
    const count = value.split(findText).length - 1;
    return { value: value.split(findText).join(replaceText), count };
  };

  targetSheets.forEach(sheet => {
    if (!sheet.days || typeof sheet.days !== 'object') return;

    Object.values(sheet.days).forEach(items => {
      if (!Array.isArray(items)) return;

      items.forEach(item => {
        let itemChanged = false;
        const taskNameResult = replaceLiteral(item.taskName);
        if (taskNameResult.count > 0) {
          item.taskName = taskNameResult.value;
          replacementCount += taskNameResult.count;
          itemChanged = true;
        }

        if (Array.isArray(item.guns)) {
          item.guns = item.guns.map(gun => {
            const gunNameResult = replaceLiteral(gun.name);
            if (gunNameResult.count === 0) return gun;
            replacementCount += gunNameResult.count;
            itemChanged = true;
            return { ...gun, name: gunNameResult.value };
          });
        }

        if (itemChanged) {
          touchItem(item, req.user);
          itemCount += 1;
          updatedSheetIds.add(sheet.id);
        }
      });
    });
  });

  if (replacementCount > 0) {
    await db.writeDb(data);
  }

  res.json({
    message: '批量替换完成',
    replacementCount,
    itemCount,
    sheetCount: updatedSheetIds.size
  });
}));

router.put('/item', authMiddleware, asyncHandler(async (req, res) => {
  const { error, value: validated } = updateItemSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const { designerId, date: rawDate, itemId, field, value, gunIndex } = validated;
  const date = normalizeDate(rawDate);
  const data = db.readDb();
  const { month, year } = getMonthYearFromDate(date);
  const sheet = getOrCreateSheet(data, designerId, month, year);

  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';

  const items = Array.isArray(sheet.days[date]) ? sheet.days[date] : [];
  const idx = items.findIndex(i => i.id === itemId);
  if (idx === -1) {
    return res.status(404).json({ message: '任务条目不存在' });
  }

  const item = items[idx];

  // Main task color marking (admins or authorized users)
  if (field === 'color') {
    const canMarkColor = isAdmin || canUserMarkDesignPlanColor(data, req.user, designerId, item);
    if (!canMarkColor) {
      return res.status(403).json({ message: '无权标记颜色' });
    }

    const isRestore = normalizeColorValue(value) === '__restore__';
    if (!isRestore && !isWhiteColor(value)) {
      return res.status(403).json({ message: 'Only white mark or restore is allowed' });
    }

    if (isRestore) {
      const canRestore = isAdmin || canUserMarkDesignPlanColor(data, req.user, designerId, item) || item.colorMarkedBy?.id === req.user.id || item.colorMarkedBy?.id === 'auto';
      if (
        isWhiteColor(item.color) &&
        canRestore &&
        Object.prototype.hasOwnProperty.call(item, 'colorBeforeUserMark')
      ) {
        // Restore all guns too (auto-marked or user-marked main task)
        const guns = Array.isArray(item.guns) ? item.guns : [];
        guns.forEach(gun => {
          if (isWhiteColor(gun.color) && Object.prototype.hasOwnProperty.call(gun, 'colorBeforeUserMark')) {
            gun.color = gun.colorBeforeUserMark || '';
            delete gun.colorBeforeUserMark;
            delete gun.colorMarkedBy;
          }
        });
        item.guns = guns;
        item.color = item.colorBeforeUserMark || '';
        delete item.colorBeforeUserMark;
        delete item.colorMarkedBy;
      }
    } else if (!isWhiteColor(item.color) || item.colorMarkedBy?.id !== req.user.id) {
      item.colorBeforeUserMark = item.color || '';
      item.colorMarkedBy = getUserMeta(req.user);
      item.color = '#ffffff';

      // Sync: mark all guns white when main task is marked white
      const guns = Array.isArray(item.guns) ? item.guns : [];
      guns.forEach(gun => {
        if (!isWhiteColor(gun.color)) {
          gun.colorBeforeUserMark = gun.color || '';
          gun.colorMarkedBy = { id: 'auto', username: 'auto', name: '系统联动' };
          gun.color = '#ffffff';
        }
      });
      item.guns = guns;
    }

    touchItem(item, req.user);
    sheet.days[date] = items;
    await db.writeDb(data);
    return res.json({ sheetId: sheet.id, designerId, month, year, date, item, sheet });
  }

  // Gun color marking (admins or authorized users)
  if (field === 'gunColor') {
    const canMarkGunColor = isAdmin || canUserMarkGunColor(data, req.user, designerId, item);
    if (!canMarkGunColor) {
      return res.status(403).json({ message: '无权标记枪名颜色' });
    }

    const guns = Array.isArray(item.guns) ? item.guns : [];
    let targetGun = null;

    if (typeof gunIndex === 'number' && gunIndex >= 0 && gunIndex < guns.length) {
      targetGun = guns[gunIndex];
    } else {
      return res.status(400).json({ message: '枪名索引无效' });
    }

    if (!targetGun) {
      return res.status(400).json({ message: '枪名不存在' });
    }

    const isRestore = normalizeColorValue(value) === '__restore__';
    if (!isRestore && !isWhiteColor(value)) {
      return res.status(403).json({ message: 'Only white mark or restore is allowed' });
    }

    if (isRestore) {
      const canRestoreGun = isAdmin || canUserMarkGunColor(data, req.user, designerId, item) || targetGun.colorMarkedBy?.id === req.user.id || targetGun.colorMarkedBy?.id === 'auto';
      if (
        isWhiteColor(targetGun.color) &&
        canRestoreGun &&
        Object.prototype.hasOwnProperty.call(targetGun, 'colorBeforeUserMark')
      ) {
        targetGun.color = targetGun.colorBeforeUserMark || '';
        delete targetGun.colorBeforeUserMark;
        delete targetGun.colorMarkedBy;
      }
    } else if (!isWhiteColor(targetGun.color) || targetGun.colorMarkedBy?.id !== req.user.id) {
      targetGun.colorBeforeUserMark = targetGun.color || '';
      targetGun.colorMarkedBy = getUserMeta(req.user);
      targetGun.color = '#ffffff';
    }

    item.guns = guns;

    // Auto-sync main task color based on all guns' state
    const allGuns = Array.isArray(item.guns) ? item.guns : [];
    const hasAllGuns = allGuns.length > 0;
    if (hasAllGuns) {
      const allGunsWhite = allGuns.every(g => isWhiteColor(g.color));
      if (allGunsWhite) {
        // All guns are white, auto-mark main task white if not already white
        if (!isWhiteColor(item.color)) {
          item.colorBeforeUserMark = item.color || '';
          item.colorMarkedBy = { id: 'auto', username: 'auto', name: '系统自动' };
          item.color = '#ffffff';
        }
      } else if (isWhiteColor(item.color)) {
        // Some gun restored, main task is white, restore it to original color
        item.color = item.colorBeforeUserMark || '';
        delete item.colorBeforeUserMark;
        delete item.colorMarkedBy;
      }
    }

    touchItem(item, req.user);
    sheet.days[date] = items;
    await db.writeDb(data);
    return res.json({ sheetId: sheet.id, designerId, month, year, date, item, sheet });
  }

  // For non-color fields, check permissions
  if (!isAdmin) {
    return res.status(403).json({ message: 'Only admins can edit tasks' });
  }

  if (field === 'guns') {
    const gunError = validateNamedGunHours(value);
    if (gunError) {
      return res.status(400).json({ message: gunError });
    }
  }

  if (field === 'hours') {
    item.hours = typeof value === 'number' ? value : (parseFloat(value) || 0);
  } else if (field === 'color') {
    item.color = value;
    delete item.colorBeforeUserMark;
    delete item.colorMarkedBy;
  } else if (field === 'guns') {
    item.guns = value;
  } else if (field === 'leaveType') {
    item.leaveType = value;
  } else {
    item.taskName = value;
  }
  touchItem(item, req.user);

  sheet.days[date] = items;
  await db.writeDb(data);
  res.json({ sheetId: sheet.id, designerId, month, year, date, item, sheet });
}));

router.delete('/item', authMiddleware, asyncHandler(async (req, res) => {
  const { error, value: validated } = deleteItemSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const { designerId, date: rawDate, itemId } = validated;
  const date = normalizeDate(rawDate);
  const data = db.readDb();
  const { month, year } = getMonthYearFromDate(date);
  const sheet = getOrCreateSheet(data, designerId, month, year);

  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isAdmin) {
    return res.status(403).json({ message: '只有管理员可以编辑表格' });
  }

  const items = Array.isArray(sheet.days[date]) ? sheet.days[date] : [];
  const nextItems = items.filter(i => i.id !== itemId);
  if (nextItems.length === items.length) {
    return res.status(404).json({ message: '任务条目不存在' });
  }
  sheet.days[date] = nextItems;
  if (sheet.days[date].length === 0) delete sheet.days[date];

  await db.writeDb(data);
  res.json({ message: '任务条目已删除', sheetId: sheet.id, designerId, month, year, date, sheet });
}));

router.post('/move', authMiddleware, asyncHandler(async (req, res) => {
  const { error, value: validated } = moveItemSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const { sourceDesignerId, sourceDate, itemId, targetDesignerId, targetDate, newIndex } = validated;
  const sDate = normalizeDate(sourceDate);
  const tDate = normalizeDate(targetDate);

  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isAdmin) {
    return res.status(403).json({ message: '只有管理员可以移动任务' });
  }

  const data = db.readDb();
  
  // Source
  const sMY = getMonthYearFromDate(sDate);
  const sSheet = getOrCreateSheet(data, sourceDesignerId, sMY.month, sMY.year);
  const sItems = Array.isArray(sSheet.days[sDate]) ? sSheet.days[sDate] : [];
  
  const itemIdx = sItems.findIndex(i => i.id === itemId);
  if (itemIdx === -1) {
    return res.status(404).json({ message: '源任务不存在' });
  }
  
  const [item] = sItems.splice(itemIdx, 1);
  if (sItems.length === 0) delete sSheet.days[sDate];
  else sSheet.days[sDate] = sItems;

  // Target
  const tMY = getMonthYearFromDate(tDate);
  const tSheet = getOrCreateSheet(data, targetDesignerId, tMY.month, tMY.year);
  if (!tSheet.days[tDate]) tSheet.days[tDate] = [];
  
  if (typeof newIndex === 'number' && newIndex >= 0) {
    touchItem(item, req.user);
    tSheet.days[tDate].splice(newIndex, 0, item);
  } else {
    touchItem(item, req.user);
    tSheet.days[tDate].push(item);
  }

  await db.writeDb(data);
  res.json({ message: '任务已移动', sourceSheet: sSheet, targetSheet: tSheet });
}));

module.exports = router;
