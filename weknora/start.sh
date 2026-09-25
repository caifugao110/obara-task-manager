#!/usr/bin/env bash
# =============================================================================
# WeKnora 知识库服务一键启动（Linux/macOS）
#
# 步骤：
#   1. 生成 weknora/.env（含随机密钥，已存在则跳过）
#   2. docker compose up -d 启动 5 个容器并等待健康
#   3. 运行 scripts/setup.js 完成初始化（账号/模型/知识库/API Key/默认文档/写 backend/.env）
#
# 模型 API Key 三选一（setup.js 按此优先级读取，全缺才交互询问）：
#   1. 写入 weknora/.env 的 DEEPSEEK_API_KEY / BIGMODEL_API_KEY（推荐，一次配置永久生效）
#   2. 环境变量：export DEEPSEEK_API_KEY=sk-xxx ; export BIGMODEL_API_KEY=xxx.yyy
#   3. 运行时按提示输入
# =============================================================================
set -e
cd "$(dirname "$0")"

echo "==============================================="
echo " WeKnora knowledge base service startup"
echo "==============================================="
echo

command -v docker >/dev/null 2>&1 || { echo "[ERROR] 未找到 docker，请先安装 Docker。"; exit 1; }
docker info >/dev/null 2>&1 || { echo "[ERROR] Docker 引擎未运行，请先启动 docker 服务。"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "[ERROR] 未找到 node，请安装 Node.js 22+。"; exit 1; }

echo "[1/3] 生成 weknora/.env ..."
node scripts/gen-env.js

echo
echo "[2/3] 启动 WeKnora 容器（首次需拉取镜像，约 2~3GB）..."
docker compose up -d

echo
echo "等待 WeKnora app 健康检查通过（最长约 3 分钟）..."
for i in $(seq 1 36); do
  status=$(docker inspect --format '{{.State.Health.Status}}' WeKnora-app 2>/dev/null || echo "")
  if [ "$status" = "healthy" ]; then
    echo "[OK] WeKnora-app 已健康。"
    break
  fi
  if [ "$i" -eq 36 ]; then
    echo "[ERROR] WeKnora-app 未在预期时间内健康。可执行 docker compose logs app 查看原因。"
    exit 1
  fi
  sleep 5
done

echo
echo "[3/3] 初始化（账号/模型/知识库/API Key/默认文档）..."
node scripts/setup.js

echo
echo "==============================================="
echo " WeKnora 就绪"
echo "  控制台: http://localhost"
echo "  API:    http://localhost:8080"
echo "  若 backend/.env 有变更，请重启本系统后端服务。"
echo "==============================================="
