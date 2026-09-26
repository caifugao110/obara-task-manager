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
- 所有业务接口均需登录（有效 JWT），未提供游客/匿名访问。
- 请求体默认使用 `application/json`；文件导入接口使用 `multipart/form-data`。
- 日期字段通常使用 `YYYY-MM-DD`，月份字段通常使用 `YYYY-MM`，任务查询中的 `month` 使用数字 `1-12`。
- 后端会通过 Joi 或路由逻辑丢弃未知字段或返回 `400`，调用方不要依赖未声明字段被保存。
- 全部 `/api` 接口启用全局限流：默认每个 IP 15 分钟 3000 次（`OPTIONS` 预检与本机环回请求不计数，可用环境变量 `API_RATE_LIMIT_MAX` 调整），超限返回 HTTP `429`；登录、修改密码另有更严格的独立限流。
- 本文中的“管理员”指 `admin` 或 `superadmin`；“仅超级管理员”只允许 `superadmin`。
- 后端只提供 `/api/*` 接口和 Socket.IO 服务，**不托管前端静态文件**（未挂载 `express.static`），也没有 `/health` 健康检查接口；生产环境前端需独立部署（前端构建基础路径为 `/obara-task-manager/`）。

## 角色

| 角色 | 说明 |
|------|------|
| `superadmin` | 超级管理员 |
| `admin` | 一般管理员 |
| `user` | 普通用户 |

普通用户登录后可查看主页面。任务报表、工时管理和状态追踪必须登录后访问，是否允许普通用户进入由对应页面的 `allowViewers` 控制。

## 权限速查

| 能力 | user | admin | superadmin |
|------|------|-------|------------|
| 查看主页面任务和设计人员 | 是 | 是 | 是 |
| 编辑任务 | 否 | 是 | 是 |
| 管理设计人员 | 否 | 是 | 是 |
| 管理登录用户 | 否 | 只能创建/维护普通用户 | 是 |
| 批量删除登录用户 | 否 | 否 | 是 |
| 页面权限设置 | 否 | 否 | 是 |
| 系统设置登录管理、日志管理 | 否 | 否 | 是 |
| 系统设置数据管理导出 | 否 | 取决于 `systemSettings.allowAdmins` | 是 |
| 系统设置数据管理导入 | 否 | 否 | 是 |
| 查看和修改组长规则 | 否 | 是 | 是 |
| 重置组长规则为默认 | 否 | 否 | 是 |
| 查看焊枪台账 | 否 | 取决于 `gunLedger.allowAdmins` | 是 |
| 编辑焊枪台账（分类/表/行） | 否 | 取决于 `gunLedger.allowAdmins` | 是 |
| 删除焊枪台账分类/表 | 否 | 否（按钮可见但拦截） | 是 |
| 配置焊枪名规则/台账初始化（焊枪名初始化/批量初始化）/管理默认担当 | 否 | 否 | 是 |
| 导入焊枪台账 | 否 | 否 | 是 |
| 检索/问答/查看知识库文档清单 | 取决于 `designStandards.allowViewers` | 取决于 `designStandards.allowAdmins` | 是 |
| 关联/取消关联知识库 | 否 | 是 | 是 |
| 配置答复约束提示词 | 否 | 否 | 是 |

说明：

- 所有页面和接口均需登录，未登录用户会被重定向到登录页。
- `settings.leaderboard`、`settings.workHours`、`settings.statusTracking` 控制对应页面是否允许 `admin` 和已登录 `user` 访问。
- `settings.gunLedger` 控制焊枪台账页面访问权限，`allowViewers` 后端强制为 `false`（普通用户不能进入 `/gun-ledger`）。一般管理员可见删除分类/表按钮但点击被拦截（提示需超级管理员权限）。
- `settings.designStandards` 控制设计规范知识库页面（`/design-standards`）访问权限，规则同工时管理。
- `settings.systemSettings.allowViewers` 后端会强制为 `false`，普通用户不能进入系统设置。
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

- 登录成功和失败都会记录登录日志，日志包含 IP、原始 `User-Agent` 和解析后的浏览器信息；失败记录含 `reason`（`用户不存在` / `账号已禁用` / `密码错误`），即使用户名不存在也会记录该次尝试。
- 用户不存在与密码错误均返回相同的 `401` 响应 `用户名或密码错误`，避免通过响应差异枚举有效用户名。
- 账号禁用时返回 `403` 和 `ACCOUNT_DISABLED`。
- 关闭多设备登录时，新登录会使旧会话失效。
- `forcePasswordChange=true` 时前端需引导用户到 `/change-password` 修改密码。
- **未修改初始密码期间的 API 拦截**：`forcePasswordChange` 标记未清除前，除 `POST /api/auth/change-password` 和 `POST /api/auth/logout` 外的所有已登录接口一律返回 `403`（`code=FORCE_PASSWORD_CHANGE`）。
- 登录接口受独立速率限制（按「IP + 用户名」计数，15 分钟内最多 20 次尝试），超限返回 HTTP `429` 与消息 `登录尝试过于频繁，请15分钟后再试`；此外还受全局 API 限流（默认每 IP 15 分钟 3000 次）约束。

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
  "message": "密码修改成功",
  "token": "new-jwt-token"
}
```

说明：

- 新密码长度至少 6 位。
- 修改成功后会自动清除 `forcePasswordChange` 标记。
- 修改成功后返回新的 JWT Token，前端应使用新 Token 更新本地存储。
- 修改密码后会更新 sessionId，使旧 Token 失效（防止会话固定攻击）。
- 旧密码不正确时返回 `401`。
- 接口受独立速率限制（按「用户 ID」计数，15 分钟内最多 5 次尝试），超限返回 HTTP `429` 与消息 `密码修改尝试过于频繁，请15分钟后再试`。
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

### 获取当前用户客户端信息

`GET /api/auth/client-info`

权限：需要登录。

返回当前请求客户端的 IP 和解析后的浏览器信息，供前端展示本机登录环境使用。

响应：

```json
{
  "ip": "::1",
  "browser": "Chrome",
  "os": "Windows",
  "device": "Desktop",
  "summary": "Chrome / Windows / Desktop"
}
```

> 该接口返回简化的浏览器信息（不含版本号；带版本号的完整解析用于登录日志和操作日志）。接口本身会被操作日志记录，操作类型显示为「查看自身浏览器信息」。

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
- 仅 `superadmin` 可修改 `role` 和 `disabled`（禁用/启用账号与角色变更同级，一般管理员无法操作）。
- `admin` 只能更新自己的信息。

### 批量删除登录用户

`POST /api/users/batch-delete`

权限：仅 `superadmin`

规则：

- 需要登录且角色为超级管理员。
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

- 需要登录且角色为超级管理员。
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

- 需要有效 JWT（登录后访问）。
- 返回结果按 `order` 字段升序排列。

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
| `summary` | 否 | 是否返回摘要数据，`true` 时返回轻量级摘要 |

说明：

- 传入 `month` 和 `year` 时返回指定月份任务。
- 不传月份和年份时返回全部任务，供任务报表“全表搜索”使用。
- `summary=true` 时返回轻量级摘要数据，包含工作表基本信息但不包含任务详情，用于快速加载。

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

响应（`summary=true`）：

```json
[
  {
    "id": "sheet-designer-1-2026-7",
    "designerId": "designer-1",
    "month": 7,
    "year": 2026,
    "hasData": true,
    "itemCount": 10,
    "dates": ["2026-07-01", "2026-07-02"]
  }
]
```

字段说明（摘要模式）：

| 字段 | 说明 |
|------|------|
| `hasData` | 是否有任务数据 |
| `itemCount` | 任务条目总数 |
| `dates` | 包含任务的日期列表（`Object.keys(days)` 按日期升序排列） |

### 创建任务

`POST /api/tasks/item`

权限：`admin`、`superadmin`。需要登录且角色为管理员或超级管理员。

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
  "sheetId": "sheet-designer-1-2026-7",
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
  "sheetId": "sheet-designer-1-2026-7",
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

权限：`admin`、`superadmin`。普通用户在满足条件时可修改本人同名设计员的设计计划任务颜色标记（仅白色标记或恢复）。

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

标记枪名颜色时额外携带 `gunIndex`：

```json
{
  "designerId": "designer-1",
  "date": "2026-07-01",
  "itemId": "task-1",
  "field": "gunColor",
  "gunIndex": 0,
  "value": "#ffffff"
}
```

`field` 合法值：

- `taskName`
- `hours`
- `color`（主任务颜色）
- `guns`（整体替换枪名数组）
- `gunColor`（标记单个枪名颜色，需配合 `gunIndex` 指定枪名下标）
- `leaveType`（合法值：`sick` 事假、`vacation` 休假、`illness` 病假、`trip` 出差、`null`）
- `fontSize`
- `textColor`

更新 `guns` 时同样校验：枪名存在时工时不能为 0。

- **所有任务内容的修改（包括枪名的编辑、复制、删除）都会自动更新 `updatedAt` 和 `updatedBy` 字段。**
- 枪名对象除 `id`、`name`、`hours` 外，还包含颜色标记字段：`color`（当前颜色）、`colorBeforeUserMark`（标记前的原始颜色）、`colorMarkedBy`（标记人 `{ id, username, name }`）。

颜色标记规则（`field` 为 `color` 或 `gunColor`）：

- 管理员可通过任务编辑弹窗设置任意颜色；白色标记/恢复操作管理员与授权普通用户均可执行。
- 普通用户需满足：系统开启 `allowUserDesignPlanColorMark`（或旧开关 `allowUserEditOwnTaskColor`）、任务非请假条、且本人姓名与该设计人员姓名一致；普通用户只允许白色标记（`#ffffff`/`#fff`/`white`）或恢复（`value` 传 `__restore__`），否则返回 `403`。
- 标记白色时，系统会保存原始颜色到 `colorBeforeUserMark`，并记录标记人信息到 `colorMarkedBy`；恢复时还原原始颜色并删除这两个字段。
- 联动规则：主任务标记白色时，其下所有枪名联动标记为白色（枪名 `colorMarkedBy` 为 `{ id: 'auto', name: '系统联动' }`）；所有枪名都为白色时，主任务自动标记白色（`colorMarkedBy` 为 `{ id: 'auto', name: '系统自动' }`）；任一枪名恢复非白色时，主任务联动恢复原始颜色。
- 请假条（`leaveType` 非空）不允许标记颜色。

响应：

```json
{
  "sheetId": "sheet-designer-1-2026-7",
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
  "sheetId": "sheet-designer-1-2026-7",
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
| `allowViewers` | 是否允许普通用户访问；未登录游客不能进入任务报表、工时管理、状态追踪和系统设置页面 |

规则：

- `allowViewers=true` 时，后端保存结果会强制 `allowAdmins=true`。
- 前端主开关关闭时会同时关闭 `allowAdmins` 和 `allowViewers`。
- 前端主开关打开时会同时打开 `allowAdmins` 和 `allowViewers`。
- `leaderboard.allowViewers=true`、`workHours.allowViewers=true`、`statusTracking.allowViewers=true` 只允许普通用户访问对应页面；未登录游客始终不能进入 `/leaderboard`、`/work-hours` 和 `/status-tracking`。
- `systemSettings` 配置的 `allowViewers` 始终为 `false`（系统设置不允许普通用户和游客访问）。
- 四个权限配置的 `GET` 接口（`/settings/leaderboard`、`/settings/work-hours`、`/settings/status-tracking`、`/settings/system-settings`）均需携带有效 JWT；`PUT` 接口均仅 `superadmin`。
- 焊枪台账（`/settings/gun-ledger`）和设计规范知识库（`/settings/design-standards`）权限配置同样遵循上述规则；其中 `gunLedger.allowViewers` 后端强制为 `false`。

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

### 获取焊枪台账权限设置

`GET /api/settings/gun-ledger`

### 更新焊枪台账权限设置

`PUT /api/settings/gun-ledger`

权限：仅 `superadmin`

说明：

- 用于控制一般管理员是否可以访问焊枪台账页面（`/gun-ledger`）。
- `allowViewers` 字段被强制为 `false`（焊枪台账不允许普通用户和游客访问）。

### 获取设计规范知识库权限设置

`GET /api/settings/design-standards`

### 更新设计规范知识库权限设置

`PUT /api/settings/design-standards`

权限：仅 `superadmin`

说明：

- 用于控制一般管理员/普通用户是否可以访问设计规范知识库页面（`/design-standards`）。

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

访问控制：需要有效 JWT（登录后访问）。

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
- 当传入的 `type` 与该日期的自然属性（自然工作日/自然周末）相同，或 `type` 为空时，后端会删除该日期的覆盖键（等效于恢复自然日）；GET/PUT 均会经过规范化处理，只保留有效覆盖项。

### 获取组长规则

`GET /api/settings/leader-rules`

访问控制：需要有效 JWT（登录后访问）。

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

权限：需要登录，并取决于 `settings.statusTracking` 的权限配置。未登录用户不能访问。

响应：

```json
[
  {
    "id": "1752000000000",
    "factory": "OBARA",
    "clientName": "客户名称",
    "specNumber": "12345",
    "productionPlanMonth": "2026-07",
    "productionPlanMonths": ["2026-07", "2026-08"],
    "quantity": "100",
    "deliveryDate": "2026-08-15",
    "shippedCount": 60,
    "unconfirmedCount": 0,
    "totalVarieties": 10,
    "feedbackVarieties": 8,
    "feedbackPlan": "2026-07-20",
    "drawingPlanStatus": "下图中",
    "confirmedQuantity": 80,
    "confirmedVarieties": 8,
    "drawnVarieties": 6,
    "undrawnVarieties": 2,
    "undrawnQuantity": 20,
    "unconfirmedQuantity": 20,
    "designDeliveryDays": 35,
    "salesPerson": "营业担当",
    "leader": "组长",
    "createdAt": "2026-07-01T00:00:00.000Z",
    "updatedAt": "2026-07-01T00:00:00.000Z"
  }
]
```

字段说明：

| 字段 | 说明 |
|------|------|
| `id` | 记录唯一标识，创建时自动生成 |
| `factory` | 工厂 |
| `clientName` | 客户名称 |
| `specNumber` | 仕样号 |
| `productionPlanMonth` | 添加时间月份（`YYYY-MM`），创建时缺省取当前月 |
| `productionPlanMonths` | 添加时间月份数组（`YYYY-MM`），支持一条记录对应多个月份；缺省时取 `productionPlanMonth`，再退回纳期月份 |
| `quantity` | 数量（字符串保存） |
| `deliveryDate` | 纳期，格式 `YYYY-MM-DD` |
| `shippedCount` | 已发图数量 |
| `unconfirmedCount` | 未确认标记（存在未确认数量时导出显示「是」） |
| `totalVarieties` | 总种数 |
| `feedbackVarieties` | 反馈种数 |
| `feedbackPlan` | 反馈计划 |
| `drawingPlanStatus` | 下图计划及状态 |
| `confirmedQuantity` | 确认数量 |
| `confirmedVarieties` | 确认种数 |
| `drawnVarieties` | 下图种数 |
| `undrawnVarieties` | 未下种数（导入/保存值；导出时动态按 `确认种数 - 下图种数` 计算） |
| `undrawnQuantity` | 未下数量（导入/保存值；导出时动态按 `确认数量 - 已发图` 计算） |
| `unconfirmedQuantity` | 未确认数（导入/保存值；导出时动态按 `数量 - 确认数量` 计算） |
| `designDeliveryDays` | 设计纳期天数（纳期距今天数，**动态计算不存储**，小于 1 天时导出为空） |
| `salesPerson` | 营业担当 |
| `leader` | 组长（前端按营业担当自动匹配组长规则填充） |
| `createdAt` | 创建时间，ISO 格式 |
| `updatedAt` | 更新时间，ISO 格式 |

> 说明：未知字段会被 Joi 校验丢弃；`designDeliveryDays` 每次读取时根据 `deliveryDate` 实时计算。

### 创建状态追踪记录

`POST /api/status-tracking/items`

权限：`admin`、`superadmin`

请求：

```json
{
  "factory": "OBARA",
  "clientName": "客户名称",
  "specNumber": "12345",
  "productionPlanMonth": "2026-07",
  "productionPlanMonths": ["2026-07"],
  "quantity": "100",
  "deliveryDate": "2026-08-15",
  "shippedCount": 0,
  "totalVarieties": 10,
  "salesPerson": "营业担当",
  "leader": "组长"
}
```

字段同 [获取状态追踪记录](#获取状态追踪记录) 的字段表；`id`、`createdAt`、`updatedAt` 由系统生成，传入会被忽略。

响应：返回创建的完整记录（含动态计算的 `designDeliveryDays`）。

说明：
- 创建成功后通过 Socket.IO 广播 `status_tracking_updated` 事件，`action` 为 `add`
- `productionPlanMonth` 缺省时取当前月；`productionPlanMonths` 缺省时取 `productionPlanMonth`

### 更新状态追踪记录

`PUT /api/status-tracking/items/:id`

权限：`admin`、`superadmin`

请求：请求体为需要更新的字段集合（字段同记录字段表），例如：

```json
{
  "shippedCount": 80,
  "drawnVarieties": 8,
  "drawingPlanStatus": "已下图"
}
```

响应：返回更新后的完整记录（含动态计算的 `designDeliveryDays`）。

说明：
- 更新成功后通过 Socket.IO 广播 `status_tracking_updated` 事件，`action` 为 `update`
- 记录不存在时返回 `404` 和 `记录未找到`
- 未传 `productionPlanMonth`/`productionPlanMonths` 时保留原值

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
    "id": "1752000000000",
    "shippedCount": 80
  },
  {
    "factory": "OBARA",
    "clientName": "新客户",
    "specNumber": "67890",
    "productionPlanMonth": "2026-08",
    "quantity": "50",
    "deliveryDate": "2026-09-30"
  }
]
```

响应：返回所有状态追踪记录列表（含动态计算的 `designDeliveryDays`）。

说明：

- 请求必须是数组格式，否则返回 `400` 和 `输入必须是数组`
- 已存在的记录（根据 `id` 匹配）会更新，不存在的记录会创建
- 创建的新记录会自动生成 `id`、`createdAt`、`updatedAt`
- 更新的记录会自动更新 `updatedAt` 字段
- 每条记录都会经过 Joi 校验，未知字段被丢弃
- 成功后通过 Socket.IO 广播 `status_tracking_bulk` 事件，包含所有记录列表

### 同步状态追踪记录

`POST /api/status-tracking/sync`

权限：需要登录，并取决于 `settings.statusTracking` 的权限配置。未登录用户不能访问。

响应：返回所有状态追踪记录数组。

### 导出状态跟踪表

`GET /api/status-tracking/export`

权限：`admin`、`superadmin`。

查询参数：

| 参数 | 必填 | 说明 |
|------|------|------|
| `month` | 否 | 月份，格式 `YYYY-MM`，按添加时间月份字段过滤（与 `deliveryMonth` 二选一） |
| `deliveryMonth` | 否 | 纳期月份，格式 `YYYY-MM`，按纳期字段过滤（与 `month` 二选一） |
| `factory` | 否 | 按工厂筛选 |
| `searchTerm` | 否 | 搜索关键词，匹配客户名、仕样号、营业担当、组长 |
| `fullTableSearch` | 否 | 是否全表搜索，`true` 时忽略 `month` 和 `deliveryMonth` 参数 |

响应：`.xls` 文件流，文件名格式为 `status-tracking-YYYYMMDDHHmmss.xls`。

说明：

- 未开启全表搜索时，`month` 和 `deliveryMonth` 必须二选一。
- `month` 按添加时间月份字段过滤。
- `deliveryMonth` 按纳期字段 (`deliveryDate`) 以 `YYYY-MM` 开头过滤记录。
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
  "duplicateSpecs": ["12345(2026-07)", "67890(2026-08)"]
}
```

说明：

- 按「仕样号 + 添加时间月」组合判重：文件中每行的仕样号与添加时间月份（「添加时间」列，支持逗号分隔多个月份，缺省取纳期月份）组合后，与数据库现有记录比对。
- 重复项元素格式为 `仕样号(YYYY-MM)`，自动去重。
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

- 按「仕样号 + 添加时间月」组合匹配现有记录，存在则更新（仅当 `overwrite=true`），不存在则创建；仕样号为空的行跳过。
- 表头列通过模糊匹配识别（如「工厂」「客户」「添加时间」「数量」「纳期」「仕样号」等）；「添加时间」列支持逗号分隔多个月份，缺省时取纳期月份。
- 上传文件同样经过文件类型、结构、恶意内容扫描和内容清理（见 [文件上传安全验证](#文件上传安全验证)）。
- 导入成功后会通过 Socket.IO 广播 `status_tracking_bulk` 事件。

### 清理状态追踪记录

`POST /api/status-tracking/cleanup`

权限：仅 `superadmin`

请求体：

```json
{
  "beforeMonth": 7,
  "beforeYear": 2026,
  "mode": "delivery"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `beforeYear` | 是 | 清理截止年份 |
| `beforeMonth` | 是 | 清理截止月份（1-12） |
| `mode` | 否 | 清理模式：`delivery` 表示按纳期月份清理；缺省（或其他值）表示按添加时间月清理 |

清理规则：

- `mode=delivery`：删除纳期早于 `beforeYear-beforeMonth` 的记录；无纳期的记录保留。
- 默认模式：删除最早添加时间月（取 `productionPlanMonths` 排序后的第一个月，缺省退回 `productionPlanMonth`/纳期月份）早于指定时间点的记录；无添加时间月的记录保留。

响应：

```json
{
  "message": "状态跟踪数据清理完成",
  "removedCount": 50,
  "remainingCount": 100
}
```

说明：

- 缺少 `beforeMonth` 或 `beforeYear` 时返回 `400` 和 `请指定清理时间点`。
- 清理成功后通过 Socket.IO 广播 `status_tracking_bulk` 事件，包含剩余记录列表。

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

## 焊枪台账接口

焊枪台账（`/gun-ledger`）采用**分类 → 表 → 行**三级结构。所有接口都受 `accessSettingsMiddleware('gunLedger')` 控制：需先满足 `settings.gunLedger` 权限配置，再满足各接口的角色要求。默认分类为 `X2C`、`X2C-V2`、`X2C-V3`。

### 数据结构

顶层 `gunLedger` 对象：

```json
{
  "categories": {
    "X2C": [ { "id": "gun-tbl-xxx", "name": "SRTC", "rows": [...], "gunNameRule": {...} } ],
    "X2C-V2": [ ... ],
    "X2C-V3": [ ... ]
  },
  "defaultResponsiblePersons": ["张啸", "张明", "陈青松", "陈大仪"]
}
```

表（Table）对象：

| 字段 | 说明 |
|------|------|
| `id` | 表唯一标识 |
| `name` | 表名（1-50 字符，同一分类下唯一） |
| `rows` | 行数组 |
| `gunNameRule` | 可选，焊枪名自动生成规则（超级管理员按表配置） |

行（Row）对象：

| 字段 | 说明 |
|------|------|
| `id` | 行唯一标识 |
| `serialNumber` | 序号，后端强制保证严格连续 `1..N`，无跳号 |
| `gunName` | 焊枪名 |
| `customer` | 客户 |
| `time` | 时间 |
| `responsiblePerson` | 担当 |
| `remarks` | 备注 |
| `createdAt` / `createdBy` | 创建时间 / 创建者 |
| `updatedAt` / `updatedBy` | 最后修改时间 / 最后修改者 |

焊枪名生成规则（`gunNameRule`）：

| 字段 | 说明 |
|------|------|
| `enabled` | 是否启用自动取号 |
| `prefix` | 前缀（最长 20 字符） |
| `start` | 起始编号（0-99999999） |
| `pad` | 编号补零位数（1-10） |

焊枪名 = `prefix + String(start + serialNumber - 1).padStart(pad, '0')`。未配置规则的表使用前端内置默认规则（按分类+表名匹配），无匹配则不自动取号。

### 获取全部台账数据

`GET /api/gun-ledger`

权限：需要登录，并取决于 `settings.gunLedger` 权限配置。

响应：返回完整的 `gunLedger` 对象（含 `categories` 和 `defaultResponsiblePersons`）。

### 获取分类摘要

`GET /api/gun-ledger/summary`

权限：需要登录，并取决于 `settings.gunLedger` 权限配置。

响应：

```json
[
  { "category": "X2C", "tables": 7, "rows": 120 },
  { "category": "X2C-V2", "tables": 2, "rows": 30 }
]
```

用于系统设置「焊枪编号台账」卡片展示分类列表。

### 导出分类

`GET /api/gun-ledger/export`

权限：需要登录，并取决于 `settings.gunLedger` 权限配置。

查询参数：

| 参数 | 必填 | 说明 |
|------|------|------|
| `categories` | 是 | 分类名，逗号分隔，如 `X2C,X2C-V2` |

响应：

- 单个分类：直接下载 `.xls` 文件，文件名 `gun-ledger-<分类>-<时间戳>.xls`。
- 多个分类：打包为 `.zip`，文件名 `gun-ledger-export-<时间戳>.zip`，内含每个分类一个独立 `.xls`。

说明：

- 每张表对应工作簿中的一个工作表，工作表名为表名（跨分类重名时自动加 `~n` 去重）。
- 表头列为「序号/焊枪名/客户/时间/担当/备注」，蓝色表头、斑马纹、完整边框。
- 分类不存在时返回 `400` 和 `分类不存在：xxx`。

### 导出全部分类

`GET /api/gun-ledger/export-all`

权限：需要登录，并取决于 `settings.gunLedger` 权限配置。

响应：单个 `.xls` 文件，文件名 `gun-ledger-all-<时间戳>.xls`，每个分类一个工作表（跨分类重名时使用「分类-表名」形式）。无数据时返回 `404`。

### 导入台账

`POST /api/gun-ledger/import`

权限：仅 `superadmin`。

请求类型：`multipart/form-data`

字段：

| 字段 | 必填 | 说明 |
|------|------|------|
| `file` | 是 | `.xls` 或 `.xlsx` 文件 |
| `category` | 是 | 目标分类名（1-30 字符，不含 `/`、`\`），不存在时自动新建 |

说明：

- 工作簿内的每个工作表会成为目标分类下的一张表（工作表名为表名），并**覆盖目标分类下全部表**。
- 表名限 50 字符，同类下重名自动追加 `-n`。
- 行序号自动重排为连续 `1..N`。
- 上传文件经过文件类型、结构、恶意内容扫描（见 [文件上传安全验证](#文件上传安全验证)）。
- 导入前会释放目标分类下所有旧表的编辑锁。

响应：

```json
{
  "message": "导入成功",
  "category": "X2C",
  "isNewCategory": false,
  "importedTables": 7,
  "importedRows": 120,
  "warnings": []
}
```

### 新增分类

`POST /api/gun-ledger/categories`

权限：`admin`、`superadmin`。

请求：

```json
{ "name": "新分类名" }
```

说明：分类名 1-30 字符，不含 `/`、`\`；同名返回 `400`。

### 删除分类

`DELETE /api/gun-ledger/categories/:category`

权限：仅 `superadmin`。

说明：默认分类 `X2C`、`X2C-V2`、`X2C-V3` 不允许删除。删除会连同其下所有表一并删除，并释放所有表的编辑锁。

### 分类排序

`PATCH /api/gun-ledger/categories/order`

权限：`admin`、`superadmin`。

请求：

```json
{ "order": ["X2C", "X2C-V2", "X2C-V3", "自定义分类"] }
```

说明：`order` 必须与现有分类集合完全一致（防止越权增删）。

### 新增表

`POST /api/gun-ledger/categories/:category/tables`

权限：`admin`、`superadmin`。

请求：

```json
{ "name": "新表名" }
```

说明：同一分类下表名唯一。

### 表排序

`PATCH /api/gun-ledger/tables/order`

权限：`admin`、`superadmin`。

请求：

```json
{ "category": "X2C", "order": ["表1-id", "表2-id"] }
```

说明：`order` 必须与该分类下现有表 id 集合完全一致。

### 重命名表

`PATCH /api/gun-ledger/tables/:tableId`

权限：`admin`、`superadmin`。

请求：

```json
{ "name": "新表名" }
```

### 删除表

`DELETE /api/gun-ledger/tables/:tableId`

权限：仅 `superadmin`。

说明：删除时释放该表的编辑锁。

### 保存表的全部行

`PUT /api/gun-ledger/tables/:tableId/rows`

权限：`admin`、`superadmin`。

请求：行数组（见行对象字段，`id` 为空时由后端生成）。

说明：

- **表级编辑锁保护**：该表正被他人编辑时返回 `409` 和 `该表正由「xxx」编辑，请等待其完成后再保存`。
- 后端会保留已存在行的 `createdAt`/`createdBy`，新行补全创建者信息。
- 行序号会被强制重排为严格连续 `1..N`（先按序号升序，再重新编号），杜绝跳号。
- 所有行的 `updatedAt`/`updatedBy` 会更新为当前时间和当前用户。

响应：返回保存后的行数组。

### 配置焊枪名生成规则

`PUT /api/gun-ledger/tables/:tableId/gun-name-rule`

权限：仅 `superadmin`。

请求：

```json
{ "enabled": true, "prefix": "SRTC-2C", "start": 15000, "pad": 5 }
```

说明：仅超级管理员可在「台账初始化」面板中按表配置；保存后通过 Socket.IO 广播 `gun_ledger_updated`（`action: 'gun_name_rule'`）。

### 焊枪名初始化

`POST /api/gun-ledger/tables/:tableId/initialize-gun-names`

权限：仅 `superadmin`。

请求体：无（发送 `{}`）。

说明：

- 删除该表**全部真实行**（`rows` 置空），表恢复为全新状态。
- 初始化后前端只渲染 10 个预留行，预留行的焊枪名按生效规则（表级 `gunNameRule` → 内置默认模式）自动展示，即该表的 **10 个原始焊枪名**；未启用自动取号时预留行枪名为空。
- 该表正被他人编辑时返回 `409`。
- 初始化后通过 Socket.IO 广播 `gun_ledger_updated`（`action: 'update_rows'`，`rows: []`）。

响应：

```json
{ "success": true, "rows": [] }
```

### 一键初始化某分类下全部表格

`POST /api/gun-ledger/categories/:category/initialize-all`

权限：仅 `superadmin`。请求体：无（发送 `{}`）。

说明：将该分类下所有表的 `rows` 置空，并逐表广播 `update_rows`（`rows: []`）。任意一张表正被他人编辑时整体返回 `409`（`locked` 数组列出被占用的表与持有人），不做部分初始化。

### 一键初始化全部表格

`POST /api/gun-ledger/initialize-all`

权限：仅 `superadmin`。请求体：无（发送 `{}`）。

说明：跨全部分类批量清空所有表的真实行，语义与按分类初始化一致；任一张表被他人编辑即整体拒绝（`409`）。

响应（成功）：

```json
{ "success": true, "initializedCategories": 3, "initializedTables": 11, "clearedRows": 0 }
```

### 获取默认担当人员

`GET /api/gun-ledger/default-persons`

权限：需要登录，并取决于 `settings.gunLedger` 权限配置。

响应：字符串数组，如 `["张啸", "张明", "陈青松", "陈大仪"]`。

### 修改默认担当人员

`PUT /api/gun-ledger/default-persons`

权限：仅 `superadmin`。

请求：字符串数组，如 `["张啸", "张明", "陈青松", "陈大仪"]`。

### 重置默认担当人员

`POST /api/gun-ledger/default-persons/reset`

权限：仅 `superadmin`。

说明：重置为系统默认值 `["张啸", "张明", "陈青松", "陈大仪"]`。

## 设计规范知识库接口

挂载前缀 `/api/design-standards`。所有接口都需要登录，并受 `settings.designStandards` 页面权限控制；关联/取消关联还要求一般管理员及以上。后端不向前端下发 WeKnora 地址与 API Key。

### 接入状态与知识库

#### 获取接入状态

`GET /api/design-standards/status`

返回 WeKnora 接入状态、各工作空间可达性与已关联知识库列表。

响应：

```json
{
  "enabled": true,
  "configured": true,
  "reachable": true,
  "baseUrl": "http://127.0.0.1:8080/api/v1",
  "tenants": [
    { "tenantId": 10000, "tenantName": "admin's Workspace", "reachable": true },
    { "tenantId": 10001, "tenantName": "caifugao110's Workspace", "reachable": true }
  ],
  "defaultKnowledgeBaseIds": [],
  "knowledgeBases": [
    {
      "id": "xxxx",
      "name": "设计规范库",
      "description": "",
      "knowledgeCount": 12,
      "createdAt": "2026-09-01T00:00:00.000Z",
      "tenantId": 10000,
      "tenantName": "admin's Workspace"
    }
  ]
}
```

说明：

- `WEKNORA_ENABLED` 不为 `true` 时返回 `enabled=false`、`reachable=false`；未配置任何 API Key 时 `configured=false`。
- `tenants` 每个元素对应一个配置的 API Key（主 Key 在前），后端通过 `/auth/me` 解析其工作空间身份；`reachable=false` 表示该 Key 无效、过期或无法连接。
- `knowledgeBases` 只包含项目已关联（`settings.designStandardsLinkedKbIds`）且能成功解析的知识库；无法解析的已关联库跳过，不影响其他库展示。
- `defaultKnowledgeBaseIds` 当前固定返回空数组（保留字段，知识库以显式关联为准）。

#### 获取已关联知识库列表

`GET /api/design-standards/knowledge-bases`

响应：`{ "knowledgeBases": [...] }`，数组元素结构同 status 中的 `knowledgeBases`。

#### 关联知识库

`POST /api/design-standards/knowledge-bases/link`

权限：`admin`、`superadmin`。

请求：

```json
{ "kbId": "知识库 ID" }
```

- 后端按所有已配置 Key 解析该 ID（先查各 Key 的知识库缓存，未命中则刷新列表，再逐 Key 发起探测），确认知识库存在后写入关联列表。
- 该 ID 已关联时返回 `409` 和 `该知识库已关联`；ID 在所有工作空间均不可访问时返回 `403`（`WEKNORA_KB_FORBIDDEN`）。

响应（`201`）：`{ "knowledgeBase": { ...知识库对象 } }`。

#### 取消关联知识库

`DELETE /api/design-standards/knowledge-bases/:kbId`

权限：`admin`、`superadmin`。

仅从本系统关联列表移除 ID，**不会删除 WeKnora 中的知识库**；未关联返回 `404` 和 `该知识库未关联`。

响应：`{ "message": "已取消关联" }`。

#### 获取知识库文档清单

`GET /api/design-standards/knowledge-bases/:kbId/documents`

响应：

```json
{
  "documents": [
    {
      "id": "doc-id",
      "title": "电极使用规范.pdf",
      "fileType": "pdf",
      "fileSize": 102400,
      "parseStatus": "completed",
      "createdAt": "2026-09-01T00:00:00.000Z"
    }
  ]
}
```

### 规范检索

`POST /api/design-standards/search`

请求：

```json
{ "query": "电极帽材质", "knowledgeBaseIds": ["kb-id-1", "kb-id-2"] }
```

- `knowledgeBaseIds` 必填且至少 1 个，否则返回 `400`（`未指定知识库，请先关联并选择知识库`）。
- 支持跨工作空间：后端按知识库所属空间分组并行检索，合并后按 `score` 降序排列。

响应：

```json
{
  "results": [
    {
      "id": "chunk-id",
      "content": "命中条款正文……",
      "score": 0.87,
      "matchType": "向量检索",
      "knowledgeId": "doc-id",
      "knowledgeTitle": "电极使用规范.pdf",
      "chunkIndex": 3,
      "seq": null,
      "startAt": null,
      "endAt": null,
      "chunkType": "",
      "metadata": {}
    }
  ],
  "meta": { "merged": false, "groups": 1 }
}
```

- `matchType` 已由后端把数字枚举映射为中文（向量检索/关键词/邻近分块/父分块/关联分块等）。
- `meta.groups` 为实际检索的工作空间数，`merged=true` 表示结果合并自多个工作空间。

### 智能问答（SSE）

`POST /api/design-standards/chat`

请求：

```json
{
  "query": "电极多久更换一次？",
  "sessionId": "可选，多轮对话沿用上次返回值",
  "knowledgeBaseIds": ["kb-id-1"]
}
```

规则：

- `knowledgeBaseIds` 必填且至少 1 个，否则 `400`；服务未配置任何 Key 时返回 `503`。
- **所选知识库必须同属一个工作空间**：跨空间时在 SSE 响应头写出之前返回 `400`，`code=WEKNORA_MULTI_TENANT`，消息中列出所跨越的工作空间名称。
- 不传 `sessionId` 时后端自动创建新会话（WeKnora 会话是工作空间级资源）。

响应：`Content-Type: text/event-stream`，每个事件格式为 `data: <JSON>\n\n`：

| 事件 | 负载 | 说明 |
|------|------|------|
| `session` | `{ type:'session', sessionId }` | 会话 ID，多轮对话需原样回传 |
| `references` | `{ type:'references', references:[...] }` | 引用条款，元素结构同检索结果 |
| `answer` | `{ type:'answer', content }` | 增量答案文本，客户端逐段累计 |
| `done` | `{ type:'done', finishReason }` | 流正常结束，整条流只发一次 |
| `error` | `{ type:'error', message }` | 流内错误（如约束智能体配置有误） |

> 回答正文可能内联 `<kb doc="..." chunk_id="..." kb_id="..." />` 溯源标签，前端需清理后再展示。

### 答复约束提示词设置

提示词配置不在 `/api/design-standards` 前缀下，而在设置路由中：

| API | 方法 | 权限 | 说明 |
|-----|------|------|------|
| `/api/settings/design-standards-prompt` | GET | 仅 `superadmin` | 返回 `{ enabled, knowledgeBases }` |
| `/api/settings/design-standards-prompt` | PUT | 仅 `superadmin` | 保存配置并同步 WeKnora 自定义智能体 |

GET 响应示例：

```json
{
  "enabled": true,
  "knowledgeBases": {
    "kb-id-1": {
      "prompt": "# 角色\n你是……（Markdown 全文）",
      "agentId": "agent-xxx",
      "updatedAt": "2026-09-25T10:00:00.000Z"
    }
  }
}
```

说明：

- `knowledgeBases` 的键为知识库 ID，值包含 `prompt`（提示词全文）、`agentId`（WeKnora 受管智能体 ID）、`updatedAt`（最后同步时间）。
- 未配置提示词的知识库不会出现在 `knowledgeBases` 中。

PUT 请求：

```json
{
  "enabled": true,
  "knowledgeBases": {
    "kb-id-1": { "prompt": "# 角色\n你是……（支持整篇 Markdown，最长 20000 字符）" }
  }
}
```

说明：

- 每个知识库对应一个受管智能体（description 前缀 `obara:design-standards:` 做确定性标识），后端自动解析该工作空间的 KnowledgeQA（问答）模型并绑定；该空间无可用问答模型时返回 `503`（`WEKNORA_NO_QA_MODEL`）。
- 非空提示词创建/更新智能体，回写 `agentId` 与 `updatedAt`；提示词被清空或条目被移除时同步删除对应智能体。
- 响应额外附带 `syncErrors`（逐个知识库列出同步失败原因）；某个库同步失败时保留其原有可用配置，不影响其他库。

## 系统设置接口

### 获取系统设置

`GET /api/system/settings`

响应：

```json
{
  "allowMultiDevice": true,
  "allowUserDesignPlanColorMark": true,
  "allowUserEditOwnTaskColor": true,
  "specNumberDigits": 5
}
```

说明：

- 所有页面和接口均需登录，不提供未登录查看。
- `allowUserDesignPlanColorMark` / `allowUserEditOwnTaskColor` 为兼容字段，含义相同。
- 缺失这两个字段时，系统默认允许登录用户修改本人设计计划标记颜色。
- `specNumberDigits` 为仕样号位数配置，取值 `5` 或 `6`，缺失时默认为 `5`，影响仕样号搜索、纳期提取和状态追踪等所有仕样号输入与校验。

### 更新系统设置

`PUT /api/system/settings`

权限：仅 `superadmin`

请求：

```json
{
  "allowMultiDevice": true,
  "allowUserDesignPlanColorMark": true,
  "specNumberDigits": 6
}
```

字段说明：

- 所有字段含义同 `GET /api/system/settings`。
- `specNumberDigits` 取值 `5` 或 `6`，可选；传入其他值会被忽略并使用默认值 `5`。

### 获取系统版本信息

`GET /api/system/version`

需要认证（登录后携带有效 JWT Token；匿名访问返回 `401`，以避免未授权者探测部署版本与更新渠道）。

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

- 返回所有登录用户的登录记录（含登录失败记录，账号不存在的尝试也会以提交的用户名记录）。
- 按时间倒序。
- `success: false` 的记录含 `reason` 字段，取值：`用户不存在`、`密码错误`、`账号已禁用`；成功记录无该字段。

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
  },
  {
    "id": "log-id-2",
    "username": "unknown001",
    "ip": "::1",
    "userAgent": "Mozilla/5.0 ...",
    "browserInfo": {
      "browser": "Chrome",
      "os": "Windows",
      "device": "Desktop",
      "summary": "Chrome / Windows / Desktop"
    },
    "success": false,
    "reason": "用户不存在",
    "action": "login",
    "timestamp": "2026-07-01T00:05:00.000Z"
  }
]
```

### 导出任务数据

`GET /api/system/export-xls`

权限：需要登录，受 `settings.systemSettings` 权限控制：

- `superadmin` 始终可导出。
- `admin` 需要 `settings.systemSettings.enabled=true` 且 `allowAdmins=true`（仅可导出，不能导入）。
- `user` 和游客不能导出（`systemSettings.allowViewers` 后端强制为 `false`）。

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

### 文件上传安全验证

系统对所有上传的 Excel 文件进行多层安全验证：

#### 文件类型验证

仅允许 `.xls` 和 `.xlsx` 扩展名，以及以下 MIME 类型：

- `application/vnd.ms-excel`
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `application/octet-stream`

#### 结构验证

| 限制项 | 最大值 | 说明 |
|--------|--------|------|
| 工作表数量 | 10 | 超过限制则拒绝导入 |
| 单工作表行数 | 10000 | 超过限制则拒绝导入 |
| 单工作表列数 | 100 | 超过限制则拒绝导入 |
| 文件大小 | 20MB | 通过 multer 配置限制 |

#### 恶意内容扫描

系统会扫描所有单元格内容，检测以下类型的恶意公式：

| 类型 | 检测示例 |
|------|----------|
| 命令执行 | `=CMD|/C DIR`、`=POWERSHELL` |
| 网络请求 | `=HYPERLINK("http://...")`、`=WEBSERVICE(...)` |
| 脚本注入 | `=SCRIPT:`、`=JAVASCRIPT:` |
| 文件操作 | `=EXEC("rm -rf /")`、`=SYSTEM("del")` |
| 管道命令 | `=A1||CMD`、`=A1&&BASH` |
| COM 对象 | `=CREATEOBJECT("WScript.Shell")` |

#### 内容清理

即使文件通过安全扫描，系统仍会对所有单元格进行清理处理：

- 以 `=`、`+`、`-`、`@` 开头的单元格值会添加单引号前缀，转换为纯文本。
- 检测到的恶意公式会被标记为文本，防止执行。

验证失败时返回 `400` 错误，包含详细的错误信息和问题位置。

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
| `action` | 否 | 空 | 按操作显示标签精确匹配（中文标签，如 `用户登录`、`更新任务`，与筛选选项接口返回的 `actions` 一致） |
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
- 仅记录已登录用户的请求（匿名请求不记）；登录成功的请求会从登录响应中补取用户信息后记录。
- `GET /api/system/login-logs*` 与 `/api/system/audit-logs*`（含查询、筛选选项、导出）本身不记录，避免日志自我膨胀；系统设置变更、维护等其他接口（如 `PUT /api/system/settings`）均正常记录。
- GET 请求不记录响应消息，POST/PUT 请求记录请求体（最大 2000 字符）。
- 请求体在入库前递归脱敏：嵌套对象与数组中的字段名只要匹配 `password`、`passwd`、`secret`、`token`、`api_key`/`apikey`、`authorization`（不区分大小写），值一律替换为 `[REDACTED]`。
- IP 取 `req.ip`（`trust proxy='loopback'`），不直接采信客户端发送的 `X-Forwarded-For` / `X-Real-IP`。
- `browserInfo` 包含浏览器名称和版本号、操作系统和版本号、设备类型，`summary` 为拼接后的简要描述。

### 获取操作日志筛选选项

`GET /api/system/audit-logs/filter-options`

权限：仅 `superadmin`

响应：

```json
{
  "usernames": ["admin001", "superadmin"],
  "actions": ["用户登录", "更新任务", "导出任务数据"]
}
```

说明：

- `usernames` 为当前所有出现过的用户名数组，按字母排序。
- `actions` 为操作显示标签（中文字符串）数组，按 `zh-CN` 拼音排序。
- 操作日志查询的 `action` 参数即与本数组中的标签精确匹配。

### 导出操作日志

`GET /api/system/audit-logs/export`

权限：仅 `superadmin`

查询参数：同 `GET /api/system/audit-logs`（不含 `limit` 和 `page`）。

响应：`.xls` 文件流，文件名格式为 `audit-logs-YYYY-MM-DD-HHmmss.xls`。

说明：

- 导出列包括时间、用户、姓名、操作类型、操作说明、方法、IP、状态码、耗时(ms)、浏览器信息（仅浏览器名称，如 `Chrome`）。
- 没有可导出的日志时返回 `404`。

### 获取数据库统计信息

`GET /api/system/db-stats`

权限：仅 `superadmin`

响应：

```json
{
  "size": {
    "bytes": 1048576,
    "kb": 1024.00,
    "mb": 1.00
  },
  "storage": {
    "engine": "SQLite",
    "driver": "better-sqlite3",
    "journalMode": "wal",
    "path": "D:\\project\\backend\\data.db",
    "dbFileSize": 943718,
    "walSize": 102400,
    "shmSize": 32768,
    "totalDiskSize": 1078886
  },
  "counts": {
    "users": 5,
    "designers": 20,
    "tasks": 240,
    "taskItems": 5000,
    "months": 12,
    "statusTrackingItems": 100,
    "loginLogs": 200,
    "auditLogs": 1500
  },
  "warnings": {
    "over50MB": false,
    "over10MB": false,
    "oldTaskData": false
  }
}
```

字段说明：

| 字段 | 说明 |
|------|------|
| `size.bytes` | 逻辑数据大小（所有集合 JSON 序列化后的字节数） |
| `size.kb` | 逻辑数据大小（KB） |
| `size.mb` | 逻辑数据大小（MB） |
| `storage.engine` | 数据库引擎，固定为 `SQLite` |
| `storage.driver` | 驱动名称，固定为 `better-sqlite3` |
| `storage.journalMode` | 日志模式（WAL 模式下为 `wal`） |
| `storage.path` | `data.db` 数据库文件绝对路径 |
| `storage.dbFileSize` | `data.db` 主文件大小（字节） |
| `storage.walSize` | `data.db-wal` WAL 文件大小（字节） |
| `storage.shmSize` | `data.db-shm` 共享内存文件大小（字节） |
| `storage.totalDiskSize` | 以上三个物理文件大小之和（字节） |
| `counts.users` | 用户数量 |
| `counts.designers` | 设计人员数量 |
| `counts.tasks` | 任务工作表数量 |
| `counts.taskItems` | 任务条目总数 |
| `counts.months` | 涉及的月份数 |
| `counts.statusTrackingItems` | 状态追踪记录数 |
| `counts.loginLogs` | 登录日志数 |
| `counts.auditLogs` | 操作日志数 |
| `warnings.over50MB` | 逻辑数据超过 50MB（仅提示，非硬限制） |
| `warnings.over10MB` | 逻辑数据超过 10MB（仅提示，非硬限制） |
| `warnings.oldTaskData` | 任务数据超过 24 个月 |

### 获取维护状态

`GET /api/system/maintenance`

权限：仅 `superadmin`

响应：

```json
{
  "settings": {
    "enabled": true,
    "dailyBackupEnabled": true,
    "dailyTaskExportEnabled": true,
    "dailyGunLedgerExportEnabled": true,
    "offlineBackupEnabled": true,
    "backupRetentionDays": 30,
    "taskExportRetentionDays": 30,
    "gunLedgerExportRetentionDays": 30,
    "offlineBackupRetentionDays": 7,
    "scheduleTime": "00:30",
    "yearlyCleanupEnabled": true,
    "yearlyCleanupMonth": 1,
    "yearlyCleanupCheckDays": 10,
    "yearlyTaskRetentionYears": 1,
    "backupDir": "backups/database",
    "taskExportDir": "backups/task-exports",
    "gunLedgerExportDir": "backups/gun-ledger-exports",
    "yearlyArchiveDir": "backups/yearly-archives",
    "offlineBackupDir": "backups/offline",
    "yearlyCleanupHistory": {}
  },
  "paths": {
    "database": "D:\\project\\backend\\data.db",
    "backupDir": "D:\\project\\backend\\backups\\database",
    "taskExportDir": "D:\\project\\backend\\backups\\task-exports",
    "gunLedgerExportDir": "D:\\project\\backend\\backups\\gun-ledger-exports",
    "yearlyArchiveDir": "D:\\project\\backend\\backups\\yearly-archives",
    "offlineBackupDir": "D:\\project\\backend\\backups\\offline"
  },
  "database": {
    "dbFileSize": 943718,
    "walSize": 102400,
    "shmSize": 32768,
    "totalDiskSize": 1078886,
    "tasksJsonSize": 524288,
    "tasksCount": 240,
    "taskItemsCount": 5000
  },
  "files": {
    "backups": [...],
    "taskExports": [...],
    "gunLedgerExports": [...],
    "yearlyArchives": [...],
    "offlineBackups": [...]
  },
  "scheduler": {
    "running": false,
    "lastRun": {...},
    "nextRunAt": "2026-07-11T00:30:00.000Z"
  }
}
```

字段说明：

| 字段 | 说明 |
|------|------|
| `settings.enabled` | 是否启用自动维护 |
| `settings.dailyBackupEnabled` | 是否启用每日数据库备份 |
| `settings.dailyTaskExportEnabled` | 是否启用每日任务数据导出 |
| `settings.dailyGunLedgerExportEnabled` | 是否启用每日编号台账导出 |
| `settings.offlineBackupEnabled` | 是否启用断网备份（服务关闭前自动备份） |
| `settings.backupRetentionDays` | 数据库备份保留天数 |
| `settings.taskExportRetentionDays` | 任务导出保留天数 |
| `settings.gunLedgerExportRetentionDays` | 编号台账导出保留天数 |
| `settings.offlineBackupRetentionDays` | 断网备份保留天数 |
| `settings.scheduleTime` | 计划执行时间（HH:MM） |
| `settings.yearlyCleanupEnabled` | 是否启用年度任务清理 |
| `settings.yearlyCleanupMonth` | 年度清理月份 |
| `settings.yearlyCleanupCheckDays` | 年度清理检查窗口天数 |
| `settings.yearlyTaskRetentionYears` | 任务数据保留年限 |
| `settings.backupDir` | 数据库备份目录 |
| `settings.taskExportDir` | 任务导出目录 |
| `settings.gunLedgerExportDir` | 编号台账导出目录 |
| `settings.yearlyArchiveDir` | 年度归档目录 |
| `settings.offlineBackupDir` | 断网备份目录 |
| `settings.yearlyCleanupHistory` | 年度清理历史记录 |
| `paths.database` | 数据库文件绝对路径 |
| `paths.backupDir` | 备份目录绝对路径 |
| `paths.taskExportDir` | 任务导出目录绝对路径 |
| `paths.gunLedgerExportDir` | 编号台账导出目录绝对路径 |
| `paths.yearlyArchiveDir` | 年度归档目录绝对路径 |
| `paths.offlineBackupDir` | 断网备份目录绝对路径 |
| `database.dbFileSize` | `data.db` 主文件大小（字节） |
| `database.walSize` | `data.db-wal` 文件大小（字节） |
| `database.shmSize` | `data.db-shm` 文件大小（字节） |
| `database.totalDiskSize` | 三个物理文件大小之和（字节） |
| `database.tasksJsonSize` | `tasks` 集合 JSON 序列化后的逻辑大小（字节） |
| `database.tasksCount` | 任务工作表数量 |
| `database.taskItemsCount` | 任务条目总数 |
| `files.backups` | 最近 5 个数据库备份文件列表 |
| `files.taskExports` | 最近 5 个任务导出文件列表 |
| `files.gunLedgerExports` | 最近 5 个编号台账导出文件列表 |
| `files.yearlyArchives` | 最近 5 个年度归档文件列表 |
| `files.offlineBackups` | 最近 5 个断网备份文件列表 |
| `scheduler.running` | 调度器是否正在运行 |
| `scheduler.lastRun` | 上一次执行结果 |
| `scheduler.nextRunAt` | 下次执行时间 |

### 更新维护配置

`PUT /api/system/maintenance`

权限：仅 `superadmin`

请求：

```json
{
  "enabled": true,
  "dailyBackupEnabled": true,
  "dailyTaskExportEnabled": true,
  "dailyGunLedgerExportEnabled": true,
  "offlineBackupEnabled": true,
  "backupRetentionDays": 30,
  "offlineBackupRetentionDays": 7,
  "taskExportRetentionDays": 30,
  "gunLedgerExportRetentionDays": 30,
  "scheduleTime": "00:30",
  "yearlyCleanupEnabled": true,
  "yearlyCleanupMonth": 1,
  "yearlyCleanupCheckDays": 10,
  "yearlyTaskRetentionYears": 1,
  "backupDir": "backups/database",
  "taskExportDir": "backups/task-exports",
  "gunLedgerExportDir": "backups/gun-ledger-exports",
  "yearlyArchiveDir": "backups/yearly-archives",
  "offlineBackupDir": "backups/offline"
}
```

字段说明（下表所有字段均为 **必填**，Joi 校验缺少任一字段返回 `400`；前端始终提交完整配置对象）：

| 字段 | 必填 | 说明 |
|------|------|------|
| `enabled` | 是 | 是否启用自动维护 |
| `dailyBackupEnabled` | 是 | 是否启用每日数据库备份 |
| `dailyTaskExportEnabled` | 是 | 是否启用每日任务数据导出 |
| `dailyGunLedgerExportEnabled` | 是 | 是否启用每日编号台账导出 |
| `offlineBackupEnabled` | 是 | 是否启用断网备份（服务关闭前自动备份） |
| `backupRetentionDays` | 是 | 数据库备份保留天数（1-3650） |
| `offlineBackupRetentionDays` | 是 | 断网备份保留天数（1-3650） |
| `taskExportRetentionDays` | 是 | 任务导出保留天数（1-3650） |
| `gunLedgerExportRetentionDays` | 是 | 编号台账导出保留天数（1-3650） |
| `scheduleTime` | 是 | 计划执行时间（格式 HH:MM） |
| `yearlyCleanupEnabled` | 是 | 是否启用年度任务清理 |
| `yearlyCleanupMonth` | 是 | 年度清理月份（1-12） |
| `yearlyCleanupCheckDays` | 是 | 年度清理检查窗口天数（1-31） |
| `yearlyTaskRetentionYears` | 是 | 任务数据保留年限（1-10） |
| `backupDir` | 是 | 数据库备份目录（相对路径，1-200 字符） |
| `taskExportDir` | 是 | 任务导出目录（相对路径，1-200 字符） |
| `gunLedgerExportDir` | 是 | 编号台账导出目录（相对路径，1-200 字符） |
| `yearlyArchiveDir` | 是 | 年度归档目录（相对路径，1-200 字符） |
| `offlineBackupDir` | 是 | 断网备份目录（相对路径，1-200 字符） |

> 说明：断网备份开关与目录（`offlineBackupEnabled`、`offlineBackupRetentionDays`、`offlineBackupDir`）同样通过本接口保存，立即生效。`yearlyCleanupHistory`（年度清理历史）由后端维护，不在接受字段范围内；其余未声明字段会被 Joi 自动过滤（`stripUnknown`）。

响应：返回更新后的维护状态，结构同 `GET /api/system/maintenance`。

### 手动执行数据库备份

`POST /api/system/maintenance/backup`

权限：仅 `superadmin`

响应：

```json
{
  "message": "数据库备份已完成",
  "backup": {
    "fileName": "db-backup-20260710-103000.db",
    "filePath": "D:\\project\\backend\\backups\\database\\db-backup-20260710-103000.db",
    "dir": "D:\\project\\backend\\backups\\database",
    "size": 1048576
  }
}
```

> 备份使用 SQLite 在线备份 API 生成，并会切换到 DELETE 日志模式把 WAL 内容合并进主文件，最终只保留单个干净的 `.db` 文件，不产生 `.db-wal`/`.db-shm` 伴随文件。

### 手动导出任务数据

`POST /api/system/maintenance/export-tasks`

权限：仅 `superadmin`

响应：

```json
{
  "message": "任务表格已导出",
  "taskExport": {
    "fileName": "task-export-20260710-103000.xls",
    "filePath": "D:\\project\\backend\\backups\\task-exports\\task-export-20260710-103000.xls",
    "dir": "D:\\project\\backend\\backups\\task-exports",
    "size": 524288,
    "taskSheets": 240,
    "taskItems": 5000,
    "type": "manual-task-export"
  }
}
```

说明：

- 导出内容为渲染后的任务表 `.xls`（与 `GET /api/system/export-xls` 相同的工作簿格式），而非 JSON 数据；每日定时自动导出的文件名为 `task-export-YYYYMMDD-HHmmss.xls`，`type` 为 `scheduled-task-export`。
- 没有任何任务数据时返回 `404` 和 `没有可导出的数据`。

### 手动导出编号台账

`POST /api/system/maintenance/export-gun-ledger`

权限：仅 `superadmin`

响应：

```json
{
  "message": "编号台账已导出",
  "gunLedgerExport": {
    "fileName": "gun-ledger-all-20260710-103000.xls",
    "filePath": "D:\\project\\backend\\backups\\gun-ledger-exports\\gun-ledger-all-20260710-103000.xls",
    "dir": "D:\\project\\backend\\backups\\gun-ledger-exports",
    "size": 262144,
    "categories": 3,
    "tables": 11,
    "rows": 150,
    "type": "manual-gun-ledger-export"
  }
}
```

说明：

- 导出内容为全部焊枪编号台账的单个 `.xls`（每分类一个工作表），与 `GET /api/gun-ledger/export-all` 格式相同；每日定时自动导出的 `type` 为 `scheduled-gun-ledger-export`。
- 没有任何台账数据时返回 `404` 和 `没有可导出的编号台账数据`。

### 清理过期备份

`POST /api/system/maintenance/cleanup-backups`

权限：仅 `superadmin`

响应：

```json
{
  "message": "过期备份清理已完成",
  "cleanup": {
    "retentionDays": 30,
    "removedCount": 5,
    "removed": [...]
  }
}
```

### 手动执行年度任务清理

`POST /api/system/maintenance/yearly-cleanup`

权限：仅 `superadmin`

请求体（JSON，可选）：

| 字段 | 必填 | 说明 |
|------|------|------|
| `force` | 否 | 是否强制执行（跳过时间检查），传 `true` 启用；默认 `false` |

请求示例：

```json
{
  "force": true
}
```

响应（执行成功）：

```json
{
  "message": "年度任务清理检测已完成",
  "yearlyCleanup": {
    "skipped": false,
    "cutoffYear": 2025,
    "archivedSheets": 120,
    "removedSheets": 120,
    "removedTaskItems": 2500,
    "archive": {
      "fileName": "yearly-archive-before-2025-20260710-103000.json",
      "filePath": "...",
      "dir": "...",
      "size": 262144,
      "taskSheets": 120,
      "taskItems": 2500
    }
  }
}
```

响应（跳过执行）：

```json
{
  "message": "年度任务清理检测已跳过",
  "yearlyCleanup": {
    "skipped": true,
    "reason": "disabled"
  }
}
```

说明：

- 年度清理会在指定月份的前 N 天（`yearlyCleanupCheckDays`）自动执行。
- 清理前会将旧数据归档到 `yearlyArchiveDir`。
- 每年只执行一次，记录在 `yearlyCleanupHistory` 中。

### 手动触发断网备份

`POST /api/system/maintenance/offline-backup`

权限：本机环回地址（`127.0.0.1`/`::1`/IPv4 映射地址 `::ffff:127.0.0.1`，供 stop.bat 等本地运维脚本匿名调用）；非环回请求须为已登录的 `superadmin`。环回判断使用 Socket 对端地址（`req.socket.remoteAddress`），`trust proxy` 下伪造 `X-Forwarded-For` 无法绕过。

说明：

- 后端服务收到 `SIGINT`/`SIGTERM` 信号关闭前会自动触发一次断网备份。
- 同一次会话内 5 分钟内只会生成一次，避免短时间重复备份。
- 备份文件存储在 `offlineBackupDir`（默认 `backups/offline`）。
- 文件名格式：`offline-backup-shutdown-{YYYYMMDD-HHmmss}.db`（关闭触发）或 `offline-backup-{userId}-{username}-{YYYYMMDD-HHmmss}.db`（用户触发）。

响应（成功）：

```json
{
  "message": "断网备份已完成",
  "backup": {
    "fileName": "offline-backup-shutdown-20260710-103000.db",
    "filePath": "D:\\project\\backend\\backups\\offline\\offline-backup-shutdown-20260710-103000.db",
    "dir": "D:\\project\\backend\\backups\\offline",
    "skipped": false,
    "success": true,
    "size": 1048576
  }
}
```

响应（跳过）：

```json
{
  "message": "断网备份已跳过",
  "reason": "rate-limited"
}
```

跳过原因：

| `reason` | 说明 |
|----------|------|
| `offline-backup-disabled` | 断网备份开关关闭 |
| `rate-limited` | 5 分钟内已生成过断网备份 |

### 清空所有日志

`POST /api/system/maintenance/clear-logs`

权限：仅 `superadmin`

说明：

- 同时清空 `loginLogs` 和 `auditLogs` 两个数组。
- 与 `DELETE /api/system/cleanup/login-logs` 和 `DELETE /api/system/cleanup/audit-logs` 不同，本接口一次清空两类日志。

响应：

```json
{
  "message": "日志已清空",
  "loginLogsCount": 200,
  "auditLogsCount": 1500
}
```

### 清理指定月份任务

`POST /api/system/maintenance/cleanup-tasks`

权限：仅 `superadmin`

请求体（两种模式二选一）：

```json
{
  "month": 7,
  "year": 2026
}
```

或

```json
{
  "beforeMonth": 7,
  "beforeYear": 2026
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `month` + `year` | 二选一 | 删除指定月份的任务工作表 |
| `beforeMonth` + `beforeYear` | 二选一 | 删除指定年月之前的所有任务工作表 |

响应：

```json
{
  "message": "任务数据清理完成",
  "removedCount": 12,
  "remainingCount": 120
}
```

说明：

- 清理后通过 Socket.IO 广播 `task_refreshed` 通知所有客户端刷新数据。
- 与 `DELETE /api/system/cleanup/old-tasks?keepMonths=N` 不同，本接口按精确年月清理，而非按"最近 N 个月"。

### 清空登录日志

`DELETE /api/system/cleanup/login-logs`

权限：仅 `superadmin`

响应：

```json
{
  "message": "登录日志已清空",
  "cleanedCount": 200
}
```

### 清空操作日志

`DELETE /api/system/cleanup/audit-logs`

权限：仅 `superadmin`

响应：

```json
{
  "message": "操作日志已清空",
  "cleanedCount": 1500
}
```

### 清理旧任务数据

`DELETE /api/system/cleanup/old-tasks`

权限：仅 `superadmin`

查询参数：

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `keepMonths` | 否 | `12` | 保留最近 N 个月的任务数据 |

响应：

```json
{
  "message": "已清理 12 个月之前的任务数据",
  "removedSheets": 120,
  "removedTaskItems": 2500,
  "remainingSheets": 120,
  "dbSizeKbAfter": 512.00
}
```

### 清理旧状态追踪数据

`DELETE /api/system/cleanup/status-tracking`

权限：仅 `superadmin`

查询参数：

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `keepMonths` | 否 | `24` | 保留最近 N 个月的状态追踪数据 |

响应：

```json
{
  "message": "已清理 24 个月之前的状态追踪数据",
  "removedCount": 50,
  "remainingCount": 50
}
```

## 工时管理表接口

### 导出工时管理表

`GET /api/work-hours/export`

权限：需要登录。取决于 `settings.workHours` 的权限配置。

说明：

- `superadmin` 始终可导出。
- `admin` 需要 `settings.workHours.enabled=true` 且 `allowAdmins=true`。
- `user` 需要 `settings.workHours.enabled=true` 且 `allowViewers=true`。
- 游客不能导出。

查询参数：

| 参数 | 必填 | 说明 |
|------|------|------|
| `month` | 是 | 月份，格式 `YYYY-MM` |

响应：`.xls` 文件流，文件名格式为 `work-hours-YYYY-MM.xls`。

导出列说明：

| 列名 | 说明 |
|------|------|
| 设计员 | 设计人员姓名 |
| 总工时 | 所有任务工时总和（不含请假） |
| 工作日工时 | 工作日内的任务工时（按覆盖规则计算） |
| 周末加班工时 | 周末加班工时（总工时 - 工作日工时） |
| 出差工时 | 出差任务的工时总和 |
| 请假工时 | 事假 + 休假 + 病假工时总和 |

统计规则：

- 工作日工时和周末加班工时按 `settings.workdayOverrides` 覆盖后的有效工作日/周末计算。
- 请假类型包括：事假（`sick`）、休假（`vacation`）、病假（`illness`）。
- 出差任务（`leaveType: trip`）不计入请假工时，但计入总工时和工作日/周末加班工时。
- 按总工时倒序排列。
- 冻结首行和首列。
- 工时为 0 的单元格显示为空。

## 仕样号搜索接口

> 通用校验：本章节所有接口的 `specNumber` 必须为纯数字，且位数需与系统设置 `specNumberDigits`（5 或 6 位，默认 5）一致；位数不符时返回 `仕样号必须为 N 位数字`（N 为当前配置位数）。

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

- `specNumber` 必须为纯数字，且位数需与系统设置 `specNumberDigits` 一致（5 或 6 位，默认 5）。
- 系统会查找 `仕样书$\12345.PDF` 及 `12345.01.PDF` ～ `12345.99.PDF` 等版本文件，取最新版本。
- 从 PDF 中搜索“纳期”关键词，提取日期信息。
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
| `仕样号必须为 N 位数字` | `specNumber` 位数与系统配置 `specNumberDigits`（5 或 6）不一致 |
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

- `specNumber` 必须为纯数字，且位数需与系统设置 `specNumberDigits` 一致（见章节通用校验）。
- 系统会查找 `仕样书$\12345.PDF` 及 `12345.01.PDF` ～ `12345.99.PDF` 等版本文件，取最新版本。
- 请求超时时间为 15 秒。
- 需要能够访问共享目录（网络权限）。
- 路径安全校验：`specNumber` 参数会进行多层严格校验，防止路径遍历攻击：
  - 禁止包含 `..`、`/`、`\`、`:` 等特殊字符
  - 检测 URL 编码绕过（如 `%2e%2e`、`%2e.`、`.%2e`）
  - 检测 Unicode 编码绕过（如全角句号 `．．`、零宽字符等）
  - 强制限制为纯数字，且长度不超过 20 位
  - 路径拼接后检查前缀，确保在允许的共享目录范围内
  校验失败返回 `400` 错误。

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

### 认证机制

WebSocket 连接建立时需携带 JWT Token，支持以下两种方式：

1. **通过 `socket.handshake.auth.token`**：
   ```javascript
   io.connect('http://localhost:5000', {
     auth: {
       token: 'your-jwt-token'
     }
   });
   ```

2. **通过 `Authorization` 请求头**：
   ```javascript
   io.connect('http://localhost:5000', {
     extraHeaders: {
       Authorization: 'Bearer your-jwt-token'
     }
   });
   ```

认证失败时服务端会拒绝连接并返回错误：
- `Authentication error: No token provided`：未提供令牌
- `Authentication error: User not found`：用户不存在
- `Authentication error: Account disabled`：账号已禁用
- `Authentication error: Session invalidated`：会话已失效（单设备登录限制）

连接成功后，用户信息会附加到 `socket.data.user`，包含 `id`、`username`、`name`、`role` 字段。服务端会立即下发 `editing_state`（主页面编辑状态）、`gun_ledger_editing_state`（焊枪台账行编辑状态）和 `gun_ledger_table_locks_state`（焊枪台账表级锁快照）。

### 编辑状态管理

后端使用 `designerId::date` 作为键管理编辑会话，同一用户同时只能编辑一个单元格，切换编辑时会自动释放之前的编辑状态。多人同时使用时，同一设计人员同一天只允许一个用户编辑，其他用户会看到红色"正在编辑"提示。

### 焊枪台账编辑锁

焊枪台账有两级编辑锁：

1. **行锁（取号锁）**：后端使用 `tableId::serialNumber` 作为键管理行编辑会话，同一用户同时只持一把行锁，切换行时自动释放之前的行锁。用于焊枪名取号时的并发控制。
2. **表级独占编辑锁**：每张表同一时刻只允许一名用户编辑（按 `userId` 判定，同一用户多标签页共享一把锁）。锁通过 Socket 生命周期 + 心跳维持：
   - `gun_ledger_lock_table` 申请锁，被他人占用时返回 `gun_ledger_table_lock_blocked`。
   - `gun_ledger_unlock_table` 释放锁（引用归零才真正释放）。
   - `gun_ledger_table_heartbeat` 每 20 秒续期一次（服务端 TTL 60 秒）。
   - 断开连接时移除该 socket 的锁引用，引用归零即释放锁。
   - 后台每 30 秒清理心跳超时且无存活连接的僵死锁。
   - `PUT /api/gun-ledger/tables/:tableId/rows` 和 `initialize-gun-names` 接口会校验表锁，被他人持有时返回 `409`。
   - 表被删除、分类被删除、导入覆盖时会强制释放该表的锁。

### 多设备登录踢下线机制

连接建立时，服务端会自动将 socket 加入 `user:${user.id}` room（无需客户端发送 `register_user` 事件）。新登录时，后端通过 `io.to(user:${user.id}).emit('session_invalidated', ...)` 通知该用户的其他设备下线。关闭多设备登录时（`allowMultiDevice=false`），新登录会使旧会话失效。

### 连接恢复自动加载

Socket 重连成功后会自动触发 `task_refreshed`，前端重新加载最新数据。

### 客户端事件

| 事件 | 说明 |
|------|------|
| `connect` | Socket 连接成功（可用于检测后端是否恢复） |
| `connect_error` | Socket 连接失败（后端端口断开或网络异常） |
| `task_updated` | 通知任务已更新，后端收到后会广播 `task_refreshed` 给其他客户端 |
| `start_editing` | 通知开始编辑，参数包含 `designerId`、`date`（可选 `mode` 为 `edit` 或 `colorMark`） |
| `stop_editing` | 通知停止编辑，可传 `designerId` 和 `date` 释放指定单元格；不传则释放当前 socket 的编辑状态 |
| `status_tracking_start_edit` | 通知开始编辑状态追踪记录，参数包含 `itemId` |
| `status_tracking_stop_edit` | 通知停止编辑状态追踪记录，参数包含 `itemId` |
| `gun_ledger_start_edit` | 通知开始编辑焊枪台账某行（取号），参数包含 `tableId`、`serialNumber` |
| `gun_ledger_stop_edit` | 通知停止编辑焊枪台账某行，参数包含 `tableId`、`serialNumber` |
| `gun_ledger_lock_table` | 申请焊枪台账表级独占编辑锁，参数包含 `tableId` |
| `gun_ledger_unlock_table` | 释放焊枪台账表级编辑锁，参数包含 `tableId` |
| `gun_ledger_table_heartbeat` | 焊枪台账表级锁心跳续期，参数包含 `tableId` |

### 服务端事件

| 事件 | 说明 |
|------|------|
| `task_refreshed` | 任务数据已刷新，其他客户端收到后会重新加载数据 |
| `editing_state` | 当前所有编辑中的单元格状态，连接成功后下发 |
| `user_editing` | 某用户正在编辑指定设计人员日期单元格 |
| `editing_blocked` | 当前单元格已被其他用户编辑，服务端拒绝新的编辑请求 |
| `user_stopped_editing` | 某用户停止编辑指定设计人员日期单元格 |
| `session_invalidated` | 当前会话被新登录踢下线 |
| `status_tracking_edit_start` | 某用户开始编辑指定状态追踪记录，参数 `{ itemId, userId, username, socketId }` |
| `status_tracking_edit_stop` | 某用户停止编辑指定状态追踪记录，参数 `{ itemId }` |
| `status_tracking_updated` | 状态追踪记录更新，包含 `action`（add/update/delete）和 `item` 或 `itemId` |
| `status_tracking_bulk` | 状态追踪批量更新，包含所有记录列表 |
| `gun_ledger_editing_state` | 当前焊枪台账行编辑状态，连接成功后下发 |
| `gun_ledger_table_locks_state` | 当前焊枪台账表级锁快照，连接成功后下发 |
| `gun_ledger_edit_start` | 某用户开始编辑焊枪台账某行，参数 `{ tableId, serialNumber, userId, username, name }` |
| `gun_ledger_edit_stop` | 某用户停止编辑焊枪台账某行，参数 `{ tableId, serialNumber, userId }` |
| `gun_ledger_edit_blocked` | 当前行已被其他用户编辑，参数为占用会话 |
| `gun_ledger_table_locked` | 某表被锁定（表级独占编辑锁），参数 `{ tableId, userId, username, name, lockedAt }` |
| `gun_ledger_table_unlocked` | 某表锁被释放，参数 `{ tableId }` |
| `gun_ledger_table_lock_blocked` | 申请表级锁被他人占用，参数 `{ tableId, holder }` |
| `gun_ledger_updated` | 焊枪台账数据变更，参数含 `action`（import/add_category/delete_category/add_table/rename_table/delete_table/reorder_tables/reorder_categories/update_rows/gun_name_rule/default_persons）及相关数据 |
| `error` | 事件处理出错，参数 `{ message }`（如未认证、缺少必填字段） |

## 常见错误码

| 错误码 | HTTP | 说明 |
|--------|------|------|
| `ACCOUNT_DISABLED` | 403 | 账号已禁用 |
| `FORCE_PASSWORD_CHANGE` | 403 | 未修改初始密码，除「修改密码」「退出登录」外的接口一律被拦截 |
| `SESSION_INVALIDATED` | 401 | 会话在其他设备登录后失效 |
| `USER_NOT_FOUND` | 401 | 校验会话时用户不存在（`GET /api/auth/validate`） |
| `WEKNORA_MULTI_TENANT` | 400 | 问答所选知识库跨越多个工作空间 |
| `WEKNORA_KB_FORBIDDEN` | 403 | 知识库在所有已配置工作空间均不可访问 |
| `WEKNORA_NO_QA_MODEL` | 503 | 知识库所属工作空间没有可用的 KnowledgeQA 问答模型 |
| `WEKNORA_NOT_CONFIGURED` | 503 | WeKnora 未启用或未配置任何 API Key |

未带 `code` 字段的通用错误状态：

| HTTP | 常见消息 | 说明 |
|------|----------|------|
| 400 | `输入格式不正确` / `请指定清理时间点` 等 | 参数校验失败 |
| 401 | `No token, authorization denied` / `Token is not valid` / `用户名或密码错误` | 未认证、Token 无效或登录凭证错误 |
| 403 | `超级管理员资源，访问被拒绝。` / `管理员资源，访问被拒绝。` / `无权访问` / `只有管理员可以编辑表格` | 权限不足（超管接口/管理员接口/页面权限开关未放行） |
| 404 | `用户不存在` / `任务条目不存在` / `记录未找到` / `没有可导出的数据` 等 | 资源不存在 |
| 429 | `请求过于频繁，请稍后再试` / `登录尝试过于频繁，请15分钟后再试` / `密码修改尝试过于频繁，请15分钟后再试` | 触发全局 API 限流、登录限流或修改密码限流 |
| 500 | `服务器内部错误` | 服务端错误 |

注意：

- 登录接口受独立速率限制（按「IP + 用户名」计数，15 分钟内最多 20 次尝试），超限返回 `登录尝试过于频繁，请15分钟后再试`。
- 修改密码接口受独立速率限制（按「用户 ID」计数，15 分钟内最多 5 次尝试），超限返回 `密码修改尝试过于频繁，请15分钟后再试`。
- 全部 `/api` 接口还受全局限流保护（按 IP 计数，默认每 15 分钟 3000 次，可用 `API_RATE_LIMIT_MAX` 调整），超限返回 HTTP `429` 与消息 `请求过于频繁，请稍后再试`；`OPTIONS` 预检与本机环回请求不计数。
- 登录请求体校验：`username` 为 3-30 位字母数字，`password` 至少 6 位。

## 数据库迁移说明

系统启动时会自动执行数据库迁移：

1. **任务数据结构迁移**：将旧版 `hours` 对象格式迁移为新版 `days` 对象格式
2. **日期格式规范化**：统一日期格式为 `YYYY-MM-DD`，截取前 10 位
3. **配置自动补齐**：首次启动或旧版本升级时，自动补齐缺失的默认配置（含 `leaderboard`、`workHours`、`statusTracking`、`systemSettings`、`workdayOverrides`、`system` 等）
4. **用户字段迁移**：自动为旧用户补齐 `disabled` 和 `forcePasswordChange` 字段
5. **强制修改密码迁移**：首次访问用户列表或校验会话时，自动将非超级管理员用户的 `forcePasswordChange` 标记为 `true`

迁移规则：
- 迁移过程会自动保存到 SQLite 数据库（`backend/data.db`）
- 若存在遗留 `backend/db.json`，首次启动会自动导入到 SQLite
- 迁移后会在控制台输出迁移信息
- 多次启动不会重复迁移

## 安全特性

1. **JWT 认证**：使用 JWT Token 进行身份验证，默认过期时间为 3 天（可通过 `JWT_EXPIRES_IN` 配置）；配合服务端会话吊销，登出、改密、账号禁用后旧 Token 立即失效
2. **密码加密**：使用 bcrypt 对密码进行哈希加密
3. **多层限流**：全局 API 限流按 IP 计数（15 分钟 3000 次，可通过 `API_RATE_LIMIT_MAX` 调整，`OPTIONS` 预检与本机环回不计）；登录接口按「IP + 用户名」15 分钟最多 20 次尝试；修改密码接口按「用户 ID」15 分钟最多 5 次尝试（后两项阈值在 `backend/routes/auth.js` 中硬编码），超限返回 HTTP `429`
4. **真实 IP 防伪造**：`trust proxy` 为 `loopback`，仅信任本机回环代理转发的 `X-Forwarded-For`；日志与限流使用 `req.ip`，不直接读取 `X-Forwarded-For` / `X-Real-IP`
5. **请求验证**：使用 Joi 进行请求参数验证
6. **安全头**：使用 Helmet 设置安全相关的 HTTP 头（含收敛 CSP：资源仅限同源、禁用插件、禁止页面被嵌入框架）
7. **跨域保护**：配置 CORS 限制跨域请求（可通过 `CORS_ORIGIN` 配置；通配符模式下自动不启用 credentials）
8. **账号禁用**：支持禁用账号，禁用后无法登录
9. **多设备登录控制**：可配置是否允许同一账号多设备同时在线
10. **强制修改密码**：新建用户或被重置密码后，下次登录需修改密码；标记未清除前，除「修改密码」「退出登录」外的所有接口一律返回 `403`（`FORCE_PASSWORD_CHANGE`）
11. **操作审计**：自动记录所有已登录用户的 API 请求，最多保留 2000 条；记录时递归脱敏（支持嵌套对象与数组），字段名匹配 `password`/`passwd`/`secret`/`token`/`api_key`/`apikey`/`authorization`（不区分大小写）一律显示为 `[REDACTED]`
12. **登录失败全量留痕与防枚举**：登录成功与失败均写登录日志，失败日志含 `reason`（`用户不存在` / `账号已禁用` / `密码错误`）；对客户端统一返回 `用户名或密码错误`，不暴露用户名是否存在
13. **Excel 依赖本地化**：Excel 解析使用随仓库分发的 `xlsx@0.20.3`（`backend/vendor/xlsx-0.20.3.tgz`，`file:` 协议安装），修复旧版 0.18.5 的 CVE-2023-30533 与 CVE-2024-22363

## 环境变量配置

后端支持以下环境变量，通过 `backend/.env` 文件配置（参考 [backend/.env.example](../backend/.env.example)）：

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `PORT` | `5000` | 后端服务端口 |
| `NODE_ENV` | `development` | 运行环境（`development` / `production`） |
| `JWT_SECRET` | **必填** | JWT 签名密钥，缺失将导致服务无法启动，生产环境必须修改为随机字符串 |
| `JWT_EXPIRES_IN` | `3d` | JWT Token 过期时间（默认 3 天；会话吊销独立于有效期生效） |
| `JWT_ISSUER` | `obara-task-manager` | JWT 签发方 |
| `JWT_AUDIENCE` | `obara-task-manager-api` | JWT 接收方 |
| `CORS_ORIGIN` | `*`（未配置时） | 允许的前端地址，多个用逗号分隔；未配置时后端允许任意来源且不启用 CORS credentials |
| `GITEE_TOKEN` | - | Gitee API Token，用于版本检查 |
| `GITEE_REPO_OWNER` | - | Gitee 仓库用户名 |
| `GITEE_REPO_NAME` | - | Gitee 仓库名称 |
| `SQLITE_DB_PATH` | `./data.db` | SQLite 数据库文件路径 |
| `DB_PATH` | `./db.json` | 遗留 JSON 数据库路径，仅首次启动时用于自动迁移到 SQLite |
| `RATE_LIMIT_WINDOW_MS` | `900000` | 限流窗口时间（毫秒），仅在 `security.js` 配置中定义；当前登录/改密限流器使用硬编码阈值，未读取此变量 |
| `RATE_LIMIT_MAX` | `20` | 限流最大次数，同上，当前未被独立限流器使用 |
| `API_RATE_LIMIT_MAX` | `3000` | 全局 API 限流：每个 IP 15 分钟最大请求数，覆盖全部 `/api` 接口；`OPTIONS` 预检与本机环回不计数，超限返回 `429` |
| `DEFAULT_ADMIN_USERNAME` | `superadmin` | 默认管理员用户名（首次启动时创建，仅当不存在超级管理员时生效） |
| `DEFAULT_ADMIN_PASSWORD` | 空 | 默认管理员密码；留空时首次启动自动生成随机密码并仅在后端控制台显示一次（隐藏窗口启动时见 `logs/backend.log`），显式设置时首次启动后应立即修改 |
| `SPEC_SHARE_PATH` | `\\192.168.160.6\仕样书$` | 仕样书 PDF 共享目录路径 |
| `LOG_LEVEL` | `info` | 预留变量：当前版本代码未读取，设置后不生效 |
| `WEKNORA_ENABLED` | `false` | 是否启用设计规范知识库接入 |
| `WEKNORA_BASE_URL` | `http://127.0.0.1:8080/api/v1` | WeKnora API 根地址 |
| `WEKNORA_API_KEY` | 空 | 主工作空间 API Key，仅服务端使用 |
| `WEKNORA_EXTRA_API_KEYS` | 空 | 其他工作空间 API Key，多个用英文逗号分隔 |
| `WEKNORA_TIMEOUT_MS` | `60000` | WeKnora 普通请求超时（毫秒） |
| `WEKNORA_KNOWLEDGE_BASE_IDS` | 空 | 预留兜底知识库 ID（逗号分隔）；当前页面始终显式传入选中的知识库 ID，该变量实际不参与检索/问答 |

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
  jwt: { secret, expiresIn, issuer, audience },
  cors: { origin, methods, credentials },
  rateLimit: { windowMs, max },
  gitee: { token, repoOwner, repoName },
  server: { port, environment },
  database: { legacyJsonPath, sqlitePath },
  spec: { sharePath }
}
```

字段说明：

| 字段 | 说明 |
|------|------|
| `jwt.issuer` | JWT 签发者，默认 `obara-task-manager` |
| `jwt.audience` | JWT 受众，默认 `obara-task-manager-api` |
| `rateLimit.windowMs` / `rateLimit.max` | 配置块仍保留，但当前三层限流器均未读取这两个值：全局限流阈值取环境变量 `API_RATE_LIMIT_MAX`（默认 3000），窗口固定 15 分钟；登录/改密独立限流阈值在 `backend/routes/auth.js` 内硬编码 |
| `database.legacyJsonPath` | 遗留 JSON 数据库路径（`DB_PATH`，默认 `./db.json`），仅首次启动迁移时使用 |
| `database.sqlitePath` | SQLite 数据库路径（`SQLITE_DB_PATH`，默认 `./data.db`） |
| `spec.sharePath` | 仕样书 PDF 共享目录路径，默认 `\\192.168.160.6\仕样书$` |

最后更新：2026-09-26
