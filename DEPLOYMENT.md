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

复制 `backend/db.json` 到安全位置即可。建议按日期命名备份文件，例如：

```bat
copy backend\db.json backup-db-20260629.json
```

### 如何重置管理员密码？

停止后端服务后，编辑 `backend/db.json` 中管理员用户的 `password` 字段，替换为新的 bcrypt 哈希，然后重新启动后端服务。

### 前端请求后端失败怎么办？

1. 确认后端已启动。
2. 确认 `http://localhost:5000` 可访问。
3. 检查 `frontend/vite.config.ts` 中 `/api` 和 `/socket.io` 的代理配置。
4. 重新登录，确认浏览器 LocalStorage 中存在 token。

## 日志查看

一键启动会分别打开前端和后端命令行窗口。查看对应窗口输出即可排查启动和运行问题。

手动启动时可直接查看当前 CMD 或 PowerShell 输出。

## 技术支持

如遇问题，请先查看本文档和 README，再通过项目 Issues 反馈。

**最后更新**：2026-06-29
