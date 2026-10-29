# WeKnora 知识库部署指南（设计规范知识库）

本目录包含 obara-task-manager「设计规范知识库」功能所需的**全部**部署物料。
**部署新服务器时，只需要本目录 + 本文件，无需再访问原 WeKnora 源码仓库。**

底层引擎：[Tencent/WeKnora](https://github.com/Tencent/WeKnora) v0.8.3（使用官方预构建镜像）。

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

**镜像与关键配置**（均取自 `weknora/.env`，默认已固定版本，避免 `latest` 漂移）：

| 项 | 默认值 | 说明 |
|----|--------|------|
| `WEKNORA_VERSION` | `v0.8.3` | `wechatopenai/weknora-{ui,app,docreader}` 三个官方镜像的标签 |
| 向量/关系库 | `paradedb/paradedb:v0.25.11-pg17` | 在 `docker-compose.yml` 中固定，不受 `WEKNORA_VERSION` 影响；v0.8.3 起由 `v0.22.6-pg17` 升级而来（PG 主版本仍为 17，数据卷可直接复用，但**扩展 catalog 必须手工升级**，见 6.2） |
| 缓存/任务队列 | `redis:7.0-alpine` | 同上 |
| `APP_PORT` / `FRONTEND_PORT` | `8080` / `80` | 发布到 `BIND_ADDRESS` 指定的地址（默认仅回环） |
| `BIND_ADDRESS` | `127.0.0.1` | 端口绑定地址，改为 `0.0.0.0` 即暴露到内网（见第 9 节） |
| `MAX_FILE_SIZE_MB` | `50` | 控制台上传与 docreader 解析的**单个文档大小上限（MB）**；需要上传更大文档时先调大该值再 `docker compose up -d` 重建容器 |
| `DISABLE_REGISTRATION` | `true` | 关闭开放注册 |
| 文档解析端口 | gRPC `50051` | docreader 仅在容器网络内暴露，不发布到宿主机 |

**模型 Key 的配置方式**（`setup.js` 按以下优先级读取，全部缺失才交互询问）：

1. **命令行参数**：`--deepseek-key` / `--zhipu-key`（优先级最高，适合临时覆盖）；
2. **环境变量**：`DEEPSEEK_API_KEY` / `BIGMODEL_API_KEY`；
3. **写入 `weknora/.env`**（推荐长期保存）：`DEEPSEEK_API_KEY=sk-xxx`、`BIGMODEL_API_KEY=xxx.yyy`，一次配置永久生效（该文件已 gitignore，不会泄露）；
4. 三者都没有时才在运行中提示输入。

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
| http://localhost | WeKnora 管理控制台（账号默认 admin@obara.local） |
| http://localhost:8080 | WeKnora API（健康检查 /health，默认仅本机回环可达） |
| http://localhost:5173/design-standards | 本系统设计规范知识库页面 |

**管理员口令（无内置默认口令）**：`setup.js` 按以下顺序解析——`--password` 参数 / `WEKNORA_ADMIN_PASSWORD` 环境变量 / `weknora/.env` 同名项 → 交互终端手动输入（回车则随机生成）→ 非交互场景随机生成 20 位强口令。随机口令会在初始化输出中**显示一次**并回写到 `weknora/.env` 的 `WEKNORA_ADMIN_PASSWORD`（保证脚本幂等重跑），首次登录后请尽快在控制台修改。

> 若 `backend/.env` 有变更，**必须重启本系统后端**（`start.bat` 方式经 nodemon 启动，但 nodemon 仅监听 `.js` 文件，`.env` 变更不会自动重载；`node server.js` 直启则完全无热重载）。

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
| `--deepseek-key` / `--zhipu-key` | 模型 API Key（优先级最高，见第 2 节） |
| `--email <邮箱>` / `--password <口令>` | 指定管理员账号与口令；均缺省时交互/随机生成口令（见第 3 节）。`--password` 单独出现不带值时按「未提供」处理 |
| `--base-url <url>` | WeKnora 在其他主机时指定 API 根地址（默认 `http://127.0.0.1:8080/api/v1`） |
| `--backend-env <path>` | 指定要写入的 `backend/.env` 路径（默认 `../../backend/.env`），后端不在标准相对位置时使用 |
| `--no-env` | 跳过写入 `backend/.env`（只初始化 WeKnora，不联动本系统后端配置） |

## 5. 目录结构

```
weknora/
├── docker-compose.yml      # 精简版编排：frontend/app/docreader/postgres/redis
├── .env.example            # 环境变量模板（含密钥生成说明）
├── .env                    # 实际配置（gen-env.js 生成，已 gitignore）
├── config/config.yaml      # WeKnora app 配置（分块/检索阈值等，来自官方 v0.8.3）
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

> 跨 ParadeDB 版本线的升级（如 0.22.6 → 0.25.11）不能只做 `docker compose pull`，必须按 [6.2](#62-从-v082paradedb-0226升级到-v083paradedb-02511) 补扩展升级 SQL，否则 PostgreSQL 会因扩展版本不匹配崩溃。

- **更换模型 API Key**：在控制台「设置 → 模型管理」直接改，或删除对应模型后重跑 `setup.js`。
- **管理知识库与文档**：在 WeKnora 控制台（http://localhost/platform/knowledge-bases）创建知识库、上传/删除文档。本系统页面不再提供建库与文档上传/删除功能。
- **关联知识库到本系统**：在 WeKnora 控制台创建好知识库后，复制其知识库 ID，到本系统「设计规范知识库 → 知识库管理」页面（需要一般管理员及以上）点击「关联知识库」并粘贴 ID 即可。取消关联仅移除本系统的关联记录，不会删除 WeKnora 中的知识库。
- **接入多个工作空间（多租户）**：WeKnora 的 API Key 按工作空间隔离，一个 Key 只能访问其所属空间的知识库。需要接入其他空间时，分别登录各空间在 API Key 管理中创建 Key，主空间 Key 已由 `setup.js` 写入 `WEKNORA_API_KEY`，其余 Key 用英文逗号分隔填入 `backend/.env` 的 `WEKNORA_EXTRA_API_KEYS`，再重启本系统后端。状态接口的 `tenants` 字段可确认每个 Key 的空间身份与可达性。
- **无需配置 `WEKNORA_KNOWLEDGE_BASE_IDS`**：检索与问答始终使用页面上显式关联/勾选的知识库 ID（请求体未传知识库 ID 时后端直接返回 `400`）；`backend/.env` 中的 `WEKNORA_KNOWLEDGE_BASE_IDS` 仅是早期版本遗留的兜底变量，当前流程不读取它，新增知识库只需在页面「关联知识库」即可。
- **答复约束提示词**：由本系统超管在「设计规范知识库」页面底部的「答复约束提示词」面板中按知识库配置（支持整篇 Markdown，最长 20000 字符）；后端据此自动在知识库所属工作空间创建/更新受管自定义智能体，清空提示词则自动删除智能体。配置前提是该空间已有可用的 KnowledgeQA 问答模型。

### 6.1 数据备份与恢复

知识库全部数据都在 Docker 命名卷中（compose 项目名为 `weknora`）：

| 卷 | 内容 | 是否必须备份 |
|----|------|--------------|
| `weknora_postgres-data` | PostgreSQL 数据库：知识库元数据、文档解析文本、向量索引、智能体与模型配置 | 是（核心） |
| `weknora_data-files` | 上传的原始文档文件 | 是 |
| `weknora_docreader-tmp` | 文档解析临时目录 | 否（可自动重建） |

**推荐：使用 pg_dump 做逻辑备份（服务可在线运行）：**

```bash
cd weknora
docker compose exec -T postgres pg_dump -U postgres -d WeKnora \
  > backups/weknora-pg-$(date +%Y%m%d-%H%M%S).sql
```

Windows PowerShell 下等价命令（注意先建好 `backups` 目录）：

```powershell
cd weknora; if (!(Test-Path backups)) { New-Item -ItemType Directory backups | Out-Null }
docker compose exec -T postgres pg_dump -U postgres -d WeKnora |
  Out-File -Encoding ascii "backups/weknora-pg-$(Get-Date -Format yyyyMMdd-HHmmss).sql"
```

数据库用户名 / 库名取自 `weknora/.env`（默认 `postgres` / `WeKnora`）。原始文档文件可直接打包 `data-files` 卷备份：

```bash
docker run --rm -v weknora_data-files:/data -v "$PWD/backups:/backup" busybox \
  tar czf /backup/weknora-files-$(date +%Y%m%d).tar.gz -C /data .
```

**恢复（全新环境 / 空卷时）：**

```bash
cd weknora
docker compose up -d postgres           # 先只起数据库
docker compose exec -T postgres psql -U postgres -d WeKnora < backups/weknora-pg-YYYYMMDD-HHMMSS.sql
docker run --rm -v weknora_data-files:/data -v "$PWD/backups:/backup" busybox \
  tar xzf /backup/weknora-files-YYYYMMDD.tar.gz -C /data
docker compose up -d                    # 再启动其余服务
```

> 注意：pg_dump 备份与卷级备份都应**妥善保管 `weknora/.env`**——其中的 `SYSTEM_AES_KEY` 用于解密数据库内的模型 API Key，丢失后即使恢复了数据库，模型 Key 也无法解密（见第 8 节踩坑记录第 6 条）。

### 6.2 从 v0.8.2（ParadeDB 0.22.6）升级到 v0.8.3（ParadeDB 0.25.11）

v0.8.3 把向量/关系库镜像从 `paradedb:v0.22.6-pg17` 升到 `paradedb:v0.25.11-pg17`（PG 主版本仍是 17，数据卷可直接复用）。**仅换镜像不会更新数据库里已有的扩展**：`pg_search` 的 catalog 停在旧版本时，部分扩展函数会因签名与新二进制不匹配而让整个 PostgreSQL 段错误崩掉。因此换镜像后必须补一条扩展升级 SQL。

> 全新部署（数据卷为空）不涉及本节——镜像自带的就是 0.25.11，无需任何额外操作。

升级步骤（在 `weknora/` 目录执行）：

```bash
# 1. 备份（备份文件落在数据库数据卷之外）
docker compose exec -T postgres sh -c 'pg_dumpall -U "$POSTGRES_USER"' > paradedb-before-upgrade.sql

# 2. 停止写入方（本系统后端也要停，避免迁移期间有写入）
docker compose stop app

# 3. 只替换数据库容器
docker compose pull postgres
docker compose up -d --no-deps --wait postgres

# 4. 升级扩展 catalog（用户名/库名取自 .env 的 DB_USER / DB_NAME）
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' <<'SQL'
ALTER EXTENSION pg_search UPDATE;
ALTER EXTENSION vector UPDATE;
SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_search', 'vector');
SELECT * FROM paradedb.version_info();
SQL

# 5. 恢复其余服务，然后抽查一次检索与问答
docker compose up -d
```

- 预期结果：`pg_search` 与 `paradedb.version_info()` 均为 **0.25.11**，`vector` 为 **0.8.4**。
- 已有的 BM25/HNSW 索引在新版本下可继续读写，**不需要**重建索引或重新导入文档；如遇到异常再 `REINDEX`。
- **不要**在新镜像上执行 `ALTER EXTENSION pg_search UPDATE TO '0.22.6'`，同样会造成版本不匹配。
- 回滚只能把升级前的备份恢复到独立数据卷并配回旧镜像；只改回镜像标签不会撤销扩展变更（pg_search 0.24 起会向 WAL 写入旧镜像无法重放的记录）。
- 本系统自己的 `data.db` 不受影响，只动 WeKnora 的 Docker 卷。

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
8. 本系统后端无论经 `start.bat`（nodemon，仅监听 `.js`）还是 `node server.js` 直启，`.env` 变更都不会自动重载，**改 backend 代码或 backend/.env 后必须重启后端**。
9. **问答不允许跨工作空间**：检索可以跨空间分组扇出再合并排序，但知识库问答的会话是空间级资源，所选知识库必须同属一个工作空间；跨空间勾选时前端禁用发送，后端也会在 SSE 建连前返回 `400 WEKNORA_MULTI_TENANT`。配置答复约束提示词时，若该空间没有 KnowledgeQA 问答模型则返回 `503 WEKNORA_NO_QA_MODEL`。

## 9. 安全说明与生产建议

当前默认值已按最小暴露面配置：

- **无默认管理员口令**：初始化时必须显式提供或随机生成（随机口令仅显示一次并写入 `weknora/.env`），首次登录后请尽快修改；
- **端口默认仅绑定回环地址**：`BIND_ADDRESS` 默认为 `127.0.0.1`，WeKnora 控制台/API 不暴露到内网，只供本系统后端在本机调用；
- **默认关闭开放注册**：`DISABLE_REGISTRATION` 默认为 `true`，内网其他人员无法自行注册账号；
- `JWT_SECRET` / `SYSTEM_AES_KEY` 由 `gen-env.js` 随机生成；模型 API Key 加密存入 WeKnora 数据库，仅保存在服务端，不下发浏览器；
- 不要把 `.env`、`backend/.env` 提交到 git（已在 .gitignore 中）。

如需让局域网其他机器**直连** WeKnora 控制台（不推荐，优先使用本系统页面）：

1. 在 `weknora/.env` 设置 `BIND_ADDRESS=0.0.0.0` 后重新 `docker compose up -d`；
2. 确认管理员口令已从随机初始口令改为强口令；
3. 保持 `DISABLE_REGISTRATION=true`；
4. 全新部署可把 `DB_PASSWORD` / `REDIS_PASSWORD` 改为强口令（**已有数据卷的部署勿改**，会导致数据库/Redis 无法登录）。

## 10. 常见故障排查

| 现象 | 原因与处理 |
|------|------------|
| `docker compose up -d` 报端口被占用 | Windows 上 80 端口常被 IIS/其他服务占用。修改 `weknora/.env` 的 `FRONTEND_PORT`（控制台）或 `APP_PORT`（API）后重新 `docker compose up -d`。**若改了 `APP_PORT`，本系统 `backend/.env` 的 `WEKNORA_BASE_URL` 也要同步修改并重启后端** |
| `docker compose ps` 中 app 长时间 `unhealthy` | 多为 `.env` 缺失或 `JWT_SECRET`/`SYSTEM_AES_KEY` 为空。执行 `node scripts/gen-env.js` 补齐密钥后 `docker compose up -d`；再看 `docker compose logs -f app` 定位。首次启动健康检查有 60s `start_period`，请等待 1~2 分钟 |
| `setup.js` 提示管理员账号已存在 / 口令不匹配 | 该控制台此前已用其他口令初始化过。把现有口令写入 `weknora/.env` 的 `WEKNORA_ADMIN_PASSWORD`（或用 `--password` 传入）后重试；口令遗忘需在 WeKnora 控制台或数据库中重置 |
| 本系统页面提示「部分工作空间无法访问」 | 状态接口 `tenants` 中某个 Key 不可达或不属于该空间。核对 `WEKNORA_EXTRA_API_KEYS` 是否为对应工作空间创建的 Key，**修改后必须重启本系统后端** |
| 检索有结果，问答返回 `400 WEKNORA_MULTI_TENANT` | 勾选的知识库跨越了多个工作空间。问答会话是空间级资源，请只勾选同一空间的知识库（跨空间请使用「规范检索」） |
| 配置答复约束提示词返回 `503 WEKNORA_NO_QA_MODEL` | 该工作空间没有可用的 KnowledgeQA 问答模型。在控制台「设置 → 模型管理」为该空间创建问答模型，或重跑 `setup.js` |
| 文档上传后一直处于解析中 | 检查 `docker compose ps` 中 docreader 是否 healthy（`docker compose logs -f docreader`）；确认文档未超过 `MAX_FILE_SIZE_MB`（默认 50MB） |
| `pg_dump` 报角色/库不存在 | 备份命令中的用户名与库名取自 `weknora/.env` 的 `DB_USER` / `DB_NAME`（默认 `postgres` / `WeKnora`），请按实际值替换 |
| 换 ParadeDB 镜像后 postgres 反复重启/崩溃 | 扩展 catalog 还停在旧版本（`pg_search` 与镜像版本不一致）。按 [6.2](#62-从-v082paradedb-0226升级到-v083paradedb-02511) 执行 `ALTER EXTENSION pg_search UPDATE;`，再用 `SELECT * FROM paradedb.version_info();` 确认已是 0.25.11 |
| 本系统检索/问答一直超时 | 确认 app 容器健康、`WEKNORA_BASE_URL` 端口与 `APP_PORT` 一致；云端模型 API（DeepSeek/智谱）Key 失效时问答会失败，可在控制台「设置 → 模型管理」核对并更新 |

> 修改 `weknora/.env` 后需 `docker compose up -d` 重建受影响容器；修改 `backend/.env` 的 `WEKNORA_*` 后需**重启本系统后端**（`node server.js`，无热重载）。

最后更新：2026-10-29
