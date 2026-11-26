'use strict';
/**
 * 数据维护：备份 / 归档 / 清理、大日程探测、任务表导入导出、历史数据清空。
 * 这个分组里的写操作最多，动之前先看 docs/DEVELOPMENT.md 的「新增一个写操作」。
 *
 * 由 backend/routes/system.js 拆分而来，代码为原样搬运（未改逻辑）。
 */
const express = require('express');

const router = express.Router();
const multer = require('multer');
// 导入 Excel 用内存存储：文件不落盘，避免临时目录残留与「上传一半」的中间态
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const XLSX = require('xlsx');
const db = require('../../db');
const taskStore = require('../../taskStore');
const { authMiddleware, superAdminMiddleware, accessSettingsMiddleware } = require('../../middleware/auth');
const asyncHandler = require('express-async-handler');
const { normalizeWorkdayOverrides } = require('../../utils/workday');
const { validateFileType, validateWorkbookStructure, scanForMaliciousContent, sanitizeWorkbook } = require('../../utils/fileUploadSecurity');
const maintenance = require('../../utils/dbMaintenance');
const productionSchedule = require('../../utils/productionSchedule');
const { buildTaskExportBuffer } = require('../../utils/taskExportWorkbook');
const { maintenanceSettingsSchema, offlineBackupAccess } = require('./shared');
const { formatDownloadTimestamp, sheetHasData, parseMonthFromSheetName, normalizeMonthValue, parseHtmlExportTables, parseRenderedExportSheet } = require('./excel');

router.get('/maintenance', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  // 体积构成来自 dbstat 全库扫描（网络盘上 2~5 秒）：dbstat 表体积走 dbStatCache
  // （默认 10 分钟，过期只在后台补算），整体测量走 measureCache（默认 60 秒），
  // 两层都不在请求路径上同步重扫；用户点「刷新」时前端传 force=1 穿透两层缓存。
  res.json(maintenance.getMaintenanceStatus({ force: String(req.query.force || '') === '1' }));
}));

// 共享盘排障：状态跟踪「同步生产大日程」读不到「各产品大日程.xls」时，
// 前端只有一句笼统提示。这里强制重读一次共享文件，返回路径、可读性、条目数、
// 真实错误码与 net use 连接状态，管理员不必再登录服务器翻日志。
router.get('/schedule-probe', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const probe = await productionSchedule.probeSchedule();
  res.json({ success: true, ...probe });
}));

router.put('/maintenance', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const { error, value } = maintenanceSettingsSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ message: '输入格式不正确', details: error.details });
  }

  const data = db.readDb();
  if (!data.settings) data.settings = {};
  const current = maintenance.normalizeMaintenanceSettings(data.settings.maintenance);
  data.settings.maintenance = maintenance.normalizeMaintenanceSettings({
    ...current,
    ...value,
    yearlyCleanupHistory: current.yearlyCleanupHistory
  });
  await db.writeDb(data);
  maintenance.scheduleNextRun();
  // 保存设置可能改了维护目录路径，files 列表必须重读；失效测量缓存即可，
  // 不传 force——避免触发 dbstat 全库重扫（3 秒），dbstat 走缓存不影响目录文件列表。
  maintenance.invalidateMeasurementCache();
  res.json(maintenance.getMaintenanceStatus());
}));

router.post('/maintenance/backup', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const backup = await maintenance.createDatabaseBackup();
  res.json({ message: '数据库备份已完成', backup });
}));

router.post('/maintenance/offline-backup', offlineBackupAccess, asyncHandler(async (req, res) => {
  const result = await maintenance.createOfflineBackup(req.user?.id, req.user?.username, { async: true });
  if (result.skipped) {
    res.json({ message: '断网备份已跳过', reason: result.reason });
  } else {
    res.json({ message: '断网备份已完成', backup: result });
  }
}));

router.post('/maintenance/export-tasks', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  try {
    const taskExport = maintenance.exportTaskData({ type: 'manual-task-export', requireData: true });
    res.json({ message: '\u4efb\u52a1\u8868\u683c\u5df2\u5bfc\u51fa', taskExport });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ message: error.message || '\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684\u6570\u636e' });
    }
    throw error;
  }
}));

router.post('/maintenance/export-gun-ledger', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  try {
    const gunLedgerExport = maintenance.exportGunLedgerData({ type: 'manual-gun-ledger-export', requireData: true });
    res.json({ message: '\u7f16\u53f7\u53f0\u8d26\u5df2\u5bfc\u51fa', gunLedgerExport });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ message: error.message || '\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684\u7f16\u53f7\u53f0\u8d26\u6570\u636e' });
    }
    throw error;
  }
}));

router.post('/maintenance/cleanup-backups', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  res.json({ message: '过期备份清理已完成', cleanup: maintenance.cleanupOldBackups() });
}));

router.post('/maintenance/yearly-cleanup', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const result = await maintenance.runYearlyTaskCleanup({ force: Boolean(req.body?.force) });
  res.json({ message: result.skipped ? '年度任务清理检测已跳过' : '年度任务清理检测已完成', yearlyCleanup: result });
}));

// ===== 年度归档：列表 / 预览 / 恢复 =====
// 只读接口供「运维工具」标签页展示，全部限制在归档目录与标准文件名之内（见 dbMaintenance）。
router.get('/maintenance/archives', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  res.json(maintenance.listYearlyArchives());
}));

router.get('/maintenance/archives/inspect', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const fileName = String(req.query.file || '').trim();
  if (!fileName) return res.status(400).json({ message: '请指定要预览的归档文件' });
  res.json(maintenance.inspectYearlyArchive(fileName));
}));

// 恢复是一次性写库操作：默认先备份整库、默认跳过已存在的月份，
// 只有显式传 overwrite 才会覆盖现有任务表。
router.post('/maintenance/archives/restore', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const body = req.body || {};
  const fileName = String(body.file || '').trim();
  if (!fileName) return res.status(400).json({ message: '请指定要恢复的归档文件' });

  const result = await maintenance.restoreYearlyArchive({
    fileName,
    dryRun: Boolean(body.dryRun),
    overwrite: Boolean(body.overwrite),
    backup: body.backup !== false
  });

  if (!result.dryRun && result.restoredSheets > 0) {
    const io = req.app.get('io');
    if (io) io.emit('task_refreshed', { scope: 'yearly-archive-restore' });
  }

  const message = result.dryRun
    ? `预演完成：可恢复 ${result.planned.writeSheets} 个工作表，跳过 ${result.planned.skippedSheets} 个已存在的工作表`
    : `归档恢复完成：写入 ${result.restoredSheets} 个工作表（${result.restoredItems} 条任务记录），跳过 ${result.planned.skippedSheets} 个，失败 ${result.failed.length} 个`;

  res.json({ message, restore: result });
}));

router.post('/maintenance/clear-logs', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  // 登录/操作日志均在独立表中，直接清空，无需整库读写
  const loginLogsCount = db.countLoginLogs();
  const auditLogsCount = db.countAuditLogs();
  db.clearLoginLogs();
  db.clearAuditLogs();
  res.json({ message: '日志已清空', loginLogsCount, auditLogsCount });
}));

router.post('/maintenance/cleanup-tasks', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const { month, year, beforeMonth, beforeYear, all } = req.body;

  let result = null;
  let scopeLabel = '';

  if (all === true) {
    result = taskStore.deleteAllSheets();
    scopeLabel = '全部月份';
  } else if (month && year) {
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    result = taskStore.deleteSheetsByMonth(y, m);
    scopeLabel = `${y}-${String(m).padStart(2, '0')}`;
  } else if (beforeMonth && beforeYear) {
    const m = parseInt(beforeMonth, 10);
    const y = parseInt(beforeYear, 10);
    result = taskStore.deleteSheetsBefore(y, m);
    scopeLabel = `${y}-${String(m).padStart(2, '0')} 之前`;
  } else {
    return res.status(400).json({ message: '请指定月份、清理时间点或选择清空全部任务数据' });
  }

  // 删除只是把页标记为空闲，不压缩的话数据文件大小不会变化，
  // 页面上的磁盘占用看起来「清了跟没清一样」。这里立刻回收一次。
  // 压缩失败不能影响清理结果，因此单独兜住异常。
  let compaction = null;
  try {
    compaction = maintenance.compactDatabase();
  } catch (e) {
    console.error('[maintenance] 清理后压缩数据库失败:', e.message);
  }

  const remainingSheets = taskStore.countSheets();
  const remainingItems = taskStore.countEntries();

  const io = req.app.get('io');
  if (io) io.emit('task_refreshed', { scope: 'task-cleanup' });

  res.json({
    message: '任务数据清理完成',
    scope: scopeLabel,
    // 两个口径分开返回：工作表 = 设计员 × 月份，任务记录 = 表内条目
    removedSheets: result.removedSheets,
    removedItems: result.removedTaskItems,
    remainingSheets,
    remainingItems,
    freedBytes: compaction ? compaction.freedBytes : 0,
    removedOrphans: compaction ? compaction.removedOrphans : 0,
    // 兼容旧字段（历史调用方按「张数」理解 removedCount / remainingCount）
    removedCount: result.removedSheets,
    remainingCount: remainingSheets
  });
}));

router.post('/maintenance/compact', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const compaction = maintenance.compactDatabase();
  res.json({ message: '数据库压缩完成', compaction });
}));

router.get('/export-xls', [authMiddleware, accessSettingsMiddleware('systemSettings')], asyncHandler(async (req, res) => {
  const data = db.readDb();
  const designers = data.designers || [];
  const exportSheets = taskStore.listSheetsWithData();

  if (exportSheets.length === 0) {
    return res.status(404).json({ message: '没有可导出的数据' });
  }

  const buffer = buildTaskExportBuffer(exportSheets, designers, normalizeWorkdayOverrides(data.settings?.workdayOverrides));
  const filename = `obara-tasks-${formatDownloadTimestamp()}.xls`;
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}));

router.post('/import-xls', [authMiddleware, superAdminMiddleware, upload.single('file')], asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  if (!req.file) {
    return res.status(400).json({ message: '请上传 xls/xlsx 文件' });
  }

  const fileTypeValidation = validateFileType(req.file.originalname, req.file.mimetype);
  if (!fileTypeValidation.valid) {
    return res.status(400).json({ message: fileTypeValidation.error });
  }

  const targetMonth = normalizeMonthValue(req.body.month);
  if (!targetMonth) {
    return res.status(400).json({ message: '请选择要导入覆盖的月份（格式：YYYY-MM）' });
  }

  let workbook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellStyles: true });
  } catch {
    return res.status(400).json({ message: '无法解析文件，请检查格式' });
  }

  if (!workbook) {
    return res.status(400).json({ message: '无法解析文件，请检查格式' });
  }

  const structureValidation = validateWorkbookStructure(workbook);
  if (!structureValidation.valid) {
    return res.status(400).json({ message: structureValidation.error });
  }

  const securityScan = scanForMaliciousContent(workbook);
  if (!securityScan.safe) {
    return res.status(400).json({ 
      message: securityScan.message,
      details: securityScan.details
    });
  }

  sanitizeWorkbook(workbook);

  const data = db.readDb();
  const designers = data.designers || [];
  const designerByName = new Map(designers.map(d => [String(d.name || '').trim(), d]));
  const skippedDesigners = new Set();

  let importedRows = 0;
  const mergedSheetMap = new Map();

  if (workbook) {
    workbook.SheetNames.forEach(sheetName => {
      const parsed = parseMonthFromSheetName(sheetName);
      if (parsed && (parsed.year !== targetMonth.year || parsed.month !== targetMonth.month)) return;

      const worksheet = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
      if (rawRows.length <= 2) return;

      const parsedRendered = parseRenderedExportSheet({
        worksheet,
        rawRows,
        targetMonth,
        designerByName,
        skippedDesigners
      });

      importedRows += parsedRendered.importedRows;
      parsedRendered.sheetMap.forEach((sheet, designerId) => {
        if (!mergedSheetMap.has(designerId)) {
          mergedSheetMap.set(designerId, {
            designerId,
            month: targetMonth.month,
            year: targetMonth.year,
            days: {}
          });
        }

        const merged = mergedSheetMap.get(designerId);
        Object.entries(sheet.days || {}).forEach(([date, items]) => {
          if (!merged.days[date]) merged.days[date] = [];
          merged.days[date] = merged.days[date].concat(items);
        });
      });
    });
  } else {
    const htmlTables = parseHtmlExportTables(req.file.buffer);
    if (htmlTables.length === 0) {
      return res.status(400).json({ message: '无法解析表格文件，请检查格式' });
    }

    htmlTables.forEach(table => {
      const rawRows = table.rawRows || [];
      const parsedRendered = parseRenderedExportSheet({
        worksheet: table.worksheet,
        rawRows,
        targetMonth,
        designerByName,
        skippedDesigners
      });

      importedRows += parsedRendered.importedRows;
      parsedRendered.sheetMap.forEach((sheet, designerId) => {
        if (!mergedSheetMap.has(designerId)) {
          mergedSheetMap.set(designerId, {
            designerId,
            month: targetMonth.month,
            year: targetMonth.year,
            days: {}
          });
        }

        const merged = mergedSheetMap.get(designerId);
        Object.entries(sheet.days || {}).forEach(([date, items]) => {
          if (!merged.days[date]) merged.days[date] = [];
          merged.days[date] = merged.days[date].concat(items);
        });
      });
    });
  }

  if (mergedSheetMap.size === 0) {
    return res.status(400).json({
      message: `文件中没有可导入的 ${targetMonth.key} 数据，请确认导入格式与系统导出的 xls 一致`,
      skippedDesigners: [...skippedDesigners],
      elapsedMs: Date.now() - startedAt
    });
  }

  mergedSheetMap.forEach((importedSheet, designerId) => {
    if (!sheetHasData(importedSheet)) return;

    // saveSheet 为整表覆盖语义：同 designerId+month+year 的旧表被整体替换
    taskStore.saveSheet({
      id: `sheet-${designerId}-${targetMonth.year}-${targetMonth.month}`,
      designerId,
      month: targetMonth.month,
      year: targetMonth.year,
      days: importedSheet.days
    });
  });

  const io = req.app.get('io');
  if (io) io.emit('task_refreshed');

  res.json({
    message: '导入成功',
    importedMonths: [targetMonth.key],
    importedRows,
    skippedDesigners: [...skippedDesigners],
    elapsedMs: Date.now() - startedAt
  });
}));

router.delete('/cleanup/login-logs', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  // 登录日志在独立表中，直接清空即可
  const beforeCount = db.countLoginLogs();
  db.clearLoginLogs();

  res.json({
    message: '登录日志已清空',
    cleanedCount: beforeCount
  });
}));

router.delete('/cleanup/audit-logs', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  // 操作日志存于 audit_logs 独立表，直接清空该表即可，无需整库读写
  const beforeCount = db.countAuditLogs();
  db.clearAuditLogs();

  res.json({
    message: '操作日志已清空',
    cleanedCount: beforeCount
  });
}));

router.delete('/cleanup/old-tasks', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const { keepMonths = 12 } = req.query;
  const monthsToKeep = Math.max(1, parseInt(keepMonths, 10) || 12);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const cutoffMonth = (currentMonth - monthsToKeep + 12) % 12;
  const cutoffYear = cutoffMonth > currentMonth ? currentYear - 1 : currentYear;

  const { removedSheets, removedTaskItems } = taskStore.deleteSheetsBefore(cutoffYear, cutoffMonth);
  const remainingSheets = taskStore.countSheets();

  // 历史接口同样需要回收磁盘，否则清理后占用不变会被当成没清干净
  let compaction = null;
  try {
    compaction = maintenance.compactDatabase();
  } catch (e) {
    console.error('[maintenance] 清理历史任务后压缩数据库失败:', e.message);
  }

  const data = db.readDb();
  const sizeAfter = ((Buffer.byteLength(JSON.stringify(data), 'utf8') + taskStore.entriesJsonSize()) / 1024).toFixed(2);

  res.json({
    message: `已清理 ${monthsToKeep} 个月之前的任务数据`,
    removedSheets,
    removedTaskItems,
    remainingSheets,
    freedBytes: compaction ? compaction.freedBytes : 0,
    dbSizeKbAfter: parseFloat(sizeAfter)
  });
}));

router.delete('/cleanup/status-tracking', [authMiddleware, superAdminMiddleware], asyncHandler(async (req, res) => {
  const { keepMonths = 24 } = req.query;
  const monthsToKeep = Math.max(1, parseInt(keepMonths, 10) || 24);
  
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  
  const cutoffMonth = (currentMonth - monthsToKeep + 12) % 12;
  const cutoffYear = cutoffMonth > currentMonth ? currentYear - 1 : currentYear;
  
  const data = db.readDb();
  const items = data.statusTrackingItems || [];
  
  const beforeCount = items.length;
  
  data.statusTrackingItems = items.filter(item => {
    const planMonth = item.productionPlanMonth || '';
    if (!planMonth) return true;
    
    const [year, month] = planMonth.split('-').map(Number);
    if (year < cutoffYear) return false;
    if (year === cutoffYear && month < cutoffMonth) return false;
    return true;
  });
  
  await db.writeDb(data);
  
  const removedCount = beforeCount - data.statusTrackingItems.length;
  
  res.json({
    message: `已清理 ${monthsToKeep} 个月之前的状态跟踪数据`,
    removedCount,
    remainingCount: data.statusTrackingItems.length
  });
}));

module.exports = router;
