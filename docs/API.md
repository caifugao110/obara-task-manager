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

字段说明：

| 字段 | 说明 |
|------|------|
| `id` | 用户唯一标识 |
| `username` | 登录账号 |
| `name` | 显示名称 |
| `role` | 角色：`superadmin`、`admin`、`user` |
| `group` | 用户分组 |
| `disabled` | 是否禁用，禁用后无法登录 |

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

### 获取仕样号纳期

`POST /api/spec/delivery-date`

权限：需要登录。

请求：

```json
{
  "specNumber": "12345"
}
```

响应：

```json
{
  "success": true,
  "date": "2026-07-30"
}
```

或失败：

```json
{
  "success": false,
  "message": "获取纳期失败"
}
```

说明：

- 根据仕样号从后端 PDF 解析器获取纳期。
- 如果获取超时（超过 10 秒），返回 `获取纳期超时(超过10秒)`。



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
          "createdBy": { "id": "1", "username": "管理员", "name": "管理员" },
          "updatedAt": "2026-07-01T00:00:00.000Z",
          "updatedBy": { "id": "1", "username": "管理员", "name": "管理员" }
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
- **所有任务内容的修改（包括枪名的编辑、复制、删除）都会自动更新 `updatedAt` 和 `updatedBy` 字段。**

### 防抖保存机制

前端对任务字段变更采用 500ms 防抖保存机制：

1. 字段变更后先存入本地 `pendingChanges` 队列。
2. 等待 500ms 后自动调用 `PUT /api/tasks/item` 保存。
3. 保存成功后发出 `task_updated` Socket 事件通知其他客户端。
4. 保存成功后从 `pendingChanges` 队列中移除该变更。
5. 用户也可以通过打开任务详情模态框并点击保存按钮手动触发保存。

此机制减少了频繁操作时的网络请求次数，同时保证了数据的实时同步。

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

### 获取状态追踪权限设置

`GET /api/settings/status-tracking`

### 更新状态追踪权限设置

`PUT /api/settings/status-tracking`

权限：仅 `superadmin`

### 获取组长规则

`GET /api/settings/leader-rules`

响应示例：

```json
[
  {
    "leader": "陈大仪",
    "members": ["郭涛", "王兴龙", "王会永", "李广亮"]
  }
]
```

### 更新组长规则

`PUT /api/settings/leader-rules`

权限：仅 `superadmin`

请求：

```json
[
  {
    "leader": "组长姓名",
    "members": ["组员1", "组员2"]
  }
]
```

## 状态追踪接口

### 获取状态追踪记录

`GET /api/status-tracking/items`

无需认证。

响应：

```json
[
  {
    "id": "1234567890",
    "field1": "value1",
    "field2": "value2",
    "createdAt": "2026-07-01T00:00:00.000Z",
    "updatedAt": "2026-07-01T00:00:00.000Z"
  }
]
```

字段说明：

| 字段 | 说明 |
|------|------|
| `id` | 记录唯一标识，创建时自动生成 |
| `createdAt` | 创建时间，ISO 格式 |
| `updatedAt` | 更新时间，ISO 格式 |
| 其他字段 | 自定义字段，根据业务需求添加 |

### 创建状态追踪记录

`POST /api/status-tracking/items`

权限：`admin`、`superadmin`

请求：

```json
{
  "field1": "value1",
  "field2": "value2"
}
```

响应：返回创建的完整记录，包含 `id`、`createdAt`、`updatedAt`。

说明：
- 创建成功后通过 Socket.IO 广播 `status_tracking_updated` 事件，`action` 为 `add`

### 更新状态追踪记录

`PUT /api/status-tracking/items/:id`

权限：`admin`、`superadmin`

请求：

```json
{
  "field1": "new-value",
  "field2": "new-value"
}
```

响应：返回更新后的完整记录。

说明：
- 更新成功后通过 Socket.IO 广播 `status_tracking_updated` 事件，`action` 为 `update`
- 记录不存在时返回 `404` 和 `记录未找到`

### 删除状态追踪记录

`DELETE /api/status-tracking/items/:id`

权限：`admin`、`superadmin`

响应：

```json
{
  "success": true
}
```

说明：
- 删除成功后通过 Socket.IO 广播 `status_tracking_updated` 事件，`action` 为 `delete`
- 记录不存在时返回 `404` 和 `记录未找到`

### 批量更新状态追踪记录

`POST /api/status-tracking/items/bulk`

权限：`admin`、`superadmin`

请求：

```json
[
  {
    "id": "1234567890",
    "field1": "updated-value"
  },
  {
    "field1": "new-record-value"
  }
]
```

响应：返回所有状态追踪记录列表。

说明：

- 请求必须是数组格式，否则返回 `400` 和 `输入必须是数组`
- 已存在的记录（根据 `id` 匹配）会更新，不存在的记录会创建
- 创建的新记录会自动生成 `id`、`createdAt`、`updatedAt`
- 更新的记录会自动更新 `updatedAt` 字段
- 成功后通过 Socket.IO 广播 `status_tracking_bulk` 事件，包含所有记录列表

### 同步状态追踪记录

`POST /api/status-tracking/sync`

无需认证，用于获取所有状态追踪记录。

响应：返回所有状态追踪记录数组。

### Socket.IO 状态追踪事件

客户端事件：

| 事件 | 说明 | 参数 |
|------|------|------|
| `status_tracking_start_edit` | 通知开始编辑状态追踪记录 | `{ itemId, userId, username }` |
| `status_tracking_stop_edit` | 通知停止编辑状态追踪记录 | `{ itemId }` |

服务端事件：

| 事件 | 说明 | 参数 |
|------|------|------|
| `status_tracking_edit_start` | 某用户开始编辑指定记录 | `{ itemId, userId, username, socketId }` |
| `status_tracking_edit_stop` | 某用户停止编辑指定记录 | `{ itemId }` |
| `status_tracking_updated` | 状态追踪记录更新 | `{ action, item, itemId }` |
| `status_tracking_bulk` | 状态追踪批量更新 | `[所有记录列表]` |

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

### 获取系统版本信息

`GET /api/system/version`

无需认证。

通过 Gitee API 获取远程仓库最新提交信息，检查是否有更新。

#### 版本号格式

版本号采用 `YY-MM-DD-VN` 格式：
- `YY`：年份后两位（如 26 表示 2026 年）
- `MM`：月份（01-12）
- `DD`：日期（01-31）
- `VN`：当日版本号（V1、V2、V3...，当日多次提交时自动递增）

#### 版本比较规则

版本比较按照以下优先级依次比较：
1. 年份（YY）
2. 月份（MM）
3. 日期（DD）
4. 当日版本号（VN）

只有当远程版本严格大于本地版本时，`hasUpdate` 才返回 `true`。

#### 响应示例

响应（有更新）：

```json
{
  "currentVersion": "26-07-03",
  "hasUpdate": true,
  "latestVersion": "26-07-04"
}
```

响应（无更新或本地版本更新）：

```json
{
  "currentVersion": "26-07-04-V2",
  "hasUpdate": false,
  "latestVersion": null
}
```

响应（失败或未配置 Gitee）：

```json
{
  "currentVersion": "未知",
  "hasUpdate": false,
  "latestVersion": null
}
```

#### 字段说明

| 字段 | 说明 |
|------|------|
| `currentVersion` | 当前版本号，格式 `YY-MM-DD` 或 `YY-MM-DD-VN` |
| `hasUpdate` | 是否有远程更新（远程版本 > 本地版本） |
| `latestVersion` | 远程最新版本号，无更新或无法访问时为 `null` |

#### 说明

- 当前版本由 Git 提交信息生成，需要服务器安装 Git
- 远程版本检查通过 Gitee API 获取，需要配置以下环境变量：
  - `GITEE_TOKEN`：Gitee 个人访问令牌
  - `GITEE_REPO_OWNER`：Gitee 仓库用户名
  - `GITEE_REPO_NAME`：Gitee 仓库名称
- API 调用超时时间为 5 秒，超时后自动降级为无更新状态
- 如果未配置 Gitee 或无法访问 API，`hasUpdate` 返回 `false`
- 版本号格式：当日首次提交为 `YY-MM-DD`，当日多次提交为 `YY-MM-DD-VN`

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

## 仕样号搜索接口

### 获取仕样纳期

`POST /api/spec/delivery-date`

无需认证。

从共享目录 `\\192.168.160.6\仕样书$\` 搜索指定仕样号的最新 PDF，并尝试提取纳期信息。

请求：

```json
{
  "specNumber": "12345"
}
```

说明：

- `specNumber` 必须为纯数字。
- 系统会查找 `仕样书$\12345.PDF` 及 `12345.01.PDF` ～ `12345.99.PDF` 等版本文件，取最新版本。
- 从 PDF 中搜索"纳期"关键词，提取日期信息。
- 请求超时时间为 9 秒。
- 需要能够访问共享目录（网络权限）。

响应（成功）：

```json
{
  "success": true,
  "date": "2026-12-31"
}
```

响应（失败）：

```json
{
  "success": false,
  "message": "未找到仕样号 12345 的PDF文件"
}
```

常见失败原因：

| 消息 | 说明 |
|------|------|
| `仕样号不能为空` | 未提供 `specNumber` |
| `仕样号格式不正确` | `specNumber` 不是纯数字 |
| `无法访问共享目录，请检查网络连接和权限` | 无法访问网络共享 |
| `未找到仕样号 N 的PDF文件` | 共享目录中无对应 PDF |
| `未在PDF中找到纳期信息` | PDF 中未找到日期 |
| `获取纳期超时(超过9秒)` | 解析超时 |

### 获取仕样详细信息

`POST /api/spec/spec-info`

无需认证。

从共享目录搜索指定仕样号的最新 PDF，并提取详细信息（中间商、最终客户、项目名称、数量、纳期、营业担当等）。

请求：

```json
{
  "specNumber": "12345"
}
```

说明：

- `specNumber` 必须为纯数字。
- 系统会查找 `仕样书$\12345.PDF` 及 `12345.01.PDF` ～ `12345.99.PDF` 等版本文件，取最新版本。
- 请求超时时间为 15 秒。
- 需要能够访问共享目录（网络权限）。

响应（成功）：

```json
{
  "success": true,
  "specNumber": "12345",
  "clientName": "12345>中间商_最终客户-项目名称",
  "middleMan": "中间商名称",
  "finalClient": "最终客户名称",
  "projectName": "项目名称",
  "quantity": "100",
  "deliveryDate": "2026-12-31",
  "salesPerson": "营业担当姓名"
}
```

响应（失败）：

```json
{
  "success": false,
  "message": "获取仕样信息失败: 错误详情"
}
```

### 获取仕样 PDF 原始文本

`POST /api/spec/spec-raw-text`

无需认证。

从共享目录读取仕样书 PDF 原始文本内容，用于调试或自定义解析。

请求：

```json
{
  "specNumber": "12345"
}
```

响应（成功）：

```json
{
  "success": true,
  "lines": [
    { "line": 1, "text": "计划编号 12345" },
    { "line": 2, "text": "项目名称 XXX" }
  ],
  "rawText": "计划编号 12345\n项目名称 XXX\n..."
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

### 编辑状态管理

后端使用 `designerId::date` 作为键管理编辑会话，同一用户同时只能编辑一个单元格，切换编辑时会自动释放之前的编辑状态。多人同时使用时，同一设计人员同一天只允许一个用户编辑，其他用户会看到红色"正在编辑"提示。

### 多设备登录踢下线机制

`register_user` 事件用于注册用户 room，服务端通过 `session_invalidated` 事件通知其他设备下线。关闭多设备登录时，新登录会使旧会话失效。

### 连接恢复自动加载

Socket 重连成功后会自动触发 `task_refreshed`，前端重新加载最新数据。

### 客户端事件

| 事件 | 说明 |
|------|------|
| `connect` | Socket 连接成功（可用于检测后端是否恢复） |
| `connect_error` | Socket 连接失败（后端端口断开或网络异常） |
| `register_user` | 注册当前用户 room，用于单设备登录踢下线 |
| `task_updated` | 通知任务已更新，后端收到后会广播 `task_refreshed` 给其他客户端 |
| `start_editing` | 通知开始编辑，参数包含 `designerId`、`date`、`userId`、`username`、`name` |
| `stop_editing` | 通知停止编辑，可传 `designerId` 和 `date` 释放指定单元格；不传则释放当前 socket 的编辑状态 |

### 服务端事件

| 事件 | 说明 |
|------|------|
| `task_refreshed` | 任务数据已刷新，其他客户端收到后会重新加载数据 |
| `editing_state` | 当前所有编辑中的单元格状态，连接成功后下发 |
| `user_editing` | 某用户正在编辑指定设计人员日期单元格 |
| `editing_blocked` | 当前单元格已被其他用户编辑，服务端拒绝新的编辑请求 |
| `user_stopped_editing` | 某用户停止编辑指定设计人员日期单元格 |
| `session_invalidated` | 当前会话被新登录踢下线 |
| `status_tracking_updated` | 状态追踪记录更新，包含 `action`（add/update/delete）和 `item` 或 `itemId` |
| `status_tracking_bulk` | 状态追踪批量更新，包含所有记录列表 |

## 常见错误码

| 错误码 | HTTP | 说明 |
|--------|------|------|
| `ACCOUNT_DISABLED` | 403 | 账号已禁用 |
| `SESSION_INVALIDATED` | 401 | 会话在其他设备登录后失效 |
| `GUEST_VIEW_DISABLED` | 401 | 未登录查看已关闭，需先登录 |

未带 `code` 字段的通用错误状态：

| HTTP | 常见消息 | 说明 |
|------|----------|------|
| 400 | `输入格式不正确` | 参数校验失败 |
| 401 | `No token, authorization denied` / `Token is not valid` | 未认证或 Token 无效 |
| 403 | `管理员资源，访问被拒绝。` / `只有管理员可以编辑表格` | 权限不足 |
| 404 | `用户不存在` / `任务条目不存在` 等 | 资源不存在 |
| 500 | `服务器内部错误` | 服务端错误 |

注意：登录接口受速率限制（15 分钟内最多 20 次尝试），超限返回 `登录尝试过于频繁，请15分钟后再试`。

## 数据库迁移说明

系统启动时会自动执行数据库迁移：

1. **任务数据结构迁移**：将旧版 `hours` 对象格式迁移为新版 `days` 对象格式
2. **日期格式规范化**：统一日期格式为 `YYYY-MM-DD`，截取前 10 位
3. **配置自动补齐**：首次启动或旧版本升级时，自动补齐缺失的默认配置

迁移规则：
- 迁移过程会自动保存到 `backend/db.json`
- 迁移后会在控制台输出迁移信息
- 多次启动不会重复迁移

## 安全特性

1. **JWT 认证**：使用 JWT Token 进行身份验证，过期时间为 7 天（可通过 `JWT_EXPIRES_IN` 配置）
2. **密码加密**：使用 bcrypt 对密码进行哈希加密
3. **登录限流**：15 分钟内最多 20 次登录尝试（可通过 `RATE_LIMIT_WINDOW_MS` 和 `RATE_LIMIT_MAX` 配置）
4. **请求验证**：使用 Joi 进行请求参数验证
5. **安全头**：使用 Helmet 设置安全相关的 HTTP 头
6. **跨域保护**：配置 CORS 限制跨域请求（可通过 `CORS_ORIGIN` 配置）
7. **账号禁用**：支持禁用账号，禁用后无法登录
8. **多设备登录控制**：可配置是否允许同一账号多设备同时在线

## 环境变量配置

后端支持以下环境变量，通过 `backend/.env` 文件配置：

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `PORT` | `5000` | 后端服务端口 |
| `NODE_ENV` | `development` | 运行环境 |
| `JWT_SECRET` | `obara_task_secret_key_2026` | JWT 签名密钥，生产环境必须修改 |
| `JWT_EXPIRES_IN` | `7d` | JWT Token 过期时间 |
| `CORS_ORIGIN` | - | 允许的前端地址，多个用逗号分隔 |
| `GITEE_TOKEN` | - | Gitee API Token，用于版本检查 |
| `GITEE_REPO_OWNER` | - | Gitee 仓库用户名 |
| `GITEE_REPO_NAME` | - | Gitee 仓库名称 |
| `DB_PATH` | `./db.json` | JSON 数据库文件路径 |
| `RATE_LIMIT_WINDOW_MS` | `900000` | 登录限流窗口时间（毫秒） |
| `RATE_LIMIT_MAX` | `20` | 登录限流最大尝试次数 |

### CORS 配置示例

```env
CORS_ORIGIN=https://task.obara.com.cn,http://localhost:5173,http://127.0.0.1:5173
```

### Gitee 版本检查配置

```env
GITEE_TOKEN=a09da64c1d9e9c7420a18dfd838890b0
GITEE_REPO_OWNER=caifugao110
GITEE_REPO_NAME=obara-task-manager
```

## 配置文件结构

安全配置集中在 `backend/config/security.js`，包含：

```javascript
{
  jwt: { secret, expiresIn },
  cors: { origin, methods, credentials },
  rateLimit: { windowMs, max },
  gitee: { token, repoOwner, repoName },
  server: { port, environment },
  database: { path }
}
```

最后更新：2026-07-04
