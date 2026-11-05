/**
 * 密码类表单控件的统一外观。
 * 「修改密码」弹窗（Dashboard）与「首次登录改密」独立页（ChangePassword）共用，
 * 避免同一套视觉在两处各写一遍后逐渐走样。
 */
export const PWD_INPUT_CLASS =
  'w-full h-11 pl-10 pr-11 rounded-xl border border-slate-200 bg-slate-50/70 text-sm font-medium text-slate-800 outline-none transition-all duration-150 placeholder:font-normal placeholder:text-slate-400 hover:border-slate-300 focus:border-[#217346] focus:bg-white focus:ring-4 focus:ring-[#217346]/10';

export const PWD_EYE_BTN_CLASS =
  'absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 outline-none transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-[#217346]';

/** 品牌绿主按钮（确认修改） */
export const PWD_PRIMARY_BTN_CLASS =
  'flex w-full items-center justify-center gap-2 rounded-xl bg-[#217346] px-5 text-sm font-bold text-white shadow-lg shadow-[#217346]/20 outline-none transition-all duration-150 hover:bg-[#1a5c38] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none';

/** 密码强度 0-4 对应的文案与配色 */
export const PWD_STRENGTH_META = [
  { label: '', color: 'bg-slate-200', text: '' },
  { label: '偏弱', color: 'bg-red-400', text: 'text-red-500' },
  { label: '一般', color: 'bg-amber-400', text: 'text-amber-500' },
  { label: '较强', color: 'bg-emerald-400', text: 'text-emerald-600' },
  { label: '很强', color: 'bg-[#217346]', text: 'text-[#217346]' },
];

/** 按长度/字符种类粗略评估密码强度，仅用于界面反馈，不参与提交校验 */
export const scorePassword = (password: string): number => {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[a-zA-Z]/.test(password) && /\d/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;
  if (password.length >= 12) score += 1;
  return score;
};
