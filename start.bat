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

rem Switch to the directory of this script. It is often run from a network
rem drive / UNC path (e.g. \\192.168.160.10\GUNtools\Task\obara-task-manager).
rem CMD refuses to use a UNC path as the current directory, so "cd /d" fails
rem and later commands run from the wrong directory. pushd maps a temporary
rem drive letter for UNC paths automatically, hence pushd/popd are used here.
pushd "%SCRIPT_DIR%" >nul 2>&1

echo ===============================================
echo OBara Task Manager startup
echo ===============================================
echo.

call :check_node
if errorlevel 1 goto end

rem 已移除自动 git pull：启动时拉取远端代码并立即执行存在供应链风险，
rem 代码更新改为人工确认后执行（git pull），再运行本脚本启动服务。

call :check_ports
if errorlevel 1 goto end

call :install_deps
if errorlevel 1 goto end

call :start_backend
if errorlevel 1 goto end

call :start_frontend
if errorlevel 1 goto end

echo.
echo ===============================================
echo Startup complete
echo ===============================================
echo Frontend: http://localhost:%FRONTEND_PORT%
echo Backend:  http://localhost:%BACKEND_PORT%
echo Default admin user: superadmin (override with DEFAULT_ADMIN_USERNAME)
echo First-start password is random and printed ONCE in the backend console.
echo In hidden mode search %LOG_DIR%\backend.log for the "[INIT]" lines.
echo (Set DEFAULT_ADMIN_PASSWORD in backend\.env to define it yourself.)
echo Logs: %LOG_DIR%
echo.
echo Note: Database auto-migrates from JSON to SQLite on first start if needed.
echo.
ping -n 4 127.0.0.1 >nul
goto :end

:ensure_logs
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1
exit /b 0

:check_node
echo [1/5] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not available in PATH.
    echo Please install the Node.js LTS version from https://nodejs.org
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do set "NODE_VERSION=%%v"
echo [OK] Node.js %NODE_VERSION%

rem Node.js 22 or newer is required: better-sqlite3 13 supports Node 22+ only,
rem joi 18 needs Node 20+, pdf-parse 2.4 and pdfjs-dist 5.4 need Node 20.16+.
rem On older versions the prebuilt better-sqlite3 binary crashes with
rem "FATAL ERROR: Error::New napi_get_last_error_info", so the backend never
rem listens on port 5000. Catch that here with a clear message instead.
set "NODE_MAJOR="
for /f "tokens=1 delims=." %%m in ("%NODE_VERSION:v=%") do set "NODE_MAJOR=%%m"
if not defined NODE_MAJOR (
    echo [WARN] Could not determine the Node.js major version from "%NODE_VERSION%".
    exit /b 0
)
if %NODE_MAJOR% LSS 22 (
    echo [ERROR] Node.js %NODE_VERSION% is too old. Node.js 22 or newer is required.
    echo [ERROR] better-sqlite3 13, joi 18 and pdf-parse 2.4 all need Node.js 22+,
    echo         and the backend crashes on older versions.
    echo [HINT]  Install Node.js 22 LTS from https://nodejs.org, then run start.bat again.
    exit /b 1
)
exit /b 0

:check_ports
echo.
echo [2/5] Checking ports...

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
echo [3/5] Checking dependencies...
rem This repo uses npm workspaces (see the root package.json), so both the
rem backend and frontend packages are hoisted into the repository-root
rem node_modules.  A healthy install always contains node_modules\.bin; if
rem it is present the dependencies are ready and install is skipped.
rem Otherwise a single "npm install" at the workspace root installs the
rem backend and frontend dependencies together.  The per-service folders
rem are not checked: backend\node_modules does not exist under workspaces,
rem and frontend\node_modules only holds Vite's .vite prebundle cache.
if exist "%SCRIPT_DIR%node_modules\.bin\" (
    echo [OK] Workspace dependencies are installed.
    exit /b 0
)

echo Installing workspace dependencies for backend and frontend...
call npm install
if errorlevel 1 (
    echo [ERROR] Dependency installation failed.
    exit /b 1
)

exit /b 0

:start_backend
echo.
echo [4/5] Starting backend service...
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
echo [5/5] Starting frontend service...
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

:end
popd >nul 2>&1
endlocal
exit /b 0
