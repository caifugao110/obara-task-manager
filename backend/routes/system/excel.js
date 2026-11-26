'use strict';
/**
 * 任务表导入导出引擎的统一出口
 *
 * 实现按「公共工具 / HTML 导出 / Excel XML 导出 / 导入反解」拆在同目录四个文件里，
 * 这里只做 re-export：调用方（maintenance.js、logs.js）继续 require('./excel')，
 * 不必关心某个函数落在哪个文件。新增能力请加到对应文件，不要往这个文件里写实现。
 */
const excelShared = require('./excelShared');
const excelHtml = require('./excelHtml');
const excelXml = require('./excelXml');
const excelImport = require('./excelImport');

module.exports = {
  // excelShared
  ...excelShared,
  ...excelShared,
  ...excelShared,
  ...excelShared,
  ...excelShared,
  ...excelShared,
  ...excelShared,
  ...excelShared,
  ...excelShared,
  ...excelShared,
  ...excelShared,
  ...excelShared,
  // excelHtml
  ...excelHtml,
  ...excelHtml,
  ...excelHtml,
  ...excelHtml,
  ...excelHtml,
  // excelXml
  ...excelXml,
  ...excelXml,
  ...excelXml,
  ...excelXml,
  ...excelXml,
  ...excelXml,
  ...excelXml,
  // excelImport
  ...excelImport,
  ...excelImport,
  ...excelImport,
  ...excelImport,
  ...excelImport,
  ...excelImport,
  ...excelImport,
  ...excelImport,
  ...excelImport,
  ...excelImport,
  ...excelImport,
  ...excelImport,
  ...excelImport,
  ...excelImport,
  ...excelImport,
  ...excelImport,
};
