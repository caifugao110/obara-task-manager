# API 文档

本文档描述 Obara 任务管理系统当前后端 API。默认开发地址为：

```text
http://localhost:5000/api
```

需要认证的接口使用 JWT：

```text
Authorization: Bearer <token>
```

## 目录

- [通用说明](#通用说明)
- [角色](#角色)
- [权限速查](#权限速查)
- [认证接口](#认证接口)
- [用户接口](#用户接口)
- [设计人员接口](#设计人员接口)
- [任务接口](#任务接口)
- [页面权限设置接口](#页面权限设置接口)
- [状态追踪接口](#状态追踪接口)
- [焊枪台账接口](#焊枪台账接口)
- [设计规范知识库接口](#设计规范知识库接口)
- [系统设置接口](#系统设置接口)
- [工时管理表接口](#工时管理表接口)
- [仕样号搜索接口](#仕样号搜索接口)
- [前端批量导入模板](#前端批量导入模板)
- [Socket.IO](#socketio)
- [常见错误码](#常见错误码)
- [数据库初始化说明](#数据库初始化说明)
- [安全特性](#安全特性)
- [环境变量配置](#环境变量配置)
- [配置文件结构](#配置文件结构)

## 通用说明

- 大多数接口直接返回 JSON 对象或数组，不统一包裹 `success/data`。
- 错误响应通常包含 `message`，部分接口包含 `code` 或 `details`。
- 所有业务接口均需登录（有效 JWT），未提供游客/匿名访问；唯一无需登录的查询类接口是 `GET /api/auth/session-policy`（会话有效期政策，供登录页展示提示）。另有一个人为设计的例外：`POST /api/system/maintenance/offline-backup` 允许**本机环回地址匿名调用**（供 `stop.bat` 等运维脚本在停止服务前触发备份；非环回请求仍须超级管理员），详见维护章节。
- 请求体默认使用 `application/json`；文件导入接口使用 `multipart/form-data`。
- 日期字段通常使用 `YYYY-MM-DD`，月份字段通常使用 `YYYY-MM`，任务查询中的 `month` 使用数字 `1-12`。
- 后端会通过 Joi 或路由逻辑丢弃未知字段或返回 `400`，调用方不要依赖未声明字段被保存。
- 全部 `/api` 接口启用全局限流：默认每个 IP 15 分钟 3000 次（`OPTIONS` 预检与本机环回请求不计数，可用环境变量 `API_RATE_LIMIT_MAX` 调整），超限返回 HTTP `429`；登录、修改密码另有更严格的独立限流。
- 超级管理员启用 IP 黑名单后，命中规则的来源 IP 访问任意 `/api` 接口返回 HTTP `403`（`code=IP_BANNED`）；`OPTIONS` 预检与本机回环地址不拦截（详见「IP 黑名单管理」）。
- 本文中的“管理员”指 `admin` 或 `superadmin`；“仅超级管理员”只允许 `superadmin`。
- 后端只提供 `/api/*` 接口和 Socket.IO 服务，**不托管前端静态文件**（未挂载 `express.static`），也没有 `/health` 健康检查接口；生产环境前端需独立部署（前端构建基础路径为 `/obara-task-manager/`）。

## 角色

| 角色 | 说明 |
|------|------|
| `superadmin` | 超级管理员 |
| `admin` | 一般管理员 |
| `user` | 普通用户 |

普通用户登录后可查看主页面。任务报表、工时管理、状态追踪和焊枪台账必须登录后访问，是否允许普通用户进入由对应页面的 `allowViewers` 控制（焊枪台账对普通用户仅为只读浏览）。

## 权限速查

| 能力 | user | admin | superadmin |
|------|------|-------|------------|
| 查看主页面任务和设计人员 | 是 | 是 | 是 |
| 编辑任务 | 否 | 是 | 是 |
| 枪名搜索 / 确认图修改快速添加（`GET /api/tasks/gun-name-search`） | 否 | 是 | 是 |
| 管理设计人员 | 否 | 是 | 是 |
| 管理登录用户 | 否 | 只能创建/维护普通用户 | 是 |
| 禁用/启用登录用户（单个 + 批量） | 否 | 仅普通用户 | 是（超管账号除外） |
| 删除登录用户（单个 + 批量） | 否 | 仅普通用户 | 是（超管账号除外） |
| 设置用户权限（改角色） | 否 | 否 | 是 |
| 批量重置登录用户密码 | 否 | 否 | 是 |
| 页面权限设置 | 否 | 否 | 是 |
| 系统设置登录管理、日志管理 | 否 | 否 | 是 |
| 系统设置数据管理导出 | 否 | 取决于 `systemSettings.allowAdmins` | 是 |
| 系统设置数据管理导入 | 否 | 否 | 是 |
| 查看和修改组长规则 | 否 | 是 | 是 |
| 重置组长规则为默认 | 否 | 否 | 是 |
| 查看和修改工厂规则 | 否 | 是 | 是 |
| 重置工厂规则为默认 | 否 | 否 | 是 |
| 查看焊枪台账 | 取决于 `gunLedger.allowViewers`（只读） | 取决于 `gunLedger.allowAdmins` | 是 |
| 编辑焊枪台账（分类/表/行） | 否 | 取决于 `gunLedger.allowAdmins` | 是 |
| 删除焊枪台账分类/表 | 否 | 否（按钮可见但拦截） | 是 |
| 配置焊枪名规则/台账初始化（焊枪名初始化/批量初始化）/管理默认担当/配置默认工时规则（`tableGunHours`） | 否 | 否 | 是 |
| 导入焊枪台账 | 否 | 否 | 是 |
| 检索/问答/查看知识库文档清单 | 取决于 `designStandards.allowViewers` | 取决于 `designStandards.allowAdmins` | 是 |
| 关联/取消关联知识库 | 否 | 是 | 是 |
| 配置答复约束提示词 | 否 | 否 | 是 |
| 管理 IP 黑名单（查看/启停/增删规则） | 否 | 否 | 是 |

说明：

- 所有页面和接口均需登录，未登录用户会被重定向到登录页。
- `settings.leaderboard`、`settings.workHours`、`settings.statusTracking` 控制对应页面是否允许 `admin` 和已登录 `user` 访问。
- `settings.gunLedger` 控制焊枪台账页面访问权限：`allowViewers=true` 时普通用户可进入 `/gun-ledger` 只读浏览（GET 接口经 `accessSettingsMiddleware` 放行，写接口仍要求 `admin` 及以上）；一般管理员可见删除分类/表按钮但点击被拦截（提示需超级管理员权限）。
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
- 关闭多设备登录时，新登录会使旧会话失效。开启多设备登录时，同一账号的多个会话并存（每账号上限 10 个，超出淘汰最早会话），新登录不会使旧设备下线；登出仅吊销当前设备的会话。
- 关闭多设备登录且新登录触发旧会话踢出时，本次登录只记录一条 `action=forced_previous_logout`（登录并踢出旧会话）的成功日志，不再额外重复记录普通登录成功日志。
- `forcePasswordChange=true` 时前端需引导用户到 `/change-password` 修改密码。
- **未修改初始密码期间的 API 拦截**：`forcePasswordChange` 标记未清除前，除 `POST /api/auth/change-password` 和 `POST /api/auth/logout` 外的所有已登录接口一律返回 `403`（`code=FORCE_PASSWORD_CHANGE`）。
- 登录接口受三层速率限制：第一层按 IP 15 分钟内最多 300 次尝试（`LOGIN_IP_RATE_LIMIT_MAX` 可调整，堵密码喷洒缺口）；第二层按「IP + 用户名」15 分钟内最多 20 次尝试（防止单账号爆破），两层均超限返回 HTTP `429` 与消息 `登录尝试过于频繁，请15分钟后再试`；此外还受全局 API 限流（默认每 IP 15 分钟 3000 次）约束。
- 登录成功时会在用户记录上维护两个登录时间字段：把原 `lastLoginAt` 移到 `previousLoginAt`，再把 `lastLoginAt` 写为本次登录时间（首次登录时 `previousLoginAt` 为 `null`）。这两个字段经 `GET /api/auth/client-info` 下发，供前端展示「上次登录」。

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

会话失效时返回 `401`（`code=SESSION_INVALIDATED`），`message` 按失效原因区分：

| 场景 | message |
|------|---------|
| 关闭多设备登录，新登录顶掉旧会话 | `您的账号已在其他设备登录` |
| 开启多设备登录，会话过期或被吊销（登出/禁用等） | `会话已过期，请重新登录` |
| 用户自助修改密码后，旧会话被吊销 | `密码已修改，请使用新密码重新登录` |
| 密码被管理员重置（单个重置或批量重置） | `密码已被管理员重置，请使用新密码重新登录` |

> 密码修改/重置原因是**一次性**记录：账号重新登录建立新会话时会自动清除，避免此后被顶下线时误报为「密码已修改/重置」。

Token 过期时返回 `401`（`code=TOKEN_EXPIRED`，消息 `登录状态已失效，请重新登录`），前端据此提示重新登录；用户不存在或已禁用时返回 `401`（`code=USER_NOT_FOUND` / `ACCOUNT_DISABLED`，无 `message` 字段）。

### 获取会话有效期政策

`GET /api/auth/session-policy`

无需登录。返回 JWT 有效期配置与格式化后的中文展示文本，供登录页展示「重新登录周期」提示。

响应：

```json
{
  "expiresIn": "3d",
  "displayText": "3 天"
}
```

说明：

- `expiresIn` 为 `JWT_EXPIRES_IN` 环境变量的原始配置值。
- `displayText` 为后端将 `expiresIn`（支持 `d`/`h`/`m`/`s` 单位）格式化后的中文描述，如 `3 天`、`12 小时`；格式无法解析时回退为 `3 天`。
- **该接口同时是前端全局后端心跳的探针**：前端应用启动后由 `frontend/src/services/api.ts` 中的 `startBackendHeartbeat()` 每 5 秒调用一次（页面处于后台标签页时跳过，切回前台立即补一次），用于统一检测后端可达性并广播 `server-unreachable` / `server-online`。选用本接口是因为它不挂鉴权中间件，也不会被操作日志记录（审计中间件只对已登录请求落库），5 秒一次的高频探测不会污染审计数据；`/auth/validate` 会被记录为「验证登录」，不能用作心跳。

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
- 旧密码不正确时返回 `400`（消息 `旧密码不正确`），而非 `401`——避免被前端全局拦截器误判为「会话过期」而强制登出。
- 参数校验失败返回 `400`，`message` 为单条中文提示（如 `请输入当前密码`、`请输入新密码`、`新密码长度不能少于 6 位`）。
- 接口受独立速率限制（按「用户 ID」计数，15 分钟内最多 5 次尝试），超限返回 HTTP `429` 与消息 `密码修改尝试过于频繁，请15分钟后再试`。
- 受系统设置「允许用户自主改密」开关（`allowUserChangePassword`，默认 `false`）控制：开关未开启时任何角色调用本接口均返回 `403` 与消息 `系统已禁用自主修改密码，请联系管理员`。注意：强制改密中间件在 `forcePasswordChange` 期间仅放行本接口与登出接口，因此部署时若使用强制改密流程，应同时开启该开关（或由超管通过 `PUT /api/users/:id` 处理）；`PUT /api/users/:id` 的本人改密不受该开关限制。
- 超级管理员在用户管理中重置密码（单个 `PUT /api/users/:id` 或批量 `POST /api/users/batch-reset-password`）后，账号可直接用新密码登录（不强制改密），但旧会话立即失效，旧会话校验时会收到「密码已被管理员重置」提示；一般管理员修改自己的密码会设置 `forcePasswordChange` 为 `true`，下次登录需修改密码。任何角色通过 `PUT /api/users/:id` 修改**本人**密码时均须提供当前密码（`oldPassword`）。

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

返回当前请求客户端的 IP、解析后的浏览器信息以及当前账号的登录时间，供前端页脚展示本机登录环境与「上次登录」时间使用。

响应：

```json
{
  "ip": "::1",
  "browser": "Chrome",
  "os": "Windows",
  "device": "Desktop",
  "summary": "Chrome / Windows / Desktop",
  "lastLoginAt": "2026-10-18T01:20:00.000Z",
  "previousLoginAt": "2026-10-17T09:05:00.000Z"
}
```

| 字段 | 说明 |
|------|------|
| `ip` | 客户端 IP |
| `browser` / `os` / `device` / `summary` | 简化的浏览器信息（不含版本号） |
| `lastLoginAt` | 本次（最近一次）登录时间，ISO 字符串；从未登录过时为 `null` |
| `previousLoginAt` | 本次登录**之前**那次登录的时间，ISO 字符串；首次登录时为 `null` |

说明：

- `lastLoginAt` / `previousLoginAt` 取自用户记录，由登录接口维护（登录时原 `lastLoginAt` 转存为 `previousLoginAt`）。
- **历史数据兜底**：两个字段都为空（该账号在新增字段后从未重新登录）时，服务端回落到登录日志表 `login_logs`，取该用户最近一次成功登录（`success = 1`）的 `timestamp` 填入 `lastLoginAt`；登录日志也无记录时两个字段均为 `null`。
- 前端展示「上次登录」时优先取 `previousLoginAt`，为空时回退为 `lastLoginAt`（即首次登录展示本次登录时间），格式化到分钟（本地时区）。
- 该接口返回简化的浏览器信息（不含版本号；带版本号的完整解析用于登录日志和操作日志）。接口本身会被操作日志记录，操作类型显示为「查看自身浏览器信息」。

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

- `superadmin` 可更新任意用户的全部字段（用户名 / 密码 / 角色 / 姓名 / 分组 / 禁用状态）。
- `admin` 可更新自己的密码，且可对**他人**执行禁用 / 启用（请求体只能包含 `disabled` 一个字段，夹带其它字段返回 `403`）。

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

- 修改 `password` 会同时吊销该账号已签发的令牌，旧会话立即失效（旧会话下次校验时收到「密码已被管理员重置，请使用新密码重新登录」提示）。
- 自助修改密码（请求目标 `id` 为本人且携带 `password`）必须同时提供 `oldPassword`（当前密码）：未提供返回 `400`（`请输入当前密码`），校验失败返回 `400`（`旧密码不正确`）；该场景另有独立速率限制（按「用户 ID」计数，15 分钟内最多 5 次），超限返回 `429`。`superadmin` 重置**他人**密码无需 `oldPassword`。
- 仅 `superadmin` 修改 `password` 时（重置他人或自己），重置后可直接用新密码登录；普通管理员修改自己密码时会设置 `forcePasswordChange` 为 `true`，下次登录需修改密码。
- 仅 `superadmin` 可修改 `role`；`disabled` 由 `superadmin` 与 `admin` 均可修改（见下条）。
- 禁用/启用账号：`superadmin` 与 `admin` 均可操作，但**只能操作权限低于自己的账号**——`superadmin` 可禁用/启用其他 `superadmin` 以外的所有账号，`admin` 只能操作 `user`（对同级或其他 `admin` 返回 `403` `只能操作权限低于自己的账号`）。超级管理员账号一律不可禁用；不能修改**当前登录账号**的禁用状态（返回 `400`）。一般管理员操作他人时请求体必须只含 `disabled`，否则 `403`。
- `admin` 只能修改自己的密码等个人字段；修改他人账号的角色/密码/用户名一律 `403`。

### 批量删除登录用户

`POST /api/users/batch-delete`

权限：`superadmin` 或 `admin`

规则：

- 需要登录且角色为管理员（`admin` / `superadmin`）。
- 不能删除当前登录账号。
- 不能批量删除超级管理员账号。
- `admin` 只能删除 `user` 账号：选中列表中含任一 `admin` 时整批返回 `403`（`只能操作权限低于自己的账号`）。

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

### 批量禁用 / 启用登录用户

`POST /api/users/batch-disabled`

权限：`superadmin` 或 `admin`

规则：

- 需要登录且角色为管理员（`admin` / `superadmin`）。
- `ids` 不能包含当前登录账号（返回 `400`）。
- `disabled=true` 时不能包含超级管理员账号；`disabled=false`（启用）时超级管理员账号会被跳过。
- `admin` 只能操作 `user` 账号：`ids` 中含任一 `admin` 时整批返回 `403`（`只能操作权限低于自己的账号`）。
- `ids` 中存在无效用户时返回 `400`，需刷新列表后重试；整批一次写库。
- 禁用后该账号的既有 JWT 在下一次请求即被拒绝（鉴权中间件逐次校验 `disabled`），无需额外吊销。
- 已是目标状态的账号会被跳过，`updatedCount` 为实际变更条数。

请求：

```json
{
  "ids": ["user-id-1", "user-id-2"],
  "disabled": true
}
```

响应：

```json
{
  "message": "已禁用 2 个账号",
  "updatedCount": 2
}
```

### 批量重置登录用户密码

`POST /api/users/batch-reset-password`

权限：仅 `superadmin`

规则：

- 需要登录且角色为超级管理员。
- 不能包含当前登录账号（请使用单账号重置 `PUT /api/users/:id`）。
- 不能包含超级管理员账号。
- 单次写库整体生效；`ids` 中存在无效用户时返回 `400`，需刷新列表后重试。
- 重置后每个账号的已签发令牌被吊销，旧会话立即失效；账号可直接用新密码登录（与超级管理员单账号重置行为一致，不强制改密）。
- 新密码仅在本次响应中明文返回一次，落库前已 bcrypt 加密，请立即线下分发给本人。

请求：

```json
{
  "ids": ["user-id-1", "user-id-2"],
  "mode": "manual",
  "password": "unified-password"
}
```

字段说明：

- `mode`：`manual`（手动统一密码，所有选中账号改为同一密码）或 `auto`（服务端为每个账号随机生成 12 位独立密码）。
- `password`：仅 `mode=manual` 时必填，至少 6 位；`mode=auto` 时禁止携带。

响应（`auto` 模式示例）：

```json
{
  "message": "已重置 2 个账号的密码",
  "resetCount": 2,
  "credentials": [
    { "id": "user-id-1", "username": "user001", "name": "普通用户A", "password": "xK9mP2qR7sT4" },
    { "id": "user-id-2", "username": "user002", "name": "普通用户B", "password": "aB3nD6fH8jL1" }
  ]
}
```

### 删除登录用户

`DELETE /api/users/:id`

权限：`superadmin` 或 `admin`

规则：

- 需要登录且角色为管理员（`admin` / `superadmin`）。
- 不能删除当前登录账号。
- 不能删除超级管理员账号。
- `admin` 只能删除 `user` 账号（对 `admin` 目标返回 `403` `只能操作权限低于自己的账号`）。

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

说明：

- `ids` 必须为数组，否则返回 `400 { "message": "输入格式不正确" }`；数组元素按下标写入各设计人员的 `order` 字段（`0` 起），数组中不存在的 id 直接忽略，未出现在数组里的设计人员保持原 `order` 不变。
- 前端目前只有一个调用方：主页面设计人员姓名悬停的「上移 / 下移」按钮（同组内与相邻人员交换位置，跨分组不移动，搜索筛选时只与当前可见的相邻人员交换），每次提交完整的全部人员 id 数组。管理后台已改为表头纯前端排序，不再提交人员顺序。
- 该接口只落库，不广播 Socket 事件；需要让其他客户端看到新顺序时由各自重新拉取数据。
- 接口不再服务于拖拽排序：设计人员拖拽已从主页面与管理后台移除，行顺序只由上述上下移按钮维护。

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

### 获取已使用的焊枪名列表

`GET /api/tasks/used-gun-names`

权限：需登录（任意角色）。

返回所有主任务条目中使用过的焊枪名（去重、去空白）。台账页与主页面「自动获取枪名」结果面板据此把已被主任务使用的枪名显示为天蓝色。

响应：

```json
{
  "gunNames": ["SRTC-2C00001", "SRTC-2C00002"]
}
```

说明：

- 数据来源于全部月份任务条目的 `guns[].name`，跨月份去重。
- 前端在焊枪台账页面加载、Socket 重连、收到 `task_refreshed` 广播及网络恢复时重新拉取，保证天蓝色标识与主任务数据实时一致。
- 拉取失败仅影响天蓝色高亮，不影响台账与主页面本身的功能。

### 枪名搜索（含任务归属）

`GET /api/tasks/gun-name-search`

权限：仅管理员（`admin` / `superadmin`），其他角色返回 403。

供主页面「确认图修改」快捷键（连按两次 `Shift`）使用：按关键字搜索焊枪台账中的枪名，同时回传该枪名当前被放在哪位设计员的哪一天、哪条任务里，前端据此把「确认图修改」默认安排给该枪名所属任务的设计员。

查询参数：

| 参数 | 必填 | 说明 |
|------|------|------|
| `q` | 是 | 枪名关键字（不区分大小写的子串匹配）。缺失或为纯空格返回 400 |
| `limit` | 否 | 返回条数上限，默认 20，最大 50 |
| `allMonths` | 否 | `true` 时搜索所有月份（弹窗右上角「全表搜索」开启）；默认关闭，只搜 `year`/`month` 指定月份 |
| `year` | 否 | 限定搜索范围的年份，默认服务器当前年（`allMonths=true` 时忽略） |
| `month` | 否 | 限定搜索范围的月份 1-12，默认服务器当前月（`allMonths=true` 时忽略） |

范围限定时（`allMonths` 不为 `true`），只有该月任务里出现过、或在该月有任务归属的枪名才会命中；台账里存在但当月没有任何任务的枪名不返回，避免历史枪名淹没有效结果。

响应：

```json
{
  "results": [
    {
      "gunName": "SRTC-2C15005",
      "customer": "58073>O/IND_SKH-M-JSW-JMV60-T183-JMJ16-260904-04",
      "category": "X2C",
      "tableName": "SRTC",
      "owners": [
        {
          "itemId": "item-17924806202199asxdyp",
          "designerId": "1782891992263",
          "designerName": "侯桂英",
          "date": "2026-10-20",
          "year": 2026,
          "month": 10,
          "taskName": "58073>... 确认图",
          "gunHours": 1.5
        }
      ]
    }
  ]
}
```

说明：

- `customer` / `category` / `tableName` 取自焊枪台账首次出现该枪名的行与表；台账里没有的枪名（只在任务里手工录入过）也能被关键字命中，此时三项为空串。
- `owners` 为该枪名的任务归属，每个枪名最多返回 10 条；排序规则为「确认图任务优先 → 任务日期倒序」，前端取 `owners[0].designerId` 作为「确认图修改」的默认设计人员，并在结果行里把该枪名的所有归属（设计员 + 日期，悬停可见任务名与工时）都列出来。`owners` 为空的枪名表示尚未被安排到任何任务。
- 结果排序（依次比较）：前缀匹配优先 → 已有任务归属的枪名在前 → 名称更短的在前 → 字典序。已有归属优先是因为该快捷操作的目的就是先找到枪名所属设计员。
- 不支持空查询：接口不再返回「最近安排过的枪名」候选，`q` 缺失或为纯空格时返回 `400 { "message": "请输入枪名关键字" }`；前端在搜索框为空时也不会发起请求。

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
          "urgent": false,
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
  "urgent": false,
  "fontSize": "",
  "textColor": ""
}
```

规则：

- 枪名存在时，该枪名工时必须大于 0；**「暂停/取消」任务例外**——任务名含该后缀或显式传 `paused: true` 时，枪名工时允许为 0（不能为负数），校验规则见下方 `paused` 说明。
- `urgent` 为任务加急标记（布尔，默认 `false`）。只有**任务名含「确认图 / 设计 / 确认图修改」后缀**时加急才生效（加急后底色取 `urgent*` 配色、整行文字变红）；「设计变更 / 既制审图 / 暂停取消」没有加急状态，传 `true` 也会被忽略；没有任务内容时同样忽略，底色按「未勾选任务内容」派生。
- `paused` 为「暂停/取消」标记（布尔，默认 `false`，**与五个任务内容并列的独立状态**）：为 `true` 时整行使用 `taskColorConfig.paused`（默认纯红 `#ff0000`）+ 黑字；工时沿用切换前任务内容的工时（新增时默认 0），允许为 0（枪名工时同样允许为 0），也不影响后续手动修改；工时不为 0 时与普通任务一样计入日报/工时管理/排行榜等统计与导出。不参与加急配色。服务端在写入 `taskName` 时会按「任务名是否含 `暂停/取消` 后缀」自动同步该标记，因此任务名后缀是最终依据；历史只带 `paused: true` 的条目仍按暂停处理。
- **`color` 仅作兼容入参保留**：服务端落库前会用配色体系重新派生（`deriveItemColor`），即底色由「任务名中的任务内容后缀 + `urgent`」决定，客户端传入的 `color` 会被覆盖。两个例外：① 白色（`#ffffff`，表示已完成）原样保留；② `leaveType` 非空（请假/出差）的条目不参与派生，`color` 原样落库（留空时由前端渲染与导出按请假类型取固定底色，见下文）。
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

说明：

- 请求体经 Joi 白名单校验（`stripUnknown`）：`designerId` 必填；`date` 必填且为 ISO 日期；`items` 必填且至少 1 条，未知字段会被丢弃。
- 每条条目仅接受以下字段：`taskName`（字符串，默认空）、`hours`（数值 ≥ 0，默认 0）、`color`（标记颜色，同样会被配色体系派生覆盖）、`guns`（枪名数组，结构同创建任务接口）、`leaveType`（`sick`/`vacation`/`illness`/`trip` 或 `null`）、`urgent`（布尔，默认 `false`，任务加急）、`paused`（布尔，默认 `false`，「暂停/取消」，任务名含该后缀时也会自动置为 `true`）、`fontSize`、`textColor`；条目 `id` 由服务端重新生成，忽略客户端传入值。
- 每条条目的最终底色同样由「任务内容后缀 + `urgent`」派生（白色与请假/出差底色例外），与 `POST /api/tasks/item` 完全一致。
- 校验失败返回 `400`（`message=输入格式不正确`，附 `details`）；枪名存在但工时为 0 时返回 `400`——**「暂停/取消」条目例外**（`paused: true` 或任务名含该后缀），其枪名工时允许为 0，只拒绝负数。
- 普通用户调用返回 `403`（`只有管理员可以编辑表格`）。
- 焊枪台账「任务分配模式」通过本接口批量创建确认图任务：按客户分组（空客户归入「未命名」），每组生成一条 `taskName` 为 `<客户> 确认图` 的任务，组内每个焊枪名作为任务的枪名行；枪名工时由前端按默认工时规则解析后随请求提交，优先级为「枪名所在台账表的表级专用规则（`tableGunHours`，超管覆盖 → 内置）→ 枪名机型 C/X 的 `defaultGunHours.confirm` → 固定兜底 2h」，任务工时为枪名工时之和。

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
- `color`（主任务颜色，写入值原样生效、不参与配色派生；前端的任务编辑弹窗已不再提供调色板，只剩完成/未完成标记入口）
- `guns`（整体替换枪名数组）
- `gunColor`（标记单个枪名颜色，需配合 `gunIndex` 指定枪名下标）
- `leaveType`（合法值：`sick` 事假、`vacation` 休假、`illness` 病假、`trip` 出差、`null`）
- `urgent`（布尔，任务加急；仅确认图 / 设计 / 确认图修改生效，切换后按「任务内容后缀 + 加急状态」重新派生整行底色）
- `paused`（布尔，「暂停/取消」；为 `true` 时整行使用 `paused` 配色（纯红）黑字，**只切换标记、不改动工时**——工时沿用切换前的值（0 也能保存，不为 0 时计入统计），切换后重新派生底色。传 `taskName` 时该标记会按任务名后缀自动同步）
- `fontSize`、`textColor`：**仅通过 Joi 白名单校验，处理器没有对应分支**，传这两个值会落入 `else` 兜底，把 `taskName` 覆盖成 `value`（例如 `{"field":"fontSize","value":"14px"}` 会把任务名改成 `14px`）。这两个字段只在**创建**任务（`POST /api/tasks/item`）时有效，更新任务请勿使用。

底色自动派生规则（`taskName` / `urgent` / `leaveType` 三个字段）：

- 传 `taskName` 时，服务端按任务名中的任务内容后缀重新派生底色——后缀变化（如「确认图」改成「设计变更」）会直接换色。
- 传 `urgent` 时，加急状态变化即改变整行配色，同时把派生值写回库里的 `color`，保证导出与旧版消费方一致。
- 传 `leaveType` 且值为 `null`（由请假切回设计计划）时，按当前任务内容重新上色。请假/出差条目本身不参与配色派生，`color` 原样保留（前端留空时按类型渲染固定底色：事假 `#fee2e2`、休假 `#dbeafe`、病假 `#fce7f3`、出差 `#5eead4`，导出使用同一套色值）。

更新 `guns` 时同样校验：枪名存在时工时必须大于 0（**「暂停/取消」任务允许为 0，只拒绝负数**，服务端按 `isTaskPaused(item)` 判定）、同一任务内枪名不可重复（校验不通过返回 `400`，`message` 为中文原因说明）。

- **所有任务内容的修改（包括枪名的编辑、复制、删除）都会自动更新 `updatedAt` 和 `updatedBy` 字段。**
- 枪名对象除 `id`、`name`、`hours` 外，还包含颜色标记字段：`color`（当前颜色）、`colorBeforeUserMark`（标记前的原始颜色）、`colorMarkedBy`（标记人 `{ id, username, name }`）。

颜色标记规则（`field` 为 `color` 或 `gunColor`）：

- 前端任务编辑弹窗**不再提供调色板**：表格底色由「任务内容 + 是否加急」派生，文字色固定（普通黑色 `#000000`、加急确认图/设计/确认图修改红色 `#dc2626`），弹窗内只保留「任务完成 / 未完成」的状态标记入口；管理员仍可直接调用本接口写入任意颜色值（页面渲染时白色之外的派生色以任务内容为准，导出同样按派生色）。白色标记/恢复操作管理员与授权普通用户均可执行。
- 普通用户需满足：系统开启 `allowUserDesignPlanColorMark`（或旧开关 `allowUserEditOwnTaskColor`）、任务非请假条、且本人姓名与该设计人员姓名一致；普通用户只允许白色标记（`#ffffff`/`#fff`/`white`）或恢复（`value` 传 `__restore__`），否则返回 `403`。
- 标记白色时，系统会保存原始颜色到 `colorBeforeUserMark`，并记录标记人信息到 `colorMarkedBy`；恢复时还原原始颜色并删除这两个字段。
- **恢复时若没有 `colorBeforeUserMark` 记录**（例如从已完成任务复制而来的白条目），不再随机取色：主任务按「任务内容 + 加急」派生标准底色（`deriveItemColor`），枪名清空颜色、跟随主任务行的派生底色。
- 联动规则：主任务标记白色时，其下所有枪名联动标记为白色（枪名 `colorMarkedBy` 为 `{ id: 'auto', name: '系统联动' }`）；所有枪名都为白色时，主任务自动标记白色（`colorMarkedBy` 为 `{ id: 'auto', name: '系统自动' }`）；任一枪名恢复非白色时，主任务联动恢复原始颜色。
- **主任务直接改色会把整条任务重置为「未完成」**：管理员把主任务设为任意非白颜色（`field=color`、`value` 非白色且非 `__restore__`）时，除写入主任务 `color` 外，其下**所有枪名**的 `color` 一并改为同一颜色，并删除各自的 `colorBeforeUserMark` 与 `colorMarkedBy`——原先已标白的枪名同样被染成新色，避免出现「主任务有色、子枪名仍是完成态」的矛盾行（主任务重新上色即代表任务重新开始）。用 `field=gunColor` 单独给某个枪名改色、或白色标记/恢复，都不触发这条级联规则。前端在请求发出前已按同一规则本地同步枪名颜色，接口返回后再以服务端结果为准。
- **枪名结构变更后同样重算主任务颜色**：除颜色标记外，`field` 为 `guns`（整体替换枪名）、以及 `POST /api/tasks/move-gun` 的移出/移入枪名，都会按同一规则重新同步主任务颜色——枪名全部为白色则主任务自动标白（原色存入 `colorBeforeUserMark`），只要存在非白枪名且主任务为白色则恢复原色，因此「删到只剩白色枪名」后主任务会自动变为完成态。
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
3. 保存成功后发出 `task_updated` Socket 事件通知其他客户端：单条变更会带上「设计人员 + 当前年月」坐标走增量广播，其他客户端只合并该工时表；批量或无明确范围的变更发空事件，触发全量刷新。
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

说明：

- 源与目标为同一设计人员同一天时，该接口也用于主任务在单元格内的上移 / 下移排序（前端主任务悬浮工具栏的「上移」「下移」按钮，`newIndex` 传相邻任务的下标）。
- 移动后前端会发出 `task_updated` Socket 事件，其他客户端收到 `task_refreshed` 后刷新数据。

### 跨主任务移动单个枪名

`POST /api/tasks/move-gun`

权限：`admin`、`superadmin`（路由仅要求登录，角色在处理逻辑内校验，普通用户返回 `403` 和 `只有管理员可以移动枪名`）。

将一个枪名行从源主任务移动到目标主任务，支持跨设计人员、跨日期移动；源与目标为同一主任务时即为枪名在任务内重排，该场景仅由前端枪名行的「上移」「下移」箭头调用（枪名拖拽已限制为跨主任务移动，落在源主任务上时前端直接拦截）。

落点单元格没有任何主任务时，`targetItemId` 传空串并携带 `createTaskName`（前端传入源主任务名称），服务端先在该单元格按此名称新建一个主任务（工时 0、无枪名），再把枪名移入其中；新建主任务的完成状态与被移动的枪名一致（详见下方规则）。已有主任务的单元格同样可以落点新建：前端拖到该格最下方的加号上松手即走同一新建流程，新主任务追加到该格末尾（`targetItemId` 仍传空串）。

请求：

```json
{
  "sourceDesignerId": "designer-1",
  "sourceDate": "2026-07-01",
  "sourceItemId": "task-1",
  "gunId": "gun-1",
  "targetDesignerId": "designer-2",
  "targetDate": "2026-07-02",
  "targetItemId": "task-9",
  "newIndex": 0
}
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `sourceDesignerId` / `sourceDate` / `sourceItemId` | 是 | 源主任务定位（日期 ISO 格式 `YYYY-MM-DD`） |
| `gunId` | 是 | 要移动的枪名行 ID |
| `targetDesignerId` / `targetDate` | 是 | 目标单元格定位 |
| `targetItemId` | 是 | 目标主任务 ID；传空串表示落点单元格没有主任务，需同时传 `createTaskName` |
| `createTaskName` | 否 | `targetItemId` 为空时新建主任务的名称（前端取源主任务的 `taskName`） |
| `allowEmptyTarget` | 否 | 仅前端撤销流程使用：允许把枪名移入一个当前没有枪名的目标主任务（撤销时源主任务可能已被删除并按快照重建，此时还没有枪名） |
| `newIndex` | 否 | 插入到目标主任务枪名数组的下标；不传时追加到末尾 |

规则：

- 请求体经 Joi 白名单校验（`stripUnknown`），校验失败返回 `400`（`message=输入格式不正确`，附 `details`）。
- 源主任务不存在返回 `404`（`源主任务不存在`）；枪名在源任务中不存在返回 `404` 和 `枪名不存在`；`targetItemId` 非空但目标主任务不存在返回 `404` 和 `目标主任务不存在`；`targetItemId` 为空且未传 `createTaskName` 同样返回 `404`。
- 目标主任务为请假 / 出差类任务（`leaveType` 非空）时返回 `400` 和 `不能移动到请假/出差类任务`。
- **目标主任务没有任何枪名时，返回 `400` 和 `目标主任务没有枪名，不能移入枪名`**：这类行只有主任务自身的内容（名称 / 工时），塞入枪名会让主任务工时被枪名工时取代而丢失原意。两个例外：① 本次请求按 `createTaskName` 新建的目标主任务（正是靠这次移动塞入第一个枪名）；② 显式传 `allowEmptyTarget=true`（仅撤销流程使用）。
- 目标主任务已存在同名枪名时返回 `400`（`目标主任务已存在枪名「xxx」，无法移动`）；同一主任务内重排时排除枪名自身。
- 枪名移走后源主任务没有任何枪名时，该源主任务会被一并删除（响应 `sourceItemDeleted=true`），前端撤销时据此快照重建。
- 源与目标的主任务 `updatedAt` / `updatedBy` 均会更新；操作成功后由前端发出 `task_updated` 通知其他客户端刷新。
- 枪名移入/移出后会按枪名状态重算源、目标主任务的颜色标记（规则同 `PUT /api/tasks/item` 的 `guns` 联动：全白枪名 → 主任务自动标白，存在非白枪名 → 主任务恢复原色）。
- 新建主任务的完成状态（颜色标记）跟随被移动的枪名：枪名为白色（完成）→ 新主任务同样标白（`colorMarkedBy` 为 `{ id: 'auto', name: '系统自动' }`），并优先把源主任务的原色写入 `colorBeforeUserMark` 以便后续「未完成」恢复；枪名带其他颜色 → 新主任务沿用同一颜色；枪名未完成但**没有颜色**（`color` 为空）→ 新主任务取源主任务颜色，源主任务同样是白色/无色时按 `createTaskName` 派生底色（`deriveItemColor`，如「XX 确认图」→ 确认图配色），并把该枪名一并染成该颜色（白色在系统中表示「已完成」，未完成的枪名不能落到白底上，否则主任务与枪名看起来都像已完成）。

响应：

```json
{
  "message": "枪名已移动",
  "sourceItemDeleted": false,
  "targetItemId": "task-9",
  "targetItemCreated": false,
  "sourceSheet": { ... },
  "targetSheet": { ... }
}
```

- `targetItemCreated=true` 表示目标主任务是本次请求新建的，`targetItemId` 为其新 ID，`message` 为 `已按源主任务名称新建主任务，枪名已移入`；前端据此记录历史——撤销把枪名移回后该新建主任务会因无枪名被自动删除，重做时按 `createTaskName` 重新新建。

> 主页面交互：管理员可直接拖拽枪名行右侧拖动手柄，移动到任意设计人员、任意日期的任意主任务——落在某条枪名上则插入到该枪名之前，否则追加到目标主任务末尾；落在**没有任何主任务的空白单元格**上，会整格高亮并在松手时把源主任务名称复制过去新建主任务，再把该枪名移入；落在**已有主任务的单元格最下方的加号**上，加号变绿并提示「松手在下方新建主任务」，松手后在该格末尾新建同名主任务承接该枪名（新主任务的完成状态与枪名一致），格内其他位置松手仍提示「没有主任务」并不做改动；同一主任务内的顺序调整请使用枪名行的「上移」「下移」箭头。该操作支持 `Ctrl+Z` 撤销 / `Ctrl+Y` 重做。
>
> 拖拽过程中的视觉反馈：
>
> - 指针扫过的目标主任务整体描边变色作为「预选中」提示：可放置为绿色，目标已存在同名枪名为红色。
> - 目标主任务没有任何枪名时同样描边为红色，浮层显示红色「目标无枪名，不能移入」，松手不会移动。
> - 目标重名时，拖拽浮层正上方显示红色「重复枪名」提示，光标变为 `not-allowed`，松手不会移动。
> - 指针扫过**源主任务自身**时不做任何描边高亮，浮层边框转灰并显示「同任务内请用箭头」，光标为 `not-allowed`；松手时前端拦截并提示改用上移/下移箭头，不会发起本接口请求。

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
        { "field": "taskName", "label": "任务名", "text": "设计计划 12345", "count": 1 },
        { "field": "gunName", "label": "枪名1", "text": "SRTC-2C00001", "count": 2 }
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
- `fields[].field` 为 `gunName` 时，`label` 格式为 `枪名N`（N 为枪名在条目内的序号，从 1 开始）。
- 每条匹配包含 `designerId`、`date`、`itemId`，前端「批量操作」模态框据此实现点击查找结果定位到底部表格中的目标任务。
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
- 焊枪台账（`/settings/gun-ledger`）和设计规范知识库（`/settings/design-standards`）权限配置同样遵循上述规则；其中 `gunLedger.allowViewers=true` 仅放行普通用户只读访问焊枪台账（GET 接口），所有写接口（分类/表/行增删改、规则配置、初始化、导入）仍要求 `admin`/`superadmin`，焊枪台账相关 Socket 锁事件同样仅管理员可用。

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

- 用于控制一般管理员/普通用户是否可以访问焊枪台账页面（`/gun-ledger`）。
- `allowViewers=true` 时普通用户可只读浏览（仅 GET 接口放行），不能执行任何写操作；`allowViewers=true` 时后端同样强制 `allowAdmins=true`。

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
- 工作日工时、周末加班工时、主页面底部周末加班统计、工时管理统计和工时管理表导出均使用该规则。
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
  { "leader": "张明", "members": ["吴露鹭", "茅舒", "沈雨帆", "张晟隽", "梁科研", "吴方盛", "许华俊"] },
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

### 获取工厂规则

`GET /api/settings/factory-rules`

访问控制：需要有效 JWT（登录后访问）。

工厂规则将营业担当人员映射到对应工厂（合法工厂值：`O/NJG`、`O/SHA`），状态追踪页面添加/编辑记录时按营业担当自动匹配 `factory` 字段，未命中任何规则时使用默认工厂。

响应示例：

```json
{
  "defaultFactory": "O/NJG",
  "rules": [
    { "factory": "O/SHA", "members": ["吴露鹭", "茅舒", "沈雨帆", "梁科研", "张晟隽", "许华俊"] }
  ]
}
```

字段说明：

| 字段 | 说明 |
|------|------|
| `defaultFactory` | 默认工厂，营业担当未命中任何规则时使用，合法值 `O/NJG`、`O/SHA` |
| `rules` | 工厂规则数组（工厂 → 营业担当成员列表映射），存储在 `settings.factoryRules` |
| `rules[].factory` | 工厂名称，合法值 `O/NJG`、`O/SHA` |
| `rules[].members` | 该工厂对应的营业担当人员列表 |

### 更新工厂规则

`PUT /api/settings/factory-rules`

权限：`admin`、`superadmin`

请求体结构同 `GET /api/settings/factory-rules` 响应，`defaultFactory` 与 `rules` 均为必填（Joi 校验，未知字段丢弃）：

```json
{
  "defaultFactory": "O/NJG",
  "rules": [
    { "factory": "O/SHA", "members": ["吴露鹭", "茅舒"] }
  ]
}
```

### 重置工厂规则

`POST /api/settings/factory-rules/reset`

权限：仅 `superadmin`

说明：将工厂规则重置为系统默认值（默认工厂 `O/NJG`；规则 `O/SHA → 吴露鹭、茅舒、沈雨帆、梁科研、张晟隽、许华俊`）。

响应：返回默认工厂规则对象，结构同 `GET /api/settings/factory-rules`。

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
| `factory` | 工厂（`O/NJG`、`O/SHA`；前端按营业担当自动匹配工厂规则填充） |
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
| `designDeliveryDays` | 设计纳期天数（纳期距今天数，小于 1 天时导出为空）。该字段**会随记录一起落库**，但每次创建/更新以及每次读取都由服务端按 `deliveryDate` 重新计算后覆盖，客户端提交的值会被剥离忽略 |
| `salesPerson` | 营业担当 |
| `leader` | 组长（前端按营业担当自动匹配组长规则填充） |
| `createdAt` | 创建时间，ISO 格式 |
| `updatedAt` | 更新时间，ISO 格式 |

> 说明：未知字段会被 Joi 校验丢弃；`designDeliveryDays` 每次读取时根据 `deliveryDate` 实时计算。

### 创建状态追踪记录

`POST /api/status-tracking/items`

权限：`admin`、`superadmin`，且需通过状态追踪页面的权限配置校验（页面关闭「一般管理员」时一般管理员请求返回 `403`）。

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

权限：`admin`、`superadmin`，且需通过状态追踪页面的权限配置校验。

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

权限：`admin`、`superadmin`，且需通过状态追踪页面的权限配置校验。

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

权限：`admin`、`superadmin`，且需通过状态追踪页面的权限配置校验。

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

权限：`admin`、`superadmin`，且需通过状态追踪页面的权限配置校验。

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

清空全部状态跟踪数据：

```json
{
  "all": true
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `beforeYear` | 条件必填 | 清理截止年份；`all` 不为 `true` 时必填 |
| `beforeMonth` | 条件必填 | 清理截止月份（1-12）；`all` 不为 `true` 时必填 |
| `mode` | 否 | 清理模式：`delivery` 表示按纳期月份清理；缺省（或其他值）表示按添加时间月清理 |
| `all` | 否 | 传 `true` 时**清空全部状态跟踪记录**，不分月份、忽略 `mode` 与时间点；优先级最高 |

清理规则：

- `all=true`：直接清空 `statusTrackingItems`，不按月份过滤。
- `mode=delivery`：删除纳期早于 `beforeYear-beforeMonth` 的记录；无纳期的记录保留。
- 默认模式：删除最早添加时间月（取 `productionPlanMonths` 排序后的第一个月，缺省退回 `productionPlanMonth`/纳期月份）早于指定时间点的记录；无添加时间月的记录保留。

响应：

```json
{
  "message": "状态跟踪数据清理完成",
  "scope": "2026-07 之前",
  "removedCount": 50,
  "remainingCount": 100
}
```

| 字段 | 说明 |
|------|------|
| `scope` | 实际清理范围：`YYYY-MM 之前` 或 `全部` |
| `removedCount` / `remainingCount` | 删除条数 / 剩余条数 |

说明：

- `all` 不为 `true` 且缺少 `beforeMonth` 或 `beforeYear` 时返回 `400`（`请指定清理时间点，或选择清空全部状态跟踪数据`）。
- `all=true` 时响应 `message` 为 `状态跟踪数据已清空`。
- 清理成功后通过 Socket.IO 广播 `status_tracking_bulk` 事件，包含剩余记录列表；前端还需一并清除本地 `statusTrackingItems` 缓存，避免离线时把已删除记录渲染出来。

### Socket.IO 状态追踪事件

客户端事件：

| 事件 | 说明 | 参数 | 权限与限流 |
|------|------|------|------------|
| `status_tracking_start_edit` | 通知开始编辑状态追踪记录 | `{ itemId }`（`userId`/`username`/`name` 由服务端会话注入，客户端传入的值被忽略；缺少 `itemId` 时回发 `error: Missing itemId`） | 仅 `admin`/`superadmin`（否则 `error: Insufficient permissions`）；需通过 `statusTracking` 页面权限校验（否则 `error: 无权访问`）；每个连接 10 秒最多 30 次（超限 `error: 操作过于频繁，请稍后再试`） |
| `status_tracking_stop_edit` | 通知停止编辑状态追踪记录 | `{ itemId }` | 需已认证；只释放**本连接自己持有**的该行锁，不能替其他连接上的他人解锁 |

行锁仲裁规则（服务端维护，键为 `itemId`）：

- **互斥**：该行已被其他连接占用时，`status_tracking_start_edit` 不覆盖他人锁，改为向发起方单独回发 `status_tracking_edit_blocked`（载荷为占用会话 `{ itemId, userId, username, name, socketId }`）。
- **单行锁**：同一连接只持有一行锁，改锁别的行时自动释放旧行并广播 `status_tracking_edit_stop`。
- **断线清理**：连接断开时释放该连接持有的全部行锁，避免行永远显示为「他人正在编辑」。

服务端事件：

| 事件 | 说明 | 参数 |
|------|------|------|
| `status_tracking_edit_start` | 某用户开始编辑指定记录 | `{ itemId, userId, username, name, socketId }` |
| `status_tracking_edit_stop` | 某用户停止编辑指定记录 | `{ itemId, userId }` |
| `status_tracking_edit_blocked` | 行锁申请被他人占用拒绝 | 占用会话 `{ itemId, userId, username, name, socketId }` |
| `status_tracking_editing_state` | 连接建立时下发一次的行锁快照 | 会话数组 `[{ itemId, userId, username, name, socketId }]` |
| `status_tracking_updated` | 状态追踪记录更新 | `{ action, item, itemId }` |
| `status_tracking_bulk` | 状态追踪批量更新 | `[所有记录列表]` |

## 焊枪台账接口

焊枪台账（`/gun-ledger`）采用**分类 → 表 → 行**三级结构。所有接口都受 `accessSettingsMiddleware('gunLedger')` 控制：需先满足 `settings.gunLedger` 权限配置，再满足各接口的角色要求。默认分类为 `X2C`、`X2C-V2`、`X2C-V3`、`GLOBAL`、`PSW`、`IT`、`ROBOT`、`EQ`、`TOYOTA`。

### 数据结构

顶层 `gunLedger` 对象：

```json
{
  "categories": {
    "X2C": [ { "id": "gun-tbl-xxx", "name": "SRTC", "rows": [...], "gunNameRule": {...} } ],
    "X2C-V2": [ ... ],
    "X2C-V3": [ ... ],
    "GLOBAL": [ ... ],
    "PSW": [ ... ],
    "IT": [ ... ],
    "ROBOT": [ ... ],
    "EQ": [ ... ],
    "TOYOTA": [ ... ]
  },
  "defaultResponsiblePersons": ["张啸", "张明", "陈青松", "陈大仪", "翟世学", "朱海洋"]
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

### 获取枪名位置索引

`GET /api/gun-ledger/gun-name-locations`

权限：需要登录，并取决于 `settings.gunLedger` 权限配置。

返回轻量的枪名 → 所在分类/表 索引。仅统计真实行（不含前端占位预留行）；同名枪名以分类/表顺序首次出现位置为准。供主页面在新增任务/台账任务分配时按枪名**所在台账表**匹配表级专用默认工时（优先级最高），无表级配置时再回退到 C/X 机型识别和固定兜底值。

响应：

```json
{
  "locations": {
    "SRTC-2C00001": { "category": "X2C", "tableName": "SRTC" },
    "SRTC-2C00002": { "category": "X2C", "tableName": "SRTC" },
    "SRTC-X00001": { "category": "X2C", "tableName": "SRTCX" }
  }
}
```

| 字段 | 说明 |
|------|------|
| `locations` | 枪名作为键，值为 `{ category, tableName }`；`category` 为分类名，`tableName` 为表名 |

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

响应：单个 `.xls` 文件，文件名 `gun-ledger-all-<时间戳>.xls`，每个分类一个工作表（跨分类重名时使用「分类-表名」形式）。无数据时返回 `404` 和 `没有可导出的数据`（注意与维护接口 `POST /api/system/maintenance/export-gun-ledger` 的提示文案不同，后者打包为 `.zip`）。

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

说明：默认分类 `X2C`、`X2C-V2`、`X2C-V3`、`GLOBAL`、`PSW`、`IT`、`ROBOT`、`EQ`、`TOYOTA` 不允许删除。删除会连同其下所有表一并删除，并释放所有表的编辑锁。

### 分类排序

`PATCH /api/gun-ledger/categories/order`

权限：`admin`、`superadmin`。

请求：

```json
{ "order": ["X2C", "X2C-V2", "X2C-V3", "自定义分类"] }
```

说明：`order` 必须与现有分类集合完全一致（防止越权增删）。

### 恢复分类默认排序

`POST /api/gun-ledger/categories/order/default`

权限：仅 `superadmin`。

说明：将分类顺序恢复为系统默认顺序（默认分类在前，自定义分类保持当前相对顺序排在后面）。响应返回 `{ "order": [...] }`，并广播 `gun_ledger_updated`（`action: reorder_categories`）。

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

### 恢复表格默认排序

`POST /api/gun-ledger/tables/order/default`

权限：仅 `superadmin`。

请求：

```json
{ "category": "X2C" }
```

说明：将指定默认分类下的表格恢复为系统内置表名顺序（自定义表格保持当前相对顺序排在默认表之后）。自定义分类无默认表格顺序，返回 400。响应返回 `{ "category": "...", "order": [...] }`，并广播 `gun_ledger_updated`（`action: reorder_tables`）。

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
- **焊枪名唯一性校验**：同表内不允许重复焊枪名（空值不计），存在重复时返回 `409`，响应体含 `message`（列出重复项详情，如 `焊枪名不可重复：「xxx」（序号 1、3）`）和 `duplicates` 数组。
- **焊枪名编号校验**：表有生效焊枪名规则（`gunNameRule` 启用）时，非空焊枪名的编号必须与规则计算值一致，手动修改编号会被拒绝，返回 `400` 和 `焊枪名编号不可修改：序号 N（编号应为 15015，可在编号后追加后缀）`；焊枪名前缀可自由编辑，编号之后也可继续追加任意后缀（`SRTC-2C15015L`、`SRTC-2C15015-EL`、`SRTC-2C15015L-WL` 等），校验时按编号位置归一化后逐字比对整串。
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

响应：字符串数组，如 `["张啸", "张明", "陈青松", "陈大仪", "翟世学", "朱海洋"]`。

### 修改默认担当人员

`PUT /api/gun-ledger/default-persons`

权限：仅 `superadmin`。

请求：字符串数组，如 `["张啸", "张明", "陈青松", "陈大仪", "翟世学", "朱海洋"]`。

### 重置默认担当人员

`POST /api/gun-ledger/default-persons/reset`

权限：仅 `superadmin`。

说明：重置为系统默认值 `["张啸", "张明", "陈青松", "陈大仪", "翟世学", "朱海洋"]`。

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

权限：任意**已登录**用户（含 `user` 角色）均可读取全部系统设置，不限超级管理员。

响应：

```json
{
  "allowMultiDevice": true,
  "allowUserDesignPlanColorMark": true,
  "allowUserEditOwnTaskColor": true,
  "allowUserChangePassword": false,
  "specNumberDigits": 5,
  "auditLogMaxRows": 5000,
  "taskColorConfig": {
    "default": "#d8b4fe",
    "confirm": "#bbf7d0",
    "design": "#fef9c3",
    "confirmModify": "#bae6fd",
    "designChange": "#fdba74",
    "drawingReview": "#fbcfe8",
    "paused": "#ff0000",
    "urgentConfirm": "#ffff00",
    "urgentDesign": "#ffff00",
    "urgentConfirmModify": "#ffff00"
  },
  "defaultGunHours": {
    "confirm": { "C": 1.5, "X": 2 },
    "design": { "C": 2.5, "X": 3 },
    "confirmModify": { "C": 0.5, "X": 0.75 }
  },
  "tableGunHours": {
    "X2C": {
      "SRTC": { "confirm": 1.5, "confirmModify": 0.5, "design": 2.5 },
      "SRTX": { "confirm": 2, "confirmModify": 0.75, "design": 3 }
    },
    "TOYOTA": {
      "C01": { "confirm": 1, "confirmModify": 1, "design": 2 }
    }
  }
}
```

说明：

- 所有页面和接口均需登录，不提供未登录查看。
- `allowUserDesignPlanColorMark` / `allowUserEditOwnTaskColor` 为兼容字段，含义相同。
- 缺失这两个字段时，系统默认允许登录用户修改本人设计计划完成状态。
- `allowUserChangePassword` 为「允许用户自主改密」开关，缺失时默认 `false`：关闭时 `POST /api/auth/change-password` 返回 `403`（`系统已禁用自主修改密码，请联系管理员`）；该开关不影响超管经 `PUT /api/users/:id` 重置密码。
- `specNumberDigits` 为仕样号位数配置，取值 `5` 或 `6`，缺失时默认为 `5`，影响仕样号搜索、纳期提取和状态追踪等所有仕样号输入与校验。
- `auditLogMaxRows` 为操作日志保留条数，取值 `100` ~ `100000` 的整数，缺失或非法时默认为 `5000`；操作日志条数超过该值时自动清理最旧的记录。由「系统设置 → 日志管理」维护。
- `taskColorConfig` 为「任务内容配色」体系，10 个键各自对应一个**底色 hex**（`#rgb` 或 `#rrggbb`），文字色固定、不可配置。常规底色：`default`（未勾选任务内容，`#d8b4fe`）、`confirm`（确认图，`#bbf7d0`）、`design`（设计，`#fef9c3`）、`confirmModify`（确认图修改，浅蓝 `#bae6fd`）、`designChange`（设计变更，`#fdba74`）、`drawingReview`（既制审图，粉 `#fbcfe8`）、`paused`（暂停/取消，纯红 `#ff0000`）；加急底色只有三个（仅确认图 / 设计 / 确认图修改有加急状态）：`urgentConfirm`（`#ffff00`）、`urgentDesign`（`#ffff00`）、`urgentConfirmModify`（`#ffff00`）。「设计变更 / 既制审图 / 暂停取消」没有加急状态，已下线的 `urgentDesignChange` / `urgentDrawingReview` 会被 `stripUnknown` 过滤。缺失或非法色值逐项回退默认值；历史 `{ bg, text }` 结构在读取时只取 `bg`。该字段取代了已下线的 `randomDesignPlanColor` / `randomAssignmentColor` 两个开关（服务端在归一化时显式删除历史残留，GET 不再返回）。
- 「任务内容配色」保存后立即生效：`PUT /settings` 会与库中现有设置**合并**（只覆盖请求体里带的字段），不会把未提交的设置项打回默认值；前端在进入主页面、窗口重新获得焦点（含在其他标签页保存后切回）时都会重新拉取设置，因此主页面新增 / 重新编辑任务时即刻使用最新配色。
- `randomDesignPlanColor` / `randomAssignmentColor` 为**已下线字段**：任务底色不再随机，统一由 `taskColorConfig` + 任务内容 + 加急状态派生，两个开关已从后端 schema 与返回值中移除，传入也会被 `stripUnknown` 过滤。
- `defaultGunHours` 为按机型的默认工时回退规则：`confirm`（确认工时）、`design`（设计工时）、`confirmModify`（确认修改工时）三类，每类含 C/X 两种机型（数值 0-24）；字段缺失时按内置默认值补齐。
- `tableGunHours` 为按焊枪编号台账表配置的专用工时，结构为 `{ 分类名: { 表名: { confirm, confirmModify, design } } }`（分类名 1-30 字符、表名 1-50 字符、工时数值 0-24，三类工时必须同时存在）；响应中以内置表规则为底，合并超级管理员的覆盖配置与用户自建表配置。前端解析枪名工时的优先级为「枪名所在表的专用规则（超管覆盖 → 内置）→ 枪名机型（首个「-」前一字符）C/X 的 `defaultGunHours` → 固定兜底（confirm 2 / confirmModify 0.75 / design 3）」。该字段由焊枪台账页面「默认工时规则」面板维护，随本接口保存。

### 更新系统设置

`PUT /api/system/settings`

权限：仅 `superadmin`

请求：

```json
{
  "allowMultiDevice": true,
  "allowUserDesignPlanColorMark": true,
  "allowUserEditOwnTaskColor": true,
  "allowUserChangePassword": true,
  "specNumberDigits": 6,
  "auditLogMaxRows": 5000,
  "taskColorConfig": {
    "default": "#d8b4fe",
    "confirm": "#86efac",
    "design": "#fef9c3",
    "confirmModify": "#bae6fd",
    "designChange": "#fdba74",
    "drawingReview": "#fbcfe8",
    "paused": "#ff0000",
    "urgentConfirm": "#ffff00",
    "urgentDesign": "#ffff00",
    "urgentConfirmModify": "#f9a8d4"
  },
  "defaultGunHours": {
    "confirm": { "C": 1.5, "X": 2 },
    "design": { "C": 2.5, "X": 3 },
    "confirmModify": { "C": 0.5, "X": 0.75 }
  },
  "tableGunHours": {
    "X2C": {
      "SRTC": { "confirm": 1.5, "confirmModify": 0.5, "design": 2.5 }
    }
  }
}
```

字段说明：

- 所有字段含义同 `GET /api/system/settings`。
- **保存语义是「部分合并」**：`data.settings.system = normalizeSystemSettings({ ...库中现有设置, ...请求体 })`，只覆盖请求体里带的字段；请求体没传的开关/配置**保留库中原值**（不会被打回默认值）。因此前端可以只提交单个配置项（例如只提交 `taskColorConfig`），不影响其它设置；库中尚不存在该字段时按内置默认值补齐。
- `allowMultiDevice` 为**必填**布尔值（Joi `required()`），缺失返回 `400`。
- `allowUserDesignPlanColorMark` 与 `allowUserEditOwnTaskColor` 为兼容字段：二者只要传其一，服务端取两者的**或值**后同时回写两个字段；两个都不传时默认允许（`true`）。
- `specNumberDigits` 取值 `5` 或 `6`，可选；传入其他值会被忽略并使用默认值 `5`。
- `auditLogMaxRows` 取值 `100` ~ `100000` 的整数，可选；传入其他值会被忽略并使用默认值 `5000`。
- `taskColorConfig` 可选：10 个键都可省略，每个值为 `#rgb` / `#rrggbb` 颜色串，也兼容历史 `{ bg, text }` 对象（`text` 被忽略）。传入的配色**整体替换**该字段（未传的配色键回退内置默认值），但不会影响其它设置项；已下线的 `urgentDesignChange` / `urgentDrawingReview` 会被 `stripUnknown` 过滤；色值格式非法返回 `400`（`message=输入格式不正确`）。保存成功后前端会回读归一化结果，主页面下次渲染即用新配色。
- `allowUserChangePassword` 可选，布尔值（自主改密开关仅在显式传 `true` 时开启）。
- `defaultGunHours` 可选，结构同 GET 响应（每类 C/X 数值 0-24），未传时保留库中现有值，库中不存在时使用内置默认值。
- `tableGunHours` 可选，结构为 `{ 分类名: { 表名: { confirm, confirmModify, design } } }`（分类名 1-30 字符、表名 1-50 字符、各工时 0-24 且必填）；保存时以内置表规则为底合并：合法单元格采用提交值（即提交完整的内置表项即视为覆盖/重置），非法单元格回退内置值、无内置值则丢弃。
- 请求体经 Joi 校验（`stripUnknown`），未声明字段自动过滤；校验失败返回 `400`（`message=输入格式不正确`，附 `details`）。

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

- 操作日志最多保留 `auditLogMaxRows` 条（系统设置 → 日志管理，默认 5000），超过时自动清理最旧的记录。
- 仅记录已登录用户的请求（匿名请求不记）；登录成功的请求会从登录响应中补取用户信息后记录。
- **记录范围按「是否改变状态」收敛**（`backend/middleware/auditLog.js` 的 `shouldAudit`）：
  - 写操作全记：`POST` / `PUT` / `PATCH` / `DELETE`；
  - `GET` 只记敏感读取：各类导出（`/export`、`/export-all`、`/export-xls`）与 `GET /api/system/db-stats`；
  - 常规读接口不记：`GET /api/settings/*`、`/api/system/settings`、`/api/system/version`、`/api/designers`、`/api/tasks` 等页面初始化请求均不入库；
  - 会话心跳 `GET /api/auth/validate` 不记；
  - 语义为只读的 `POST` 不记：`/api/spec/spec-info`、`/api/spec/delivery-date`、`/api/spec/spec-raw-text`、`/api/design-standards/search`、`/api/design-standards/chat`、`/api/tasks/batch-replace/search`、`/api/status-tracking/import/check`。
- `GET /api/system/login-logs`、`GET /api/system/audit-logs`、`GET /api/system/audit-logs/filter-options` 本身不记录；`GET /api/system/audit-logs/export` 作为导出操作正常记录。
- GET 请求不记录响应消息，POST/PUT/DELETE 请求记录请求体（脱敏后最大 2000 字符；DELETE 的请求体用于说明删除了哪条记录，如 `DELETE /api/tasks/item`、`DELETE /api/users/:id`）。
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
| `size.bytes` | 逻辑数据大小（kv 集合与任务条目 JSON 序列化后的字节数之和） |
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
    "scheduleTimes": ["00:30", "12:30"],
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
    "freelistBytes": 262144,
    "reclaimableBytes": 262144,
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
| `settings.scheduleTimes` | 计划执行时间列表（最多两个，格式 HH:MM，默认 `["00:30", "12:30"]`） |
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
| `database.totalDiskSize` | 三个物理文件大小之和（字节，**含尚未回收的空闲页**） |
| `database.freelistBytes` | 空闲页体积（字节）：已删除但还留在数据文件里、尚未归还给操作系统的空间，执行压缩（`VACUUM`）后才会真正释放 |
| `database.reclaimableBytes` | 压缩后可回收的体积（字节），当前与 `freelistBytes` 同值，供前端提示「可回收 xx MB」 |
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
  "scheduleTimes": ["00:30", "12:30"],
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
| `scheduleTimes` | 是 | 计划执行时间列表（1-2 项，格式 HH:MM，默认 `["00:30", "12:30"]`） |
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

> 备份只写入配置的数据库备份目录（默认 `backups/database/`）。此前存在「额外复制到固定网络共享地址」的双写逻辑，该逻辑与 `secondaryBackup` 响应字段已移除。

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
    "fileName": "gun-ledger-all-20260710-103000.zip",
    "filePath": "D:\\project\\backend\\backups\\gun-ledger-exports\\gun-ledger-all-20260710-103000.zip",
    "dir": "D:\\project\\backend\\backups\\gun-ledger-exports",
    "size": 262144,
    "categories": 3,
    "type": "manual-gun-ledger-export"
  }
}
```

说明：

- 导出内容为包含全部焊枪编号台账分类的单个 `.zip`，每个分类对应包内一个独立 `.xls`（文件名为 `gun-ledger-<分类名>-<时间戳>.xls`，分类下每张台账表对应一个工作表）；手动与每日定时自动导出的压缩包文件名均为 `gun-ledger-all-YYYYMMDD-HHmmss.zip`，定时导出的 `type` 为 `scheduled-gun-ledger-export`（手动为 `manual-gun-ledger-export`）。
- 没有任何台账数据时返回 `404` 和 `没有可导出的焊枪编号台账数据`。

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
    },
    "compaction": {
      "before": { "dbFileSize": 943718, "walSize": 102400, "totalDiskSize": 1046118 },
      "after": { "dbFileSize": 786432, "walSize": 0, "totalDiskSize": 786432 },
      "freedBytes": 259686,
      "freelistBytesBefore": 262144,
      "removedOrphans": 0
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
- 清理完成后自动执行一次数据库压缩（`VACUUM` + WAL 截断），结果在 `compaction` 中返回（年度清理常一次删掉数千条记录，不压缩的话磁盘占用不会下降）；压缩失败时为 `null`，不影响清理结果。

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

### 清理任务数据

`POST /api/system/maintenance/cleanup-tasks`

权限：仅 `superadmin`

请求体（三种模式三选一）：

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

或（清空全部任务数据）

```json
{
  "all": true
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `month` + `year` | 三选一 | 删除指定月份的任务工作表 |
| `beforeMonth` + `beforeYear` | 三选一 | 删除指定年月之前的所有任务工作表 |
| `all` | 三选一 | 传 `true` 时删除**所有月份、所有设计员**的任务数据（工作表与任务条目全部清空），优先级最高，与上面两组字段同时出现时以 `all` 为准 |

响应：

```json
{
  "message": "任务数据清理完成",
  "scope": "2026-07",
  "removedSheets": 12,
  "removedItems": 320,
  "remainingSheets": 120,
  "remainingItems": 5000,
  "freedBytes": 262144,
  "removedOrphans": 3,
  "removedCount": 12,
  "remainingCount": 120
}
```

| 字段 | 说明 |
|------|------|
| `scope` | 实际清理范围：`YYYY-MM`（指定月份）、`YYYY-MM 之前`，或 `全部月份` |
| `removedSheets` / `removedItems` | 删除的**工作表张数**（设计员 × 月份）/ 删除的**任务条目数**；两个口径分开返回，不要互相换算 |
| `remainingSheets` / `remainingItems` | 清理后剩余的工作表张数 / 任务条目数 |
| `freedBytes` | 本次清理后压缩数据库实际归还给操作系统的字节数（`0` 表示没有可回收空间或压缩失败） |
| `removedOrphans` | 压缩时清理掉的孤儿任务条目数（所属工作表已被删除、条目却还残留） |
| `removedCount` / `remainingCount` | **兼容旧字段**，含义等同 `removedSheets` / `remainingSheets`（历史调用方按「张数」理解），新代码请用带 `Sheets`/`Items` 的字段 |

说明：

- 三种模式都**不区分**在线/离线，删除不可撤销；`all: true` 会一次性清空全部任务数据，前端需二次确认。
- 删除后**立即执行一次数据库压缩**（`VACUUM` + WAL 截断，见下文「压缩数据库」）：SQLite 的删除只是把页放进空闲页链表，不压缩的话 `totalDiskSize` 不会变化，容易被误判成「没清干净」。压缩失败只记录日志，不影响清理结果（此时 `freedBytes` 为 `0`）。
- 清理后通过 Socket.IO 广播 `task_refreshed`（携带 `{ scope: 'task-cleanup' }`）通知所有客户端刷新数据；前端还需同步作废本地 `obara_offline_sheets_cache` 离线缓存，否则离线状态下会用缓存把已删除的任务重新渲染出来。
- 未指定任何可用模式时返回 `400`（`请指定月份、清理时间点或选择清空全部任务数据`）。
- 与 `DELETE /api/system/cleanup/old-tasks?keepMonths=N` 不同，本接口按精确年月或全量清理，而非按「最近 N 个月」。

### 压缩数据库

`POST /api/system/maintenance/compact`

权限：仅 `superadmin`

请求体：无。

说明：

- 执行 `wal_checkpoint(TRUNCATE)` → `VACUUM` → `wal_checkpoint(TRUNCATE)`，把已删除数据占用的空闲页真正归还给操作系统。
- 压缩前会先清理**孤儿任务条目**（所属工作表已被删除但条目仍残留），否则 `VACUUM` 会继续把它们保留在文件里。
- `VACUUM` 不能运行在事务内，且压缩期间数据库被独占重建：通常只需数秒，期间请避免其他人大批量导入或清理。
- 清理任务数据的三个入口（`cleanup-tasks`、`old-tasks`、`yearly-cleanup`）已经内置了压缩，本接口用于**手动回收**（例如发现 `database.reclaimableBytes` 较大但近期没做清理时）。

响应：

```json
{
  "message": "数据库压缩完成",
  "compaction": {
    "before": { "dbFileSize": 943718, "walSize": 102400, "totalDiskSize": 1046118 },
    "after": { "dbFileSize": 786432, "walSize": 0, "totalDiskSize": 786432 },
    "freedBytes": 259686,
    "freelistBytesBefore": 262144,
    "removedOrphans": 3
  }
}
```

| 字段 | 说明 |
|------|------|
| `before` / `after` | 压缩前后 `data.db`、`data.db-wal` 与两者之和（字节） |
| `freedBytes` | 实际回收的字节数（不会为负，压缩后变大时取 `0`） |
| `freelistBytesBefore` | 压缩前的空闲页体积（`page_size × freelist_count`） |
| `removedOrphans` | 压缩前清理的孤儿任务条目数 |

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
  "freedBytes": 1048576,
  "dbSizeKbAfter": 512.00
}
```

说明：

- 清理后同样会执行一次数据库压缩（`VACUUM` + WAL 截断），`freedBytes` 为实际回收字节数，压缩失败时为 `0`（不影响清理结果）。

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

### IP 黑名单管理

超级管理员可维护 IP 黑名单，拦截异常来源的访问。存储在 `settings.ipBlacklist`：

```json
{
  "enabled": false,
  "entries": [
    {
      "id": "0e8c1a2b-...",
      "ip": "192.168.1.0/24",
      "note": "备注（最长 100 字符）",
      "createdAt": "2026-09-26T08:00:00.000Z",
      "createdBy": { "id": "...", "username": "superadmin", "name": "超级管理员" }
    }
  ]
}
```

规则格式支持三种（保存前由后端校验并归一化）：

| 格式 | 示例 | 说明 |
|------|------|------|
| 精确 IP | `192.168.1.100`、`2001:db8::1` | IPv4 / IPv6 均可 |
| CIDR 网段 | `192.168.1.0/24`、`2001:db8::/32` | 按前缀长度匹配 |
| IPv4 通配符 | `192.168.*.*` | 按段匹配，仅限 IPv4 |

生效机制（`backend/utils/ipBlacklist.js` 全局中间件）：

- 命中黑名单的 IP 访问任意 `/api` 接口返回 `403`（`code=IP_BANNED`）；
- `OPTIONS` 预检请求与本机回环地址（`127.0.0.1` / `::1`）永不拦截，防止管理员误封自身出口 IP 后无法自救；
- 命中黑名单的 IP 尝试登录时，会额外写入一条失败原因「IP 已被列入黑名单」的登录日志，便于在登录管理界面查看拦截记录；
- IPv4-mapped IPv6（`::ffff:a.b.c.d`）统一归一为 IPv4 后匹配，避免同一地址因表达形式不同绕过；
- 规则最多保留 500 条，单次批量添加最多 50 条；规则缓存 15 秒 TTL，增删/启停后立即失效缓存生效。

#### 获取 IP 黑名单

`GET /api/system/ip-blacklist`

权限：仅 `superadmin`

响应：返回上述 `settings.ipBlacklist` 对象。

#### 启用/停用 IP 黑名单

`PUT /api/system/ip-blacklist`

权限：仅 `superadmin`

请求体：

```json
{ "enabled": true }
```

响应：返回更新后的黑名单配置。`enabled` 非布尔值返回 `400`。

#### 批量添加黑名单规则

`POST /api/system/ip-blacklist`

权限：仅 `superadmin`

请求体（`ip` 支持逗号/分号/空白分隔多条规则，单次最多 50 条；`note` 选填，最长 100 字符）：

```json
{ "ip": "1.2.3.4, 10.0.0.0/24 192.168.*.*", "note": "异常扫描来源" }
```

响应：

```json
{
  "added": [ { "id": "...", "ip": "1.2.3.4", "note": "异常扫描来源", "createdAt": "...", "createdBy": {} } ],
  "failed": [ { "ip": "999.1.1.1", "reason": "IP 地址格式不正确" } ],
  "total": 3
}
```

说明：格式非法的规则进入 `failed`（不阻断其他规则）；与已有规则重复的自动跳过（幂等，不报错）；总规则数超过 500 条返回 `400`。

#### 删除黑名单规则

`DELETE /api/system/ip-blacklist/:id`

权限：仅 `superadmin`

响应：`{ "entries": [...], "total": 2 }`。规则不存在返回 `404`。

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
| `group` | 否 | 统计分组。传具体分组名时只导出该分组的设计人员；不传或传 `all` 时导出全部人员 |
| `excludeWeekendOvertime` | 否 | 传 `1` / `true` 时按「不含周末加班」口径导出：周末日期上的任务不计入，总工时即工作日工时，且不再输出「工作日工时」「周末加班工时」两列 |
| `excludeVacationLeave` | 否 | 传 `1` / `true` 时按「不含休假」口径导出：请假工时不计入休假（`vacation`） |

响应：`.xls` 文件流，文件名格式为 `work-hours-YYYY-MM.xls`。

导出列说明：

| 列名 | 说明 |
|------|------|
| 设计员 | 设计人员姓名 |
| 总工时 | 所有任务工时总和（不含请假）；`excludeWeekendOvertime` 开启时仅含工作日 |
| 工作日工时 | 工作日内的任务工时（按覆盖规则计算）。`excludeWeekendOvertime` 开启时不输出该列 |
| 周末加班工时 | 周末加班工时（总工时 - 工作日工时）。`excludeWeekendOvertime` 开启时不输出该列 |
| 出差工时 | 出差任务的工时总和；`excludeWeekendOvertime` 开启时仅含工作日出差 |
| 请假工时 | 事假 + 休假 + 病假工时总和；`excludeVacationLeave` 开启时不含休假 |

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

从 `SPEC_SHARE_PATH` 配置的共享目录搜索指定仕样号的最新 PDF，并尝试提取纳期信息。

请求：

```json
{
  "specNumber": "12345"
}
```

说明：

- `specNumber` 必须为纯数字，且位数需与系统设置 `specNumberDigits` 一致（5 或 6 位，默认 5）。
- 系统会查找 `仕样书$\12345.PDF` 及 `12345.01.PDF` ～ `12345.99.PDF` 等版本文件，取最新版本。
- 纳期提取使用与「获取仕样详细信息」一致的解析逻辑（7 类专用类别规则优先、未命中回退通用规则，见 README「仕样书 PDF 专用解析规则」），保证纳期获取与「相同仕样号同步更新纳期」的结果一致。
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
| `获取纳期失败，请稍后重试或检查网络后联系管理员` | 其他内部错误（不回传错误细节，详细信息仅记录服务端日志） |

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
  "message": "获取仕样信息失败，请稍后重试或检查网络后联系管理员"
}
```

> 接口失败时不向客户端回传内部错误细节（可能含上游 URL / 文件路径），详细信息仅写服务端日志。

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

响应（失败）：

```json
{
  "success": false,
  "message": "获取原始文本失败，请确认仕样书存在或联系管理员"
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

连接成功后，用户信息会附加到 `socket.data.user`，包含 `id`、`username`、`name`、`role` 字段。服务端会立即下发 `editing_state`（主页面编辑状态）、`gun_ledger_editing_state`（焊枪台账行编辑状态）、`gun_ledger_table_locks_state`（焊枪台账表级锁快照）和 `status_tracking_editing_state`（状态追踪行锁快照）。

> 前端约定：这几个快照事件**只在连接建立时下发一次**，不会在页面挂载时重放。前端 `src/utils/socketClient.ts` 以引用计数方式全应用共享一条连接，并缓存这些事件的最近载荷；晚于连接挂载的页面需通过 `getSnapshot()` 补齐初始状态（编辑会话、行锁、表锁），否则会看不到他人已占用的编辑/锁状态。

### 编辑状态管理

后端使用 `designerId::date::itemId` 作为键管理编辑会话（`itemId` 为空时退化为 `designerId::date::`，即旧的整格会话）。粒度为**主任务级**：

- **同一主任务互斥**：某个主任务已被他人占用时，新的 `start_editing` 被拒绝，发起人收到 `editing_blocked`（载荷为占用会话）。
- **不同主任务并行**：同一设计人员同一天内的不同主任务，允许多个用户同时编辑，互不干扰。
- **整格会话兼容**：`itemId` 为空的旧版会话视为占用整个单元格，会拦住该单元格内的所有主任务；未升级的旧客户端发送的 `start_editing` 不带 `itemId`，行为与升级前一致。
- **同一用户单会话**：同一用户同时只能持有一个会话，发起新的 `start_editing` 会自动释放自己之前的会话（向全体广播对应的 `user_stopped_editing`）。
- **`stop_editing` 不带 `itemId`**：携带 `designerId` + `date` 时，移除**该 socket 在该单元格内的全部主任务会话**（不再只删一个键）；两者都不传时释放该 socket 的所有会话。
- 断开连接时移除该 socket 持有的全部会话。

前端 `useEditingSessions` 与之对应的判定规则：

| 调用 | 传入 `itemId` | 不传 `itemId`（新增/整格类操作） |
|------|--------------|--------------------------|
| 被他人会话拦截的条件 | 他人占用**同一主任务**，或存在他人整格会话 | 仅他人**整格会话** |
| 提示文案 | `AAA 正在编辑该任务，暂无法操作`（`colorMark` 时为 `AAA 正在修改该任务的完成状态，暂无法操作`） | `AAA 正在编辑该区域，暂无法操作` |
| UI 呈现 | 该主任务行内的红色脉冲徽标（`colorMark` 时按 `gunIndex` 落到具体枪名行） | 整格红色罩层 |

主页面「新增主任务」入口不再申请编辑会话，因此不受他人的主任务级会话影响。

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
3. **角色限制**：`gun_ledger_lock_table`、`gun_ledger_start_edit`、`gun_ledger_table_heartbeat` 三个事件仅 `admin`/`superadmin` 可调用，普通用户（`user`）发送会被拒绝并收到 `error` 事件（`Insufficient permissions`），防止普通用户构造客户端抢占编辑锁。`gun_ledger_unlock_table`、`gun_ledger_stop_edit` 仅释放本 socket 持有的资源，不做角色限制。

### 多设备登录踢下线机制

连接建立时，服务端会自动将 socket 加入 `user:${user.id}` room（无需客户端发送 `register_user` 事件）。关闭多设备登录时（`allowMultiDevice=false`），新登录会使旧会话失效，并通过 `io.to(user:${user.id}).emit('session_invalidated', ...)` 通知该用户的其他设备下线；开启多设备登录时（`allowMultiDevice=true`），各设备的会话并存于 `sessionTokens` 列表中，新登录不发踢下线事件。

### 连接恢复自动加载

Socket 重连成功后会自动触发 `task_refreshed`，前端重新加载最新数据。

### 客户端事件

| 事件 | 说明 | 权限与限流 |
|------|------|------------|
| `connect` | Socket 连接成功（可用于检测后端是否恢复） | - |
| `connect_error` | Socket 连接失败（后端端口断开或网络异常） | - |
| `task_updated` | 通知任务已更新，后端收到后会广播 `task_refreshed` 给其他客户端。可选参数 `{ designerId, month, year }` 用于增量广播，不传或坐标非法时退化为全量刷新信号 | 需已认证；**每个连接 10 秒最多 20 次**；超限时**不回发 `error`**，而是记录最后一次变更坐标并在限流窗口结束后补发一次 `task_refreshed`（见「任务刷新与增量广播」的限流与补发） |
| `request_state` | 主动索取一次指定状态快照，参数 `{ event }`，`event` 必须是白名单之一：`editing_state`、`gun_ledger_editing_state`、`gun_ledger_table_locks_state`、`status_tracking_editing_state`；服务端校验通过后以同名事件把当前快照回给**发起者**。用于页面晚挂载或 Socket 重连后补一次初始状态，避免只能等下一次变更广播 | 需已认证；**每个连接 10 秒最多 20 次**，超限与该事件不在白名单时**静默忽略**（不回发 `error`，也不回快照） |
| `start_editing` | 通知开始编辑，参数包含 `designerId`、`date`、可选 `mode`（`edit` / `colorMark`）、可选 `itemId`（主任务 id，省略即整格会话）、可选 `gunIndex`（枪名下标，`colorMark` 模式下定位到具体枪名行，`null`/省略表示主任务本身） | 需已认证；用户身份一律取服务端会话，客户端传入的 `userId`/`username` 被忽略 |
| `stop_editing` | 通知停止编辑，可传 `designerId` 和 `date` 释放该 socket 在此单元格内的**全部主任务会话**（事件不带 `itemId`）；两者都不传则释放当前 socket 的所有编辑会话 | 需已认证 |
| `status_tracking_start_edit` | 通知开始编辑状态追踪记录，参数只需 `itemId` | **仅 `admin`/`superadmin`**（否则 `error: Insufficient permissions`）；需通过 `statusTracking` 页面权限校验（否则 `error: 无权访问`）；**每个连接 10 秒最多 30 次** |
| `status_tracking_stop_edit` | 通知停止编辑状态追踪记录，参数包含 `itemId` | 需已认证 |
| `gun_ledger_start_edit` | 通知开始编辑焊枪台账某行（取号），参数包含 `tableId`、`serialNumber` | 仅 `admin`/`superadmin` |
| `gun_ledger_stop_edit` | 通知停止编辑焊枪台账某行，参数包含 `tableId`、`serialNumber` | 需已认证 |
| `gun_ledger_lock_table` | 申请焊枪台账表级独占编辑锁，参数包含 `tableId` | 仅 `admin`/`superadmin` |
| `gun_ledger_unlock_table` | 释放焊枪台账表级编辑锁，参数包含 `tableId` | 需已认证 |
| `gun_ledger_table_heartbeat` | 焊枪台账表级锁心跳续期，参数包含 `tableId` | 仅 `admin`/`superadmin` |

> 所有事件均在 try/catch 中执行，鉴权或校验失败时向**发起者**回发 `error` 事件（`{ message }`），不会广播给其他人。

### 服务端事件

| 事件 | 说明 | 接收方 |
|------|------|--------|
| `task_refreshed` | 任务数据已刷新。载荷为空时客户端全量刷新；载荷为 `{ sheets: [sheet] }` 时为增量更新，客户端直接本地合并这些工时表（详见「任务刷新与增量广播」） | 由 `task_updated` 事件触发时：除发起者外的其他客户端；由 HTTP 接口（导入/维护/分配）触发时：全体客户端（无载荷） |
| `editing_state` | 当前所有编辑中的会话状态（主任务粒度，一个单元格可能存在多条），连接成功后下发 | 仅当前连接 |
| `user_editing` | 某用户正在编辑指定会话，参数为编辑会话（含 `designerId`、`date`、`userId`、`username`、`name`、`mode`、`itemId`、`gunIndex`、`socketId`） | **除发起者外**的其他客户端（发起者需自行维护本地状态） |
| `editing_blocked` | 目标主任务（或整格）已被其他用户编辑，服务端拒绝新的编辑请求，参数为占用会话 | 仅发起者 |
| `user_stopped_editing` | 某用户停止编辑指定设计人员日期单元格，参数 `{ designerId, date, userId }`；不带 `itemId`，客户端需自行移除该用户在该单元格内的全部会话（切换/停止多个主任务会话时会逐条下发） | 全体客户端（含发起者） |
| `session_invalidated` | 当前会话被新登录踢下线 | 该用户的其他设备连接 |
| `status_tracking_edit_start` | 某用户开始编辑指定状态追踪记录，参数 `{ itemId, userId, username, socketId }` | 全体客户端（含发起者） |
| `status_tracking_edit_stop` | 某用户停止编辑指定状态追踪记录，参数 `{ itemId }` | 全体客户端（含发起者） |
| `status_tracking_updated` | 状态追踪记录更新，包含 `action`（add/update/delete）和 `item` 或 `itemId` | 全体客户端 |
| `status_tracking_bulk` | 状态追踪批量更新，包含所有记录列表 | 全体客户端 |
| `gun_ledger_editing_state` | 当前焊枪台账行编辑状态，连接成功后下发 | 仅当前连接 |
| `gun_ledger_table_locks_state` | 当前焊枪台账表级锁快照，连接成功后下发 | 仅当前连接 |
| `gun_ledger_edit_start` | 某用户开始编辑焊枪台账某行，参数 `{ tableId, serialNumber, userId, username, name, socketId }` | **除发起者外**的其他客户端 |
| `gun_ledger_edit_stop` | 某用户停止编辑焊枪台账某行，参数 `{ tableId, serialNumber, userId }` | 全体客户端（含发起者） |
| `gun_ledger_edit_blocked` | 当前行已被其他用户编辑，参数为占用会话 | 仅发起者 |
| `gun_ledger_table_locked` | 某表被锁定（表级独占编辑锁），参数 `{ tableId, userId, username, name, lockedAt }` | 全体客户端 |
| `gun_ledger_table_unlocked` | 某表锁被释放，参数 `{ tableId }` | 全体客户端 |
| `gun_ledger_table_lock_blocked` | 申请表级锁被他人占用，参数 `{ tableId, holder }` | 仅发起者 |
| `gun_ledger_updated` | 焊枪台账数据变更，参数含 `action`（import/add_category/delete_category/add_table/rename_table/delete_table/reorder_tables/reorder_categories/update_rows/gun_name_rule/default_persons）及相关数据 | 全体客户端 |
| `error` | 事件处理出错，参数 `{ message }`（如未认证、权限不足、缺少必填字段、触发限流） | 仅发起者 |

### 任务刷新与增量广播

主页面任务变更后，发起方调用 `task_updated` 通知其他客户端，服务端据此广播 `task_refreshed`。为降低多人同时在线时的刷新开销，支持两种模式：

**1. 增量广播（携带坐标）**

客户端发送：

```javascript
socket.emit('task_updated', { designerId: 'designer-1', month: 10, year: 2026 });
```

- `designerId` 为变更所属设计人员，`month` 为 1-12 的月份，`year` 为年份，三者齐全且合法时服务端用它们从数据库读取最新工时表（`taskStore.getSheet`）。
- 广播内容取自**数据库**而非客户端 payload，避免把客户端构造的任意内容转发给其他在线用户。
- 广播：`task_refreshed` 携带 `{ sheets: [sheet] }`，`sheet` 即该设计人员当月工时表的最新完整数据，其他客户端可直接本地合并，无需重新拉取整月数据。
- 坐标缺失/非法或读取失败时退化为第 2 种模式（无载荷的全量刷新信号），服务端日志记录读取异常。

**2. 全量刷新信号（无载荷）**

不传坐标或坐标不合法时广播空的 `task_refreshed`，客户端按原逻辑重新拉取整月数据与工作日覆盖规则。适用于批量操作、跨设计人员移动、工作日设置变更、导入/维护等影响范围不明确或不止一张表的场景。

前端接收侧的节流策略（仅主页面）：

- 增量载荷只合并与当前查看月份一致（`sheet.month` / `sheet.year` 相同）的工时表，其他月份的变更丢弃，不触发拉取。
- 全量刷新信号对**只读用户**（无编辑权限或离线模式）合并到 3 秒一次；页面处于后台（`visibilityState === 'hidden'`）时直接跳过并置挂起标记，切回前台再补刷一次。
- 有编辑权限的用户收到全量信号时立即刷新，保证协作实时性。

**3. 限流与补发（trailing refresh）**

`task_updated` 按连接限流：**10 秒窗口内最多 20 次**（计数挂在 `socket.data.rateBuckets` 上，断开即回收）。

- 该事件只是「数据已变更」的信号，丢弃最后一次信号会让其他客户端一直停在旧状态，因此**限流命中时不回发 `error`，也不直接丢弃**：服务端把这次的变更坐标记录在连接上，并在窗口结束后补发一次 `task_refreshed`。
- 补发期间的后续变更只覆盖记录的坐标，不重复排定定时器（一个窗口最多一次补发，始终补发最新坐标）。
- 补发内容与正常广播一致：坐标合法则从数据库读取最新工时表走增量广播，否则为空载荷的全量刷新信号。
- 若在补发前窗口内又成功广播了一次（未被限流），待补发信号立即取消——最新数据已经送达，补发已无意义。
- 连接断开（`disconnect`）时清理待补发定时器，避免连接销毁后仍持有 `socket` 引用。
- 因此**前端不应依赖 `task_updated` 的 `error` 事件做退避**；其他事件（如 `status_tracking_start_edit`）超限仍会收到 `error`（`操作过于频繁，请稍后再试`）。

## 常见错误码

| 错误码 | HTTP | 说明 |
|--------|------|------|
| `ACCOUNT_DISABLED` | 403 | 账号已禁用 |
| `FORCE_PASSWORD_CHANGE` | 403 | 未修改初始密码，除「修改密码」「退出登录」外的接口一律被拦截 |
| `SESSION_INVALIDATED` | 401 | 会话在其他设备登录后失效 |
| `TOKEN_EXPIRED` | 401 | Token 已过期（`GET /api/auth/validate` 校验失败时返回） |
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
| 403 | `超级管理员资源，访问被拒绝。` / `管理员资源，访问被拒绝。` / `无权访问` / `只有管理员可以编辑表格` / `无权修改任务完成状态` / `无权修改枪名任务完成状态` / `系统已禁用自主修改密码，请联系管理员`（`allowUserChangePassword` 关闭时调用修改密码接口） / `您的 IP 已被列入黑名单，无法访问本系统`（`code=IP_BANNED`） | 权限不足（超管接口/管理员接口/页面权限开关未放行/无颜色标记权限/自主改密开关关闭）或来源 IP 命中黑名单 |
| 404 | `用户不存在` / `任务条目不存在` / `记录未找到` / `没有可导出的数据` 等 | 资源不存在 |
| 409 | `该表正由「xxx」编辑，请等待其完成后再保存` / `焊枪名不可重复：「xxx」（序号 1、3）` / `该知识库已关联` | 资源冲突：编辑锁被占用、焊枪名重复或知识库重复关联 |
| 429 | `请求过于频繁，请稍后再试` / `登录尝试过于频繁，请15分钟后再试` / `密码修改尝试过于频繁，请15分钟后再试` | 触发全局 API 限流、登录限流或修改密码限流 |
| 500 | `服务器内部错误` | 服务端错误 |

注意：

- 登录接口三层限流：第一层按 IP 15 分钟内最多 300 次（可通过 `LOGIN_IP_RATE_LIMIT_MAX` 调整，堵密码喷洒）；第二层按「IP + 用户名」15 分钟内最多 20 次尝试（防止单账号爆破）；两层均超限返回 `登录尝试过于频繁，请15分钟后再试`。
- 修改密码接口受独立速率限制（按「用户 ID」计数，15 分钟内最多 5 次尝试），超限返回 `密码修改尝试过于频繁，请15分钟后再试`。
- 全部 `/api` 接口还受全局限流保护（按 IP 计数，默认每 15 分钟 3000 次，可用 `API_RATE_LIMIT_MAX` 调整），超限返回 HTTP `429` 与消息 `请求过于频繁，请稍后再试`；`OPTIONS` 预检与本机环回请求不计数。
- 登录请求体校验：`username` 为 3-30 位字母数字，`password` 至少 6 位。

## 数据库初始化说明

系统使用 SQLite 数据库（`backend/data.db`，WAL 模式）作为唯一数据源，启动时自动执行以下初始化：

1. **建表**：`kv_store`（键值集合）、`task_sheets` / `task_entries`（任务工时关系表）、`login_logs`（登录日志）、`audit_logs`（操作日志）不存在时自动创建
2. **空库初始化**：`kv_store` 为空时写入初始数据（空用户/设计员集合、默认焊枪台账、默认设置）
3. **配置自动补齐**：每次启动及每次写库时，自动补齐缺失的默认配置（含 `leaderboard`、`workHours`、`statusTracking`、`systemSettings`、`maintenance`、`workdayOverrides`、`system`、`ipBlacklist` 等）
4. **焊枪台账序号校验**：启动时检测台账序号跳号/乱序，自动修复为连续自然序号 1..N
5. **初始管理员**：不存在超级管理员时自动创建，密码取 `DEFAULT_ADMIN_PASSWORD`，留空则随机生成并仅在控制台显示一次

系统不再提供从遗留 JSON 文件或旧版数据结构的数据迁移。

## 安全特性

1. **JWT 认证**：使用 JWT Token 进行身份验证，默认过期时间为 3 天（可通过 `JWT_EXPIRES_IN` 配置）；配合服务端会话吊销，登出、改密、账号禁用后旧 Token 立即失效
2. **密码加密**：使用 bcrypt 对密码进行哈希加密
3. **多层限流**：登录接口三层限流（按 IP 15 分钟 300 次兜底防密码喷洒，可用 `LOGIN_IP_RATE_LIMIT_MAX` 调整；按「IP + 用户名」15 分钟最多 20 次尝试；再加全局限流）；修改密码接口两层限流（按用户 ID 15 分钟最多 5 次尝试 + 全局 API 限流）；全局 API 限流按 IP 计数（15 分钟 3000 次，可通过 `API_RATE_LIMIT_MAX` 调整，`OPTIONS` 预检与本机环回不计），超限返回 HTTP `429`
4. **真实 IP 防伪造**：`trust proxy` 为 `loopback`，仅信任本机回环代理转发的 `X-Forwarded-For`；日志与限流使用 `req.ip`，不直接读取 `X-Forwarded-For` / `X-Real-IP`
5. **请求验证**：使用 Joi 进行请求参数验证
6. **安全头**：使用 Helmet 设置安全相关的 HTTP 头（含收敛 CSP：资源仅限同源、禁用插件、禁止页面被嵌入框架）
7. **跨域保护**：配置 CORS 限制跨域请求（可通过 `CORS_ORIGIN` 配置；通配符模式下自动不启用 credentials）。**生产环境强制要求显式白名单**，未配置将导致服务启动失败（`process.exit(1)`），开发环境未配置才允许回退为通配符 `*`
8. **账号禁用**：支持禁用账号，禁用后无法登录
9. **多设备登录控制**：可配置是否允许同一账号多设备同时在线
10. **强制修改密码与会话吊销**：新建用户首次登录需修改密码，一般管理员修改自己密码后下次登录需再次修改；标记未清除前，除「修改密码」「退出登录」外的所有接口一律返回 `403`（`FORCE_PASSWORD_CHANGE`）。超级管理员重置用户密码（单个或批量）后不强制改密，但会吊销旧令牌并记录一次性失效原因，旧会话校验时收到「密码已被管理员重置」提示
11. **操作审计**：记录已登录用户的**数据变更与敏感操作**（写操作全记；`GET` 仅记导出与数据库统计；心跳与页面初始化读接口不记，避免刷新页面产生大量日志），默认最多保留 5000 条（可在系统设置 → 日志管理中调整）；记录时递归脱敏（支持嵌套对象与数组），字段名匹配 `password`/`passwd`/`secret`/`token`/`api_key`/`apikey`/`authorization`（不区分大小写）一律显示为 `[REDACTED]`
12. **登录失败全量留痕与防枚举**：登录成功与失败均写登录日志，失败日志含 `reason`（`用户不存在` / `账号已禁用` / `密码错误`）；对客户端统一返回 `用户名或密码错误`，不暴露用户名是否存在
13. **Excel 依赖本地化**：Excel 解析使用随仓库分发的 `xlsx@0.20.3`（`backend/vendor/xlsx-0.20.3.tgz`，`file:` 协议安装），修复旧版 0.18.5 的 CVE-2023-30533 与 CVE-2024-22363
14. **IP 黑名单**：超级管理员可在系统设置「登录管理」中配置（精确 IP / CIDR 网段 / IPv4 通配符，最多 500 条），命中的来源 IP 访问任意 `/api` 接口返回 `403`（`IP_BANNED`）；`OPTIONS` 预检与本机回环地址永不拦截，黑名单 IP 的登录尝试会写入失败原因为「IP 已被列入黑名单」的登录日志

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
| `CORS_ORIGIN` | 开发环境默认 `*`；**生产环境必填** | 允许的前端地址，多个用逗号分隔；开发环境未配置时允许任意来源且不启用 CORS credentials；**生产环境未配置将导致服务启动失败（`process.exit(1)`），必须设置显式白名单** |
| `GITEE_TOKEN` | - | Gitee API Token，用于版本检查 |
| `GITEE_REPO_OWNER` | - | Gitee 仓库用户名 |
| `GITEE_REPO_NAME` | - | Gitee 仓库名称 |
| `SQLITE_DB_PATH` | `./data.db` | SQLite 数据库文件路径 |
| `RATE_LIMIT_WINDOW_MS` | `900000` | 限流窗口时间（毫秒），仅在 `security.js` 配置中定义；当前登录/改密限流器使用硬编码阈值，未读取此变量 |
| `RATE_LIMIT_MAX` | `20` | 限流最大次数，同上，当前未被独立限流器使用 |
| `LOGIN_IP_RATE_LIMIT_MAX` | `300` | 登录接口按 IP 的第一层限流：15 分钟内每 IP 最大登录请求数，用于堵住「IP+用户名」细粒度限流的密码喷洒缺口；共用出口 IP 的内网环境若早高峰误触发可适当调大 |
| `API_RATE_LIMIT_MAX` | `3000` | 全局 API 限流：每个 IP 15 分钟最大请求数，覆盖全部 `/api` 接口；`OPTIONS` 预检与本机环回不计数，超限返回 `429` |
| `DEFAULT_ADMIN_USERNAME` | `superadmin` | 默认管理员用户名（首次启动时创建，仅当不存在超级管理员时生效） |
| `DEFAULT_ADMIN_PASSWORD` | 空 | 默认管理员密码；留空时首次启动自动生成随机密码并仅在后端控制台显示一次（隐藏窗口启动时见 `logs/backend.log`），显式设置时首次启动后应立即修改 |
| `SPEC_SHARE_PATH` | 内置回退值 `\\192.168.160.6\仕样书$` | 仕样书 PDF 共享目录路径（如 `\\server\仕样书$`）；未显式配置时代码回退到该内置地址（`backend/config/security.js`） |
| `LOG_LEVEL` | `info` | 预留变量：当前版本代码未读取，设置后不生效 |
| `WEKNORA_ENABLED` | `false` | 是否启用设计规范知识库接入 |
| `WEKNORA_BASE_URL` | `http://127.0.0.1:8080/api/v1` | WeKnora API 根地址 |
| `WEKNORA_API_KEY` | 空 | 主工作空间 API Key，仅服务端使用 |
| `WEKNORA_EXTRA_API_KEYS` | 空 | 其他工作空间 API Key，多个用英文逗号分隔 |
| `WEKNORA_TIMEOUT_MS` | `60000` | WeKnora 普通请求超时（毫秒） |
| `WEKNORA_KNOWLEDGE_BASE_IDS` | 空 | 预留兜底知识库 ID（逗号分隔）；当前页面始终显式传入选中的知识库 ID，该变量实际不参与检索/问答 |
| `SMOKE_DB_PATH` | 空 | 仅冒烟测试读取：优先用它覆盖 `SQLITE_DB_PATH`，使测试写入数据库副本而非生产库；`npm test`（`backend/tests/run-all.js`）会自动用 `VACUUM INTO` 生成快照并设置该变量，服务端运行时不读取 |

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
  database: { sqlitePath },
  spec: { sharePath }
}
```

字段说明：

| 字段 | 说明 |
|------|------|
| `jwt.issuer` | JWT 签发者，默认 `obara-task-manager` |
| `jwt.audience` | JWT 受众，默认 `obara-task-manager-api` |
| `rateLimit.windowMs` / `rateLimit.max` | 配置块仍保留，但当前三层限流器均未读取这两个值：全局限流阈值取环境变量 `API_RATE_LIMIT_MAX`（默认 3000），窗口固定 15 分钟；登录/改密独立限流阈值在 `backend/routes/auth.js` 内硬编码 |
| `database.sqlitePath` | SQLite 数据库路径（`SQLITE_DB_PATH`，默认 `./data.db`） |
| `spec.sharePath` | 仕样书 PDF 共享目录路径（`SPEC_SHARE_PATH`；未配置时代码回退到内置地址 `\\192.168.160.6\仕样书$`） |

最后更新：2026-10-29
