@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "BACKEND_DIR=%SCRIPT_DIR%backend"
set "FRONTEND_DIR=%SCRIPT_DIR%frontend"
set "BACKEND_PORT=5000"
set "FRONTEND_PORT=5173"

set "COLOR_NORMAL=%~1"
if defined COLOR_NORMAL goto skip_color_set
set "COLOR_NORMAL="
:skip_color_set

call :init_colors

echo %CYAN%═══════════════════════════════════════════════════════════════%
echo %CYAN%  ║          OBara Task Manager 启动脚本 v2.0                  ║%
echo %CYAN%═══════════════════════════════════════════════════════════════%
echo.

call :check_node
if !errorlevel! neq 0 goto end

call :check_ports
if !errorlevel! neq 0 goto end

call :install_deps

call :start_backend
if !errorlevel! neq 0 goto end

call :start_frontend
if !errorlevel! neq 0 goto end

call :open_browser

echo.
echo %GREEN%═══════════════════════════════════════════════════════════════%
echo %GREEN%  ║                    启动完成! 祝您使用愉快                   ║%
echo %GREEN%═══════════════════════════════════════════════════════════════%
echo.
echo %YELLOW%  前端地址:%WHITE%  http://localhost:%FRONTEND_PORT%%%
echo %YELLOW%  后端地址:%WHITE%  http://localhost:%BACKEND_PORT%%%
echo.
echo %YELLOW%  默认管理员:%WHITE% admin / admin123
echo.
echo %DIM%  提示: 关闭窗口可停止所有服务%NORMAL%
echo.
timeout /t 5 >nul
goto :end

:init_colors
set "CYAN=\e[36m"
set "GREEN=\e[32m"
set "YELLOW=\e[33m"
set "RED=\e[31m"
set "WHITE=\e[37m"
set "DIM=\e[90m"
set "NORMAL=\e[0m"
set "BOLD=\e[1m"
exit /b 0

:check_node
echo [%CYAN%1/7%NORMAL%] %BOLD%检查 Node.js...%NORMAL%
node --version >nul 2>&1
if errorlevel 1 (
    echo %RED%[错误] Node.js 未安装或未配置到系统 PATH%NORMAL%
    echo %YELLOW%  请访问 https://nodejs.org 下载安装 LTS 版本%NORMAL%
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do set NODE_VERSION=%%v
echo %GREEN%[✓]%NORMAL% Node.js !NODE_VERSION! 已就绪
exit /b 0

:check_ports
echo.
echo [%CYAN%2/7%NORMAL%] %BOLD%检查端口占用...%NORMAL%

netstat -ano 2>nul | findstr ":%BACKEND_PORT% " >nul 2>&1
if not errorlevel 1 (
    echo %YELLOW%[警告] 后端端口 %BACKEND_PORT% 已被占用%NORMAL%
    echo %YELLOW%  尝试查找占用进程...%NORMAL%
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%BACKEND_PORT% " ^| findstr "LISTENING"') do (
        for /f "delims=" %%b in ('wmic process where "ProcessId=%%a" get Name 2^>nul') do (
            echo %YELLOW%  PID %%a: %%b%NORMAL%
        )
    )
    echo %YELLOW%  如果服务正在运行，前端可能已连接到现有后端%NORMAL%
) else (
    echo %GREEN%[✓]%NORMAL% 后端端口 %BACKEND_PORT% 可用
)

netstat -ano 2>nul | findstr ":%FRONTEND_PORT% " >nul 2>&1
if not errorlevel 1 (
    echo %RED%[错误] 前端端口 %FRONTEND_PORT% 已被占用%NORMAL%
    echo %RED%  请关闭占用端口的程序后重试%NORMAL%
    echo %YELLOW%  可能的解决方案:%NORMAL%
    echo %YELLOW%    - 关闭正在运行的同名应用%NORMAL%
    echo %YELLOW%    - 修改 frontend/vite.config.ts 中的端口%NORMAL%
    exit /b 1
)
echo %GREEN%[✓]%NORMAL% 前端端口 %FRONTEND_PORT% 可用
exit /b 0

:install_deps
echo.
echo [%CYAN%3/7%NORMAL%] %BOLD%安装后端依赖...%NORMAL%
cd /d "%BACKEND_DIR%"
if exist "node_modules" (
    echo %GREEN%[✓]%NORMAL% 后端依赖已安装
) else (
    echo %YELLOW%  正在安装依赖（首次运行可能需要几分钟）...%NORMAL%
    call npm install
    if errorlevel 1 (
        echo %RED%[错误] 后端依赖安装失败%NORMAL%
        exit /b 1
    )
    echo %GREEN%[✓]%NORMAL% 后端依赖安装完成
)

echo.
echo [%CYAN%4/7%NORMAL%] %BOLD%安装前端依赖...%NORMAL%
cd /d "%FRONTEND_DIR%"
if exist "node_modules" (
    echo %GREEN%[✓]%NORMAL% 前端依赖已安装
) else (
    echo %YELLOW%  正在安装依赖（首次运行可能需要几分钟）...%NORMAL%
    call npm install
    if errorlevel 1 (
        echo %RED%[错误] 前端依赖安装失败%NORMAL%
        exit /b 1
    )
    echo %GREEN%[✓]%NORMAL% 前端依赖安装完成
)
exit /b 0

:start_backend
echo.
echo [%CYAN%5/7%NORMAL%] %BOLD%启动后端服务...%NORMAL%
cd /d "%BACKEND_DIR%"
start "OBara Backend (Port %BACKEND_PORT%)" cmd /k "npm run dev"
echo %YELLOW%  后端已启动 (端口: %BACKEND_PORT%)%NORMAL%
timeout /t 2 >nul
exit /b 0

:start_frontend
echo [%CYAN%6/7%NORMAL%] %BOLD%启动前端服务...%NORMAL%
cd /d "%FRONTEND_DIR%"
start "OBara Frontend (Port %FRONTEND_PORT%)" cmd /k "npm run dev"
echo %YELLOW%  前端已启动 (端口: %FRONTEND_PORT%)%NORMAL%
timeout /t 3 >nul
exit /b 0

:open_browser
echo [%CYAN%7/7%NORMAL%] %BOLD%打开浏览器...%NORMAL%
timeout /t 2 >nul
start http://localhost:%FRONTEND_PORT%
exit /b 0

:end
endlocal
exit /b 0