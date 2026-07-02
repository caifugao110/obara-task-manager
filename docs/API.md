# API 文档

本文档描述 Obara 任务管理系统当前后端 API。默认开发地址为：

```text
http://localhost:5000/api
```

需要认证的接口使用 JWT：

```text
Authorization: Bearer <token>
```

## 通用说明

- 大多数接口直接返回 JSON 对象或数组，不统一包裹 `success/data`。
- 错误响应通常包含 `message`，部分接口包含 `code` 或 `details`。
- `guestViewMiddleware` 控制游客是否可以读取主页面所需的任务和设计人员数据。

## 角色

| 角色 | 说明 |
|------|------|
| `superadmin` | 超级管理员 |
| `admin` | 一般管理员 |
| `user` | 普通用户 |

普通用户登录后可查看主页面，其他权限与游客一致。任务报表和工时管理是否可访问由“游客/普通用户”开关控制。

## 认证接口

### 登录

`POST /api/auth/login`

请求：

```json
{
  "username": "superadmin",
  "password": "admin123"
}
```

响应：

```json
{
  "token": "jwt-token",
  "user": {
    "id": "1",
    "username": "superadmin",
    "role": "superadmin",
    "name": "超级管理员"
  }
}
```

说明：

- 登录成功和失败都会记录登录日志，日志包含 IP、原始 `User-Agent` 和解析后的浏览器信息。
- 账号禁用时返回 `403` 和 `ACCOUNT_DISABLED`。
- 关闭多设备登录时，新登录会使旧会话失效。

### 校验当前会话

`GET /api/auth/validate`

响应：

```json
{
  "valid": true,
  "user": {
    "id": "1",
    "username": "superadmin",
    "role": "superadmin",
    "name": "超级管理员"
  }
}
```

会话失效时：

```json
{
  "valid": false,
  "code": "SESSION_INVALIDATED",
  "message": "您的账号已在其他设备登录"
}
```

## 用户接口

### 获取登录用户列表

`GET /api/users`

权限：`admin`、`superadmin`

响应：

```json
[
  {
    "id": "1",
    "username": "superadmin",
    "name": "超级管理员",
    "role": "superadmin",
    "group": "",
    "disabled": false
  }
]
```

### 创建登录用户

`POST /api/users`

权限：`superadmin`、`admin`

- `superadmin` 可创建 `superadmin`、`admin`、`user`。
- `admin` 仅可创建 `user`。

请求：

```json
{
  "username": "user001",
  "password": "123456",
  "name": "普通用户A",
  "role": "user"
}
```

`role` 可选值：`superadmin`、`admin`、`user`。

### 更新登录用户

`PUT /api/users/:id`

权限：

- `superadmin` 可更新任意用户。
- 普通管理员只能更新自己允许的字段。

请求示例：

```json
{
  "name": "新名称",
  "password": "new-password",
  "role": "admin",
  "disabled": false
}
```

### 批量删除登录用户

`POST /api/users/batch-delete`

权限：仅 `superadmin`

规则：

- 不能删除当前登录账号。
- 不能批量删除超级管理员账号。

请求：

```json
{
  "ids": ["user-id-1", "user-id-2"]
}
```

### 删除登录用户

`DELETE /api/users/:id`

权限：仅 `superadmin`

## 设计人员接口

### 获取设计人员列表

`GET /api/designers`

访问控制：

- `settings.system.allowGuestView=true` 时可未登录访问。
- 关闭未登录查看后需要有效 JWT。

响应：

```json
[
  {
    "id": "designer-1",
    "name": "张三",
    "group": "设计一组",
    "hidden": false,
    "order": 0
  }
]
```

### 获取管理后台设计人员列表

`GET /api/designers/manage`

权限：`admin`、`superadmin`

### 创建设计人员

`POST /api/designers`

权限：`admin`、`superadmin`

请求：

```json
{
  "name": "李四",
  "group": "设计一组",
  "hidden": false
}
```

规则：

- 设计人员姓名会去除首尾空格。
- 设计人员姓名不允许重复，重复时返回 `400`。

### 更新设计人员

`PUT /api/designers/:id`

权限：`admin`、`superadmin`

规则：

- 更新后的设计人员姓名不允许与其他设计人员重复。

### 设计人员排序

`POST /api/designers/reorder`

权限：`admin`、`superadmin`

请求：

```json
{
  "ids": ["designer-2", "designer-1"]
}
```

### 删除设计人员

`DELETE /api/designers/:id`

权限：`admin`、`superadmin`

### 批量删除设计人员

`POST /api/designers/batch-delete`

权限：`admin`、`superadmin`

说明：

- 只删除设计人员列表中的人员行，不清理历史任务数据。

请求：

```json
{
  "ids": ["designer-id-1", "designer-id-2"]
}
```

## 任务接口

### 获取任务数据

`GET /api/tasks`

访问控制同 `GET /api/designers`。

查询参数：

| 参数 | 必填 | 说明 |
|------|------|------|
| `month` | 否 | 月份，1-12 |
| `year` | 否 | 年份 |
| `designerId` | 否 | 设计人员 ID |

说明：

- 传入 `month` 和 `year` 时返回指定月份任务。
- 不传月份和年份时返回全部任务，供任务报表“全表搜索”使用。

响应：

```json
[
  {
    "id": "sheet-1",
    "designerId": "designer-1",
    "month": 7,
    "year": 2026,
    "days": {
      "2026-07-01": [
        {
          "id": "task-1",
          "taskName": "设计计划 12345",
          "hours": 8,
          "color": "#ffffff",
          "guns": [
            { "id": "gun-1", "name": "GUN-A", "hours": 2 }
          ],
          "leaveType": null,
          "createdAt": "2026-07-01T00:00:00.000Z",
          "createdBy": "管理员",
          "updatedAt": "2026-07-01T00:00:00.000Z",
          "updatedBy": "管理员"
        }
      ]
    }
  }
]
```

### 创建任务

`POST /api/tasks/item`

权限：需要登录。

请求：

```json
{
  "designerId": "designer-1",
  "date": "2026-07-01",
  "taskName": "设计计划 12345",
  "hours": 8,
  "color": "#ffffff",
  "guns": [
    { "id": "gun-1", "name": "GUN-A", "hours": 2 }
  ],
  "leaveType": null,
  "fontSize": "",
  "textColor": ""
}
```

规则：

- 枪名存在时，该枪名工时必须大于 0。
- 后端会写入创建者和最后修改者信息。

### 批量创建任务

`POST /api/tasks/item/batch`

权限：需要登录。

请求：

```json
{
  "designerId": "designer-1",
  "date": "2026-07-01",
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

### 更新任务字段

`PUT /api/tasks/item`

权限：需要登录。

请求：

```json
{
  "designerId": "designer-1",
  "date": "2026-07-01",
  "itemId": "task-1",
  "field": "taskName",
  "value": "更新后的任务"
}
```

常用字段：

- `taskName`
- `hours`
- `color`
- `guns`
- `leaveType`
- `fontSize`
- `textColor`

更新 `guns` 时同样校验：枪名存在时工时不能为 0。

### 删除任务

`DELETE /api/tasks/item`

权限：需要登录。

请求：

```json
{
  "designerId": "designer-1",
  "date": "2026-07-01",
  "itemId": "task-1"
}
```

### 移动任务

`POST /api/tasks/move`

权限：需要登录。

请求：

```json
{
  "sourceDesignerId": "designer-1",
  "sourceDate": "2026-07-01",
  "itemId": "task-1",
  "targetDesignerId": "designer-2",
  "targetDate": "2026-07-02",
  "newIndex": 0
}
```

说明：

- `newIndex` 可选。
- 移动后会更新最后修改者和最后修改时间。

## 页面权限设置接口

任务报表和工时管理各自使用独立配置：

```json
{
  "enabled": true,
  "allowAdmins": true,
  "allowViewers": false
}
```

字段说明：

| 字段 | 说明 |
|------|------|
| `enabled` | 页面总开关 |
| `allowAdmins` | 是否允许一般管理员访问 |
| `allowViewers` | 是否允许游客和普通用户访问 |

规则：

- `allowViewers=true` 时，后端保存结果会强制 `allowAdmins=true`。
- 前端主开关关闭时会同时关闭 `allowAdmins` 和 `allowViewers`。
- 前端主开关打开时会同时打开 `allowAdmins` 和 `allowViewers`。

### 获取任务报表权限设置

`GET /api/settings/leaderboard`

### 更新任务报表权限设置

`PUT /api/settings/leaderboard`

权限：仅 `superadmin`

### 获取工时管理权限设置

`GET /api/settings/work-hours`

### 更新工时管理权限设置

`PUT /api/settings/work-hours`

权限：仅 `superadmin`

## 系统设置接口

### 获取系统设置

`GET /api/system/settings`

响应：

```json
{
  "allowGuestView": true,
  "allowMultiDevice": true
}
```

### 更新系统设置

`PUT /api/system/settings`

权限：仅 `superadmin`

请求：

```json
{
  "allowGuestView": false,
  "allowMultiDevice": true
}
```

### 获取登录历史

`GET /api/system/login-logs`

权限：仅 `superadmin`

查询参数：

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `limit` | 否 | `200` | 返回条数，范围 1-500。系统设置页使用 `20` 显示最新记录。 |
| `username` | 否 | 空 | 按账号或姓名模糊筛选 |
| `role` | 否 | `all` | `all`、`superadmin`、`admin`、`user` |
| `success` | 否 | `all` | `all`、`true`、`false` |
| `ip` | 否 | 空 | 按 IP 模糊筛选 |
| `browser` | 否 | 空 | 按浏览器、系统、设备或原始 `User-Agent` 模糊筛选 |
| `from` | 否 | 空 | 开始日期，ISO 日期格式 |
| `to` | 否 | 空 | 结束日期，ISO 日期格式，包含当天 |

说明：

- 返回所有登录用户的登录记录。
- 按时间倒序。

响应示例：

```json
[
  {
    "id": "log-id",
    "userId": "user-id",
    "username": "user001",
    "name": "普通用户A",
    "role": "user",
    "ip": "::1",
    "userAgent": "Mozilla/5.0 ...",
    "browserInfo": {
      "browser": "Chrome",
      "os": "Windows",
      "device": "Desktop",
      "summary": "Chrome / Windows / Desktop"
    },
    "success": true,
    "action": "login",
    "timestamp": "2026-07-01T00:00:00.000Z"
  }
]
```

### 导出任务数据

`GET /api/system/export-xls`

权限：仅 `superadmin`

响应：`.xls` 文件流，文件名格式为 `obara-tasks-YYYY-MM-DD-HHmmss.xls`。

说明：

- 仅导出有任务数据的月份。
- 工作表名称为 `YYYY-MM`。
- 导出内容为前端展示形态的任务表，不导出 JSON 字段。
- 首行加高显示星期和日期，冻结窗口固定到第三行并冻结第一列。
- 每个任务和枪名单独占一行，任务颜色尽量匹配前端显示，存在内容的单元格带完整边框。

### 导入任务数据

`POST /api/system/import-xls`

权限：仅 `superadmin`

请求类型：`multipart/form-data`

字段：

| 字段 | 说明 |
|------|------|
| `file` | `.xls` 或 `.xlsx` 文件 |
| `month` | 要覆盖导入的月份，格式 `YYYY-MM` |

说明：

- 导入文件应与系统导出的 `.xls` 格式一致。
- 每次只覆盖 `month` 指定的一个月份，不允许覆盖所有月份。
- 如果工作簿名是 `YYYY-MM`，仅导入与 `month` 相同的工作表。
- 只解析存在主任务且数据不为空的任务/枪名内容，空任务、空枪名和无效工时会跳过。
- `当日合计` 和 `月总工时` 不参与导入，由系统重新计算。
- 目标月份天数与表格天数不一致时，超出的日期列自动截断，缺少的日期按空数据处理。
- 表格中不存在于系统设计员列表的设计员会跳过，不会自动新增。

响应：

```json
{
  "message": "导入成功",
  "importedMonths": ["2026-07"],
  "importedRows": 42,
  "skippedDesigners": [],
  "elapsedMs": 120
}
```

## 前端批量导入模板

管理后台中的批量导入目前由前端解析复制粘贴的表格文本，再调用现有接口逐条创建。

### 设计人员模板

```csv
name,group
张三,设计一组
李四,设计二组
```

### 登录用户模板

```csv
username,password,name,role
user001,123456,普通用户A,user
admin001,123456,管理员A,admin
```

登录用户导入不需要“分组”列。

## Socket.IO

连接地址：

```text
ws://localhost:5000
```

客户端事件：

| 事件 | 说明 |
|------|------|
| `register_user` | 注册当前用户 room，用于单设备登录踢下线 |
| `task_updated` | 通知任务已更新 |
| `start_editing` | 通知开始编辑，参数包含 `designerId`、`date`、`userId`、`username`、`name` |
| `stop_editing` | 通知停止编辑，可传 `designerId` 和 `date` 释放指定单元格；不传则释放当前 socket 的编辑状态 |

服务端事件：

| 事件 | 说明 |
|------|------|
| `task_refreshed` | 任务数据已刷新 |
| `editing_state` | 当前所有编辑中的单元格状态，连接成功后下发 |
| `user_editing` | 某用户正在编辑指定设计人员日期单元格 |
| `editing_blocked` | 当前单元格已被其他用户编辑，服务端拒绝新的编辑请求 |
| `user_stopped_editing` | 某用户停止编辑指定设计人员日期单元格 |
| `session_invalidated` | 当前会话被新登录踢下线 |

## 常见错误码

| 错误码 | HTTP | 说明 |
|--------|------|------|
| `AUTH_REQUIRED` | 401 | 未提供认证信息 |
| `TOKEN_INVALID` | 401 | Token 无效或过期 |
| `GUEST_VIEW_DISABLED` | 401 | 未登录查看已关闭 |
| `SESSION_INVALIDATED` | 401 | 会话已失效 |
| `ACCOUNT_DISABLED` | 403 | 账号已禁用 |
| `PERMISSION_DENIED` | 403 | 权限不足 |
| `VALIDATION_ERROR` | 400 | 参数校验失败 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `CONFLICT` | 409 | 资源冲突 |
| `SERVER_ERROR` | 500 | 服务端错误 |

最后更新：2026-07-02
