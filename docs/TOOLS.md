# 运维工具说明

> 其他文档：[文档中心](README.md) · [README](../README.md)（功能与使用） · [使用手册](USER-GUIDE.md) · [开发者指南](DEVELOPMENT.md) · [API 文档](API.md) · [部署指南](DEPLOYMENT.md)

本文档覆盖三类东西：仓库根目录 `tools/` 下**启动项目不需要**的运维诊断工具，根目录那些「不是给人手动运行」的守护脚本，以及两套现成的取证手段——页面化的**状态监测**（第五节）与**日志文件占用/轮转**（第六节）。日常启动/停止只需要 `start.bat` / `stop.bat`。

> 根目录的 `backend-watchdog.bat` 与 `backend-health-probe.bat` 不是手动工具，而是 `start.bat` 启动的运行时守护：前者负责「进程退出了就拉起来」，后者负责「进程还在但不再响应」。它们的日志判读见本文第三节。

---

## 一、工具总览

先分清「谁来启动」——**手动运行常驻守护会造成重复探测或互相抢进程**，这是本节最重要的信息。

| 脚本 | 谁启动 | 干什么 | 什么时候需要管 |
|------|--------|--------|---------------|
| `start.bat` | 人工双击 | 检查 Node 版本 → 释放 5000/5173 端口 → 按需装依赖 → 隐藏窗口启动前后端（后端经看门狗托管） | 日常启动 |
| `start-hidden.vbs` | `start.bat` 自己调用 | 把 `start.bat --hidden` 以无窗口方式拉起，输出重定向到 `logs/startup.log` / `logs/startup.err.log` | 一般不用管；隐藏模式下排查启动失败看这两个日志 |
| `start-process-hidden.vbs` | `start.bat` | 通用的「无窗口 + 输出重定向 + 写 PID」启动器，后端与前端各用一次 | 一般不用管；`logs/*.pid` 由它写 |
| `backend-watchdog.bat` | `start.bat` | 后端守护循环：进程结束就重新拉起（连续崩溃按 10→30→60 秒退避），每次拉起同时启动假死探针 | **不要手动跑**；调参用 `OBARA_RESTART_DELAY`、换启动命令用 `OBARA_BACKEND_CMD` |
| `backend-health-probe.bat` | `backend-watchdog.bat` | 每 30 秒探一次 HTTP，连续 3 次无任何响应就杀掉后端进程树，交给看门狗重启 | **不要手动跑**（会多一个探测器，日志重复）；调参见第三节 |
| `stop.bat` | 人工双击 | 先调用离线备份接口备份数据库，再按端口停进程树、清扫残留、回检端口；需要时自动提权重启自身 | 停止服务；**停止前会自动备份**，所以不要在维护窗口外随手执行 |
| `tools/backend-report.bat` | 人工双击 | 交叉核对看门狗日志、退出日志、Windows 事件日志与实时采样，出「断没断、几点断、为什么断」的结论 | 怀疑后端断过 / 假死过时（见第二节） |
| `tools/trim-logs.js` | `start.bat`（启动前自动调用）/ 人工 | 按系统设置里的阈值轮转 `logs/` 下超限的日志文件；支持 `--max-mb N`、`--all`、`--dry-run` | 日志目录涨到几百 MB、或需要立刻清空日志时（见第六节） |
| 状态监测页 | 后端自动采集 | 页面化的长期取证：可用率、断开记录与原因、前端流量、资源趋势、进程生命周期 | 想知道「近半年断过几次、每次多久」时（见第五节，比翻日志快） |
| `tools/docs-check.js` | 人工 / CI（`npm run docs:check`） | 校验文档与代码是否一致：链接与锚点、接口清单、环境变量、页面路由、引用路径 | 改完代码或文档后（见第四节） |
| `weknora/start.bat`、`weknora/start.sh` | 人工 | 知识库服务的一键部署：生成 `.env` → `docker compose up -d` → 初始化脚本 | 首次部署或重建知识库环境，见 [WeKnora 部署指南](../weknora/README.md) |
| `weknora/scripts/gen-env.js` | `weknora/start.*` | 从 `.env.example` 生成 `.env`，自动填随机 `JWT_SECRET` / `SYSTEM_AES_KEY`；已存在则跳过 | 需要重置 `.env` 时手动跑（`--force` 覆盖） |
| `weknora/scripts/setup.js` | `weknora/start.*` | 幂等初始化：建管理员 → 配 DeepSeek/智谱模型 → 建 API Key → 把 `WEKNORA_*` 写进 `backend/.env` | 更换模型 Key、迁移服务器时 |
| `control/`（EXE） | 人工 | Windows 服务控制台：以桌面 GUI 启停与查看服务状态 | 不想用批处理、要给非技术同事用的场景，见 [README · Windows 服务控制台](../README.md#windows-服务控制台) |

> 串起来看：`start.bat` 拉起 `backend-watchdog.bat`，看门狗再拉起 `nodemon → node server.js`，并在每次拉起后端时同时启动 `backend-health-probe.bat`。所以「后端活着」这件事有**两层**兜底（退出重启、假死重启），但根因（共享盘 SMB 挂死）不会被自动修复，只保证服务恢复——排查根因见第三节末尾。

---

## 二、backend-report：后端断开分析

### 它解决什么问题

后端由 `start.bat` 隐藏窗口启动，崩溃时屏幕上什么都没有，只有 `logs/backend-watchdog.log` 里留一行记录。事后想回答「昨晚后端断过没有、断了几次、几点、怎么恢复的」，靠翻日志很费劲。这个工具把四个来源的证据交叉核对，直接给结论。

### 怎么运行

双击 `tools\backend-report.bat`：

```
 [1] 立即分析最近 N 分钟（读现有日志，秒出报告）
 [2] 先实时监控 N 分钟，结束后出报告（能抓到假死/卡顿）
```

选 `1` 输入分钟数（回车默认 60）→ 几秒出报告，不用等。
选 `2` 输入监控时长（回车默认 30）→ 边监控边打印进度，结束后出报告。

也可以命令行带参数，适合随手查：

```bat
tools\backend-report.bat -NoPrompt -LookbackMinutes 120
tools\backend-report.bat -NoPrompt -WatchMinutes 60
```

| 参数 | 含义 |
|------|------|
| `-LookbackMinutes N` | 分析最近 N 分钟（默认 60） |
| `-WatchMinutes N` | 先实时采样 N 分钟再分析（默认 0，即不采样） |
| `-IntervalSeconds N` | 采样间隔（默认 10 秒） |
| `-Port N` | 被监控端口（默认 5000） |
| `-NoPrompt` | 跳过交互，直接按参数跑 |

### 产出

| 文件 | 内容 |
|------|------|
| 控制台输出 | 直接读的文本报告 |
| `logs/report-<时间戳>.md` | 同一份报告的 Markdown 存档，可直接发给他人 |
| `logs/watchdata-<时间戳>.csv` | 实时采样数据（仅模式 2 生成），列：时间、端口是否在听、PID、探测耗时、内存、CPU |

### 报告怎么读

**证据优先级**：`backend-watchdog.log` > `backend-exit.log` > Windows 事件日志 > 实时采样。

`backend-watchdog.log` 是判断「断没断过」的权威依据——后端每退出一次，看门狗必然写一行 `backend ended (exit code N) after Ns`，带时间戳，不依赖有没有人挂着监控。实时采样只补充在线率、延迟和内存曲线。

判定规则是自动的：

| 组合 | 判定 |
|------|------|
| `backend-exit.log` 有该时刻记录 | 进程**自己退出**的，能拿到真实退出码 |
| 无 exit 记录，但 Windows 事件日志有 node.exe 崩溃 | **原生崩溃**（访问冲突等），需要 dump 分析 |
| 无 exit 记录，Windows 也无崩溃事件 | 进程被**外部强制终止**（安全软件静默终止、任务管理器结束、强杀） |
| 看门狗无记录、采样也未发现端口消失 | 未发生中断 |

### 两个坑

**退出码不能直接采信。** 看门狗记录里的 `exit code 1` 来自 nodemon——`--exitcrash` 模式下 nodemon 崩溃时会自己 `process.exit(1)`，后端进程的真实退出码被吞掉了。要看真实退出码，得看 `logs/backend-exit.log`（由 `server.js` 的 `process.on('exit')` 钩子写入）。

**「没有 exit 记录」本身就是结论。** 进程被 `TerminateProcess` 强杀或原生崩溃时，Node 的 `exit` 事件根本不会触发，所以 `backend-exit.log` 里不会有那一行——这正好用来区分「代码自己退出的」和「被外部干掉的」。

### 中文乱码

脚本必须保持 **UTF-8 with BOM** 编码，否则 PowerShell 5.1 会按 GBK 解码，中文全部乱码甚至语法报错。修改脚本时请保留 BOM：

```powershell
$t = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($true)))
```

---

## 三、看门狗与假死探针：后端「活着但不响应」

`backend-report` 解决的是「后端断过没有」。它抓不到另一种故障：**进程还在、端口还在 `LISTENING`，但所有 HTTP 请求都没有响应**。这种状态下进程不会退出，`backend-exit.log` 没有记录，看门狗的退出码判断也看不到，只能靠人工重启——2026-11 的生产故障就是如此（共享盘 SMB 会话失效，UNC 调用挂死在 Windows 内核里，占满 Node 的 libuv 线程池）。

现在由两个常驻脚本兜住，均随 `start.bat` 自动启动，**不需要手动运行**：

| 脚本 | 职责 | 判据 |
|------|------|------|
| `backend-watchdog.bat` | 进程退出后重新拉起（含退避） | 后端进程结束 → 等 10/30/60 秒再起 |
| `backend-health-probe.bat` | 进程未退出但不再响应时杀掉进程树 | 每 30 秒发一次 HTTP，连续 3 次拿不到**任何响应**即判定假死 |

探针每轮先读 `logs/backend-health-probe.gen` 里的实例代号：代号与启动时传入的不一致说明后端已经换代（正常重启、改文件热重载），本实例立即退出——**旧探针不会误杀新后端**。

### 日志里长什么样

两类记录都写在同一个文件 `logs/backend-watchdog.log`，探针行带 `[probe]` 前缀：

```text
[2026-11-09 13:18:14.58] [probe] health probe started (gen 1, port 5000, every 30s, timeout 5s)
[2026-11-09 13:18:16.91] [probe] health probe failed (1/3) on port 5000 (round 1)
[2026-11-09 13:20:20.03] [probe] [FATAL] backend unresponsive 3 consecutive probes on port 5000 (PID 12345) - killing process tree
[2026-11-09 13:20:20.71] [probe] health probe: killed PID 12345, waiting for watchdog to restart
[2026-11-09 13:20:31.02] spawn #2 (PORT=5000): npm run dev -- --exitcrash
```

| 看到什么 | 含义 | 要不要处理 |
|---|---|---|
| 只有 `health probe started` / `health probe gen N retired` | 探针正常随后端换代轮换 | 不用 |
| 偶尔一条 `failed (1/3)` 后没有下文 | 单次探测超时（后端在跑大任务或长 GC），下一轮自动归零 | 不用 |
| 连续 `failed (1/3) (2/3) (3/3)` + `[FATAL] ... killing` | 确实假死过，已被自动处理 | 查共享盘（见下） |
| `[WARN] health probe: port 5000 has no listener, nothing to kill` | 探测失败时端口上本来就没有监听（后端正在启动或已退出），探针重置计数 | 不用，看门狗会负责拉起 |
| 完全没有 `[probe]` 行 | 不是用 `start.bat` 启动的（如 PM2 / 控制台 / 手动 `npm run dev`），没有探针 | 自行保证存活探测 |

### 假死之后先查共享盘

探针只负责「把它救活」，不解决根因。紧接着要确认共享盘：

1. 浏览器或 `curl` 调 `GET /api/system/schedule-probe`（需超级管理员），看 `readable`、`lastError.code`、`raw`；
2. `logs/backend.log` / `backend.err.log` 搜 `[productionSchedule]`：出现「熔断中（连续失败 N 次…），跳过共享盘访问」说明熔断已开启，冷却期内不再访问共享盘；
3. 在资源管理器打开 `PRODUCTION_SCHEDULE_PATH` 验证账号权限；Session 0 自启的按 `DEPLOYMENT.md` 配置 `PRODUCTION_SCHEDULE_UNC_*` 凭据；
4. 共享恢复后调一次 `schedule-probe` 即可清除熔断计数，无需重启后端。

### 调参

| 变量 | 默认 | 说明 |
|------|------|------|
| `OBARA_PROBE_INTERVAL` | `30`（秒） | 探测间隔 |
| `OBARA_PROBE_TIMEOUT` | `5`（秒） | 单次 HTTP 超时；后端正常时应在几十毫秒内返回 |
| `OBARA_PROBE_FAILS` | `3` | 连续失败阈值；调小更快自愈，但过低会把长任务误判为假死 |
| `PRODUCTION_SCHEDULE_WORKER_TIMEOUT_MS` | `20000`（毫秒） | 共享盘读取子进程硬超时，超时即杀子进程 |
| `PRODUCTION_SCHEDULE_BREAKER_THRESHOLD` / `_COOLDOWN_MS` | `3` / `3600000` | 熔断阈值与冷却时长 |

探针只按 `PORT` 找监听进程，任何 HTTP 响应（包括 401/404）都算健康；它不会碰前端、数据库或其它 node 进程。

---

## 四、docs-check：文档一致性自检

文档最容易烂在「代码改了、文档没跟上」。这个脚本零依赖，用 Node 直接跑，不需要装任何包：

```bat
node tools/docs-check.js            :: 全部检查
node tools/docs-check.js links      :: 只查链接与锚点
node tools/docs-check.js api        :: 只查接口清单
node tools/docs-check.js env        :: 只查环境变量
node tools/docs-check.js pages      :: 只查页面路由
node tools/docs-check.js paths      :: 只查引用的仓库路径
```

| 检查项 | 比什么 | 判定 |
|--------|--------|------|
| `links` | 9 份文档里的相对链接与 `#锚点` | 文件不存在、锚点对不上标题（按 GitHub 的 slug 规则，中文标题也能校验）即失败 |
| `api` | `backend/routes/*.js` 的真实路由 ↔ `docs/API.md` 记录的端点 | **双向**比对：代码里有但文档没写、文档写了但代码里没有，都会报 |
| `env` | 后端代码读取的 `process.env.*` ↔ 文档全文 | 代码读取但任何文档都没提到的变量即失败；`NODE_ENV`、`PORT`、`USERNAME`、`USERDOMAIN` 属运行时注入，跳过 |
| `pages` | `frontend/src/App.tsx` 的路由 ↔ `README.md` 的「主要页面」表 | 路由没写进表里即失败 |
| `paths` | 文档中用反引号标注的仓库路径（`backend/…`、`frontend/…`、`tools/…` 等） ↔ 磁盘实际文件 | 文件不存在即失败；`logs/` 下的运行时日志与示例路径不校验 |

输出末行是结论，退出码 0 通过、1 有差异，可直接串在提交前检查里。它**查不出**字段含义写错、示例值过期、判定规则描述过时——这些仍要看代码人工确认。

> 改脚本本身时注意：`docs/API.md` 里 `GET /api/settings/*` 这类**通配**写法表示「整个前缀适用」，脚本会跳过；代码块与行内反引号里的 `[text](url)` 是示例，也不会被当成链接。

---

## 五、状态监测：断过没有、为什么断

`backend-report` 是「针对某个时间窗口，把所有日志和采样交叉核对一次」；状态监测则是**后端自己长期记录**，随时打开页面就能看到半年的可用率与每次断开的原因。两者不重复：前者适合深挖一次具体故障，后者适合回答「最近到底稳不稳」。

入口：系统设置 → 状态监测（仅超级管理员，对应 `GET /api/system/monitor/*`）。

### 数据从哪来

| 数据 | 采集节奏 | 存放 |
|------|----------|------|
| 心跳样本（RSS、堆、事件循环延迟、DB 耗时、在线连接数） | 30 秒一条 | `monitor_samples`（另有小时汇总 `monitor_samples_hour`） |
| 请求流量（请求数、错误、慢请求、方法、状态码、接口路径） | 进程内按分钟聚合，20 秒批量落盘 | `monitor_traffic_min` / `monitor_traffic_hour` / `monitor_traffic_path` |
| 生命周期事件 | 启动、正常停止、退出时各写一条 | `monitor_events` |

请求热路径只做内存累加，不写库；单次心跳写入也非常小。因此「开着监测」不会像操作日志那样放大写入量。

### 判定口径（判读页面结论前先看这一段）

- **可用性以心跳样本为准**：同一进程内两条样本间隔超过 90 秒即视为那段时间后端无响应。后端被强杀时写不了「我停了」，样本空档才是可靠证据。
- **每次启动都会与上一轮会话的结束记录比对**：没有正常停止记录就记为异常中断。所以哪怕 nodemon 一秒内拉起进程、心跳看不出空档，也会被记成一次断开。
- **热重载不算故障**：Windows 上 Node 收不到 `SIGUSR2`，nodemon 杀子进程时来不及写任何记录，因此改用「`backend.log` 里的 `[nodemon] restarting/starting` + 断开前几分钟内有源文件改动 + 无崩溃日志 + 无退出码」四条一起判。页面右上角可切换是否把热重载从可用率里剔除；冷启动同样有 `[nodemon]` 日志，所以「停机一夜再开机」不会被误判成热重载。
- **原因只引用书面证据**：`logs/backend-crash.log`（未捕获异常堆栈）、`logs/backend-exit.log`（退出码与内存/句柄快照）、`logs/backend-watchdog.log`（`[FATAL] ... killing` 说明是假死探针强杀的）、`logs/manual-stop.json`（`stop.bat` 强杀前自己写的停机标记）、断开前 RSS 曲线与 5xx 突增。没有证据时结论写「待观察（无退出取证）」，不编造。
- **手动停机不算故障**：`stop.bat` 用 `taskkill /F` 结束进程树，进程写不了任何退出记录，因此由脚本在动手前落一份 `logs/manual-stop.json`（停机时刻 + 操作者 + 目标服务）。后端在「断开起点前 90 秒 → 恢复时刻」窗口内命中该标记时判 `manual_stop`，并在断列表里标「计划内停机 · 不计入可用率」——它仍会出现在列表里供回溯，但不进中断次数与可用率。
- **灰色段 = 尚未采集**：监测从升级后第一次启动开始，部署前的历史无法回算，灰段不计入可用率。

### 页面怎么读

| 区块 | 看什么 |
|------|--------|
| 核心指标 | 可用率、当前连续运行、断开次数、平均无故障时长；请求量/平均响应/错误率回答「前端到底多忙」 |
| 可用性时间轴 | 绿正常、红中断、黄部分中断、灰未采集；7 天内按小时，30 天以上按天 |
| 后端断开记录 | 断开时刻、恢复时刻、持续时长、断开前已稳定运行、可能原因与判定依据（最新 60 条，固定高度滚动） |
| 前端流量 | 请求量与错误率双轴、Top 接口（含平均耗时）、方法分布、同时在线峰值、周一至周日 × 24 小时热力图 |
| 资源趋势 | RSS 均值/峰值、事件循环延迟（持续偏高说明有长任务阻塞请求） |
| 进程生命周期 | 启动 / 热重载 / 正常停止 / 退出各一行；启动行展示的是**被替换进程**的最终运行时长与内存，可据此判断「这次重启前稳定跑了多久」 |
| 存储占用与清理 | 监测表体积、行数、占整库比例、日增预估；按保留期清理、按天数清理、压缩数据库、清空全部监测数据 |

### 保留与清理

- 趋势数据（样本、小时汇总、流量、路径聚合）保留 **200 天**，分钟明细保留 **35 天**，覆盖「近半年」查询；分钟明细过期后自动退回小时汇总，图表不会缺数据。
- 自动清理每 6 小时执行一次（服务每 10 分钟检查是否到期，重启不会跳过），清理后会 `wal_checkpoint(TRUNCATE)` 收缩 WAL。
- 清理分两步：**按保留期清理**只删数据；**压缩数据库**（`VACUUM`）才把空闲页还给磁盘。SQLite 的 DELETE 不会让文件变小，所以「删了但可回收体积没降」是正常现象。
- 「清空所有监测数据」不可恢复，并把采集基线重置为清空时刻；只想瘦身不要用这一项。

### 与 backend-report 的分工

| 想回答 | 用哪个 |
|--------|--------|
| 最近半年断过几次、每次多久、整体稳不稳 | 状态监测页 |
| 某次断开的确切原因、当时 Windows 事件日志里有什么 | `tools/backend-report.bat`（第二节） |
| 探针为什么杀了后端、假死了多久 | `logs/backend-watchdog.log` 的 `[probe]` 行（第三节），状态监测的断开记录会引用它 |

---

## 六、日志文件占用与轮转

`logs/` 下的文件由启动脚本以追加方式写入，node/nodemon 不会自己截断，历史上 `backend-crash.log` 曾涨到 248MB。现在有两层处理：

**1. 页面查看与手动清理**：系统设置 → 日志文件管理（`GET /api/system/log-files`、`POST /api/system/log-files/trim`）。页面只对文件做 `stat`，不读取内容——单个文件可能几百 MB，读进内存只会把后端拖死。每个文件带清理建议：

| 建议 | 含义 |
|------|------|
| `truncate` 可清空 | 是被隐藏 cmd 窗口重定向占用的日志，**删除会失败**，清空是安全的 |
| `delete` 可删除 | 没有进程持有句柄 |
| `forbid` 禁止删除 | `.pid`、`.token`、`backend-health-probe.gen` 等运行时文件 |

**2. 自动截断**：默认开启、单文件阈值 50MB（系统设置可改 5 ~ 2048，也可关闭）。后端每 30 分钟检查一次 `logs/*.log`，超阈值就保留末尾 10%（夹在 64KB ~ 512KB），清掉前面内容并在首行写一行 `[log-trim]` 说明；日志里搜 `[logFiles]` 可看到每次截断结果。**就地截断不删除文件**：这些文件都是追加写，重写后下一次写入直接落在新末尾，不会产生空洞，也不会让写入方失效。

**被占用的日志只能重启前轮转**：`backend.log` / `backend.err.log` / `frontend.log` / `frontend.err.log` 在服务运行期间由隐藏 cmd 窗口持有句柄，后端自身的截断清不掉它们（页面上标「运行中占用」）。`start.bat` 在结束上一轮进程之后、拉起服务之前调用：

```bat
node tools\trim-logs.js              :: 按系统设置里的阈值清理超限文件（start.bat 默认）
node tools\trim-logs.js --max-mb 5   :: 临时指定阈值，不写库
node tools\trim-logs.js --all        :: 清空全部日志文件，每个只留一行说明
node tools\trim-logs.js --dry-run    :: 只报告会清哪些文件，不动文件
```

脚本与后端共用 `backend/utils/logFiles.js` 的同一套截断逻辑，输出 `[trim-logs] ...` 写入 `logs/startup.log`（隐藏启动模式下）；失败只告警，不阻断启动。

**不要手工删除**：

- `.pid`：`stop.bat` 靠它找进程，删掉后只能按端口杀；
- `offline-backup.token`：关机备份校验用，删掉后 `stop.bat` 的备份调用会被拒；
- `backend-health-probe.gen`：探针实例代号，删掉会让旧探针误判换代、假死检测静默失效；
- `backend-crash.log`：删掉就失去崩溃堆栈证据（截断可保留末尾，优先用清理功能而不是删文件）。

---

## 相关文档

| 文档 | 内容 |
|---|---|
| [文档中心](README.md) | 全部文档的索引与阅读路径 |
| [Windows 部署指南](DEPLOYMENT.md) | 启动方式、环境变量、备份恢复、故障排查 |
| [README](../README.md) | 功能、权限、脚本与维护建议 |
