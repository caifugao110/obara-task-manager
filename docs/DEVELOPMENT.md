# 开发者指南

面向要在这个仓库里改代码的人：怎么把环境跑起来、代码该写在哪、新增功能要动哪些文件、提交前要过什么检查。

- 系统怎么分层、模块在哪：看 [README 项目结构](../README.md#项目结构) 与 [核心模块说明](../README.md#核心模块说明)
- 某个接口的字段和错误码：看 [API 文档](API.md)
- 部署与排障：看 [Windows 部署指南](../DEPLOYMENT.md)

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
| 某个接口的校验/权限/组装响应 | `backend/routes/<模块>.js` |
| 读写 SQLite | 只允许 `backend/db.js`、`backend/taskStore.js`；路由里**不要**直接 `prepare()` |
| 无状态工具（解析/导出/加锁） | `backend/utils/*.js` |
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
// 2. 带坐标了吗？（designerId / month / year 三者缺一不可）
getCurrentSocket()?.emit('task_updated', {
  designerId,
  month,
  year
});
```

- 漏 emit → 其他客户端永远看不到变更（Dashboard 也没有轮询兜底）。
- 漏坐标 → 服务端 `broadcastTaskRefresh()` 只能广播空信号，其他客户端整月重拉；只读用户还会叠加 3 秒合并节流。
- **不要重复 emit**：如果写入方已经在弹窗里 emit 了，宿主页面就别再发一次，否则别人会收到两条信号。
- 坐标要取**目标数据的真实归属**（比如选中日期的年月），不是当前视图的月份。

广播内容由服务端自己读库组装（`getSheet()`），前端传的 payload 只用于定位，不会转发给其他人——所以别指望通过 emit 传自定义数据。

涉及并发编辑的功能，还要考虑是否需要加锁：单元格编辑锁在 `server.js` 内存 Map，状态追踪行锁在 `utils/statusTrackingLocks.js`，焊枪台账表锁在 `utils/gunTableLocks.js`。三者都不落库，后端重启即全解锁。

### 4.4 新增一个系统设置项

1. 字段加到 `backend/db.js` 的 `getInitialDb().settings.system`（或对应开关集合）与 `applySettingsDefaults()` 兜底。
2. `backend/routes/system.js`（或 `settings.js`）的 `GET/PUT` 校验（Joi schema）里放行该字段。
3. `frontend/src/context/SystemSettingsContext.tsx` 的 `SystemSettingsData` 加类型与 `defaultSettings` 默认值。
4. `SystemSettings.tsx` 加 UI 控件。
5. `README.md` 的「数据存储」表 + `DEPLOYMENT.md` 的数据集合表补一行。

> 注意区分两个 `settings`：`settings.system` 是**系统级配置**（多设备登录、工时规则、配色等），`settings.<页面名>` 是**页面访问开关**三元组。别放错地方。

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
| 数据结构、模块划分 | `README.md` 数据存储 / 项目结构 |

## 6. 提交前的检查

```bat
cd frontend && npx tsc --noEmit      :: 类型检查
cd frontend && npm run lint          :: ESLint（--max-warnings 0）
npm test                             :: 后端测试：单元 + 三段冒烟
npm run build                        :: 前端构建
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

系统版本不是手工写的：`GET /api/system/version` 每次请求动态计算（30 秒 TTL 缓存），取 **最后一次 Git 提交的日期** + **当日提交计数** 组成 `YY-MM-DD[-VN]`，所以 `git pull` 后不重启也能反映新 HEAD。因此**本地未提交的改动不会影响版本号**——版本号跟随的是提交历史。完整规则见 [DEPLOYMENT.md 版本检查](../DEPLOYMENT.md#版本检查)。

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
| 晚打开的页面锁状态是空的 | 没监听快照事件/没调 `getSnapshot()` | 见 `socketClient.ts` |
| 后端一启动就退出 | `JWT_SECRET` 为空 | 填 `backend/.env` |
| 端口被占用 | 上次进程没退 | `stop.bat`，或按 `DEPLOYMENT.md` 手动释放 |
| 鉴权路径忽然变慢 | 热路径里用了 `readDb()` 深拷贝整库 | 换窄读接口 |
| 状态追踪的数量/纳期/已发图和表格对不上 | 大日程解析结果按 mtime + `PRODUCTION_SCHEDULE_CACHE_MS`（默认 5 分钟）缓存；共享文件读不到时接口静默回退 PDF | 等缓存过期或重启后端确认最新值；日志搜 `[productionSchedule]` 判断是「读取失败」还是「仕样号未命中」 |
| 同步后营业担当/组长是空的 | 营业担当只能来自 `SPEC_SHARE_PATH` 下的仕样书 PDF：没有对应仕样书、解析结果与表单标签混淆、或该担当不在「组长规则」里都会留空（不猜） | 看同步预览里的 `salesLookup`（`missingPdf` / `noSalesPerson`）；日志搜 `[specInfoLookup]`；组长缺失就去「状态跟踪 → 组长规则」补成员 |
| Node 版本报错 | 低于 22 | 升到 22 LTS |
| 鼠标点过任务行、再按任意键就冒出一圈黑框 | dnd-kit 的行是 `tabIndex=0` 可聚焦元素，按键后浏览器按 `:focus-visible` 画 UA 默认轮廓（Tailwind preflight 不重置） | 可聚焦行/单元格的 className 显式加 `focus:outline-none focus-visible:outline-none`，选中态用自绘边框表达 |
| 新增的全局 `keydown` 监听把弹窗的 Esc/快捷键抢了 | 主页面有 5 处独立 window 级 Esc 监听、互不 `stopPropagation` | 新语义先判所有弹窗状态并 `return`，按「弹窗 → 页面选中」的顺序串联 |

## 相关文档

| 文档 | 内容 |
|---|---|
| [使用手册](USER-GUIDE.md) | 面向使用者的操作说明、判定规则与提示语速查 |
| [API 文档](API.md) | REST 接口与 Socket.IO 事件全量参考 |
| [README](../README.md) | 功能、权限、数据结构、项目结构、命令 |
| [Windows 部署指南](../DEPLOYMENT.md) | 部署、备份、排障 |
| [WeKnora 部署指南](../weknora/README.md) | 知识库服务的 Docker 部署与运维 |
