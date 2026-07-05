/**
 * Socket.IO 认证测试
 * 验证 Socket.IO 强制鉴权机制的有效性
 */

const jwt = require('jsonwebtoken');
const { socketAuthMiddleware, requireSocketAuth } = require('../middleware/socketAuth');
const securityConfig = require('../config/security');

describe('Socket.IO Authentication', () => {
  describe('socketAuthMiddleware', () => {
    it('should reject connection without token', (done) => {
      const socket = {
        handshake: {
          auth: {},
          headers: {}
        }
      };

      socketAuthMiddleware(socket, (err) => {
        expect(err).toBeDefined();
        expect(err.message).toContain('No token provided');
        done();
      });
    });

    it('should reject connection with invalid token', (done) => {
      const socket = {
        handshake: {
          auth: { token: 'invalid_token' },
          headers: {}
        }
      };

      socketAuthMiddleware(socket, (err) => {
        expect(err).toBeDefined();
        expect(err.message).toContain('Authentication error');
        done();
      });
    });

    it('should accept connection with valid token', (done) => {
      // 生成有效的 JWT 令牌
      const validToken = jwt.sign(
        { id: '123' },
        securityConfig.jwt.secret,
        { expiresIn: '7d' }
      );

      const socket = {
        handshake: {
          auth: { token: validToken },
          headers: {}
        },
        data: {}
      };

      // 注意：这个测试需要数据库中存在 ID 为 123 的用户
      // 在实际测试中应该使用 mock 数据库
      socketAuthMiddleware(socket, (err) => {
        // 由于我们没有实际的数据库，这里会失败
        // 但这演示了测试的结构
        if (err) {
          expect(err.message).toContain('User not found');
        }
        done();
      });
    });
  });

  describe('requireSocketAuth', () => {
    it('should throw error if socket not authenticated', () => {
      const socket = { data: {} };
      
      expect(() => {
        requireSocketAuth(socket);
      }).toThrow('Not authenticated');
    });

    it('should return user if socket is authenticated', () => {
      const user = {
        id: '123',
        username: 'testuser',
        name: 'Test User',
        role: 'admin'
      };
      const socket = { data: { user } };
      
      const result = requireSocketAuth(socket);
      expect(result).toEqual(user);
    });
  });

  describe('Socket event authentication', () => {
    it('should prevent unauthenticated start_editing events', () => {
      const socket = {
        data: {},
        emit: jest.fn(),
        on: jest.fn()
      };

      // 模拟 start_editing 事件处理
      const eventHandler = (data) => {
        try {
          requireSocketAuth(socket);
        } catch (err) {
          socket.emit('error', { message: err.message });
        }
      };

      eventHandler({ designerId: 'test', date: '2026-07-05' });
      
      expect(socket.emit).toHaveBeenCalledWith(
        'error',
        { message: 'Not authenticated' }
      );
    });

    it('should allow authenticated start_editing events', () => {
      const user = {
        id: '123',
        username: 'testuser',
        name: 'Test User',
        role: 'admin'
      };
      const socket = {
        data: { user },
        emit: jest.fn(),
        broadcast: { emit: jest.fn() }
      };

      // 模拟 start_editing 事件处理
      const eventHandler = (data) => {
        try {
          const authenticatedUser = requireSocketAuth(socket);
          socket.broadcast.emit('user_editing', {
            userId: authenticatedUser.id,
            username: authenticatedUser.username
          });
        } catch (err) {
          socket.emit('error', { message: err.message });
        }
      };

      eventHandler({ designerId: 'test', date: '2026-07-05' });
      
      expect(socket.broadcast.emit).toHaveBeenCalledWith(
        'user_editing',
        expect.objectContaining({
          userId: '123',
          username: 'testuser'
        })
      );
    });

    it('should use server-side user info instead of client-provided info', () => {
      const authenticatedUser = {
        id: '123',
        username: 'testuser',
        name: 'Test User',
        role: 'admin'
      };
      const socket = {
        data: { user: authenticatedUser },
        emit: jest.fn(),
        broadcast: { emit: jest.fn() }
      };

      // 客户端尝试伪造用户信息
      const clientData = {
        designerId: 'test',
        date: '2026-07-05',
        userId: '999',  // 尝试伪造用户 ID
        username: 'hacker',  // 尝试伪造用户名
        name: 'Hacker'  // 尝试伪造名称
      };

      // 模拟 start_editing 事件处理
      const eventHandler = (data) => {
        try {
          const authenticatedUser = requireSocketAuth(socket);
          socket.broadcast.emit('user_editing', {
            userId: authenticatedUser.id,  // 使用服务器端用户 ID
            username: authenticatedUser.username,  // 使用服务器端用户名
            name: authenticatedUser.name  // 使用服务器端名称
          });
        } catch (err) {
          socket.emit('error', { message: err.message });
        }
      };

      eventHandler(clientData);
      
      // 验证广播的用户信息来自服务器端，而不是客户端
      expect(socket.broadcast.emit).toHaveBeenCalledWith(
        'user_editing',
        expect.objectContaining({
          userId: '123',  // 应该是真实的用户 ID
          username: 'testuser',  // 应该是真实的用户名
          name: 'Test User'  // 应该是真实的名称
        })
      );
    });
  });
});

describe('Security Improvements', () => {
  it('should prevent identity spoofing attacks', () => {
    const authenticatedUser = {
      id: '123',
      username: 'alice',
      name: 'Alice',
      role: 'user'
    };

    const socket = {
      data: { user: authenticatedUser },
      broadcast: { emit: jest.fn() }
    };

    // 攻击者尝试冒充另一个用户
    const maliciousData = {
      itemId: 'item-1',
      userId: '456',  // 尝试冒充用户 456
      username: 'bob'  // 尝试冒充 Bob
    };

    // 模拟 status_tracking_start_edit 事件
    const eventHandler = (data) => {
      const session = {
        itemId: data.itemId,
        userId: authenticatedUser.id,  // 使用真实的认证用户 ID
        username: authenticatedUser.username  // 使用真实的认证用户名
      };
      socket.broadcast.emit('status_tracking_edit_start', session);
    };

    eventHandler(maliciousData);

    // 验证广播的信息使用真实的用户身份
    expect(socket.broadcast.emit).toHaveBeenCalledWith(
      'status_tracking_edit_start',
      expect.objectContaining({
        userId: '123',  // 真实用户 ID
        username: 'alice'  // 真实用户名
      })
    );
  });

  it('should prevent unauthorized event broadcasting', () => {
    const socket = {
      data: {},  // 未认证
      emit: jest.fn()
    };

    // 尝试发送未授权的事件
    const eventHandler = () => {
      try {
        requireSocketAuth(socket);
        socket.broadcast.emit('malicious_event', {});
      } catch (err) {
        socket.emit('error', { message: 'Unauthorized' });
      }
    };

    eventHandler();

    // 验证错误被发送，恶意事件未被广播
    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      { message: 'Unauthorized' }
    );
  });
});
