/**
 * 「分组」下拉的公共定义：任务分配类弹窗（快速确认图安排 / 台帐分配确认图任务）
 * 都按「登录人所在分组」默认过滤设计人员，未分组时默认「全部人员」。
 */

// 代表不按分组过滤的哨兵值（真实分组名不会用这个字符串）
export const ALL_GROUPS = '__all_groups__';
export const ALL_GROUPS_LABEL = '全部人员';

interface GroupedDesigner {
  group?: string;
}

/** 登录人所属分组（已 trim，未分组时为空字符串） */
export const resolveUserGroup = (group?: string | null): string => String(group || '').trim();

/** 分组下拉的默认值：本组优先，未分组时落到「全部人员」 */
export const defaultGroupOf = (userGroup: string): string => userGroup || ALL_GROUPS;

/**
 * 分组下拉选项（不含「全部人员」这一项，由调用方自行挂在最前面）：
 * 设计人员现有分组 ∪ 登录人自身分组（本组暂时没有设计人员时也要能选中），中文排序。
 */
export const buildGroupOptions = (designers: GroupedDesigner[], userGroup: string): string[] => {
  const names = new Set<string>();
  designers.forEach(designer => {
    const name = String(designer.group || '').trim();
    if (name) names.add(name);
  });
  if (userGroup) names.add(userGroup);
  return Array.from(names).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
};

/** 按分组过滤设计人员；「全部人员」时原样返回 */
export const designersInGroup = <T extends GroupedDesigner>(designers: T[], group: string): T[] =>
  group === ALL_GROUPS
    ? designers
    : designers.filter(designer => String(designer.group || '').trim() === group);
