# Windows 部署指南

本文档说明 Obara 任务管理系统在 Windows 环境下的启动、部署、备份和排障方式。

## 环境要求

| 软件 | 版本 | 说明 |
|------|------|------|
| Windows | Windows 10/11 或 Windows Server | 推荐使用 PowerShell 或 CMD |
| Node.js | 18+ | 安装时勾选加入 PATH |
| npm | 9+ | 随 Node.js 安装 |
| Git | 较新版本 | 用于拉取代码 |

## 一键启动

在项目根目录运行：

```bat
start.bat
```

脚本会检查端口、安装依赖、启动后端和前端，并打开浏览器。

默认访问地址：

- 前端：http://localhost:5173
- 后端：http://localhost:5000

默认超级管理员账号：

- 用户名：`superadmin`
- 密码：`admin123`

## 手动启动

```bat
git clone https://github.com/caifugao110/obara-task-manager.git
cd obara-task-manager
npm run install:all
npm run dev
```

分别启动前后端：

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

长期运行时，建议使用 Windows 服务、任务计划程序或 PM2 等进程管理工具。

## 环境变量

后端默认读取以下环境变量（复制 `backend/.env.example` 为 `backend/.env` 后按需修改）：

```env
PORT=5000
NODE_ENV=production
JWT_SECRET=your-secret-key-change-in-production-2026
```

- `PORT`：后端服务端口，默认 `5000`。
- `NODE_ENV`：设为 `production` 时，错误响应不包含堆栈信息。
- `JWT_SECRET`：JWT 签名密钥，生产环境**必须**修改为随机字符串。

生产环境必须修改 `JWT_SECRET`，并定期备份数据库文件。

## 数据文件

默认数据文件为 `backend/db.json`。主要字段：

| 字段 | 说明 |
|------|------|
| `users` | 登录用户，角色包括 `superadmin`、`admin`、`user` |
| `designers` | 设计人员列表 |
| `tasks` | 按设计人员(`designerId`)、年月保存的任务表 |
| `loginLogs` | 登录历史，包含 IP、浏览器信息和登录结果 |
| `settings.leaderboard` | 任务报表访问权限 |
| `settings.workHours` | 工时管理访问权限 |
| `settings.system` | 系统设置，如未登录查看、多设备登录 |

首次启动或旧版本升级时，`backend/db.js` 会自动补齐缺失的默认配置。

多人编辑占用状态保存在后端运行时内存中，用于防止同一设计人员同一天被多个用户同时编辑；服务重启后会自动清空，不写入 `backend/db.json`。

## 权限开关联动

任务报表和工时管理各自有独立权限设置：

```json
{
  "enabled": true,
  "allowAdmins": true,
  "allowViewers": false
}
```

规则：

- `enabled=false` 时，前端会自动关闭 `allowAdmins` 和 `allowViewers`。
- `enabled=true` 时，前端会自动打开 `allowAdmins` 和 `allowViewers`。
- `allowViewers=true` 时，`allowAdmins` 必须为 `true`。
- 后端保存时也会规范化 `allowViewers=true` 的情况，保证一般管理员权限不会低于游客/普通用户。

## 备份与恢复

推荐同时保留文件级备份和 `.xls` 任务表导出备份。

复制数据库文件：

```bat
copy backend\db.json backup-db-20260701.json
```

通过页面备份：

1. 使用超级管理员登录。
2. 进入“系统设置”。
3. 导出 `.xls` 任务表数据。

说明：

- `.xls` 导出只包含任务数据，适合任务表恢复；文件名包含日期和时间戳，例如 `obara-tasks-2026-07-02-093000.xls`。
- 导出的表格是渲染后的任务表，每月一个工作表，包含冻结窗口、边框、任务颜色、任务/枪名单独行和自动合计。
- 登录用户、设计人员、登录日志和权限设置仍建议通过 `backend/db.json` 文件级备份保存。

恢复方式：

- 小规模恢复可以直接替换 `backend/db.json`。
- 任务数据恢复可以通过“系统设置”导入 `.xls`。
- 导入前必须选择要覆盖的月份；系统只覆盖所选月份，不会一次覆盖所有月份。
- 导入时 `当日合计` 和 `月总工时` 会被忽略，系统会重新计算。
- 如果表格天数与所选月份天数不一致，多出的日期自动截断，缺少的日期按空数据处理。
- 表格中的新增设计员不会自动创建，会跳过并在导入结果中提示。

## 安全建议

1. 生产环境修改默认 `superadmin` 密码。
2. 设置强随机 `JWT_SECRET`。
3. 公网部署时建议关闭未登录查看主页面。
4. 如需限制账号共享，关闭多设备同时在线。
5. 限制 `backend/db.json` 的系统读写权限。
6. 定期备份 `backend/db.json`。

## 常见问题

### 端口被占用

后端默认端口为 `5000`，前端默认端口为 `5173`。

```bat
netstat -ano | findstr "5000"
netstat -ano | findstr "5173"
taskkill /PID <PID> /F
```

也可以修改：

- 后端端口：`backend/.env` 中的 `PORT`
- 前端端口：`frontend/vite.config.ts` 中的 `server.port`


### 后端断开后页面无离线提示

1. 检查浏览器是否处于真正的离线状态：`navigator.onLine` 仅检测浏览器网络连接，后端端口断开（服务器宕机）时不触发
2. 系统使用 Axios 错误码 `ERR_NETWORK` 和 Socket.IO 的 `connect_error` 事件检测后端不可达
3. 断线时页脚显示红色圆点 + "离线"，页面顶部显示橙色横幅提示
4. 如果此前已加载过数据，会自动显示缓存内容，不会归零
5. 后端恢复后自动重新连接，横幅和页脚状态恢复正常
### 前端请求后端失败

1. 确认后端已启动。
2. 确认 `http://localhost:5000` 可访问。
3. 检查 `frontend/vite.config.ts` 中 `/api` 和 `/socket.io` 的代理配置。
4. 重新登录，确认浏览器 LocalStorage 中存在 Token。
5. 如果关闭了未登录查看主页面，需要先登录才能加载任务和设计人员。

### 任务报表或工时管理提示无设计人员

确认管理后台“设计人员列表”中存在设计人员。管理员和超级管理员读取设计人员时需要有效 Token。

### 权限设置保存后结果和请求体不同

这是正常行为。后端会规范化权限设置：当 `allowViewers=true` 时，`allowAdmins` 会自动变为 `true`。

## 日志查看

一键启动会打开前端和后端命令行窗口。排障时查看对应窗口输出即可。

手动启动时直接查看当前 PowerShell 或 CMD 输出。

超级管理员也可以在页面中查看登录日志：

- “系统设置”显示最新 20 条登录信息。
- “登录日志”页面支持按账号/姓名、角色、结果、IP、浏览器、日期和显示条数筛选。

## 验证命令

前端类型检查：

```bat
cd frontend
..\node_modules\.bin\tsc.cmd --noEmit
```

后端语法检查示例：

```bat
node --check backend\routes\settings.js
```

最后更新：2026-07-02
