# 运维工具说明

> 其他文档：[README](../README.md)（功能与使用） · [使用手册](USER-GUIDE.md) · [开发者指南](DEVELOPMENT.md) · [API 文档](API.md) · [部署指南](DEPLOYMENT.md)

本目录（仓库根目录的 `tools/`，不在 `docs/` 下）放的是**启动项目不需要**的运维诊断工具。启动/停止请用仓库根目录的 `start.bat` / `stop.bat`。

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
