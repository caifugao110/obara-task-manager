export const defaultAccessSettings = { enabled: true, allowAdmins: true, allowViewers: false };

// 任务颜色不再使用固定色板挑选：
// 底色/文字色统一由「任务内容 + 是否加急」在 utils/taskColors.ts 中派生，
// 超管可在「系统设置 → 计划管理 → 任务内容配色」中调整色值。
