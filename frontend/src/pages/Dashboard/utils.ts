import { format } from 'date-fns';
import { PAUSED_TASK_SUFFIX } from '../../utils/taskColors';
import type { GunItem, TaskItem, SelectedTask, SpecInfoResponse } from './types';

export const taskSelectionKey = (selection: SelectedTask) => `${selection.designerId}__${selection.date}__${selection.itemId}`;

// 编辑会话键精确到主任务：同一单元格内不同主任务的编辑互不影响；
// itemId 为空表示旧版整格会话（兼容过渡期的旧客户端）
export const editingSessionKey = (designerId: string, date: string, itemId?: string | null) => `${designerId}__${date}__${itemId ?? ''}`;

export const isEditableKeyboardTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
};

export const normalizeTaskColor = (value?: string) => String(value || '').trim().toLowerCase();
export const isWhiteTaskColor = (value?: string) => ['#ffffff', '#fff', 'white'].includes(normalizeTaskColor(value));
export const hasStoredUserMarkColor = (item: TaskItem | GunItem) => Object.prototype.hasOwnProperty.call(item, 'colorBeforeUserMark');

// 主任务改色时子枪名颜色联动（与后端 syncGunColorsWithTask 规则一致）：
// 主任务重新上色代表整条任务回到「未完成」，所有枪名（含原本标白/无色的）统一改成新颜色，
// 并清掉各自的恢复记录与标记来源。必须真正删除 colorBeforeUserMark / colorMarkedBy 两个 key
// （hasStoredUserMarkColor 按 key 存在判断）。
export const syncGunsWithTaskColor = (guns: GunItem[] | undefined, color: string): GunItem[] | undefined => {
  if (!Array.isArray(guns) || guns.length === 0) return guns;
  return guns.map(gun => {
    const { colorBeforeUserMark: _before, colorMarkedBy: _markedBy, ...rest } = gun;
    return { ...rest, color };
  });
};

// Extract spec number (仕样号) from task name
// Patterns: S57157, M55478, S-53969, or standalone digits like 56363
export const extractSpecNumber = (taskName: string): string | null => {
  // Priority 1: letter prefix + optional hyphen + 4-6 digits (e.g., S57157, M55478, S-53969)
  const letterMatch = taskName.match(/\b[A-Za-z]-?(\d{4,6})\b/);
  if (letterMatch) return letterMatch[1];
  // Priority 2: standalone 4-6 digits (e.g., 56363)
  const digitsMatch = taskName.match(/\b(\d{4,6})\b/);
  return digitsMatch ? digitsMatch[1] : null;
};

export const splitDesignTaskName = (taskName: string) => {
  const trimmed = taskName.trim();
  const deadlineMatch = trimmed.match(/\s*(\[\d{1,2}\/\d{1,2}\])$/);
  const withoutDeadline = deadlineMatch && typeof deadlineMatch.index === 'number'
    ? trimmed.slice(0, deadlineMatch.index).trim()
    : trimmed;
  const typeMatch = withoutDeadline.match(/\s+(确认图修改|确认图|设计变更|既制审图|暂停\/取消|设计)$/);
  const baseName = typeMatch && typeof typeMatch.index === 'number'
    ? withoutDeadline.slice(0, typeMatch.index).trim()
    : withoutDeadline;
  const typeSuffix = typeMatch ? ` ${typeMatch[1]}` : '';
  return { baseName, typeSuffix };
};

// 任务名输入框末尾直接敲「暂停」时，等同勾选「暂停/取消」复选框：
// 返回去掉这段文字后的内容和是否命中。复选框是互斥的（同一任务只能有一个任务内容），
// 所以这里只认末尾的「暂停」——后面接的「暂停/取消」后缀由复选框统一维护，
// 避免出现「既制审图 + 暂停/取消」两个勾同时成立。
export const splitTypedPausedSuffix = (value?: string | null) => {
  const text = String(value ?? '');
  if (!text.endsWith('暂停') || text.endsWith(PAUSED_TASK_SUFFIX)) {
    return { text, pausedTyped: false };
  }
  const stripped = text.slice(0, -'暂停'.length).replace(/\s+$/, '');
  // 「取消暂停」这类说明性内容不当作勾选暂停处理
  if (stripped.endsWith('取消')) return { text, pausedTyped: false };
  return { text: stripped, pausedTyped: true };
};

export const getDeliveryDateSuffix = (deliveryDate?: string | null) => {
  if (!deliveryDate) return null;
  const dateMatch = deliveryDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!dateMatch) return null;
  const month = parseInt(dateMatch[2], 10);
  const day = parseInt(dateMatch[3], 10);
  return `[${month}/${day}]`;
};

export const getDesignPlanClientName = (specInfo: SpecInfoResponse, fallbackSpecNumber: string) => {
  const clientName = specInfo.clientName?.trim();
  if (!clientName) return '';
  if (!specInfo.isModification || clientName.startsWith('M')) return clientName;

  const specNumber = specInfo.specNumber || fallbackSpecNumber;
  if (clientName.startsWith(`${specNumber}>`)) {
    return `M${clientName}`;
  }
  return `M${specNumber}>${clientName}`;
};

export const buildSyncedSpecTaskName = (originalTaskName: string, specInfo: SpecInfoResponse, specNumber: string, deliverySuffix: string) => {
  const { baseName, typeSuffix } = splitDesignTaskName(originalTaskName);
  const clientName = getDesignPlanClientName(specInfo, specNumber) || baseName;
  return `${clientName}${typeSuffix} ${deliverySuffix}`.trim();
};

// 判断两条主任务内容是否完全一样（主任务名/工时/类型/全部枪名及枪名工时；颜色不参与比对）
export const isTaskContentIdentical = (a: TaskItem, b: TaskItem): boolean => {
  if (String(a.taskName || '').trim() !== String(b.taskName || '').trim()) return false;
  if (String(a.hours ?? '').trim() !== String(b.hours ?? '').trim()) return false;
  if ((a.leaveType || null) !== (b.leaveType || null)) return false;
  const gunsA = Array.isArray(a.guns) ? a.guns : [];
  const gunsB = Array.isArray(b.guns) ? b.guns : [];
  if (gunsA.length !== gunsB.length) return false;
  for (let i = 0; i < gunsA.length; i++) {
    if (String(gunsA[i]?.name || '').trim() !== String(gunsB[i]?.name || '').trim()) return false;
    if (String(gunsA[i]?.hours ?? '').trim() !== String(gunsB[i]?.hours ?? '').trim()) return false;
  }
  return true;
};

export const hasInvalidNamedGunHours = (guns?: GunItem[]) => {
  return (guns || []).some(gun => {
    const name = String(gun.name || '').trim();
    if (!name) return false;
    const hours = typeof gun.hours === 'number' ? gun.hours : parseFloat(String(gun.hours));
    return isNaN(hours) || hours <= 0;
  });
};

// 同一主任务内是否存在重复的非空枪名（与后端 validateDuplicateGunNames 规则一致）
export const hasDuplicateGunNames = (guns?: GunItem[]) => {
  const seen = new Set<string>();
  for (const gun of guns || []) {
    const name = String(gun?.name || '').trim();
    if (!name) continue;
    if (seen.has(name)) return true;
    seen.add(name);
  }
  return false;
};

export const getHoursInputValue = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === '') return '';
  const numericValue = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(numericValue) || numericValue === 0) return '';
  return value;
};

export const getGunHoursTotalInputValue = (guns?: GunItem[]) => {
  const total = (guns || []).reduce((sum, gun) => {
    const hours = typeof gun.hours === 'number' ? gun.hours : parseFloat(String(gun.hours));
    return sum + (isNaN(hours) ? 0 : hours);
  }, 0);
  return total > 0 ? total : '';
};

export const isMeaningfulTask = (item: TaskItem) => {
  if (item.leaveType) return true;
  const taskName = (item.taskName || '').trim();
  const gunsEmpty = !item.guns || item.guns.length === 0 || item.guns.every((g: any) => !g.name || g.name.trim() === '未命名');
  return Boolean(taskName || !gunsEmpty);
};

export const getTaskHours = (item: TaskItem) => {
  // 「暂停/取消」任务工时沿用当前值（0 也能保存），不为 0 时与普通任务一样计入统计
  const mainHours = typeof item.hours === 'number' ? item.hours : (parseFloat(String(item.hours)) || 0);
  const gunsHours = (item.guns || []).reduce((gSum, g) => gSum + (typeof g.hours === 'number' ? g.hours : (parseFloat(String(g.hours)) || 0)), 0);
  return item.guns && item.guns.length > 0 ? gunsHours : mainHours;
};

export const formatTaskMetaTime = (value?: string) => {
  if (!value) return '暂无记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '暂无记录';
  return format(date, 'yyyy-MM-dd HH:mm');
};

export const buildTaskMetadataTitle = (item: TaskItem) => {
  const creator = item.createdBy?.name || item.createdBy?.username || '暂无记录';
  const updater = item.updatedBy?.name || item.updatedBy?.username || '暂无记录';
  return [
    `创建者：${creator}`,
    `创建时间：${formatTaskMetaTime(item.createdAt)}`,
    `最后修改者：${updater}`,
    `最后修改时间：${formatTaskMetaTime(item.updatedAt)}`
  ].join('\n');
};
