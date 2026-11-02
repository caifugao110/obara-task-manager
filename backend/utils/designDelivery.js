'use strict';

// 设计纳期天数：由纳期与今天的天数差动态计算，不落库为固定值。
// 状态跟踪路由与同步服务（按钮同步、定时任务）都要用同一份口径。

const calculateDesignDeliveryDays = (deliveryDate) => {
  if (!deliveryDate) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = new Date(deliveryDate);
  if (Number.isNaN(targetDate.getTime())) return 0;
  targetDate.setHours(0, 0, 0, 0);
  return Math.ceil((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

const withDynamicDesignDeliveryDays = (item) => {
  if (!item) return item;
  return {
    ...item,
    designDeliveryDays: calculateDesignDeliveryDays(item.deliveryDate)
  };
};

module.exports = {
  calculateDesignDeliveryDays,
  withDynamicDesignDeliveryDays
};
