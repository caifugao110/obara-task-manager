# Obara 任务管理系统

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18-blue.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org/)

一个轻量级的 Excel 表格风格任务管理系统，支持多用户协作、实时同步和权限控制。

## 快速开始

### Windows 一键启动

```bat
start.bat
```

脚本会自动检查 Node.js、安装前后端依赖、启动服务并打开浏览器。

访问地址：

- 前端：http://localhost:5173
- 后端：http://localhost:5000

默认管理员账号：

- 用户名：superadmin
- 密码：admin123

### Windows 手动启动

```bat
git clone https://github.com/caifugao110/obara-task-manager.git
cd obara-task-manager
npm run install:all
npm run dev
```

然后打开浏览器访问 http://localhost:5173。

## 项目结构

```text
obara-task-manager/
├── start.bat                 # Windows 一键启动脚本
├── README.md                 # 项目说明
├── DEPLOYMENT.md             # Windows 部署指南
├── backend/                  # 后端服务
│   ├── package.json
│   ├── nodemon.json
│   ├── server.js
│   ├── db.js
│   ├── routes/
│   └── middleware/
└── frontend/                 # 前端应用
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    ├── tailwind.config.js
    └── src/
```

## 常用命令

```bat
npm run install:all      # 安装根目录、后端、前端依赖
npm run dev              # 同时启动前端和后端开发服务
npm run dev:backend      # 只启动后端
npm run dev:frontend     # 只启动前端
npm run build            # 构建前端生产产物
npm run start:backend    # 启动后端生产服务
npm run start:frontend   # 预览前端构建产物
```

## 使用说明

1. 打开 http://localhost:5173。
2. 输入用户名和密码登录。
3. 在 Dashboard 中按日期录入、编辑或删除任务工时。
4. 管理员可以进入用户管理页面创建或删除用户。

## 权限模型

管理员：

- 查看和编辑所有用户的任务
- 创建和删除用户
- 管理全部任务数据

普通用户：

- 只能查看自己的任务数据
- 只能编辑自己的任务
- 无法访问用户管理

## 数据存储

系统使用本地 JSON 文件保存数据，默认数据文件为 `backend/db.json`。首次启动时会自动初始化默认管理员账号。

建议定期备份 `backend/db.json`，并在生产使用时妥善保护该文件。

## 常见问题

### 前端能打开但数据加载失败

确认后端已启动并监听 `5000` 端口，前端代理配置位于 `frontend/vite.config.ts`。

### 端口被占用

```bat
netstat -ano | findstr "5000"
taskkill /PID <PID> /F
```

前端默认端口为 `5173`，后端默认端口为 `5000`。

### 依赖安装失败

```bat
npm cache clean --force
npm run install:all
```

必要时删除对应目录下的 `node_modules` 后重新安装。

## License

MIT License
