@echo off
chcp 65001 >nul 2>&1
setlocal

set "SCRIPT_DIR=%~dp0"
set "BACKEND_PORT=5000"
set "FRONTEND_PORT=5173"

echo ===============================================
echo OBara Task Manager stop
echo ===============================================
echo.

call :trigger_backup
call :stop_by_port %BACKEND_PORT% backend
call :stop_by_port %FRONTEND_PORT% frontend

echo.
echo Stop command complete.
echo.
pause
goto :end

:trigger_backup
echo [INFO] Creating offline backup before shutdown...
curl -s -X POST http://localhost:%BACKEND_PORT%/api/system/maintenance/offline-backup >nul 2>&1
if not errorlevel 1 (
    echo [OK] Offline backup triggered successfully.
) else (
    echo [WARN] Failed to trigger backup via API, will skip.
)
exit /b 0

:stop_by_port
set "PORT=%~1"
set "NAME=%~2"

echo.
echo --- Stopping %NAME% (port %PORT%) ---

for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    echo [INFO] Stopping PID %%p...
    taskkill /F /T /PID %%p >nul 2>&1
    if errorlevel 1 (
        echo [WARN] Failed to stop PID %%p.
    ) else (
        echo [OK] PID %%p stopped.
    )
)

ping -n 2 127.0.0.1 >nul

for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    echo [WARN] Port %PORT% still occupied, retry kill PID %%p...
    taskkill /F /T /PID %%p >nul 2>&1
)

echo [OK] %NAME% port %PORT% stopped.
exit /b 0

:end
endlocal
exit /b 0