# Obara 任务管理系统

Obara 任务管理系统是一个本地部署的 Excel 风格任务与工时管理工具，支持多人协作、任务录入、报表查询、工时排行、权限控制和数据导入导出。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | ![React](https://img.shields.io/badge/React-18+-61DAFB?logo=react&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-4+-3178C6?logo=typescript&logoColor=white) ![Vite](https://img.shields.io/badge/Vite-6+-646CFF?logo=vite&logoColor=white) ![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-3+-06B6D4?logo=tailwindcss&logoColor=white) ![Lucide React](https://img.shields.io/badge/Lucide%20React-4E60FF) ![Socket.IO Client](https://img.shields.io/badge/Socket.IO%20Client-010101?logo=socket.io&logoColor=white) ![DnD Kit](https://img.shields.io/badge/DnD%20Kit-6366F1) ![Date-fns](https://img.shields.io/badge/Date--fns-F29111) |
| 后端 | ![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs&logoColor=white) ![Express](https://img.shields.io/badge/Express-000000?logo=express&logoColor=white) ![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?logo=socket.io&logoColor=white) ![JWT](https://img.shields.io/badge/JWT-000000?logo=jsonwebtokens&logoColor=white) ![Bcrypt](https://img.shields.io/badge/Bcrypt-4E5DC0) ![Multer](https://img.shields.io/badge/Multer-16A34A) ![XLSX](https://img.shields.io/badge/XLSX-217346?logo=microsoft-excel&logoColor=white) ![Helmet](https://img.shields.io/badge/Helmet-06B6D4) |
| 数据库 | ![JSON](https://img.shields.io/badge/JSON%20File-000000?logo=json&logoColor=white) |

## 浏览器兼容性

- Chrome 100+ (推荐)
- Firefox 100+
- Edge 100+
- Safari 15+

## 快速开始

### Windows 一键启动

```bat
start.bat
```

启动后访问：

- 前端：http://localhost:5173
- 后端：http://localhost:5000

> 首次部署请在 `backend/db.json` 中自行配置超级管理员账号和密码，密码请使用 bcrypt 哈希值存储。

### 手动启动

```bat
git clone https://gitee.com/caifugao110/obara-task-manager.git
cd obara-task-manager
npm run install:all
npm run dev
```

## 主要页面

| 页面 | 路径 | 说明 |
|------|------|------|
| 主页面 | `/` | Excel 风格任务录入、拖拽移动、多选、复制、剪切、粘贴、撤销 |
| 任务报表 | `/leaderboard` | 仕样进度管理、枪名周期管理、月度工时与请假排行 |
| 工时管理 | `/work-hours` | 月度工时排行、请假排行、周末加班与出差明细 |
| 管理后台 | `/admin` | 设计人员列表、登录用户列表、批量导入 |
| 登录 | `/login` | 管理员和普通用户登录 |
| 修改密码 | `/change-password` | 首次登录或被重置密码后强制修改密码 |
| 系统设置 | `/system-settings` | 数据管理、登录管理、日志管理三大模块 |
| 操作日志 | `/system-logs` | 所有用户的操作日志明细和筛选 |
| 状态追踪 | `/status-tracking` | 任务状态追踪与批量导入导出 |

## 当前功能

### 主页面

- 按设计人员和日期录入任务。
- 支持设计计划、出差、事假、休假、病假等任务类型。
- 任务类型切换时会保留已填写的任务内容、枪名、枪名工时、出差地点/客户等临时输入。
- 枪名存在时，该枪名工时不能为 0。
- 管理员悬浮任务时可查看创建者、创建时间、最后修改者、最后修改时间。
- **所有任务内容的修改（包括枪名的编辑、复制、删除）都会记录最后修改者和最后修改时间。**
- 选中任务后，按住 `Ctrl` 可选择多个任务。
- 多选任务支持拖拽移动、`Ctrl+X` 剪切、`Ctrl+C` 复制、`Ctrl+V` 粘贴。
- **按住 `Ctrl` 键拖拽任务到目标单元格，会执行批量复制操作而非移动操作。**
- 多人同时使用时，同一设计人员同一天只允许一个用户编辑；其他用户会看到红色"正在编辑"提示。
- 底部统计会显示本月任务条目、周末加班、员工出差和员工请假汇总。
- **纳期更新功能：手动点击纳期更新时，将所有与该任务内容同一仕样号的计划任务一同更新或添加纳期（如果没有）。完成后提示已为多少个相同仕样号的计划任务添加纳期。**
- **任务字段变更采用 500ms 防抖保存机制，减少网络请求。**
- **支持 URL 参数直接跳转：`?date=YYYY-MM-DD&designerId=xxx&itemId=xxx` 可直接跳转到指定任务并自动选中和滚动定位。**
- **设计人员按分组显示，支持点击分组标题折叠/展开，状态保存在 localStorage。**
- **顶部下拉菜单可筛选显示特定设计人员或全部人员。**
- **任务列表会自动过滤掉无任务名且枪名全为空或"未命名"的无效任务，但在编辑模态框中仍能看到所有任务。**
- 快捷键提示：
  - `Ctrl+C`：提示"粘贴已准备"
  - `Ctrl+X`：提示"剪切已准备"
  - `Ctrl+V`：提示"任务已复制"
  - 无法撤销时提示"暂无可撤销操作"
- **支持 `Ctrl+Z` 撤销，同一用户最多保留 10 步撤销记录。主页面所有操作（包括删除单个枪名）均可撤销。**
- **批量替换功能：支持在指定月份或全表范围内搜索并替换任务名和枪名中的文本，执行前可预览匹配结果。**

### 离线模式

- 后端端口断开时自动检测（`ERR_NETWORK` / Socket 连接失败），立即从 localStorage 加载最近一次缓存的数据。
- 页脚绿色圆点变为红色，文字从"就绪"变为"离线"。
- 页面顶部显示橙色横幅："当前处于离线模式，正在使用本地缓存数据，网络恢复后将自动加载最新数据，此页面禁止刷新！"
- 首次断开时自动保存当前数据到浏览器 localStorage，同一次会话内不会重复保存。
- 刷新页面后如果后端仍不可用，直接使用缓存数据，不再弹出保存提示。
- 后端恢复后 Socket 自动重新连接，加载最新服务器数据，横幅和页脚状态恢复正常。
- 离线缓存数据仅用于离线浏览，不会覆盖服务器数据（服务器始终为权威来源）。

### 任务报表

- “仕样进度管理”支持按 5 位仕样号搜索。
- **“仕样进度管理”新增“获取仕样号所有枪名列表”开关，默认关闭。开启后，输入仕样号将显示该仕样号对应任务中的所有枪名，去除后缀L或R（不区分大小写）后进行去重处理，只列出唯一的枪名。**
- “枪名周期管理”支持按枪名搜索。
- 两个搜索区域都有“全表搜索”开关，默认关闭；开启后搜索所有月份。
- 搜索结果按日期从早到晚排序。
- 超级管理员可设置任务报表查看权限。
- “启用任务报表”关闭后，“一般管理员”和“游客/普通用户”会自动关闭。
- “启用任务报表”打开后，“一般管理员”和“游客/普通用户”会自动打开。
- “游客/普通用户”打开时，“一般管理员”不能关闭，并会给出提示。

### 工时管理

- “月度工时排行”可开启“不包含周末加班”，重新按去除周末后的工时排行。
- 人员名称下方会显示周末加班工时。
- 将鼠标悬停在人员上时可查看设计计划总工时、出差总工时、出差日期和每日出差工时。
- “月度请假排行”可开启“不包含休假”，重新按去除休假后的请假工时排行。
- 将鼠标悬停在人员上时可查看请假明细。
- 超级管理员可设置工时管理查看权限。
- “启用工时管理”关闭后，“一般管理员”和“游客/普通用户”会自动关闭。
- “启用工时管理”打开后，“一般管理员”和“游客/普通用户”会自动打开。
- “游客/普通用户”打开时，“一般管理员”不能关闭，并会给出提示。

### 管理后台

- “设计人员列表”用于维护主页面人员行。
- 设计人员姓名不允许重复。
- 设计人员为空时，超级管理员可一键初始化默认设计人员。
- 支持勾选多个设计人员后批量删除。
- “批量添加设计人员”支持从外部表格复制粘贴导入，并提供模板。
- 设计人员导入列：`name,group`。
- “登录用户列表”用于维护登录账号。
- 非超级管理员账号为空时，超级管理员可一键初始化默认登录用户。
- 支持勾选多个登录用户后批量删除，不能批量删除超级管理员或当前登录账号。
- “批量添加登录用户”支持从外部表格复制粘贴导入，并提供模板。
- 登录用户导入列：`username,password,name,role`，不需要“分组”列。
- 登录用户角色支持 `superadmin`、`admin`、`user`。
- 一般管理员批量添加登录用户时会自动创建为普通用户。
- 批量导入会自动跳过重复数据，并显示导入耗时。

### 状态追踪

- 任务状态追踪页面支持查看、创建、编辑、删除状态追踪记录。
- 支持批量导入状态追踪数据。
- 实时同步：数据变更通过 Socket.IO 广播通知所有客户端。
- 超级管理员可设置状态追踪页面访问权限。

### 系统设置

系统设置页面分为「数据管理」「登录管理」「日志管理」三大模块。

#### 数据管理

- **任务管理**：导出渲染后的任务 `.xls` 表格，文件名格式为 `obara-tasks-YYYY-MM-DD-HHmmss.xls`；导入任务数据时必须使用系统导出的 `.xls` 格式，每次只能选择一个月份覆盖导入。导入只解析任务内容/工时列，`当日合计` 和 `月总工时` 不导入，由系统重新计算。导入月份天数与表格天数不一致时，多出来的日期列会被截断，缺少的日期会按空数据处理。导入表格中新增的设计员不会自动创建，会跳过并在结果中提示。任务管理导入/导出仅超级管理员可用。
- **状态跟踪表**：按月份导出状态追踪数据为 `.xls`，文件名格式为 `status-tracking-YYYY-MM.xls`。仅超级管理员可导入，支持重复仕样号检查和覆盖导入选项。
- **工时管理表**：按月份导出工时汇总数据为 `.xls`，文件名格式为 `work-hours-YYYY-MM.xls`。导出表格包含设计员、总工时、工作日工时、周末加班工时、出差工时、请假工时等列，按总工时倒序排列，冻结首行和首列。

#### 登录管理

- 可配置未登录查看主页面和多设备同时在线。
- 仅超级管理员可访问登录管理模块。

#### 日志管理

- 主页面显示最新 10 条管理员（超级管理员和一般管理员）的登录记录，包含账号、姓名、角色、IP、浏览器信息和结果。
- 点击「详细日志」进入操作日志页面（`/system-logs`），可查看所有用户的所有操作记录，支持按用户名、操作类型、HTTP 方法、IP、日期范围筛选，并支持导出 `.xls`。
- 操作日志自动记录所有已登录用户的 API 请求，包含操作描述、方法、路径、IP、浏览器信息、状态码、耗时等，最多保留 2000 条。
- 仅超级管理员可访问日志管理模块。

## 权限模型

### 超级管理员 `superadmin`

- 查看和编辑所有任务。
- 管理设计人员、一般管理员和普通用户（包括禁用/启用账号）。
- 配置任务报表、工时管理、状态追踪和系统设置。
- 导入导出系统数据（任务管理、状态跟踪表、工时管理表）。
- 查看最新管理员登录信息和详细操作日志。
- 配置未登录查看、多设备同时在线等系统设置。
- 强制重置任意用户密码（重置后用户下次登录需修改密码）。

### 一般管理员 `admin`

- 查看和编辑任务。
- 管理设计人员。
- 创建普通用户作为登录用户。
- 是否可进入任务报表、工时管理、状态追踪，取决于对应页面的“一般管理员”开关。
- 是否可进入系统设置数据管理模块，取决于系统设置页面的“一般管理员”开关（仅可查看导出，不能导入）。

### 普通用户 `user`

- 登录后可查看主页面。
- 首次登录或被重置密码后需修改密码。
- 其他权限与未登录游客一致。
- 是否可进入任务报表、工时管理、状态追踪，取决于对应页面的“游客/普通用户”开关。

### 游客

- 在系统设置允许未登录查看时，可以查看主页面。
- 不能编辑任务。
- 是否可进入任务报表、工时管理、状态追踪，取决于对应页面的“游客/普通用户”开关。

## 数据存储

系统使用本地 JSON 文件保存数据，默认文件为 `backend/db.json`。主要字段：

```json
{
  "users": [],
  "designers": [],
  "tasks": [],
  "loginLogs": [],
  "auditLogs": [],
  "statusTrackingItems": [],
  "settings": {
    "leaderboard": { "enabled": true, "allowAdmins": true, "allowViewers": false },
    "workHours": { "enabled": true, "allowAdmins": true, "allowViewers": false },
    "statusTracking": { "enabled": true, "allowAdmins": true, "allowViewers": false },
    "systemSettings": { "enabled": true, "allowAdmins": true, "allowViewers": false },
    "leaderRules": [],
    "system": { "allowGuestView": true, "allowMultiDevice": true }
  }
}
```

字段说明：

| 字段 | 说明 |
|------|------|
| `users` | 登录用户列表，包含 `forcePasswordChange` 字段用于强制修改密码 |
| `designers` | 设计人员列表 |
| `tasks` | 按设计人员(`designerId`)、年月保存的任务表 |
| `loginLogs` | 登录历史，包含 IP、浏览器信息和登录结果，最多保留 500 条 |
| `auditLogs` | 操作日志，记录所有已登录用户的 API 请求，最多保留 2000 条 |
| `statusTrackingItems` | 状态追踪记录 |
| `settings.leaderboard` | 任务报表访问权限 |
| `settings.workHours` | 工时管理访问权限 |
| `settings.statusTracking` | 状态追踪访问权限 |
| `settings.systemSettings` | 系统设置页面访问权限（`allowViewers` 始终为 `false`） |
| `settings.leaderRules` | 组长规则配置 |
| `settings.system` | 系统设置，如未登录查看、多设备登录 |

建议定期备份 `backend/db.json`，也可以通过系统设置导出 `.xls` 作为任务数据的补充备份。

## 常用命令

```bat
npm run install:all
npm run dev
npm run dev:backend
npm run dev:frontend
npm run build
npm run start:backend
npm run start:frontend
```

其他脚本：

| 脚本 | 说明 |
|------|------|
| `start.bat` | Windows 一键启动前后端并打开浏览器 |
| `start-hidden.vbs` | 后台静默启动（不显示命令行窗口） |
| `start-process-hidden.vbs` | 进程隐藏启动辅助脚本 |
| `stop.bat` | 停止前后端进程 |

前端类型检查：

```bat
cd frontend
..\node_modules\.bin\tsc.cmd --noEmit
```

## 键盘快捷键

主页面支持以下键盘快捷键：

| 快捷键 | 功能 | 提示信息 |
|--------|------|----------|
| `Ctrl+C` | 复制选中的任务 | "粘贴已准备" |
| `Ctrl+X` | 剪切选中的任务 | "剪切已准备" |
| `Ctrl+V` | 粘贴任务 | "任务已复制" |
| `Ctrl+Z` | 撤销操作 | - |

说明：
- 选中任务后，按住 `Ctrl` 可选择多个任务。
- 多选任务支持拖拽移动、剪切、复制、粘贴。
- 按住 `Ctrl` 键拖拽任务到目标单元格，会执行批量复制操作而非移动操作。
- 同一用户最多保留 10 步撤销记录。

## 仕样信息搜索

系统支持从共享目录读取仕样书 PDF 文件，提取纳期和详细信息：

- 搜索路径：`\\192.168.160.6\仕样书$\`
- 支持按仕样号搜索，自动查找最新版本（如 `12345.PDF`、`12345.01.PDF` 等）
- 可提取纳期、中间商、最终客户、项目名称、数量、营业担当等信息
- 纳期获取超时时间为 9 秒，完整信息获取超时时间为 15 秒

## 强制修改密码

系统支持首次登录强制修改密码机制：

- 超级管理员创建的普通用户、一般管理员创建的普通用户首次登录时必须修改密码。
- 超级管理员重置任意用户密码后，该用户下次登录需修改密码。
- 已存在的非超级管理员账号在系统升级后会自动标记为需要修改密码。
- 修改密码页面为 `/change-password`，未提示修改密码时访问会自动跳转回主页。

## 操作日志

系统自动记录所有已登录用户的 API 请求作为操作日志：

- 日志包含操作描述、HTTP 方法、路径、IP、浏览器信息、状态码、耗时、请求体和响应消息。
- GET 请求不记录响应消息（避免存储大体积任务数据），POST/PUT 请求记录请求体（最大 2000 字符）。
- 操作日志最多保留 2000 条，超过自动清理最旧记录。
- 仅超级管理员可在「操作日志」页面查看，支持按用户名、操作类型、HTTP 方法、IP、日期范围筛选，并支持导出 `.xls`。
- 系统设置和操作日志相关接口本身不会被记录到操作日志中。

## 安全配置

系统使用集中的安全配置文件管理敏感信息，所有配置项均可通过环境变量设置。安全配置集中在 `backend/config/security.js`，包含 JWT 配置、CORS 配置、Gitee API 配置、数据库路径配置和服务器配置。

详细的环境变量配置、版本检查机制和安全加固建议，请参考 [Windows 部署指南](DEPLOYMENT.md)。

## 项目结构

```text
obara-task-manager/
├── .github/workflows/
│   └── deploy.yml
├── backend/
│   ├── .env.example
│   ├── db.js
│   ├── nodemon.json
│   ├── package.json
│   ├── package-lock.json
│   ├── server.js
│   ├── config/
│   │   └── security.js
│   ├── middleware/
│   │   ├── auditLog.js
│   │   └── auth.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── designers.js
│   │   ├── settings.js
│   │   ├── spec.js
│   │   ├── statusTracking.js
│   │   ├── system.js
│   │   ├── tasks.js
│   │   ├── users.js
│   │   └── workHours.js
│   ├── scripts/
│   │   └── extract_pdf_text.js
│   ├── templates/
│   │   └── spec-pdf/
│   └── utils/
│       └── exportWorkbook.js
├── docs/
│   └── API.md
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── package-lock.json
│   ├── postcss.config.js
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   ├── vite.config.ts
│   ├── public/
│   │   ├── favicon-16.png
│   │   ├── favicon-32.png
│   │   ├── favicon-48.png
│   │   ├── favicon-128.png
│   │   └── favicon.ico
│   └── src/
│       ├── App.tsx
│       ├── index.css
│       ├── main.tsx
│       ├── vite-env.d.ts
│       ├── context/
│       │   └── AuthContext.tsx
│       ├── hooks/
│       │   ├── index.ts
│       │   ├── useSocket.ts
│       │   └── useTasks.ts
│       ├── pages/
│       │   ├── Admin.tsx
│       │   ├── ChangePassword.tsx
│       │   ├── Dashboard.tsx
│       │   ├── Leaderboard.tsx
│       │   ├── Login.tsx
│       │   ├── StatusTracking.tsx
│       │   ├── SystemLogs.tsx
│       │   ├── SystemSettings.tsx
│       │   └── WorkHours.tsx
│       ├── services/
│       │   └── api.ts
│       ├── types/
│       │   └── index.ts
│       └── utils/
│           ├── axios.ts
│           ├── debounce.ts
│           └── loginLogs.ts
├── .gitignore
├── DEPLOYMENT.md
├── LICENSE
├── README.md
├── package.json
├── package-lock.json
├── start.bat
├── start-hidden.vbs
├── start-process-hidden.vbs
└── stop.bat
```

## 相关文档

- [API 文档](docs/API.md)
- [Windows 部署指南](DEPLOYMENT.md)

### 项目访问

完整的任务管理系统需要本地运行：

```bat
git clone https://gitee.com/caifugao110/obara-task-manager.git
cd obara-task-manager
npm run install:all
npm run dev
```

访问地址：
- 前端：http://localhost:5173
- 后端：http://localhost:5000

## License

MIT License
