'use strict';

// 组长规则：营业担当 → 组长。
// 前端「添加/编辑」时会按规则自动带出组长，状态跟踪同步大日程时后端也要用同一份规则，
// 因此把默认规则与匹配逻辑抽到工具层，供 routes/settings.js 与同步服务共用。

const DEFAULT_LEADER_RULES = [
  { leader: '陈大仪', members: ['郭涛', '王兴龙', '王会永', '李广亮'] },
  { leader: '张啸', members: ['李守健', '邓明江', '贾银鑫', '熊飞'] },
  { leader: '张明', members: ['吴露鹭', '茅舒', '沈雨帆', '张晟隽', '梁科研', '吴方盛', '许华俊'] },
  { leader: '陈青松', members: ['张广奇', '李劲日', '曹圩圩', '许孟涵'] }
];

const normalizeLeaderRules = (rules) => (Array.isArray(rules) && rules.length > 0 ? rules : DEFAULT_LEADER_RULES);

// 按营业担当查找组长；未命中任何规则时返回空字符串（不猜、不兜底）
const resolveLeader = (salesPerson, rules) => {
  const name = String(salesPerson || '').trim();
  if (!name) return '';
  for (const rule of normalizeLeaderRules(rules)) {
    if (!rule || typeof rule !== 'object') continue;
    const members = Array.isArray(rule.members) ? rule.members : [];
    if (members.some(member => String(member || '').trim() === name)) {
      return String(rule.leader || '').trim();
    }
  }
  return '';
};

module.exports = {
  DEFAULT_LEADER_RULES,
  normalizeLeaderRules,
  resolveLeader
};
