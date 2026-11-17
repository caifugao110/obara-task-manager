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
// 从左到右取第一个命中：避免「58645>湖北卡玛_四川江淮-G2621」这类任务名中
// 尾部的项目代码（G2621）抢在开头真正的仕样号前面被提取
export const extractSpecNumber = (taskName: string): string | null => {
  const match = taskName.match(/\b(?:[A-Za-z]-?)?(\d{4,6})\b/);
  return match ? match[1] : null;
};

/** 「设计变更」任务内容后缀 */
export const DESIGN_CHANGE_SUFFIX = '设计变更';
/** 「设计变更」的更改通知单号输入框占位提示（短文案，配合窄输入框，避免被裁断） */
export const CHANGE_NOTICE_PLACEHOLDER = '更改通知单号';
/** 任务名末尾的纳期后缀：[M/D] */
const TASK_DEADLINE_SUFFIX_RE = /\s*(\[\d{1,2}\/\d{1,2}\])$/;

/**
 * 「设计变更」任务名结构：`<任务主体> 设计变更 <更改通知单号> [M/D]`
 * —— 通知单号可空（空时任务名就是 `<任务主体> 设计变更`），纳期始终留在最末尾，
 * 保证各处按 `$` 取纳期的解析（显示纳期、手动纳期、同步仕样号…）不受影响。
 */
export interface DesignChangeNameParts {
  /** 任务主体（去掉任务内容后缀与纳期） */
  base: string;
  /** 更改通知单号，未填写时为空串 */
  changeNo: string;
  /** 纳期后缀，如 "[9/15]"；没有纳期时为空串 */
  deadline: string;
}

/** 拆出「设计变更」任务名的三段：主体 / 更改通知单号 / 纳期 */
export const parseDesignChangeName = (taskName?: string | null): DesignChangeNameParts => {
  const raw = String(taskName ?? '').trim();
  const deadlineMatch = raw.match(TASK_DEADLINE_SUFFIX_RE);
  const deadline = deadlineMatch ? deadlineMatch[1] : '';
  const withoutDeadline = deadline ? raw.slice(0, raw.length - (deadlineMatch?.[0].length || 0)).trim() : raw;
  // 只认「空格 + 设计变更」这种后缀写法：任务主体里本来带「设计变更」四个字也不会被误拆
  const suffix = ` ${DESIGN_CHANGE_SUFFIX}`;
  const suffixIndex = withoutDeadline.lastIndexOf(suffix);
  if (suffixIndex >= 0) {
    return {
      base: withoutDeadline.slice(0, suffixIndex).trim(),
      changeNo: withoutDeadline.slice(suffixIndex + suffix.length).trim(),
      deadline,
    };
  }
  // 没有空格的写法（或整段就是「设计变更」）：去掉末尾这四个字，单号为空
  if (withoutDeadline.endsWith(DESIGN_CHANGE_SUFFIX)) {
    return {
      base: withoutDeadline.slice(0, withoutDeadline.length - DESIGN_CHANGE_SUFFIX.length).trim(),
      changeNo: '',
      deadline,
    };
  }
  return { base: withoutDeadline, changeNo: '', deadline };
};

/** 按「主体 + 通知单号（可空）+ 纳期（可空）」重新拼出「设计变更」任务名 */
export const composeDesignChangeName = (base: string, changeNo?: string | null, deadline?: string | null) => {
  const head = [String(base ?? '').trim(), DESIGN_CHANGE_SUFFIX, String(changeNo ?? '').trim()]
    .filter(Boolean)
    .join(' ');
  const tail = String(deadline ?? '').trim();
  return tail ? `${head} ${tail}` : head;
};

/**
 * 是否是一个「更改通知单号」：**必须以 FY 开头**，如 FY26-0035 / FY26-0035-01 / FY26-0035A
 *
 * 规则：`FY` + 两位年份 + `-` + 数字，后面可再续字母数字与 `-`；不含空格与中文。
 * 收紧到 FY 前缀是为了不误伤「X 设计变更 讨论 L243」这类正常文字——
 * 认不出来就整段留在客户名里，宁可不动也不拆坏任务名。
 * 与后端 `utils/specHealEntry.js` 的 isChangeNoticeNo 同一口径。
 */
const CHANGE_NOTICE_NO_RE = /^FY\d{2}-\d+[A-Za-z0-9-]*$/i;
const isChangeNoticeNo = (text?: string | null) => CHANGE_NOTICE_NO_RE.test(String(text ?? '').trim());

/**
 * 后缀监测词：与后端 `SUFFIX_MONITOR_KEYWORDS` 同一份。
 * 刻意不含「设计」「暂停」这类单字/常用词，避免把「XX设计院」当成任务内容后缀。
 */
const SUFFIX_MONITOR_KEYWORDS = ['确认图修改', '确认图', '设计变更', '既制审图', '暂停/取消'];

/**
 * 任务名里明明有任务内容后缀，却没被拆出来
 *
 * 典型场景：「X 设计变更 ECO1234」——单号不是 FY 开头（或写法不规范），整段留在 baseName 里。
 * 此时按客户名改写就会把这段删掉，调用方应跳过该任务而不是硬写。
 * 与后端 `hasUnparsedTypeSuffix` 同一口径。
 */
export const hasUnparsedTaskSuffix = (taskName?: string | null) => {
  const { baseName, typeSuffix } = splitDesignTaskName(String(taskName ?? ''));
  if (typeSuffix) return false;
  return SUFFIX_MONITOR_KEYWORDS.some(keyword => {
    const index = baseName.lastIndexOf(` ${keyword}`);
    if (index < 0) return false;
    return baseName.slice(index + keyword.length + 1).trim() !== '';
  });
};

export const splitDesignTaskName = (taskName: string) => {
  const trimmed = taskName.trim();
  const deadlineMatch = trimmed.match(/\s*(\[\d{1,2}\/\d{1,2}\])$/);
  const withoutDeadline = deadlineMatch && typeof deadlineMatch.index === 'number'
    ? trimmed.slice(0, deadlineMatch.index).trim()
    : trimmed;
  // 「设计变更」可能带着更改通知单号（`<主体> 设计变更 FY26-0035`）：单号属于任务内容后缀的一部分，
  // 认出来整段一起带走，避免同步仕样号 / 改名时把单号丢掉
  const changeIndex = withoutDeadline.lastIndexOf(` ${DESIGN_CHANGE_SUFFIX}`);
  if (changeIndex >= 0) {
    const changeNo = withoutDeadline.slice(changeIndex + DESIGN_CHANGE_SUFFIX.length + 1).trim();
    // 只认 FY 开头的通知单号；认不出来就把整段留在主体里，不猜
    if (isChangeNoticeNo(changeNo)) {
      return {
        baseName: withoutDeadline.slice(0, changeIndex).trim(),
        typeSuffix: ` ${DESIGN_CHANGE_SUFFIX} ${changeNo}`,
      };
    }
  }
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

/**
 * 按仕样书重拼任务名（「相同仕样号同步更新」用）
 *
 * 认不出任务内容后缀时返回空串：调用方据此跳过该任务，
 * 否则改写会把「设计变更 ECO1234」这类认不出来的内容删掉。
 */
export const buildSyncedSpecTaskName = (originalTaskName: string, specInfo: SpecInfoResponse, specNumber: string, deliverySuffix: string) => {
  if (hasUnparsedTaskSuffix(originalTaskName)) return '';
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
