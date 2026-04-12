# 安全政策

我们非常重视 Obara 任务管理系统的安全性。如果您发现任何安全漏洞，请及时告知我们。

## 📞 报告安全漏洞

### 优先方式

**不要**在公开渠道（如 GitHub Issues）报告安全漏洞。

请通过以下方式之一联系我们：

- **Email**: gaoj@obara.com.cn
- **GitHub Security Advisory**: [创建私密报告](https://github.com/caifugao110/obara-task-manager/security/advisories/new)

### 报告内容

请提供尽可能详细的信息：

- 漏洞类型和描述
- 受影响版本
- 重现步骤
- 潜在影响
- 修复建议（可选）

## 📋 支持版本

我们仅为以下版本提供安全更新：

| 版本 | 支持状态 | 备注 |
|------|---------|------|
| 2.x  | ✅ 支持 | 当前版本，持续维护 |
| 1.x  | ❌ 不支持 | 已停止维护，请升级 |

## 🛡️ 安全最佳实践

### 生产环境部署

1. **修改默认密钥**
   ```env
   JWT_SECRET=<使用强随机字符串>
   ```

2. **使用 HTTPS**
   - 始终在生产环境使用 HTTPS
   - 配置 SSL/TLS 证书

3. **定期更新依赖**
   ```bash
   npm audit
   npm update
   ```

4. **限制访问**
   - 使用防火墙限制端口访问
   - 配置 CORS 白名单

5. **备份数据**
   - 定期备份 `db.json` 文件
   - 存储到安全位置

6. **监控日志**
   - 启用日志记录
   - 定期检查异常

### 开发环境

1. **不要提交敏感信息**
   - `.env` 文件已添加到 `.gitignore`
   - 使用 `.env.example` 作为模板

2. **使用安全的密码**
   - 默认密码仅供测试
   - 生产环境使用强密码

## 🔐 已实施的安全措施

### 认证与授权

- ✅ JWT Token 认证
- ✅ 密码使用 bcrypt 加密存储
- ✅ 基于角色的权限控制（RBAC）
- ✅ Token 过期机制

### 输入验证

- ✅ 所有输入使用 Joi 验证
- ✅ SQL 注入防护（使用 JSON 存储）
- ✅ XSS 防护（React 自动转义）

### 传输安全

- ✅ HTTPS 支持
- ✅ CORS 配置
- ✅ 安全的 Cookie 设置

### 限流防护

- ✅ 登录接口限流
- ✅ API 请求频率限制
- ✅ 防止暴力破解

## 📊 安全审计

### 定期执行

```bash
# 检查依赖漏洞
npm audit

# 自动修复
npm audit fix

# 强制修复（可能破坏兼容性）
npm audit fix --force
```

### 建议频率

- **开发期间**: 每次提交前
- **生产环境**: 每月至少一次

## 🚨 安全更新

我们会定期发布安全更新：

- **严重漏洞**: 48 小时内发布补丁
- **高危漏洞**: 1 周内发布补丁
- **中低危漏洞**: 下个版本修复

关注 [Releases](https://github.com/caifugao110/obara-task-manager/releases) 获取更新信息。

## 📚 相关资源

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js 安全最佳实践](https://nodejs.org/en/docs/guides/security/)
- [Express 安全指南](https://expressjs.com/en/advanced/best-practice-security.html)

## 🙏 致谢

感谢所有报告安全漏洞的研究者和用户！

---

**最后更新**: 2026-04-12  
**版本**: 1.0
