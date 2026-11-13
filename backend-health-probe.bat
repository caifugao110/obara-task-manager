@echo off
chcp 65001 >nul 2>&1
setlocal

rem =====================================================================
rem Backend hang detector (strategy 3, launched by backend-watchdog.bat)
rem
rem Why this exists
rem ---------------
rem The backend can be "alive but unresponsive": when a UNC share call hangs
rem and fills the libuv thread pool, the event loop keeps running and the port
rem stays LISTENING, but every HTTP request queues forever with no response.
rem In that state the process never exits, so neither nodemon's --exitcrash
rem nor the watchdog's exit-code check can detect it - the only remedy was a
rem manual restart, which caused the Nov 2026 production incident.
rem
rem This script sends one HTTP request (with timeout) to the local backend
rem every 30 seconds. After 3 consecutive rounds with no HTTP response at all
rem it declares a hang: finds the PID listening on that port and runs
rem taskkill /F /T, which makes nodemon exit (via --exitcrash) and the
rem watchdog restart it through its normal recovery flow.
rem
rem Arg 1 = this backend instance's generation number (the watchdog increments
rem   it on every spawn and writes it to the .gen file). When the number
rem   changes the backend has been replaced (normal restart / hot reload), so
rem   this probe exits immediately rather than killing the new instance.
rem
rem Environment variables (all have defaults):
rem   PORT                    backend port (passed in by start.bat)
rem   OBARA_PROBE_INTERVAL    probe interval in seconds, default 30
rem   OBARA_PROBE_TIMEOUT     single HTTP timeout in seconds, default 5
rem   OBARA_PROBE_FAILS       consecutive-failure threshold, default 3
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
rem Backend instance generation changed -> this probe retires
set "CURRENT_GEN="
if exist "%GEN_FILE%" set /p CURRENT_GEN=<"%GEN_FILE%"
if not "%CURRENT_GEN%"=="%MY_GEN%" (
    call :log "health probe gen %MY_GEN% retired (current gen %CURRENT_GEN%)"
    endlocal
    exit /b 0
)

set /a ROUND+=1
set "PROBE_OK=0"
rem Any HTTP response (even 401/404) proves the event loop still serves
rem requests; only a complete lack of response (timeout / connection dead)
rem counts as failure. PowerShell is used for its explicit timeout control.
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri ('http://127.0.0.1:%PORT%/') -UseBasicParsing -TimeoutSec %OBARA_PROBE_TIMEOUT% -ErrorAction Stop; exit 0 } catch { if ($_.Exception.Response) { exit 0 } else { exit 1 } }" >nul 2>&1
if %ERRORLEVEL% EQU 0 set "PROBE_OK=1"

rem Keep the failure counter and its log out of the same parenthesised block:
rem cmd expands %FAILS% at parse time, so inside a block it would print the
rem pre-increment value. Use goto to split them apart.
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
rem Find the PID listening on this port and kill its entire process tree.
rem A port that is still LISTENING yet answers no HTTP is the very signature
rem of a "hang"; once nodemon sees its child exit it exits too (--exitcrash),
rem and the watchdog restarts the backend right after.
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
rem Append one line to the watchdog log and echo to stdout (start.bat
rem redirects stdout into logs\backend.log)
rem ---------------------------------------------------------------------
:log
>>"%WATCHDOG_LOG%" echo [%date% %time%] [probe] %~1
echo [probe] %~1
exit /b 0
