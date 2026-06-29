/**
 * Obara 任务管理系统 - TypeScript 类型定义
 */

// ==================== 用户相关类型 ====================

/**
 * 用户角色类型
 */
export type UserRole = 'superadmin' | 'admin' | 'designer';

/**
 * 用户接口
 */
export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  group?: string;
  disabled?: boolean;
}

/**
 * 登录请求参数
 */
export interface LoginCredentials {
  username: string;
  password: string;
}

/**
 * 登录响应
 */
export interface LoginResponse {
  token: string;
  user: User;
}

/**
 * 认证上下文类型
 */
export interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

// ==================== 任务相关类型 ====================

/**
 * 任务条目接口
 */
export interface TaskItem {
  id: string;
  taskName: string;
  hours: number | string;
  color?: string;
  guns?: GunItem[];
  leaveType?: 'sick' | 'vacation' | 'illness' | 'trip' | null;
  fontSize?: string;
  textColor?: string;
}

/**
 * 枪名项目接口
 */
export interface GunItem {
  id: string;
  name: string;
  hours: number | string;
}

/**
 * 任务工作表接口（按用户 + 月份）
 */
export interface TaskSheet {
  id: string;
  designerId: string;
  month: number;
  year: number;
  days: Record<string, TaskItem[]>;
}

/**
 * 任务创建参数
 */
export interface CreateTaskParams {
  designerId: string;
  date: string;
  taskName: string;
  hours: number;
  color?: string;
  guns?: GunItem[];
  leaveType?: 'sick' | 'vacation' | 'illness' | 'trip' | null;
  fontSize?: string;
  textColor?: string;
}

/**
 * 任务更新参数
 */
export interface UpdateTaskParams {
  designerId: string;
  date: string;
  itemId: string;
  field: 'taskName' | 'hours' | 'color' | 'guns' | 'leaveType' | 'fontSize' | 'textColor';
  value: any;
}

/**
 * 任务删除参数
 */
export interface DeleteTaskParams {
  designerId: string;
  date: string;
  itemId: string;
}

/**
 * 任务移动参数
 */
export interface MoveTaskParams {
  sourceDesignerId: string;
  sourceDate: string;
  itemId: string;
  targetDesignerId: string;
  targetDate: string;
  newIndex?: number;
}

// ==================== 设计人员相关类型 ====================

/**
 * 设计人员接口
 */
export interface Designer {
  id: string;
  name: string;
  group?: string;
  hidden?: boolean;
  order?: number;
}

/**
 * 设计人员创建参数
 */
export interface CreateDesignerParams {
  name: string;
  group?: string;
  hidden?: boolean;
  order?: number;
}

/**
 * 设计人员更新参数
 */
export interface UpdateDesignerParams {
  name?: string;
  group?: string;
  hidden?: boolean;
  order?: number;
}

// ==================== 报表相关类型 ====================

/**
 * 报表数据接口
 */
export interface LeaderboardData {
  designerId: string;
  designerName: string;
  hours: number;
  sickDays: number;
  vacationDays: number;
  illnessDays: number;
}

/**
 * 报表设置接口
 */
export interface LeaderboardSettings {
  enabled: boolean;
  allowAdmins: boolean;
  allowViewers: boolean;
}

// ==================== 仕样搜索相关类型 ====================

/**
 * 仕样搜索结果
 */
export interface SpecSearchResult {
  designerId: string;
  designerName: string;
  taskName: string;
  color: string;
  date: string;
}

// ==================== API 响应类型 ====================

/**
 * 通用 API 错误响应
 */
export interface ApiError {
  message: string;
  details?: any;
  code?: string;
}

/**
 * 通用 API 成功响应
 */
export interface ApiResponse<T = any> {
  data?: T;
  message?: string;
  success: boolean;
}

// ==================== 工具类型 ====================

/**
 * Toast 通知类型
 */
export interface Toast {
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  id: number;
}

/**
 * 历史记录类型
 */
export interface HistoryRecord {
  operation: 'add' | 'delete' | 'move' | 'update';
  data: any;
  timestamp: number;
}

/**
 * 日期单元格信息
 */
export interface DayInfo {
  fullDate: string;
  dayNum: number;
  isWeekend: boolean;
  dayName: string;
}

/**
 * 分组类型
 */
export interface GroupInfo {
  name: string;
  designers: Designer[];
  collapsed?: boolean;
}

// ==================== 模态框相关类型 ====================

/**
 * 任务模态框参数
 */
export interface TaskModalProps {
  designerId: string;
  date: string;
  itemId?: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: TaskItem) => void;
  onDelete: (itemId: string) => void;
}

/**
 * 添加模式类型
 */
export type AddModeType = 'none' | 'trip' | 'sick' | 'vacation' | 'illness';

// ==================== 拖拽相关类型 ====================

/**
 * 拖拽数据类型
 */
export interface DragData {
  type: 'task' | 'designer' | 'cell';
  item?: TaskItem;
  designerId?: string;
  date?: string;
  group?: string;
}

/**
 * 拖拽覆盖层属性
 */
export interface DragOverlayProps {
  activeTask: DragData | null;
}

// ==================== 认证相关类型 ====================

/**
 * Axios 请求配置扩展
 */
export interface AxiosConfig {
  headers?: {
    Authorization?: string;
  };
}

/**
 * Socket.IO 事件类型
 */
export interface SocketEvents {
  'task_updated': () => void;
  'task_refreshed': (data: any) => void;
  'start_editing': (data: { designerId: string; date: string; userId: string; username: string; name: string }) => void;
  'user_editing': (data: { designerId: string; date: string; userId: string; username: string; name: string }) => void;
  'stop_editing': () => void;
  'user_stopped_editing': () => void;
  'disconnect': () => void;
}

// ==================== 工具函数类型 ====================

/**
 * 防抖函数类型
 */
export type DebounceFunction<T extends (...args: any[]) => any> = (
  ...args: Parameters<T>
) => void;

/**
 * 日期格式化选项
 */
export interface DateFormatOptions {
  year?: 'numeric' | '2-digit';
  month?: 'numeric' | '2-digit' | 'long' | 'short' | 'narrow';
  day?: 'numeric' | '2-digit';
  weekday?: 'long' | 'short' | 'narrow';
}

