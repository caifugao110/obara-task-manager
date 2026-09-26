# Obara 任务管理系统

![License](https://img.shields.io/badge/License-MIT-green) ![Platform](https://img.shields.io/badge/平台-Windows%20%7C%20跨平台-lightgrey) ![Socket.IO](https://img.shields.io/badge/实时协作-Socket.IO-010101?logo=socket.io&logoColor=white)

Obara 任务管理系统是一款本地部署的 Excel 风格任务与工时管理工具，集成任务录入、工时统计、状态追踪、焊枪台账、设计规范知识库检索与问答、报表查询、权限控制与数据导入导出等能力，支持多人实时协作、离线浏览与操作审计。

## 文档导航

| 文档 | 适用对象 | 内容 |
|------|----------|------|
| 本文档 | 使用者、维护者 | 功能概览、快速启动、页面说明、权限模型、数据结构和常用命令 |
| [API 文档](docs/API.md) | 前后端开发者 | REST API、Socket.IO 事件、权限要求、错误码和环境变量 |
| [Windows 部署指南](DEPLOYMENT.md) | 部署和维护人员 | Windows 启动方式、环境变量、备份恢复、升级、排障和安全建议 |
| [WeKnora 知识库部署指南](weknora/README.md) | 部署和维护人员 | 设计规范知识库（WeKnora）的 Docker 部署、初始化与故障处理 |

## 目录

- [技术栈](#技术栈)
- [浏览器兼容性](#浏览器兼容性)
- [快速开始](#快速开始)
- [主要页面](#主要页面)
- [当前功能](#当前功能)
- [权限模型](#权限模型)
- [数据存储](#数据存储)
- [常用命令](#常用命令)
- [环境变量](#环境变量)
- [键盘快捷键](#键盘快捷键)
- [仕样信息搜索](#仕样信息搜索)
- [强制修改密码](#强制修改密码)
- [操作日志](#操作日志)
- [安全配置](#安全配置)
- [项目结构](#项目结构)
- [数据库维护](#数据库维护)
- [维护建议](#维护建议)
- [Windows 服务控制台](#windows-服务控制台)
- [CI/CD](#cicd)
- [License](#license)

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | ![React](https://img.shields.io/badge/React-18+-61DAFB?logo=react&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-5+-3178C6?logo=typescript&logoColor=white) ![Vite](https://img.shields.io/badge/Vite-5+-646CFF?logo=vite&logoColor=white) ![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-3+-06B6D4?logo=tailwindcss&logoColor=white) ![Lucide React](https://img.shields.io/badge/Lucide%20React-4E60FF) ![Socket.IO Client](https://img.shields.io/badge/Socket.IO%20Client-010101?logo=socket.io&logoColor=white) ![DnD Kit](https://img.shields.io/badge/DnD%20Kit-6366F1) ![Date-fns](https://img.shields.io/badge/Date--fns-F29111) ![Framer Motion](https://img.shields.io/badge/Framer%20Motion-0055FF?logo=framer&logoColor=white) |
| 后端 | ![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=nodedotjs&logoColor=white) ![Express](https://img.shields.io/badge/Express-5+-000000?logo=express&logoColor=white) ![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?logo=socket.io&logoColor=white) ![JWT](https://img.shields.io/badge/JWT-000000?logo=jsonwebtokens&logoColor=white) ![Bcrypt](https://img.shields.io/badge/Bcrypt-4E5DC0) ![Multer](https://img.shields.io/badge/Multer-16A34A) ![XLSX](https://img.shields.io/badge/XLSX-217346?logo=microsoft-excel&logoColor=white) ![Helmet](https://img.shields.io/badge/Helmet-06B6D4) |
| 数据库 | ![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white) |
| 控制台 | ![.NET Framework](https://img.shields.io/badge/.NET%20Framework-4.8-512BD4?logo=dotnet&logoColor=white) ![WinForms](https://img.shields.io/badge/WinForms-512BD4) |
| CI/CD | ![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-2088FF?logo=githubactions&logoColor=white) ![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-222222?logo=githubpages&logoColor=white) |

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

`start.bat` 会隐藏窗口运行（不打开浏览器），依次执行：检查 Node.js 版本 → 自动 `git pull --rebase` 拉取最新代码（本地修改会自动 stash 后恢复）→ 检查并释放 5000/5173 端口 → 按需安装依赖 → 后台启动前后端，日志输出到 `logs/` 目录。

启动后访问：

- 前端：http://localhost:5173
- 后端：http://localhost:5000

> `start.bat` 强制要求 Node.js 22+（better-sqlite3 13、joi 18、pdf-parse 2.4 在更低版本上无法运行），版本过低时会直接报错退出。
> 首次部署可通过环境变量 `DEFAULT_ADMIN_USERNAME` 和 `DEFAULT_ADMIN_PASSWORD` 配置默认管理员账号，启动时自动创建超级管理员（仅当不存在超级管理员时生效）。未设置 `DEFAULT_ADMIN_PASSWORD` 时，首次启动会自动生成随机密码并**仅在后端控制台输出一次**（`start.bat` 隐藏窗口运行时输出在 `logs/backend.log`，丢失后可按 [DEPLOYMENT.md](DEPLOYMENT.md) 的「忘记超级管理员密码」FAQ 处理），请立即记录并登录修改（该账号同时被标记为需强制修改密码）。

### 首次部署检查清单

1. 安装 Node.js 22+（推荐 22 LTS）、npm 10+ 和 Git。
2. 执行 `npm run install:all` 安装根目录、后端和前端依赖。
3. 复制 `backend/.env.example` 为 `backend/.env`，必须修改 `JWT_SECRET`（缺失将导致服务无法启动），并配置 `CORS_ORIGIN`。
4. 可选：配置 `DEFAULT_ADMIN_USERNAME` 和 `DEFAULT_ADMIN_PASSWORD` 设置默认管理员账号（首次启动时自动创建；不设置密码时会生成随机密码，仅在控制台显示一次）。
5. 使用 `start.bat` 或 `npm run dev` 启动，确认前端 http://localhost:5173 和后端 http://localhost:5000 可访问。
6. 登录后进入系统设置，确认未登录查看、多设备登录、页面权限和数据导出功能符合部署要求。

### 手动启动

```bat
git clone https://gitee.com/caifugao110/obara-task-manager.git
cd obara-task-manager
npm run install:all
npm run dev
```

> 仓库同时镜像在 GitHub：`https://github.com/caifugao110/obara-task-manager.git`，可任选其一。GitHub 版本会触发 CI 自动构建控制台 EXE 并部署文档到 GitHub Pages。

## 主要页面

| 页面 | 路径 | 说明 |
|------|------|------|
| 主页面 | `/` | Excel 风格任务录入、拖拽移动、多选、复制、剪切、粘贴、撤销 |
| 任务报表 | `/leaderboard` | 仕样进度管理、枪名周期管理、月度工时与请假排行 |
| 工时管理 | `/work-hours` | 月度工时排行、请假排行、周末加班与出差明细 |
| 管理后台 | `/admin` | 设计人员列表、登录用户列表、批量导入 |
| 登录 | `/login` | 管理员和普通用户登录 |
| 修改密码 | `/change-password` | 首次登录或被重置密码后强制修改密码 |
| 系统设置 | `/system-settings` | 数据管理、数据库维护、登录管理、日志管理、计划管理五个标签页（数据库维护/登录管理/日志管理/计划管理仅超级管理员可见） |
| 操作日志 | `/system-logs` | 所有用户的操作日志明细和筛选 |
| 状态追踪 | `/status-tracking` | 任务状态追踪与批量导入导出 |
| 焊枪台账 | `/gun-ledger` | 焊枪编号台账：分类/表/行三级管理、焊枪名自动取号、表级独占编辑锁、分类导出与导入 |
| 设计规范知识库 | `/design-standards` | 基于本地 WeKnora 的规范检索与智能问答（带引用），知识库按 ID 关联，支持多工作空间与答复约束提示词 |

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
- 主页面日期表头支持管理员设置工作日覆盖规则：一般管理员和超级管理员将鼠标悬停在日期上时，可勾选“将今日设为普通工作日”或“将今日设为周末加班日”。未勾选时按自然周六/周日判断；勾选后主页面周末底色、底部周末加班统计、工时管理排行和工时导出表均按覆盖后的有效工作日/周末计算。
- **纳期更新功能：手动点击纳期更新时，将所有与该任务内容同一仕样号的计划任务一同更新或添加纳期（如果没有）。完成后提示已为多少个相同仕样号的计划任务添加纳期。**
- **任务字段变更采用 500ms 防抖保存机制，减少网络请求。**
- **支持 URL 参数直接跳转：`?date=YYYY-MM-DD&designerId=xxx&itemId=xxx` 可直接跳转到指定任务并自动选中和滚动定位。**
- **打开主页面时自动将“今日”任务列滚动到视图中央展示（所有用户，含未登录访客）。**
- **设计人员按分组显示，支持点击分组标题折叠/展开，状态保存在 localStorage。**
- **顶部下拉菜单可筛选显示特定设计人员或全部人员。**
- **任务列表会自动过滤掉无任务名且枪名全为空或"未命名"的无效任务，但在编辑模态框中仍能看到所有任务。**
- 快捷键提示：
  - `Ctrl+C`：提示"粘贴已准备"
  - `Ctrl+X`：提示"剪切已准备"
  - `Ctrl+V`：提示"任务已复制"
  - 无法撤销时提示"暂无可撤销操作"
- **支持 `Ctrl+Z` 撤销、`Ctrl+Y` 重做，同一用户最多保留 10 步撤销记录和 10 步重做记录。主页面所有操作（包括删除单个枪名）均可撤销。**
- **批量替换功能：支持在指定月份或全表范围内搜索并替换任务名和枪名中的文本，执行前可预览匹配结果。**
- **颜色标记功能：**
  - 开启系统设置中的「允许登录用户修改本人设计计划标记颜色」后，普通登录用户可在本人同名设计员的设计计划任务（含枪名单独行）上标记白色或恢复原色。
  - 管理员可通过任务编辑模态框直接为任意任务或枪名设置任意颜色。
  - 非管理员仅允许标记白色或恢复，后端会校验并拒绝其他颜色值。
  - 标记操作会通过 Socket.IO 实时同步到所有客户端，标记期间其他用户会看到「正在标记任务颜色」的占用提示。
  - 每个任务和枪名会记录 `colorMarkedBy`（标记者信息，系统自动标记为 `auto`），管理员悬浮任务时可查看。

### 离线模式

- 后端端口断开时自动检测（`ERR_NETWORK` / Socket 连接失败），立即从 localStorage 加载最近一次缓存的数据。
- 页脚绿色圆点变为红色，文字从"就绪"变为"离线"。
- 页面顶部显示橙色横幅："当前处于离线模式，正在使用本地缓存数据，网络恢复后将自动加载最新数据，此页面禁止刷新！"
- 首次断开时自动保存当前数据到浏览器 localStorage，同一次会话内不会重复保存。
- 刷新页面后如果后端仍不可用，直接使用缓存数据，不再弹出保存提示。
- 后端恢复后 Socket 自动重新连接，加载最新服务器数据，横幅和页脚状态恢复正常。
- 离线缓存数据仅用于离线浏览，不会覆盖服务器数据（服务器始终为权威来源）。

### 任务报表

- “仕样进度管理”支持按仕样号搜索（位数由系统设置 `specNumberDigits` 控制，5 或 6 位）。
- **“仕样进度管理”新增“获取仕样号所有枪名列表”开关，默认关闭。开启后，输入仕样号将显示该仕样号对应任务中的所有枪名，去除后缀L或R（不区分大小写）后进行去重处理，只列出唯一的枪名。**
- “枪名周期管理”支持按枪名搜索。
- 两个搜索区域都有“全表搜索”开关，默认关闭；开启后搜索所有月份。
- 搜索结果按日期从早到晚排序。
- 超级管理员可设置任务报表查看权限；未登录用户不能进入 `/leaderboard`，`allowViewers` 仅控制普通用户访问。
- “启用任务报表”关闭后，“一般管理员”和“普通用户”会自动关闭。
- “启用任务报表”打开后，“一般管理员”和“普通用户”会自动打开。
- “普通用户”打开时，“一般管理员”不能关闭，并会给出提示。

### 工时管理

- “月度工时排行”可开启“不包含周末加班”，重新按去除周末后的工时排行。这里的周末加班按主页面日期覆盖规则计算。
- 人员名称下方会显示周末加班工时，统计口径同主页面日期覆盖规则。
- 将鼠标悬停在人员上时可查看设计计划总工时、出差总工时、出差日期和每日出差工时。
- “月度请假排行”可开启“不包含休假”，重新按去除休假后的请假工时排行。
- 将鼠标悬停在人员上时可查看请假明细。
- 超级管理员可设置工时管理查看权限；未登录用户不能进入 `/work-hours`，`allowViewers` 仅控制普通用户访问。
- “启用工时管理”关闭后，“一般管理员”和“普通用户”会自动关闭。
- “启用工时管理”打开后，“一般管理员”和“普通用户”会自动打开。
- “普通用户”打开时，“一般管理员”不能关闭，并会给出提示。

### 管理后台

- “设计人员列表”用于维护主页面人员行。
- 设计人员姓名不允许重复。
- 设计人员为空时，超级管理员可一键初始化默认设计人员。
- 支持勾选多个设计人员后批量删除。
- “批量添加设计人员”支持从外部表格复制粘贴导入，并提供模板。
- 设计人员导入列：`name,group`。
- “登录用户列表”用于维护登录账号。
- 非超级管理员账号为空时，超级管理员可一键初始化默认登录用户。初始化时由浏览器加密随机数为每个账号生成 12 位随机初始密码，结果弹窗**仅展示一次**（支持一键复制分发），各账号首次登录后强制修改密码。
- 支持勾选多个登录用户后批量删除，不能批量删除超级管理员或当前登录账号。
- “批量添加登录用户”支持从外部表格复制粘贴导入，并提供模板。
- 登录用户导入列：`username,password,name,role`，不需要“分组”列。
- 登录用户角色支持 `superadmin`、`admin`、`user`。
- 一般管理员批量添加登录用户时会自动创建为普通用户。
- 批量导入会自动跳过重复数据，并显示导入耗时。

### 状态追踪

- 任务状态追踪页面支持查看、创建、编辑、删除状态追踪记录（添加记录仅管理员可用）。
- 月份筛选支持两种模式：按「添加时间月」或按「纳期月」筛选，并支持「全表搜索」开关（开启后忽略月份条件）。
- 支持按工厂筛选（如 `O/NJG`、`O/SHA`），以及关键词搜索（匹配客户名、仕样号、营业担当、组长）。
- 组长列按营业担当自动匹配组长规则填充。
- 管理员可「导出显示结果」为 `.xls`（按当前筛选条件导出），文件名格式为 `status-tracking-YYYYMMDDHHmmss.xls`；超级管理员可批量导入状态追踪数据，导入前支持「仕样号 + 添加时间月」组合重复检查，可选择覆盖导入。
- 支持按纳期月或添加时间月清理历史状态追踪记录（仅超级管理员，在系统设置「数据库维护」中操作）。
- 实时同步：数据变更通过 Socket.IO 广播通知所有客户端；编辑记录时其他人可见编辑占用提示。
- **「组长规则」入口在本页面**：管理员可见 teal 色「组长规则」按钮，弹窗内可查看/编辑组长归属关系，超级管理员可一键重置为默认规则。
- 超级管理员可设置状态追踪页面访问权限；未登录用户不能进入 `/status-tracking`，`allowViewers` 仅控制普通用户访问。

### 焊枪台账

焊枪台账页面（`/gun-ledger`）用于管理焊枪编号台账，采用**分类 → 表 → 行**三级结构。默认三大分类 `X2C`、`X2C-V2`、`X2C-V3`，每个分类下可包含多张表，每张表由多行组成，行字段包括：序号、焊枪名、客户、时间、担当、备注。

#### 分类与表管理

- 默认三大分类 `X2C`、`X2C-V2`、`X2C-V3` 不允许删除；管理员可新增/重排分类，超级管理员可删除非默认分类（会连同其下所有表一并删除）。
- 管理员可在分类下新增表、重命名表、重排表顺序；超级管理员可删除表。
- 一般管理员可以看到删除分类和删除表的按钮，但点击时会提示「删除分类属于高风险操作，需要超级管理员权限，请联系超级管理员删除」并阻止删除。
- 分类名限 1-30 字符且不含 `/`、`\`；表名限 1-50 字符，同一分类下表名唯一。

#### 行编辑与焊枪名自动取号

- 管理员打开某张表即获取该表的**独占编辑锁**（见下文「表级编辑锁」），可对行进行增删改；保存时行序号会被后端强制重排为严格连续的 `1..N`，杜绝跳号。
- 焊枪名支持**自动取号**：每张表可配置焊枪名生成规则 `{ enabled, prefix, start, pad }`，焊枪名 = `prefix + String(start + 序号 - 1).padStart(pad, '0')`。
  - 未单独配置规则的表，使用前端内置默认规则（按分类+表名匹配，如 `X2C/SRTC` → `SRTC-2C00000` 起）；无匹配则不自动取号。
  - 规则由超级管理员在「台账初始化」面板中按表配置，保存后通过 Socket.IO 广播。
- **「台账初始化」面板（仅超级管理员）为两级弹窗**：
  - 第一级为分类选择视图：列出所有分类卡片（每张卡片可单独「初始化本分类」），顶部有红色「一键初始化全部表格」按钮并显示分类数/表数/行数合计。
  - 第二级为分类详情视图：逐表展示规则卡片（取号开关/前缀/起始编号/补零位数/保存规则/单表初始化），顶部有「一键初始化本分类全部表格（N）」。
  - 批量初始化前弹出红色高危二次确认框；范围为单表、整个分类或全部分类。
  - **初始化语义：删除范围内所有表的全部真实行（`rows=[]`，连同焊枪名、客户、时间、担当、备注一并删除，不可恢复），各表恢复为全新状态**；前端随后只渲染 10 个预留行（序号 1-10），预留行枪名按生效规则（表级 `gunNameRule` → 前端内置默认模式）展示为该表的 10 个原始焊枪名，未启用自动取号时预留行枪名为空。
  - 范围内任一张表正被他人编辑时整体拒绝（`409`，返回 `locked` 数组列出被占用表与持有人），不做部分初始化；一次写入数据库，并逐表广播 `update_rows`（`rows: []`）。
- 焊枪名编辑只影响当前行，不改变行顺序；行按 `serialNumber` 稳定排序，编辑时输入框不会因重排而重建失焦。

#### 表级独占编辑锁

- 每张表同一时刻只允许一名用户编辑（按 `userId` 判定，同一用户多标签页共享一把锁）。
- 打开表时通过 Socket.IO 申请锁；被他人占用时无法打开，并提示当前编辑者姓名。
- 锁通过 Socket 生命周期 + 心跳维持：断开连接移除引用，引用归零即释放；心跳超过 60 秒且无存活连接的锁由后台每 30 秒清理一次。
- 持有者完成编辑或切换表时释放锁；表被删除/分类被删除/导入覆盖时会强制释放锁。
- 未取得编辑锁的用户只能以只读方式查看表内容。

#### 默认担当人员

- 系统内置默认担当人员名单（`张啸`、`张明`、`陈青松`、`陈大仪`），作为「担当」列的下拉候选。
- 超级管理员可在「台账初始化」面板中修改默认担当人员，也可一键重置为系统默认。

#### 导入与导出

- **分类导出**（页面入口）：选择一个或多个分类导出；单个分类导出为单个 `.xls` 工作簿，多个分类打包为 `.zip`（每个分类一个独立 `.xls`）。每张表对应工作簿中的一个工作表，列顺序为「序号/焊枪名/客户/时间/担当/备注」，表头蓝色、斑马纹、完整边框。
- **系统设置 → 数据管理 → 焊枪编号台账**：按分类导入/导出。导入时工作簿内的每个工作表会成为目标分类下的一张表，并**覆盖目标分类下全部表**；目标分类不存在时自动新建。导入仅超级管理员可用。
- **每日编号台账导出**（系统设置 → 数据库维护）：开启后每日定时将所有分类导出为单个 `.xls`（每分类一个工作表），独立保留天数与目录可配置（默认 30 天，目录 `backups/gun-ledger-exports/`）。

#### 离线模式

- 后端断开时页面顶部显示橙色横幅「此页面禁止编辑」，所有写操作（保存行、新增表、删除、导入等）被拦截并提示「当前离线，禁止编辑」。
- 离线期间所有管理类弹窗自动关闭，表保持只读可打开。
- 网络恢复后自动重新拉取台账数据并重新申请当前表的编辑锁。

### 设计规范知识库

设计规范知识库页面（`/design-standards`）基于本地 Docker 部署的 [Tencent/WeKnora](https://github.com/Tencent/WeKnora) 知识库（问答走 DeepSeek API、向量化走智谱 API），提供三个功能标签：

- **规范检索**：关键词检索知识库中的规范条款，显示命中方式（向量检索/关键词等）与相关度得分；
- **智能问答**：基于检索结果流式生成回答（SSE），并附带引用出处；
- **知识库管理**（一般管理员及以上）：按知识库 ID 关联/取消关联知识库，并只读查看各库文档清单与解析状态。

#### 知识库关联

- 知识库不再自动发现，需显式关联：在 WeKnora 控制台（http://localhost/platform/knowledge-bases）打开目标知识库并复制其 ID，回到本页面「知识库管理 → 关联知识库」粘贴 ID，后端校验通过后保存到项目数据库（`settings.designStandardsLinkedKbIds`）。
- 取消关联仅移除本系统的关联记录，**不会删除 WeKnora 中的知识库**；文档的上传、删除等管理操作统一在 WeKnora 控制台进行。

#### 检索/问答范围

- 「规范检索」与「智能问答」各有一个**知识库范围多选下拉框**，从已关联知识库中勾选；未勾选时无法提交（红色提示），支持全选。
- 下拉项显示文档篇数；接入多个工作空间时，每个库带紫色工作空间标签。
- 问答范围变更后自动开启新会话，避免沿用旧会话的检索范围。

#### 多工作空间（多租户）

- WeKnora 的 API Key 按工作空间隔离，一个 Key 只能访问所属空间的知识库。后端支持配置多个 Key：主 Key `WEKNORA_API_KEY` + 其他空间 Key `WEKNORA_EXTRA_API_KEYS`（英文逗号分隔）。
- **规范检索支持跨工作空间**：后端按空间分组并行检索，合并后按相关度排序。
- **智能问答不支持跨工作空间**：WeKnora 会话是空间级资源；所选知识库跨越多个空间时显示琥珀色提示并禁用发送，后端在 SSE 建连前返回 `400`（`WEKNORA_MULTI_TENANT`）。
- 状态接口返回每个工作空间（Key）的可达性；某个 Key 失效时页面提示「部分工作空间无法访问」，不影响其他空间。

#### 答复约束提示词（仅超级管理员）

- 超级管理员可在页面底部「答复约束提示词」面板中按知识库配置系统提示词（支持 Markdown，可直接粘贴整篇 `.md` 或从文件导入，单条最长 20000 字符）。
- 仓库内置一份焊枪选型提示词模板 [`weknora/knowledge/焊枪选型规范答复约束提示词.md`](weknora/knowledge/焊枪选型规范答复约束提示词.md)，可直接复制粘贴到对应知识库的提示词输入框使用。
- 保存后后端在该知识库所属工作空间创建/更新一个绑定 KnowledgeQA 模型的**自定义智能体**，问答由该智能体承载，提示词完全替换 WeKnora 默认提示词；引用出处仍由系统单独渲染，不受影响。
- 一次问答选中多个知识库时，取所选范围内第一个已配置提示词的库生效；清空提示词会同步删除对应智能体；未配置提示词的知识库保持默认行为。

查看权限与工时管理页面一致（`settings.designStandards`），超级管理员可在页面底部配置一般管理员/普通用户的访问权限。WeKnora 的地址与 API Key 仅保存在后端 `backend/.env`（`WEKNORA_*`），前端统一经 `/api/design-standards/*` 代理访问。部署物料与文档全部内置在仓库 `weknora/` 目录（详见 [weknora/README.md](weknora/README.md) 与 DEPLOYMENT.md）。

### 系统设置

系统设置页面包含「数据管理」「数据库维护」「登录管理」「日志管理」「计划管理」五个标签页。其中「数据库维护」「登录管理」「日志管理」「计划管理」仅超级管理员可见；「数据管理」对一般管理员的开放程度由系统设置页面权限控制。

#### 数据管理

- **任务管理**：导出渲染后的任务 `.xls` 表格，文件名格式为 `obara-tasks-YYYY-MM-DD-HHmmss.xls`；导入任务数据时必须使用系统导出的 `.xls` 格式，每次只能选择一个月份覆盖导入。导入只解析任务内容/工时列，`当日合计` 和 `月总工时` 不导入，由系统重新计算。导入月份天数与表格天数不一致时，多出来的日期列会被截断，缺少的日期会按空数据处理。导入表格中新增的设计员不会自动创建，会跳过并在结果中提示。导入仅超级管理员可用；导出超级管理员始终可用，一般管理员需在系统设置权限中放行（仅导出，不能导入）。
- **状态跟踪表**：按筛选条件导出状态追踪数据为 `.xls`（导出入口在状态追踪页面），文件名格式为 `status-tracking-YYYYMMDDHHmmss.xls`。仅超级管理员可导入，支持「仕样号 + 添加时间月」重复检查和覆盖导入选项。
- **工时管理表**：按月份导出工时汇总数据为 `.xls`，文件名格式为 `work-hours-YYYY-MM.xls`。导出表格包含设计员、总工时、工作日工时、周末加班工时、出差工时、请假工时等列，按总工时倒序排列，冻结首行和首列。工作日工时和周末加班工时按主页面日期覆盖规则计算。
- **焊枪编号台账**：按分类导入/导出焊枪编号台账。导出时选择 1 个分类下载单个 `.xls`（每张表一个工作表），选择多个分类时打包为 `.zip`。导入时工作簿内的每个工作表会成为目标分类下的一张表，并覆盖目标分类全部表（目标分类不存在时自动新建）；导入仅超级管理员可用，导出受焊枪台账页面权限控制。

#### 数据库维护（仅超级管理员）

- 自动维护开关：启用自动维护、每日数据库备份、每日任务表格导出、每日编号台账导出、年度任务清理、断网自动备份。
- 可配置每日执行时间、备份保留天数、任务导出保留天数、编号台账保留天数、断网备份保留天数、年度检测月份、月初检测天数、任务保留年数。
- 可配置数据库备份目录、任务导出目录、编号台账导出目录、年度永久归档目录、断网备份目录。
- 手动维护操作：立即备份数据库、立即导出任务数据、立即导出编号台账、清理过期备份、执行年度清理检测、清空所有日志。
- 运行状态显示调度器下次执行时间、数据库与各备份目录绝对路径。
- 显示最近数据库备份、最近任务导出、最近编号台账导出、年度永久归档、最近断网备份各 5 个文件。
- 年度清理会先将待删除数据永久归档；断网备份在服务器关闭时（Ctrl+C、SIGTERM）自动触发。

#### 登录管理（仅超级管理员）

- 可配置未登录查看主页面、多设备同时在线，以及“允许登录用户修改本人设计计划标记颜色”。该颜色标记开关默认开启；开启后，普通登录用户可在本人同名设计员的设计计划任务上标记/恢复颜色。

#### 日志管理（仅超级管理员）

- 主页面显示最新 10 条管理员（超级管理员和一般管理员）的登录记录，包含账号、姓名、角色、IP、浏览器信息和结果。
- 点击「详细日志」进入操作日志页面（`/system-logs`），可查看所有用户的所有操作记录，支持按用户名、操作类型、HTTP 方法、IP、日期范围筛选，并支持导出 `.xls`。
- 操作日志自动记录所有已登录用户的 API 请求，包含操作描述、方法、路径、IP、浏览器信息、状态码、耗时等，最多保留 2000 条。
- 操作类型和描述均为中文，例如「添加任务」「更新任务」「移动任务」「重新排序设计员」「批量替换任务」等。
- 浏览器信息存储浏览器名称和版本号、操作系统和版本号、设备类型，但页面和导出表格中仅显示浏览器名称（如「Chrome」）。

#### 计划管理（仅超级管理员）

- 仕样号位数：设置全局仕样号位数（5 位或 6 位），影响主页面纳期提取、任务报表仕样进度搜索、状态追踪添加记录等所有仕样号输入与校验。默认 5 位，切换后立即生效并同步到所有页面。

> 组长规则配置不在系统设置页面，入口位于状态追踪页面（见上文「状态追踪」章节）。默认组长规则：
>
> - 陈大仪组：郭涛、王兴龙、王会永、李广亮
> - 张啸组：李守健、邓明江、贾银鑫、熊飞
> - 张明组：吴露鹭、茅舒、沈雨帆、张晟隽、刘知新、梁科研、吴方盛
> - 陈青松组：张广奇、李劲日、曹圩圩、许孟涵

## 权限模型

### 超级管理员 `superadmin`

- 查看和编辑所有任务。
- 管理设计人员、一般管理员和普通用户（包括禁用/启用账号）。
- 配置任务报表、工时管理、状态追踪、焊枪台账和系统设置。
- 导入导出系统数据（任务管理、状态跟踪表、工时管理表、焊枪编号台账）。
- 管理焊枪台账分类、表、行，配置按表焊枪名生成规则、执行台账初始化（焊枪名初始化/批量初始化）、管理默认担当人员。
- 关联/取消关联设计规范知识库，配置答复约束提示词。
- 查看最新管理员登录信息和详细操作日志。
- 配置未登录查看、多设备同时在线等系统设置。
- 强制重置任意用户密码（重置后用户下次登录需修改密码）。

### 一般管理员 `admin`

- 查看和编辑任务。
- 管理设计人员。
- 创建普通用户作为登录用户。
- 配置和管理组长规则。
- 可新增/重命名/重排焊枪台账分类与表、编辑行（打开表时获取表级独占编辑锁），但**不能删除分类或表**（会被拦截并提示需超级管理员权限）。
- 可关联/取消关联设计规范知识库并查看各库文档清单（文档的上传与删除在 WeKnora 控制台操作）。
- 是否可进入任务报表、工时管理、状态追踪、焊枪台账，取决于对应页面的“一般管理员”开关。
- 是否可进入系统设置数据管理模块，取决于系统设置页面的“一般管理员”开关（仅可查看导出，不能导入）。

### 普通用户 `user`

- 登录后可查看主页面。
- 首次登录或被重置密码后需修改密码。
- 是否可进入任务报表、工时管理、状态追踪，取决于对应页面的“普通用户”开关。
- 焊枪台账不允许普通用户访问（`gunLedger.allowViewers` 后端强制为 `false`）。

### 游客

- 在系统设置允许未登录查看时，可以查看主页面。
- 不能编辑任务。
- 不能进入任务报表、工时管理、状态追踪、焊枪台账、设计规范知识库页面。

## 数据存储

系统使用 **SQLite** 保存数据，默认文件为 `backend/data.db`（WAL 模式，运行时伴随 `data.db-wal` 和 `data.db-shm`）。数据以集合方式存储，主要集合：

| 集合 | 说明 |
|------|------|
| `users` | 登录用户列表，包含 `forcePasswordChange` 字段用于强制修改密码 |
| `designers` | 设计人员列表 |
| `tasks` | 按设计人员(`designerId`)、年月保存的任务表 |
| `loginLogs` | 登录历史，包含 IP、浏览器信息和登录结果，最多保留 2000 条 |
| `auditLogs` | 操作日志，记录所有已登录用户的 API 请求，最多保留 2000 条 |
| `statusTrackingItems` | 状态追踪记录 |
| `gunLedger` | 焊枪编号台账，包含 `categories`（分类→表→行三级结构）和 `defaultResponsiblePersons`（默认担当人员） |
| `settings` | 系统配置，包含页面权限、工作日覆盖、维护设置、已关联知识库（`designStandardsLinkedKbIds`）、答复约束提示词（`designStandardsPrompt`）等 |

> 如果存在遗留的 `backend/db.json`，后端首次启动时会**自动迁移**到 SQLite，并将原文件重命名为 `db.json.migrated-<时间戳>.bak`。

建议定期通过 `POST /api/system/maintenance/backup` 备份数据库，也可以通过系统设置导出 `.xls` 作为任务数据的补充备份。

## 常用命令

```bat
npm run install:all
npm run install:backend
npm run install:frontend
npm run dev
npm run dev:backend
npm run dev:frontend
npm run build
npm run build:frontend
npm start
npm run start:backend
npm run start:frontend
npm run lint
npm run lint:frontend
npm run test:backend
```

| 命令 | 说明 |
|------|------|
| `npm run install:all` | 安装根目录、`backend` 和 `frontend` 的依赖 |
| `npm run install:backend` | 仅安装 `backend` 依赖 |
| `npm run install:frontend` | 仅安装 `frontend` 依赖 |
| `npm run dev` | 同时启动开发后端和 Vite 前端 |
| `npm run dev:backend` | 仅启动后端开发服务（`nodemon server.js`） |
| `npm run dev:frontend` | 仅启动前端开发服务（`vite`） |
| `npm run build` | 构建前端生产产物（等同 `build:frontend`） |
| `npm run build:frontend` | 构建前端生产产物（`tsc && vite build`） |
| `npm start` | 启动后端生产服务（等同 `start:backend`，调用 `node server.js`） |
| `npm run start:backend` | 使用 `node server.js` 启动后端 |
| `npm run start:frontend` | 预览前端构建产物（`vite preview`） |
| `npm run lint` | 运行前端 ESLint 检查（等同 `lint:frontend`） |
| `npm run lint:frontend` | 对 `frontend/src` 下的 `ts/tsx` 文件运行 ESLint，未使用规则告警阈值为 0 |
| `npm run test:backend` | 后端测试入口（当前为占位脚本，会返回失败） |

其他脚本：

| 脚本 | 说明 |
|------|------|
| `start.bat` | Windows 一键启动前后端（隐藏窗口运行，日志输出到 `logs/` 目录，不打开浏览器）；启动前自动检查 Node.js 22+、执行 `git pull --rebase` 更新代码、检查并释放端口、按需安装依赖 |
| `start-hidden.vbs` | 后台静默启动（不显示命令行窗口） |
| `start-process-hidden.vbs` | 进程隐藏启动辅助脚本 |
| `stop.bat` | 停止前后端进程；停止前先调用断网备份接口备份数据库 |
| `control/ObaraServiceController.csproj` | 使用 MSBuild 构建 Windows 服务控制台 EXE，详见「Windows 服务控制台」章节 |

前端类型检查：

```bat
cd frontend
..\node_modules\.bin\tsc.cmd --noEmit
```

后端基础语法检查示例：

```bat
node --check backend\routes\system.js
node --check backend\routes\tasks.js
```

> 目前 `npm run test` 会调用后端占位测试脚本并返回失败；提交或部署前优先执行前端类型检查、前端 ESLint、后端语法检查和关键页面手动验证。

## 环境变量

所有配置项集中在 [backend/.env.example](backend/.env.example)，复制为 `backend/.env` 后按需修改。`JWT_SECRET` 为必填项，缺失会直接终止启动。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `5000` | 后端服务端口 |
| `NODE_ENV` | `development` | 运行环境（`development` / `production`） |
| `JWT_SECRET` | **必填** | JWT 签名密钥，生产环境必须修改为随机字符串 |
| `JWT_EXPIRES_IN` | `3d` | JWT 过期时间（默认 3 天；配合服务端会话吊销，登出/改密/禁用即时失效） |
| `JWT_ISSUER` | `obara-task-manager` | JWT 签发方 |
| `JWT_AUDIENCE` | `obara-task-manager-api` | JWT 接收方 |
| `DEFAULT_ADMIN_USERNAME` | `superadmin` | 默认管理员用户名（仅首次启动且无超管时生效） |
| `DEFAULT_ADMIN_PASSWORD` | 空 | 默认管理员密码；留空时首次启动自动生成随机密码并仅在控制台输出一次（隐藏窗口启动时见 `logs/backend.log`），显式设置时生产环境必须使用强密码并立即修改 |
| `RATE_LIMIT_WINDOW_MS` | `900000`（15 分钟） | 限流时间窗口配置（登录/改密独立限流器的阈值目前为代码内硬编码，未读取此变量） |
| `RATE_LIMIT_MAX` | `20` | 限流最大次数配置（同上，当前未被独立限流器使用） |
| `API_RATE_LIMIT_MAX` | `3000` | 全局 API 限流阈值：每个 IP 15 分钟内最大请求数，覆盖所有 `/api` 接口；`OPTIONS` 预检与本机环回请求不计数，超限返回 `429` |
| `SQLITE_DB_PATH` | `./data.db` | SQLite 数据库文件路径 |
| `DB_PATH` | `./db.json` | 遗留 JSON 数据库路径，仅首次启动时用于自动迁移到 SQLite |
| `SPEC_SHARE_PATH` | `\\192.168.160.6\仕样书$` | 仕样书 PDF 共享目录 |
| `CORS_ORIGIN` | `*`（未配置时） | 允许的前端地址，多个用逗号分隔 |
| `GITEE_TOKEN` | 空 | Gitee 个人访问令牌，用于版本检查 |
| `GITEE_REPO_OWNER` | `caifugao110` | Gitee 仓库所有者 |
| `GITEE_REPO_NAME` | `obara-task-manager` | Gitee 仓库名称 |
| `LOG_LEVEL` | `info` | 日志级别（预留变量：当前版本代码未读取，设置后不生效；日志输出到控制台与 `logs/` 下日志文件） |
| `WEKNORA_ENABLED` | `false` | 是否启用设计规范知识库接入 |
| `WEKNORA_BASE_URL` | `http://127.0.0.1:8080/api/v1` | WeKnora API 根地址 |
| `WEKNORA_API_KEY` | 空 | 主工作空间 API Key，仅服务端使用 |
| `WEKNORA_EXTRA_API_KEYS` | 空 | 其他工作空间 API Key，多个用英文逗号分隔 |
| `WEKNORA_TIMEOUT_MS` | `60000` | WeKnora 普通请求超时（毫秒） |
| `WEKNORA_KNOWLEDGE_BASE_IDS` | 空 | 预留兜底知识库 ID（逗号分隔）；当前页面始终显式传入选中的知识库 ID，该变量实际不参与检索/问答 |

> 修改 `.env` 后必须重启后端服务才能生效。

## 键盘快捷键

主页面支持以下键盘快捷键：

| 快捷键 | 功能 | 提示信息 |
|--------|------|----------|
| `Ctrl+C` | 复制选中的任务 | "粘贴已准备" |
| `Ctrl+X` | 剪切选中的任务 | "剪切已准备" |
| `Ctrl+V` | 粘贴任务 | "任务已复制" |
| `Ctrl+Z` | 撤销操作 | "暂无可撤销操作"（无操作时） |
| `Ctrl+Y` | 重做操作 | "暂无可重做操作"（无操作时） |
| `Delete` | 删除选中的任务 | - |

说明：
- 选中任务后，按住 `Ctrl` 可选择多个任务。
- 多选任务支持拖拽移动、剪切、复制、粘贴。
- 按住 `Ctrl` 键拖拽任务到目标单元格，会执行批量复制操作而非移动操作。
- 同一用户最多保留 10 步撤销记录和 10 步重做记录。
- `Delete` 删除操作也可通过 `Ctrl+Z` 撤销。

## 仕样信息搜索

系统支持从共享目录读取仕样书 PDF 文件，提取纳期和详细信息：

- 搜索路径：默认 `\\192.168.160.6\仕样书$\`，可通过 `SPEC_SHARE_PATH` 配置
- 支持按仕样号搜索（位数由系统设置 `specNumberDigits` 控制，5 或 6 位），自动查找最新版本（如 `12345.PDF`、`12345.01.PDF` 等）
- 可提取纳期、中间商、最终客户、项目名称、数量、营业担当等信息
- 纳期获取超时时间为 9 秒，完整信息获取超时时间为 15 秒
- **注意**：仕样书共享路径可在 `backend/.env` 中通过 `SPEC_SHARE_PATH` 修改，修改后需重启后端服务。

## 强制修改密码

系统支持首次登录强制修改密码机制：

- 新建登录用户首次登录时必须修改密码（首次启动自动创建的超级管理员同样如此）。
- 超级管理员重置任意用户密码后，该用户下次登录需修改密码。
- 已存在的非超级管理员账号在系统升级后会自动标记为需要修改密码。
- **API 层强制拦截**：`forcePasswordChange` 标记未清除前，除「修改密码」和「退出登录」外的所有 API 调用一律返回 `403`（`code=FORCE_PASSWORD_CHANGE`），防止绕过前端页面直接调用接口。
- 修改密码页面为 `/change-password`，未提示修改密码时访问会自动跳转回主页。

## 操作日志

系统自动记录所有已登录用户的 API 请求作为操作日志：

- 日志包含操作描述、HTTP 方法、路径、IP、浏览器信息、状态码、耗时、请求体和响应消息。
- 操作类型和描述均为中文，例如「用户登录」「添加任务」「更新任务」「删除任务」「移动任务」「重新排序设计员」「批量替换任务」「导出任务数据」「导入任务数据」等。
- 浏览器信息存储浏览器名称和版本号、操作系统和版本号、设备类型，但页面和导出表格中仅显示浏览器名称（如「Chrome」）。
- GET 请求不记录响应消息（避免存储大体积任务数据），POST/PUT 请求记录请求体（最大 2000 字符）。
- 操作日志最多保留 2000 条，超过自动清理最旧记录。
- 仅超级管理员可在「操作日志」页面查看，支持按用户名、操作类型、HTTP 方法、IP、日期范围筛选，并支持导出 `.xls`。
- 筛选下拉框中的操作类型按拼音排序。
- 仅登录日志查询（`/api/system/login-logs*`）与操作日志查询/导出（`/api/system/audit-logs*`）接口本身不记录操作日志，避免日志自我膨胀；系统设置变更、维护操作等其他接口（如 `PUT /api/system/settings`）均正常记录。

## 安全配置

系统使用集中的安全配置文件管理敏感信息，所有配置项均可通过环境变量设置。安全配置集中在 `backend/config/security.js`，包含 JWT 配置、CORS 配置、Gitee API 配置、数据库路径配置和服务器配置。

### 安全增强特性

- **JWT_SECRET 强制校验**：服务启动时强制校验 `JWT_SECRET` 配置，缺失则直接终止启动并输出错误提示。JWT 默认有效期 3 天（`JWT_EXPIRES_IN`），配合服务端会话吊销机制，登出/改密/禁用后旧令牌立即失效。
- **全局 API 限流**：所有 `/api` 接口共享每 IP 15 分钟 3000 次的全局限流（可用 `API_RATE_LIMIT_MAX` 调整，`OPTIONS` 预检与本机环回请求不计数）；登录接口另有 15 分钟 20 次的独立限流（按「IP + 用户名」计数），修改密码接口另有 15 分钟 5 次的独立限流（按「用户 ID」计数），兼容内网多人共用同一代理出口的场景。超限统一返回 `429`。
- **请求体敏感信息脱敏**：操作日志记录时递归脱敏（支持嵌套对象与数组），字段名匹配 `password`/`passwd`/`secret`/`token`/`api_key`/`apikey`/`authorization`（不区分大小写）一律显示为 `[REDACTED]`。
- **真实 IP 防伪造**：`trust proxy` 设为 `loopback`，仅信任本机回环代理转发的 `X-Forwarded-For`；外部直连请求伪造的 XFF 不会被采信，登录/操作日志的 IP 与限流计数均以 `req.ip`（Socket 对端地址）为准。
- **收敛 CSP 响应头**：后端启用 Helmet 内容安全策略（资源仅限同源加载、禁用插件、禁止页面被嵌入框架），作为纵深防御；CORS 为通配符时自动不启用 credentials。
- **强制改密 API 拦截**：未修改初始密码的用户除「修改密码」「退出登录」外的所有 API 调用一律返回 `403`（`FORCE_PASSWORD_CHANGE`）。
- **路径遍历攻击防护**：仕样书 PDF 路径参数进行严格校验，禁止 `..`、`/`、`\`、`:` 等特殊字符，同时检测 URL 编码（如 `%2e%2e`）和 Unicode 编码（如全角句号 `．．`）等绕过手段，确保只能访问允许的共享目录。
- **密码修改安全**：修改密码接口添加限流（15 分钟内最多 5 次尝试）和参数校验，修改成功后返回新的 JWT Token 并更新 sessionId，使旧 Token 失效。
- **登录失败全量留痕**：登录成功与失败（含用户不存在、密码错误、账号禁用，失败原因记录在 `reason` 字段）均写登录日志，且「用户不存在」与「密码错误」返回相同文案，避免用户枚举。
- **Excel 依赖本地化**：Excel 解析使用随仓库分发的 SheetJS `xlsx@0.20.3`（`backend/vendor/xlsx-0.20.3.tgz`，以 `file:` 协议安装），修复旧版 0.18.5 的原型污染（CVE-2023-30533）与正则拒绝服务（CVE-2024-22363）漏洞，且内网安装无需再从 npm 拉取该包。
- **Socket.IO 认证**：WebSocket 连接建立时强制验证 JWT Token，支持从 `socket.handshake.auth.token` 或 `Authorization` 请求头获取令牌，验证失败则拒绝连接。同时支持单设备登录限制，当 `allowMultiDevice=false` 时，已登录用户在其他设备登录会使旧连接失效。

详细的环境变量配置、版本检查机制和安全加固建议，请参考 [Windows 部署指南](DEPLOYMENT.md)。

## 项目结构

```text
obara-task-manager/
├── .github/workflows/
│   └── build-and-deploy.yml      # EXE 构建 + GitHub Pages 部署
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
│   │   ├── auth.js
│   │   └── socketAuth.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── designers.js
│   │   ├── designStandards.js
│   │   ├── gunLedger.js
│   │   ├── settings.js
│   │   ├── spec.js
│   │   ├── statusTracking.js
│   │   ├── system.js
│   │   ├── tasks.js
│   │   ├── users.js
│   │   └── workHours.js
│   ├── templates/
│   │   └── spec-pdf/
│   ├── tests/
│   │   └── pdf/
│   ├── utils/
│   │   ├── auditLogDisplay.js
│   │   ├── dbMaintenance.js
│   │   ├── exportWorkbook.js
│   │   ├── fileUploadSecurity.js
│   │   ├── gunLedgerExport.js
│   │   ├── gunTableLocks.js
│   │   ├── simpleZip.js
│   │   ├── taskExportWorkbook.js
│   │   ├── weknora.js
│   │   └── workday.js
│   └── vendor/                    # 本地 vendor 依赖（随仓库分发，离线可装）
│       └── xlsx-0.20.3.tgz        # SheetJS xlsx 0.20.3（file: 协议安装，修复 0.18.5 安全漏洞）
├── control/                      # .NET Framework 4.8 服务控制台（WinForms EXE）
│   ├── .gitignore                # 控制台子项目的忽略规则
│   ├── App.config
│   ├── ObaraServiceController.csproj
│   ├── Program.cs
│   ├── MainForm.cs
│   ├── MainForm.Designer.cs
│   ├── ConfirmDialog.cs
│   ├── Models/
│   │   └── ServiceConfig.cs
│   ├── Properties/
│   │   ├── AssemblyInfo.cs
│   │   └── GeneratedVersion.cs   # 构建时由 MSBuild 自动生成，勿手工编辑
│   ├── Resources/
│   │   └── app.ico
│   └── Utils/
│       ├── PathResolver.cs
│       ├── PortChecker.cs
│       ├── ProcessManager.cs
│       └── ThemeColors.cs
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
│       │   ├── AuthContext.tsx
│       │   └── SystemSettingsContext.tsx
│       ├── hooks/
│       │   ├── index.ts
│       │   ├── useSocket.ts
│       │   └── useTasks.ts
│       ├── pages/
│       │   ├── Admin.tsx
│       │   ├── ChangePassword.tsx
│       │   ├── Dashboard.tsx
│       │   ├── DesignStandards.tsx
│       │   ├── GunLedger.tsx
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
│           ├── loginLogs.ts
│           ├── redirect.ts
│           └── workdayOverrides.ts
├── weknora/                      # WeKnora 知识库服务（Docker Compose 本地部署）
│   ├── .env.example              # 环境变量模板（真实 .env 由脚本生成，不入库）
│   ├── README.md                 # WeKnora 部署与初始化说明
│   ├── config/
│   │   └── config.yaml
│   ├── knowledge/                # 知识库源数据（X2C 系列焊枪数据表 6 份 .xlsx + 焊枪选型答复约束提示词模板）
│   ├── scripts/
│   │   ├── gen-env.js            # 生成 .env 的辅助脚本
│   │   └── setup.js              # 一键初始化部署脚本
│   ├── docker-compose.yml
│   ├── start.bat
│   └── start.sh
├── .gitignore
├── .npmrc                       # ignore-scripts=true：跳过 install 脚本，免安装 VS C++ 生成工具
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

### 核心模块说明

| 模块 | 路径 | 说明 |
|------|------|------|
| 前端 API 服务层 | `frontend/src/services/api.ts` | 统一管理所有 API 调用，封装认证、用户、设计人员、任务、设置和系统维护接口 |
| 类型定义 | `frontend/src/types/index.ts` | TypeScript 类型定义，包含用户、任务、设计人员、报表等核心类型 |
| 认证中间件 | `backend/middleware/auth.js` | JWT 认证、角色校验、游客访问控制 |
| Socket.IO 认证 | `backend/middleware/socketAuth.js` | WebSocket 连接认证和单设备登录限制 |
| 操作日志 | `backend/middleware/auditLog.js` | 自动记录所有已登录用户的 API 请求 |
| 数据库维护 | `backend/utils/dbMaintenance.js` | 自动备份、任务导出、断网备份、年度清理等维护功能 |
| 文件上传安全 | `backend/utils/fileUploadSecurity.js` | Excel 文件类型验证、结构检查、恶意内容扫描 |
| 任务导出 | `backend/utils/taskExportWorkbook.js` | 任务数据导出为 Excel 格式 |
| 焊枪台账导出 | `backend/utils/gunLedgerExport.js` | 焊枪编号台账按分类/全部分类导出为 Excel（含样式、斑马纹、边框） |
| 焊枪台账表锁 | `backend/utils/gunTableLocks.js` | 表级独占编辑锁的内存态管理（申请/释放/心跳/僵死锁清理） |
| 压缩打包 | `backend/utils/simpleZip.js` | 多分类导出时将多个 `.xls` 打包为 `.zip` |
| 工作日工具 | `backend/utils/workday.js` | 工作日覆盖规则、周末判断等工具函数 |
| 安全配置 | `backend/config/security.js` | JWT、CORS、Gitee API、数据库路径等安全配置 |
| WeKnora 客户端 | `backend/utils/weknora.js` | 多工作空间 API Key 注册表、知识库关联解析、跨空间检索扇出合并、SSE 流式问答、答复约束智能体管理 |
| WeKnora 部署物料 | `weknora/` | Docker Compose 编排、初始化脚本、知识库源数据与答复约束提示词 |
| 服务控制台 | `control/ObaraServiceController.csproj` | .NET Framework 4.8 WinForms 程序，用于在 Windows 上控制服务启停、监控端口与一键打开浏览器界面 |
| 路径解析 | `control/Utils/PathResolver.cs` | 从 EXE 目录向上查找 `backend/` 与 `frontend/`，绑定运行路径，不硬编码绝对路径 |
| 端口检测 | `control/Utils/PortChecker.cs` | 实时探测前后端端口状态与延迟，用于状态卡片刷新 |
| 进程管理 | `control/Utils/ProcessManager.cs` | 启停后端 / 前端进程，自动安装依赖，转发子进程输出到日志区；同时提供健壮的 node.exe 路径发现与版本检测 |
| 构建版本生成 | `control/ObaraServiceController.csproj` | MSBuild 编译前自动生成 `Properties/GeneratedVersion.cs`，版本号按构建日期生成，无需手工维护 |
| 控制台主题 | `control/Utils/ThemeColors.cs` | 暗色科技风 UI 配色与渐变定义 |
| CI/CD | `.github/workflows/build-and-deploy.yml` | 自动构建控制台 EXE 并发布 Release，同时把 README 与 docs/ 部署到 GitHub Pages |

## 数据库维护

系统内置自动维护功能，可通过 API 或配置管理数据库备份、任务导出、断网备份和年度数据清理。

### 自动维护

自动维护在每日指定时间（默认 `00:30`）执行以下任务：

| 任务 | 说明 | 默认状态 |
|------|------|----------|
| 数据库备份 | 使用 SQLite 在线备份 API 生成 `.db` 一致性快照 | 启用 |
| 任务数据导出 | 导出渲染后的任务表为 `.xls` 文件（`task-export-YYYYMMDD-HHmmss.xls`） | 启用 |
| 编号台账导出 | 导出全部焊枪编号台账为单个 `.xls`（每分类一个工作表），文件名 `gun-ledger-all-YYYYMMDD-HHmmss.xls` | 启用 |
| 过期备份清理 | 删除超过保留天数的旧备份（含数据库备份、任务导出、编号台账导出和断网备份目录） | 自动执行 |
| 年度任务清理 | 在指定月份自动清理超过保留年限的旧任务数据 | 启用 |

### 断网备份

断网备份（offline backup）是服务关闭前的快速备份机制，独立于定时备份：

- 触发时机：后端收到 `SIGINT`/`SIGTERM` 信号（即 `Ctrl+C` 或服务停止）时，会先创建一次断网备份再退出。
- 防抖机制：同一次会话内 5 分钟内只生成一次，避免短时间内重复备份。
- 存储位置：独立目录 `backups/offline/`，便于与日常备份区分。
- 备份文件名：
  - 关闭触发：`offline-backup-shutdown-{YYYYMMDD-HHmmss}.db`
  - 用户触发：`offline-backup-{userId}-{username}-{YYYYMMDD-HHmmss}.db`
- 可通过 `POST /api/system/maintenance/offline-backup` 主动触发：本机环回地址（localhost）可匿名调用（供 stop.bat 等运维脚本），非环回请求须为超级管理员。

### 维护配置

默认配置：

```json
{
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
}
```

说明：
- 年度清理会在指定月份（默认 1 月）的前 N 天（默认 10 天）内执行。
- 清理前会将旧数据归档到年度归档目录，保留完整备份。
- 每年只执行一次，记录在 `yearlyCleanupHistory` 中。
- 断网备份默认保留 7 天，超过自动清理。

### 手动维护操作

超级管理员可通过以下 API 手动执行维护操作：

| 操作 | API | 说明 |
|------|-----|------|
| 数据库备份 | `POST /api/system/maintenance/backup` | 立即创建数据库备份 |
| 断网备份 | `POST /api/system/maintenance/offline-backup` | 立即创建断网备份（本机环回匿名；外部请求需超级管理员） |
| 任务导出 | `POST /api/system/maintenance/export-tasks` | 立即导出任务数据 |
| 编号台账导出 | `POST /api/system/maintenance/export-gun-ledger` | 立即导出全部焊枪编号台账为单个 `.xls` |
| 清理过期备份 | `POST /api/system/maintenance/cleanup-backups` | 清理超过保留天数的备份 |
| 年度清理 | `POST /api/system/maintenance/yearly-cleanup` | 执行年度任务清理，请求体传 `{"force": true}` 可跳过时间检查强制执行 |
| 清空所有日志 | `POST /api/system/maintenance/clear-logs` | 同时清空登录日志和操作日志 |
| 清理指定月份任务 | `POST /api/system/maintenance/cleanup-tasks` | 请求体 `{month, year}` 或 `{beforeMonth, beforeYear}` |
| 清空登录日志 | `DELETE /api/system/cleanup/login-logs` | 清空所有登录日志 |
| 清空操作日志 | `DELETE /api/system/cleanup/audit-logs` | 清空所有操作日志 |
| 清理旧任务 | `DELETE /api/system/cleanup/old-tasks?keepMonths=12` | 清理指定月份之前的任务数据 |
| 清理旧状态追踪 | `DELETE /api/system/cleanup/status-tracking?keepMonths=24` | 按保留月数清理旧状态追踪数据 |
| 清理状态追踪记录 | `POST /api/status-tracking/cleanup` | 按时间点清理状态追踪记录，请求体 `{beforeMonth, beforeYear, mode?}`，`mode=delivery` 按纳期月清理，缺省按添加时间月清理 |

### 数据库统计

`GET /api/system/db-stats` 返回数据库统计信息：

- 逻辑数据大小（所有集合序列化后的字节/KB/MB）
- SQLite 物理存储信息：引擎、驱动、journal 模式，以及 `data.db`/`data.db-wal`/`data.db-shm` 三个文件的大小
- 用户、设计人员、任务、日志等数据条数
- 警告信息（逻辑数据超过 10MB/50MB、数据超过 24 个月，仅为提示非硬限制）

## 维护建议

- 定期通过 `POST /api/system/maintenance/backup` 备份 `backend/data.db`，并在执行升级或批量导入前额外备份一次。
- 生产环境必须修改 `backend/.env` 中的 `JWT_SECRET`，并限制 `CORS_ORIGIN`。
- 公网部署时建议关闭未登录查看，并根据需要关闭多设备同时在线。
- 大批量导入前先在测试环境验证表格格式，确认设计人员列表已提前维护完成。
- 排障时优先查看后端控制台、浏览器 DevTools 网络请求、系统设置中的登录日志和操作日志。
- 监控数据库大小：`db-stats` 中 10MB/50MB 仅为提示性警告而非 SQLite 限制（SQLite 单库上限约 281TB，1GB 以内均可稳定运行），可结合任务月份数决定是否清理旧数据，必要时对数据库执行 `VACUUM` 回收空间。
- 建议启用自动维护，并根据业务需求调整备份保留天数和数据保留年限。

## Windows 服务控制台

系统提供基于 .NET Framework 4.8 的 WinForms 桌面控制台 `control/ObaraServiceController.csproj`，用于在 Windows 上一键管理前后端服务，无需手动开多个命令行窗口。

### 功能

- 服务启停：单独启停后端 / 前端，或一键启动、一键停止。
- 实时监控：定时探测前后端端口（默认 2 秒一次），显示进程 PID、端口延迟和运行 / 停止 / 异常状态。
- 端口配置：可在界面修改前后端端口并持久化到本地配置（默认后端 `5000`、前端 `5173`）。
- 路径绑定：自动从 EXE 所在目录向上查找 `backend/` 与 `frontend/`，**不硬编码绝对路径**，整个项目目录移动后仍可直接使用。
- 一键打开浏览器：点击「打开浏览器」可直接访问运行中的前端界面。
- 依赖自动安装：首次启动服务时若依赖缺失会自动执行 `npm install`。
- 数据库迁移状态检测：启动后端前自动检测遗留 `db.json` → SQLite（`data.db`）的迁移状态（待迁移 / 已完成 / 无需迁移），并在日志区输出说明。
- Node.js 环境检测：复用 `ProcessManager` 的健壮发现逻辑（PATH 扫描、`node.exe` 探测、`npm.cmd` 解析和 AppData 回退），检测失败时输出具体原因，避免误报「Node.js 未安装」。
- 日志显示：实时输出前后端子进程日志，支持清空。
- 配置持久化：端口与监控间隔保存在本地配置文件，重启后自动加载。
- UI 风格：暗色科技风（自定义 `ThemeColors`），双缓冲优化，避免鼠标悬停卡顿；标题栏与确认对话框针对高 DPI 优化。

### 构建版本自动生成

控制台版本号**按构建日期自动生成**，无需手工维护：

- 标题栏副标题显示的版本取自 EXE 文件自身的最后写入时间（即链接器写盘时间），每次重新构建自动更新为构建当天日期。
- MSBuild 在每次编译前通过 `GenerateVersionFile` 目标自动生成 `control/Properties/GeneratedVersion.cs`，写入 `AssemblyVersion` / `AssemblyFileVersion` / `AssemblyInformationalVersion` 三个属性（格式 `yyyy.M.d.0`），保证 Windows 文件属性「详细信息」页显示的版本与标题栏一致。
- `AssemblyInfo.cs` 和 `.csproj` 中的版本字段仅保留占位值，构建时会被覆盖。

### 构建产物

| 文件 | 说明 |
|------|------|
| `control/bin/Release/Obara-Task-Management-Service-Console.exe` | 控制台主程序，可直接双击运行 |
| `control/bin/Release/*.config` | 运行时配置文件，随主程序一起分发 |

> 控制台 EXE 不依赖前后端代码，只通过运行进程的方式调用 `npm`/`node`，因此可单独拷贝到任意位置使用，但建议与项目根目录（包含 `backend/` 和 `frontend/`）放在同一目录。

### 本地构建

需要在 Windows 上安装 .NET Framework 4.8（Windows 10/11 自带）。使用 MSBuild 构建：

```bat
cd control
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\MSBuild.exe ObaraServiceController.csproj /p:Configuration=Release /t:Build
```

构建完成后产物位于 `control/bin/Release/`。构建时 MSBuild 会自动生成 `Properties/GeneratedVersion.cs` 写入当日版本号，无需手工修改。`control/.gitignore` 文件用于排除 `bin/`、`obj/` 等中间产物，避免提交到版本库。

### 自动构建

控制台 EXE 由 GitHub Actions 自动构建并发布到 Release，详见下文 CI/CD 章节。

## CI/CD

项目通过 `.github/workflows/build-and-deploy.yml` 实现自动构建与文档部署：先运行变更检测任务（按改动路径过滤），再按需条件执行 EXE 构建和文档部署两个任务。

### 触发条件

- 推送到 `main` 分支，且改动了 `control/**`（触发 EXE 构建）或 `README.md`、`docs/**`、`.github/workflows/build-and-deploy.yml`（触发文档部署）。
- 推送 `v*` 形式的 tag（正式版本）。
- 手动触发（`workflow_dispatch`）。

### 任务一：构建控制台 EXE

- 运行环境：`windows-latest`。
- 自动生成动态版本号：tag 推送时使用 tag 名；常规推送时生成 `vYYYY.MM.DD-beta-N` 形式的版本号，避免重复。
- 自动生成变更日志：取当前提交的提交信息（单条），作为 Release 说明。
- 使用系统自带的 .NET Framework 4.8 MSBuild 构建 `ObaraServiceController.csproj`，并自动写入 `AssemblyInfo.cs` 的版本字段（`AssemblyInformationalVersion` 不带 `v` 前缀）。
- 构建完成后清理 `obj/` 中间产物，并将 `bin/Release/` 打包为 `Obara-Task-Management-Service-Console_<version>.zip`，以 Release Assets 附件形式发布。
- 推送到 `main` 时自动创建 git tag 与 GitHub Release；推送 `v*` tag 时直接创建对应 Release。
- Release 正文包含中文说明、变更日志和功能列表，下载请从 Release 页面的 Assets 获取。

### 任务二：部署文档到 GitHub Pages

- 运行环境：`ubuntu-latest`。
- 将 `README.md` 复制为 `index.md`，连同 `docs/` 目录一起部署到 GitHub Pages。
- 自动创建 `.nojekyll` 以保留原始目录结构。
- 部署完成后可通过 GitHub Pages URL 访问在线文档。

### 版本号规则

| 触发方式 | 版本号格式 | 示例 |
|----------|------------|------|
| 推送 `v*` tag | tag 名 | `v1.2.3` |
| 推送到 `main` | `vYYYY.MM.DD-beta-N` | `v2026.08.19-beta-1` |

> 推送到 `main` 时若当日多次提交，`N` 会自动递增，避免 tag 冲突。

## License

MIT License

---

最后更新：2026-09-26
