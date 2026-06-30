# Windows 部署指南

本文档只保留 Windows 部署方式。项目不再提供非 Windows 的一键脚本或相关部署配置。

## 环境要求

| 软件 | 版本 | 说明 |
|------|------|------|
| Windows | Windows 10/11 或 Windows Server | 推荐启用 PowerShell 或 CMD |
| Node.js | 18+ | 安装时勾选加入 PATH |
| npm | 9+ | 随 Node.js 一起安装 |
| Git | 任意较新版本 | 用于拉取代码 |

## 一键启动

在项目根目录双击或在 CMD 中运行：

```bat
start.bat
```

脚本会完成以下工作：

1. 检查 Node.js 是否可用。
2. 检查默认端口 `5000` 和 `5173`。
3. 安装后端依赖。
4. 安装前端依赖。
5. 启动后端开发服务。
6. 启动前端开发服务。
7. 打开浏览器访问前端页面。

启动完成后访问：

- 前端：http://localhost:5173
- 后端：http://localhost:5000

默认管理员账号：

- 用户名：superadmin
- 密码：admin123

## 手动部署

```bat
git clone https://github.com/caifugao110/obara-task-manager.git
cd obara-task-manager
npm run install:all
npm run dev
```

如果只需要分别启动前后端：

```bat
npm run dev:backend
npm run dev:frontend
```

## 生产运行建议

### 构建前端

```bat
cd frontend
npm run build
```

构建产物位于 `frontend/dist/`。

### 启动后端

```bat
cd backend
npm start
```

### 预览前端构建产物

```bat
cd frontend
npm run preview
```

如需长期运行，建议在 Windows 上使用受控的进程管理方式，例如 Windows 服务管理工具、任务计划程序或 PM2。

## 配置说明

后端默认读取以下环境变量：

```env
PORT=5000
NODE_ENV=production
JWT_SECRET=your-super-secret-production-key-change-this
JWT_EXPIRES_IN=7d
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=20
DB_PATH=./db.json
```

生产环境务必修改 `JWT_SECRET`，并定期备份 `backend/db.json`。

## 数据文件结构

`backend/db.json` 主要包含：

| 字段 | 说明 |
|------|------|
| `users` | 管理员账号，含 `sessionToken`（单设备登录） |
| `designers` | 工作台设计人员列表 |
| `tasks` | 按设计员 + 年月存储的任务 sheet |
| `loginLogs` | 管理员登录历史（最多保留 500 条） |
| `settings.leaderboard` | 任务报表访问权限 |
| `settings.workHours` | 工时管理访问权限 |
| `settings.system` | 系统设置（未登录查看、多设备登录） |

首次启动或旧版升级时，`db.js` 会自动补全缺失的默认配置。

## 系统设置与备份

超级管理员登录后，在工作台点击 **系统设置**：

- **导出 xlsx**：按有数据的月份导出任务，适合定期备份与离线查看
- **导入 xlsx**：从导出格式或相同结构的文件恢复指定月份数据
- **登录管理**：控制未登录是否可访问工作台、是否允许多设备同时在线

仍建议同时保留 `db.json` 文件级备份：

```bat
copy backend\db.json backup-db-20260630.json
```

## 安全建议

1. 生产环境修改默认 superadmin 密码。
2. 设置强随机 `JWT_SECRET`。
3. 若部署在公网，建议关闭 `allowGuestView`，仅允许登录后访问。
4. 若需限制账号共享，关闭 `allowMultiDevice`。
5. 限制 `backend/db.json` 文件读写权限。

## 常见问题

### 端口被占用怎么办？

后端默认端口为 `5000`，前端默认端口为 `5173`。

```bat
netstat -ano | findstr "5000"
netstat -ano | findstr "5173"
taskkill /PID <PID> /F
```

也可以修改：

- 后端端口：`backend/.env` 中的 `PORT`
- 前端端口：`frontend/vite.config.ts` 中的 `server.port`

### 如何备份数据？

方式一：复制 `backend/db.json`。

```bat
copy backend\db.json backup-db-20260629.json
```

方式二：超级管理员在 **系统设置** 中导出 xlsx。

### 如何重置管理员密码？

停止后端服务后，编辑 `backend/db.json` 中管理员用户的 `password` 字段，替换为新的 bcrypt 哈希，然后重新启动后端服务。

### 前端请求后端失败怎么办？

1. 确认后端已启动。
2. 确认 `http://localhost:5000` 可访问。
3. 检查 `frontend/vite.config.ts` 中 `/api` 和 `/socket.io` 的代理配置。
4. 重新登录，确认浏览器 LocalStorage 中存在 token。
5. 若已关闭「未登录可查看主页面」，需先登录才能加载任务数据。

### 任务报表 / 工时管理提示无设计人员？

在 **用户管理**（`/admin`）中添加设计人员。工作台表格、报表与工时模块均依赖 `designers` 数据。

### 用户管理页看不到设计人员？

1. 确认使用 admin 或 superadmin 账号登录。
2. 管理页通过 `/api/designers/manage` 加载，需有效 Token。
3. 添加后刷新页面；若仍异常，检查浏览器控制台与后端日志。

## 日志查看

一键启动会分别打开前端和后端命令行窗口。查看对应窗口输出即可排查启动和运行问题。

手动启动时可直接查看当前 CMD 或 PowerShell 输出。

## 技术支持

如遇问题，请先查看本文档、[README](README.md) 和 [API 文档](docs/API.md)，再通过项目 Issues 反馈。

**最后更新**：2026-06-30
