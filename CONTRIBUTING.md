# 贡献指南

感谢你关注 Obara 任务管理系统！我们欢迎各种形式的贡献，让这个项目变得更好。

## 🌟 如何贡献

### 1. Fork 本项目

点击右上角的 "Fork" 按钮创建你自己的副本。

### 2. 克隆项目

```bash
git clone https://github.com/caifugao110/obara-task-manager.git
cd obara-task-manager
```

### 3. 创建分支

```bash
# 功能分支
git checkout -b feature/your-feature-name

# 或者修复分支
git checkout -b fix/your-fix-name
```

### 4. 进行开发

```bash
# 安装所有依赖
npm run install:all

# 启动开发服务器
npm run dev
```

### 5. 提交代码

确保你的代码：
- ✅ 遵循 ESLint 规则
- ✅ TypeScript 类型定义完整
- ✅ 没有编译错误
- ✅ 添加了必要的注释

```bash
# 添加更改
git add .

# 提交（使用语义化提交信息）
git commit -m "feat: add new feature"

# 推送到远程
git push origin feature/your-feature-name
```

### 6. 创建 Pull Request

在 GitHub 上创建 Pull Request，并描述你的更改。

## 📝 代码规范

### 提交信息格式

我们使用语义化提交信息：

```
feat: 新功能
fix: 修复 bug
docs: 文档更新
style: 代码格式（不影响代码运行）
refactor: 重构（即不是新增功能，也不是修改 bug）
perf: 性能优化
test: 测试相关
chore: 构建过程或辅助工具变动
```

### 命名规范

- **文件/目录**: 使用小写，多个单词用连字符（kebab-case）
- **组件**: PascalCase（如 `Dashboard.tsx`）
- **函数/变量**: camelCase
- **常量**: UPPER_SNAKE_CASE
- **类型/接口**: PascalCase

### 代码风格

- 使用 2 个空格缩进
- 语句末尾加分号
- 字符串使用单引号
- 使用模板字符串进行字符串插值

## 🐛 报告问题

发现 Bug？请创建 Issue 并提供：
- 问题描述
- 重现步骤
- 预期行为
- 实际行为
- 环境信息（Node.js 版本、操作系统等）

## 💡 功能建议

有改进建议？请创建 Issue 并说明：
- 功能描述
- 使用场景
- 实现思路（可选）

## 🔒 安全问题

发现安全漏洞？请**不要**公开创建 Issue，而是发送邮件至 gaoj@obara.com.cn。

## 📖 开发指南

### 项目结构

```
obara-task-manager/
├── backend/          # 后端服务（Node.js + Express）
├── frontend/         # 前端应用（React + TypeScript）
└── docs/            # 文档
```

### 技术栈

**前端**
- React 18
- TypeScript 5
- Vite 5
- TailwindCSS 3
- Socket.IO Client

**后端**
- Node.js 18+
- Express 5
- Socket.IO 4
- JSON 文件存储

### 运行测试

```bash
# 运行所有测试
npm test

# 仅测试前端
cd frontend && npm test

# 仅测试后端
cd backend && npm test
```

## 🎯 需要帮助的领域

- 📝 文档完善和翻译
- 🧪 单元测试和集成测试
- 🎨 UI/UX 改进
- 🐛 Bug 修复
- ✨ 新功能开发

## 📜 行为准则

- 尊重他人，保持礼貌
- 对事不对人，专注于技术讨论
- 欢迎不同观点，开放包容
- 互相帮助，共同成长

## 📄 许可证

本项目采用 MIT 许可证。贡献的代码将采用相同的许可证。

---

感谢你的贡献！🎉
