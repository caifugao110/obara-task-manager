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

**模型 Key 的配置方式**（`setup.js` 按以下优先级读取，全部缺失才交互询问）：

1. **写入 `weknora/.env`**（推荐）：`DEEPSEEK_API_KEY=sk-xxx`、`BIGMODEL_API_KEY=xxx.yyy`，一次配置永久生效（该文件已 gitignore，不会泄露）；
2. 环境变量：`DEEPSEEK_API_KEY` / `BIGMODEL_API_KEY`；
3. 命令行参数：`--deepseek-key` / `--zhipu-key`；
4. 都没有时运行中提示输入。

> 模型创建后即加密存入 WeKnora 数据库，此后重复执行 `setup.js` 不再需要 Key。

## 3. 一键部署（推荐）

```bat
rem Windows：先把 Key 写入 weknora\.env（或 set 环境变量），然后
cd weknora
start.bat
```

```bash
# Linux / macOS：先把 Key 写入 weknora/.env（或 export 环境变量），然后
cd weknora && bash start.sh
```

脚本自动完成：

1. `scripts/gen-env.js` — 生成 `.env`（自动填入随机 `JWT_SECRET` / `SYSTEM_AES_KEY`，已存在则跳过）；
2. `docker compose up -d` — 启动 5 个容器并等待 app 健康；
3. `scripts/setup.js` — 初始化：注册管理员 → 配置 DeepSeek/智谱模型 → 创建**当前工作空间**的 API Key → 把 `WEKNORA_*` 写入 `backend/.env`（不再自动建库/上传文档；其他工作空间的 Key 需手动创建，见第 6 节）。

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

`setup.js` 幂等，可反复执行：已有模型/API Key 会自动复用跳过。

常用可选参数：

| 参数 | 说明 |
|------|------|
| `--no-env` | 跳过写入 `backend/.env` |
| `--base-url <url>` | WeKnora 在其他主机时指定 API 地址 |

## 5. 目录结构

```
weknora/
├── docker-compose.yml      # 精简版编排：frontend/app/docreader/postgres/redis
├── .env.example            # 环境变量模板（含密钥生成说明）
├── .env                    # 实际配置（gen-env.js 生成，已 gitignore）
├── config/config.yaml      # WeKnora app 配置（分块/检索阈值等，来自官方 v0.8.2）
├── knowledge/              # 知识库源数据与提示词模板
│   ├── X2C-C-knowledge.xlsx        # C 枪焊枪选型数据表（X2C 系列）
│   ├── X2C-X-knowledge.xlsx        # X 枪焊枪选型数据表（X2C 系列）
│   ├── X2C-V2-C-knowledge.xlsx     # C 枪焊枪选型数据表（X2C-V2 系列）
│   ├── X2C-V2-X-knowledge.xlsx     # X 枪焊枪选型数据表（X2C-V2 系列）
│   ├── X2C-V3-C-knowledge.xlsx     # C 枪焊枪选型数据表（X2C-V3 系列）
│   ├── X2C-V3-X-knowledge.xlsx     # X 枪焊枪选型数据表（X2C-V3 系列）
│   └── 焊枪选型规范答复约束提示词.md # 焊枪选型问答的答复约束提示词模板
├── scripts/
│   ├── gen-env.js          # 生成 .env（随机密钥，幂等）
│   └── setup.js            # 一键初始化（幂等）
├── start.bat               # Windows 一键启动
└── start.sh                # Linux/macOS 一键启动
```

> `knowledge/` 下的 6 份 `.xlsx` 是焊枪选型知识库的原始数据，需要在 WeKnora 控制台（http://localhost/platform/knowledge-bases）手动上传到对应知识库；提示词模板 `.md` 则复制粘贴到本系统「设计规范知识库」页面底部的「答复约束提示词」面板（详见第 6 节）。

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
- **管理知识库与文档**：在 WeKnora 控制台（http://localhost/platform/knowledge-bases）创建知识库、上传/删除文档。本系统页面不再提供建库与文档上传/删除功能。
- **关联知识库到本系统**：在 WeKnora 控制台创建好知识库后，复制其知识库 ID，到本系统「设计规范知识库 → 知识库管理」页面（需要一般管理员及以上）点击「关联知识库」并粘贴 ID 即可。取消关联仅移除本系统的关联记录，不会删除 WeKnora 中的知识库。
- **接入多个工作空间（多租户）**：WeKnora 的 API Key 按工作空间隔离，一个 Key 只能访问其所属空间的知识库。需要接入其他空间时，分别登录各空间在 API Key 管理中创建 Key，主空间 Key 已由 `setup.js` 写入 `WEKNORA_API_KEY`，其余 Key 用英文逗号分隔填入 `backend/.env` 的 `WEKNORA_EXTRA_API_KEYS`，再重启本系统后端。状态接口的 `tenants` 字段可确认每个 Key 的空间身份与可达性。
- **无需配置 `WEKNORA_KNOWLEDGE_BASE_IDS`**：检索与问答始终使用页面上显式关联/勾选的知识库 ID（请求体未传知识库 ID 时后端直接返回 `400`）；`backend/.env` 中的 `WEKNORA_KNOWLEDGE_BASE_IDS` 仅是早期版本遗留的兜底变量，当前流程不读取它，新增知识库只需在页面「关联知识库」即可。
- **答复约束提示词**：由本系统超管在「设计规范知识库」页面底部的「答复约束提示词」面板中按知识库配置（支持整篇 Markdown，最长 20000 字符）；后端据此自动在知识库所属工作空间创建/更新受管自定义智能体，清空提示词则自动删除智能体。配置前提是该空间已有可用的 KnowledgeQA 问答模型。

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
9. **问答不允许跨工作空间**：检索可以跨空间分组扇出再合并排序，但知识库问答的会话是空间级资源，所选知识库必须同属一个工作空间；跨空间勾选时前端禁用发送，后端也会在 SSE 建连前返回 `400 WEKNORA_MULTI_TENANT`。配置答复约束提示词时，若该空间没有 KnowledgeQA 问答模型则返回 `503 WEKNORA_NO_QA_MODEL`。

## 9. 安全建议（生产）

- 立即修改 WeKnora 管理员密码（默认 `Obara@WeKnora2026`）与本系统默认管理员密码；
- `weknora/.env` 中 `DB_PASSWORD` / `REDIS_PASSWORD` 改为强口令；
- 生产建议在 `weknora/.env` 增加 `DISABLE_REGISTRATION=true` 禁止公开注册；
- 不要把 `.env`、`backend/.env` 提交到 git（已在 .gitignore 中）。
