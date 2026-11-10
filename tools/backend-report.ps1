#requires -Version 5.1
<#
    后端断开分析工具 / backend-report.ps1

    用途：随时运行，输入一个时长，得到「最近这段时间后端有没有断过」的分析报告。
    两种模式：
      1) 立即分析：只读现有日志，秒出报告（不需要等待）
      2) 先监控再分析：实时采样 N 分钟，结束后出报告（能抓到假死、卡顿）

    证据来源（按重要性排序）：
      logs\backend-watchdog.log  看门狗日志——后端每退出一次必留一行 "backend ended"，
                                  这是判断「断过没断过」最权威的依据，且带时间戳。
      logs\backend-exit.log      进程 exit 事件取证：有记录=进程自己退的（含真实退出码），
                                  无记录=被外部 TerminateProcess 强杀（原生崩溃亦然）。
      logs\backend-crash.log     未捕获异常的落盘文件：字节数增长=发生过 JS 异常。
      Windows 事件日志            Application Error(1000)/WER(1001) 里有 node.exe
                                  = 原生崩溃（访问冲突），有 dump 可分析。
      logs\watchdata-*.csv       本脚本实时采样产生的时序数据：端口在线率、探测延迟、
                                  内存/CPU 曲线、PID 变化。

    退出码说明：
      看门狗记的退出码来自 nodemon，不是后端进程本身。nodemon 在 --exitcrash 下
      崩溃时自己 process.exit(1)，所以那里的 "1" 不能当作后端真实退出码。
#>
param(
    [int]$LookbackMinutes = 60,
    [int]$WatchMinutes = 0,
    [int]$IntervalSeconds = 10,
    [int]$Port = 5000,
    [string]$Root = '',
    [switch]$NoPrompt
)

$ErrorActionPreference = 'Stop'
# 控制台要正确显示中文，代码页和输出编码必须一致：PowerShell 5.1 在 936 代码页下
# 会把 UTF-8 字节当 GBK 解释，输出满屏乱码。双击 bat 时 chcp 已设好，这里兜住
# 「直接在 PowerShell 窗口里运行脚本」的情况。
if ([Console]::OutputEncoding.CodePage -ne 65001) {
    try { & "$env:SystemRoot\System32\chcp.com" 65001 | Out-Null } catch { }
}
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

if (-not $Root) {
    if ($PSScriptRoot) { $Root = Split-Path -Parent $PSScriptRoot }
}
if (-not $Root) { $Root = 'E:\My Trae\obara-task-manager' }

$script:RepoRoot = $Root
$script:Port = $Port
$logDir = Join-Path $Root 'logs'
$wdPath = Join-Path $logDir 'backend-watchdog.log'
$errPath = Join-Path $logDir 'backend.err.log'
$crashPath = Join-Path $logDir 'backend-crash.log'
$exitPath = Join-Path $logDir 'backend-exit.log'
$backendLogPath = Join-Path $logDir 'backend.log'

if (-not (Test-Path -LiteralPath $logDir)) {
    Write-Host ("找不到日志目录：" + $logDir) -ForegroundColor Red
    exit 1
}

function Get-FileLength([string]$path) {
    if (Test-Path -LiteralPath $path) {
        try { return [long](Get-Item -LiteralPath $path).Length } catch { return -1 }
    }
    return -1
}

function Get-FileModified([string]$path) {
    if (Test-Path -LiteralPath $path) {
        try { return (Get-Item -LiteralPath $path).LastWriteTime } catch { return $null }
    }
    return $null
}

function Get-ListeningPid([int]$portNumber) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $portNumber -State Listen -ErrorAction Stop
        if ($conns) { return [int](($conns | Select-Object -First 1).OwningProcess) }
    } catch { }
    return 0
}

function Test-TcpProbe([int]$portNumber) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $ok = $false
    $client = $null
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $ar = $client.BeginConnect('127.0.0.1', $portNumber, $null, $null)
        if ($ar.AsyncWaitHandle.WaitOne(2000, $false)) {
            $client.EndConnect($ar)
            $ok = $true
        }
    } catch {
        $ok = $false
    } finally {
        if ($client) { try { $client.Close() } catch { } }
    }
    $sw.Stop()
    return [pscustomobject]@{ Ok = $ok; Ms = [int]$sw.ElapsedMilliseconds }
}

function Invoke-Sampling([int]$watchMin, [int]$interval, [string]$csvPath) {
    $endAt = (Get-Date).AddMinutes($watchMin)
    $rows = New-Object System.Collections.ArrayList
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $nextReportAt = 60
    $first = $true

    while ($first -or (Get-Date) -lt $endAt) {
        $first = $false
        $now = Get-Date
        $listenPid = Get-ListeningPid $script:Port
        $listening = 0
        $probeMs = -1
        if ($listenPid -gt 0) {
            $probe = Test-TcpProbe $script:Port
            $probeMs = $probe.Ms
            if ($probe.Ok) { $listening = 1 }
        }
        $mem = -1
        $cpu = -1
        if ($listenPid -gt 0) {
            try {
                $pr = Get-Process -Id $listenPid -ErrorAction Stop
                $mem = [int]($pr.WorkingSet64 / 1MB)
                $cpu = [int]$pr.TotalProcessorTime.TotalSeconds
            } catch { }
        }

        $row = [pscustomobject]@{
            Time      = $now
            Listening = $listening
            Pid       = $listenPid
            ProbeMs   = $probeMs
            MemMb     = $mem
            CpuSec    = $cpu
        }
        $rows.Add($row) | Out-Null
        $line = ($now.ToString('yyyy-MM-dd HH:mm:ss') + ',' + $listening + ',' + $listenPid + ',' + $probeMs + ',' + $mem + ',' + $cpu)
        # 写盘失败不能让整轮监控崩掉。Add-Content 在被别的进程瞬时占用时会抛
        # IOException（杀毒扫描、备份代理、另一个工具刚好在读这个 CSV 都会触发），
        # 而这里一抛异常整个 Invoke-Sampling 就退出：2026-11-10 那轮 643 分钟的监控
        # 就是这样在第 350 分钟彻底中断的，前面积累的采样只剩下半截。
        # 所以最多重试 3 次，仍然失败就跳过这一个采样点继续跑——少一个点远好过整轮作废。
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            try {
                Add-Content -LiteralPath $csvPath -Value $line -Encoding UTF8
                break
            } catch {
                if ($attempt -eq 3) {
                    Write-Host ("  [WARN] 采样点写入失败，已跳过：" + $now.ToString('HH:mm:ss')) -ForegroundColor Yellow
                } else {
                    Start-Sleep -Milliseconds 400
                }
            }
        }

        if ($sw.Elapsed.TotalSeconds -ge $nextReportAt) {
            $doneMin = [int]$sw.Elapsed.TotalMinutes
            $pct = 0
            if ($watchMin -gt 0) { $pct = [int](100 * $sw.Elapsed.TotalMinutes / $watchMin) }
            $stateText = '正常'
            if ($listening -eq 0) { $stateText = '断开' }
            $memText = '<无进程>'
            if ($mem -ge 0) { $memText = ('' + $mem + 'MB') }
            Write-Host ("  已监控 {0}/{1} 分钟（{2}%）  端口:{3}  PID:{4}  内存:{5}" -f $doneMin, $watchMin, $pct, $stateText, $listenPid, $memText)
            $nextReportAt = $nextReportAt + 60
        }

        if ((Get-Date) -ge $endAt) { break }
        Start-Sleep -Seconds $interval
    }
    return $rows
}

function Get-WatchdogEvents([string]$path) {
    $list = New-Object System.Collections.ArrayList
    if (-not (Test-Path -LiteralPath $path)) { return $list }
    $lines = @(Get-Content -LiteralPath $path -ErrorAction SilentlyContinue)
    foreach ($line in $lines) {
        if ($line -notmatch '(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2})') { continue }
        $ts = $null
        try {
            $ts = [DateTime]::ParseExact($matches[1], 'yyyy/MM/dd HH:mm:ss', [System.Globalization.CultureInfo]::InvariantCulture)
        } catch {
            $ts = $null
        }
        if ($ts -eq $null) { continue }

        if ($line -match 'backend ended \(exit code (-?\d+)\) after (\d+)s') {
            $list.Add([pscustomobject]@{ Time = $ts; Kind = 'ended'; Code = [int]$matches[1]; RanFor = [int]$matches[2] }) | Out-Null
        } elseif ($line -match 'spawn #(\d+) \(PORT') {
            $list.Add([pscustomobject]@{ Time = $ts; Kind = 'spawn'; Code = $null; RanFor = $null; N = [int]$matches[1] }) | Out-Null
        } elseif ($line -match 'supervisor started') {
            $list.Add([pscustomobject]@{ Time = $ts; Kind = 'started'; Code = $null; RanFor = $null }) | Out-Null
        }
    }
    return $list
}

function Get-Outages($events) {
    $out = New-Object System.Collections.ArrayList
    for ($i = 0; $i -lt $events.Count; $i++) {
        if ($events[$i].Kind -ne 'ended') { continue }
        $ended = $events[$i]
        $recoverAt = $null
        for ($j = $i + 1; $j -lt $events.Count; $j++) {
            if ($events[$j].Kind -eq 'spawn') { $recoverAt = $events[$j].Time; break }
            if ($events[$j].Kind -eq 'ended') { break }
        }
        $downSeconds = -1
        if ($recoverAt -ne $null) {
            $downSeconds = [int](New-TimeSpan -Start $ended.Time -End $recoverAt).TotalSeconds
        }
        $out.Add([pscustomobject]@{
            Start       = $ended.Time
            ExitCode    = $ended.Code
            RanFor      = $ended.RanFor
            RecoverAt   = $recoverAt
            DownSeconds = $downSeconds
        }) | Out-Null
    }
    return $out
}

function Get-SampleRows([datetime]$since, [datetime]$until) {
    $rows = New-Object System.Collections.ArrayList
    $culture = [System.Globalization.CultureInfo]::InvariantCulture
    $files = @()
    try {
        # 同时匹配 watchdata-*.csv（本工具）与 watch-*.csv（早期采样器，只有时分秒列）
        $files = @(Get-ChildItem -LiteralPath $logDir -Filter 'watch*.csv' -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $since })
    } catch { }
    foreach ($file in $files) {
        $lines = @(Get-Content -LiteralPath $file.FullName -ErrorAction SilentlyContinue)
        foreach ($line in $lines) {
            if (-not $line) { continue }
            if ($line.StartsWith('timestamp') -or $line.StartsWith('time,')) { continue }
            $parts = $line.Split(',')
            if ($parts.Length -lt 6) { continue }
            $stampText = $parts[0].Trim()
            $ts = $null
            if ($stampText -match '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$') {
                try { $ts = [DateTime]::ParseExact($stampText, 'yyyy-MM-dd HH:mm:ss', $culture) } catch { $ts = $null }
            } elseif ($stampText -match '^\d{2}:\d{2}:\d{2}$') {
                # 旧格式没有日期，用文件修改日期补全（单次监控不会跨太多天）
                try { $ts = [DateTime]::ParseExact(($file.LastWriteTime.ToString('yyyy-MM-dd') + ' ' + $stampText), 'yyyy-MM-dd HH:mm:ss', $culture) } catch { $ts = $null }
            }
            if ($ts -eq $null) { continue }
            if ($ts -lt $since -or $ts -gt $until) { continue }
            $rows.Add([pscustomobject]@{
                Time      = $ts
                Listening = [int]$parts[1]
                Pid       = [int]$parts[2]
                ProbeMs   = [int]$parts[3]
                MemMb     = [int]$parts[4]
                CpuSec    = [int]$parts[5]
            }) | Out-Null
        }
    }
    return $rows
}

function Get-CrashEvents([datetime]$since, [datetime]$until) {
    $res = New-Object System.Collections.ArrayList
    try {
        $evs = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Id = 1000, 1001; StartTime = $since; EndTime = $until } -ErrorAction Stop)
        foreach ($e in $evs) {
            $msg = ''
            try { $msg = $e.Message } catch { }
            if ($msg -match 'node\.exe|nodemon') {
                $res.Add([pscustomobject]@{ Time = $e.TimeCreated; Id = $e.Id; Provider = $e.ProviderName }) | Out-Null
            }
        }
    } catch { }
    return $res
}

function Format-Percent([double]$part, [double]$whole) {
    if ($whole -le 0) { return '-' }
    return ('' + [math]::Round(100 * $part / $whole, 2) + '%')
}

function Format-Duration([int]$seconds) {
    if ($seconds -lt 0) { return '-' }
    if ($seconds -lt 60) { return ('' + $seconds + ' 秒') }
    $minutes = [int][math]::Floor($seconds / 60)
    $rest = $seconds % 60
    if ($minutes -lt 60) { return ('' + $minutes + ' 分 ' + $rest + ' 秒') }
    $hours = [int][math]::Floor($minutes / 60)
    $minutesLeft = $minutes % 60
    return ('' + $hours + ' 小时 ' + $minutesLeft + ' 分')
}

# ---------------------------------------------------------------- 交互

if (-not $NoPrompt) {
    Write-Host ''
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-Host ' 后端断开分析工具' -ForegroundColor Cyan
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-Host ''
    Write-Host ' [1] 立即分析最近 N 分钟（读现有日志，秒出报告）'
    Write-Host ' [2] 先实时监控 N 分钟，结束后出报告（能抓到假死/卡顿）'
    Write-Host ''
    $choice = Read-Host '请选择模式 [1/2]，回车默认 1'
    if ($choice -eq '2') {
        $inputWatch = Read-Host '请输入实时监控时长（分钟），回车默认 30'
        if ($inputWatch -match '^\d+$' -and [int]$inputWatch -gt 0) { $WatchMinutes = [int]$inputWatch } else { $WatchMinutes = 30 }
        $LookbackMinutes = $WatchMinutes
    } else {
        $inputSpan = Read-Host '请输入要分析的时长（分钟），回车默认 60'
        if ($inputSpan -match '^\d+$' -and [int]$inputSpan -gt 0) { $LookbackMinutes = [int]$inputSpan } else { $LookbackMinutes = 60 }
    }
}

if ($LookbackMinutes -le 0) { $LookbackMinutes = 60 }
if ($WatchMinutes -gt $LookbackMinutes) { $LookbackMinutes = $WatchMinutes }

$startedAt = Get-Date
$csvPath = $null

if ($WatchMinutes -gt 0) {
    $stamp = $startedAt.ToString('yyyyMMdd-HHmmss')
    $csvPath = Join-Path $logDir ('watchdata-' + $stamp + '.csv')
    Set-Content -LiteralPath $csvPath -Value 'timestamp,listening,port_pid,probe_ms,mem_mb,cpu_s' -Encoding UTF8
    Write-Host ''
    Write-Host ("开始实时监控 {0} 分钟（每 {1} 秒采样一次），可以先去忙别的..." -f $WatchMinutes, $IntervalSeconds) -ForegroundColor Yellow
    Write-Host ''
    $null = Invoke-Sampling $WatchMinutes $IntervalSeconds $csvPath
    Write-Host ''
}

$finishedAt = Get-Date
$since = $finishedAt.AddMinutes(-1 * $LookbackMinutes)

# 记录「区间开始前」的基线：如果这些文件的修改时间落在区间内，说明期间有写入
$crashLen = Get-FileLength $crashPath
$crashMtime = Get-FileModified $crashPath
$exitLen = Get-FileLength $exitPath
$exitMtime = Get-FileModified $exitPath
$errLen = Get-FileLength $errPath
$errMtime = Get-FileModified $errPath

$events = @(Get-WatchdogEvents $wdPath)
$allOutages = @(Get-Outages $events)

$samples = @(Get-SampleRows $since $finishedAt)
$sampleFiles = @()
try {
    $sampleFiles = @(Get-ChildItem -LiteralPath $logDir -Filter 'watch*.csv' -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $since })
} catch { }

# 看门狗记的 "ended -> spawn" 只是「开始重新拉起」的时刻，端口真正恢复还要再加
# 几秒启动时间。只要有实时采样覆盖这次中断，就用采样的「端口消失 -> 恢复」实测值
# 覆盖它，避免把 17 秒的中断报成 11 秒。
foreach ($o in $allOutages) {
    if ($samples.Count -eq 0) { break }
    $windowEnd = $o.Start.AddMinutes(3)
    if ($o.RecoverAt -ne $null) { $windowEnd = $o.RecoverAt.AddMinutes(2) }
    $segment = @($samples | Where-Object { $_.Listening -eq 0 -and $_.Time -ge $o.Start.AddSeconds(-1 * $IntervalSeconds) -and $_.Time -le $windowEnd })
    if ($segment.Count -gt 0) {
        $firstDown = $segment[0].Time
        # 中断时长 = 第一个「端口无响应」采样 到 第一个「恢复响应」采样。
        # 不能拿最后一个无响应点再加一个间隔去算，那样会把恢复点本身吃掉一轮。
        $recoverSample = $null
        foreach ($s in $samples) {
            if ($s.Listening -eq 1 -and $s.Time -gt $firstDown) { $recoverSample = $s; break }
        }
        $measured = 0
        if ($recoverSample -ne $null) {
            $measured = [int]((New-TimeSpan -Start $firstDown -End $recoverSample.Time).TotalSeconds)
        } else {
            $lastDown = $segment[$segment.Count - 1].Time
            $measured = [int]((New-TimeSpan -Start $firstDown -End $lastDown).TotalSeconds) + $IntervalSeconds
        }
        $o.DownSeconds = $measured
    }
}

$outages = @($allOutages | Where-Object { $_.Start -ge $since })
$crashEvents = @(Get-CrashEvents $since $finishedAt)

$currentPid = Get-ListeningPid $Port
$currentProcess = $null
if ($currentPid -gt 0) {
    try { $currentProcess = Get-Process -Id $currentPid -ErrorAction Stop } catch { $currentProcess = $null }
}

$downSamples = @($samples | Where-Object { $_.Listening -eq 0 })
$sampleCount = $samples.Count
$coveredMinutes = 0
if ($sampleCount -gt 1) {
    $coveredMinutes = [math]::Round((New-TimeSpan -Start $samples[0].Time -End $samples[$sampleCount - 1].Time).TotalMinutes, 1)
}
$uptimeRatio = '-'
if ($sampleCount -gt 0) {
    $upCount = $sampleCount - $downSamples.Count
    $uptimeRatio = Format-Percent $upCount $sampleCount
}

$probeList = @($samples | Where-Object { $_.ProbeMs -ge 0 } | ForEach-Object { $_.ProbeMs } | Sort-Object)
$probeMin = '-'; $probeMed = '-'; $probeMax = '-'
if ($probeList.Count -gt 0) {
    $probeMin = '' + $probeList[0] + 'ms'
    $probeMax = '' + $probeList[$probeList.Count - 1] + 'ms'
    $probeMed = '' + $probeList[[int][math]::Floor($probeList.Count / 2)] + 'ms'
}

$memList = @($samples | Where-Object { $_.MemMb -ge 0 } | ForEach-Object { $_.MemMb })
$memStart = '-'; $memEnd = '-'; $memPeak = '-'
if ($memList.Count -gt 0) {
    $memStart = '' + $memList[0] + 'MB'
    $memEnd = '' + $memList[$memList.Count - 1] + 'MB'
    $memPeak = '' + (($memList | Measure-Object -Maximum).Maximum) + 'MB'
}

$pidChanges = New-Object System.Collections.ArrayList
if ($sampleCount -gt 1) {
    $prevPid = $samples[0].Pid
    for ($i = 1; $i -lt $sampleCount; $i++) {
        if ($samples[$i].Pid -ne $prevPid -and $samples[$i].Pid -gt 0) {
            $pidChanges.Add([pscustomobject]@{ Time = $samples[$i].Time; From = $prevPid; To = $samples[$i].Pid }) | Out-Null
            $prevPid = $samples[$i].Pid
        }
    }
}

$exitLoggedInRange = ($exitMtime -ne $null -and $exitMtime -ge $since)
$crashLoggedInRange = ($crashMtime -ne $null -and $crashMtime -ge $since -and $crashLen -gt 0)

# ---------------------------------------------------------------- 报告

$sb = New-Object System.Text.StringBuilder
$add = {
    param($text)
    $null = $sb.AppendLine($text)
    Write-Host $text
}

$add.Invoke('')
$add.Invoke('============================================================')
$add.Invoke(' 后端断开分析报告')
$add.Invoke('============================================================')
$add.Invoke((' 生成时间 : ' + $finishedAt.ToString('yyyy-MM-dd HH:mm:ss')))
$add.Invoke((' 分析区间 : ' + $since.ToString('yyyy-MM-dd HH:mm:ss') + ' ~ ' + $finishedAt.ToString('yyyy-MM-dd HH:mm:ss') + '（最近 ' + $LookbackMinutes + ' 分钟）'))
$add.Invoke((' 项目路径 : ' + $Root))
$add.Invoke('------------------------------------------------------------')

$add.Invoke('【结论】')
if ($outages.Count -eq 0 -and $downSamples.Count -eq 0) {
    $add.Invoke(' 本区间内未发现后端异常退出，端口全程在线。')
} elseif ($outages.Count -eq 0) {
    $add.Invoke((' 本区间内看门狗没有记录到退出，但实时采样发现 ' + $downSamples.Count + ' 个采样点端口无响应。'))
    $add.Invoke(' 可能是采样窗口外的短暂断开，或端口探测被本机安全软件拦截。')
} else {
    $totalDown = 0
    foreach ($o in $outages) {
        if ($o.DownSeconds -gt 0) { $totalDown = $totalDown + $o.DownSeconds }
    }
    $add.Invoke((' 本区间内后端异常退出 ' + $outages.Count + ' 次，累计中断约 ' + (Format-Duration $totalDown) + '，已由看门狗自动恢复。'))
}
$add.Invoke('')

$add.Invoke('【一、中断明细】')
if ($outages.Count -eq 0) {
    $add.Invoke(' （无）')
} else {
    foreach ($o in $outages) {
        $recoverText = '未恢复（仍在中断）'
        if ($o.RecoverAt -ne $null) {
            $recoverText = '自动重启 ' + $o.RecoverAt.ToString('HH:mm:ss') + '（中断约 ' + (Format-Duration $o.DownSeconds) + '）'
        }
        $add.Invoke((' 退出 ' + $o.Start.ToString('HH:mm:ss') + '  已运行 ' + (Format-Duration $o.RanFor) + '  看门狗退出码 ' + $o.ExitCode + '  →  ' + $recoverText))
    }
    $add.Invoke('')
    $add.Invoke(' 注：这里的退出码来自 nodemon，不是后端进程本身（--exitcrash 下 nodemon')
    $add.Invoke('     崩溃时会自己退出并返回 1），真实退出码要看 backend-exit.log。')
}
$add.Invoke('')

$add.Invoke('【二、运行指标】')
if ($sampleCount -eq 0) {
    $add.Invoke(' 无实时采样数据（本次为历史日志分析，未做采样）。')
} else {
    $add.Invoke((' 采样点数        ' + $sampleCount + ' 点，覆盖 ' + $coveredMinutes + ' 分钟（来源 ' + $sampleFiles.Count + ' 个采样文件）'))
    $add.Invoke((' 端口在线率      ' + $uptimeRatio + '（无响应采样 ' + $downSamples.Count + ' 个）'))
    $add.Invoke((' TCP 探测耗时    最小 ' + $probeMin + ' / 中位 ' + $probeMed + ' / 最大 ' + $probeMax))
    $add.Invoke((' 内存            ' + $memStart + ' → ' + $memEnd + '，峰值 ' + $memPeak))
    if ($pidChanges.Count -eq 0) {
        $add.Invoke(' PID 变化        无（全程同一个进程）')
    } else {
        foreach ($c in $pidChanges) {
            $add.Invoke((' PID 变化        ' + $c.Time.ToString('HH:mm:ss') + '  ' + $c.From + ' → ' + $c.To))
        }
    }
}
$add.Invoke('')

$add.Invoke('【三、证据核对】')
$add.Invoke((' 看门狗退出记录      ' + $outages.Count + ' 条（区间内）'))
if ($crashLoggedInRange) {
    $add.Invoke(' backend-crash.log   有新增（发生过未捕获异常，见该文件末尾）')
} else {
    $add.Invoke(' backend-crash.log   未增长（没有 JS 未捕获异常）')
}
if (Test-Path -LiteralPath $exitPath) {
    if ($exitLoggedInRange) {
        $add.Invoke(' backend-exit.log    有记录（进程走的是正常退出路径，退出码见该文件）')
    } else {
        $add.Invoke(' backend-exit.log    存在但区间内无新增')
    }
} else {
    $add.Invoke(' backend-exit.log    无此文件（进程从未触发 exit 事件）')
}
if ($crashEvents.Count -gt 0) {
    foreach ($c in $crashEvents) {
        $add.Invoke((' Windows 事件日志    ' + $c.Time.ToString('HH:mm:ss') + ' 出现 ' + $c.Provider + '（可能存在原生崩溃）'))
    }
} else {
    $add.Invoke(' Windows 事件日志    无 node.exe 崩溃记录（非原生崩溃）')
}
$add.Invoke('')

$add.Invoke('【四、判定】')
if ($outages.Count -eq 0) {
    $add.Invoke(' 未发现中断。')
} else {
    if ($exitLoggedInRange) {
        $add.Invoke(' 进程自行退出（exit 事件有记录），请查看 logs\backend-exit.log 的真实退出码。')
        $add.Invoke(' 若是 process.exit() 主动退出，说明代码里某条路径在运行期执行了退出。')
    } elseif ($crashEvents.Count -gt 0) {
        $add.Invoke(' 疑似原生崩溃：进程未走 exit 事件，但 Windows 记录了 node.exe 崩溃。')
        $add.Invoke(' 下一步：开启 WER LocalDumps 抓 dump，用 WinDbg 看调用栈。')
    } else {
        $add.Invoke(' 进程被外部强制终止：既没有 exit 事件记录，Windows 也没有崩溃记录。')
        $add.Invoke(' 常见原因：安全软件（360 主动防御等）静默终止、任务管理器结束进程、强杀。')
        $add.Invoke(' 建议：把项目目录加入安全软件信任区，再观察是否复发。')
    }
}
$add.Invoke('')

$add.Invoke('【五、历史最近 5 次退出（不限本区间）】')
$add.Invoke(' 时长口径：看门狗「退出 → 重新拉起」的间隔，不含进程启动耗时；')
$add.Invoke('           区间内有采样的那次按实测端口恢复时刻算，会略长几秒。')
if ($allOutages.Count -eq 0) {
    $add.Invoke(' 看门狗日志中没有历史退出记录。')
} else {
    $recent = @($allOutages | Select-Object -Last 5)
    foreach ($o in $recent) {
        $recoverText = '未恢复'
        if ($o.RecoverAt -ne $null) { $recoverText = '恢复于 ' + $o.RecoverAt.ToString('MM-dd HH:mm:ss') + '（中断约 ' + (Format-Duration $o.DownSeconds) + '）' }
        $add.Invoke((' ' + $o.Start.ToString('yyyy-MM-dd HH:mm:ss') + '  已运行 ' + (Format-Duration $o.RanFor) + '  退出码 ' + $o.ExitCode + '  ' + $recoverText))
    }
}
$add.Invoke('')

$add.Invoke('【六、当前状态】')
if ($currentPid -gt 0) {
    $memNow = '-'
    $cpuNow = '-'
    if ($currentProcess) {
        $memNow = '' + [int]($currentProcess.WorkingSet64 / 1MB) + 'MB'
        $cpuNow = '' + [int]$currentProcess.TotalProcessorTime.TotalSeconds + 's'
    }
    $add.Invoke((' 端口 ' + $Port + ' 正常监听，PID ' + $currentPid + '，内存 ' + $memNow + '，CPU 累计 ' + $cpuNow))
} else {
    $add.Invoke((' 端口 ' + $Port + ' 当前无监听，服务未运行。'))
}
$add.Invoke('============================================================')

$reportPath = Join-Path $logDir ('report-' + $finishedAt.ToString('yyyyMMdd-HHmmss') + '.md')
try {
    $header = @()
    $header += '# 后端断开分析报告'
    $header += ''
    $header += ('- 生成时间：' + $finishedAt.ToString('yyyy-MM-dd HH:mm:ss'))
    $header += ('- 分析区间：' + $since.ToString('yyyy-MM-dd HH:mm:ss') + ' ~ ' + $finishedAt.ToString('yyyy-MM-dd HH:mm:ss') + '（最近 ' + $LookbackMinutes + ' 分钟）')
    $header += ('- 项目路径：' + $Root)
    $header += ''
    $header += '```'
    $body = $header -join "`r`n"
    $body = $body + "`r`n" + $sb.ToString() + "`r`n" + '```' + "`r`n"
    $body | Out-File -LiteralPath $reportPath -Encoding UTF8
    Write-Host ''
    Write-Host ('报告已保存：' + $reportPath) -ForegroundColor Green
} catch {
    Write-Host ('报告保存失败：' + $_.Exception.Message) -ForegroundColor Red
}

if ($csvPath -ne $null) {
    Write-Host ('采样数据：' + $csvPath)
}
