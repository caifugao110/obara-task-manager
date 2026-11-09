# 运维工具说明

> 其他文档：[README](../README.md)（功能与使用） · [使用手册](USER-GUIDE.md) · [开发者指南](DEVELOPMENT.md) · [API 文档](API.md) · [部署指南](DEPLOYMENT.md)

本目录（仓库根目录的 `tools/`，不在 `docs/` 下）放的是**启动项目不需要**的运维诊断工具。启动/停止请用仓库根目录的 `start.bat` / `stop.bat`。

> 根目录的 `backend-watchdog.bat` 与 `backend-health-probe.bat` 不是手动工具，而是 `start.bat` 启动的运行时守护：前者负责「进程退出了就拉起来」，后者负责「进程还在但不再响应」。它们的日志判读见本文第二节。

---

## backend-report：后端断开分析

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

## 看门狗与假死探针：后端「活着但不响应」

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
