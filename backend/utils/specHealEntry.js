/**
 * 主页面「仕样自愈」的两个判定与结果构造（纯函数）
 *
 * 为什么要区分「有没有枪名行」：
 * 任务单元格里，主任务名（客户名 + 任务类型 + 纳期）下面可以挂若干枪名行，
 * 只有挂了枪名的任务才真正对应排产对象；没挂枪名的主任务属于计划期占位/待分配，
 * 客户名与纳期由人工维护，自愈不去改写它，也不为它解析仕样书。
 * 因此「只在不含枪名行的任务里出现过」的仕样号直接标记为 skipped（已跳过）。
 *
 * 判定口径与前端 `isMeaningfulTask`（Dashboard/utils.ts）保持一致：
 * 空名字与占位名「未命名」都不算一条真实枪名行。
 */

const PLACEHOLDER_GUN_NAMES = new Set(['未命名']);

const NO_GUN_ROWS_MESSAGE = '任务不含枪名行，已跳过';
const UNPARSED_SUFFIX_MESSAGE = '任务名里的任务内容后缀认不出来（如更改通知单号不是 FY 开头），已跳过';
const MIXED_SKIP_MESSAGE = '任务不含枪名行、且任务内容后缀认不出来，已跳过';

const collapseSpace = (value) => String(value || '').replace(/\s+/g, ' ').trim();

/** 任务名尾部的任务内容关键字（与前端 splitDesignTaskName 同一份口径） */
const TASK_TYPE_KEYWORDS = ['确认图修改', '确认图', '设计变更', '既制审图', '暂停/取消', '设计'];
const TASK_TYPE_SUFFIX_RE = new RegExp(`\\s+(${TASK_TYPE_KEYWORDS.join('|')})$`);
const DEADLINE_SUFFIX_RE = /\s*(\[\d{1,2}\/\d{1,2}\])$/;

/**
 * 是否是一个「更改通知单号」：**必须以 FY 开头**，如 FY26-0035 / FY26-0035-01 / FY26-0035A
 *
 * 规则：`FY` + 两位年份 + `-` + 数字，后面可再续字母数字与 `-`；不含空格与中文。
 * 收紧到 FY 前缀是为了不误伤「X 设计变更 讨论 L243」这类正常文字——
 * 认不出来就整段留在客户名里，宁可不动也不拆坏任务名。
 */
const CHANGE_NOTICE_NO_RE = /^FY\d{2}-\d+[A-Za-z0-9-]*$/i;
function isChangeNoticeNo(text) {
  return CHANGE_NOTICE_NO_RE.test(String(text || '').trim());
}

/**
 * 拆分任务名：主体（客户名） + 尾部任务类型 + 尾部纳期 [M/D]
 *
 * 两个坑必须一起处理，否则写回会丢数据：
 * 1. 「设计变更」可能带更改通知单号（`<主体> 设计变更 FY26-0035`）。单号属于任务内容后缀，
 *    若只认末尾的「设计变更」，整段 `设计变更 FY26-0035` 会被当成客户名差异，
 *    于是这类任务被误判「客户名不一致」，写回时把单号删掉。
 * 2. 主体里本来带「设计变更」四个字的情况，只认「空格 + 设计变更」这种后缀写法，
 *    避免把客户名拆坏。
 *
 * 口径必须与前端 `Dashboard/utils.splitDesignTaskName` 完全一致，
 * 否则「检测」与手工「相同仕样号同步更新」会给出不同结果。
 *
 * @param {string} taskName 原始任务名
 * @returns {{baseName:string, typeSuffix:string, deliverySuffix:string}}
 */
function splitHealTaskName(taskName) {
  const trimmed = String(taskName || '').trim();
  const deadlineMatch = trimmed.match(DEADLINE_SUFFIX_RE);
  const withoutDeadline = deadlineMatch && typeof deadlineMatch.index === 'number'
    ? trimmed.slice(0, deadlineMatch.index).trim()
    : trimmed;
  const deliverySuffix = deadlineMatch ? deadlineMatch[1] : '';

  const changeIndex = withoutDeadline.lastIndexOf(' 设计变更');
  if (changeIndex >= 0) {
    const changeNo = withoutDeadline.slice(changeIndex + ' 设计变更'.length).trim();
    // 只认 FY 开头的通知单号；认不出来就把整段留在主体里，不猜
    if (isChangeNoticeNo(changeNo)) {
      return {
        baseName: withoutDeadline.slice(0, changeIndex).trim(),
        typeSuffix: ` 设计变更 ${changeNo}`,
        deliverySuffix
      };
    }
  }

  const typeMatch = withoutDeadline.match(TASK_TYPE_SUFFIX_RE);
  const baseName = typeMatch && typeof typeMatch.index === 'number'
    ? withoutDeadline.slice(0, typeMatch.index).trim()
    : withoutDeadline;
  return {
    baseName,
    typeSuffix: typeMatch ? ` ${typeMatch[1]}` : '',
    deliverySuffix
  };
}

/**
 * 按「仕样书客户名 + 原任务类型后缀 + 纳期」重新拼出任务名
 *
 * typeSuffix（含设计变更的更改通知单号）原样保留：自愈只校准客户名与纳期，
 * 不改任务内容，也不丢单号。仕样书没有纳期时保留原纳期。
 *
 * 认不出任务内容后缀时返回空串——调用方据此跳过改写，绝不能让改写把任务内容删掉。
 *
 * @param {string} taskName 原任务名
 * @param {string} expectedClient 仕样书客户名（空串表示沿用原客户名）
 * @param {string} expectedDelivery 仕样书纳期（空串表示沿用原纳期）
 */
function buildHealTaskName(taskName, expectedClient, expectedDelivery) {
  const parts = splitHealTaskName(taskName);
  if (hasUnparsedTypeSuffix(parts)) return '';
  const clientPart = expectedClient || parts.baseName;
  const deliveryPart = expectedDelivery || parts.deliverySuffix;
  return `${clientPart}${parts.typeSuffix}${deliveryPart ? ` ${deliveryPart}` : ''}`.trim();
}

/**
 * 单条任务的差异判定
 *
 * 三档标签：
 * - client        客户名不一致（只看去多余空格后的文本，分隔符差异也算不一致）
 * - delivery      纳期有值但被改写
 * - delivery-add  原来没有纳期、这次补上——语义是「增加纳期」，不该与「纳期」混为一谈
 *
 * @param {{baseName?:string, deliverySuffix?:string}} parts splitSelfHealTaskName 的结果
 * @param {string} expectedClient 仕样书客户名（空串表示本次不校正客户名）
 * @param {string} expectedDelivery 仕样书纳期 [M/D]（空串表示本次不校正纳期）
 * @returns {{clientChanged:boolean, deliveryChanged:boolean, deliveryAdded:boolean, flags:Array<'client'|'delivery'|'delivery-add'>}}
 */
function describeTaskNameDiff(parts, expectedClient, expectedDelivery) {
  const baseName = (parts && parts.baseName) || '';
  const currentDelivery = (parts && parts.deliverySuffix) || '';
  const expected = String(expectedClient || '');
  const expectedSuffix = String(expectedDelivery || '');

  const clientChanged = expected !== '' && collapseSpace(baseName) !== collapseSpace(expected);
  const deliveryChanged = expectedSuffix !== '' && currentDelivery !== expectedSuffix;
  // 原任务名里根本没有 [M/D]：这次是「补上纳期」，不是「改纳期」
  const deliveryAdded = deliveryChanged && currentDelivery === '';

  return {
    clientChanged,
    deliveryChanged,
    deliveryAdded,
    flags: [
      ...(clientChanged ? ['client'] : []),
      ...(deliveryChanged ? [deliveryAdded ? 'delivery-add' : 'delivery'] : [])
    ]
  };
}

/** 该任务是否至少含一条真实枪名行（非空、非「未命名」） */
function hasNamedGunRows(item) {
  const guns = Array.isArray(item && item.guns) ? item.guns : [];
  return guns.some(gun => {
    const name = String((gun && gun.name) || '').trim();
    return Boolean(name) && !PLACEHOLDER_GUN_NAMES.has(name);
  });
}

/**
 * 后缀识别失败的监测词：只放「几乎不会出现在客户名里」的复合词。
 * 刻意不含「设计」「暂停」这类单字/常用词，避免把「XX设计院」「图纸设计」当成任务内容后缀。
 */
const SUFFIX_MONITOR_KEYWORDS = ['确认图修改', '确认图', '设计变更', '既制审图', '暂停/取消'];

/**
 * 任务名里明明有任务内容后缀，却没被拆出来
 *
 * 典型场景：「X 设计变更 ECO1234」——单号不是 FY 开头（或写法不规范），
 * 整段留在 baseName 里。此时按客户名比对必然「不一致」，写回就会把这段删掉。
 * 这种任务一律不参与自愈（标为已跳过），宁可不动，也不丢任务内容。
 *
 * @param {{baseName?:string, typeSuffix?:string}} parts splitHealTaskName 的结果
 */
function hasUnparsedTypeSuffix(parts) {
  if (!parts || parts.typeSuffix) return false;
  const base = String(parts.baseName || '');
  return SUFFIX_MONITOR_KEYWORDS.some(keyword => {
    const index = base.lastIndexOf(` ${keyword}`);
    if (index < 0) return false;
    // 关键字后面还有内容却没被当成后缀拆走 → 认不出来
    return base.slice(index + keyword.length + 1).trim() !== '';
  });
}

/**
 * 已跳过的仕样号结果条目
 *
 * itemCount 恒为 0：它不参与「需更新任务」统计，也不会被 apply 选中；
 * 真实涉及的任务条数按原因分别放在 noGunItemCount / unparsedItemCount，仅供界面说明为什么跳过。
 *
 * 跳过原因：
 * - NO_GUN_ROWS          只在不含枪名行的任务里出现过
 * - UNPARSED_TYPE_SUFFIX 任务名里的任务内容后缀认不出来（写回会删掉它）
 * - NO_GUN_ROWS_AND_UNPARSED 两种都有
 *
 * @param {string} specNumber 仕样号
 * @param {number|{noGunItemCount?:number, unparsedItemCount?:number}} counts 各原因涉及的条数
 */
function buildSkippedSpecEntry(specNumber, counts) {
  const opts = typeof counts === 'number' ? { noGunItemCount: counts } : (counts || {});
  const noGunItemCount = Math.max(0, Math.floor(Number(opts.noGunItemCount) || 0));
  const unparsedItemCount = Math.max(0, Math.floor(Number(opts.unparsedItemCount) || 0));
  const hasNoGun = noGunItemCount > 0;
  const hasUnparsed = unparsedItemCount > 0;

  let code = 'NO_GUN_ROWS';
  let message = NO_GUN_ROWS_MESSAGE;
  if (hasUnparsed && !hasNoGun) {
    code = 'UNPARSED_TYPE_SUFFIX';
    message = UNPARSED_SUFFIX_MESSAGE;
  } else if (hasUnparsed && hasNoGun) {
    code = 'NO_GUN_ROWS_AND_UNPARSED';
    message = MIXED_SKIP_MESSAGE;
  }

  return {
    specNumber: String(specNumber || ''),
    status: 'skipped',
    resolved: false,
    expectedClient: '',
    expectedDelivery: '',
    code,
    message,
    itemCount: 0,
    noGunItemCount,
    unparsedItemCount,
    changes: [],
    items: [],
    itemsTruncated: false
  };
}

module.exports = {
  hasNamedGunRows,
  hasUnparsedTypeSuffix,
  buildSkippedSpecEntry,
  describeTaskNameDiff,
  splitHealTaskName,
  buildHealTaskName,
  isChangeNoticeNo,
  collapseSpace,
  NO_GUN_ROWS_MESSAGE,
  UNPARSED_SUFFIX_MESSAGE,
  MIXED_SKIP_MESSAGE,
  PLACEHOLDER_GUN_NAMES,
  TASK_TYPE_KEYWORDS
};
