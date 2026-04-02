# Obara 工时/任务管理系统

一个轻量级的“Excel 表格风格”工时填报与任务管理系统：支持管理员查看全员数据、普通用户仅能维护自己的数据；支持按月切换、按天录入多个任务、每日汇总、每月汇总，并通过 Socket.IO 实现多人实时同步刷新。

## 功能特性

- Excel 风格表格：网格线、周末高亮、冻结列（设计员）、底部总计行
- 按天多任务：每个用户每天可添加多条任务，每条任务都有对应工时
- 工时统计：
  - 单用户：每天小计 + 本月总工时
  - 全员：底部汇总行（每日总计 + 本月总计）
- 自动保存：编辑单元格后自动保存（带防抖）
- 实时同步：任意用户修改后，其它客户端自动刷新
- 权限控制：
  - 管理员：admin 可查看/编辑所有用户
  - 普通用户：仅能查看/编辑自己的任务与工时

## 技术栈

- 前端：React + TypeScript + Vite + TailwindCSS + Axios + Socket.IO Client
- 后端：Node.js + Express + Joi + Socket.IO
- 存储：本地 JSON 文件（backend/db.json）

## 目录结构

```
webtask-obara/
  backend/                 后端服务（API + Socket.IO）
    routes/                路由：auth/users/tasks
    middleware/            鉴权中间件
    db.json                数据文件（本地 JSON 存储）
    server.js              服务入口
  frontend/                前端应用（Vite）
    src/pages/             页面：Login/Dashboard/Admin
```

## 环境要求

- Node.js 18+（推荐）
- npm 9+（或使用 pnpm/yarn，但本文以 npm 为例）

## 本地启动（开发模式）

### 1) 安装依赖

后端：

```bash
cd backend
npm install
```

前端：

```bash
cd ../frontend
npm install
```

### 2) 配置环境变量

后端读取 `backend/.env`：

```env
PORT=5000
```

说明：

- `PORT`：后端监听端口，默认 5000

### 3) 启动后端

```bash
cd backend
npm run dev
```

成功后会看到：

- `Server running on port 5000`

> 说明：后端使用 nodemon 进行热更新，并已配置忽略 `db.json`，避免自动保存写文件触发频繁重启（见 backend/nodemon.json）。

### 4) 启动前端

```bash
cd frontend
npm run dev
```

成功后会看到类似：

- `Local: http://localhost:5173/`

前端已配置代理：

- `/api` → `http://127.0.0.1:5000`
- `/socket.io`（WebSocket）→ `http://127.0.0.1:5000`

因此开发环境下不需要单独配置前端的 API BaseURL。

## 使用说明

### 登录

打开：`http://localhost:5173/`

系统内置初始化管理员（若 `db.json` 中不存在 `admin` 用户，会在后端启动时自动创建）：

- 用户名：`admin`
- 密码：`admin123`

你也可以在“用户管理”页创建普通用户账号。

### 任务/工时录入（Dashboard）

Dashboard 为“按月”展示：

- 顶部左右箭头切换月份
- 表格按“用户”展示一行
- 每个日期单元格内可添加多条任务（任务名称 + 工时）

#### 添加任务

- 在某一天的单元格内点击“添加”，即可新增一条任务
- 每个日期可反复添加多条任务

#### 编辑任务与工时

- 任务名称：输入文本
- 工时：输入数字（支持 0.5 步进）
- 输入后会自动保存，并在多端实时刷新

#### 删除任务

- 每条任务右侧有删除按钮，点击即可删除该任务

### 工时统计说明

页面内的统计是实时计算的：

- **单元格右下角数字**：该用户当日所有任务工时合计（当日小计）
- **最右侧“月总工时”**：该用户本月所有日期累计工时
- **底部“全员总计”**：全员每日总计 + 本月总计

## 权限模型

- 管理员（admin）：
  - Dashboard：可查看所有用户及其任务/工时
  - 用户管理：可管理用户
  - 任务/工时：可新增/编辑/删除任意用户的任务
- 普通用户（user）：
  - Dashboard：仅能看到自己的数据
  - 任务/工时：仅能新增/编辑/删除自己的任务

## 数据存储结构（backend/db.json）

本项目使用本地 JSON 文件存储，结构大致如下：

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
          { "id": "任务条目ID", "taskName": "任务A", "hours": 8 },
          { "id": "任务条目ID", "taskName": "任务B", "hours": 2.5 }
        ],
        "2026-04-02": [
          { "id": "任务条目ID", "taskName": "任务C", "hours": 4 }
        ]
      }
    }
  ]
}
```

说明：

- `tasks` 是“用户 + 月份”的数据集合（每个用户每个月最多一条）
- `days` 使用日期字符串作为 key，value 为该日期的任务数组

> 提示：系统在启动/读取数据时会自动把旧结构迁移到新结构（旧的“任务行 + hours map”会被转换为按天任务数组）。

## 主要接口（后端）

所有接口都需要 `Authorization: Bearer <token>` 头（登录后前端会自动带上）。

- `POST /api/auth/login`：登录，返回 token 与用户信息
- `GET /api/users`：获取用户列表（管理员）
- `POST /api/users`：创建用户（管理员）
- `DELETE /api/users/:id`：删除用户（管理员）
- `GET /api/tasks?month=&year=&userId=`：按月获取用户月表
  - 管理员：可选 `userId` 过滤
  - 普通用户：自动限制为本人
- `POST /api/tasks/item`：新增某天的任务条目（body: `{ userId, date, taskName?, hours? }`）
- `PUT /api/tasks/item`：更新某天的任务条目（body: `{ userId, date, itemId, field, value }`，field=taskName|hours）
- `DELETE /api/tasks/item`：删除某天的任务条目（body: `{ userId, date, itemId }`）

## 常见问题排查

### 1) 前端能打开但数据加载失败（500/401）

- 确认后端已启动且端口与 `frontend/vite.config.ts` 代理一致（默认 5000）
- 确认已登录，浏览器本地存储中有 token（退出后会清理）

### 2) 后端频繁重启

- 确认 `backend/nodemon.json` 存在并包含 `ignore: ["db.json"]`

### 3) 修改后没有实时同步

- 确认后端 Socket.IO 正常启动，前端代理 `/socket.io` 已配置
- 多开两个浏览器窗口分别登录，测试一端修改后另一端是否自动刷新

## 生产部署建议（可选）

当前项目为开发/内网轻量使用设计：

- 存储使用本地 `db.json`，不适合多实例部署与高并发
- 若要生产化，建议替换为数据库（MySQL/Postgres/SQLite 等）并增加迁移、备份与审计

## License

MIT（如需指定其它协议可自行调整）
