@echo off
chcp 65001 >nul 2>&1
setlocal

set "SCRIPT_DIR=%~dp0"
set "LOG_DIR=%SCRIPT_DIR%logs"
set "BACKEND_PORT=5000"
set "FRONTEND_PORT=5173"

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

echo Stopping %NAME% PID %PID%...
taskkill /F /T /PID %PID% >nul 2>&1
if errorlevel 1 (
    echo [INFO] %NAME% PID %PID% was not running or could not be stopped.
) else (
    echo [OK] %NAME% PID %PID% stopped.
)
exit /b 0

:stop_port
set "PORT=%~1"
set "NAME=%~2"

for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    echo Stopping %NAME% listener on port %PORT%, PID %%p...
    taskkill /F /T /PID %%p >nul 2>&1
    if errorlevel 1 (
        echo [WARN] Could not stop PID %%p.
    ) else (
        echo [OK] PID %%p stopped.
    )
)
exit /b 0

:end
endlocal
exit /b 0
