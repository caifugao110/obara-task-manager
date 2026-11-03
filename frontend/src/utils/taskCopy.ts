/**
 * 主任务「复制为表格」：把选中的主任务（主任务行 + 每个枪名行）写成一段
 * 带底色与实线边框的 HTML 表格，和纯文本一起放进剪贴板。**不含工时列**（只有任务名/枪名）。
 *
 * 效果等同于在 Excel 里框选一块区域按 Ctrl+C，再粘到支持富文本的地方：粘出来是**真实表格**
 * ——文字可以选中、可以改，底色和框线跟着走，不是图片。
 *
 * 几个必须注意的点：
 * 1. 富文本粘贴的目标（Office 系、各类网页编辑器）会丢掉 <style> / class，所以样式必须**全部内联**，
 *    并额外加 border / width 这类老式表格属性做兜底；
 * 2. 底色与文字色沿用表格里看到的配色（`getTaskDisplayColors`：暂停/取消纯红黑字、设计浅黄、
 *    已完成白底、加急亮黄红字…），保证「屏幕上什么样，粘出来就什么样」；
 * 3. **尺寸与折行位置对齐屏幕**：字号、行高、内边距与字体族都照抄表格，
 *    任务名列的宽度则由调用方从 DOM 实测后传入（`nameContentWidth`，见下方常量说明），
 *    因此任务名过长时的断行位置与用户在页面上看到的一模一样；
 *    在此基础上**整体等比放大 4/3**（见 `SCALE`）：页面上 11px 粘到 Excel / Word 里偏小，
 *    放大时字号、内边距、列宽一起乘，每行能放的字数不变，折行位置仍然对得上屏幕；
 * 4. 剪贴板同时写 `text/html` 与 `text/plain`：富文本场景取 HTML 得到表格；纯文本场景取
 *    每行一条任务名/枪名的纯文本，内容不丢。
 */
import {
  getLeaveRowColors,
  getTaskDisplayColors,
  isWhiteColor,
  TASK_TEXT_COLOR,
  type TaskColorConfig,
} from './taskColors';
import type { GunItem, TaskItem } from '../pages/Dashboard/types';

/* ---------- 尺寸：全部照抄主页面表格（SortableTask.tsx）的实测值 ---------- */
/**
 * 任务名列的**文本可用宽度**（px），拿不到 DOM 时的兜底。
 * 页面上的列宽是 18rem=288px，扣掉 1px 右边框与 pl-2(8) / pr-1.5(6) 后是 273px，
 * 但任务名前面还固定有一个「完成状态标记」按钮（hover 才显形，平时 opacity-0 却照样占位：
 * 18px + mr-1 的 4px），所以文字真正能用的是 273 - 22 = 251px。
 * 管理员额外有的「上移 / 下移」按钮不计入（按普通用户看到的样子算）。
 * 实际复制时由调用方用 DOM 实测后传进来（`nameContentWidth`），这里只是极端情况下的兜底。
 */
const DEFAULT_NAME_CONTENT_WIDTH = 251;
/** 字号：表格 text-[11px]（复制时按 SCALE 放大） */
const FONT_SIZE = 11;
/** 行高：表格 leading-relaxed = 1.625（相对字号，随放大自动跟着变大） */
const LINE_HEIGHT = 1.625;
/** 内边距：py-1.5 / pl-2 / pr-1.5（复制时按 SCALE 放大） */
const PAD_Y = 6;
const PAD_LEFT = 8;
const PAD_RIGHT = 6;

/**
 * 整体放大系数：页面表格是 11px，粘到 Excel / Word 里看着偏小，统一放大 4/3（≈1.333）。
 * **必须等比放大**：字号、内边距、任务名列宽度一起乘，每行还能放同样多的字，
 * 折行位置才继续和屏幕一致；只放大字号会平白多折出一行。
 */
const SCALE = 4 / 3;
/** 页面 px → 复制时 px：保留两位小数，避免样式串过长（14.666… → 14.67） */
const scaled = (value: number) => Math.round(value * SCALE * 100) / 100;
/** 拼一个已放大、带 px 单位的样式值 */
const px = (value: number) => `${scaled(value)}px`;

/**
 * 字体族直接照抄 Tailwind 默认 sans（表格用的就是它），末尾补微软雅黑兜底。
 * 字体不一致 → 同样的字宽度不同 → 断行位置跟着跑偏，所以这里不能随便换字体。
 */
const FONT_FAMILY = "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'Microsoft YaHei', sans-serif";

/** 边框颜色：纯黑实线，比页面上的浅灰更醒目（粘出去后仍能看清格子边界） */
const BORDER_COLOR = '#000000';

const ESCAPE_PATTERN = /[&<>"']/g;
const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (value: string) => String(value ?? '').replace(ESCAPE_PATTERN, ch => ESCAPE_MAP[ch]);

/** 请假/出差行与表格一致显示状态文字而不是任务名 */
const resolveLeaveLabel = (item: TaskItem) => {
  if (item.leaveType === 'sick') return '事假';
  if (item.leaveType === 'vacation') return '休假';
  if (item.leaveType === 'illness') return '病假';
  if (item.leaveType === 'trip') {
    const name = (item.taskName || '').trim();
    if (!name) return '出差';
    return name.endsWith('出差') ? name : `${name}出差`;
  }
  return '';
};

interface TableRowModel {
  /** 任务名 / 枪名（请假行则是状态文字） */
  label: string;
  bg: string;
  textColor: string;
  /** 主任务行：与表格一致，无枪名时居中、有枪名时左对齐 */
  align: 'left' | 'center';
  /** 主任务行按 break-all 折行（表格主任务行带 break-all 类），枪名行按正常规则折行 */
  breakAll: boolean;
  /** 该行是否是「一条新主任务」的首行（用于多选时区分任务块） */
  startsTask: boolean;
}

export interface TaskTableOptions {
  /** 同一人同一天的若干主任务，按表格里的先后顺序 */
  items: TaskItem[];
  config: TaskColorConfig;
  /**
   * 任务名文本在页面上的实际可用宽度（px），由调用方用 DOM 实测。
   * 传了它就按它排版，任务名的断行位置与用户屏幕上看到的完全一致；
   * 不传则退回 DEFAULT_NAME_CONTENT_WIDTH。
   */
  nameContentWidth?: number;
}

/** 汇总出一张表的行模型：每条主任务先一行任务名，其后每行一个枪名 */
const buildRows = ({ items, config }: TaskTableOptions): TableRowModel[] => {
  const rows: TableRowModel[] = [];

  items.forEach(item => {
    const guns: GunItem[] = Array.isArray(item.guns) ? item.guns : [];
    const display = getTaskDisplayColors(config, item);
    const leaveColors = getLeaveRowColors(item.leaveType);
    const rowBg = leaveColors?.bg || display.bg;
    const rowTextColor = leaveColors ? (leaveColors.text || display.text || TASK_TEXT_COLOR) : display.text;

    rows.push({
      label: item.leaveType ? resolveLeaveLabel(item) : (item.taskName || '无'),
      bg: rowBg,
      textColor: rowTextColor,
      align: guns.length === 0 ? 'center' : 'left',
      breakAll: true,
      startsTask: true,
    });

    guns.forEach(gun => {
      rows.push({
        label: gun.name || '未命名',
        // 枪名被标记为「已完成」（白色）时该行保留白底
        bg: isWhiteColor(gun.color) ? '#ffffff' : rowBg,
        textColor: rowTextColor,
        align: 'left',
        breakAll: false,
        startsTask: false,
      });
    });
  });

  return rows;
};

/**
 * 任务名单元格样式：字号/行高/内边距/列宽都按页面实测值 **等比放大 SCALE 倍**
 * （contentWidth 传入的已经是放大后的宽度），这样折行位置仍与屏幕一致。
 */
const nameCellStyle = (row: TableRowModel, contentWidth: number) =>
  [
    // 显式声明 content-box：粘贴目标若全局设了 border-box（多数网页编辑器、本页面本身都这么做），
    // width 会被当成「含内边距的总宽」，文字可用宽度就少了 14px，断行点会整片前移。
    'box-sizing:content-box',
    `width:${contentWidth}px`,
    `background-color:${row.bg}`,
    `color:${row.textColor}`,
    `border:1px solid ${BORDER_COLOR}`,
    `padding:${px(PAD_Y)} ${px(PAD_RIGHT)} ${px(PAD_Y)} ${px(PAD_LEFT)}`,
    `text-align:${row.align}`,
    'vertical-align:middle',
    `font-family:${FONT_FAMILY}`,
    `font-size:${px(FONT_SIZE)}`,
    'font-weight:500',
    `line-height:${LINE_HEIGHT}`,
    'white-space:normal',
    // 主任务行与表格的 break-all 一致；枪名行优先按空格折
    row.breakAll ? 'word-break:break-all' : 'word-break:normal; overflow-wrap:anywhere',
  ].join(';');

/**
 * 生成可直接粘贴的 HTML 表格。
 * 用 table + td 的老式写法，兼容各家的富文本粘贴目标（Office 系、网页编辑器等）。
 */
export const buildTaskTableHtml = (options: TaskTableOptions): string => {
  const rows = buildRows(options);
  // td 的 width 是内容盒宽度（浏览器按 content-box 处理），因此这里直接用文本可用宽度；
  // 再按 SCALE 放大——字号同样放大，两者等比，折行位置与屏幕保持一致
  const screenContentWidth = Math.max(
    60,
    Math.round(options.nameContentWidth && options.nameContentWidth > 60
      ? options.nameContentWidth
      : DEFAULT_NAME_CONTENT_WIDTH)
  );
  const nameContentWidth = scaled(screenContentWidth);
  const body = rows
    // width 属性只作兜底（老式解析器不认小数），真实宽度由 style 里的 px 决定
    .map(row => `<tr><td width="${Math.round(nameContentWidth)}" style="${nameCellStyle(row, nameContentWidth)}">${escapeHtml(row.label)}</td></tr>`)
    .join('');

  return [
    `<table border="1" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid ${BORDER_COLOR};font-family:${FONT_FAMILY};font-size:${px(FONT_SIZE)};color:${TASK_TEXT_COLOR};">`,
    '<tbody>',
    body,
    '</tbody>',
    '</table>',
  ].join('');
};

/**
 * 纯文本版本：每行一条任务名/枪名（不带 Tab）。
 * 只有一列，粘到记事本/终端或 Excel 里都直接是一条一条的文字。
 */
export const buildTaskTableText = (options: TaskTableOptions): string =>
  buildRows(options)
    .map(row => row.label)
    .join('\n');

/** 纯文本兜底复制（异步剪贴板 → 临时 textarea + execCommand） */
const copyPlainText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 继续走 execCommand 兜底
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};

/**
 * 用 copy 事件桥 + execCommand('copy') 写剪贴板。
 * 这是**不需要安全上下文**的富文本复制方式：execCommand 会触发一次 copy 事件，
 * 我们在事件里直接往 clipboardData 塞 text/html 与 text/plain，浏览器就会把这些格式
 * 一起放进系统剪贴板。局域网 http（非 localhost）环境下这是唯一可靠的富文本路径。
 */
const copyViaCopyEvent = (html: string, text: string): boolean => {
  if (typeof document.execCommand !== 'function') return false;
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/html', html);
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
  };
  try {
    document.addEventListener('copy', onCopy, true);
    const ok = document.execCommand('copy');
    return ok;
  } catch {
    return false;
  } finally {
    document.removeEventListener('copy', onCopy, true);
  }
};

/** 兜底：临时可编辑容器 + 选中 + execCommand('copy')（copy 事件桥不可用时的老办法） */
const copyViaEditableSelection = (html: string): boolean => {
  const holder = document.createElement('div');
  holder.setAttribute('contenteditable', 'true');
  // 不能用 display:none / visibility:hidden，否则选不中；放到可视区外并透明
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:420px;opacity:0;';
  holder.innerHTML = html;
  document.body.appendChild(holder);

  const previousActive = document.activeElement as HTMLElement | null;
  const selection = window.getSelection();
  const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  let ok = false;
  try {
    const range = document.createRange();
    range.selectNodeContents(holder);
    selection?.removeAllRanges();
    selection?.addRange(range);
    // 必须 focus，否则部分 Chromium 版本会把「复制」当成无效命令
    holder.focus();
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    selection?.removeAllRanges();
    if (previousRange) selection?.addRange(previousRange);
    document.body.removeChild(holder);
    previousActive?.focus?.();
  }
  return ok;
};

/**
 * 把主任务表格放进剪贴板。
 * 依次尝试 4 条路径，前两条能拿到「富文本表格」，后两条至少保证内容不丢：
 * ① 异步剪贴板 API（HTTPS / localhost）
 * ② copy 事件桥 + execCommand（局域网 http 主力路径）
 * ③ 临时可编辑容器 + 选中 + execCommand
 * ④ 纯文本
 * @returns 'rich' 已写入 HTML 表格 / 'plain' 只写入了纯文本 / 'failed' 剪贴板完全不可用
 */
export const copyTaskTableToClipboard = async (options: TaskTableOptions): Promise<'rich' | 'plain' | 'failed'> => {
  const html = buildTaskTableHtml(options);
  const text = buildTaskTableText(options);

  // 路径 1：异步剪贴板 API，一次写入 text/html + text/plain
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return 'rich';
    }
  } catch {
    // 非安全上下文（局域网 http）、失去用户手势、权限被拒等，继续往下走
  }

  // 路径 2：copy 事件桥（不要求 HTTPS，最稳）
  if (copyViaCopyEvent(html, text)) return 'rich';

  // 路径 3：可编辑容器 + 选中
  if (copyViaEditableSelection(html)) return 'rich';

  // 路径 4：只给纯文本，至少内容不丢
  const plainOk = await copyPlainText(text);
  if (plainOk) return 'plain';

  console.warn('[taskCopy] 剪贴板不可用：包括 execCommand 与纯文本在内的所有路径都失败');
  return 'failed';
};
