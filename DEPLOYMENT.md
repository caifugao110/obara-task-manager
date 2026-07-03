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
| `settings.statusTracking` | 状态追踪访问权限 |
| `settings.leaderRules` | 组长规则配置 |
| `settings.system` | 系统设置，如未登录查看、多设备登录 |
| `statusTrackingItems` | 状态追踪记录 |

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

## 版本检查

系统内置版本检查功能，通过 Git 提交信息自动生成版本号：

- 当前版本格式：`YY-MM-DD` 或 `YY-MM-DD-VN`（当日多次提交时）
- 检查远程仓库是否有更新
- 显示最新版本号

版本检查接口：

```text
GET /api/system/version
```

响应示例：

```json
{
  "currentVersion": "26-07-03",
  "hasUpdate": true,
  "latestVersion": "26-07-04"
}
```

说明：
- 需要服务器安装 Git 并配置远程仓库
- 版本检查会自动执行 `git fetch origin` 获取远程更新
- 如果无法访问远程仓库，`hasUpdate` 返回 `false`，`latestVersion` 返回 `null`

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

## 安全加固建议

1. **修改默认密码**：首次部署后立即修改 `superadmin` 密码
2. **更换 JWT_SECRET**：在 `backend/.env` 中设置强随机密钥
3. **限制文件权限**：确保 `backend/db.json` 仅允许必要用户读写
4. **关闭未登录查看**：公网部署时关闭 `allowGuestView`
5. **启用单设备登录**：如需限制账号共享，关闭 `allowMultiDevice`
6. **定期备份**：定期备份 `backend/db.json` 和导出 `.xls` 文件

## 性能优化建议

1. **数据库文件大小**：`loginLogs` 最多保留 500 条记录，自动清理旧日志
2. **并发写入保护**：数据库写入采用队列机制，避免并发冲突
3. **前端防抖**：任务字段变更采用 500ms 防抖保存，减少网络请求
4. **离线缓存**：后端断开时自动切换到 localStorage 缓存数据

## 常见问题

### 数据库文件损坏

如果 `backend/db.json` 文件损坏或格式错误：

1. 停止后端服务
2. 从备份恢复 `db.json`
3. 重新启动后端，系统会自动补齐缺失的默认配置

### Git 版本检查失败

如果版本检查显示"未知"：

1. 确认服务器已安装 Git
2. 确认项目目录是 Git 仓库
3. 确认已配置远程仓库：`git remote -v`
4. 确认网络可访问远程仓库：`git fetch origin`

### 内存占用过高

系统使用内存存储编辑状态（`editingSessions`），服务重启后会清空。如果内存占用过高：

1. 检查是否有大量长时间未关闭的编辑会话
2. 确认服务重启后内存是否恢复正常

## GitHub Pages 部署

### 前置条件

- GitHub 仓库地址：`https://github.com/caifugao110/obara-task-manager`
- 已配置 GitHub Actions 工作流（`/.github/workflows/deploy.yml`）

### 启用 GitHub Pages

1. 登录 GitHub，进入仓库页面
2. 点击 Settings → Pages
3. 在 Source 部分选择 `GitHub Actions`
4. 点击 Save 保存设置

### 自动部署流程

每次推送到 `main` 分支时，GitHub Actions 会自动执行以下步骤：

1. **Checkout**：拉取最新代码
2. **Setup Node.js**：安装 Node.js 20 环境
3. **Install Dependencies**：安装前端依赖（使用 npm ci）
4. **Build**：构建前端项目（`npm run build`）
5. **Upload Artifact**：上传构建产物到 GitHub Pages Artifact
6. **Deploy**：部署到 GitHub Pages

### 访问地址

```text
https://caifugao110.github.io/obara-task-manager/
```

### 部署状态

- 可以在仓库的 Actions 标签页查看部署进度
- 部署成功后，GitHub Pages 设置页面会显示绿色的部署状态
- 如果部署失败，检查 Actions 日志中的错误信息

### 常见问题

#### 部署失败："Deployment failed, try again later"

这是 GitHub Pages 的临时性错误，通常是以下原因之一：

1. **GitHub Pages 服务暂时不可用**：等待几分钟后重新推送代码触发部署
2. **Artifact 上传失败**：检查前端构建是否成功，确保 `frontend/dist` 目录存在
3. **权限不足**：确保工作流配置中的 `permissions` 包含 `pages: write` 和 `id-token: write`
4. **Node.js 版本问题**：确认使用 Node.js 20 或更高版本

#### 页面加载后资源路径错误

确保 `frontend/vite.config.ts` 中配置了正确的 base 路径：

```typescript
base: '/obara-task-manager/'
```

如果仓库名变更，需要同步更新此配置。

#### GitHub Pages 不支持后端 API

GitHub Pages 仅支持静态文件托管，无法运行 Node.js 后端服务。前端部署到 GitHub Pages 后，需要：

1. 后端服务单独部署（如使用 Vercel、Render、Heroku 等）
2. 配置前端 API 代理指向后端服务地址

#### SPA 客户端路由

项目使用 React Router 实现单页应用（SPA）路由。GitHub Pages 默认不支持 SPA 路由，直接访问子页面会返回 404。解决方案：

1. **404.html 回退机制**：构建完成后自动复制 `index.html` 为 `404.html`，当访问不存在的路径时，GitHub Pages 会返回 `404.html`，然后 React Router 在客户端处理路由
2. **basename 配置**：React Router 和 Vite 都配置了 `basename="/obara-task-manager"`，确保资源路径和路由正确

#### 开发环境与生产环境

- **开发环境**：`base` 和 `basename` 为空，直接从根路径访问
- **生产环境**：`base` 和 `basename` 为 `/obara-task-manager`，适配 GitHub Pages 子目录部署

切换方式：

```bat
# 开发模式（自动使用空路径）
cd frontend
npm run dev

# 生产构建（自动使用 /obara-task-manager 路径）
cd frontend
npm run build
```

### 手动触发部署

如果需要手动触发部署：

1. 进入仓库 Actions 标签页
2. 选择 "Deploy to GitHub Pages" 工作流
3. 点击 "Run workflow"
4. 选择 `main` 分支，点击 "Run workflow"

最后更新：2026-07-04
