# Obara 任务管理系统

Obara 任务管理系统是一个本地部署的 Excel 风格任务与工时管理工具，支持多人协作、任务录入、报表查询、工时排行、权限控制和数据导入导出。

## 快速开始

### Windows 一键启动

```bat
start.bat
```

启动后访问：

- 前端：http://localhost:5173
- 后端：http://localhost:5000

默认超级管理员账号：

- 用户名：`superadmin`
- 密码：`admin123`

### 手动启动

```bat
git clone https://github.com/caifugao110/obara-task-manager.git
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
| 系统设置 | `/system-settings` | 数据导入导出、登录策略、登录历史 |

## 当前功能

### 主页面

- 按设计人员和日期录入任务。
- 支持设计计划、出差、事假、休假、病假等任务类型。
- 任务类型切换时会保留已填写的任务内容、枪名、枪名工时、出差地点/客户等临时输入。
- 枪名存在时，该枪名工时不能为 0。
- 管理员悬浮任务时可查看创建者、创建时间、最后修改者、最后修改时间。
- 选中任务后，按住 `Ctrl` 可选择多个任务。
- 多选任务支持拖拽移动、`Ctrl+X` 剪切、`Ctrl+C` 复制、`Ctrl+V` 粘贴。
- 快捷键提示：
  - `Ctrl+C`：提示“粘贴已准备”
  - `Ctrl+X`：提示“剪切已准备”
  - `Ctrl+V`：提示“任务已复制”
  - 无法撤销时提示“暂无可撤销操作”
- 支持 `Ctrl+Z` 撤销，同一用户最多保留 5 步撤销记录。

### 任务报表

- “仕样进度管理”支持按 5 位仕样号搜索。
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
- 悬浮人员可查看设计计划总工时、出差总工时、出差日期和每日出差工时。
- “月度请假排行”可开启“不包含休假”，重新按去除休假后的请假工时排行。
- 悬浮人员可查看请假明细。
- 超级管理员可设置工时管理查看权限。
- “启用工时管理”关闭后，“一般管理员”和“游客/普通用户”会自动关闭。
- “启用工时管理”打开后，“一般管理员”和“游客/普通用户”会自动打开。
- “游客/普通用户”打开时，“一般管理员”不能关闭，并会给出提示。

### 管理后台

- “设计人员列表”用于维护主页面人员行。
- “批量添加设计人员”支持从外部表格复制粘贴导入，并提供模板。
- 设计人员导入列：`name,group`。
- “登录用户列表”用于维护登录账号。
- “批量添加登录用户”支持从外部表格复制粘贴导入，并提供模板。
- 登录用户导入列：`username,password,name,role`，不需要“分组”列。
- 登录用户角色支持 `superadmin`、`admin`、`user`。

## 权限模型

### 超级管理员 `superadmin`

- 查看和编辑所有任务。
- 管理设计人员、一般管理员和普通用户。
- 配置任务报表、工时管理和系统设置。
- 导入导出系统数据。
- 查看管理员登录历史。

### 一般管理员 `admin`

- 查看和编辑任务。
- 管理设计人员。
- 是否可进入任务报表、工时管理，取决于对应页面的“一般管理员”开关。

### 普通用户 `user`

- 登录后可查看主页面。
- 其他权限与未登录游客一致。
- 是否可进入任务报表、工时管理，取决于对应页面的“游客/普通用户”开关。

### 游客

- 在系统设置允许未登录查看时，可以查看主页面。
- 不能编辑任务。
- 是否可进入任务报表、工时管理，取决于对应页面的“游客/普通用户”开关。

## 数据存储

系统使用本地 JSON 文件保存数据，默认文件为 `backend/db.json`。主要字段：

```json
{
  "users": [],
  "designers": [],
  "tasks": [],
  "loginLogs": [],
  "settings": {
    "leaderboard": { "enabled": true, "allowAdmins": true, "allowViewers": false },
    "workHours": { "enabled": true, "allowAdmins": true, "allowViewers": false },
    "system": { "allowGuestView": true, "allowMultiDevice": true }
  }
}
```

建议定期备份 `backend/db.json`，也可以通过系统设置导出 xlsx 作为补充备份。

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

前端类型检查：

```bat
cd frontend
..\node_modules\.bin\tsc.cmd --noEmit
```

## 项目结构

```text
obara-task-manager/
|-- start.bat
|-- README.md
|-- DEPLOYMENT.md
|-- docs/
|   `-- API.md
|-- backend/
|   |-- server.js
|   |-- db.js
|   |-- routes/
|   `-- middleware/
`-- frontend/
    |-- vite.config.ts
    `-- src/
        |-- pages/
        |-- context/
        |-- services/
        `-- types/
```

## 相关文档

- [API 文档](docs/API.md)
- [Windows 部署指南](DEPLOYMENT.md)

## License

MIT License
