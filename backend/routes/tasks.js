const express = require('express');
const router = express.Router();
const db = require('../db');
const taskStore = require('../taskStore');
const { authMiddleware } = require('../middleware/auth');
const Joi = require('joi');
const asyncHandler = require('express-async-handler');
const taskColors = require('../utils/taskColors');

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

// 任务内容配色：按「任务内容后缀 + 是否加急」派生底色（白色=已完成直接保留）
// 写入库里的 color 只作为导出/旧版消费方的展示依据，页面颜色由前端按同一套配置实时派生。
const getTaskColorConfig = (data) => taskColors.normalizeTaskColorConfig(data?.settings?.system?.taskColorConfig);

const deriveItemColor = (item, colorConfig) => {
  if (!item || item.leaveType) return item?.color || '';
  if (isWhiteColor(item.color)) return item.color;
  return taskColors.getTaskCellColor(item, colorConfig);
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

// 同一主任务内不允许出现重复的非空枪名
const validateDuplicateGunNames = (guns) => {
  if (!Array.isArray(guns)) return null;
  const seen = new Set();
  for (const gun of guns) {
    const name = String(gun?.name || '').trim();
    if (!name) continue;
    if (seen.has(name)) return `存在重复的枪名「${name}」，请修改后再保存`;
    seen.add(name);
  }
  return null;
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

// 枪名增删/移动后同步主任务标记状态（与 gunColor 手动标记的联动规则一致）：
// 存在枪名且全部为白色 → 主任务自动标白（记录恢复色）；
// 存在非白枪名且主任务为白色 → 主任务恢复原色
const syncTaskColorWithGuns = (item) => {
  const guns = Array.isArray(item.guns) ? item.guns : [];
  if (guns.length === 0) return;
  const allGunsWhite = guns.every(g => isWhiteColor(g.color));
  if (allGunsWhite) {
    if (!isWhiteColor(item.color)) {
      item.colorBeforeUserMark = item.color || '';
      item.colorMarkedBy = { id: 'auto', username: 'auto', name: '系统自动' };
      item.color = '#ffffff';
    }
  } else if (isWhiteColor(item.color)) {
    item.color = item.colorBeforeUserMark || '';
    delete item.colorBeforeUserMark;
    delete item.colorMarkedBy;
  }
};

// 主任务直接改色（编辑任务弹窗/管理员改色）时，整条任务回到「未完成」状态：
// 所有子枪名一并改成新颜色，并清掉各自的 colorBeforeUserMark / colorMarkedBy。
// 其中原来已标白（完成）的枪名也会被染成新颜色——主任务重新上了颜色就代表任务重新开始，
// 不能再留下白色枪名，否则会出现「主任务有色、子枪名还是完成状态」的矛盾行。
const syncGunColorsWithTask = (item, color) => {
  const guns = Array.isArray(item.guns) ? item.guns : [];
  if (guns.length === 0) return;
  guns.forEach(gun => {
    gun.color = color;
    delete gun.colorBeforeUserMark;
    delete gun.colorMarkedBy;
  });
  item.guns = guns;
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
  // 任务加急：整行改用加急配色并染红文字
  urgent: Joi.boolean().default(false),
  fontSize: Joi.string().allow('').default(''),
  textColor: Joi.string().allow('').default('')
});

const updateItemSchema = Joi.object({
  designerId: Joi.string().required(),
  date: Joi.string().isoDate().required(),
  itemId: Joi.string().required(),
  field: Joi.string().valid('taskName', 'hours', 'color', 'guns', 'leaveType', 'urgent', 'fontSize', 'textColor', 'gunColor').required(),
  value: Joi.alternatives().try(
    Joi.string().allow(''),
    Joi.number().min(0),
    Joi.boolean(),
    Joi.array().items(gunSchema),
    Joi.string().valid('sick', 'vacation', 'illness', 'trip', null).allow(null)
  ).required(),
  gunIndex: Joi.number().integer().min(0).optional()
});

// 批量粘贴创建：与 createItemSchema 字段保持一致（条目的 id 由服务端重新生成，
// 忽略客户端传入值）；通过 Joi 白名单校验避免手工校验漏字段
const batchCreateItemSchema = Joi.object({
  taskName: Joi.string().allow('').default(''),
  hours: Joi.number().min(0).default(0),
  color: Joi.string().allow('').default(''),
  guns: Joi.array().items(gunSchema).default([]),
  leaveType: Joi.string().valid('sick', 'vacation', 'illness', 'trip', null).allow(null).default(null),
  urgent: Joi.boolean().default(false),
  fontSize: Joi.string().allow('').default(''),
  textColor: Joi.string().allow('').default('')
});

const batchCreateSchema = Joi.object({
  designerId: Joi.string().required(),
  date: Joi.string().isoDate().required(),
  items: Joi.array().items(batchCreateItemSchema).min(1).required(),
  newIndex: Joi.number().integer().min(0).optional()
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

// 跨主任务移动单个枪名：从源主任务的 guns 中移除，插入目标主任务 guns 的 newIndex
// 位置（未传则追加到最下面）；源与目标可为同一主任务（此时为重排）；
// targetItemId 传空且带 createTaskName 时，表示落点单元格没有主任务，
// 先按 createTaskName（通常是源主任务名称）新建一个主任务承接该枪名
const moveGunSchema = Joi.object({
  sourceDesignerId: Joi.string().required(),
  sourceDate: Joi.string().isoDate().required(),
  sourceItemId: Joi.string().required(),
  gunId: Joi.string().required(),
  targetDesignerId: Joi.string().required(),
  targetDate: Joi.string().isoDate().required(),
  targetItemId: Joi.string().allow('').default(''),
  createTaskName: Joi.string().allow('').optional(),
  // 仅前端撤销流程使用：撤销时源主任务可能已被删除并按快照重建（guns 为空），
  // 需要允许把枪名移回这个暂时没有枪名的任务
  allowEmptyTarget: Joi.boolean().default(false),
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

const countLiteral = (value, findText) => {
  if (typeof value !== 'string' || !value.includes(findText)) return 0;
  return value.split(findText).length - 1;
};

// 批量替换的目标表：LIKE 预筛出含匹配文本的候选表再完整装配，
// 不再扫描全部任务数据，数据量多大都只加载命中部分
const getBatchReplaceTargetSheets = (findText, allTable, month, year) => {
  const candidateIds = taskStore.findCandidateSheetIds(findText, { allTable, month, year });
  return taskStore.getSheetsByIds(candidateIds);
};

const findBatchReplaceMatches = (targetSheets, designers, findText) => {
  const designerMap = new Map((designers || []).map(designer => [designer.id, designer.name]));
  const matches = [];
  let matchCount = 0;

  targetSheets.forEach(sheet => {
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
              fields.push({ field: 'gunName', label: `枪名${index + 1}`, text: gun.name, count: gunNameCount });
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

// 所有主任务条目中使用过的焊枪名（去重）——台账页/主页面据此将已用枪名标为天蓝色
router.get('/used-gun-names', authMiddleware, asyncHandler(async (req, res) => {
  res.json({ gunNames: taskStore.listUsedGunNames() });
}));

// 焊枪台账 → 枪名索引：枪名 → { customer, category, tableName }
// 同名枪名在多个表中出现时，以首次出现的位置为准；客户列取首个非空值
const buildGunLedgerIndex = (gunLedger) => {
  const index = new Map();
  const categories = gunLedger && gunLedger.categories ? gunLedger.categories : {};
  Object.keys(categories).forEach(category => {
    const tables = Array.isArray(categories[category]) ? categories[category] : [];
    tables.forEach(table => {
      const rows = Array.isArray(table && table.rows) ? table.rows : [];
      rows.forEach(row => {
        const gunName = String(row && row.gunName || '').trim();
        if (!gunName) return;
        const customer = String(row && row.customer || '').trim();
        const existing = index.get(gunName);
        if (!existing) {
          index.set(gunName, { customer, category, tableName: String(table && table.name || '') });
        } else if (!existing.customer && customer) {
          existing.customer = customer;
        }
      });
    });
  });
  return index;
};

// 枪名搜索（含归属）——供主页面「确认图修改」快捷键快速添加使用
// 返回台账中匹配的枪名 + 该枪名当前所在任务（设计员 / 日期 / 任务名），
// 前端据此把「确认图修改」默认安排给该枪名所属任务的设计员。
// 搜索范围：默认只看 year/month 指定月份（未传则用服务器当前月），
// allMonths=true 时才搜索所有月份（对应弹窗右上角的「全表搜索」开关）。
router.get('/gun-name-search', authMiddleware, asyncHandler(async (req, res) => {
  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isAdmin) {
    return res.status(403).json({ message: '只有管理员可以使用该快捷操作' });
  }

  const query = String(req.query.q || '').trim();
  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 20, 1), 50);

  const allMonths = String(req.query.allMonths || '') === 'true';
  const now = new Date();
  const rawYear = parseInt(req.query.year, 10);
  const rawMonth = parseInt(req.query.month, 10);
  const scope = allMonths ? null : {
    year: Number.isFinite(rawYear) ? rawYear : now.getFullYear(),
    month: Number.isFinite(rawMonth) ? rawMonth : now.getMonth() + 1,
  };

  const designers = db.readDesigners();
  const designerNameMap = new Map(designers.map(d => [d.id, d.name || d.id || '']));

  const decorateOwners = (owners) => owners.map(o => ({
    ...o,
    designerName: designerNameMap.get(o.designerId) || o.designerId
  }));

  // 必须带关键字：不支持空查询（前端空输入时不会发请求）
  if (!query) {
    return res.status(400).json({ message: '请输入枪名关键字' });
  }

  const index = buildGunLedgerIndex(db.readGunLedger());
  // 任务里实际出现过的枪名（含台账未登记的）：一次预筛同时拿到归属
  const ownersByGun = taskStore.findGunOwnersByQuery(query, 10, scope);

  const lower = query.toLowerCase();
  const names = new Set();
  for (const gunName of ownersByGun.keys()) names.add(gunName);
  for (const gunName of index.keys()) {
    if (!gunName.toLowerCase().includes(lower)) continue;
    // 限定月份时台账里「当月没有任何任务归属」的枪名不算命中，
    // 否则全量台账会把范围限制架空
    if (scope && !ownersByGun.has(gunName)) continue;
    names.add(gunName);
  }

  const matches = Array.from(names).map(gunName => {
    const info = index.get(gunName);
    return {
      gunName,
      customer: (info && info.customer) || '',
      category: (info && info.category) || '',
      tableName: (info && info.tableName) || '',
      owners: decorateOwners(ownersByGun.get(gunName) || []),
      prefix: gunName.toLowerCase().indexOf(lower) === 0 ? 0 : 1
    };
  });
  // 排序：前缀匹配 → 已有归属（该快捷操作的目的就是找到枪名所属设计员）→ 名称更短 → 字典序
  matches.sort((a, b) => a.prefix - b.prefix
    || (b.owners.length > 0 ? 1 : 0) - (a.owners.length > 0 ? 1 : 0)
    || a.gunName.length - b.gunName.length
    || a.gunName.localeCompare(b.gunName));

  const results = matches.slice(0, limit).map(({ prefix, ...rest }) => rest);

  res.json({ results });
}));

router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const { month, year, designerId, summary } = req.query;

  const filter = {};
  if (designerId) filter.designerId = designerId;
  if (month && year) {
    filter.month = parseInt(month);
    filter.year = parseInt(year);
  }

  const tasks = taskStore.listSheets(filter);

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
  const { error, value: validated } = batchCreateSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const { designerId, date: rawDate, items: pasteItems, newIndex } = validated;
  const date = normalizeDate(rawDate);
  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isAdmin) {
    return res.status(403).json({ message: '只有管理员可以编辑表格' });
  }

  const { month, year } = getMonthYearFromDate(date);
  const sheet = taskStore.getOrCreateSheet(designerId, month, year);

  if (!sheet.days[date]) sheet.days[date] = [];

  const colorConfig = getTaskColorConfig(db.readDb());
  const addedItems = [];
  for (const item of pasteItems) {
    const gunError = validateNamedGunHours(item.guns) || validateDuplicateGunNames(item.guns);
    if (gunError) {
      return res.status(400).json({ message: gunError });
    }

    const newItem = withCreateMeta({
      id: `item-${Date.now().toString()}${Math.random().toString(36).slice(2, 9)}`,
      taskName: item.taskName,
      hours: item.hours,
      color: item.color,
      guns: item.guns,
      leaveType: item.leaveType,
      urgent: Boolean(item.urgent),
      fontSize: item.fontSize,
      textColor: item.textColor
    }, req.user);
    // 任务内容配色体系：底色由「任务内容后缀 + 加急」决定（请假/出差保留自身底色）
    newItem.color = deriveItemColor(newItem, colorConfig);
    addedItems.push(newItem);
  }

  // newIndex 指定时整体插入到该位置（粘贴/拖拽复制的预插入点），否则追加到最下面
  if (typeof newIndex === 'number' && newIndex >= 0 && newIndex <= sheet.days[date].length) {
    sheet.days[date].splice(newIndex, 0, ...addedItems);
  } else {
    sheet.days[date].push(...addedItems);
  }

  taskStore.saveSheet(sheet);
  res.status(201).json({ sheetId: sheet.id, designerId, month, year, date, items: addedItems, sheet });
}));

router.post('/item', authMiddleware, asyncHandler(async (req, res) => {
  const { error, value: validated } = createItemSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const { designerId, date: rawDate, taskName, hours, color, guns } = validated;
  const date = normalizeDate(rawDate);
  const gunError = validateNamedGunHours(guns) || validateDuplicateGunNames(guns);
  if (gunError) {
    return res.status(400).json({ message: gunError });
  }

  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isAdmin) {
    return res.status(403).json({ message: '只有管理员可以编辑表格' });
  }

  const { month, year } = getMonthYearFromDate(date);
  const sheet = taskStore.getOrCreateSheet(designerId, month, year);

  if (!sheet.days[date]) sheet.days[date] = [];
  const item = withCreateMeta({
    id: `item-${Date.now().toString()}${Math.random().toString(36).slice(2, 9)}`,
    taskName,
    hours,
    color,
    guns,
    leaveType: validated.leaveType || null,
    urgent: Boolean(validated.urgent),
    fontSize: validated.fontSize || '',
    textColor: validated.textColor || ''
  }, req.user);
  // 任务内容配色体系：底色由「任务内容后缀 + 加急」决定（请假/出差保留自身底色）
  item.color = deriveItemColor(item, getTaskColorConfig(db.readDb()));
  sheet.days[date].push(item);

  taskStore.saveSheet(sheet);
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
  const targetSheets = getBatchReplaceTargetSheets(findText, allTable, month, year);
  const result = findBatchReplaceMatches(targetSheets, data.designers, findText);

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
  const targetSheets = getBatchReplaceTargetSheets(findText, allTable, month, year);

  let replacementCount = 0;
  let itemCount = 0;
  const changedSheets = new Map();

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
          changedSheets.set(sheet.id, sheet);
        }
      });
    });
  });

  if (changedSheets.size > 0) {
    taskStore.saveSheets([...changedSheets.values()]);
  }

  res.json({
    message: '批量替换完成',
    replacementCount,
    itemCount,
    sheetCount: changedSheets.size
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
  const sheet = taskStore.getOrCreateSheet(designerId, month, year);

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
      return res.status(403).json({ message: '无权修改任务完成状态' });
    }

    const isRestore = normalizeColorValue(value) === '__restore__';

    // Admin can set any color value directly (via task edit modal)
    // 主任务改色 = 整条任务重新开始：子枪名颜色一起改为新色，原先标白的枪名也一并取消完成状态
    if (isAdmin && !isRestore && !isWhiteColor(value)) {
      item.color = value;
      delete item.colorBeforeUserMark;
      delete item.colorMarkedBy;
      syncGunColorsWithTask(item, value);
      touchItem(item, req.user);
      sheet.days[date] = items;
      taskStore.saveSheet(sheet);
      return res.json({ sheetId: sheet.id, designerId, month, year, date, item, sheet });
    }

    // Non-admin users: only white mark or restore is allowed
    if (!isRestore && !isWhiteColor(value)) {
      return res.status(403).json({ message: 'Only white mark or restore is allowed' });
    }

    if (isRestore) {
      // 恢复原色同样是「改色标」，普通用户只能作用于自己的任务行：
      // canUserMarkDesignPlanColor 已包含「设计员姓名 = 本人姓名 + 开关开启」校验。
      // 不再放行 colorMarkedBy.id === 'auto'（系统自动标白不区分归属），
      // 否则任何登录用户都能借该分支恢复（即改动）他人被自动标白的任务行。
      const canRestore = isAdmin || canUserMarkDesignPlanColor(data, req.user, designerId, item) || item.colorMarkedBy?.id === req.user.id;
      if (isWhiteColor(item.color) && canRestore) {
        const guns = Array.isArray(item.guns) ? item.guns : [];
        if (Object.prototype.hasOwnProperty.call(item, 'colorBeforeUserMark')) {
          // Restore all guns too (auto-marked or user-marked main task)
          guns.forEach(gun => {
            if (isWhiteColor(gun.color) && Object.prototype.hasOwnProperty.call(gun, 'colorBeforeUserMark')) {
              gun.color = gun.colorBeforeUserMark || '';
              delete gun.colorBeforeUserMark;
              delete gun.colorMarkedBy;
            }
          });
          item.color = item.colorBeforeUserMark || '';
        } else {
          // 拷贝自已完成任务的白条目没有恢复记录：直接回到「按任务内容派生」的标准底色
          // （枪名行不单独持色，清空后跟随主任务行的派生底色）
          item.color = deriveItemColor({ ...item, color: '' }, getTaskColorConfig(data));
          guns.forEach(gun => {
            if (isWhiteColor(gun.color)) {
              gun.color = gun.colorBeforeUserMark || '';
              delete gun.colorBeforeUserMark;
              delete gun.colorMarkedBy;
            }
          });
        }
        item.guns = guns;
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
    taskStore.saveSheet(sheet);
    return res.json({ sheetId: sheet.id, designerId, month, year, date, item, sheet });
  }

  // Gun color marking (admins or authorized users)
  if (field === 'gunColor') {
    const canMarkGunColor = isAdmin || canUserMarkGunColor(data, req.user, designerId, item);
    if (!canMarkGunColor) {
      return res.status(403).json({ message: '无权修改枪名任务完成状态' });
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
      // 与主任务改色一致：普通用户只能恢复自己任务行上的枪名色标，
      // 不再放行 colorMarkedBy.id === 'auto'（详见上方主任务分支说明）。
      const canRestoreGun = isAdmin || canUserMarkGunColor(data, req.user, designerId, item) || targetGun.colorMarkedBy?.id === req.user.id;
      if (isWhiteColor(targetGun.color) && canRestoreGun) {
        if (Object.prototype.hasOwnProperty.call(targetGun, 'colorBeforeUserMark')) {
          targetGun.color = targetGun.colorBeforeUserMark || '';
        } else {
          // 拷贝自已完成任务的白枪名没有恢复记录：清空颜色，跟随主任务行的派生底色
          targetGun.color = '';
        }
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
    syncTaskColorWithGuns(item);

    touchItem(item, req.user);
    sheet.days[date] = items;
    taskStore.saveSheet(sheet);
    return res.json({ sheetId: sheet.id, designerId, month, year, date, item, sheet });
  }

  // For non-color fields, check permissions
  if (!isAdmin) {
    return res.status(403).json({ message: 'Only admins can edit tasks' });
  }

  if (field === 'guns') {
    const gunError = validateNamedGunHours(value) || validateDuplicateGunNames(value);
    if (gunError) {
      return res.status(400).json({ message: gunError });
    }
  }

  const colorConfig = getTaskColorConfig(data);
  if (field === 'hours') {
    item.hours = typeof value === 'number' ? value : (parseFloat(value) || 0);
  } else if (field === 'color') {
    item.color = value;
    delete item.colorBeforeUserMark;
    delete item.colorMarkedBy;
  } else if (field === 'guns') {
    item.guns = value;
    // 删除/编辑枪名后同步主任务标记状态（如只剩一个白色枪名时主任务自动标白）
    syncTaskColorWithGuns(item);
  } else if (field === 'leaveType') {
    item.leaveType = value;
    // 切回设计计划时按任务内容重新上色（请假/出差保留自身默认底色）
    if (!value) item.color = deriveItemColor(item, colorConfig);
  } else if (field === 'urgent') {
    item.urgent = Boolean(value);
    // 加急状态变化即改变整行配色，库里的 color 同步派生值（导出/旧版消费方保持一致）
    item.color = deriveItemColor(item, colorConfig);
  } else if (field === 'taskName') {
    item.taskName = value;
    // 任务内容后缀变化（确认图 → 设计变更 等）时底色随之改变
    item.color = deriveItemColor(item, colorConfig);
  } else {
    item.taskName = value;
  }
  touchItem(item, req.user);

  sheet.days[date] = items;
  taskStore.saveSheet(sheet);
  res.json({ sheetId: sheet.id, designerId, month, year, date, item, sheet });
}));

router.delete('/item', authMiddleware, asyncHandler(async (req, res) => {
  const { error, value: validated } = deleteItemSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const { designerId, date: rawDate, itemId } = validated;
  const date = normalizeDate(rawDate);
  const { month, year } = getMonthYearFromDate(date);
  const sheet = taskStore.getOrCreateSheet(designerId, month, year);

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

  taskStore.saveSheet(sheet);
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

  // Source
  const sMY = getMonthYearFromDate(sDate);
  const sSheet = taskStore.getOrCreateSheet(sourceDesignerId, sMY.month, sMY.year);
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
  // 同一张表（同设计员同年同月）时必须复用源表对象：getOrCreateSheet 每次都会从库里
  // 重新装配一个新对象，不复用会导致目标日期数组仍含被移任务原身，插入后产生重复 id
  const isSameSheet = sourceDesignerId === targetDesignerId && sMY.month === tMY.month && sMY.year === tMY.year;
  const tSheet = isSameSheet ? sSheet : taskStore.getOrCreateSheet(targetDesignerId, tMY.month, tMY.year);
  if (!tSheet.days[tDate]) tSheet.days[tDate] = [];

  touchItem(item, req.user);
  if (typeof newIndex === 'number' && newIndex >= 0) {
    tSheet.days[tDate].splice(newIndex, 0, item);
  } else {
    tSheet.days[tDate].push(item);
  }

  taskStore.saveSheets(isSameSheet ? [sSheet] : [sSheet, tSheet]);
  res.json({ message: '任务已移动', sourceSheet: sSheet, targetSheet: tSheet });
}));

// 将单个枪名从一个主任务移动到另一个主任务（支持跨人员/跨日期）：
// - 目标主任务已存在同名枪名时拒绝移动；
// - newIndex 指定插入位置，未传则追加到最下面；源与目标可为同一主任务（重排）；
// - 源主任务的最后一个枪名被移走后，整个源主任务一并删除
router.post('/move-gun', authMiddleware, asyncHandler(async (req, res) => {
  const { error, value: validated } = moveGunSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const { sourceDesignerId, sourceDate, sourceItemId, gunId, targetDesignerId, targetDate, targetItemId, createTaskName, allowEmptyTarget, newIndex } = validated;
  const sDate = normalizeDate(sourceDate);
  const tDate = normalizeDate(targetDate);

  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isAdmin) {
    return res.status(403).json({ message: '只有管理员可以移动枪名' });
  }

  // Source
  const sMY = getMonthYearFromDate(sDate);
  const sSheet = taskStore.getOrCreateSheet(sourceDesignerId, sMY.month, sMY.year);
  const sItems = Array.isArray(sSheet.days[sDate]) ? sSheet.days[sDate] : [];

  const sourceItem = sItems.find(i => i.id === sourceItemId);
  if (!sourceItem) {
    return res.status(404).json({ message: '源主任务不存在' });
  }
  const sourceGuns = Array.isArray(sourceItem.guns) ? sourceItem.guns : [];
  const gunIdx = sourceGuns.findIndex(g => g && g.id === gunId);
  if (gunIdx === -1) {
    return res.status(404).json({ message: '枪名不存在' });
  }
  const gun = sourceGuns[gunIdx];

  // Target（先做全部校验，再统一变更）
  const tMY = getMonthYearFromDate(tDate);
  // 同一张表（同设计员同年同月）时必须复用源表对象，避免重新装配丢失刚才的修改
  const isSameSheet = sourceDesignerId === targetDesignerId && sMY.month === tMY.month && sMY.year === tMY.year;
  const tSheet = isSameSheet ? sSheet : taskStore.getOrCreateSheet(targetDesignerId, tMY.month, tMY.year);
  const tItems = Array.isArray(tSheet.days[tDate]) ? tSheet.days[tDate] : [];
  let targetItem = targetItemId ? tItems.find(i => i.id === targetItemId) : null;
  // 落点没有主任务（targetItemId 为空）：按 createTaskName 复制一个主任务承接该枪名，
  // 名称由前端传入（取自源主任务）；完成状态（颜色标记）与被移动的枪名保持一致：
  // 枪名为白色（完成）→ 新主任务同样标白，并优先记录源主任务原色用于后续「未完成」恢复；
  // 枪名带其他颜色 → 新主任务沿用同一颜色；
  // 枪名未完成但没有颜色 → 优先沿用源主任务颜色，源主任务也是白色/无色时按任务名派生底色
  // （如「XX 确认图」→ 确认图配色），并把该枪名一并染成该色——白色在系统中表示"已完成"，
  // 未完成的枪名不能落到白底上
  let targetItemCreated = false;
  if (!targetItem && !targetItemId && createTaskName !== undefined) {
    const gunColor = String(gun?.color || '');
    const gunIsWhite = isWhiteColor(gunColor);
    const sourceColor = String(sourceItem?.color || '');
    let createdColor = gunIsWhite ? '#ffffff' : gunColor;
    if (!gunIsWhite && !gunColor) {
      createdColor = (sourceColor && !isWhiteColor(sourceColor))
        ? sourceColor
        : deriveItemColor({ taskName: createTaskName, color: '' }, getTaskColorConfig(db.readDb()));
      if (gun) gun.color = createdColor;
    }
    targetItem = withCreateMeta({
      id: `item-${Date.now().toString()}${Math.random().toString(36).slice(2, 9)}`,
      taskName: createTaskName,
      hours: 0,
      color: createdColor,
      colorBeforeUserMark: gunIsWhite && sourceColor && !isWhiteColor(sourceColor) ? sourceColor : '',
      colorMarkedBy: gunIsWhite ? { id: 'auto', username: 'auto', name: '系统自动' } : undefined,
      guns: [],
      leaveType: null,
      fontSize: '',
      textColor: ''
    }, req.user);
    tItems.push(targetItem);
    tSheet.days[tDate] = tItems;
    targetItemCreated = true;
  }
  if (!targetItem) {
    return res.status(404).json({ message: '目标主任务不存在' });
  }
  if (targetItem.leaveType) {
    return res.status(400).json({ message: '不能移动到请假/出差类任务' });
  }
  const targetGuns = Array.isArray(targetItem.guns) ? targetItem.guns : [];

  // 目标主任务没有任何枪名时不允许把枪名移进去：这类行只有主任务自身的内容（工时/名称），
  // 一旦塞入枪名，主任务工时会被枪名工时取代而丢失原意。
  // 例外：① 本次请求按 createTaskName 新建的目标主任务（就是靠这次移动塞入第一个枪名）；
  //       ② 前端撤销流程（allowEmptyTarget=true）——源主任务被删除后按快照重建，此时还没有枪名
  if (!targetItemCreated && targetGuns.length === 0 && !allowEmptyTarget) {
    return res.status(400).json({ message: '目标主任务没有枪名，不能移入枪名' });
  }

  // 目标主任务已存在同名枪名时禁止移动（同一主任务内重排时排除枪名自身）
  const gunName = String(gun?.name || '').trim();
  if (gunName) {
    const dup = targetGuns.find(g => g && g.id !== gunId && String(g.name || '').trim() === gunName);
    if (dup) {
      return res.status(400).json({ message: `目标主任务已存在枪名「${gunName}」，无法移动` });
    }
  }

  // 从源主任务移除该枪名
  sourceGuns.splice(gunIdx, 1);
  sourceItem.guns = sourceGuns;

  const isSameItem = sourceDesignerId === targetDesignerId && sDate === tDate && sourceItemId === targetItem.id;
  // 源主任务只剩这一个枪名且被移走：整个源主任务一并删除
  let sourceItemDeleted = false;
  if (!isSameItem && sourceGuns.length === 0) {
    const srcIdx = sItems.findIndex(i => i.id === sourceItemId);
    if (srcIdx !== -1) sItems.splice(srcIdx, 1);
    sourceItemDeleted = true;
  } else {
    touchItem(sourceItem, req.user);
    // 移走枪名后同步源主任务标记状态（如只剩一个白色枪名时主任务自动标白）
    syncTaskColorWithGuns(sourceItem);
  }
  if (sItems.length === 0) {
    delete sSheet.days[sDate];
  } else {
    sSheet.days[sDate] = sItems;
  }

  // 插入到目标主任务
  targetItem.guns = targetGuns;
  if (typeof newIndex === 'number' && newIndex >= 0) {
    const idx = Math.min(newIndex, targetItem.guns.length);
    targetItem.guns.splice(idx, 0, gun);
  } else {
    targetItem.guns.push(gun);
  }
  // 移入枪名后同步目标主任务标记状态
  syncTaskColorWithGuns(targetItem);
  touchItem(targetItem, req.user);

  taskStore.saveSheets(isSameSheet ? [sSheet] : [sSheet, tSheet]);
  const message = targetItemCreated
    ? '已按源主任务名称新建主任务，枪名已移入'
    : (sourceItemDeleted ? '枪名已移动，源主任务已删除' : '枪名已移动');
  res.json({
    message,
    sourceItemDeleted,
    targetItemId: targetItem.id,
    targetItemCreated,
    sourceSheet: sSheet,
    targetSheet: tSheet
  });
}));

module.exports = router;
