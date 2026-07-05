# Socket.IO 实时协作鉴权修复

## 漏洞描述

**漏洞 ID**: vuln-002  
**严重程度**: 严重 (Critical)  
**类型**: 认证绕过 / 身份冒充

### 问题

原始代码中，Socket.IO 实时协作功能在处理以下事件时缺乏强制鉴权：
- `task_updated`
- `start_editing`
- `stop_editing`
- `status_tracking_start_edit`
- `status_tracking_stop_edit`

虽然 `register_user` 事件会验证 JWT 令牌，但其他关键事件并未强制要求已认证会话。这导致：

1. **身份冒充**: 攻击者可以连接 Socket.IO 服务器而无需认证，伪造 `userId`、`username`、`name` 等信息
2. **业务干扰**: 恶意广播事件可能导致正常用户体验受损
3. **数据完整性风险**: 虽然直接修改数据库需要认证，但伪造的编辑状态可能误导用户

## 修复方案

### 1. 创建 Socket.IO 认证中间件

**文件**: `backend/middleware/socketAuth.js`

新增了专门的 Socket.IO 认证中间件，用于：
- 验证连接时的 JWT 令牌
- 检查用户是否存在且未被禁用
- 将认证的用户信息附加到 socket.data

```javascript
const socketAuthMiddleware = (socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return next(new Error('Authentication error: No token provided'));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const data = db.readDb();
    const user = data.users.find(u => u.id === decoded.id);

    if (!user) {
      return next(new Error('Authentication error: User not found'));
    }

    if (user.disabled) {
      return next(new Error('Authentication error: Account disabled'));
    }

    socket.data.user = {
      id: user.id,
      username: user.username,
      name: user.name || user.username,
      role: user.role
    };
    socket.data.userId = user.id;
    socket.data.userRole = user.role;

    next();
  } catch (err) {
    return next(new Error(`Authentication error: ${err.message}`));
  }
};
```

### 2. 更新 Socket.IO 服务器配置

**文件**: `backend/server.js`

- 启用 Socket.IO 连接认证选项
- 应用认证中间件到所有连接
- 添加连接错误处理

```javascript
const io = new Server(server, {
  cors: {
    origin: securityConfig.cors.origin,
    methods: securityConfig.cors.methods,
    credentials: securityConfig.cors.credentials
  },
  auth: {
    required: true
  }
});

io.use(socketAuthMiddleware);

io.on('connect_error', (error) => {
  console.error('Socket connection error:', error.message);
});
```

### 3. 强制所有事件进行鉴权

对所有敏感事件添加认证检查：

```javascript
socket.on('start_editing', (data) => {
  try {
    const authenticatedUser = requireSocketAuth(socket);
    
    // 使用服务器端验证的用户信息，而不是客户端提供的信息
    const session = {
      designerId: data.designerId,
      date: data.date,
      userId: authenticatedUser.id,        // 使用真实用户 ID
      username: authenticatedUser.username, // 使用真实用户名
      name: authenticatedUser.name,         // 使用真实名称
      socketId: socket.id
    };
    editingSessions.set(key, session);
    socket.broadcast.emit('user_editing', session);
  } catch (err) {
    socket.emit('error', { message: err.message });
  }
});
```

### 4. 使用服务器端用户信息

关键改进：客户端提交的 `userId`、`username`、`name` 等信息不再被直接信任。所有事件处理都使用服务器端通过 JWT 验证得到的用户信息。

## 安全改进

### 修复前的攻击场景

```javascript
// 攻击者可以这样做：
socket.emit('start_editing', {
  designerId: 'designer-1',
  date: '2026-07-05',
  userId: '999',           // 伪造用户 ID
  username: 'admin',       // 伪造用户名
  name: 'Administrator'    // 伪造名称
});

// 结果：所有用户看到 "admin" 在编辑文件
```

### 修复后的防护

```javascript
// 即使攻击者尝试伪造信息：
socket.emit('start_editing', {
  designerId: 'designer-1',
  date: '2026-07-05',
  userId: '999',           // 被忽略
  username: 'admin',       // 被忽略
  name: 'Administrator'    // 被忽略
});

// 结果：系统使用真实的认证用户信息
// 广播的事件显示真实的用户身份
```

## 测试验证

### 单元测试

新增 `backend/__tests__/socketAuth.test.js` 包含以下测试：

1. **无令牌连接被拒绝**
   - 验证未提供令牌的连接被拒绝

2. **无效令牌连接被拒绝**
   - 验证无效或过期的令牌被拒绝

3. **有效令牌连接被接受**
   - 验证有效令牌的连接被接受

4. **未认证事件被拒绝**
   - 验证未认证的 Socket 无法发送事件

5. **认证事件被接受**
   - 验证认证的 Socket 可以发送事件

6. **身份冒充防护**
   - 验证客户端无法伪造用户身份
   - 验证服务器端用户信息被使用

7. **未授权事件广播被阻止**
   - 验证未认证的 Socket 无法广播事件

### 运行测试

```bash
npm test -- backend/__tests__/socketAuth.test.js
```

## 客户端兼容性

### 需要的更改

前端代码需要在连接 Socket.IO 时提供有效的 JWT 令牌：

```javascript
// 修复前（不安全）
const socket = io('http://localhost:5000');

// 修复后（安全）
const token = localStorage.getItem('authToken');
const socket = io('http://localhost:5000', {
  auth: {
    token: token
  }
});
```

## 部署步骤

1. **备份当前代码**
   ```bash
   git checkout -b backup/main-$(date +%s)
   ```

2. **应用修复**
   ```bash
   git merge fix/socket-io-auth-enforcement
   ```

3. **运行测试**
   ```bash
   npm test
   ```

4. **验证功能**
   - 测试已认证用户的实时协作功能
   - 验证未认证连接被拒绝
   - 验证身份冒充尝试被阻止

5. **部署到生产环境**
   ```bash
   npm run build
   npm start
   ```

## 回滚步骤

如果需要回滚：

```bash
git revert <commit-hash>
npm install
npm start
```

## 参考资料

- [OWASP: Broken Authentication](https://owasp.org/www-project-top-ten/2021/A07_2021-Identification_and_Authentication_Failures/)
- [Socket.IO Security](https://socket.io/docs/v4/socket-io-security/)
- [JWT Best Practices](https://datatracker.ietf.org/doc/html/rfc8725)

## 相关漏洞

此修复解决了以下漏洞：
- **vuln-002**: Socket.IO 实时协作通道缺乏强制鉴权

## 后续建议

1. **审计其他 Socket.IO 事件** - 检查是否还有其他未受保护的事件
2. **实现事件日志** - 记录所有 Socket.IO 事件用于审计
3. **添加速率限制** - 防止 Socket.IO 事件的滥用
4. **定期安全审查** - 定期审查 Socket.IO 配置和事件处理
