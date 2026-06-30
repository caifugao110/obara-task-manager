# 变更日志

本文档记录 Obara 任务管理系统的重要变更。

格式基于 Keep a Changelog，版本遵循语义化版本。

## [未发布]

### 新增

- **系统设置**页面（`/system-settings`，仅超级管理员）
  - 导出任务数据为 xlsx（仅含有数据的月份）
  - 从 xlsx 导入任务数据（按工作表年月覆盖对应数据）
  - 登录管理：未登录查看主页面开关、多设备同时在线开关
  - 管理员登录历史查看
- **任务报表查看权限设置**（独立于工时管理）
- **工时管理查看权限设置**（独立 API：`/api/settings/work-hours`）
- 工作台顶部 **系统设置** 入口（超级管理员可见）
- 认证会话校验接口 `GET /api/auth/validate`
- 管理后台专用设计员列表接口 `GET /api/designers/manage`
- 登录历史记录（`loginLogs`）与单设备登录（`sessionToken` / `sessionId`）
- Socket 事件：`register_user`、`session_invalidated`

### 改进

- 任务报表、工时管理、用户管理在无设计人员时显示明确提示，不再无限加载
- 用户管理页分离管理员与设计员加载错误提示
- 关闭未登录查看时，任务与设计员读取接口需登录
- `AuthContext` 增加 `authReady`，避免 Token 未就绪时发起错误请求

### 修复

- 任务报表页面在无设计人员时 loading 无法结束的问题
- 用户管理页设计人员列表在 Token 未就绪或权限不足时误报「无法加载数据」的问题

### 变更

- 后端新增依赖：`xlsx`、`multer`
- `db.json` 结构扩展：`settings.system`、`settings.workHours`、`loginLogs`、用户 `sessionToken`

### 计划功能

- 任务模板功能
- 邮件通知
- 多语言支持
- 移动端适配

## [2.0.0] - 2026-04-12

### 新增

- TypeScript 类型定义文件
- API 服务层封装
- 自定义 Hooks：`useTasks`、`useSocket`
- 根目录统一管理的 `package.json`
- 完善的开源项目文档：`CONTRIBUTING.md`、`SECURITY.md`

### 改进

- 优化 `.gitignore` 配置
- 重构项目结构
- 简化部署流程
- 更新 README，添加章节和简化说明

### 修复

- 修复管理员账号默认禁用的问题
- 优化错误处理机制

### 变更

- 默认管理员用户名从 `admin` 改为 `superadmin`

## [1.0.0] - 2025-01-01

### 新增

- Excel 风格任务管理界面
- 多用户协作支持
- 实时同步：Socket.IO
- 权限控制系统
- 自动保存功能
- 工时统计
- 用户管理
- 报表分析

### 技术栈

- 前端：React 18、TypeScript、Vite、Tailwind CSS
- 后端：Node.js、Express、Socket.IO
- 存储：JSON 文件

## 版本说明

- `MAJOR`：不兼容的 API 变更
- `MINOR`：向后兼容的功能新增
- `PATCH`：向后兼容的问题修复

**项目链接**：https://github.com/caifugao110/obara-task-manager  
**许可证**：MIT
