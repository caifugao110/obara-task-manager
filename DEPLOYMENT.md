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

其他启动/停止脚本：

| 脚本 | 说明 |
|------|------|
| `start-hidden.vbs` | 后台静默启动（不显示命令行窗口），适合长期运行 |
| `start-process-hidden.vbs` | 进程隐藏启动辅助脚本 |
| `stop.bat` | 停止前后端进程 |

默认访问地址：

- 前端：http://localhost:5173
- 后端：http://localhost:5000

> 首次部署请在 `backend/db.json` 中自行配置超级管理员账号和密码，密码请使用 bcrypt 哈希值存储，切勿使用弱密码。

## 手动启动

```bat
git clone https://gitee.com/caifugao110/obara-task-manager.git
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
JWT_EXPIRES_IN=7d
CORS_ORIGIN=https://task.obara.com.cn,http://localhost:5173
GITEE_TOKEN=your-gitee-token
GITEE_REPO_OWNER=caifugao110
GITEE_REPO_NAME=obara-task-manager
DB_PATH=./db.json
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=20
```

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `PORT` | `5000` | 后端服务端口 |
| `NODE_ENV` | `development` | 开发/生产环境，生产环境错误响应不包含堆栈信息 |
| `JWT_SECRET` | `obara_task_secret_key_2026` | JWT 签名密钥，生产环境**必须**修改为随机字符串 |
| `JWT_EXPIRES_IN` | `7d` | JWT Token 过期时间 |
| `CORS_ORIGIN` | - | 允许的前端地址，多个用逗号分隔 |
| `GITEE_TOKEN` | - | Gitee API Token，用于版本检查 |
| `GITEE_REPO_OWNER` | - | Gitee 仓库用户名 |
| `GITEE_REPO_NAME` | - | Gitee 仓库名称 |
| `DB_PATH` | `./db.json` | JSON 数据库文件路径 |
| `RATE_LIMIT_WINDOW_MS` | `900000` | 登录限流窗口时间（毫秒） |
| `RATE_LIMIT_MAX` | `20` | 登录限流最大尝试次数 |

生产环境必须修改 `JWT_SECRET`，并定期备份数据库文件。

### CORS 配置

生产环境应限制 CORS 允许的源：

```env
CORS_ORIGIN=https://task.obara.com.cn,http://localhost:5173
```

开发环境可添加局域网 IP：

```env
CORS_ORIGIN=https://task.obara.com.cn,http://localhost:5173,http://192.168.160.25:5173
```

### Gitee 版本检查

配置 Gitee API 后，系统会通过 API 检查远程仓库版本：

1. 在 Gitee 生成个人访问令牌：https://gitee.com/profile/personal_access_tokens
2. 勾选 `projects` 权限
3. 配置环境变量：

```env
GITEE_TOKEN=your-gitee-personal-access-token
GITEE_REPO_OWNER=caifugao110
GITEE_REPO_NAME=obara-task-manager
```

版本检查接口 `GET /api/system/version` 通过 Gitee API 获取最新提交信息，相比传统的 `git fetch` 方式更高效，适合前端频繁轮询。

## 数据文件

默认数据文件为 `backend/db.json`。主要字段：

| 字段 | 说明 |
|------|------|
| `users` | 登录用户，角色包括 `superadmin`、`admin`、`user`，含 `forcePasswordChange` 字段 |
| `designers` | 设计人员列表 |
| `tasks` | 按设计人员(`designerId`)、年月保存的任务表 |
| `loginLogs` | 登录历史，包含 IP、浏览器信息和登录结果，最多保留 500 条 |
| `auditLogs` | 操作日志，记录所有已登录用户的 API 请求，最多保留 2000 条 |
| `statusTrackingItems` | 状态追踪记录 |
| `settings.leaderboard` | 任务报表访问权限 |
| `settings.workHours` | 工时管理访问权限 |
| `settings.statusTracking` | 状态追踪访问权限 |
| `settings.systemSettings` | 系统设置数据管理模块访问权限（`allowViewers` 始终为 `false`） |
| `settings.leaderRules` | 组长规则配置 |
| `settings.system` | 系统设置，如未登录查看、多设备登录 |

首次启动或旧版本升级时，`backend/db.js` 会自动补齐缺失的默认配置并执行数据库迁移（任务结构、日期格式、用户字段等）。

多人编辑占用状态保存在后端运行时内存中，用于防止同一设计人员同一天被多个用户同时编辑；服务重启后会自动清空，不写入 `backend/db.json`。

## 权限开关联动

任务报表、工时管理、状态追踪和系统设置各自有独立权限设置：

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
- `systemSettings` 配置的 `allowViewers` 始终为 `false`（系统设置不允许普通用户和游客访问），一般管理员仅可查看数据管理模块的导出功能，不能导入。

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

## 仕样信息搜索配置

系统支持从网络共享目录读取仕样书 PDF 文件：

- 默认共享路径：`\\192.168.160.6\仕样书$\`
- 需要服务器或运行后端的主机能够访问该共享目录
- 权限要求：需要有读取共享目录文件的权限
- 超时时间：纳期获取 9 秒，完整信息获取 15 秒

配置说明：

1. 确保服务器网络能够访问 `192.168.160.6`
2. 确保共享目录 `仕样书$` 有读取权限
3. PDF 文件命名格式：`仕样号.PDF` 或 `仕样号.01.PDF`、`仕样号.02.PDF` 等版本文件
4. 系统会自动查找最新版本的 PDF 文件

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

### 仕样信息搜索失败

1. 确认网络共享目录 `\\192.168.160.6\仕样书$\` 可访问
2. 确认服务器主机有读取共享目录的权限
3. 确认仕样号对应的 PDF 文件存在于共享目录中
4. 确认 PDF 文件命名格式正确（如 `12345.PDF`、`12345.01.PDF`）
5. 检查网络连接是否正常

### 状态追踪页面无数据

1. 确认已在系统设置中启用状态追踪页面
2. 确认当前用户角色有权限访问该页面
3. 确认已创建状态追踪记录

### 数据库文件损坏

如果 `backend/db.json` 文件损坏或格式错误：

1. 停止后端服务
2. 从备份恢复 `db.json`
3. 重新启动后端，系统会自动补齐缺失的默认配置

### 版本检查失败

如果版本检查显示"未知"或 `hasUpdate` 始终为 `false`：

1. 确认已配置 Gitee API Token：检查 `backend/.env` 中的 `GITEE_TOKEN`、`GITEE_REPO_OWNER`、`GITEE_REPO_NAME`
2. 确认 Token 有效且具有 `projects` 权限
3. 确认服务器网络可访问 `gitee.com`
4. 当前版本由 Git 提交信息生成，需要服务器安装 Git 并确保项目目录是 Git 仓库

### 内存占用过高

系统使用内存存储编辑状态（`editingSessions`），服务重启后会清空。如果内存占用过高：

1. 检查是否有大量长时间未关闭的编辑会话
2. 确认服务重启后内存是否恢复正常

## 版本检查

系统内置版本检查功能，通过 Gitee API 获取远程仓库最新提交信息。

### 版本号格式

版本号采用 `YY-MM-DD-VN` 格式：
- `YY`：年份后两位（如 26 表示 2026 年）
- `MM`：月份（01-12）
- `DD`：日期（01-31）
- `VN`：当日版本号（V1、V2、V3...，当日多次提交时自动递增）

当日首次提交为 `YY-MM-DD`，当日多次提交为 `YY-MM-DD-VN`。

### 版本比较规则

版本比较按照以下优先级依次比较：
1. 年份（YY）
2. 月份（MM）
3. 日期（DD）
4. 当日版本号（VN）

只有当远程版本严格大于本地版本时，才会提示更新。例如：
- `26-07-04-V2` > `26-07-04-V1` → 提示更新
- `26-07-04` > `26-07-03` → 提示更新
- `26-07-03` < `26-07-04-V2` → 不提示更新（旧版本）

版本检查接口：

```text
GET /api/system/version
```

响应示例（有更新）：

```json
{
  "currentVersion": "26-07-03",
  "hasUpdate": true,
  "latestVersion": "26-07-04"
}
```

响应示例（无更新或本地版本更新）：

```json
{
  "currentVersion": "26-07-04-V2",
  "hasUpdate": false,
  "latestVersion": null
}
```

响应示例（未配置或访问失败）：

```json
{
  "currentVersion": "未知",
  "hasUpdate": false,
  "latestVersion": null
}
```

说明：
- 需要配置 Gitee API Token 和仓库信息（见上方"Gitee 版本检查"章节）
- 通过 Gitee API 获取远程最新提交，无需在服务器安装 Git
- 如果未配置 Gitee 或无法访问 API，`hasUpdate` 返回 `false`，`latestVersion` 返回 `null`
- API 调用超时时间为 5 秒，超时后自动降级为无更新状态
- 当前版本由 Git 提交信息生成，需要服务器安装 Git 并确保项目目录是 Git 仓库

## 日志查看

一键启动会打开前端和后端命令行窗口。排障时查看对应窗口输出即可。

手动启动时直接查看当前 PowerShell 或 CMD 输出。

超级管理员也可以在页面中查看登录和操作日志：

- “系统设置”日志管理模块主页显示最新 10 条管理员登录信息。
- “操作日志”页面（`/system-logs`）显示所有用户的所有操作记录，支持按用户名、操作类型、HTTP 方法、IP、日期范围筛选，并支持导出 `.xls`。
- “登录日志”接口（`GET /api/system/login-logs`）仍可用于查看所有登录用户的登录明细，支持按账号/姓名、角色、结果、IP、浏览器、日期和显示条数筛选。

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

## 安全建议

1. **修改默认密码**：首次部署后立即修改 `superadmin` 密码
2. **更换 JWT_SECRET**：在 `backend/.env` 中设置强随机密钥
3. **限制文件权限**：确保 `backend/db.json` 仅允许必要用户读写
4. **关闭未登录查看**：公网部署时关闭 `allowGuestView`
5. **启用单设备登录**：如需限制账号共享，关闭 `allowMultiDevice`
6. **定期备份**：定期备份 `backend/db.json` 和导出 `.xls` 文件
7. **关注操作日志**：定期查看「操作日志」页面，关注异常 IP 或失败请求
8. **强制密码修改**：通过重置密码功能强制用户修改初始密码

## 性能优化建议

1. **数据库文件大小**：`loginLogs` 最多保留 500 条记录，`auditLogs` 最多保留 2000 条记录，自动清理旧日志
2. **并发写入保护**：数据库写入采用队列机制，避免并发冲突
3. **前端防抖**：任务字段变更采用 500ms 防抖保存，减少网络请求
4. **离线缓存**：后端断开时自动切换到 localStorage 缓存数据
5. **操作日志精简**：GET 请求不记录响应消息，POST/PUT 请求体最大保留 2000 字符，避免数据库膨胀

最后更新：2026-07-05
