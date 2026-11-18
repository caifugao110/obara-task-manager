// 焊枪名「已被主任务使用」判定（台账页枪名天蓝色标识的唯一口径）
//
// 判定规则：只要主任务里的枪名用到了台账登记的「编号」，就算已使用——
// 编号之后写什么、有没有写，都不影响判定：
//   台账 SRTC-2C15011    ← 主任务 SRTC-2C15011-WL
//   台账 SRTC-2C15008    ← 主任务 SRTC-2C15008S-OPL1   （后缀里也带数字）
//   台账 RBC14050        ← 主任务 RBC14050L / RBC14053S
//   台账 SRTC-5C14493    ← 主任务 SRTC-5C14493两次 / SRTC-5C14493A
//   台账 SRTX-17416      ← 主任务 SRTC-20873/SRTX-17416 （一条任务里塞了多把枪）
//
// 编号之后的尾巴是自由文本，既可能纯字母（L / -WL），也可能带数字（S-OPL1、-2024），
// 所以不能靠「截到最后一个数字」这类机械截断，而是按「编号边界」比对：
// 两个枪名中，短的那个必须是长的那个的前缀，且**紧跟其后的字符不能是数字**。
//   SRTC-2C1500 vs SRTC-2C15008 → 后面紧跟 8（数字）→ 不是同一把枪
//   台账 SRTC-2C15008 vs 任务 SRTC-2C15008S-OPL1 → 后面紧跟 S → 同一把枪
// 这条边界规则同时保证前缀里的数字（SRTC-2C / SRTC-5AC / C01-C）不会被当成编号截断，
// 否则 PTC-ALC0031 与 PTX-ALC0031、SRTC-2C 下任意两把枪都会串号。

// 备注 / 说明类字符：中文、中英文括号等，出现即代表「编号之后的内容」开始
const REMARK_CHARS = /[\u3400-\u9fff\uf900-\ufaff（）()[\]［］【】「」《》]/;
// 多枪名分隔符：斜杠、顿号、逗号、分号、加号、竖线与空白
const MULTI_GUN_SEPARATOR = /[/,、;+|]|\s+/;

const isDigit = (ch?: string): boolean => !!ch && ch >= '0' && ch <= '9';

/**
 * 拆出一把枪名里的所有「枪名片段」：
 * 一条任务枪名可能塞了多把枪（SRTC-20873/SRTX-17416、"SRTC-5C14550 SRTX-5C24033修改"），
 * 按分隔符拆开；每段再切掉备注（中文 / 括号），只留编号部分。
 */
const splitGunSegments = (gunName?: string | null): string[] => {
  const normalized = String(gunName ?? '').trim().toUpperCase();
  if (!normalized) return [];
  const segments: string[] = [];
  normalized.split(MULTI_GUN_SEPARATOR).forEach(segment => {
    const head = segment.split(REMARK_CHARS)[0];
    if (head) segments.push(head);
  });
  return segments;
};

/**
 * 两个枪名片段是否指同一个编号：
 * 短的是长的前缀，且紧跟其后的字符不是数字（到字符串结尾也算）。
 */
const isSameGunNumber = (a: string, b: string): boolean => {
  if (a === b) return true;
  if (b.length > a.length) return b.startsWith(a) && !isDigit(b[a.length]);
  return a.startsWith(b) && !isDigit(a[b.length]);
};

export type GunUsageChecker = (gunName?: string | null) => boolean;

/**
 * 建立「该枪名是否已被主任务使用」判定器。
 * usedGunNames 为主任务侧收集到的枪名（/tasks/used-gun-names 原样返回）；
 * 入参始终是**台账登记的枪名**，因此按「台账名 ↔ 任务名片段」的编号边界比对。
 * 结果按枪名缓存，便于在表格渲染中反复调用。
 */
export const createGunUsageChecker = (usedGunNames: Iterable<string>): GunUsageChecker => {
  const usedSegments: string[] = [];
  for (const name of usedGunNames) {
    splitGunSegments(name).forEach(segment => usedSegments.push(segment));
  }
  const cache = new Map<string, boolean>();
  return (gunName?: string | null) => {
    const raw = String(gunName ?? '').trim();
    if (!raw) return false;
    const cached = cache.get(raw);
    if (cached !== undefined) return cached;
    const probes = splitGunSegments(raw);
    const used = probes.some(probe => usedSegments.some(segment => isSameGunNumber(probe, segment)));
    cache.set(raw, used);
    return used;
  };
};
