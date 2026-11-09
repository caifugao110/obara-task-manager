@echo off
chcp 65001 >nul 2>&1
setlocal

rem =====================================================================
rem 后端假死探测器（方案 3，由 backend-watchdog.bat 启动）
rem
rem 为什么需要它
rem ------------
rem 后端可能「活着但不响应」：共享盘 UNC 调用挂死把 libuv 线程池占满后，
rem 事件循环还在跑、端口也还在 LISTENING，但所有 HTTP 请求都排队等不到响应。
rem 这种情况下进程不会退出，nodemon 的 --exitcrash 与 watchdog 的退出码判断
rem 完全察觉不到，只能靠人工重启——2026-11 的生产故障就是这种情况。
rem
rem 本脚本每 30 秒向本机后端发一次 HTTP 请求（含超时），连续 3 次拿不到任何
rem HTTP 响应即判定假死：找到监听该端口的 PID 并 taskkill /F /T，nodemon 随之
rem 退出，watchdog 走原有的重新拉起流程。
rem
rem 参数 1 = 本次后端实例代号（watchdog 每次 spawn 递增并写入 .gen 文件）。
rem   代号变化说明后端已换代（正常重启/文件热重载），本实例立即退出，
rem   避免旧探测器误杀新实例。
rem
rem 环境变量（均有默认值）：
rem   PORT                    后端端口（start.bat 传入）
rem   OBARA_PROBE_INTERVAL    探测间隔秒数，默认 30
rem   OBARA_PROBE_TIMEOUT     单次 HTTP 超时秒数，默认 5
rem   OBARA_PROBE_FAILS       连续失败阈值，默认 3
rem =====================================================================

set "SCRIPT_DIR=%~dp0"
set "LOG_DIR=%SCRIPT_DIR%logs"
set "WATCHDOG_LOG=%LOG_DIR%\backend-watchdog.log"
set "GEN_FILE=%LOG_DIR%\backend-health-probe.gen"
set "MY_GEN=%~1"

if not defined PORT set "PORT=5000"
if not defined OBARA_PROBE_INTERVAL set "OBARA_PROBE_INTERVAL=30"
if not defined OBARA_PROBE_TIMEOUT set "OBARA_PROBE_TIMEOUT=5"
if not defined OBARA_PROBE_FAILS set "OBARA_PROBE_FAILS=3"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1

call :log "health probe started (gen %MY_GEN%, port %PORT%, every %OBARA_PROBE_INTERVAL%s, timeout %OBARA_PROBE_TIMEOUT%s)"

set /a FAILS=0
set /a ROUND=0
set /a WAIT=OBARA_PROBE_INTERVAL+1

:loop
rem 后端实例换代 → 本探测器退出
set "CURRENT_GEN="
if exist "%GEN_FILE%" set /p CURRENT_GEN=<"%GEN_FILE%"
if not "%CURRENT_GEN%"=="%MY_GEN%" (
    call :log "health probe gen %MY_GEN% retired (current gen %CURRENT_GEN%)"
    endlocal
    exit /b 0
)

set /a ROUND+=1
set "PROBE_OK=0"
rem 任何 HTTP 响应（包括 401/404）都说明事件循环还能处理请求；只有完全拿不到
rem 响应（超时/连接无响应）才算失败。用 PowerShell 是为了有明确的超时控制。
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri ('http://127.0.0.1:%PORT%/') -UseBasicParsing -TimeoutSec %OBARA_PROBE_TIMEOUT% -ErrorAction Stop; exit 0 } catch { if ($_.Exception.Response) { exit 0 } else { exit 1 } }" >nul 2>&1
if %ERRORLEVEL% EQU 0 set "PROBE_OK=1"

rem 失败计数与日志不要写在同一个括号块里：cmd 会在解析时就展开 %FAILS%，
rem 括号内打出来的会是自增前的旧值。这里用 goto 拆开。
if "%PROBE_OK%"=="1" goto probe_healthy
set /a FAILS+=1
call :log "health probe failed (%FAILS%/%OBARA_PROBE_FAILS%) on port %PORT% (round %ROUND%)"
goto probe_after
:probe_healthy
set /a FAILS=0
:probe_after

if %FAILS% GEQ %OBARA_PROBE_FAILS% call :kill_listener

ping -n %WAIT% 127.0.0.1 >nul
goto loop

rem ---------------------------------------------------------------------
rem 找出监听该端口的 PID 并杀掉整个进程树。
rem 端口仍在 LISTENING 却没有 HTTP 响应，正是「假死」的特征；
rem nodemon 看到子进程退出后会因 --exitcrash 一并退出，watchdog 随即重启。
rem ---------------------------------------------------------------------
:kill_listener
set "FOUND="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    if not defined FOUND set "FOUND=%%p"
)
if not defined FOUND (
    call :log "[WARN] health probe: port %PORT% has no listener, nothing to kill"
    set /a FAILS=0
    exit /b 0
)
call :log "[FATAL] backend unresponsive %OBARA_PROBE_FAILS% consecutive probes on port %PORT% (PID %FOUND%) - killing process tree"
taskkill /F /T /PID %FOUND% >nul 2>&1
if errorlevel 1 (
    call :log "[WARN] taskkill PID %FOUND% failed, will retry on next probe round"
) else (
    call :log "health probe: killed PID %FOUND%, waiting for watchdog to restart"
    set /a FAILS=0
)
exit /b 0

rem ---------------------------------------------------------------------
rem 写一行到 watchdog 日志并回显到 stdout（start.bat 会重定向到 logs\backend.log）
rem ---------------------------------------------------------------------
:log
>>"%WATCHDOG_LOG%" echo [%date% %time%] [probe] %~1
echo [probe] %~1
exit /b 0
