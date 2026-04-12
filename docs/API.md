# API 文档

本文档介绍 Obara 任务管理系统的所有 API 接口。

## 📋 目录

- [基础信息](#基础信息)
- [认证接口](#认证接口)
- [用户管理接口](#用户管理接口)
- [设计员管理接口](#设计员管理接口)
- [任务管理接口](#任务管理接口)
- [设置接口](#设置接口)
- [错误处理](#错误处理)

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

**成功响应：**
```json
{
  "success": true,
  "data": { ... }
}
```

**错误响应：**
```json
{
  "success": false,
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
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "1",
      "username": "superadmin",
      "name": "超级管理员",
      "role": "superadmin"
    }
  }
}
```

**错误：**
- `401` - 用户名或密码错误
- `403` - 账号已被禁用

---

## 用户管理接口

### 2. 获取所有用户

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

### 3. 创建用户

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

### 4. 更新用户

**PUT** `/api/users/:id`

**请求体：**
```json
{
  "username": "updateduser",
  "name": "更新后的名字",
  "disabled": true
}
```

### 5. 删除用户

**DELETE** `/api/users/:id`

**权限：** 仅超级管理员

---

## 设计员管理接口

### 6. 获取所有设计员

**GET** `/api/designers`

**响应：**
```json
{
  "success": true,
  "data": [
    {
      "id": "1",
      "name": "张三",
      "group": "设计一组",
      "hidden": false,
      "order": 1
    }
  ]
}
```

### 7. 创建设计员

**POST** `/api/designers`

**请求体：**
```json
{
  "name": "李四",
  "group": "设计一组",
  "hidden": false
}
```

### 8. 更新设计员

**PUT** `/api/designers/:id`

**请求体：**
```json
{
  "name": "李四（更新）",
  "hidden": true
}
```

### 9. 重新排序设计员

**POST** `/api/designers/reorder`

**请求体：**
```json
{
  "ids": ["3", "1", "2"]
}
```

### 10. 删除设计员

**DELETE** `/api/designers/:id`

---

## 任务管理接口

### 11. 获取任务数据

**GET** `/api/tasks`

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

### 12. 创建任务条目

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

### 13. 批量创建任务

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

### 14. 更新任务条目

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

### 15. 删除任务条目

**DELETE** `/api/tasks/item`

**请求体：**
```json
{
  "designerId": "1",
  "date": "2026-01-01",
  "itemId": "task-1"
}
```

### 16. 移动任务条目

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

### 17. 获取报表设置

**GET** `/api/settings/leaderboard`

**响应：**
```json
{
  "success": true,
  "data": {
    "enabled": true,
    "allowAdmins": true,
    "allowViewers": false
  }
}
```

### 18. 更新报表设置

**PUT** `/api/settings/leaderboard`

**权限：** 仅超级管理员

**请求体：**
```json
{
  "enabled": false,
  "allowAdmins": true,
  "allowViewers": true
}
```

---

## 错误处理

### 常见错误代码

| 错误代码 | HTTP 状态码 | 说明 |
|---------|-----------|------|
| `AUTH_REQUIRED` | 401 | 未提供认证信息 |
| `TOKEN_INVALID` | 401 | Token 无效或过期 |
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
| `task_updated` | 任务已更新 | - |
| `start_editing` | 开始编辑单元格 | `{ designerId, date, userId, username, name }` |
| `stop_editing` | 停止编辑 | - |

### 服务器推送事件

| 事件名 | 说明 | 数据格式 |
|-------|------|---------|
| `task_refreshed` | 任务数据已刷新 | - |
| `user_editing` | 用户正在编辑 | `{ designerId, date, userId, username, name }` |
| `user_stopped_editing` | 用户停止编辑 | - |

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

**最后更新**: 2026-04-12  
**API 版本**: 2.0
