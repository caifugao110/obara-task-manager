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
- 请求体默认使用 `application/json`；文件导入接口使用 `multipart/form-data`。
- 日期字段通常使用 `YYYY-MM-DD`，月份字段通常使用 `YYYY-MM`，任务查询中的 `month` 使用数字 `1-12`。
- 后端会通过 Joi 或路由逻辑丢弃未知字段或返回 `400`，调用方不要依赖未声明字段被保存。
- 本文中的“管理员”指 `admin` 或 `superadmin`；“仅超级管理员”只允许 `superadmin`。

## 角色

| 角色 | 说明 |
|------|------|
| `superadmin` | 超级管理员 |
| `admin` | 一般管理员 |
| `user` | 普通用户 |

普通用户登录后可查看主页面，其他权限与游客一致。任务报表和工时管理是否可访问由“游客/普通用户”开关控制。

## 权限速查

| 能力 | 游客 | user | admin | superadmin |
|------|------|------|-------|------------|
| 查看主页面任务和设计人员 | 取决于 `allowGuestView` | 是 | 是 | 是 |
| 编辑任务 | 否 | 否 | 是 | 是 |
| 管理设计人员 | 否 | 否 | 是 | 是 |
| 管理登录用户 | 否 | 否 | 只能创建/维护普通用户 | 是 |
| 批量删除登录用户 | 否 | 否 | 否 | 是 |
| 页面权限设置 | 否 | 否 | 否 | 是 |
| 系统设置登录管理、日志管理 | 否 | 否 | 否 | 是 |
| 系统设置数据管理导出 | 否 | 否 | 取决于 `systemSettings.allowAdmins` | 是 |
| 系统设置数据管理导入 | 否 | 否 | 否 | 是 |
| 查看和修改组长规则 | 否 | 否 | 是 | 是 |
| 重置组长规则为默认 | 否 | 否 | 否 | 是 |

说明：

- `settings.leaderboard`、`settings.workHours`、`settings.statusTracking` 控制对应页面是否允许 `admin`、`user` 和游客访问。
- `settings.systemSettings.allowViewers` 后端会强制为 `false`，普通用户和游客不能进入系统设置。
- `authMiddleware` 只校验登录态；涉及写入任务、设计人员、状态追踪等接口还会继续校验角色。

## 认证接口

### 登录

`POST /api/auth/login`

请求：

```json
{
  "username": "your-username",
  "password": "your-password"
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
  },
  "forcePasswordChange": false
}
```

说明：

- 登录成功和失败都会记录登录日志，日志包含 IP、原始 `User-Agent` 和解析后的浏览器信息。
- 账号禁用时返回 `403` 和 `ACCOUNT_DISABLED`。
- 关闭多设备登录时，新登录会使旧会话失效。
- `forcePasswordChange=true` 时前端需引导用户到 `/change-password` 修改密码。
- 登录接口受速率限制（15 分钟内最多 20 次尝试），超限返回 `登录尝试过于频繁，请15分钟后再试`。

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
  },
  "forcePasswordChange": false
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

### 修改密码

`POST /api/auth/change-password`

权限：需要登录。

请求：

```json
{
  "oldPassword": "current-password",
  "newPassword": "new-password"
}
```

响应（成功）：

```json
{
  "message": "密码修改成功"
}
```

说明：

- 新密码长度至少 6 位。
- 修改成功后会自动清除 `forcePasswordChange` 标记。
- 旧密码不正确时返回 `401`。
- 超级管理员重置用户密码后，该用户 `forcePasswordChange` 会被设置为 `true`，下次登录需修改密码。

### 登出

`POST /api/auth/logout`

权限：需要登录。

响应（成功）：

```json
{
  "message": "退出成功"
}
```

说明：

- 登出后会清除用户的 `sessionToken`，使当前会话失效。
- 如果启用了单设备登录，其他设备不受影响。

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
    "disabled": false,
    "forcePasswordChange": false
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
| `forcePasswordChange` | 是否需要在下次登录后修改密码 |

说明：首次访问时会自动迁移用户数据，添加缺失的 `disabled` 和 `forcePasswordChange` 字段。

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

响应：返回创建的用户对象（不含密码），`forcePasswordChange` 默认为 `true`。

### 更新登录用户

`PUT /api/users/:id`

权限：

- `superadmin` 可更新任意用户。
- `admin` 只能更新自己。

请求示例：

```json
{
  "name": "新名称",
  "password": "new-password",
  "role": "admin",
  "disabled": false,
  "group": "设计一组"
}
```

说明：

- 修改 `password` 时会同时将 `forcePasswordChange` 设置为 `true`，该用户下次登录需修改密码。
- 仅 `superadmin` 可修改 `role`。
- `admin` 只能更新自己的信息。

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

响应：

```json
{
  "message": "已删除 2 个登录用户",
  "deletedCount": 2
}
```

### 删除登录用户

`DELETE /api/users/:id`

权限：仅 `superadmin`

规则：

- 不能删除当前登录账号。

响应：

```json
{
  "message": "用户已删除"
}
```

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

响应格式同 `GET /api/designers`。

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
- 设计人员姓名不允许重复，重复时返回 `400` 和 `设计人员姓名已存在`。

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

响应：

```json
{
  "message": "排序已更新"
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

响应：

```json
{
  "message": "已删除 2 位设计人员",
  "deletedCount": 2
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

权限：`admin`、`superadmin`。

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

响应：

```json
{
  "sheetId": "sheet-designier-1-2026-7",
  "designerId": "designer-1",
  "month": 7,
  "year": 2026,
  "date": "2026-07-01",
  "item": { ... },
  "sheet": { ... }
}
```

### 批量创建任务

`POST /api/tasks/item/batch`

权限：`admin`、`superadmin`。

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

响应：

```json
{
  "sheetId": "sheet-designier-1-2026-7",
  "designerId": "designer-1",
  "month": 7,
  "year": 2026,
  "date": "2026-07-01",
  "items": [...],
  "sheet": { ... }
}
```

### 更新任务字段

`PUT /api/tasks/item`

权限：`admin`、`superadmin`。

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

响应：

```json
{
  "sheetId": "sheet-designier-1-2026-7",
  "designerId": "designer-1",
  "month": 7,
  "year": 2026,
  "date": "2026-07-01",
  "item": { ... },
  "sheet": { ... }
}
```

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

权限：`admin`、`superadmin`。

请求：

```json
{
  "designerId": "designer-1",
  "date": "2026-07-01",
  "itemId": "task-1"
}
```

响应：

```json
{
  "message": "任务条目已删除",
  "sheetId": "sheet-designier-1-2026-7",
  "designerId": "designer-1",
  "month": 7,
  "year": 2026,
  "date": "2026-07-01",
  "sheet": { ... }
}
```

### 移动任务

`POST /api/tasks/move`

权限：`admin`、`superadmin`。

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

响应：

```json
{
  "message": "任务已移动",
  "sourceSheet": { ... },
  "targetSheet": { ... }
}
```

### 批量替换搜索

`POST /api/tasks/batch-replace/search`

权限：`admin`、`superadmin`。

用于在执行批量替换前搜索匹配项，预览替换范围。

请求：

```json
{
  "findText": "旧文本",
  "replaceText": "新文本",
  "allTable": false,
  "month": 7,
  "year": 2026
}
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `findText` | 是 | 要查找的文本 |
| `replaceText` | 否 | 替换后的文本，默认为空字符串 |
| `allTable` | 否 | 是否搜索全表，默认为 `false` |
| `month` | 否 | 月份（`allTable=false` 时必填） |
| `year` | 否 | 年份（`allTable=false` 时必填） |

响应：

```json
{
  "matches": [
    {
      "designerId": "designer-1",
      "designerName": "张三",
      "date": "2026-07-01",
      "itemId": "task-1",
      "taskName": "设计计划 12345",
      "fields": [
        { "field": "taskName", "label": "任务名", "text": "设计计划 12345", "count": 1 }
      ]
    }
  ],
  "itemCount": 1,
  "matchCount": 1,
  "scope": "month"
}
```

说明：

- 搜索范围包括任务名和枪名。
- 返回匹配的任务条目列表及每个条目中的匹配字段详情。
- `itemCount` 表示匹配的任务条目数，`matchCount` 表示总匹配次数。

### 批量替换执行

`POST /api/tasks/batch-replace`

权限：`admin`、`superadmin`。

执行批量替换操作，将指定文本替换为新文本。

请求：

```json
{
  "findText": "旧文本",
  "replaceText": "新文本",
  "allTable": false,
  "month": 7,
  "year": 2026
}
```

参数同批量替换搜索。

响应：

```json
{
  "message": "批量替换完成",
  "replacementCount": 5,
  "itemCount": 3,
  "sheetCount": 2
}
```

说明：

- 替换范围包括任务名和枪名。
- `replacementCount` 表示实际替换的次数。
- `itemCount` 表示被修改的任务条目数。
- `sheetCount` 表示被修改的工作表数。
- 批量替换会更新被修改条目的 `updatedAt` 和 `updatedBy` 字段。

## 页面权限设置接口

任务报表、工时管理、状态追踪和系统设置各自使用独立配置：

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
- `systemSettings` 配置的 `allowViewers` 始终为 `false`（系统设置不允许普通用户和游客访问）。

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

### 获取系统设置权限设置

`GET /api/settings/system-settings`

### 更新系统设置权限设置

`PUT /api/settings/system-settings`

权限：仅 `superadmin`

说明：

- 用于控制一般管理员是否可以访问系统设置页面的「数据管理」模块（仅可查看导出，不能导入）。
- `allowViewers` 字段被强制为 `false`。

### 获取工作日覆盖规则

`GET /api/settings/workday-overrides`

无需认证。

响应：

```json
{
  "2026-07-04": "workday",
  "2026-07-06": "weekend"
}
```

说明：

- 键为日期，格式 `YYYY-MM-DD`。
- 值为 `workday` 时，将自然周六/周日按普通工作日统计。
- 值为 `weekend` 时，将自然工作日按周末加班日统计。
- 未出现在响应中的日期按自然周六/周日判断。

### 更新工作日覆盖规则

`PUT /api/settings/workday-overrides`

权限：`admin`、`superadmin`

请求：

```json
{
  "date": "2026-07-04",
  "type": "workday"
}
```

字段说明：

| 字段 | 必填 | 说明 |
|------|------|------|
| `date` | 是 | 日期，格式 `YYYY-MM-DD` |
| `type` | 是 | `workday`、`weekend` 或 `null`；传 `null` 表示清除该日期覆盖规则 |

响应：返回更新后的完整工作日覆盖规则对象。

说明：

- 主页面日期表头中的管理员复选框使用该接口保存。
- 工作日工时、周末加班工时、主页面底部周末加班统计、工时管理排行和工时管理表导出均使用该规则。

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

默认规则：

```json
[
  { "leader": "陈大仪", "members": ["郭涛", "王兴龙", "王会永", "李广亮"] },
  { "leader": "张啸", "members": ["李守健", "邓明江", "贾银鑫", "熊飞"] },
  { "leader": "张明", "members": ["吴露鹭", "茅舒", "沈雨帆", "张晟隽", "刘知新", "梁科研", "吴方盛"] },
  { "leader": "陈青松", "members": ["张广奇", "李劲日", "曹圩圩", "许孟涵"] }
]
```

### 更新组长规则

`PUT /api/settings/leader-rules`

权限：`admin`、`superadmin`

请求：

```json
[
  {
    "leader": "组长姓名",
    "members": ["组员1", "组员2"]
  }
]
```

### 重置组长规则

`POST /api/settings/leader-rules/reset`

权限：仅 `superadmin`

说明：将组长规则重置为系统默认值。

响应：返回默认组长规则数组，结构同 `GET /api/settings/leader-rules`。

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

### 导出状态跟踪表

`GET /api/status-tracking/export`

权限：`admin`、`superadmin`。

查询参数：

| 参数 | 必填 | 说明 |
|------|------|------|
| `month` | 是 | 月份，格式 `YYYY-MM`，按纳期字段过滤 |
| `factory` | 否 | 按工厂筛选 |
| `searchTerm` | 否 | 搜索关键词，匹配客户名、仕样号、营业担当、组长 |
| `fullTableSearch` | 否 | 是否全表搜索，`true` 时忽略 `month` 参数 |

响应：`.xls` 文件流，文件名格式为 `status-tracking-YYYYMMDDHHmmss.xls`。

说明：

- 按纳期字段 (`deliveryDate`) 以 `YYYY-MM` 开头过滤记录（`fullTableSearch=true` 时除外）。
- 导出列包括工厂、客户、数量、纳期、已发图、未确认、总种数、反馈种数、反馈计划、下图计划及状态、确认数量、确认种数、下图种数、未下种数、未下数量、未确认数、设计纳期、营业担当、组长。
- 纳期字段会从 `YYYY-MM-DD` 转换为 `M/D` 格式。

### 检查状态跟踪表导入重复项

`POST /api/status-tracking/import/check`

权限：仅 `superadmin`

请求类型：`multipart/form-data`

字段：

| 字段 | 说明 |
|------|------|
| `file` | `.xls` 或 `.xlsx` 文件 |

响应：

```json
{
  "duplicateSpecs": ["12345", "67890"]
}
```

说明：

- 解析文件中的仕样号列，返回与现有数据库仕样号重复的列表。
- 用于导入前提示用户是否覆盖。

### 导入状态跟踪表

`POST /api/status-tracking/import`

权限：仅 `superadmin`

请求类型：`multipart/form-data`

字段：

| 字段 | 必填 | 说明 |
|------|------|------|
| `file` | 是 | `.xls` 或 `.xlsx` 文件 |
| `overwrite` | 否 | 是否覆盖已存在的仕样号记录，`'true'` 为覆盖 |

响应：

```json
{
  "importedRows": 10,
  "updatedRows": 5
}
```

说明：

- 自动根据仕样号匹配现有记录，存在则更新（仅当 `overwrite=true`），不存在则创建。
- 表头列通过模糊匹配识别（如「工厂」「客户」「数量」「纳期」「仕样号」等）。
- 导入成功后会通过 Socket.IO 广播 `status_tracking_bulk` 事件。

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
  "allowMultiDevice": true,
  "allowUserDesignPlanColorMark": true,
  "allowUserEditOwnTaskColor": true
}
```

说明：

- `allowUserDesignPlanColorMark` / `allowUserEditOwnTaskColor` 为兼容字段，含义相同。
- 缺失这两个字段时，系统默认允许登录用户修改本人设计计划标记颜色。

### 更新系统设置

`PUT /api/system/settings`

权限：仅 `superadmin`

请求：

```json
{
  "allowGuestView": false,
  "allowMultiDevice": true,
  "allowUserDesignPlanColorMark": true
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

### 获取最新管理员登录记录

`GET /api/system/admin-login-logs`

权限：仅 `superadmin`

响应：返回最新 10 条管理员（`superadmin` 或 `admin`）的登录记录数组。

说明：

- 用于系统设置页面「日志管理」模块主页显示。
- 按时间倒序排列。
- 字段结构与 `GET /api/system/login-logs` 一致。

### 获取操作日志

`GET /api/system/audit-logs`

权限：仅 `superadmin`

查询参数：

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `limit` | 否 | `100` | 每页条数 |
| `page` | 否 | `1` | 页码 |
| `username` | 否 | 空 | 按用户名精确匹配 |
| `action` | 否 | 空 | 按操作描述精确匹配 |
| `method` | 否 | 空 | 按 HTTP 方法匹配（`GET`、`POST`、`PUT`、`DELETE`） |
| `ip` | 否 | 空 | 按 IP 模糊匹配 |
| `from` | 否 | 空 | 开始日期，ISO 日期格式 |
| `to` | 否 | 空 | 结束日期，ISO 日期格式，包含当天 |

响应：

```json
{
  "logs": [
    {
      "id": "uuid",
      "userId": "1",
      "username": "superadmin",
      "name": "超级管理员",
      "role": "superadmin",
      "action": "用户登录",
      "method": "POST",
      "path": "/api/auth/login",
      "ip": "::1",
      "userAgent": "Mozilla/5.0 ...",
      "browserInfo": {
        "browser": "Chrome",
        "browserVersion": "120",
        "os": "Windows 10",
        "osVersion": "10",
        "device": "Desktop",
        "summary": "Chrome 120 / Windows 10 / Desktop"
      },
      "requestBody": null,
      "responseStatus": 200,
      "responseMessage": null,
      "durationMs": 12,
      "timestamp": "2026-07-05T10:00:00.000Z"
    }
  ],
  "total": 100,
  "page": 1,
  "pageSize": 100
}
```

说明：

- 操作日志最多保留 2000 条。
- `/api/system/login-logs` 和 `/api/system/audit-logs` 相关接口本身不会被记录。
- GET 请求不记录响应消息，POST/PUT 请求记录请求体（最大 2000 字符）。
- `browserInfo` 包含浏览器名称和版本号、操作系统和版本号、设备类型，`summary` 为拼接后的简要描述。

### 获取操作日志筛选选项

`GET /api/system/audit-logs/filter-options`

权限：仅 `superadmin`

响应：

```json
{
  "usernames": ["superadmin", "admin001"],
  "actions": [
    { "value": "用户登录", "label": "用户登录" },
    { "value": "更新任务", "label": "更新任务" },
    { "value": "导出任务数据", "label": "导出任务数据" }
  ]
}
```

说明：

- 返回当前所有出现过的用户名和操作描述列表，用于前端筛选下拉框。
- 用户名按字母排序。
- 操作列表为 `{ value, label }` 格式，按 label 的中文拼音排序。
- `value` 和 `label` 均为中文操作类型名称。

### 导出操作日志

`GET /api/system/audit-logs/export`

权限：仅 `superadmin`

查询参数：同 `GET /api/system/audit-logs`（不含 `limit` 和 `page`）。

响应：`.xls` 文件流，文件名格式为 `audit-logs-YYYY-MM-DD-HHmmss.xls`。

说明：

- 导出列包括时间、用户、姓名、操作类型、操作说明、方法、IP、状态码、耗时(ms)、浏览器信息。
- 没有可导出的日志时返回 `404`。

## 工时管理表接口

### 导出工时管理表

`GET /api/work-hours/export`

权限：需要登录且有系统设置数据管理权限。

说明：

- `superadmin` 始终可导出。
- `admin` 需要 `settings.systemSettings.enabled=true` 且 `allowAdmins=true`。
- `user` 和游客不能导出。

查询参数：

| 参数 | 必填 | 说明 |
|------|------|------|
| `month` | 是 | 月份，格式 `YYYY-MM` |

响应：`.xls` 文件流，文件名格式为 `work-hours-YYYY-MM.xls`。

说明：

- 按月份统计每位设计员的工时数据。
- 导出列：设计员、总工时、工作日工时、周末加班工时、出差工时、请假工时。
- 工作日工时和周末加班工时按 `settings.workdayOverrides` 覆盖后的有效工作日/周末计算。
- 按总工时倒序排列。
- 冻结首行和首列。
- 工时为 0 的单元格显示为空。

## 仕样号搜索接口

### 获取仕样纳期

`POST /api/spec/delivery-date`

权限：`admin`、`superadmin`。

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

权限：`admin`、`superadmin`。

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

权限：`admin`、`superadmin`。

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
| 404 | `用户不存在` / `任务条目不存在` / `记录未找到` 等 | 资源不存在 |
| 500 | `服务器内部错误` | 服务端错误 |

注意：登录接口受速率限制（15 分钟内最多 20 次尝试），超限返回 `登录尝试过于频繁，请15分钟后再试`。

## 数据库迁移说明

系统启动时会自动执行数据库迁移：

1. **任务数据结构迁移**：将旧版 `hours` 对象格式迁移为新版 `days` 对象格式
2. **日期格式规范化**：统一日期格式为 `YYYY-MM-DD`，截取前 10 位
3. **配置自动补齐**：首次启动或旧版本升级时，自动补齐缺失的默认配置（含 `leaderboard`、`workHours`、`statusTracking`、`systemSettings`、`workdayOverrides`、`system` 等）
4. **用户字段迁移**：自动为旧用户补齐 `disabled` 和 `forcePasswordChange` 字段
5. **强制修改密码迁移**：首次访问用户列表或校验会话时，自动将非超级管理员用户的 `forcePasswordChange` 标记为 `true`

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
9. **强制修改密码**：新建用户或被重置密码后，下次登录需修改密码
10. **操作审计**：自动记录所有已登录用户的 API 请求，最多保留 2000 条

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
GITEE_TOKEN=your-gitee-personal-access-token
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

最后更新：2026-07-07
