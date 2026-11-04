@echo off
chcp 65001 >nul 2>&1
setlocal

rem =====================================================================
rem Backend supervisor used by start.bat
rem
rem Why this file exists
rem --------------------
rem nodemon restarts the backend when source files change, but it does NOT
rem restart it after a crash. On a crash it prints
rem   "[nodemon] app crashed - waiting for file changes before starting..."
rem and stays alive forever while nothing listens on port 5000, so every
rem request fails with ECONNREFUSED until somebody edits a file or
rem restarts the services by hand.
rem
rem So the watchdog does two things:
rem   1. start the backend exactly like before (npm run dev = nodemon),
rem   2. loop: whenever that process ends, start it again after a pause.
rem
rem --exitcrash makes nodemon exit (instead of idling) when the app
rem crashes, otherwise this loop would never see an exit at all.
rem
rem Environment
rem -----------
rem   PORT                 forwarded to the backend (set by start.bat)
rem   OBARA_RESTART_DELAY  seconds to wait before restarting, default 10
rem   OBARA_BACKEND_CMD    override the command line, e.g.
rem                          "node server.js"   no file watching, restart only
rem                        mainly used by automated tests
rem
rem Log: logs\backend-watchdog.log (one line per start / exit / restart)
rem =====================================================================

set "SCRIPT_DIR=%~dp0"
set "LOG_DIR=%SCRIPT_DIR%logs"
set "WATCHDOG_LOG=%LOG_DIR%\backend-watchdog.log"
set "BACKEND_DIR=%SCRIPT_DIR%backend"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1

if not defined OBARA_RESTART_DELAY set "OBARA_RESTART_DELAY=10"
if not defined OBARA_BACKEND_CMD set "OBARA_BACKEND_CMD=npm run dev -- --exitcrash"

pushd "%BACKEND_DIR%" >nul 2>&1
if errorlevel 1 (
    call :log "[FATAL] backend directory not found: %BACKEND_DIR%"
    endlocal
    exit /b 1
)

call :log "supervisor started - command [%OBARA_BACKEND_CMD%], base delay %OBARA_RESTART_DELAY%s"

set /a SPAWN=0
set /a FAILS=0

:loop
set /a SPAWN+=1

set "START_EPOCH="
call :epoch
if defined EPOCH set "START_EPOCH=%EPOCH%"

call :log "spawn #%SPAWN% (PORT=%PORT%): %OBARA_BACKEND_CMD%"

call %OBARA_BACKEND_CMD%
set "EXIT_CODE=%ERRORLEVEL%"

rem How long did that run last? Used only to tell "crashed right away"
rem (real configuration problem, back off) from "ran fine for a while"
rem (plain crash, restart quickly).
set "UPTIME=999"
call :epoch
if defined START_EPOCH if defined EPOCH set /a UPTIME=EPOCH-START_EPOCH

if %UPTIME% GEQ 60 (
    set "FAILS=0"
) else (
    set /a FAILS+=1
)

call :log "backend ended (exit code %EXIT_CODE%) after %UPTIME%s"

rem Back off only when the backend keeps dying right after start, so a
rem broken .env or a port conflict does not spin the CPU and flood logs.
set "DELAY=%OBARA_RESTART_DELAY%"
if %FAILS% GEQ 3 set "DELAY=30"
if %FAILS% GEQ 5 set "DELAY=60"
if %FAILS% GEQ 5 call :log "[WARN] %FAILS% consecutive short-lived runs - check logs\backend.err.log and logs\backend-crash.log"

set /a WAIT_SECONDS=DELAY+1
call :log "restarting in %DELAY%s"
ping -n %WAIT_SECONDS% 127.0.0.1 >nul
goto loop

rem ---------------------------------------------------------------------
rem Current unix timestamp, so run length can be computed without parsing
rem %TIME% (its format depends on the system locale).
rem Leaves the result in EPOCH; empty when PowerShell is unavailable.
rem ---------------------------------------------------------------------
:epoch
set "EPOCH="
for /f "delims=" %%t in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()" 2^>nul') do set "EPOCH=%%t"
exit /b 0

rem ---------------------------------------------------------------------
rem Append one line to the watchdog log and mirror it to stdout, which
rem start.bat redirects into logs\backend.log.
rem ---------------------------------------------------------------------
:log
>>"%WATCHDOG_LOG%" echo [%date% %time%] %~1
echo [watchdog] %~1
exit /b 0
