# Obara 任务管理系统

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18-blue.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)

一个轻量级的「Excel 表格风格」任务管理系统，支持多用户协作、实时同步和权限控制。

## 🚀 快速开始

### 方式一：使用 Docker（推荐 - 最简单）

```bash
# 1. 克隆项目
git clone https://github.com/caifugao110/obara-task-manager.git
cd obara-task-manager

# 2. 一键启动
docker-compose up -d

# 3. 访问系统
打开浏览器访问：http://localhost

# 默认管理员账号：
# 用户名：superadmin
# 密码：admin123
```

### 方式二：本地开发

#### Windows 用户

```bash
# 双击运行
start.bat
```

#### macOS/Linux 用户

```bash
# 赋予执行权限
chmod +x start.sh

# 运行脚本
./start.sh
```

### 方式三：手动启动

```bash
# 1. 克隆项目
git clone https://github.com/caifugao110/obara-task-manager.git
cd obara-task-manager

# 2. 安装所有依赖
npm run install:all

# 3. 启动开发服务器
npm run dev

# 4. 访问系统
打开浏览器访问：http://localhost:5173

# 默认管理员账号：
# 用户名：superadmin
# 密码：admin123
```

---

## 项目结构

```
obara-task-manager/
├── start.bat                 # Windows 一键启动脚本
├── README.md                 # 项目文档
│
├── backend/                  # 后端服务
│   ├── .env                 # 环境变量配置
│   ├── package.json         # 后端依赖
│   ├── nodemon.json         # nodemon 配置
│   ├── server.js            # 服务入口
│   ├── db.json              # 数据存储文件
│   │
│   ├── routes/              # 路由模块
│   │   ├── auth.js         # 认证路由
│   │   ├── users.js        # 用户管理路由
│   │   └── tasks.js        # 任务管理路由
│   │
│   ├── middleware/          # 中间件
│   │   └── auth.js         # 鉴权中间件
│   │
│   └── utils/              # 工具函数
│       └── db.js           # 数据库操作
│
└── frontend/               # 前端应用
    ├── package.json        # 前端依赖
    ├── vite.config.ts      # Vite 配置
    ├── index.html          # 入口 HTML
    ├── tailwind.config.js  # Tailwind 配置
    │
    ├── src/
    │   ├── main.tsx        # React 入口
    │   ├── App.tsx         # 根组件
    │   │
    │   ├── components/     # 公共组件
    │   │   ├── Login.tsx
    │   │   ├── Layout.tsx
    │   │   └── ...
    │   │
    │   ├── pages/          # 页面组件
    │   │   ├── Login.tsx
    │   │   ├── Dashboard.tsx
    │   │   └── Admin.tsx
    │   │
    │   ├── hooks/          # 自定义 Hooks
    │   │   ├── useAuth.ts
    │   │   ├── useTasks.ts
    │   │   └── useSocket.ts
    │   │
    │   ├── services/       # API 服务
    │   │   ├── api.ts
    │   │   └── auth.ts
    │   │
    │   ├── types/          # TypeScript 类型
    │   │   └── index.ts
    │   │
    │   └── utils/          # 工具函数
    │       ├── date.ts
    │       └── helpers.ts
    │
    └── public/             # 静态资源
```

---

## 使用说明

### 登录

1. 打开 `http://localhost:5173/`
2. 输入用户名和密码
3. 点击「登录」按钮

**首次使用：**
- 系统会自动创建默认管理员（如 `db.json` 中不存在 admin 用户）
- 初始账号：`admin` / `admin123`

### Dashboard 任务录入

Dashboard 按「月」展示任务数据：

#### 界面元素
| 元素 | 位置 | 说明 |
|------|------|------|
| 月份切换 | 顶部左右箭头 | 切换上/下月 |
| 用户行 | 左侧 | 每行一个用户 |
| 日期列 | 顶部 | 1日到31日 |
| 月总工时 | 最右侧 | 用户本月累计 |
| 底部汇总 | 表格底部 | 全员每日/月总计 |

#### 操作步骤

**添加任务：**
1. 点击某天单元格内的「添加」按钮
2. 输入任务名称
3. 输入工时（支持 0.5 步进）
4. 系统自动保存

**编辑任务：**
- 直接点击任务名称或工时进行编辑
- 修改后自动保存

**删除任务：**
- 点击任务右侧的删除按钮

### 用户管理（仅管理员）

1. 点击顶部导航「用户管理」
2. 可查看用户列表
3. 点击「新增用户」创建新用户
4. 点击用户右侧「删除」移除用户

---

## 权限模型

### 角色说明

#### 管理员 (admin)
- ✅ Dashboard：查看/编辑所有用户
- ✅ 用户管理：创建/删除用户
- ✅ 任务操作：增/删/改任意用户的任务

#### 普通用户 (user)
- ✅ Dashboard：仅能看到自己的数据
- ❌ 用户管理：不可访问
- ✅ 任务操作：仅能操作自己的任务

### 权限验证

所有 API 请求都需要携带 JWT Token：
```http
Authorization: Bearer <token>
```

后端中间件会自动验证 token 并检查权限。

---

## API 接口

### 认证接口

#### POST /api/auth/login
登录并获取 Token

**请求体：**
```json
{
  "username": "admin",
  "password": "admin123"
}
```

**响应：**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "xxx",
    "username": "admin",
    "role": "admin",
    "name": "管理员"
  }
}
```

---

### 用户管理接口

#### GET /api/users
获取用户列表（需管理员权限）

**响应：**
```json
[
  {
    "id": "xxx",
    "username": "admin",
    "role": "admin",
    "name": "管理员"
  }
]
```

#### POST /api/users
创建新用户（需管理员权限）

**请求体：**
```json
{
  "username": "newuser",
  "password": "123456",
  "name": "新用户",
  "role": "user"
}
```

#### DELETE /api/users/:id
删除用户（需管理员权限）

---

### 任务管理接口

#### GET /api/tasks
获取任务数据

**查询参数：**
| 参数 | 必填 | 说明 |
|------|------|------|
| month | 是 | 月份 (1-12) |
| year | 是 | 年份 |
| userId | 否 | 用户ID（仅管理员可用） |

**响应：**
```json
{
  "userId": "xxx",
  "month": 4,
  "year": 2026,
  "days": {
    "2026-04-01": [
      { "id": "item1", "taskName": "任务A", "hours": 8 }
    ]
  }
}
```

#### POST /api/tasks/item
新增任务条目

**请求体：**
```json
{
  "userId": "xxx",
  "date": "2026-04-01",
  "taskName": "新任务",
  "hours": 4
}
```

#### PUT /api/tasks/item
更新任务条目

**请求体：**
```json
{
  "userId": "xxx",
  "date": "2026-04-01",
  "itemId": "item1",
  "field": "hours",
  "value": 6
}
```

| field | 说明 |
|-------|------|
| taskName | 任务名称 |
| hours | 工时 |

#### DELETE /api/tasks/item
删除任务条目

**请求体：**
```json
{
  "userId": "xxx",
  "date": "2026-04-01",
  "itemId": "item1"
}
```

---

## 数据存储

### 数据文件

`backend/db.json` 结构：

```json
{
  "users": [
    {
      "id": "用户ID",
      "username": "账号",
      "password": "bcrypt hash",
      "role": "admin|user",
      "name": "显示名"
    }
  ],
  "tasks": [
    {
      "id": "用户月表ID",
      "userId": "所属用户ID",
      "month": 4,
      "year": 2026,
      "days": {
        "2026-04-01": [
          { "id": "任务条目ID", "taskName": "任务A", "hours": 8 }
        ],
        "2026-04-02": [
          { "id": "任务条目ID", "taskName": "任务B", "hours": 2.5 }
        ]
      }
    }
  ]
}
```

### 数据说明

- **users**：用户列表，密码使用 bcrypt 加密
- **tasks**：任务数据，按「用户+月份」存储
- **days**：以日期字符串为 key，值为当天任务数组

> ⚠️ 注意：系统在启动时会自动迁移旧数据结构（旧的「任务行 + hours map」会转换为新的按天任务数组）

---

## 常见问题

### Q1: 前端能打开但数据加载失败 (500/401)

**排查步骤：**
1. 确认后端已启动且端口为 5000
2. 检查 `frontend/vite.config.ts` 代理配置
3. 确认已登录，浏览器 LocalStorage 中有 token
4. 退出登录后重新登录

### Q2: 后端频繁重启

**原因：** nodemon 监听 `db.json` 文件变化导致

**解决方案：**
确认 `backend/nodemon.json` 存在并配置：
```json
{
  "ignore": ["db.json"]
}
```

### Q3: 修改后没有实时同步

**排查步骤：**
1. 确认后端 Socket.IO 正常启动
2. 确认前端代理 `/socket.io` 已配置
3. 测试：打开两个浏览器窗口，分别登录不同账号
4. 在一端修改任务，另一端应自动刷新

### Q4: 端口被占用

**常见端口：**
- 后端：5000
- 前端：5173

**解决方案：**
```bash
# Windows 查看端口占用
netstat -ano | findstr "5000"

# 结束占用进程
taskkill /PID <PID> /F
```

### Q5: Node_modules 安装失败

**解决方案：**
1. 删除 `node_modules` 和 `package-lock.json`
2. 清除 npm 缓存：`npm cache clean --force`
3. 重新安装：`npm install`

### Q6: 忘记管理员密码

**解决方案：**
1. 停止后端服务
2. 编辑 `backend/db.json`，找到 admin 用户
3. 将 password 字段替换为：`$2a$10$...`（admin123 的 bcrypt 哈希）
4. 重启后端

---

## 生产部署

### 部署架构

```
                    ┌─────────────┐
                    │   Nginx     │
                    │  (端口 80)  │
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
     ┌──────────┐    ┌──────────┐    ┌──────────┐
     │ Frontend │    │ Backend  │    │  Socket  │
     │ (5173)  │    │ (5000)   │    │   IO     │
     └──────────┘    └──────────┘    └──────────┘
                            │
                            ▼
                     ┌──────────┐
                     │  db.json │
                     └──────────┘
```

### 前端构建

```bash
cd frontend
npm run build
```

构建产物位于 `frontend/dist/`

### 后端配置建议

1. **使用 PM2 管理进程**：
```bash
npm install -g pm2
pm2 start backend/server.js --name obara-backend
```

2. **使用反向代理**：
- Nginx 配置转发前后端请求
- 启用 HTTPS

3. **数据库建议**：
当前使用本地 JSON 文件，适合开发/小规模使用。

如需生产化，建议迁移到：
- SQLite（轻量，无需单独安装）
- MySQL/PostgreSQL（成熟稳定）
- MongoDB（文档存储友好）

### 备份建议

- 定期备份 `backend/db.json`
- 可使用 Git 进行版本控制（注意 `.gitignore` 排除敏感数据）

---

## 附录

### 依赖版本参考

```json
// backend/package.json
{
  "dependencies": {
    "express": "^4.18.x",
    "socket.io": "^4.6.x",
    "jsonwebtoken": "^9.0.x",
    "bcrypt": "^5.1.x",
    "joi": "^17.x",
    "cors": "^2.8.x",
    "nodemon": "^3.x"
  }
}

// frontend/package.json
{
  "dependencies": {
    "react": "^18.x",
    "react-dom": "^18.x",
    "axios": "^1.6.x",
    "socket.io-client": "^4.6.x"
  }
}
```

### 浏览器兼容性

| 浏览器 | 最低版本 |
|--------|---------|
| Chrome | 90+ |
| Firefox | 88+ |
| Safari | 14+ |
| Edge | 90+ |

---

## License

MIT License

---

**文档更新时间：2026-04-03**