/**
 * API 服务层
 * 统一管理所有 API 调用
 */

import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import type {
  LoginCredentials,
  LoginResponse,
  User,
  TaskSheet,
  TaskItem,
  CreateTaskParams,
  UpdateTaskParams,
  DeleteTaskParams,
  MoveTaskParams,
  Designer,
  CreateDesignerParams,
  UpdateDesignerParams,
  LeaderboardData,
  LeaderboardSettings,
  ApiResponse,
} from '../types';

// ==================== Axios 配置 ====================

const API_BASE_URL = '/api';

const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器 - 添加 Token
axiosInstance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器 - 处理错误
axiosInstance.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    // 处理账号禁用情况
    if (error.response?.status === 403) {
      const data = error.response.data as any;
      if (data?.code === 'ACCOUNT_DISABLED') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        alert('您的账号已被禁用，请联系管理员');
        window.location.href = '/login';
      }
    }
    
    // 处理 Token 过期
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    
    return Promise.reject(error);
  }
);

// ==================== 认证 API ====================

export const authAPI = {
  /**
   * 用户登录
   */
  login: async (credentials: LoginCredentials): Promise<LoginResponse> => {
    const response = await axiosInstance.post<LoginResponse>('/auth/login', credentials);
    return response.data;
  },
};

// ==================== 用户管理 API ====================

export const usersAPI = {
  /**
   * 获取所有用户（管理员）
   */
  getAllUsers: async (): Promise<User[]> => {
    const response = await axiosInstance.get<User[]>('/users');
    return response.data;
  },

  /**
   * 创建用户（仅超级管理员）
   */
  createUser: async (userData: {
    username: string;
    password: string;
    name: string;
    role: 'superadmin' | 'admin' | 'user';
    group?: string;
  }): Promise<User> => {
    const response = await axiosInstance.post<User>('/users', userData);
    return response.data;
  },

  /**
   * 更新用户
   */
  updateUser: async (
    userId: string,
    userData: {
      username?: string;
      password?: string;
      name?: string;
      role?: 'superadmin' | 'admin' | 'user';
      group?: string;
      disabled?: boolean;
    }
  ): Promise<User> => {
    const response = await axiosInstance.put<User>(`/users/${userId}`, userData);
    return response.data;
  },

  /**
   * 删除用户（仅超级管理员）
   */
  deleteUser: async (userId: string): Promise<void> => {
    await axiosInstance.delete(`/users/${userId}`);
  },
};

// ==================== 设计人员 API ====================

export const designersAPI = {
  /**
   * 获取所有设计人员
   */
  getAllDesigners: async (): Promise<Designer[]> => {
    const response = await axiosInstance.get<Designer[]>('/designers');
    return response.data;
  },

  /**
   * 创建设计人员
   */
  createDesigner: async (designerData: CreateDesignerParams): Promise<Designer> => {
    const response = await axiosInstance.post<Designer>('/designers', designerData);
    return response.data;
  },

  /**
   * 更新设计人员
   */
  updateDesigner: async (
    designerId: string,
    designerData: UpdateDesignerParams
  ): Promise<Designer> => {
    const response = await axiosInstance.put<Designer>(`/designers/${designerId}`, designerData);
    return response.data;
  },

  /**
   * 重新排序设计人员
   */
  reorderDesigners: async (ids: string[]): Promise<void> => {
    await axiosInstance.post('/designers/reorder', { ids });
  },

  /**
   * 删除设计人员
   */
  deleteDesigner: async (designerId: string): Promise<void> => {
    await axiosInstance.delete(`/designers/${designerId}`);
  },
};

// ==================== 任务管理 API ====================

export const tasksAPI = {
  /**
   * 获取任务数据
   */
  getTasks: async (month: number, year: number, designerId?: string): Promise<TaskSheet[]> => {
    const params: Record<string, string> = { month: month.toString(), year: year.toString() };
    if (designerId) {
      params.designerId = designerId;
    }
    const response = await axiosInstance.get<TaskSheet[]>('/tasks', { params });
    return response.data;
  },

  /**
   * 创建任务条目
   */
  createTask: async (params: CreateTaskParams): Promise<{
    sheetId: string;
    designerId: string;
    month: number;
    year: number;
    date: string;
    item: TaskItem;
    sheet: TaskSheet;
  }> => {
    const response = await axiosInstance.post('/tasks/item', params);
    return response.data;
  },

  /**
   * 批量创建任务条目
   */
  batchCreateTasks: async (params: {
    designerId: string;
    date: string;
    items: Partial<TaskItem>[];
  }): Promise<{
    sheetId: string;
    designerId: string;
    month: number;
    year: number;
    date: string;
    items: TaskItem[];
    sheet: TaskSheet;
  }> => {
    const response = await axiosInstance.post('/tasks/item/batch', params);
    return response.data;
  },

  /**
   * 更新任务条目
   */
  updateTask: async (params: UpdateTaskParams): Promise<{
    sheetId: string;
    designerId: string;
    month: number;
    year: number;
    date: string;
    item: TaskItem;
    sheet: TaskSheet;
  }> => {
    const response = await axiosInstance.put('/tasks/item', params);
    return response.data;
  },

  /**
   * 删除任务条目
   */
  deleteTask: async (params: DeleteTaskParams): Promise<{
    message: string;
    sheetId: string;
    designerId: string;
    month: number;
    year: number;
    date: string;
    sheet: TaskSheet;
  }> => {
    const response = await axiosInstance.delete('/tasks/item', { data: params });
    return response.data;
  },

  /**
   * 移动任务条目
   */
  moveTask: async (params: MoveTaskParams): Promise<{
    message: string;
    sourceSheet: TaskSheet;
    targetSheet: TaskSheet;
  }> => {
    const response = await axiosInstance.post('/tasks/move', params);
    return response.data;
  },
};

// ==================== 报表设置 API ====================

export const settingsAPI = {
  /**
   * 获取报表设置
   */
  getLeaderboardSettings: async (): Promise<LeaderboardSettings> => {
    const response = await axiosInstance.get<LeaderboardSettings>('/settings/leaderboard');
    return response.data;
  },

  /**
   * 更新报表设置（仅超级管理员）
   */
  updateLeaderboardSettings: async (
    settings: Partial<LeaderboardSettings>
  ): Promise<LeaderboardSettings> => {
    const response = await axiosInstance.put<LeaderboardSettings>(
      '/settings/leaderboard',
      settings
    );
    return response.data;
  },
};

// ==================== 工具函数 ====================

/**
 * 获取认证头
 */
export const getAuthHeaders = (): AxiosRequestConfig['headers'] => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * 检查用户是否已认证
 */
export const isAuthenticated = (): boolean => {
  const token = localStorage.getItem('token');
  return !!token;
};

/**
 * 获取当前用户
 */
export const getCurrentUser = (): User | null => {
  const userStr = localStorage.getItem('user');
  if (!userStr) return null;
  try {
    return JSON.parse(userStr);
  } catch {
    return null;
  }
};

/**
 * 检查是否为管理员
 */
export const isAdmin = (): boolean => {
  const user = getCurrentUser();
  return user?.role === 'admin' || user?.role === 'superadmin';
};

/**
 * 检查是否为超级管理员
 */
export const isSuperAdmin = (): boolean => {
  const user = getCurrentUser();
  return user?.role === 'superadmin';
};

// 导出默认对象
export default {
  auth: authAPI,
  users: usersAPI,
  designers: designersAPI,
  tasks: tasksAPI,
  settings: settingsAPI,
};
