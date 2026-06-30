# API 文档

本文档介绍 Obara 任务管理系统的所有 API 接口。

## 📋 目录

- [基础信息](#基础信息)
- [认证接口](#认证接口)
- [用户管理接口](#用户管理接口)
- [设计员管理接口](#设计员管理接口)
- [任务管理接口](#任务管理接口)
- [设置接口](#设置接口)
- [系统设置接口](#系统设置接口)
- [错误处理](#错误处理)
- [实时通信（Socket.IO）](#实时通信socketio)

---

## 基础信息

### API 地址

```
开发环境：http://localhost:5000/api
生产环境：http://your-domain.com/api
```

### 认证方式

所有需要认证的接口都需要在请求头中携带 JWT Token：

```
Authorization: Bearer <your-token>
```

### 响应格式

当前版本接口直接返回 JSON 数据体（数组或对象），不使用统一的 `{ success, data }` 包装。错误时返回：

```json
{
  "message": "错误描述",
  "code": "错误代码"
}
```

---

## 认证接口

### 1. 用户登录

**POST** `/api/auth/login`

**请求体：**
```json
{
  "username": "superadmin",
  "password": "admin123"
}
```

**响应：**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "1",
    "username": "superadmin",
    "name": "超级管理员",
    "role": "superadmin"
  }
}
```

**说明：**
- JWT 有效期默认 7 天，payload 含 `sessionId` 用于单设备登录校验
- 登录成功/失败均写入 `loginLogs`（管理员账号）
- 若关闭多设备登录，新登录会通过 Socket 推送 `session_invalidated` 给旧会话

**错误：**
- `401` - 用户名或密码错误
- `403` - 账号已被禁用（`ACCOUNT_DISABLED`）

### 2. 校验当前会话

**GET** `/api/auth/validate`

**请求头：**
```
Authorization: Bearer <token>
```

**响应（有效）：**
```json
{
  "valid": true,
  "user": {
    "id": "1",
    "username": "superadmin",
    "name": "超级管理员",
    "role": "superadmin"
  }
}
```

**响应（无效）：**
```json
{
  "valid": false,
  "code": "SESSION_INVALIDATED",
  "message": "您的账号已在其他设备登录"
}
```

---

## 用户管理接口

### 3. 获取所有用户

**GET** `/api/users`

**请求头：**
```
Authorization: Bearer <token>
```

**响应：**
```json
{
  "success": true,
  "data": [
    {
      "id": "1",
      "username": "superadmin",
      "name": "超级管理员",
      "role": "superadmin",
      "disabled": false
    },
    {
      "id": "2",
      "username": "admin",
      "name": "管理员",
      "role": "admin",
      "disabled": false
    }
  ]
}
```

### 4. 创建用户

**POST** `/api/users`

**权限：** 仅超级管理员

**请求体：**
```json
{
  "username": "newuser",
  "password": "password123",
  "name": "新用户",
  "role": "admin",
  "group": "设计组"
}
```

**响应：**
```json
{
  "success": true,
  "data": {
    "id": "3",
    "username": "newuser",
    "name": "新用户",
    "role": "admin",
    "group": "设计组",
    "disabled": false
  }
}
```

### 5. 更新用户

**PUT** `/api/users/:id`

**请求体：**
```json
{
  "username": "updateduser",
  "name": "更新后的名字",
  "disabled": true
}
```

### 6. 删除用户

**DELETE** `/api/users/:id`

**权限：** 仅超级管理员

---

## 设计员管理接口

### 7. 获取所有设计员（工作台渲染）

**GET** `/api/designers`

**访问控制：**
- 若 `settings.system.allowGuestView` 为 `true`（默认），无需登录
- 若为 `false`，需携带有效 JWT

**响应：**
```json
[
  {
    "id": "1",
    "name": "张三",
    "group": "设计一组",
    "hidden": false,
    "order": 0
  }
]
```

### 8. 获取设计员列表（管理后台）

**GET** `/api/designers/manage`

**权限：** 管理员或超级管理员（需 JWT）

**响应：** 与设计员列表相同，按 `order` 排序。

### 9. 创建设计员

**POST** `/api/designers`

**请求体：**
```json
{
  "name": "李四",
  "group": "设计一组",
  "hidden": false
}
```

### 10. 更新设计员

**PUT** `/api/designers/:id`

**请求体：**
```json
{
  "name": "李四（更新）",
  "hidden": true
}
```

### 11. 重新排序设计员

**POST** `/api/designers/reorder`

**请求体：**
```json
{
  "ids": ["3", "1", "2"]
}
```

### 12. 删除设计员

**DELETE** `/api/designers/:id`

---

## 任务管理接口

### 13. 获取任务数据

**GET** `/api/tasks`

**访问控制：** 与 `/api/designers` 相同，受 `allowGuestView` 影响。

**查询参数：**
- `month` (必需): 月份 (1-12)
- `year` (必需): 年份
- `designerId` (可选): 设计员 ID

**响应：**
```json
{
  "success": true,
  "data": [
    {
      "id": "sheet-1",
      "designerId": "1",
      "month": 1,
      "year": 2026,
      "days": {
        "2026-01-01": [
          {
            "id": "task-1",
            "taskName": "项目开发",
            "hours": 8,
            "color": "#3B82F6"
          }
        ]
      }
    }
  ]
}
```

### 14. 创建任务条目

**POST** `/api/tasks/item`

**请求体：**
```json
{
  "designerId": "1",
  "date": "2026-01-01",
  "taskName": "项目开发",
  "hours": 8,
  "color": "#3B82F6",
  "guns": [
    {
      "id": "gun-1",
      "name": "子任务 1",
      "hours": 2
    }
  ],
  "leaveType": null
}
```

**响应：**
```json
{
  "success": true,
  "data": {
    "sheetId": "sheet-1",
    "designerId": "1",
    "month": 1,
    "year": 2026,
    "date": "2026-01-01",
    "item": {
      "id": "task-1",
      "taskName": "项目开发",
      "hours": 8
    },
    "sheet": { ... }
  }
}
```

### 15. 批量创建任务

**POST** `/api/tasks/item/batch`

**请求体：**
```json
{
  "designerId": "1",
  "date": "2026-01-01",
  "items": [
    {
      "taskName": "任务 1",
      "hours": 4
    },
    {
      "taskName": "任务 2",
      "hours": 4
    }
  ]
}
```

### 16. 更新任务条目

**PUT** `/api/tasks/item`

**请求体：**
```json
{
  "designerId": "1",
  "date": "2026-01-01",
  "itemId": "task-1",
  "field": "taskName",
  "value": "更新后的任务名"
}
```

**支持的字段：**
- `taskName`: 任务名称
- `hours`: 工时
- `color`: 颜色
- `guns`: 子任务列表
- `leaveType`: 请假类型

### 17. 删除任务条目

**DELETE** `/api/tasks/item`

**请求体：**
```json
{
  "designerId": "1",
  "date": "2026-01-01",
  "itemId": "task-1"
}
```

### 18. 移动任务条目

**POST** `/api/tasks/move`

**请求体：**
```json
{
  "sourceDesignerId": "1",
  "sourceDate": "2026-01-01",
  "itemId": "task-1",
  "targetDesignerId": "2",
  "targetDate": "2026-01-02",
  "newIndex": 0
}
```

---

## 设置接口

任务报表（`/leaderboard`）与工时管理（`/work-hours`）使用独立的访问权限配置。

### 19. 获取任务报表访问设置

**GET** `/api/settings/leaderboard`

**响应：**
```json
{
  "enabled": true,
  "allowAdmins": true,
  "allowViewers": false
}
```

### 20. 更新任务报表访问设置

**PUT** `/api/settings/leaderboard`

**权限：** 仅超级管理员

**请求体：**
```json
{
  "enabled": true,
  "allowAdmins": true,
  "allowViewers": false
}
```

### 21. 获取工时管理访问设置

**GET** `/api/settings/work-hours`

**响应：** 同任务报表设置结构。

### 22. 更新工时管理访问设置

**PUT** `/api/settings/work-hours`

**权限：** 仅超级管理员

**请求体：**
```json
{
  "enabled": true,
  "allowAdmins": true,
  "allowViewers": false
}
```

---

## 系统设置接口

### 23. 获取系统设置

**GET** `/api/system/settings`

**响应：**
```json
{
  "allowGuestView": true,
  "allowMultiDevice": true
}
```

| 字段 | 说明 |
|------|------|
| `allowGuestView` | 是否允许未登录用户查看工作台及公开读取任务/设计员列表 |
| `allowMultiDevice` | 是否允许同一账号多设备同时在线 |

### 24. 更新系统设置

**PUT** `/api/system/settings`

**权限：** 仅超级管理员

**请求体：**
```json
{
  "allowGuestView": false,
  "allowMultiDevice": false
}
```

### 25. 获取管理员登录历史

**GET** `/api/system/login-logs`

**权限：** 仅超级管理员

**响应：**
```json
[
  {
    "id": "uuid",
    "userId": "1",
    "username": "zhangm",
    "name": "张明",
    "role": "admin",
    "ip": "127.0.0.1",
    "userAgent": "Mozilla/5.0 ...",
    "success": true,
    "action": "login",
    "timestamp": "2026-06-30T12:00:00.000Z"
  }
]
```

仅返回 `admin` / `superadmin` 角色记录，最多 200 条，按时间倒序。

### 26. 导出任务数据为 xlsx

**GET** `/api/system/export-xls`

**权限：** 仅超级管理员

**说明：**
- 仅导出有任务数据的月份
- 每个工作表名称为 `YYYY-MM`（如 `2026-06`）
- 列：设计员ID、设计员、日期、任务名称、工时、请假类型、背景色、枪名详情（JSON）

**响应：** `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` 文件流

**错误：**
- `404` - 没有可导出的数据

### 27. 从 xlsx 导入任务数据

**POST** `/api/system/import-xls`

**权限：** 仅超级管理员

**请求：** `multipart/form-data`，字段名 `file`，支持 `.xls` / `.xlsx`

**说明：**
- 按工作表名称解析年月，仅导入有数据行的月份
- 导入会覆盖对应「设计员 + 年 + 月」的任务 sheet
- 设计员 ID 优先匹配，否则按姓名匹配

**响应：**
```json
{
  "message": "导入成功",
  "importedMonths": ["2026-6"],
  "importedRows": 42
}
```

**错误：**
- `400` - 文件无效或没有可导入的有效月份数据

---

## 错误处理

### 常见错误代码

| 错误代码 | HTTP 状态码 | 说明 |
|---------|-----------|------|
| `AUTH_REQUIRED` | 401 | 未提供认证信息 |
| `TOKEN_INVALID` | 401 | Token 无效或过期 |
| `GUEST_VIEW_DISABLED` | 401 | 已关闭未登录查看，需先登录 |
| `SESSION_INVALIDATED` | 401 | 账号已在其他设备登录，当前会话失效 |
| `ACCOUNT_DISABLED` | 403 | 账号已被禁用 |
| `PERMISSION_DENIED` | 403 | 权限不足 |
| `VALIDATION_ERROR` | 400 | 数据验证失败 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `CONFLICT` | 409 | 资源冲突 |
| `SERVER_ERROR` | 500 | 服务器内部错误 |

### 错误响应示例

```json
{
  "success": false,
  "message": "权限不足，需要管理员角色",
  "code": "PERMISSION_DENIED",
  "details": {
    "required": ["admin", "superadmin"],
    "current": "designer"
  }
}
```

---

## 实时通信（Socket.IO）

### 连接地址

```
开发环境：ws://localhost:5000
生产环境：wss://your-domain.com
```

### 客户端发送事件

| 事件名 | 说明 | 数据格式 |
|-------|------|---------|
| `register_user` | 注册当前用户 room（用于单设备踢下线） | JWT Token 字符串 |
| `task_updated` | 任务已更新 | - |
| `start_editing` | 开始编辑单元格 | `{ designerId, date, userId, username, name }` |
| `stop_editing` | 停止编辑 | - |

### 服务器推送事件

| 事件名 | 说明 | 数据格式 |
|-------|------|---------|
| `task_refreshed` | 任务数据已刷新 | - |
| `user_editing` | 用户正在编辑 | `{ designerId, date, userId, username, name }` |
| `user_stopped_editing` | 用户停止编辑 | - |
| `session_invalidated` | 会话被新登录踢下线 | `{ reason?: string }` |

### 使用示例

```javascript
// 客户端连接
const socket = io('/');

// 监听任务刷新
socket.on('task_refreshed', () => {
  console.log('任务数据已刷新，请重新加载');
});

// 发送开始编辑事件
socket.emit('start_editing', {
  designerId: '1',
  date: '2026-01-01',
  userId: 'user-1',
  username: 'zhangsan',
  name: '张三'
});

// 发送停止编辑事件
socket.emit('stop_editing');
```

---

## 限流说明

所有 API 接口都有请求频率限制：

- **登录接口**: 20 次/15 分钟
- **其他接口**: 100 次/15 分钟

**限流响应：**
```json
{
  "success": false,
  "message": "请求过于频繁，请稍后再试",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 300
}
```

---

## 最佳实践

### 1. 错误处理

```javascript
try {
  const response = await fetch('/api/tasks', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.message);
  }
  
  return data.data;
} catch (error) {
  console.error('API 请求失败:', error);
  // 处理错误
}
```

### 2. Token 刷新

```javascript
// 检查 Token 是否过期
const isTokenExpired = (token) => {
  try {
    const decoded = jwt_decode(token);
    return decoded.exp * 1000 < Date.now();
  } catch {
    return true;
  }
};

// Token 过期后重新登录
if (isTokenExpired(token)) {
  localStorage.removeItem('token');
  window.location.href = '/login';
}
```

### 3. 请求重试

```javascript
const fetchWithRetry = async (url, options, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
};
```

---

## SDK 示例

### JavaScript/TypeScript

```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      window.location.href = '/login';
    }
    throw error;
  }
);

export default api;
```

---

**最后更新**: 2026-06-30  
**API 版本**: 2.1
