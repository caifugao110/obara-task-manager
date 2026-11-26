/**
 * 焊枪台账页的数据类型
 *
 * 从 pages/GunLedger.tsx 拆出：页面组件与台账规则两边都要用这些类型，
 * 单独一个文件后 rules.ts 不必反过来依赖组件文件。
 */
export interface Toast { message: string; type: 'success' | 'error'; id: number; center?: boolean }

export interface UserMeta { id: string; username: string; name: string; }

export interface Designer { id: string; name: string; group?: string; hidden?: boolean; }

export interface GunRow {
  id: string;
  serialNumber: number;
  gunName: string;
  customer: string;
  time: string;
  responsiblePerson: string;
  /** 焊枪规格（原「焊枪规格或备注」列拆分后的规格列） */
  spec: string;
  remarks: string;
  createdAt?: string;
  createdBy?: UserMeta | null;
  updatedAt?: string;
  updatedBy?: UserMeta | null;
}

// 焊枪名自动生成规则（台账初始化设置，超管按表配置）
export interface GunNameRule {
  enabled: boolean;
  prefix: string;
  start: number;
  pad: number;
}

// 默认工时规则弹窗中的单元格草稿：空串代表未配置（仅可能出现在用户自建表）
export type HoursDraftValue = number | '';
export interface HoursDraftCell { confirm: HoursDraftValue; confirmModify: HoursDraftValue; design: HoursDraftValue }
export type TableHoursDraft = Record<string, Record<string, HoursDraftCell>>;

export interface GunTable { id: string; name: string; rows: GunRow[]; gunNameRule?: GunNameRule | null; }

export interface SpecInfoResponse {
  success: boolean;
  message?: string;
  specNumber?: string;
  clientName?: string;
  deliveryDate?: string | null;
  isModification?: boolean;
}

// 已存在的相同仕样号任务（用于「添加到已有任务」合并分配）
export interface ExistingSpecTask {
  itemId: string;
  taskName: string;
  guns: { id: string; name: string; hours: number | string }[];
}

export interface GunLedgerData {
  categories: Record<string, GunTable[]>;
  defaultResponsiblePersons: string[];
}

// 台账初始化面板中的一键初始化目标：全部表格，或某一分类下的全部表格
export type BatchInitTarget = { scope: 'all' } | { scope: 'category'; category: string };

export interface EditingSession {
  tableId: string;
  serialNumber: number;
  userId: string;
  username: string;
  name: string;
  socketId: string;
}

export interface TableLockSession {
  tableId: string;
  userId: string;
  username: string;
  name: string;
  lockedAt?: number;
}
