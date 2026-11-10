# 变更记录

> 其他文档：[README](README.md) · [文档中心](docs/README.md) · [开发者指南](docs/DEVELOPMENT.md) · [Windows 部署指南](docs/DEPLOYMENT.md)

本文件由 **git 提交历史**汇总生成（`git log --date=short --pretty=format:'%ad|%s'`），不是手工维护的流水账：

- 按提交日期倒序、月份分组；条目内容与提交信息一致，未做改写，便于用 `git show` 回溯。
- 条目前缀沿用 Conventional Commits 的 `type(scope):`，含义见 [开发者指南 · 提交与发版](docs/DEVELOPMENT.md#7-提交与发版)。
- **系统版本号不来自本文件**：`GET /api/system/version` 按「最后一次提交日期 + 当日提交计数」动态计算（规则见 [DEPLOYMENT.md · 版本检查](docs/DEPLOYMENT.md#版本检查)）。
- 控制台 EXE 的发布版本由 CI 按日期生成并打 tag，见 [README · CI/CD](README.md#cicd)。

---

## 2026-11

### 2026-11-09

- feat(tasks): 添加后端假死检测与子进程隔离机制
- feat(tasks): 添加任务列宽自适应与枪名删除二次确认

### 2026-11-08

- docs: 新增运维工具文档并同步所有文档链接路径

### 2026-11-06

- refactor(tasks): 优化仕样号提取逻辑避免尾部项目代码干扰
- feat(gun-ledger): 新增焊枪规格字段并扩展投影枪分类

### 2026-11-05

- feat: 新增修改密码弹窗与改密页的密码强度条及入场动效
- feat: 实现弹窗拖动功能并优化样式
- feat(statusTracking): 修复中文输入法打字被打断的问题
- feat: 重构状态跟踪表，移除添加时间月份筛选并新增自动定位功能
- feat(tasks): 优化 Space×2 快捷键逻辑，支持选中后新增/编辑任务

### 2026-11-04

- feat: 新增进程崩溃兜底与服务自愈机制
- feat: 生产大日程同步添加一般管理员权限开关
- feat: 增加共享目录访问凭据支持与大日程读取排障能力
- feat: 新增孙海山到张啸组并实现分组过滤功能
- feat(frontend): 优化自动获取枪名列表排序与展示

### 2026-11-03

- frontend: 离线模式停用三条录入类快捷键，优化主任务复制功能

### 2026-11-02

- feat(tasks): 新增从任务名提取客户信息的 fallback 逻辑
- feat(status-tracking): 新增生产大日程同步功能
- feat(tasks): 添加任务定位高亮与自动滚动功能
- feat(gunLedger): 实现焊枪名快速取号自定义前缀功能

### 2026-11-01

- feat: 新增主任务复制为表格功能及相关优化
- feat: 新增枪名一键复制功能，优化任务刷新逻辑

## 2026-10

### 2026-10-31

- feat: 新增主页面连按两次空格快速取号功能
- feat(tasks): 优化分组逻辑，支持从同名设计人员获取分组
- feat(工时管理): 新增分组筛选与日期多选功能
- feat(frontend): 实现浏览器标签页标题统一管理
- feat(tasks): 仕样进度管理新增日期筛选功能
- feat(tasks): 添加任务名输入末尾输入「暂停」自动切换暂停状态功能
- feat(tasks): 更新加急任务配色为亮黄色
- feat(tasks): 修改「暂停/取消」任务的工时规则
- feat: 新增任务「暂停/取消」状态及相关功能

### 2026-10-30

- feat: 新增任务加急功能与配色体系重构
- feat: 新增「显示纳期」开关和快速确认图安排功能
- feat(audit): 收敛操作日志记录范围，减少无效日志
- feat(frontend): 更新登录页面内容与样式设计

### 2026-10-29

- feat(login): 重构登录页视觉与布局，新增功能介绍面板
- fix(backend): 修复跨域拦截、权限漏洞及 PDF 解析资源耗尽问题
- feat(tasks): 新增枪名搜索与主任务改色联动功能
- feat(tasks): 新增枪名拖拽新建主任务功能
- feat(frontend): 新增统一加载组件 LoadingScreen 并重构页面加载态
- style(frontend): 添加吸顶表头内阴影分割线并更新隐藏人员显示说明
- feat(tasks): 新增 task_updated 限流补发机制及扩展颜色选项

### 2026-10-25

- build: 更新 WeKnora 版本至 v0.8.3 并调整仕样书共享路径配置

### 2026-10-21

- feat(GunLedger): 实现向下复制时焊枪名前缀后缀继承功能

### 2026-10-20

- feat: 移除数据库双备份逻辑并优化操作日志分页安全
- refactor(gunLedger): 统一焊枪名编号校验逻辑并更新文档
- feat: 新增设计变更/既制审图固定工时规则及自动填充逻辑
- feat(frontend): 新增全局后端心跳检测与登录页面现代化设计

### 2026-10-19

- style(tasks): 调整任务项高度和行高优化显示
- feat(Leaderboard): 添加仕样进度统计展示功能
- feat(tasks): 新增翟世学、朱海洋为默认担当人员并添加恢复确认

### 2026-10-18

- feat: 重构 Socket 连接为共享单例并优化行锁与任务颜色联动
- feat: 将多人编辑会话粒度细化到主任务级
- feat: 新增上次登录时间展示和任务变更增量广播功能

### 2026-10-17

- perf(frontend): 主页面改回静态加载并为依赖分包
- refactor: 删除遗留 JSON 数据库迁移相关代码及配置
- feat: 新增枪名跨任务移动功能及分配合并逻辑

### 2026-10-16

- feat(tasks): 新增操作日志保留条数配置功能
- feat(gun-ledger): 新增多分类焊枪台账导出与工时规则功能
- feat(Dashboard): 优化今日列自动滚动定位逻辑
- feat: 仕样进度管理新增未标记完成状态任务开关

### 2026-10-15

- feat: 新增用户自主修改密码功能及相关配置
- feat(gun-ledger): 新增焊枪台账任务分配功能
- feat: 新增设计计划标记颜色随机功能及多设备登录优化

### 2026-10-14

- style: 修复状态追踪排序配置并完善仪表盘今日列滚动逻辑

### 2026-10-13

- feat(status-tracking): 为张明和O/SHA工厂规则添加许华俊
- feat(specs): 仕样书纳期获取复用已有信息提升性能

### 2026-10-12

- feat: 实现通用二次确认弹窗替代原生 confirm

### 2026-10-11

- feat(tasks): 添加仕样书PDF专用解析模块
- feat(auth): 实现多设备会话管理机制
- feat(auth): 优化会话失效提示与登录体验

### 2026-10-10

- docs,refactor: 更新 CORS 配置说明并优化版本缓存逻辑
- feat: 新增工厂规则配置功能及相关展示与文档
- chore: 更新启动脚本并添加上下文清理功能
- feat(backend): 新增登录接口 IP 级限流并优化安全机制

### 2026-10-05

- feat(frontend): 增加管理员按分组筛选设计人员的功能
- feat(tasks): 新增任务上下移动功能

## 2026-09

### 2026-09-29

- feat: 新增已用枪名标识和批量操作定位功能

### 2026-09-28

- feat: 实现离线模式支持和焊枪台账普通用户只读权限
- chore(backend): 更新安全配置示例及校验逻辑
- feat(system): 添加默认工时规则配置及枪名移动功能
- feat: 新增通过仕样号自动获取枪名功能
- feat(GunLedger): 新增表只读打开模式及向下复制功能
- feat(frontend): 新增手动输入纳期功能并完善删除确认

### 2026-09-27

- feat(admin): 替换浏览器原生确认弹窗为自定义模态框

### 2026-09-26

- fix: 修复鉴权算法降级攻击风险并调整设计纳期逻辑
- feat: 将任务数据迁移到关系表，新增独立登录/操作日志表，实现IP黑名单功能
- feat: 新增IP黑名单功能并完善登出安全机制
- feat: 新增操作日志独立表并修复安全与权限问题
- feat: 移除未登录游客访问权限，所有页面和接口需登录
- feat: 全面升级系统安全与访问控制机制
- fix: 修复多个安全漏洞与命令注入风险
- feat: 实现初始密码随机生成与强制修改机制

### 2026-09-25

- feat: 新增焊枪选型知识库及答复约束提示词模板
- feat: 实现设计规范知识库多工作空间与答复约束提示词功能
- feat: 支持 WeKnora 多工作空间接入与问答跨空间校验
- fix(server): 开启 trust proxy 避免代理请求导致后端崩溃
- feat: 集成 WeKnora 本地知识库服务，支持规范检索与智能问答
- feat: 新增焊枪台账批量初始化功能并完善相关配置

### 2026-09-24

- feat: 添加焊枪台账模块及相关功能实现
- feat(gunLedger): 新增焊枪台账表级独占编辑锁功能
- feat: 添加焊枪编号台账功能
- feat: 新增设计规范与标准页面及后端接口

### 2026-09-23

- style(frontend): 调整 Dashboard 分组行单元格 z-index 层级
- style(frontend): 优化仪表盘分组表头溢出显示
- style(frontend): 调整仪表盘表格布局和样式
- feat(frontend): 添加月份选择器到三个页面的标题栏
- feat: 添加全局仕样号位数配置功能
- style(frontend): 优化页面布局样式和滚动显示

### 2026-09-22

- feat: 添加客户端信息接口并修复IP获取逻辑
- refactor(status-tracking): 统一将生产计划相关表述改为添加时间

### 2026-09-20

- docs: 优化注释内容并翻译为英文
- build, fix: 适配网络驱动器运行环境并修复节点版本检查
- docs: update readme and add project dependencies
- chore: 适配 npm workspaces 并优化依赖安装流程

### 2026-09-19

- docs: 更新README文档，补充重做功能说明与快捷键表格
- feat: 迁移数据库到SQLite，新增自动迁移功能

### 2026-09-17

- refactor(frontend): 修改今日任务自动滚动逻辑
- feat(frontend): 添加登录后自动滚动到今日任务列的功能

### 2026-09-10

- docs: 更新部署、README和API文档，补充功能说明
- feat(dashboard): 添加任务纳期显示与自动填充功能

### 2026-09-09

- feat(admin,auth): 新增用户权限管理与自动过滤任务功能

## 2026-08

### 2026-08-24

- chore: 补充项目根目录和 control 目录的 gitignore 规则
- chore(control): 删除无用的自动生成版本文件和忽略配置

### 2026-08-23

- feat: 完成多模块迭代更新

### 2026-08-19

- feat: 新增断网备份功能，优化Windows客户端体验与文档
- feat(control): 新增WinForms服务控制台功能并优化路径解析

### 2026-08-18

- feat(全栈): 新增枪名颜色标记与同步功能

## 2026-07

### 2026-07-22

- refactor(status-tracking): 优化设计交付天数计算逻辑

### 2026-07-10

- fix(stop.bat): 修复Windows下curl备份命令兼容性问题
- fix(system route): 修复离线备份未异步执行的问题
- feat(system&stop.bat): 添加关机前断网备份功能并优化停止脚本
- feat: 新增多项系统维护功能并优化现有流程
- refactor(frontend): 移除动态计算表格高度逻辑，改用flex布局自适应高度
- refactor(frontend): 统一任务导出调用维护接口
- feat(system): 重构任务导出功能，统一导出逻辑并优化权限控制
- fix: 修复多处分页/提示文本的乱码问题，优化界面显示
- refactor(frontend/backend): 重构任务导出功能，统一逻辑并修复离线提示层级
- feat: 新增任务数据手动导出功能，优化提示文案
- feat: 新增数据库自动维护功能与仕样书路径配置

### 2026-07-08

- feat(status-tracking): 新增自动计算统计字段与导出筛选功能
- docs: 更新权限相关文档与前端权限逻辑
- refactor(status-tracking): 调整状态追踪权限逻辑
- feat(status-tracking): 添加未确认数量字段并优化数据同步
- fix(backend): 修复pdf-parse运行环境兼容问题
- chore(frontend): 更新管理员页面初始登录用户列表

### 2026-07-07

- security: fix vulnerabilities 2.1, 2.2, 2.4 and update docs
- feat: 新增多项安全增强与功能优化
- feat: 新增默认管理员配置、安全增强与功能优化
- feat(workday): 添加工作日自定义 override 功能
- feat: 添加用户任务颜色标记功能
- feat(status-tracking): 新增生产计划月份管理功能
- feat(all): 新增组长规则管理功能并优化操作日志

### 2026-07-06

- feat(system-logs): 完善系统日志功能与显示
- feat(backend): 新增spec-info接口的clientName拼接逻辑
- test(pdf): 添加PDF规格文档解析测试脚本
- fix(routes/spec): 优化PDF规格信息提取逻辑
- refactor(backend/routes/spec): 优化PDF提取销售人员逻辑
- feat: 多项功能优化与文档更新
- feat: 新增仕样书识别、自动填充与批量同步功能，优化审计日志配置

### 2026-07-05

- docs: 更新API文档、部署指南与README，修复权限说明
- refactor(audit-log): 重构审计日志展示逻辑，统一前后端操作描述
- feat: 新增系统日志功能，优化实时同步与数据库写入
- feat: 添加批量替换、登出功能，优化导出和日志功能
- Merge fix/socket-io-auth-enforcement: enforce Socket.IO authentication
- fix: enforce Socket.IO authentication for real-time collaboration
- ci(github actions): add docs deploy workflow to github pages
- feat: 新增批量替换任务功能，优化系统权限与导出功能
- feat: 添加系统设置权限控制与相关功能优化
- feat: 添加审计日志系统与工时管理模块，重构日志页面

### 2026-07-04

- refactor(frontend/dashboard): 重构任务添加和编辑弹窗UI与逻辑
- fix(frontend): 更新版本更新提示文案
- refactor: 统一替换原生axios为封装的axiosInstance
- feat(frontend): 新增访客访问权限配置功能
- refactor: 统一API路径并添加密码变更迁移逻辑
- chore(ci&backend): 调整部署配置并统一JWT密钥读取方式
- refactor: 统一使用封装的axios实例并优化Gitee接口逻辑
- feat: 完成密码强制修改、权限控制与配置优化
- feat: 支持GitHub Pages部署，优化日期选择器和状态跟踪页面
- docs: 更新文档并优化状态追踪页面样式

### 2026-07-03

- feat: 添加版本展示与自动更新提示功能
- feat: 新增状态追踪功能，添加组长规则配置和仕样书PDF解析
- refactor(leaderboard): 优化枪名提取逻辑并重构搜索函数参数
- docs: update deployment, readme and api docs, add debounce save feature
- Merge pull request #1 from caifugao110/feature/spec-gun-list-and-batch-delivery-update

### 2026-07-02

- feat: enhance operation logging and undo functionality, update docs
- feat: add spec gun list mode and batch delivery date update logic, update docs
- docs: update deployment, readme and API docs, add spec delivery date feature
- feat(spec): add spec delivery date query feature
- feat: add offline mode support with socket connection detection
- refactor: 优化页面头部固定样式，更新任务导入导出逻辑与文档

### 2026-07-01

- feat: 新增登录日志功能，完善多人编辑锁定与页面统计
- refactor(start.bat): 重构启动脚本，新增后台运行和日志功能
- feat: 新增普通用户角色，完善权限系统与任务元数据

## 2026-06

### 2026-06-30

- feat: 完成系统设置、权限优化与数据导入导出功能
- feat: add work hours management page and related features
- feat(frontend): 新增多枪任务拆分功能并优化站点图标

### 2026-06-29

- chore: 移除所有非 Windows 部署相关配置和代码

## 2026-04

### 2026-04-12

- feat: 添加Docker支持并重构项目结构
- feat: 实现用户账号禁用功能及后台管理优化

### 2026-04-07

- feat: 新增任务报表与设计人员管理功能

### 2026-04-03

- feat: 实现任务表格人员管理并重构权限系统

### 2026-04-02

- Initial commit

