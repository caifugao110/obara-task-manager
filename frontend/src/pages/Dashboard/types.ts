export interface GunItem {
  id: string;
  name: string;
  hours: number | string;
  color?: string;
  colorBeforeUserMark?: string;
  colorMarkedBy?: { id: string; username: string; name: string };
}

export interface TaskItem {
  id: string;
  taskName: string;
  hours: number | string;
  color?: string;
  colorBeforeUserMark?: string;
  colorMarkedBy?: { id: string; username: string; name: string };
  guns?: GunItem[];
  leaveType?: 'sick' | 'vacation' | 'illness' | 'trip' | null;
  createdAt?: string;
  createdBy?: { id: string; username: string; name: string };
  updatedAt?: string;
  updatedBy?: { id: string; username: string; name: string };
}

export interface TaskSheet {
  id: string;
  designerId: string;
  month: number;
  year: number;
  days: Record<string, TaskItem[]>;
}

export interface SpecInfoResponse {
  success: boolean;
  message?: string;
  specNumber?: string;
  clientName?: string;
  deliveryDate?: string | null;
  isModification?: boolean;
}

export interface Designer {
  id: string;
  name: string;
  group?: string;
  hidden?: boolean;
}

export interface User {
  id: string;
  username: string;
  name: string;
  role: 'superadmin' | 'admin' | 'user';
}

export type TaskField = 'taskName' | 'hours' | 'color' | 'guns' | 'leaveType';

export type PendingChange = {
  designerId: string;
  date: string;
  itemId: string;
  field: TaskField;
  value: any;
};

export type EditingSession = {
  designerId: string;
  date: string;
  userId: string;
  username: string;
  name: string;
  mode?: 'edit' | 'colorMark';
};

export type BatchReplaceMatch = {
  designerId: string;
  designerName: string;
  date: string;
  itemId: string;
  taskName: string;
  fields: { field: string; label: string; text: string; count: number }[];
};

export type SelectedTask = { itemId: string; designerId: string; date: string };

// 枪名拖拽时目标主任务的预选中状态：'valid' 可放置（绿），'invalid' 存在同名枪名（红）
export type GunDropTargetState = 'valid' | 'invalid' | null;

export interface Toast {
  message: string;
  type: 'success' | 'error';
  id: number;
}
