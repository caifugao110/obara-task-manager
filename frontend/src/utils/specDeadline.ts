/**
 * 纳期（任务名尾部的 [M/D] 标记）工具
 *
 * 主页面任务编辑模态框、Shift×2 快速添加确认图修改、焊枪台账批量分配与
 * 焊枪台账 Shift×2 快速确认图安排都需要「按仕样号查纳期并拼到任务名末尾」，
 * 这里统一收口，避免每个入口各写一份日期解析与请求逻辑。
 *
 * 约定：任务名中的纳期形如 `客户名 确认图修改 [9/15]`，位于末尾；
 * 同一任务名只保留一个纳期，重复追加时先去掉旧的再拼新的。
 */

import { axiosInstance } from '../services/api';

export interface SpecDeliveryResult {
  success: boolean;
  date?: string;
  message?: string;
}

const DEADLINE_SUFFIX_RE = /\s*\[\d{1,2}\/\d{1,2}\]\s*$/;

// 去掉任务名末尾的纳期标记
export const stripDeadlineSuffix = (taskName: string): string =>
  String(taskName || '').replace(DEADLINE_SUFFIX_RE, '').trim();

// 任务名是否已带纳期标记
export const hasDeadlineSuffix = (taskName: string): boolean =>
  DEADLINE_SUFFIX_RE.test(String(taskName || '').trim());

// 在任务名末尾拼接纳期（suffix 为空时仅返回去掉旧纳期的名称）
export const appendDeadlineSuffix = (taskName: string, suffix?: string | null): string => {
  const base = stripDeadlineSuffix(taskName);
  return suffix ? `${base} ${suffix}` : base;
};

// YYYY-MM-DD → [M/D]，无法解析时返回 null
export const getDeliveryDateSuffix = (deliveryDate?: string | null): string | null => {
  if (!deliveryDate) return null;
  const dateMatch = String(deliveryDate).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!dateMatch) return null;
  const month = parseInt(dateMatch[2], 10);
  const day = parseInt(dateMatch[3], 10);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
  return `[${month}/${day}]`;
};

// 从任意文本（任务名 / 台账客户列）里提取与系统配置位数一致的仕样号
export const extractSpecNumbers = (text: string, digits: number): string[] => {
  const raw = String(text || '');
  if (!raw.trim() || !digits) return [];
  const re = new RegExp(`(?<!\\d)\\d{${digits}}(?!\\d)`, 'g');
  return Array.from(new Set(raw.match(re) || []));
};

// 查询仕样号纳期（后端解析仕样书 PDF，超时设长一些）
export const fetchSpecDeliveryDate = async (specNumber: string): Promise<SpecDeliveryResult> => {
  const spec = String(specNumber || '').trim();
  if (!spec) return { success: false, message: '缺少仕样号' };
  try {
    const res = await axiosInstance.post('/spec/delivery-date', { specNumber: spec }, { timeout: 15000 } as any);
    return res.data || { success: false, message: '未返回纳期信息' };
  } catch {
    return { success: false, message: '获取纳期信息超时' };
  }
};

// 仕样号 → [M/D] 的内存缓存：同一仕样号在弹窗预览与提交时会被查两次，
// 每次都解析 PDF 太慢。未查到纳期不缓存，后续仍可重试。
const deliverySuffixCache = new Map<string, Promise<string | null>>();

export const clearSpecDeadlineCache = () => deliverySuffixCache.clear();

export const resolveSpecDeadlineSuffix = (specNumber: string): Promise<string | null> => {
  const spec = String(specNumber || '').trim();
  if (!spec) return Promise.resolve(null);
  const cached = deliverySuffixCache.get(spec);
  if (cached) return cached;
  const task = fetchSpecDeliveryDate(spec)
    .then(result => {
      const suffix = result.success ? getDeliveryDateSuffix(result.date) : null;
      if (!suffix) deliverySuffixCache.delete(spec);
      return suffix;
    })
    .catch(() => {
      deliverySuffixCache.delete(spec);
      return null;
    });
  deliverySuffixCache.set(spec, task);
  return task;
};

// 文本 → 纳期后缀：按顺序尝试其中包含的仕样号，返回第一个能查到纳期的
export const resolveTextDeadlineSuffix = async (text: string, digits: number): Promise<string | null> => {
  const specs = extractSpecNumbers(text, digits);
  for (const spec of specs) {
    const suffix = await resolveSpecDeadlineSuffix(spec);
    if (suffix) return suffix;
  }
  return null;
};
