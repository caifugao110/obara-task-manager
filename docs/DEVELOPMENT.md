# 开发者指南

面向要在这个仓库里改代码的人：怎么把环境跑起来、代码该写在哪、新增功能要动哪些文件、提交前要过什么检查。

- 系统怎么分层、模块在哪：看 [README 项目结构](../README.md#项目结构) 与 [核心模块说明](../README.md#核心模块说明)
- 某个接口的字段和错误码：看 [API 文档](API.md)
- 部署与排障：看 [Windows 部署指南](DEPLOYMENT.md)

---

## 1. 环境准备

| 依赖 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | **22+** | `better-sqlite3@13`、`joi@18`、`pdf-parse@2.4` 在更低版本无法运行；`start.bat` 会强制校验 |
| npm | 10+ | |
| Git | 任意近期版本 | |
| VS C++ 生成工具 | 非必需 | 仓库 `.npmrc` 设了 `ignore-scripts=true` 且 `vendor/xlsx-0.20.3.tgz` 随仓库分发，正常情况无需编译原生模块 |

```bat
git clone https://gitee.com/caifugao110/obara-task-manager.git
cd obara-task-manager
npm run install:all
copy backend\.env.example backend\.env
```

`backend/.env` 里**必须**填 `JWT_SECRET`，留空时进程直接拒绝启动（`backend/config/security.js` 强制校验）。`DEFAULT_ADMIN_PASSWORD` 可以留空，首次启动会随机生成并只在控制台打印一次。

## 2. 启动与日常开发

```bat
npm run dev            :: 前后端一起起（concurrently）
npm run dev:backend    :: 只起后端 :5000（nodemon 热重启，忽略 tests/）
npm run dev:frontend   :: 只起前端 :5173（Vite）
```

- 前端 `:5173` 通过 `vite.config.ts` 把 `/api` 与 `/socket.io` 代理到 `127.0.0.1:5000`，并带 `xfwd: true` 把真实客户端 IP 传给后端。**不要**在前端代码里写死后端地址。
- Vite 的 `watch.usePolling = true`：本项目可能部署在网络驱动器上，`fs.watch` 会抛 `errno -4094` 直接杀死 dev server。代价是文件变更最多延迟 1 秒生效。
- 后端跑 `nodemon --ignore tests`，改 `backend/**` 自动重启；改 `backend/.env` 需要手动重启。

生产形态下前端是静态产物：`npm run build` → `npm run start:frontend`（`vite preview`）。后端**不托管**前端资源。

## 3. 代码该写在哪

| 要改的东西 | 位置 |
|------|------|
| 中间件装配、Socket 事件处理 | `backend/server.js`（业务逻辑不写这里） |
| Socket 广播出口、页面房间、带原因断连 | `backend/utils/socketRooms.js`；业务广播一律 `emitToPage()`，不要 `io.emit` |
| 共享路径健康探测（状态监测页用） | `backend/utils/shareStatus.js`；探测必须廉价、带硬时限，不要在路由里直接 `stat` UNC 路径 |
| 某个接口的校验/权限/组装响应 | `backend/routes/<模块>.js` |
| 读写 SQLite | 只允许 `backend/db.js`、`backend/taskStore.js`；路由里**不要**直接 `prepare()` |
| 无状态工具（解析/导出/加锁） | `backend/utils/*.js` |
| 运行状态采集与断开判定（心跳/流量/事件） | `backend/utils/systemMonitor.js`（自建 `monitor_*` 表），接口在 `backend/routes/monitor.js` |
| 日志文件占用统计与轮转 | `backend/utils/logFiles.js`（后端自动截断与接口共用）；启动前轮转在 `tools/trim-logs.js`，二者共用 `trimOneFile()` |
| 可能阻塞的共享盘 I/O | `backend/utils/productionScheduleWorker.js`（子进程），不要直接在主进程 `fs.stat` / `readFile` UNC 路径 |
| 全局状态（登录态、系统设置） | `frontend/src/context/*.tsx` |
| HTTP 请求 | 一律 `services/api.ts` 导出的 `axiosInstance` + 路径字符串，不新增 `xxxAPI` 分组封装 |
| Socket 连接 | 一律 `utils/socketClient.ts` 的 `acquireSocket()`，不自己 `io()` |
| 页面 | `frontend/src/pages/*.tsx`；主页面因体量大已拆成 `pages/Dashboard/` 目录 |

## 4. 五类常见改动的 checklist

### 4.1 新增一个页面

1. `frontend/src/pages/NewPage.tsx` 写组件。
2. `App.tsx` 加 `const NewPage = lazy(() => import('./pages/NewPage'))` 和 `<Route>`；包在 `<ProtectedRoute>` 里，需要角色限制就加 `adminOnly` / `superAdminOnly`。
3. `utils/documentTitle.ts` 的 `PAGE_TITLES` 补一行 `'/new-path': 'OTM-<页面功能>'`，否则标签页回落到系统全称。
4. 需要「页面访问开关」时：`backend/db.js` 的 `applySettingsDefaults()` 补 `settings.<key>` 默认三元组，路由挂 `accessSettingsMiddleware('<key>')`，页面内按 `enabled/allowAdmins/allowViewers` 自己判显隐（现有页面都是各自实现，见 `GunLedger.tsx` 的 `canAccess`）。
5. `README.md` 的「主要页面」表补一行；`docs/API.md` 补新接口。

### 4.2 新增一个 API 接口

1. 在对应 `backend/routes/*.js` 里加路由，挂上需要的中间件：
   ```js
   router.post('/something', adminMiddleware, asyncHandler(async (req, res) => {
     // 1. Joi 校验  2. 读数据（窄读接口优先）  3. 写库  4. 返回
   }));
   ```
2. 权限选对层级：登录即可 → `authMiddleware`（多数路由文件已在 `router.use()` 统一挂了）；管理员 → `adminMiddleware`；仅超管 → `superAdminMiddleware`；页面开关 → `accessSettingsMiddleware('<key>')`。
3. 读数据优先用窄读接口：`readSettings()` / `readGunLedger()` / `readDesigners()` / `findUserById()`。**只有确实需要多个集合时才用 `readDb()`**——它深拷贝整个缓存，是热路径上最贵的调用。
4. 写数据走 `writeDb()`（组装完整快照）或 `taskStore` 的方法，不要直接改 `_cache`。
5. `docs/API.md` 补接口文档（请求/响应/权限/错误码），这是硬要求，不是可选项。

### 4.3 新增一个写操作（最容易出错）

**HTTP 写接口在本项目里从不广播**，实时刷新完全靠前端 `emit`。写完库必须检查两件事：

```ts
// 1. 有没有 emit？
// 2. 带坐标了吗？
//    单表写入：designerId / month / year 三者缺一不可
getCurrentSocket()?.emit('task_updated', {
  designerId,
  month,
  year
});

//    一次改动多张表（跨设计员/跨月移动、复制）：用 targets 一次发全，最多 8 张
getCurrentSocket()?.emit('task_updated', {
  targets: [
    { designerId: sourceId, month: sourceMonth, year: sourceYear },
    { designerId: targetId, month: targetMonth, year: targetYear }
  ]
});
```

- 漏 emit → 其他客户端永远看不到变更（Dashboard 也没有轮询兜底）。
- 漏坐标 → 服务端 `broadcastTaskRefresh()` 只能广播空信号，其他客户端整月重拉；只读用户还会叠加 3 秒合并节流。
- 少发一张表 → 另一端的目标行迟迟不出现（服务端按你给的坐标逐张 `getSheet()`，没给的表不会推送）。
- **不要重复 emit**：如果写入方已经在弹窗里 emit 了，宿主页面就别再发一次，否则别人会收到两条信号。
- 坐标要取**目标数据的真实归属**（比如选中日期的年月），不是当前视图的月份；接收侧只合并与当前视图同月份的表，本端回显也一样——跨月移动时把别月的表并进来会串月。

广播内容由服务端自己读库组装（`getSheet()`），前端传的 payload 只用于定位，不会转发给其他人——所以别指望通过 emit 传自定义数据。

**服务端广播出口统一走 `utils/socketRooms.js`**：`emitToPage(io, 'gunLedger' | 'statusTracking', 事件, 载荷)` 只发给具备该页面权限的 `page:*` 房间；需要排除发起者时用 `emitToPageExcept()`。不要写 `io.emit()` / `socket.broadcast.emit()` 下发业务数据——那会把台账、状态追踪的完整内容发给没有该页面权限的连接，HTTP 层的 `accessSettingsMiddleware` 就形同虚设（2026-11 已修过一次）。断连场景用 `disconnectUserSockets()` / `disconnectSessionSockets()`，它们会先发 `session_invalidated`（带原因与错误码）再断开，直接 `socket.disconnect(true)` 会让前端只看到一次莫名其妙的断线。

涉及并发编辑的功能，还要考虑是否需要加锁：单元格编辑锁在 `server.js` 内存 Map，状态追踪行锁在 `utils/statusTrackingLocks.js`，焊枪台账表锁在 `utils/gunTableLocks.js`。三者都不落库，后端重启即全解锁。

### 4.4 新增一个系统设置项

1. 字段加到 `backend/db.js` 的 `getInitialDb().settings.system`（或对应开关集合）与 `applySettingsDefaults()` 兜底。
2. `backend/routes/system.js`（或 `settings.js`）的 `GET/PUT` 校验（Joi schema）里放行该字段。
3. `frontend/src/context/SystemSettingsContext.tsx` 的 `SystemSettingsData` 加类型与 `defaultSettings` 默认值。
4. `SystemSettings.tsx` 加 UI 控件。
5. `README.md` 的「数据存储」表 + `DEPLOYMENT.md` 的数据集合表补一行。

> 注意区分两个 `settings`：`settings.system` 是**系统级配置**（多设备登录、工时规则、配色等），`settings.<页面名>` 是**页面访问开关**三元组。别放错地方。

**带数值阈值的配置要兜两遍**：`db.js` 的 `applySettingsDefaults()` 管落库前的回填，`routes/system.js` 的 `normalizeSystemSettings()` 管接口读取时的归一化。两处都要做范围校验，否则一个 `0` 或空串会让运行期逻辑异常——例如磁盘日志的 `logMaxSizeMb` 若被当成 0，「超过阈值就截断」会退化成「每轮检查都把日志清空」。前端 `SystemSettingsContext` 也要按同一范围回退默认值，三处口径必须一致。

### 4.5 新增一个导出

导出分三类，各有现成工具：任务导出 `utils/taskExportWorkbook.js`、焊枪台账导出 `utils/gunLedgerExport.js`、工时报表 `utils/exportWorkbook.js`，多文件打包用 `utils/simpleZip.js`。

导出接口的审计日志会被 `shouldAudit()` 的「敏感读」规则捕获（`GET` 导出也记），不需要额外埋点。

---

## 5. 编码约定

### 后端

- **CommonJS**（`require`），不用 ESM。
- 异步路由一律用 `asyncHandler` 包裹，异常交给统一错误处理中间件；不要在路由里手写 `try/catch` 吞错。
- 参数校验用 **Joi**，校验失败返回 400 与具体字段信息。
- 错误响应统一 `{ message, code? }`；`WeKnoraError` 这类领域错误按 `status`/`code` 映射（见 `routes/designStandards.js` 的 `handleError`）。
- 注释写**为什么**，不写**是什么**。本仓库的注释密度偏高，且大量记录「为什么不能改成另一种写法」——这类信息请保留，改代码时一并更新。
- `server.js` 顶部的 `uncaughtException` / `unhandledRejection` 兜底监听是**进程保命线**，不要删：Node 22 遇到未处理的 Promise 拒绝会直接退出进程，端口 5000 静默消失，日志里只剩 nodemon 一句 `app crashed`。兜底会把堆栈写入 `logs/backend-crash.log` 并继续运行（`CRASH_EXIT_ON_UNCAUGHT=1` 才退出）。
- `server.js` 的 `exit` / `beforeExit` 钩子（写 `logs/backend-exit.log`）是**退出取证**，也不要删：它记录退出码、`reason`、内存与活跃句柄数。它的价值在于「没有记录」本身就是结论——被 `TerminateProcess` 强杀不触发 `exit` 事件，据此可把「自己退的」和「被外部干掉的」分开。钩子内部全部包了 `try/catch`，因为 `stdout/stderr` 管道断开时 `console.error` 会抛 `EPIPE`，在异常处理器里再抛会让 Node 静默退出、堆栈彻底丢失。
- 老式回调 socket / 流在 `destroy()` 之后仍可能补发 `'error'`（`ECONNRESET`、`ENOTFOUND`），此时若无监听者会升级成未捕获异常击穿进程。这类对象要保留一个空的 `'error'` 监听，参考 `utils/uncShare.js` 的 `probeHost`。
- **共享盘调用一律走子进程**：SMB 会话失效时 UNC 调用会在 Windows 内核里挂住不返回，主进程直接 `await fs.promises.*` 会把 libuv 线程池（默认 4 线程）占满，表现为「进程活着、端口在监听、所有 HTTP 超时」。`utils/productionSchedule.js` 的做法是 fork `productionScheduleWorker.js`、父进程只等 IPC 并带硬超时；新增共享盘读取时照抄这个模式，并给熔断器计一次失败（`recordFailure`），不要在路由层直接读 UNC。
- **启动阶段的慢操作不要同步做**：`server.listen` 之后的回调里如果执行同步的 `net use` / 大文件读取，端口已经在监听，但事件循环被整段占住，健康探针 5 秒超时会把后端判成假死。共享盘预热（`productionSchedule.ensureShareReady()`）因此改成 `async` 并在 `.then()` 里打印结果，不阻塞后续调度器与日志截断的启动。
- **后台定时任务用「巡检式」而不是一次性计时器**：`systemMonitor` 的自动清理（每 10 分钟检查是否到 6 小时周期）与 `logFiles` 的截断检查都是这个结构——一次性 `setTimeout(duration)` 会被重启清零，服务频繁重启时就永远等不到执行。新增周期性维护时照此实现，并把「上次执行时间」持久化。
- **不要删除/绕过三层防护**：子进程隔离（`productionScheduleWorker.js`）、熔断（`BREAKER_*`）、外部假死探针（`backend-health-probe.bat`）分别对应「单次挂死」「持续故障」「已经卡死」三种情况，缺一层就会回到 2026-11 的人工重启。改这块时同步 `TOOLS.md` 与 `DEPLOYMENT.md` 的判读说明。

### 前端

- 函数组件 + Hooks，TypeScript。类型放 `src/types/index.ts` 或页面目录内的 `types.ts`。
- 请求只走 `axiosInstance`；它已统一处理「后端不可达」「账号禁用」「会话失效」三类情况，页面不要重复写这些判断。
- 路由切换后需要刷新数据的，用 `socket` 事件 + `getSnapshot()` 补初始状态，不要新起轮询。
- 页面体量控制：主页面已因过大拆成 `pages/Dashboard/` 目录（容器 + `components/` + `hooks/` + 纯函数 `utils.ts`）。新页面接近千行时照此拆分。

### 注释与文档同步

改下列内容时必须同步改文档，否则视为未完成：

| 改动 | 要同步的文档 |
|---|---|
| 接口增删改 | `docs/API.md` |
| Socket 事件增减 | `docs/API.md` 的 Socket.IO 章节 |
| 页面增删、功能变化 | `README.md`；**用户可感知的操作方式/提示语变化同时同步 `docs/USER-GUIDE.md`** |
| 环境变量增删 | `README.md`、`DEPLOYMENT.md`、`docs/API.md`、`backend/.env.example` |
| 权限开关、角色规则 | `README.md` 权限模型 + `docs/API.md` 权限速查 |
| 部署方式、启动脚本 | `DEPLOYMENT.md` |
| 守护/自愈机制、探针、日志判读 | `README.md`（脚本与维护建议）、`docs/DEPLOYMENT.md`（排障）、`docs/TOOLS.md`（日志怎么读、状态监测怎么判读） |
| 监测采集口径、断开原因判定、日志截断策略 | `README.md`（状态监测 / 日志文件管理）、`docs/API.md`（`monitor` 与 `log-files` 接口）、`docs/USER-GUIDE.md`（9.4 / 9.7）、`docs/TOOLS.md`（第五、六节） |
| 数据结构、模块划分 | `README.md` 数据存储 / 项目结构 |
| 文档增删或读者定位变化 | `docs/README.md` 的文档清单 + `README.md` 的「文档导航」表（两处都要） |

> 上面这些「靠人记」的同步项里，有五类已经自动化：链接与锚点、接口清单、环境变量、页面路由、引用路径。提交前跑 `node tools/docs-check.js`（只查一项用 `node tools/docs-check.js api`），它会以非 0 退出码报告不一致；**它查不出的**是字段含义、示例值、判定规则这类语义错误，仍需按上表人工确认。

## 6. 提交前的检查

```bat
cd frontend && npx tsc --noEmit      :: 类型检查
cd frontend && npm run lint          :: ESLint（--max-warnings 0）
npm test                             :: 后端测试：单元 + 三段冒烟
npm run build                        :: 前端构建
node tools/docs-check.js             :: 文档与代码一致性（链接/接口/环境变量/页面清单）
```

`npm test` 的细节：

| 命令 | 内容 |
|---|---|
| `npm test`（根目录） | 等同 `cd backend && npm test`，调 `tests/run-all.js` |
| `npm run test:unit`（`backend/` 下） | 纯函数单元测试（`node:test`），不依赖数据库与外网 |
| `npm run test:smoke`（`backend/` 下） | 关系表存储冒烟，**会写数据**，须先设 `SMOKE_DB_PATH` 指向副本；根目录没有同名脚本 |

`run-all.js` 用 `VACUUM INTO` 生成生产库的只读快照，在副本上依次跑三段冒烟（关系表存储 / 主任务改色联动 / 枪名搜索），结束清理 `tests/.tmp/`，任一段失败返回非 0。

> 冒烟测试会写入数据，**绝不要把 `SMOKE_DB_PATH` 指向 `backend/data.db`**。

ESLint 的规则集是按「当前代码库能过」裁剪的（见 `frontend/.eslintrc.cjs` 注释）：`no-explicit-any`、`exhaustive-deps` 属于既有技术债被显式关闭。**不要为了过 lint 去放宽规则**，也不要顺手大规模修技术债——那是独立工程，会污染 diff。

## 7. 提交与发版

### 提交信息

Conventional Commits + 中文描述：

```
feat(tasks): 新增枪名拖拽新建主任务功能
fix(backend): 修复跨域拦截、权限漏洞及 PDF 解析资源耗尽问题
refactor(gunLedger): 统一焊枪名编号校验逻辑并更新文档
docs: 更新部署、README 和 API 文档，补充功能说明
```

`type` 取值参考现有历史：`feat` / `fix` / `refactor` / `perf` / `style` / `build` / `docs`。`scope` 用模块名（`tasks`、`gunLedger`、`backend`、`frontend`、页面名），可省略。

正文写清**改了什么、为什么改**；涉及行为变化时补一句影响面。

### 版本号

系统版本不是手工写的：`GET /api/system/version` 每次请求动态计算（30 秒 TTL 缓存），取 **最后一次 Git 提交的日期** + **当日提交计数** 组成 `YY-MM-DD[-VN]`，所以 `git pull` 后不重启也能反映新 HEAD。因此**本地未提交的改动不会影响版本号**——版本号跟随的是提交历史。完整规则见 [DEPLOYMENT.md 版本检查](DEPLOYMENT.md#版本检查)。

控制台 EXE 的版本由 MSBuild 在构建时按日期生成到 `control/Properties/GeneratedVersion.cs`，这个文件**不要手工编辑**。

### CI

`.github/workflows/build-and-deploy.yml` 只在 **GitHub 仓库**触发（Gitee 不跑 Actions）：

1. 构建控制台 EXE 并发布 Release；
2. 把 `README.md` 与 `docs/` 部署到 GitHub Pages。

推送前本地跑一遍第 6 节的检查，CI 只做构建不做测试。

---

## 8. 已知坑位速查

| 现象 | 原因 | 处理 |
|---|---|---|
| 改了前端文件，页面不变 | Vite 轮询监听最多延迟 1 秒 | 等一下或手动刷新 |
| 改完 `.env` 没生效 | 后端只在启动时读环境变量 | 重启后端 |
| 别人看不到我的修改 | 写路径没 emit `task_updated` | 见 4.3 |
| 别人刷新很慢、整月重拉 | emit 没带 `designerId/month/year` | 见 4.3 |
| 跨设计员移动后，对端要等下一次刷新才出现目标行 | 只广播了源表坐标，没带目标表 | 用 `targets` 一次发全受影响的表，见 4.3 |
| 跨月移动后对端串月 / 当前视图冒出别月任务 | 把非当前视图月份的 `sheet` 也 `upsertSheet` 了 | 回显与接收侧都只并入 `month/year` 与当前视图一致的表 |
| 后端莫名消失、端口 5000 没了、日志无堆栈 | 未捕获异常击穿进程（Node 22 对未处理 Promise 拒绝直接退出）；或进程被外部强杀 | 看 `logs/backend-crash.log`；没有崩溃堆栈就看 `logs/backend-exit.log`——有记录是自己退的，没记录是被 `TerminateProcess` 强杀；不要删 `server.js` 顶部兜底与 `exit` 钩子，见「后端」编码约定 |
| 端口 5000 还在监听，但所有请求一直转圈 / 超时，进程没退出 | 共享盘 SMB 会话失效，UNC 调用挂死在内核，占满 libuv 线程池（后端「活着但不响应」） | 看 `logs/backend-watchdog.log` 的 `[probe]` 行：连续 `health probe failed` 后应有 `[FATAL] ... killing`；共享盘侧用 `GET /api/system/schedule-probe` 看错误码。不要在主进程直接读 UNC，新增逻辑走 `productionScheduleWorker.js` + 熔断，见「后端」编码约定 |
| 没有台账 / 状态追踪权限的账号，也能收到实时广播与锁提示 | 服务端用了 `io.emit` / `socket.broadcast.emit`，绕过页面房间 | 改用 `utils/socketRooms.js` 的 `emitToPage` / `emitToPageExcept`；房间成员由 `syncSocketRooms` 按最新权限重算 |
| 账号被禁用、被顶号、令牌过期后，页面仍能收到实时数据 | 只在建连时校验了 JWT，连接挂着就一直收广播 | 业务事件前调 `requireSocketAuth()`（失败先发 `session_invalidated` 再断开）；60 秒巡检兜底；前端收到该事件必须清理登录态 |
| 晚打开的页面锁状态是空的 | 没监听快照事件/没调 `getSnapshot()` | 见 `socketClient.ts` |
| 后端一启动就退出 | `JWT_SECRET` 为空 | 填 `backend/.env` |
| 端口被占用 | 上次进程没退 | `stop.bat`，或按 `DEPLOYMENT.md` 手动释放 |
| 鉴权路径忽然变慢 | 热路径里用了 `readDb()` 深拷贝整库 | 换窄读接口 |
| 状态追踪的数量/纳期/已发图和表格对不上 | 大日程解析结果按 mtime + `PRODUCTION_SCHEDULE_CACHE_MS`（默认 5 分钟）缓存；共享文件读不到时接口降级为只用仕样书并返回 `scheduleUnavailable: true`（页面提示「生产大日程共享暂不可用，本次数量/纳期取自仕样书」） | 等缓存过期或重启后端确认最新值；日志搜 `[productionSchedule]` 判断是「读取失败」还是「仕样号未命中」；共享服务器整体不通时日志会出现「主机整体不可达，本次跳过共享访问」 |
| 同步后营业担当/组长是空的 | 营业担当只能来自 `SPEC_SHARE_PATH` 下的仕样书 PDF：没有对应仕样书、解析结果与表单标签混淆、或该担当不在「组长规则」里都会留空（不猜） | 看同步预览里的 `salesLookup`（`missingPdf` / `noSalesPerson`）；日志搜 `[specInfoLookup]`；组长缺失就去「状态跟踪 → 组长规则」补成员 |
| Node 版本报错 | 低于 22 | 升到 22 LTS |
| 鼠标点过任务行、再按任意键就冒出一圈黑框 | dnd-kit 的行是 `tabIndex=0` 可聚焦元素，按键后浏览器按 `:focus-visible` 画 UA 默认轮廓（Tailwind preflight 不重置） | 可聚焦行/单元格的 className 显式加 `focus:outline-none focus-visible:outline-none`，选中态用自绘边框表达 |
| 新增的全局 `keydown` 监听把弹窗的 Esc/快捷键抢了 | 主页面有 5 处独立 window 级 Esc 监听、互不 `stopPropagation` | 新语义先判所有弹窗状态并 `return`，按「弹窗 → 页面选中」的顺序串联 |
| `Space`×2 既想新增/编辑任务、又保留快速取号，两个监听互相抢键 | 一个键位多义，拆成两个监听时两次按键会被各判一次 | 收口在同一个 window `keydown`：弹窗打开 → 不接管空格；`quickSpaceActionRef` 有值（选中加号 / 唯一选中主任务）→ 新增/编辑；否则才取号 |
| 弹窗加上拖动后，拖起来一顿一顿的 | 位移走 React state 时每帧 `setState`，看板/台账这种超大页面会整页重渲染 | 统一用 `hooks/useModalDrag.ts`：位移直写 DOM `transform`，state 只记 `dragging`（切光标），打开/切换目标时复位 |
| 台账取号一直 `409 取号冲突`，或同一张表里「序号 4 的行挂着 0201 的编号」 | 历史数据序号与名字里的编号错位（旧版占位行按任意序号提升），`serialNumber` 与编号不再一一对应，取号算出的「下一个编号」与存量行撞名 | 后端已改为**序号 ↔ 编号强绑定**：写入、取号、改规则、读取时都会把序号压实为 `1..N` 并按规则校正名字里的编号（前缀/后缀保留，校正后若会与其它行重名则保留原名）。**不要再加「编号不符就 400 拒绝整表保存」的校验**——那会让一张已经错位的表永远存不进去。纯函数在 `backend/routes/gunLedger.js` 的 `enforceSerialNumberBinding`，单测见 `backend/tests/unit/gunLedgerSerial.test.js` |
| 日志文件清不掉、提示 `EBUSY`，或 `logs/` 涨到几百 MB | `backend.log` / `frontend.log` 等被隐藏 cmd 窗口的重定向句柄占用，Windows 上删除与写入都会失败；node/nodemon 自身不会截断 | 用「系统设置 → 日志文件管理」或 `node tools/trim-logs.js`（就地截断，不删文件），被占用的文件由 `start.bat` 在下次启动前轮转。不要为了清空间去删 `.pid` / `.token` / `backend-health-probe.gen` |
| 状态监测里冒出一串「无证据的断开」，同时页面加载很慢、健康探针报超时 | 启动阶段的同步操作（如 `net use` 共享预热、同步读大文件）把事件循环占住，端口在监听但请求排队，探针 5 秒超时判假死 | 启动回调里的慢操作一律异步化（`ensureShareReady()` 已是 `async`）。开发期 nodemon 重启造成的断开可在监测页用「排除代码热重载」开关剔除，不要为此放宽判定口径 |

## 相关文档

| 文档 | 内容 |
|---|---|
| [文档中心](README.md) | 文档索引、按角色的阅读路径、一致性自检与编写约定 |
| [使用手册](USER-GUIDE.md) | 面向使用者的操作说明、判定规则与提示语速查 |
| [API 文档](API.md) | REST 接口与 Socket.IO 事件全量参考 |
| [README](../README.md) | 功能、权限、数据结构、项目结构、命令 |
| [Windows 部署指南](DEPLOYMENT.md) | 部署、备份、排障 |
| [运维工具说明](TOOLS.md) | 运维/守护脚本的分工，`tools/backend-report.bat` 断开分析报告，以及看门狗 / 假死探针日志的判读 |
| [WeKnora 部署指南](../weknora/README.md) | 知识库服务的 Docker 部署与运维 |
| [变更记录](../CHANGELOG.md) | 按日期汇总的提交历史（由 `git log` 生成，不手工维护） |
