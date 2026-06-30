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

## 主要功能

| 模块 | 路径 | 说明 |
|------|------|------|
| 工作台 | `/` | Excel 风格任务录入、拖拽、复制粘贴、实时协作 |
| 任务报表 | `/leaderboard` | 仕样号搜索、枪名周期查询 |
| 工时管理 | `/work-hours` | 月度工时排行、请假排行 |
| 用户管理 | `/admin` | 设计人员与管理员的增删改查 |
| 系统设置 | `/system-settings` | 数据导入导出、登录与安全策略（仅超级管理员） |

## 项目结构

```text
obara-task-manager/
├── start.bat                 # Windows 一键启动脚本
├── README.md                 # 项目说明
├── DEPLOYMENT.md             # Windows 部署指南
├── docs/API.md               # API 接口文档
├── backend/                  # 后端服务
│   ├── package.json
│   ├── server.js
│   ├── db.js
│   ├── routes/
│   │   ├── auth.js           # 登录、会话校验
│   │   ├── users.js          # 管理员账号
│   │   ├── designers.js      # 设计人员
│   │   ├── tasks.js          # 任务数据
│   │   ├── settings.js       # 页面访问权限
│   │   └── system.js         # 系统设置、导入导出
│   └── middleware/
└── frontend/                 # 前端应用
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── pages/
        │   ├── Dashboard.tsx
        │   ├── Leaderboard.tsx
        │   ├── WorkHours.tsx
        │   ├── Admin.tsx
        │   └── SystemSettings.tsx
        └── context/AuthContext.tsx
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
2. 使用管理员账号登录后可编辑任务；未登录时默认也可查看工作台（可在系统设置中关闭）。
3. 在 **用户管理**（`/admin`）中添加设计人员，工作台表格才会出现对应行。
4. 在 Dashboard 中按日期录入、编辑或删除任务工时。
5. 超级管理员可通过 **系统设置** 导出/导入 xlsx 数据、配置登录策略。

## 权限模型

### 超级管理员（superadmin）

- 查看和编辑所有任务
- 管理设计人员与管理员账号
- 配置任务报表、工时管理、系统设置等全部权限开关
- 导出/导入 xlsx 数据
- 查看管理员登录历史

### 一般管理员（admin）

- 查看和编辑任务数据
- 管理设计人员
- 访问任务报表、工时管理（取决于对应页面的权限开关）

### 未登录用户

- 默认可查看工作台（`allowGuestView` 开启时）
- 无法编辑任务
- 任务报表、工时管理访问取决于各页面权限设置

### 页面级访问控制

任务报表与工时管理各自独立配置以下开关（超级管理员在对应页面底部或系统设置中管理）：

- **启用功能**：总开关
- **一般管理员**：admin 角色是否可访问
- **普通查看者**：未登录或 designer 角色是否可访问

## 系统设置

超级管理员在工作台顶部点击 **系统设置** 进入，包含：

- **导出为 xls 表格**：仅导出有任务数据的月份，每个工作表对应一个年月（如 `2026-06`）
- **从 xls 表格导入**：按工作表年月导入，覆盖对应月份的设计员任务数据
- **允许未登录用户查看主页面**：关闭后未登录用户无法访问工作台
- **允许多设备同时在线**：关闭后新设备登录会使旧会话强制下线
- **管理员登录历史**：记录 admin / superadmin 的登录时间、IP、结果

## 数据存储

系统使用本地 JSON 文件保存数据，默认数据文件为 `backend/db.json`。主要字段：

```json
{
  "users": [],
  "designers": [],
  "tasks": [],
  "loginLogs": [],
  "settings": {
    "leaderboard": { "enabled": true, "allowAdmins": true, "allowViewers": false },
    "workHours": { "enabled": true, "allowAdmins": true, "allowViewers": false },
    "system": { "allowGuestView": true, "allowMultiDevice": true }
  }
}
```

首次启动时会自动初始化默认超级管理员账号。建议定期备份 `backend/db.json`，或通过系统设置导出 xlsx 作为补充备份。

## 常见问题

### 前端能打开但数据加载失败

确认后端已启动并监听 `5000` 端口，前端代理配置位于 `frontend/vite.config.ts`。若已关闭「未登录可查看主页面」，请先登录。

### 任务报表 / 工时管理一直加载或提示无设计人员

请先在 **用户管理** 中添加设计人员。设计人员为空时，上述页面会显示友好提示而非无限加载。

### 用户管理页设计人员列表为空

确认已登录管理员账号；管理页通过 `/api/designers/manage` 加载数据，需有效 Token。添加成功后点击刷新或重新进入页面。

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

## 相关文档

- [API 文档](docs/API.md)
- [Windows 部署指南](DEPLOYMENT.md)
- [变更日志](CHANGELOG.md)

## License

MIT License
