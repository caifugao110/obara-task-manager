#!/bin/bash

# ======================
# Obara Task Manager Startup Script for macOS/Linux
# Version: 2.0
# ======================

set -e  # Exit on error

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
DIM='\033[90m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${SCRIPT_DIR}/backend"
FRONTEND_DIR="${SCRIPT_DIR}/frontend"
BACKEND_PORT=5000
FRONTEND_PORT=5173

# PIDs
BACKEND_PID=""
FRONTEND_PID=""

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}正在停止所有服务...${NC}"
    if [ -n "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null || true
        echo -e "${GREEN}[✓] 后端服务已停止${NC}"
    fi
    if [ -n "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null || true
        echo -e "${GREEN}[✓] 前端服务已停止${NC}"
    fi
    exit 0
}

# Set trap for cleanup
trap cleanup SIGINT SIGTERM

# Print banner
print_banner() {
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  ║          OBara Task Manager 启动脚本 v2.0                  ║${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
}

# Check Node.js
check_node() {
    echo -e "[${CYAN}1/6${NC}] ${BOLD}检查 Node.js...${NC}"
    if ! command -v node &> /dev/null; then
        echo -e "${RED}[错误] Node.js 未安装${NC}"
        echo -e "${YELLOW}  请访问 https://nodejs.org 下载安装 LTS 版本${NC}"
        exit 1
    fi
    
    NODE_VERSION=$(node -v)
    echo -e "${GREEN}[✓]${NC} Node.js ${NODE_VERSION} 已就绪"
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        echo -e "${RED}[错误] npm 未安装${NC}"
        exit 1
    fi
    
    NPM_VERSION=$(npm -v)
    echo -e "${GREEN}[✓]${NC} npm ${NPM_VERSION} 已就绪"
}

# Check ports
check_ports() {
    echo -e "[${CYAN}2/6${NC}] ${BOLD}检查端口占用...${NC}"
    
    # Check backend port
    if lsof -Pi :${BACKEND_PORT} -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        echo -e "${YELLOW}[警告] 后端端口 ${BACKEND_PORT} 已被占用${NC}"
        echo -e "${YELLOW}  正在查找占用进程...${NC}"
        PID=$(lsof -ti:${BACKEND_PORT})
        echo -e "${YELLOW}  找到进程 PID: ${PID}${NC}"
        read -p "是否终止该进程？(y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            kill -9 $PID 2>/dev/null || true
            echo -e "${GREEN}[✓] 进程已终止${NC}"
        else
            echo -e "${RED}[错误] 请手动关闭占用端口的程序后重试${NC}"
            exit 1
        fi
    else
        echo -e "${GREEN}[✓]${NC} 后端端口 ${BACKEND_PORT} 可用"
    fi
    
    # Check frontend port
    if lsof -Pi :${FRONTEND_PORT} -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        echo -e "${YELLOW}[警告] 前端端口 ${FRONTEND_PORT} 已被占用${NC}"
        PID=$(lsof -ti:${FRONTEND_PORT})
        echo -e "${YELLOW}  找到进程 PID: ${PID}${NC}"
        read -p "是否终止该进程？(y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            kill -9 $PID 2>/dev/null || true
            echo -e "${GREEN}[✓] 进程已终止${NC}"
        else
            echo -e "${RED}[错误] 请手动关闭占用端口的程序后重试${NC}"
            exit 1
        fi
    else
        echo -e "${GREEN}[✓]${NC} 前端端口 ${FRONTEND_PORT} 可用"
    fi
}

# Install dependencies
install_deps() {
    echo -e "[${CYAN}3/6${NC}] ${BOLD}安装后端依赖...${NC}"
    cd "${BACKEND_DIR}"
    if [ -d "node_modules" ]; then
        echo -e "${GREEN}[✓]${NC} 后端依赖已安装"
    else
        echo -e "${YELLOW}  正在安装依赖（首次运行可能需要几分钟）...${NC}"
        npm install
        echo -e "${GREEN}[✓]${NC} 后端依赖安装完成"
    fi

    echo -e "[${CYAN}4/6${NC}] ${BOLD}安装前端依赖...${NC}"
    cd "${FRONTEND_DIR}"
    if [ -d "node_modules" ]; then
        echo -e "${GREEN}[✓]${NC} 前端依赖已安装"
    else
        echo -e "${YELLOW}  正在安装依赖（首次运行可能需要几分钟）...${NC}"
        npm install
        echo -e "${GREEN}[✓]${NC} 前端依赖安装完成"
    fi
}

# Start backend
start_backend() {
    echo -e "[${CYAN}5/6${NC}] ${BOLD}启动后端服务...${NC}"
    cd "${BACKEND_DIR}"
    
    # Check if .env exists
    if [ ! -f ".env" ] && [ -f ".env.example" ]; then
        echo -e "${YELLOW}  未找到 .env 文件，从 .env.example 创建...${NC}"
        cp .env.example .env
        echo -e "${GREEN}[✓]${NC} .env 文件已创建，请根据实际情况修改配置"
    fi
    
    # Start backend in background
    npm run dev > /dev/null 2>&1 &
    BACKEND_PID=$!
    echo -e "${GREEN}  后端已启动 (PID: ${BACKEND_PID}, 端口：${BACKEND_PORT})${NC}"
    
    # Wait for backend to start
    sleep 3
}

# Start frontend
start_frontend() {
    echo -e "[${CYAN}6/6${NC}] ${BOLD}启动前端服务...${NC}"
    cd "${FRONTEND_DIR}"
    
    # Start frontend in background
    npm run dev > /dev/null 2>&1 &
    FRONTEND_PID=$!
    echo -e "${GREEN}  前端已启动 (PID: ${FRONTEND_PID}, 端口：${FRONTEND_PORT})${NC}"
    
    # Wait for frontend to start
    sleep 3
}

# Open browser
open_browser() {
    echo -e "${BLUE}  正在打开浏览器...${NC}"
    
    # Try to open browser based on OS
    if command -v xdg-open &> /dev/null; then
        # Linux
        xdg-open "http://localhost:${FRONTEND_PORT}" &
    elif command -v open &> /dev/null; then
        # macOS
        open "http://localhost:${FRONTEND_PORT}" &
    else
        echo -e "${YELLOW}  无法自动打开浏览器，请手动访问 http://localhost:${FRONTEND_PORT}${NC}"
    fi
}

# Print success message
print_success() {
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ║                    启动完成！祝您使用愉快                   ║${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${YELLOW}  前端地址:${NC}  http://localhost:${FRONTEND_PORT}"
    echo -e "${YELLOW}  后端地址:${NC}  http://localhost:${BACKEND_PORT}"
    echo ""
    echo -e "${YELLOW}  默认管理员:${NC} superadmin / admin123"
    echo ""
    echo -e "${DIM}  提示: 按 Ctrl+C 可停止所有服务${NC}"
    echo ""
}

# Main execution
main() {
    cd "${SCRIPT_DIR}"
    
    print_banner
    check_node
    check_ports
    install_deps
    start_backend
    start_frontend
    open_browser
    print_success
    
    # Wait for processes
    wait
}

# Run main function
main
