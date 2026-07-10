@echo off
chcp 65001 >nul 2>&1
setlocal

set "SCRIPT_DIR=%~dp0"
set "LOG_DIR=%SCRIPT_DIR%logs"
set "BACKEND_PORT=5000"
set "FRONTEND_PORT=5173"
set "GRACEFUL_WAIT_SECONDS=5"

echo ===============================================
echo OBara Task Manager stop
echo ===============================================
echo.

call :stop_pid_file "%LOG_DIR%\backend.pid" backend
call :stop_pid_file "%LOG_DIR%\frontend.pid" frontend
call :stop_port %BACKEND_PORT% backend
call :stop_port %FRONTEND_PORT% frontend

echo.
echo Stop command complete.
echo.
pause
goto :end

:stop_pid_file
set "PID_FILE=%~1"
set "NAME=%~2"

if not exist "%PID_FILE%" (
    echo [INFO] %NAME% PID file not found.
    exit /b 0
)

set /p PID=<"%PID_FILE%"
if "%PID%"=="" (
    echo [INFO] %NAME% PID file is empty.
    exit /b 0
)

call :stop_graceful %PID% "%NAME%"
exit /b 0

:stop_port
set "PORT=%~1"
set "NAME=%~2"

for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    call :stop_graceful %%p "%NAME% (port %PORT%)"
)
exit /b 0

:stop_graceful
set "TARGET_PID=%~1"
set "TARGET_NAME=%~2"

echo Stopping %TARGET_NAME% PID %TARGET_PID% (graceful shutdown with SIGINT)...
taskkill /SIGINT /PID %TARGET_PID% >nul 2>&1
if errorlevel 1 (
    echo [WARN] SIGINT not supported, trying WM_CLOSE...
    taskkill /T /PID %TARGET_PID% >nul 2>&1
    if errorlevel 1 (
        echo [INFO] %TARGET_NAME% PID %TARGET_PID% was not running or could not be stopped gracefully.
        exit /b 0
    )
)

echo Waiting up to %GRACEFUL_WAIT_SECONDS% seconds for graceful shutdown...
for /l %%i in (1,1,%GRACEFUL_WAIT_SECONDS%) do (
    tasklist /FI "PID eq %TARGET_PID%" 2>nul | findstr "%TARGET_PID%" >nul 2>&1
    if errorlevel 1 (
        echo [OK] %TARGET_NAME% PID %TARGET_PID% stopped gracefully.
        exit /b 0
    )
    ping -n 2 127.0.0.1 >nul
)

echo [WARN] %TARGET_NAME% PID %TARGET_PID% did not stop within %GRACEFUL_WAIT_SECONDS% seconds. Forcing...
taskkill /F /T /PID %TARGET_PID% >nul 2>&1
if errorlevel 1 (
    echo [WARN] Could not force stop %TARGET_NAME% PID %TARGET_PID%.
) else (
    echo [OK] %TARGET_NAME% PID %TARGET_PID% forced to stop.
)
exit /b 0

:end
endlocal
exit /b 0
