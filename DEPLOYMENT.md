# Windows 部署指南

本文档说明 Obara 任务管理系统在 Windows 环境下的启动、部署、备份和排障方式。

## 环境要求

| 软件 | 版本 | 说明 |
|------|------|------|
| Windows | Windows 10/11 或 Windows Server | 推荐使用 PowerShell 或 CMD |
| Node.js | 22+（推荐 22 LTS） | 安装时勾选加入 PATH；`start.bat` 会强制校验主版本号，低于 22 直接报错退出（better-sqlite3 13、joi 18、pdf-parse 2.4 均要求 Node.js 22+） |
| npm | 10+ | 随 Node.js 安装 |
| Git | 较新版本 | 用于拉取代码；`start.bat` 启动时会自动执行 `git pull --rebase` |

## 一键启动

在项目根目录运行：

```bat
start.bat
```

脚本以隐藏窗口方式运行（**不会打开浏览器**，需手动访问下方地址），依次执行以下步骤：

1. 检查 Node.js 版本，主版本低于 22 直接报错退出。
2. 自动执行 `git pull --rebase` 拉取最新代码；存在本地修改时会先自动 stash，拉取完成后再恢复（恢复失败时保留在 git stash 中需手工处理）。
3. 检查 5000/5173 端口，被占用时自动结束占用进程并释放端口。
4. 检查根目录 `node_modules/.bin`，依赖缺失时自动执行 `npm install`（仓库使用 npm workspaces，一条命令安装前后端全部依赖）。
5. 后台隐藏启动后端和前端，日志分别写入 `logs/backend.log`、`logs/frontend.log`（错误日志为 `*.err.log`，PID 记录在 `*.pid`）。

其他启动/停止脚本：

| 脚本 | 说明 |
|------|------|
| `start-hidden.vbs` | 后台静默启动（不显示命令行窗口），适合长期运行 |
| `start-process-hidden.vbs` | 进程隐藏启动辅助脚本 |
| `stop.bat` | 先调用断网备份接口备份数据库，再按端口停止前后端进程 |

默认访问地址：

- 前端：http://localhost:5173
- 后端：http://localhost:5000

> 首次部署可通过环境变量 `DEFAULT_ADMIN_USERNAME` 和 `DEFAULT_ADMIN_PASSWORD` 配置默认管理员账号，启动时自动创建超级管理员（仅当不存在超级管理员时生效）。**未设置 `DEFAULT_ADMIN_PASSWORD` 时，首次启动会自动生成随机密码并仅在后端控制台输出一次**（`start.bat` 隐藏窗口启动时该输出写入 `logs/backend.log`，可在其中搜索 `[INIT] 初始超级管理员随机密码`；该账号同时被标记为需强制修改密码），请立即记录并登录修改；显式配置密码时生产环境必须使用强密码并在首次登录后立即修改。也可直接操作 `backend/data.db`（使用 SQLite 工具）手动配置，密码请使用 bcrypt 哈希值存储，切勿使用弱密码。

## 部署方式选择

| 场景 | 推荐方式 | 说明 |
|------|----------|------|
| 本机试用或局域网临时使用 | `start.bat` | 自动拉取代码、检查 Node 版本与端口、按需安装依赖、隐藏窗口启动前后端（不打开浏览器） |
| 开发调试 | `npm run dev` | 前后端同时运行，前端通过 Vite 代理访问后端 |
| 长期运行 | 后端 `npm start` + 前端静态部署或 `npm run preview` | 建议配合任务计划程序、Windows 服务或 PM2 等进程管理工具 |
| 仅后端 API 服务 | `npm run start:backend` | 适合前端已由 IIS/Nginx/静态文件服务托管的场景 |

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

### 依赖安装说明（离线环境 / 原生模块 / 安全）

- 仓库使用 npm workspaces，根目录执行 `npm install`（或 `npm run install:all`）即可安装前后端全部依赖。
- 根目录 `.npmrc` 固定了 `ignore-scripts=true`：`better-sqlite3@13` 官方提供 Windows 预编译二进制（prebuild-install），安装时无需执行 node-gyp，因此**不需要安装 Visual Studio C++ 生成工具或 Python**；如自行从 git 安装该模块的特殊版本，才需要补装编译工具链并临时放开该限制。
- Excel 解析依赖 `xlsx` 以本地 vendor 包形式随仓库分发（`backend/vendor/xlsx-0.20.3.tgz`，`package.json` 中为 `"xlsx": "file:vendor/xlsx-0.20.3.tgz"`），安装时无需访问 npm registry 拉取该包；0.20.3 修复了旧版 0.18.5 的原型污染（CVE-2023-30533）与正则拒绝服务（CVE-2024-22363）漏洞。升级时请继续使用 vendor 方式，不要回退到 npm 上的 0.18.5。
- 完全离线部署时，除上述 vendor 包外其余依赖仍需通过 npm 缓存、私有镜像或随包分发的 `node_modules` 解决。

## 生产运行建议

### 构建前端

```bat
cd frontend
npm run build
```

构建产物位于 `frontend/dist/`。

> 注意：生产构建的 `base` 路径为 /obara-task-manager/（配置在 `frontend/vite.config.ts`）。如果前端静态文件部署在网站根目录而非子路径下，请将 `base` 改为 `/` 或按实际路径调整。

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

### PM2 进程管理

安装 PM2：

```bat
npm install -g pm2
```

创建 PM2 配置文件 `ecosystem.config.js`：

```javascript
module.exports = {
  apps: [
    {
      name: 'obara-backend',
      script: './backend/server.js',
      cwd: './backend',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 5000
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/backend-error.log',
      out_file: './logs/backend-out.log',
      pid_file: './logs/backend.pid'
    }
  ]
};
```

启动命令：

```bat
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

PM2 常用命令：

| 命令 | 说明 |
|------|------|
| `pm2 start ecosystem.config.js` | 启动应用 |
| `pm2 stop obara-backend` | 停止应用 |
| `pm2 restart obara-backend` | 重启应用 |
| `pm2 logs` | 查看日志 |
| `pm2 status` | 查看状态 |
| `pm2 save` | 保存当前进程列表 |
| `pm2 startup` | 设置开机自启动 |
| `pm2 unstartup` | 取消开机自启动 |

### Windows 服务配置

使用 NSSM（Non-Sucking Service Manager）将后端注册为 Windows 服务：

1. 下载 NSSM：https://nssm.cc/download
2. 将 `nssm.exe` 放入系统 PATH 目录

注册服务：

```bat
nssm install ObaraTaskManager
```

配置参数：
- **Application path**: `C:\Program Files\nodejs\node.exe`
- **Startup directory**: `D:\mygit\obara-task-manager\backend`
- **Arguments**: `server.js`
- **Service name**: `ObaraTaskManager`

服务命令：

```bat
nssm start ObaraTaskManager
nssm stop ObaraTaskManager
nssm restart ObaraTaskManager
nssm remove ObaraTaskManager
```

> 注意：运行服务的 Windows 用户需要有对 `backend/` 目录的读写权限（用于创建和写入 `data.db` 及其 WAL 伴随文件），以及访问网络共享目录的权限。

### 上线前检查清单

1. `backend/.env` 已存在，`JWT_SECRET` 必须配置（缺失将导致服务无法启动）。
2. `CORS_ORIGIN` 只包含实际允许访问的前端地址。
3. `backend/data.db` 已存在并已配置超级管理员，或已通过环境变量配置默认管理员账号（首次启动自动创建；未设置 `DEFAULT_ADMIN_PASSWORD` 时随机密码仅在启动控制台显示一次，务必当场记录）。
4. `backend/data.db` 已完成一次备份（通过 `POST /api/system/maintenance/backup`）。
5. `npm run build` 能成功完成前端构建。
6. 后端启动后匿名访问 `http://localhost:5000/api/system/version` 返回 `401` JSON（该接口已要求登录，避免匿名探测版本号）；带登录 Token 请求时返回 `200` 版本信息。
7. 前端能打开并完成登录、主页面加载、任务保存、导出文件下载等关键流程。
8. 如果使用仕样 PDF 搜索，运行后端的 Windows 用户能访问 `\\192.168.160.6\仕样书$\`。

### 健康检查

后端没有单独的 `/health` 接口，也不托管前端静态文件（未挂载 `express.static`，仅提供 `/api/*` 接口和 Socket.IO 服务），生产环境前端需由 IIS/Nginx 等独立托管。可使用以下轻量接口确认服务状态：

```text
GET http://localhost:5000/api/system/settings   # 需要登录，匿名返回 401 JSON
GET http://localhost:5000/api/system/version    # 需要登录，匿名返回 401 JSON
```

判断标准：

- 只要能返回任意 HTTP 响应体为 JSON（包括 `401`），即说明 Express 服务可用；连接被拒绝（无响应）才是服务未启动。带有效登录 Token 请求 `/api/system/version` 应返回 `200`。
- 也可以只检测 5000 端口是否处于监听状态，或访问 Socket.IO 轮询握手地址 `http://localhost:5000/socket.io/?EIO=4&transport=polling`（应返回 `0{...}` 开头的 Engine.IO 报文）。
- 前端页脚显示“就绪”，说明前端能连接后端和 Socket.IO。
- Socket 断开时前端会显示离线横幅，后端恢复后会自动重新连接并刷新数据。

### 升级流程

1. 通知正在使用系统的用户暂停编辑。
2. 停止前后端进程，可以运行 `stop.bat`。
3. 备份 `backend/data.db` 和 `backend/.env`（建议通过 `POST /api/system/maintenance/backup` 生成一致性备份）。
4. 拉取或替换新版本代码（使用 `start.bat` 启动时会自动执行 `git pull --rebase`，可跳过本步）。
5. 执行 `npm run install:all` 更新依赖（含 `better-sqlite3` 原生模块）。
6. 执行 `npm run build` 验证前端构建。
7. 启动后端和前端，确认数据库迁移日志无异常（若存在遗留 `db.json`，首次启动会自动迁移到 SQLite）。
8. 登录后验证主页面、管理后台、系统设置、导入导出和关键报表。

### 回滚流程

1. 停止当前版本进程。
2. 恢复上一版本代码。
3. 恢复升级前备份的 `backend/data.db`（同时删除 `data.db-wal` 和 `data.db-shm`），必要时恢复 `backend/.env`。
4. 执行 `npm run install:all`，避免依赖版本不匹配。
5. 重新启动服务并完成关键流程验证。

> 如果新版本已经产生了不可逆的数据结构变更，优先使用升级前的 `backend/data.db` 备份回滚。不要直接手工编辑生产数据库文件，除非已经额外备份。

## 环境变量

后端默认读取以下环境变量（复制 `backend/.env.example` 为 `backend/.env` 后按需修改）：

```env
PORT=5000
NODE_ENV=production
JWT_SECRET=your-secret-key-change-in-production-2026
JWT_EXPIRES_IN=3d
JWT_ISSUER=obara-task-manager
JWT_AUDIENCE=obara-task-manager-api
DEFAULT_ADMIN_USERNAME=superadmin
# 留空时首次启动自动生成随机密码，仅在后端控制台显示一次（隐藏窗口启动时见 logs/backend.log）
DEFAULT_ADMIN_PASSWORD=
CORS_ORIGIN=https://task.obara.com.cn,http://localhost:5173,http://127.0.0.1:5173,http://192.168.160.25:5173,http://192.168.160.10:5173
GITEE_TOKEN=your-gitee-token
GITEE_REPO_OWNER=caifugao110
GITEE_REPO_NAME=obara-task-manager
SQLITE_DB_PATH=./data.db
DB_PATH=./db.json
SPEC_SHARE_PATH=\\192.168.160.6\仕样书$
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=20
# 全局 API 限流：每 IP 15 分钟最大请求数（默认 3000，OPTIONS 预检与本机环回不计）
# API_RATE_LIMIT_MAX=3000
# LOG_LEVEL 为预留变量，当前版本代码未读取，设置后不生效
```

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `PORT` | `5000` | 后端服务端口 |
| `NODE_ENV` | `development` | 开发/生产环境，生产环境错误响应不包含堆栈信息 |
| `JWT_SECRET` | **必填** | JWT 签名密钥，缺失将导致服务无法启动，生产环境**必须**修改为随机字符串 |
| `JWT_EXPIRES_IN` | `3d` | JWT Token 过期时间（默认 3 天；登出/改密/禁用会通过服务端会话吊销立即失效，与有效期长短解耦） |
| `JWT_ISSUER` | `obara-task-manager` | JWT 签发方 |
| `JWT_AUDIENCE` | `obara-task-manager-api` | JWT 接收方 |
| `CORS_ORIGIN` | `*`（未配置时） | 允许的前端地址，多个用逗号分隔；未配置时后端允许任意来源且不启用 CORS credentials |
| `GITEE_TOKEN` | - | Gitee API Token，用于版本检查 |
| `GITEE_REPO_OWNER` | - | Gitee 仓库用户名 |
| `GITEE_REPO_NAME` | - | Gitee 仓库名称 |
| `SQLITE_DB_PATH` | `./data.db` | SQLite 数据库文件路径 |
| `DB_PATH` | `./db.json` | 遗留 JSON 数据库路径，仅首次启动时用于自动迁移到 SQLite，迁移完成后可删除 |
| `SPEC_SHARE_PATH` | `\\192.168.160.6\仕样书$` | 仕样书 PDF 共享目录路径 |
| `RATE_LIMIT_WINDOW_MS` | `900000` | 限流窗口配置（毫秒）；登录/改密独立限流器使用硬编码阈值（登录 15 分钟 20 次、改密 15 分钟 5 次），未读取此变量 |
| `RATE_LIMIT_MAX` | `20` | 限流最大次数配置，同上，当前未被独立限流器使用 |
| `API_RATE_LIMIT_MAX` | `3000` | 全局 API 限流：每个 IP 15 分钟最大请求数，覆盖全部 `/api` 接口；`OPTIONS` 预检与本机环回（如 `stop.bat` 调备份接口）不计数，超限返回 `429` |
| `DEFAULT_ADMIN_USERNAME` | `superadmin` | 默认管理员用户名（首次启动时创建，仅当不存在超级管理员时生效） |
| `DEFAULT_ADMIN_PASSWORD` | 空 | 默认管理员密码；留空时首次启动自动生成随机密码并仅在后端控制台显示一次（隐藏窗口启动时见 `logs/backend.log`），显式设置时首次启动后应立即修改 |
| `LOG_LEVEL` | `info` | 预留变量：当前版本代码未读取，设置后不生效 |
| `WEKNORA_ENABLED` | `false` | 是否启用设计规范知识库接入，部署 WeKnora 后设为 `true` |
| `WEKNORA_BASE_URL` | `http://127.0.0.1:8080/api/v1` | WeKnora API 根地址 |
| `WEKNORA_API_KEY` | - | 主工作空间 API Key（也用于建库等写操作），仅服务端保存 |
| `WEKNORA_EXTRA_API_KEYS` | - | 其他工作空间 API Key，多个用英文逗号分隔 |
| `WEKNORA_TIMEOUT_MS` | `60000` | WeKnora 普通请求超时（毫秒） |
| `WEKNORA_KNOWLEDGE_BASE_IDS` | 空 | 预留兜底知识库 ID（逗号分隔）；当前页面始终显式传入选中的知识库 ID，该变量实际不参与检索/问答 |

## 设计规范知识库（WeKnora）

「设计规范知识库」页面（`/design-standards`）基于本地 Docker 部署的 [Tencent/WeKnora](https://github.com/Tencent/WeKnora)，提供规范检索与带引用的智能问答（模型走 DeepSeek + 智谱云端 API）。

**部署所需的一切都在仓库 `weknora/` 目录内**（精简 compose、初始化脚本、完整文档），无需单独克隆 WeKnora 源码。部署前先把模型 Key 写入 `weknora/.env`（`DEEPSEEK_API_KEY` / `BIGMODEL_API_KEY`，该文件已 gitignore），然后一键部署：

```bat
cd weknora
start.bat
```

详细步骤、迁移方法、踩坑记录见 **[weknora/README.md](weknora/README.md)**。注意：`backend/.env` 中 `WEKNORA_*` 变更后需重启后端才生效（生产环境后端以 `node server.js` 子进程运行，没有 nodemon 热重载）。

### 知识库按 ID 关联

后端不再自动建库或上传文档。知识库在 WeKnora 控制台创建后，需要在本系统显式关联：

1. 在 WeKnora 知识库管理页面（默认 `http://<服务器>:8080/platform/knowledge-bases`）打开知识库，从 URL 或列表中复制知识库 ID。
2. 登录本系统进入「设计规范知识库」页面 → 知识库管理标签页（需要一般管理员及以上），粘贴 ID 完成关联。
3. 关联仅保存 ID 映射，不会复制或移动 WeKnora 数据；取消关联也不会删除 WeKnora 中的知识库。

### 多工作空间（多租户）

WeKnora 的 API Key 按工作空间隔离，单个 Key 只能访问其所属工作空间的知识库。若规范文档分布在多个工作空间：

1. 分别登录各工作空间，在 API Key 管理中创建 Key。
2. 将主工作空间的 Key 填入 `WEKNORA_API_KEY`，其余 Key 用英文逗号分隔填入 `WEKNORA_EXTRA_API_KEYS`：

```env
WEKNORA_API_KEY=key-of-primary-workspace
WEKNORA_EXTRA_API_KEYS=key-of-workspace-b,key-of-workspace-c
```

3. 重启后端。服务启动时为每个 Key 建立独立客户端并通过 `/auth/me` 校验身份，状态接口的 `tenants` 字段可查看各工作空间可达性。
4. 检索支持跨工作空间（可同时勾选多个空间的知识库，结果合并排序）；**问答必须在同一工作空间内**，跨空间勾选时前端禁用发送，后端也会返回 400（`WEKNORA_MULTI_TENANT`）。

### 答复约束提示词

超管可在「设计规范知识库」页面底部的「答复约束提示词」面板中为每个已关联知识库配置提示词（支持整篇 Markdown，最长 20000 字符）。后端据此在知识库所属工作空间创建/更新受管自定义智能体（WeKnora 的知识库问答接口本身不接受自定义提示词）；清空提示词则自动删除对应智能体。前提：该工作空间已配置可用的 KnowledgeQA 问答模型，否则保存时返回 503（`WEKNORA_NO_QA_MODEL`）。一次问答勾选多个库且均有提示词时，以第一个库的约束为准。

仓库内置一份焊枪选型提示词模板 `weknora/knowledge/焊枪选型规范答复约束提示词.md`，可直接复制粘贴到对应知识库的提示词输入框使用。

生产环境必须配置 `JWT_SECRET`（缺失会导致服务直接退出），并定期备份数据库文件。系统已增强 JWT 失效机制，登出或修改密码后旧令牌将立即失效。

### CORS 配置

生产环境应限制 CORS 允许的源：

```env
CORS_ORIGIN=https://task.obara.com.cn,http://localhost:5173
```

开发环境可添加局域网 IP：

```env
CORS_ORIGIN=https://task.obara.com.cn,http://localhost:5173,http://192.168.160.25:5173
```

### 接口限流

后端启用三层限流，避免暴力破解与接口滥用：

| 限流层 | 阈值 | 计数维度 | 说明 |
|--------|------|----------|------|
| 全局 API 限流 | 每 15 分钟 3000 次 | 客户端 IP（`req.ip`） | 覆盖所有 `/api` 接口；`OPTIONS` 预检与本机环回请求不计数（保证 `stop.bat` 本机备份调用等不受影响）；可用 `API_RATE_LIMIT_MAX` 调整 |
| 登录限流 | 每 15 分钟 20 次 | IP + 用户名 | 内网多人共用同一代理出口时不会互相牵连；阈值在代码中硬编码 |
| 修改密码限流 | 每 15 分钟 5 次 | 用户 ID | 阈值在代码中硬编码 |

超限返回 HTTP `429`，响应消息为「请求过于频繁，请稍后再试」。限流窗口为内存计数（express-rate-limit），重启后端后计数清零。

### IP 黑名单

超级管理员可在系统设置「登录管理」中维护 IP 黑名单，主动拦截异常来源：

- 规则格式支持精确 IP（`192.168.1.100`、IPv6 同样支持）、CIDR 网段（`10.0.0.0/24`）和 IPv4 通配符（`192.168.*.*`），一次可粘贴多条（逗号/分号/空白分隔，单次最多 50 条，总量上限 500 条），可附备注。
- 启用后，命中规则的来源 IP 访问任意 `/api` 接口一律返回 `403`（`code=IP_BANNED`）；其登录尝试会以失败原因「IP 已被列入黑名单」写入登录日志，便于在登录管理界面确认拦截效果。
- 本机回环地址（`127.0.0.1` / `::1`）永不拦截，防止误封自身出口 IP 后无法进入系统自救；`OPTIONS` 预检请求不拦截。
- IPv4-mapped IPv6（`::ffff:a.b.c.d`）会归一为 IPv4 后匹配，避免同一地址换一种写法绕过。
- 规则缓存在内存中（15 秒 TTL 兜底），界面上增删规则或启停开关后立即生效。
- 界面会列出最近登录失败的 IP（排除已封禁的）作为快捷填入候选。

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

版本检查接口 `GET /api/system/version` 通过 Gitee API 获取最新提交信息，相比传统的 `git fetch` 方式更高效，适合前端登录后轮询。该接口**需要登录**（携带有效 Token），匿名访问返回 `401`，避免未授权者探测系统版本。

## 数据文件

系统使用 **SQLite** 作为数据库，默认文件为 `backend/data.db`。运行时还会生成 `backend/data.db-wal`（WAL 日志）和 `backend/data.db-shm`（共享内存索引），**服务运行期间请勿删除这两个伴随文件**。

数据库采用 WAL 模式，支持并发读取，写入通过事务持久化，进程崩溃不会损坏数据。

### 数据集合

数据库以键值集合方式存储，主要集合：

| 集合 | 说明 |
|------|------|
| `users` | 登录用户，角色包括 `superadmin`、`admin`、`user`，含 `forcePasswordChange` 字段 |
| `designers` | 设计人员列表 |
| `statusTrackingItems` | 状态追踪记录 |
| `gunLedger` | 焊枪编号台账，包含 `categories`（分类→表→行三级结构）和 `defaultResponsiblePersons`（默认担当人员） |
| `settings.leaderboard` | 任务报表访问权限 |
| `settings.workHours` | 工时管理访问权限 |
| `settings.statusTracking` | 状态追踪访问权限 |
| `settings.gunLedger` | 焊枪台账访问权限（`allowViewers` 始终为 `false`） |
| `settings.designStandards` | 设计规范知识库页面访问权限 |
| `settings.systemSettings` | 系统设置数据管理模块访问权限（`allowViewers` 始终为 `false`） |
| `settings.workdayOverrides` | 工作日覆盖规则，键为 `YYYY-MM-DD`，值为 `workday` 或 `weekend`，用于覆盖自然周六/周日判断 |
| `settings.leaderRules` | 组长规则配置 |
| `settings.system` | 系统设置，如多设备登录、允许登录用户修改本人设计计划标记颜色、仕样号位数（`specNumberDigits`，5 或 6）；颜色标记开关缺失时默认开启，仕样号位数缺失时默认 5 |
| `settings.ipBlacklist` | IP 黑名单（仅超级管理员可改）：`{ enabled, entries: [{ id, ip, note, createdAt, createdBy }] }` |

除上述键值集合外，三类高写入量数据存放在独立的关系表中（首次升级自动从 `kv_store` 搬迁，幂等）：

| 表 | 说明 |
|----|------|
| `task_sheets` / `task_entries` | 任务工时表：每张工时表一行（`designer_id + year + month` 唯一索引），任务条目按行存放；写入只重写受影响的单张表，对外接口数据形状不变 |
| `login_logs` | 登录日志独立表（含 IP、浏览器信息、登录结果），最多保留 2000 条 |
| `audit_logs` | 操作日志独立表，最多保留 2000 条 |

### 从 JSON 自动迁移

如果 `backend/db.json` 存在且 SQLite 数据库为空，后端启动时会**自动**将 JSON 数据迁移到 SQLite，并将原 `db.json` 重命名为 `db.json.migrated-<时间戳>.bak`。迁移完成后可删除该备份文件。

首次启动或旧版本升级时，`backend/db.js` 会自动补齐缺失的默认配置并执行数据结构迁移（任务结构、日期格式、用户字段等）。

多人编辑占用状态保存在后端运行时内存中，用于防止同一设计人员同一天被多个用户同时编辑；服务重启后会自动清空，不写入数据库。

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
- 后端保存时也会规范化 `allowViewers=true` 的情况，保证一般管理员权限不会低于普通用户。
- 任务报表、工时管理、状态追踪页面均要求登录；`leaderboard.allowViewers`、`workHours.allowViewers`、`statusTracking.allowViewers` 只表示允许普通用户访问。
- 焊枪台账（`gunLedger`）要求登录，`allowViewers` 后端强制为 `false`（普通用户不能进入 `/gun-ledger`）；一般管理员可编辑但不能删除分类/表。
- 设计规范知识库（`designStandards`）规则同工时管理。
- `systemSettings` 配置的 `allowViewers` 始终为 `false`（系统设置不允许普通用户访问），一般管理员仅可查看数据管理模块的导出功能，不能导入。

## 备份与恢复

推荐同时保留数据库备份和 `.xls` 任务表导出备份。

### 数据库备份

系统内置 SQLite 在线备份功能，即使数据库正在写入也能生成一致性快照。备份文件为 `.db` 格式。

通过 API 手动备份（需超级管理员）：

```text
POST /api/system/maintenance/backup
```

系统也会在每日指定时间（默认 `00:30`）自动备份，并在服务关闭前自动生成断网备份。

手动复制数据库文件时**必须先停止后端服务**，否则可能复制到不一致的状态：

```bat
:: 停止服务后复制
copy backend\data.db backups\db-before-upgrade-20260705.db
```

> 注意：不要直接复制运行中的 `data.db`，应通过系统的备份 API 生成一致性快照。

通过页面备份任务数据：

1. 使用超级管理员登录。
2. 进入"系统设置"。
3. 导出 `.xls` 任务表数据。

说明：

- `.xls` 导出只包含任务数据，适合任务表恢复；文件名包含日期和时间戳，例如 `obara-tasks-2026-07-02-093000.xls`。
- 导出的表格是渲染后的任务表，每月一个工作表，包含冻结窗口、边框、任务颜色、任务/枪名单独行和自动合计。
- 导出的任务表表头周末底色、工时管理页面和工时管理表导出的"工作日工时/周末加班工时"均按 `settings.workdayOverrides` 计算。

### 恢复方式

- **整体恢复**：停止后端服务，用备份的 `.db` 文件替换 `backend/data.db`（同时删除 `data.db-wal` 和 `data.db-shm`），然后启动服务。
- **任务数据恢复**：可以通过"系统设置"导入 `.xls`。
  - 导入前必须选择要覆盖的月份；系统只覆盖所选月份，不会一次覆盖所有月份。
  - 导入时 `当日合计` 和 `月总工时` 会被忽略，系统会重新计算。
  - 如果表格天数与所选月份天数不一致，多出的日期自动截断，缺少的日期按空数据处理。
  - 表格中的新增设计员不会自动创建，会跳过并在导入结果中提示。

## 仕样信息搜索配置

系统支持从网络共享目录读取仕样书 PDF 文件：

- 默认共享路径：`\\192.168.160.6\仕样书$\`，可通过 `SPEC_SHARE_PATH` 配置
- 需要服务器或运行后端的主机能够访问该共享目录
- 权限要求：需要有读取共享目录文件的权限
- 超时时间：纳期获取 9 秒，完整信息获取 15 秒
- 仕样号位数：由系统设置 `specNumberDigits` 控制（5 或 6 位，默认 5），可在系统设置「计划管理」标签页修改

配置说明：

1. 确保服务器网络能够访问 `192.168.160.6`
2. 确保共享目录 `仕样书$` 有读取权限
3. PDF 文件命名格式：`仕样号.PDF` 或 `仕样号.01.PDF`、`仕样号.02.PDF` 等版本文件
4. 系统会自动查找最新版本的 PDF 文件
- 注意: 仕样书共享路径可在 `backend/.env` 中通过 `SPEC_SHARE_PATH` 修改，修改后需重启后端。

## 常见问题

### 忘记超级管理员密码

未配置 `DEFAULT_ADMIN_PASSWORD` 时，初始超级管理员密码由系统随机生成，**仅在启动控制台显示一次**。如果丢失且没有其他可用的超级管理员账号：

1. 停止后端服务，并先备份 `backend/data.db`。
2. 在 `backend/.env` 中设置 `DEFAULT_ADMIN_PASSWORD` 为一个新的强密码。
3. 使用 SQLite 工具打开 `backend/data.db`，编辑 `kv_store` 表中 `key='users'` 行的 `value`（JSON 数组），删除 `username` 为 `superadmin`（或 `DEFAULT_ADMIN_USERNAME` 配置的用户名）的那个对象，保存。
   > 也可以不删除用户，直接把该对象的 `password` 字段替换为新的 bcrypt 哈希（cost 10），此时无需第 2 步。
4. 重启后端：检测到该用户名不存在时，会按 `DEFAULT_ADMIN_PASSWORD` 重新创建超级管理员。
5. 登录后立即在系统中再次修改密码。

### 后端崩溃：ERR_ERL_UNEXPECTED_X_FORWARDED_FOR

现象：经 Vite 代理（或 nginx）访问登录接口后，后端进程直接退出，错误日志为
`ValidationError: The 'X-Forwarded-For' header is set but the Express 'trust proxy' setting is false`。

原因：代理转发的请求带 `X-Forwarded-For` 头，express-rate-limit v8 在未开启
`trust proxy` 时会校验失败并抛异常（该异常会击穿进程）。

修复：`backend/server.js` 已设置 `app.set('trust proxy', 'loopback')`——只信任来自
本机环回地址（`127.0.0.1` / `::1`）的转发请求。Vite 开发代理、同机部署的
nginx/IIS 反代均工作正常，真实客户端 IP 经 `X-Forwarded-For` 透传（取最右一个环回
左侧的地址），登录日志、操作日志与限流均以此 IP 为准。

**自行升级/替换 server.js 时必须保留这一行**，否则该崩溃会复现。

> 安全提示：不要把 `'loopback'` 改回 `1`。`1` 表示无条件信任「第一跳」，当外部用户
> 可以绕过代理直连后端端口时，其伪造的 `X-Forwarded-For` 头会被直接采信，导致登录
> 日志污染与限流失效（实际日志中曾观察到伪造的 `10.0.0.x` 来源地址）。只有当反向代理
> 与后端**不在同一台机器**（代理来源 IP 不是环回地址）时，才需要把该值改为代理所在的
> 具体 IP（如 `'192.168.1.5'`）或实际跳数，同时应配合防火墙确保后端端口不被
> 客户端直接访问。应用层代码（登录/操作日志取 IP）也只使用 `req.ip`，不直接读取
> `X-Forwarded-For` / `X-Real-IP` 请求头。

### 后端启动日志出现 ERR_ERL_KEY_GEN_IPV6

现象：后端启动或处理登录请求时，日志输出 `ERR_ERL_KEY_GEN_IPV6`（提示 `IPv6 addresses are currently subsumed by the /56 subnet...`）。

原因：express-rate-limit 较新版本要求自定义 `keyGenerator` 返回值对 IPv6 做 /56 子网收敛，
否则每次生成限流键都会校验失败。该报错**非致命**（限流器仍然生效），但会持续刷错误日志。

修复：`backend/routes/auth.js` 中登录/改密限流器的自定义 `keyGenerator` 已改为使用
express-rate-limit 官方导出的 `ipKeyGenerator(req.ip)` 生成 IP 部分（IPv4-mapped
`::ffff:a.b.c.d` 归一为 IPv4，IPv6 收敛到 /56 子网），再拼接用户名或用户 ID。升级到含此
修复的版本后报错不再出现；**自行改动 `auth.js` 时请保留 `ipKeyGenerator` 包装**。

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
5. 所有页面和接口均需登录，未登录时前端会重定向到登录页。

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
2. 确认已登录，且当前用户角色有权限访问该页面
3. 确认已创建状态追踪记录

### 数据库文件损坏

SQLite 采用 WAL 模式和事务写入，正常情况下不会因进程崩溃而损坏。如果 `backend/data.db` 文件损坏：

1. 停止后端服务
2. 删除 `backend/data.db-wal` 和 `backend/data.db-shm`
3. 从备份恢复 `data.db`
4. 重新启动后端，系统会自动补齐缺失的默认配置

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

版本检查接口（需登录后携带 Token 调用，匿名返回 `401`）：

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

`start.bat` 以隐藏窗口方式运行，不会打开命令行窗口；前后端日志分别写入项目根目录的 `logs/backend.log`、`logs/frontend.log`（错误输出为 `logs/backend.err.log`、`logs/frontend.err.log`），启动脚本自身的输出在 `logs/startup.log`，排障时直接查看这些文件即可。

手动执行 `npm run dev` 时直接查看当前 PowerShell 或 CMD 输出。

超级管理员也可以在页面中查看登录和操作日志：

- “系统设置”日志管理模块主页显示最新 10 条管理员登录信息。
- “操作日志”页面（`/system-logs`）显示所有用户的所有操作记录，支持按用户名、操作类型、HTTP 方法、IP、日期范围筛选，并支持导出 `.xls`。
- 操作类型和描述均为中文，例如「用户登录」「添加任务」「更新任务」「删除任务」「移动任务」「重新排序设计员」「批量替换任务」等。
- 浏览器信息存储浏览器名称和版本号、操作系统和版本号、设备类型，但页面和导出表格中仅显示浏览器名称（如「Chrome」）。
- “登录日志”接口（`GET /api/system/login-logs`）仍可用于查看所有登录用户的登录明细，支持按账号/姓名、角色、结果、IP、浏览器、日期和显示条数筛选。

## 验证流程

部署或升级后建议至少验证以下路径：

| 验证项 | 步骤 | 预期结果 |
|--------|------|----------|
| 登录 | 使用超级管理员登录 | 登录成功，未被强制修改密码时进入主页 |
| 任务保存 | 在主页面新增、编辑、删除一条任务 | 页面保存成功，刷新后数据仍存在 |
| 多人协作 | 两个浏览器窗口编辑同一设计人员同一天 | 后进入编辑的一方看到正在编辑提示 |
| 权限控制 | 切换页面权限开关后用不同角色访问 | 页面可见性符合设置 |
| 数据导出 | 系统设置中导出任务、状态跟踪表或工时表 | 浏览器下载 `.xls` 文件 |
| 日志记录 | 执行一次登录或任务操作后查看操作日志 | 日志列表出现对应记录 |
| 离线提示 | 暂停后端服务后观察前端 | 前端显示离线状态和橙色横幅 |

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

## 性能优化建议

1. **SQLite WAL 模式**：数据库启用 WAL（Write-Ahead Logging）模式，支持并发读取，写入通过事务持久化，单库上限 281 TB
2. **内存缓存 + 关系表存储**：键值集合（用户、设计人员、设置等）加载到内存缓存并做脏检查，仅变更的集合落库；任务工时表拆分为 `task_sheets`/`task_entries` 关系表，查询走索引按需装配，写入只重写受影响的单张表，避免整库 JSON 反复序列化
3. **数据库文件大小**：`loginLogs` 和 `auditLogs` 均最多保留 2000 条记录，自动清理旧日志
4. **并发写入保护**：数据库写入采用队列机制，避免并发冲突
5. **前端防抖**：任务字段变更采用 500ms 防抖保存，减少网络请求
6. **离线缓存**：后端断开时自动切换到 localStorage 缓存数据
7. **操作日志精简**：GET 请求不记录响应消息，POST/PUT 请求体最大保留 2000 字符，避免数据库膨胀

## 数据库维护

系统内置自动维护功能，可通过 API 管理数据库备份、任务导出和年度数据清理。

### 自动维护功能

自动维护在每日指定时间（默认 `00:30`）执行以下任务：

| 任务 | 说明 | 默认状态 |
|------|------|----------|
| 数据库备份 | 使用 SQLite 在线备份 API 生成 `.db` 一致性快照 | 启用 |
| 任务数据导出 | 导出渲染后的任务表为 `.xls` 文件（`task-export-YYYYMMDD-HHmmss.xls`） | 启用 |
| 编号台账导出 | 导出全部焊枪编号台账为单个 `.xls`（每分类一个工作表），文件名 `gun-ledger-all-YYYYMMDD-HHmmss.xls` | 启用 |
| 过期备份清理 | 删除超过保留天数的旧备份（数据库备份/任务导出/编号台账导出按各自保留天数，断网备份按断网保留天数） | 自动执行 |
| 年度任务清理 | 在指定月份自动清理超过保留年限的旧任务数据 | 启用 |

### 维护目录结构

```text
backend/
├── backups/
│   ├── database/          # 数据库备份
│   ├── task-exports/      # 任务数据导出
│   ├── gun-ledger-exports/ # 焊枪编号台账导出
│   ├── yearly-archives/   # 年度归档
│   └── offline/           # 断网备份（关闭前自动备份）
```

### 断网备份

断网备份（offline backup）是服务关闭前的快速备份机制，独立于定时备份：

- 触发时机：后端收到 `SIGINT`/`SIGTERM` 信号（即 `Ctrl+C` 或服务停止）时，会先创建一次断网备份再退出。
- 防抖机制：同一次会话内 5 分钟内只生成一次，避免短时间内重复备份。
- 存储位置：独立目录 `backups/offline/`，便于与日常备份区分。
- 备份文件名：
  - 关闭触发：`offline-backup-shutdown-{YYYYMMDD-HHmmss}.db`
  - 用户触发：`offline-backup-{userId}-{username}-{YYYYMMDD-HHmmss}.db`
- 可通过 `POST /api/system/maintenance/offline-backup` 主动触发：本机环回地址（localhost）可匿名调用（供 stop.bat 等运维脚本），非环回请求须为超级管理员。
- 默认保留 7 天（`offlineBackupRetentionDays`），超过自动清理；断网备份开关、保留天数与目录均可在系统设置「数据库维护」中配置（`PUT /api/system/maintenance`）。

### 维护配置

维护配置存储在数据库的 `settings.maintenance` 中，可通过 API 更新：

```json
{
  "enabled": true,
  "dailyBackupEnabled": true,
  "dailyTaskExportEnabled": true,
  "dailyGunLedgerExportEnabled": true,
  "offlineBackupEnabled": true,
  "backupRetentionDays": 30,
  "taskExportRetentionDays": 30,
  "gunLedgerExportRetentionDays": 30,
  "offlineBackupRetentionDays": 7,
  "scheduleTime": "00:30",
  "yearlyCleanupEnabled": true,
  "yearlyCleanupMonth": 1,
  "yearlyCleanupCheckDays": 10,
  "yearlyTaskRetentionYears": 1,
  "backupDir": "backups/database",
  "taskExportDir": "backups/task-exports",
  "gunLedgerExportDir": "backups/gun-ledger-exports",
  "yearlyArchiveDir": "backups/yearly-archives",
  "offlineBackupDir": "backups/offline",
  "yearlyCleanupHistory": {}
}
```

> 说明：`PUT /api/system/maintenance` 接口接受上表全部字段，**包括断网备份开关、保留天数与目录**（`offlineBackupEnabled`、`offlineBackupRetentionDays`、`offlineBackupDir`），保存后立即生效；所有字段均为必填（前端提交完整配置对象），`yearlyCleanupHistory` 由后端维护不可修改，其余未声明字段会被 Joi 自动过滤（`stripUnknown`）。

### 维护 API

| API | 方法 | 权限 | 说明 |
|-----|------|------|------|
| `/api/system/maintenance` | GET | 超级管理员 | 获取维护状态和配置 |
| `/api/system/maintenance` | PUT | 超级管理员 | 更新维护配置 |
| `/api/system/maintenance/backup` | POST | 超级管理员 | 手动创建数据库备份 |
| `/api/system/maintenance/offline-backup` | POST | 环回匿名 / 外部超管 | 手动触发断网备份 |
| `/api/system/maintenance/export-tasks` | POST | 超级管理员 | 手动导出任务数据 |
| `/api/system/maintenance/export-gun-ledger` | POST | 超级管理员 | 手动导出全部焊枪编号台账为单个 `.xls` |
| `/api/system/maintenance/cleanup-backups` | POST | 超级管理员 | 清理过期备份 |
| `/api/system/maintenance/yearly-cleanup` | POST | 超级管理员 | 手动执行年度清理；请求体传 `{"force": true}` 可跳过时间检查强制执行 |
| `/api/system/maintenance/clear-logs` | POST | 超级管理员 | 同时清空登录日志和操作日志 |
| `/api/system/maintenance/cleanup-tasks` | POST | 超级管理员 | 清理指定月份或指定年月之前的任务 |
| `/api/system/db-stats` | GET | 超级管理员 | 获取数据库统计信息 |
| `/api/system/cleanup/login-logs` | DELETE | 超级管理员 | 清空登录日志 |
| `/api/system/cleanup/audit-logs` | DELETE | 超级管理员 | 清空操作日志 |
| `/api/system/cleanup/old-tasks` | DELETE | 超级管理员 | 清理旧任务数据（按保留月数） |
| `/api/system/cleanup/status-tracking` | DELETE | 超级管理员 | 清理旧状态追踪数据（按保留月数） |
| `/api/status-tracking/cleanup` | POST | 超级管理员 | 按时间点清理状态追踪记录，请求体 `{beforeMonth, beforeYear, mode?}`；`mode=delivery` 按纳期月清理，缺省按添加时间月清理 |

### 年度清理流程

年度清理会在指定月份的前 N 天（默认 1 月 1-10 日）内自动执行：

1. 检查当前月份和日期是否在清理窗口内
2. 检查当年是否已执行过清理
3. 将超过保留年限的任务数据归档到年度归档目录
4. 从数据库中删除已归档的任务数据
5. 记录清理历史到 `yearlyCleanupHistory`

### 数据库统计

`GET /api/system/db-stats` 返回数据库统计信息，包含：

- **size**：逻辑数据大小（键值集合与任务条目 JSON 序列化后的体积，字节/KB/MB）
- **storage**：SQLite 存储信息，包括引擎、驱动、journal 模式、`data.db`/`data.db-wal`/`data.db-shm` 文件大小
- **counts**：用户、设计人员、任务、任务条目、月份、状态追踪、登录日志、操作日志数量
- **warnings**：数据库超过 10MB/50MB（仅为提示，非硬限制）、任务数据超过 24 个月的警告

### 维护最佳实践

1. **监控数据库大小**：定期检查 `db-stats`，其中 10MB/50MB 仅为提示性警告而非 SQLite 限制（SQLite 单库上限约 281TB，1GB 以内可稳定运行）；结合任务月份数判断是否需要清理旧数据，必要时执行 `VACUUM` 回收磁盘空间
2. **调整备份保留天数**：根据存储容量调整 `backupRetentionDays`，建议至少保留 7 天
3. **设置合理的数据保留年限**：根据业务需求设置 `yearlyTaskRetentionYears`
4. **定期手动备份**：在执行重大操作（如升级、批量导入）前手动执行备份
5. **清理日志**：定期清理登录日志和操作日志，减少数据库体积
6. **测试恢复流程**：定期测试从备份恢复数据的流程

最后更新：2026-09-26
