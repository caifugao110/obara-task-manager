@echo off
chcp 65001 >nul 2>&1
setlocal

rem =============================================================================
rem WeKnora 知识库服务一键启动（Windows）
rem
rem 步骤：
rem   1. 生成 weknora\.env（含随机密钥，已存在则跳过）
rem   2. docker compose up -d 启动 5 个容器并等待健康
rem   3. 运行 scripts\setup.js 完成初始化（账号/模型/知识库/API Key/默认文档/写 backend\.env）
rem
rem 模型 API Key 三选一（setup.js 按此优先级读取，全缺才交互询问）：
rem   1. 写入 weknora\.env 的 DEEPSEEK_API_KEY / BIGMODEL_API_KEY（推荐，一次配置永久生效）
rem   2. 环境变量：set DEEPSEEK_API_KEY=sk-xxx  &  set BIGMODEL_API_KEY=xxx.yyy
rem   3. 运行时按提示输入
rem =============================================================================

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%" >nul 2>&1

echo ===============================================
echo  WeKnora knowledge base service startup
echo ===============================================
echo.

where docker >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker 未安装或不在 PATH 中。请先安装 Docker Desktop / Docker Engine。
    goto end
)

docker info >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker 引擎未运行，请先启动 Docker Desktop（或 docker 服务）后重试。
    goto end
)

echo [1/3] 生成 weknora\.env ...
node scripts\gen-env.js
if errorlevel 1 goto end

echo.
echo [2/3] 启动 WeKnora 容器（首次需拉取镜像，约 2~3GB）...
docker compose up -d
if errorlevel 1 (
    echo [ERROR] docker compose up 失败，请检查上方输出。
    goto end
)

echo.
echo 等待 WeKnora app 健康检查通过（最长约 3 分钟）...
set /a TRIES=0
:wait_health
docker inspect --format "{{.State.Health.Status}}" WeKnora-app 2>nul | findstr /C:"healthy" >nul 2>&1
if not errorlevel 1 goto healthy
set /a TRIES+=1
if %TRIES% GEQ 36 (
    echo [ERROR] WeKnora-app 未在预期时间内健康。可执行 docker compose logs app 查看原因。
    goto end
)
ping -n 6 127.0.0.1 >nul
goto wait_health

:healthy
echo [OK] WeKnora-app 已健康。
echo.
echo [3/3] 初始化（账号/模型/知识库/API Key/默认文档）...
node scripts\setup.js
if errorlevel 1 goto end

echo.
echo ===============================================
echo  WeKnora 就绪
echo   控制台: http://localhost
echo   API:    http://localhost:8080
echo   若 backend\.env 有变更，请重启本系统后端服务。
echo ===============================================

:end
popd >nul 2>&1
endlocal
