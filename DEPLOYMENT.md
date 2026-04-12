# 部署指南

本文档介绍 Obara 任务管理系统的各种部署方式。

## 📋 目录

- [开发环境部署](#开发环境部署)
- [Docker 部署（推荐）](#docker-部署推荐)
- [生产环境部署](#生产环境部署)
- [配置说明](#配置说明)
- [常见问题](#常见问题)

---

## 开发环境部署

### 环境要求

| 软件 | 版本 | 下载链接 |
|------|------|---------|
| Node.js | 18+ | https://nodejs.org |
| npm | 9+ | 随 Node.js 安装 |
| Git | 任意版本 | https://git-scm.com |

### 快速开始

#### Windows

```bash
# 双击运行
start.bat
```

#### macOS/Linux

```bash
# 赋予执行权限
chmod +x start.sh

# 运行
./start.sh
```

### 手动部署

```bash
# 1. 克隆项目
git clone https://github.com/caifugao110/obara-task-manager.git
cd obara-task-manager

# 2. 安装依赖
npm run install:all

# 3. 配置环境变量
cd backend
cp .env.example .env

# 4. 启动服务
cd ..
npm run dev

# 5. 访问 http://localhost:5173
```

---

## Docker 部署（推荐）

### 环境要求

- Docker 20+
- Docker Compose 2.0+

### 一键部署

```bash
# 1. 克隆项目
git clone https://github.com/caifugao110/obara-task-manager.git
cd obara-task-manager

# 2. 配置环境变量（可选）
cp .env.example .env
# 编辑 .env 修改 JWT_SECRET 等配置

# 3. 启动服务
docker-compose up -d

# 4. 查看日志
docker-compose logs -f

# 5. 访问 http://localhost
```

### Docker 命令

```bash
# 查看运行状态
docker-compose ps

# 停止服务
docker-compose down

# 重启服务
docker-compose restart

# 重新构建
docker-compose build

# 查看日志
docker-compose logs -f backend
docker-compose logs -f frontend

# 进入容器
docker exec -it obara-backend sh
docker exec -it obara-frontend sh
```

### 数据持久化

Docker 会自动创建 volume 来持久化数据：

```bash
# 查看 volumes
docker volume ls

# 数据位置
# Linux: /var/lib/docker/volumes/obara-backend-data/_data
# Windows: \\wsl$\docker-desktop-data\version-pack-data\docker-desktop\volumes\obara-backend-data\_data
```

---

## 生产环境部署

### 方案一：Docker Compose（推荐）

使用官方的 docker-compose.yml，并配置环境变量：

```bash
# 创建 .env 文件
cat > .env << EOF
JWT_SECRET=your-super-secret-production-key
NODE_ENV=production
EOF

# 启动
docker-compose up -d
```

### 方案二：PM2 部署

#### 安装 PM2

```bash
npm install -g pm2
```

#### 配置 PM2

创建 `ecosystem.config.js`：

```javascript
module.exports = {
  apps: [
    {
      name: 'obara-backend',
      cwd: './backend',
      script: 'server.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
    },
    {
      name: 'obara-frontend',
      cwd: './frontend',
      script: 'npm',
      args: 'run preview',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
```

#### 启动

```bash
# 构建前端
cd frontend && npm run build

# 启动服务
pm2 start ecosystem.config.js

# 保存 PM2 配置
pm2 save

# 设置开机自启
pm2 startup
```

### 方案三：Systemd 部署

#### 创建服务文件

**后端服务** `/etc/systemd/system/obara-backend.service`：

```ini
[Unit]
Description=Obara Task Manager Backend
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/obara-task-manager/backend
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**前端服务** `/etc/systemd/system/obara-frontend.service`：

```ini
[Unit]
Description=Obara Task Manager Frontend
After=obara-backend.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/obara-task-manager/frontend
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run preview
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

#### 启动服务

```bash
# 重新加载 systemd
sudo systemctl daemon-reload

# 启动服务
sudo systemctl start obara-backend
sudo systemctl start obara-frontend

# 设置开机自启
sudo systemctl enable obara-backend
sudo systemctl enable obara-frontend

# 查看状态
sudo systemctl status obara-backend
sudo systemctl status obara-frontend
```

---

## 配置说明

### 环境变量

创建 `.env` 文件（参考 `.env.example`）：

```env
# 服务器配置
PORT=5000
NODE_ENV=production

# JWT 配置（重要！生产环境必须修改）
JWT_SECRET=your-super-secret-production-key-change-this
JWT_EXPIRES_IN=7d

# 安全配置
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=20

# 数据库配置
DB_PATH=./db.json
```

### Nginx 反向代理

如果使用 Nginx 作为反向代理：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 强制 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # 前端静态文件
    location / {
        root /var/www/obara-task-manager/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # 后端 API 代理
    location /api/ {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Socket.IO 代理
    location /socket.io/ {
        proxy_pass http://localhost:5000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

---

## 常见问题

### Q1: 端口被占用怎么办？

**A:** 修改配置文件中的端口号：

- 后端：修改 `backend/.env` 中的 `PORT`
- 前端：修改 `frontend/vite.config.ts` 中的 `server.port`

### Q2: 如何备份数据？

**A:** 复制 `db.json` 文件到安全位置：

```bash
cp backend/db.json backup-$(date +%Y%m%d).json
```

### Q3: 如何重置管理员密码？

**A:** 直接编辑 `backend/db.json`，找到 admin 用户，修改密码字段（需要使用 bcrypt 加密）。

或者使用以下脚本：

```javascript
// reset-password.js
const bcrypt = require('bcrypt');
const fs = require('fs');

const db = JSON.parse(fs.readFileSync('backend/db.json', 'utf8'));
const admin = db.users.find(u => u.role === 'superadmin');
admin.password = bcrypt.hashSync('new-password', 10);
fs.writeFileSync('backend/db.json', JSON.stringify(db, null, 2));
```

### Q4: Docker 容器无法启动？

**A:** 查看日志排查问题：

```bash
docker-compose logs backend
docker-compose logs frontend
```

常见问题：
- 端口被占用：修改 docker-compose.yml 中的端口映射
- 权限问题：确保有执行权限
- 内存不足：增加 Docker 资源限制

### Q5: 如何更新到最新版本？

**A:** 

```bash
# Git 更新
git pull origin main

# Docker 更新
docker-compose pull
docker-compose up -d --build

# 清理旧镜像
docker image prune -f
```

---

## 性能优化建议

### 1. 启用 Gzip 压缩

Nginx 配置：

```nginx
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
```

### 2. 配置缓存

静态资源设置长期缓存：

```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

### 3. 数据库优化

对于大量数据，考虑迁移到真正的数据库：

- MongoDB
- PostgreSQL
- MySQL

### 4. 使用 CDN

将静态资源托管到 CDN 加速访问。

---

## 监控与日志

### 查看日志

```bash
# Docker 方式
docker-compose logs -f backend
docker-compose logs -f frontend

# PM2 方式
pm2 logs obara-backend
pm2 logs obara-frontend

# Systemd 方式
journalctl -u obara-backend -f
journalctl -u obara-frontend -f
```

### 健康检查

```bash
# 检查后端
curl http://localhost:5000/api/users

# 检查前端
curl http://localhost
```

---

## 技术支持

如有问题，请：
1. 查看本文档
2. 搜索 [Issues](https://github.com/caifugao110/obara-task-manager/issues)
3. 创建新的 Issue

---

**最后更新**: 2026-04-12  
**版本**: 2.0
