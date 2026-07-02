@echo off
chcp 65001 >nul 2>&1
setlocal

set "SCRIPT_DIR=%~dp0"
set "BACKEND_DIR=%SCRIPT_DIR%backend"
set "FRONTEND_DIR=%SCRIPT_DIR%frontend"
set "LOG_DIR=%SCRIPT_DIR%logs"
set "BACKEND_PORT=5000"
set "FRONTEND_PORT=5173"

if /i not "%~1"=="--hidden" (
    if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1
    wscript.exe //nologo "%SCRIPT_DIR%start-hidden.vbs" "%~f0" "%LOG_DIR%\startup.log" "%LOG_DIR%\startup.err.log"
    exit /b
)

call :ensure_logs

echo ===============================================
echo OBara Task Manager startup
echo ===============================================
echo.

call :check_node
if errorlevel 1 goto end

call :check_ports
if errorlevel 1 goto end

call :install_deps
if errorlevel 1 goto end

call :start_backend
if errorlevel 1 goto end

call :start_frontend
if errorlevel 1 goto end

call :open_browser

echo.
echo ===============================================
echo Startup complete
echo ===============================================
echo Frontend: http://localhost:%FRONTEND_PORT%
echo Backend:  http://localhost:%BACKEND_PORT%
echo Default admin:superadmin / admin123
echo Logs: %LOG_DIR%
echo.
ping -n 4 127.0.0.1 >nul
goto :end

:ensure_logs
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1
exit /b 0

:check_node
echo [1/7] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not available in PATH.
    echo Please install the Node.js LTS version from https://nodejs.org
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do set "NODE_VERSION=%%v"
echo [OK] Node.js %NODE_VERSION%
exit /b 0

:check_ports
echo.
echo [2/7] Checking ports...

call :release_port %BACKEND_PORT% backend
if errorlevel 1 exit /b 1

call :release_port %FRONTEND_PORT% frontend
if errorlevel 1 exit /b 1

exit /b 0

:release_port
set "PORT=%~1"
set "NAME=%~2"

netstat -ano 2>nul | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    echo [OK] %NAME% port %PORT% is available.
    exit /b 0
)

echo [WARN] %NAME% port %PORT% is already in use. Trying to stop the process...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    echo Stopping PID %%a...
    taskkill /F /T /PID %%a >nul 2>&1
)

ping -n 2 127.0.0.1 >nul
netstat -ano 2>nul | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [ERROR] %NAME% port %PORT% is still in use.
    exit /b 1
)

echo [OK] %NAME% port %PORT% has been released.
exit /b 0

:install_deps
echo.
echo [3/7] Checking backend dependencies...
cd /d "%BACKEND_DIR%"
if exist "node_modules" (
    echo [OK] Backend dependencies are installed.
) else (
    echo Installing backend dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Backend dependency installation failed.
        exit /b 1
    )
)

echo.
echo [4/7] Checking frontend dependencies...
cd /d "%FRONTEND_DIR%"
if exist "node_modules" (
    echo [OK] Frontend dependencies are installed.
) else (
    echo Installing frontend dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Frontend dependency installation failed.
        exit /b 1
    )
)

exit /b 0

:start_backend
echo.
echo [5/7] Starting backend service...
set "OBARA_BACKEND_LOG=%LOG_DIR%\backend.log"
set "OBARA_BACKEND_ERR=%LOG_DIR%\backend.err.log"
set "OBARA_BACKEND_PID=%LOG_DIR%\backend.pid"
echo [%date% %time%] Starting backend on port %BACKEND_PORT%...>> "%OBARA_BACKEND_LOG%"
wscript.exe //nologo "%SCRIPT_DIR%start-process-hidden.vbs" "%BACKEND_DIR%" "set PORT=%BACKEND_PORT%&& npm start" "%OBARA_BACKEND_LOG%" "%OBARA_BACKEND_ERR%" "%OBARA_BACKEND_PID%"
if errorlevel 1 (
    echo [ERROR] Backend service failed to start.
    exit /b 1
)
call :wait_for_port %BACKEND_PORT% "%OBARA_BACKEND_PID%" backend
if errorlevel 1 exit /b 1
exit /b 0

:start_frontend
echo.
echo [6/7] Starting frontend service...
set "OBARA_FRONTEND_LOG=%LOG_DIR%\frontend.log"
set "OBARA_FRONTEND_ERR=%LOG_DIR%\frontend.err.log"
set "OBARA_FRONTEND_PID=%LOG_DIR%\frontend.pid"
echo [%date% %time%] Starting frontend on port %FRONTEND_PORT%...>> "%OBARA_FRONTEND_LOG%"
wscript.exe //nologo "%SCRIPT_DIR%start-process-hidden.vbs" "%FRONTEND_DIR%" "npm run dev" "%OBARA_FRONTEND_LOG%" "%OBARA_FRONTEND_ERR%" "%OBARA_FRONTEND_PID%"
if errorlevel 1 (
    echo [ERROR] Frontend service failed to start.
    exit /b 1
)
call :wait_for_port %FRONTEND_PORT% "%OBARA_FRONTEND_PID%" frontend
if errorlevel 1 exit /b 1
exit /b 0

:wait_for_port
set "WAIT_PORT=%~1"
set "WAIT_PID_FILE=%~2"
set "WAIT_NAME=%~3"
type nul > "%WAIT_PID_FILE%"

for /l %%i in (1,1,20) do (
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%WAIT_PORT% " ^| findstr "LISTENING"') do (
        > "%WAIT_PID_FILE%" echo %%p
        echo [OK] %WAIT_NAME% is listening on port %WAIT_PORT%. PID: %%p
        exit /b 0
    )
    ping -n 2 127.0.0.1 >nul
)

echo [ERROR] %WAIT_NAME% did not start listening on port %WAIT_PORT%.
echo Check logs in %LOG_DIR%
exit /b 1

:open_browser
echo.
echo [7/7] Opening browser...
start "" "http://localhost:%FRONTEND_PORT%"
exit /b 0

:end
endlocal
exit /b 0
