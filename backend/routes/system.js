'use strict';
/**
 * 系统域路由的总装（原 2313 行单文件，按「系统信息 / 数据维护 / 日志审计」拆成子路由）
 *
 * 拆分原则：
 *   - 每个子路由只管一类事情的 URL（`/version` 归 info，`/maintenance/*` 归 maintenance…），
 *     挂载在同一个 `/api/system` 前缀下，所以 **API 路径一个都没变**，前端无需改动；
 *   - 纯逻辑（设置 schema、导入导出引擎、版本计算、日志筛选）放进同目录的 lib 模块，
 *     路由文件只保留「取参 → 调 lib → 响应」；
 *   - 这里只做挂载，不再写任何路由：新增端点请加到对应子路由里，
 *     否则这个文件会重新长成巨石（tools/check-file-size.js 也会拦）。
 *
 * 各子路由的端点归属见 docs/API.md 的「系统」章节，文件级说明见同目录各文件头部注释。
 */
const express = require('express');

const info = require('./system/info');
const maintenance = require('./system/maintenance');
const logs = require('./system/logs');
const { normalizeSystemSettings } = require('./system/shared');

const router = express.Router();

// 子路由之间没有路径重叠（/settings、/maintenance/*、/audit-logs/* …），挂载顺序不影响匹配
router.use(info);
router.use(maintenance);
router.use(logs);

module.exports = router;
// 供 settings.js 的首屏聚合接口（/settings/bootstrap）复用同一份归一化逻辑，
// 避免「系统设置」在两处各写一套默认值推导
module.exports.normalizeSystemSettings = normalizeSystemSettings;
