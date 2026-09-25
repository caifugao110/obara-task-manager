# WeKnora 知识库部署指南（设计规范知识库）

本目录包含 obara-task-manager「设计规范知识库」功能所需的**全部**部署物料。
**部署新服务器时，只需要本目录 + 本文件，无需再访问原 WeKnora 源码仓库。**

底层引擎：[Tencent/WeKnora](https://github.com/Tencent/WeKnora) v0.8.2（使用官方预构建镜像）。

---

## 1. 架构总览

```
浏览器 (5173)                        Docker（本目录 compose）
   │  /api/design-standards/*        ┌─────────────────────────────────┐
   ▼                                 │  frontend  :80   WeKnora 控制台 │
backend (5000)  ──代理转发──────────▶│  app       :8080 WeKnora API    │
  utils/weknora.js                   │  docreader gRPC  文档解析       │
  （X-API-Key 鉴权，密钥不出服务端）  │  postgres  paradedb 向量检索    │
                                     │  redis     任务队列             │
                                     └─────────────────────────────────┘
                                              ▲
                              模型走云端 API：DeepSeek（问答）+ 智谱（向量化）
```

数据流：用户 → 本系统后端 `/api/design-standards/*` → WeKnora app `8080` → 云端模型 API。
WeKnora 的地址与 API Key 只保存在 `backend/.env`，**不下发到浏览器**。

## 2. 前置条件

| 依赖 | 要求 |
|------|------|
| Docker | Docker Desktop（Windows/macOS）或 Docker Engine + Compose 插件（Linux） |
| Node.js | 22+（仅用于运行初始化脚本） |
| DeepSeek API Key | 问答模型，https://platform.deepseek.com 申请 |
| 智谱 BigModel API Key | 向量模型，https://open.bigmodel.cn 申请 |

磁盘：首次拉取镜像约 2~3GB；内存建议 ≥ 4GB。

## 3. 一键部署（推荐）

```bat
rem Windows
set DEEPSEEK_API_KEY=sk-xxx
set BIGMODEL_API_KEY=xxx.yyy
cd weknora
start.bat
```

```bash
# Linux / macOS
export DEEPSEEK_API_KEY=sk-xxx
export BIGMODEL_API_KEY=xxx.yyy
cd weknora && bash start.sh
```

脚本自动完成：

1. `scripts/gen-env.js` — 生成 `.env`（自动填入随机 `JWT_SECRET` / `SYSTEM_AES_KEY`，已存在则跳过）；
2. `docker compose up -d` — 启动 5 个容器并等待 app 健康；
3. `scripts/setup.js` — 初始化：注册管理员 → 配置 DeepSeek/智谱模型 → 创建「设计规范库」（**建库时即绑定模型**）→ 创建 API Key → 上传 `knowledge/电极使用规范.pdf` 并等待解析完成 → 把 `WEKNORA_*` 写入 `backend/.env`。

完成后：

| 地址 | 说明 |
|------|------|
| http://localhost | WeKnora 管理控制台（admin@obara.local / Obara@WeKnora2026） |
| http://localhost:8080 | WeKnora API（健康检查 /health） |
| http://localhost:5173/design-standards | 本系统设计规范知识库页面 |

> 若 `backend/.env` 有变更，**必须重启本系统后端**（`node server.js`，非热重载）。

## 4. 手动分步部署（等价于 start.bat 内部步骤）

```bash
cd weknora
node scripts/gen-env.js        # 1. 生成 .env
docker compose up -d           # 2. 启动容器
docker compose ps              #    确认 app/docreader/postgres 均 healthy
node scripts/setup.js \
  --deepseek-key sk-xxx \
  --zhipu-key xxx.yyy          # 3. 初始化
```

`setup.js` 幂等，可反复执行：已有模型/知识库/API Key/文档会自动复用跳过。

常用可选参数：

| 参数 | 说明 |
|------|------|
| `--kb-name <名>` | 自定义知识库名称（默认「设计规范库」） |
| `--file <路径>` | 自定义默认上传文件（默认 `knowledge/电极使用规范.pdf`） |
| `--no-upload` | 跳过默认文件上传 |
| `--no-env` | 跳过写入 `backend/.env` |
| `--base-url <url>` | WeKnora 在其他主机时指定 API 地址 |

## 5. 目录结构

```
weknora/
├── docker-compose.yml      # 精简版编排：frontend/app/docreader/postgres/redis
├── .env.example            # 环境变量模板（含密钥生成说明）
├── .env                    # 实际配置（gen-env.js 生成，已 gitignore）
├── config/config.yaml      # WeKnora app 配置（分块/检索阈值等，来自官方 v0.8.2）
├── knowledge/
│   └── 电极使用规范.pdf     # 默认知识库文件（初始化自动上传）
├── scripts/
│   ├── gen-env.js          # 生成 .env（随机密钥，幂等）
│   └── setup.js            # 一键初始化（幂等）
├── start.bat               # Windows 一键启动
└── start.sh                # Linux/macOS 一键启动
```

## 6. 日常运维

```bash
cd weknora
docker compose ps              # 查看状态
docker compose logs -f app     # 查看 API 日志
docker compose restart         # 重启
docker compose down            # 停止（数据保留在卷中）
docker compose down -v         # 停止并删除数据卷（⚠ 知识库数据全丢）
docker compose pull && docker compose up -d   # 升级到 WEKNORA_VERSION 指定版本
```

- **更换模型 API Key**：在控制台「设置 → 模型管理」直接改，或删除对应模型后重跑 `setup.js`。
- **补充规范文件**：用页面「知识库管理」标签上传，或控制台操作，无需改配置。
- **新增知识库**：页面「知识库管理」可建库，但需在控制台确认其已绑定向量模型，再把新 ID 加入 `backend/.env` 的 `WEKNORA_KNOWLEDGE_BASE_IDS`（逗号分隔）。

## 7. 从旧部署（E:\My Trae\WeKnora）迁移

本目录的 compose 项目名与原部署一致（均为 `weknora`），**数据卷可直接复用**：

```bash
cd "E:\My Trae\WeKnora" && docker compose down    # 停掉旧栈（数据保留）
cd obara-task-manager\weknora && docker compose up -d   # 用新目录启动，原数据自动挂载
```

此后可删除旧目录，全部配置以本项目为准。

## 8. 踩坑记录（重要，勿重蹈）

1. **知识库必须在创建时绑定模型**（`embedding_model_id` + `summary_model_id` 放在 POST body）。
   事后用 PUT 补绑**不生效**，文档解析报 `failed to get embedding model: model ID cannot be empty`。
2. **SSE 代理必须监听 `res.on('close')`** 而非 `req.on('close')`：Node/Express 中 req 的
   close 在请求体读完即触发，会导致流还没开始输出就被当成「客户端断开」，返回 200 空响应。
3. **WeKnora 流式事件里多个事件带 `done=true`**（agent_query / tool_call / references / complete），
   逐条转发会产生多个 done；正确做法是只在整个流结束后发一次。最终答案以逐 token 的
   `answer` 事件累计即可（与 `complete.data.final_content` 完全一致）。
4. **回答正文内联 `<kb doc="..." chunk_id="..." kb_id="..." />` 溯源标签**，前端需清理后展示。
5. **检索结果 `match_type` 是数字枚举**（0=向量检索、1=关键词……），需映射成文字再展示。
6. **SYSTEM_AES_KEY 一旦设置不可丢失**，否则数据库里已加密的模型 API Key 全部无法解密。
7. `docker compose pull` 偶发卡顿时，逐镜像 `docker pull <image>` 重试即可；并行拉同一镜像会互相阻塞。
8. 本系统后端是 `node server.js`（非 nodemon），**改 backend 代码或 backend/.env 后必须重启后端**。

## 9. 安全建议（生产）

- 立即修改 WeKnora 管理员密码（默认 `Obara@WeKnora2026`）与本系统默认管理员密码；
- `weknora/.env` 中 `DB_PASSWORD` / `REDIS_PASSWORD` 改为强口令；
- 生产建议在 `weknora/.env` 增加 `DISABLE_REGISTRATION=true` 禁止公开注册；
- 不要把 `.env`、`backend/.env` 提交到 git（已在 .gitignore 中）。
