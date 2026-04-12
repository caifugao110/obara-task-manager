# 变更日志

本文件记录 Obara 任务管理系统的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 计划功能
- 任务模板功能
- 导出 Excel 报表
- 邮件通知
- 多语言支持
- 移动端适配

---

## [2.0.0] - 2026-04-12

### 新增 ✨
- Docker 支持，一键部署
- 跨平台启动脚本（start.sh）
- TypeScript 类型定义文件
- API 服务层封装
- 自定义 Hooks（useTasks, useSocket）
- 根目录统一管理的 package.json
- 完善的开源项目文档（CONTRIBUTING.md, SECURITY.md）

### 改进 🔧
- 优化 .gitignore 配置
- 重构项目结构
- 简化部署流程
- 更新 README.md，添加徽章和简化说明

### 修复 🐛
- 修复管理员账号默认禁用的问题
- 优化错误处理机制

### 变更 ⚠️
- 默认管理员用户名从 `admin` 改为 `superadmin`

---

## [1.0.0] - 2025-01-01

### 新增 ✨
- Excel 风格任务管理界面
- 多用户协作支持
- 实时同步（Socket.IO）
- 权限控制系统
- 自动保存功能
- 工时统计
- 用户管理
- 报表分析

### 技术栈
- 前端：React 18, TypeScript, Vite, TailwindCSS
- 后端：Node.js, Express, Socket.IO
- 存储：JSON 文件

---

## 版本说明

### 语义化版本规则

- **MAJOR.MINOR.PATCH** (主版本号。次版本号。修订号)
- **MAJOR**: 不兼容的 API 变更
- **MINOR**: 向后兼容的功能新增
- **PATCH**: 向后兼容的问题修复

### 版本标识

- `[未发布]`: 待发布的功能
- `[X.Y.Z]`: 已发布版本
- `YYYY-MM-DD`: 发布日期

---

## 贡献者

感谢所有为这个项目做出贡献的人！

---

**项目链接**: https://github.com/caifugao110/obara-task-manager  
**许可证**: MIT
