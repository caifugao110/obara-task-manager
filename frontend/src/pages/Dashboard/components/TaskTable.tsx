import React, { useMemo } from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronDown, ChevronRight, ChevronUp, Plus } from 'lucide-react';
import SortableTask from './SortableTask';
import DroppableCell from './DroppableCell';
import { buildTaskMetadataTitle, formatHoursValue, getTaskHours, isMeaningfulTask } from '../utils';
import type {
  Designer,
  EditingSession,
  SelectedTask,
  TaskItem,
  TaskSheet,
  User,
} from '../types';

/**
 * 主表格主体（分组行 + 设计员行 + 任务单元格 + 当日合计行）。
 *
 * 为什么把它单独抽出来并 React.memo：
 * 主页面 Dashboard 是一个几千行的单组件，任务编辑弹窗的输入框（任务名 / 枪名 / 更改通知单）
 * 和「查找任务」弹窗的输入框，state 都挂在 Dashboard 上。React 的规则是 state 一变整棵子树重渲，
 * 于是每敲一个字符，20 人 × 30 天 = 600 个单元格、400+ 主任务、500+ 枪名行（约两千个 dnd-kit 节点）
 * 会全部重建一次，输入就卡了。
 *
 * 抽成 memo 组件后，只要下面这些 props 的引用不变，输入字符时这一整块会被 React 直接跳过：
 * - 数据类：sheetByDesignerId / editingSessions / sortedGroups / designersByGroup / days
 * - 交互态：selectedCell / selectedTasks / taskDropTarget / gunDropTarget / locateFlashKey
 * - 回调：统一走 handlersRef（引用恒定，内容每次渲染刷新），避免内联函数把 memo 打破
 *
 * 注意：不要为了让某个回调「看起来更干净」而把函数直接写进 props——
 * 一旦 props 里出现每次渲染新建的函数/数组/对象，memo 就永久失效，卡顿会回来。
 */

/** 单元格内按 designerId|date 预先索引的渲染数据，避免每次渲染都 filter 一遍 */
type TableData = {
  itemsByCell: Map<string, TaskItem[]>;
  idsByCell: Map<string, string[]>;
  dailyTotalByCell: Map<string, number>;
  monthlyTotalByDesigner: Map<string, number>;
};

const cellKey = (designerId: string, date: string) => `${designerId}|${date}`;

// 请假类不计入工时（与原 calculateDailyTotal 口径一致）
const isLeaveOnlyType = (item: TaskItem) =>
  item.leaveType === 'sick' || item.leaveType === 'vacation' || item.leaveType === 'illness';

export type TaskTableHandlers = {
  toggleGroup: (group: string) => void;
  onMoveDesigner: (designer: Designer, direction: 'up' | 'down') => void;
  onTaskClick: (item: TaskItem, designerId: string, date: string, type: 'task' | 'hours' | 'gun' | 'gunHours', gunIndex?: number) => void;
  onDeleteGun: (item: TaskItem, designerId: string, date: string, gunIndex: number) => void;
  onMoveGun: (item: TaskItem, designerId: string, date: string, gunIndex: number, direction: 'up' | 'down') => void;
  onMoveTask: (item: TaskItem, designerId: string, date: string, direction: 'up' | 'down') => void;
  onDeleteTask: (item: TaskItem, designerId: string, date: string) => void;
  onMarkColor: (item: TaskItem, designerId: string, date: string, action: 'white' | 'restore') => void;
  onMarkGunColor: (item: TaskItem, designerId: string, date: string, gunIndex: number, action: 'white' | 'restore') => void;
  /** 行选中：内部已含 canEditTasks 判断、单元格锁判断、记录选中与编辑会话 */
  selectTask: (itemId: string, designerId: string, date: string, append: boolean) => void;
  warnIfCellLocked: (designerId: string, date: string, itemId?: string | null) => boolean;
  openModal: (designerId: string, date: string, addMode?: boolean) => void;
  stopEditingCell: (designerId?: string | null, date?: string | null) => void;
  handlePaste: (designerId: string, date: string) => void | Promise<void>;
  setSelectedCell: (next: { designerId: string; date: string } | null) => void;
  setSelectedTasks: (next: SelectedTask[]) => void;
  clipboardRef: React.MutableRefObject<TaskItem[] | null>;
};

export type TaskTableProps = {
  sortedGroups: string[];
  designersByGroup: Record<string, Designer[]>;
  collapsedGroups: Record<string, boolean>;
  days: { fullDate: string; isWeekend: boolean }[];
  sheetByDesignerId: Record<string, TaskSheet | undefined>;
  editingSessions: Record<string, EditingSession>;
  selectedCell: { designerId: string; date: string } | null;
  selectedTasks: SelectedTask[];
  taskDropTarget: { designerId: string; date: string; itemId: string | null; duplicate: boolean } | null;
  gunDropTarget: { designerId: string; date: string; itemId: string; invalid: boolean; isSelf: boolean; noGuns?: boolean; create?: boolean; append?: boolean } | null;
  locateFlashKey: string | null;
  taskColWidth: number;
  dayColWidth: number;
  canEditTasks: boolean;
  canViewEditingUser: boolean;
  isOfflineMode: boolean;
  allowUserDesignPlanColorMark: boolean;
  hasToken: boolean;
  user: User | null;
  handlersRef: React.MutableRefObject<TaskTableHandlers>;
};

const EMPTY_ITEMS: TaskItem[] = [];
const EMPTY_IDS: string[] = [];

const TaskTable: React.FC<TaskTableProps> = ({
  sortedGroups,
  designersByGroup,
  collapsedGroups,
  days,
  sheetByDesignerId,
  editingSessions,
  selectedCell,
  selectedTasks,
  taskDropTarget,
  gunDropTarget,
  locateFlashKey,
  taskColWidth,
  dayColWidth,
  canEditTasks,
  canViewEditingUser,
  isOfflineMode,
  allowUserDesignPlanColorMark,
  hasToken,
  user,
  handlersRef,
}) => {
  const h = handlersRef.current;

  // 编辑会话按单元格建索引：原来是每个单元格 Object.values(...).filter 一次（600 次/渲染），
  // 现在只在会话变化时构建一次
  const sessionsByCell = useMemo(() => {
    const map = new Map<string, EditingSession[]>();
    for (const session of Object.values(editingSessions)) {
      const key = cellKey(session.designerId, session.date);
      const list = map.get(key);
      if (list) list.push(session);
      else map.set(key, [session]);
    }
    return map;
  }, [editingSessions]);

  // 单元格任务列表 / id 列表 / 当日合计 / 月总工时一次性算好：
  // 既省掉每次渲染 600 次 filter，也让 SortableContext 的 items 引用保持稳定
  const tableData = useMemo<TableData>(() => {
    const itemsByCell = new Map<string, TaskItem[]>();
    const idsByCell = new Map<string, string[]>();
    const dailyTotalByCell = new Map<string, number>();
    const monthlyTotalByDesigner = new Map<string, number>();

    for (const [designerId, sheet] of Object.entries(sheetByDesignerId)) {
      let monthTotal = 0;
      for (const [date, rawItems] of Object.entries(sheet?.days || {})) {
        const list = Array.isArray(rawItems) ? rawItems.filter(isMeaningfulTask) : [];
        const key = cellKey(designerId, date);
        itemsByCell.set(key, list);
        idsByCell.set(key, list.map(item => item.id));
        const dailyTotal = list.reduce((sum, item) => (isLeaveOnlyType(item) ? sum : sum + getTaskHours(item)), 0);
        dailyTotalByCell.set(key, dailyTotal);
        monthTotal += dailyTotal;
      }
      monthlyTotalByDesigner.set(designerId, monthTotal);
    }

    return { itemsByCell, idsByCell, dailyTotalByCell, monthlyTotalByDesigner };
  }, [sheetByDesignerId]);

  return (
    <>
      {sortedGroups.map(group => (
        <React.Fragment key={group}>
          <tbody>
            <tr className="group/grp cursor-pointer transition-colors bg-gray-200 group-hover/grp:bg-gray-300" onClick={() => h.toggleGroup(group)}>
              {/* td1: 固定列 + 固定分组名，高 z-index 让溢出内容盖在 td2 上 */}
              <td className="sticky left-0 top-[64px] z-[30] relative overflow-visible p-0 border border-gray-300 bg-gray-200 group-hover/grp:bg-gray-300 shadow-[1px_0_0_0_#d1d5db]">
                {/* 占位：撑出 td 高度，不参与列宽 */}
                <div style={{ height: 29 }} />
                {/* 实际内容：绝对定位，不撑宽 td1，允许溢出到右边 */}
                <div className="absolute left-0 top-0 flex items-center gap-2 whitespace-nowrap px-3 py-1.5 font-black text-gray-700 bg-gray-200 group-hover/grp:bg-gray-300">
                  {collapsedGroups[group] ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                  <span>{group}</span>
                  <span className="text-[10px] font-normal opacity-60 ml-2">({designersByGroup[group].length} 人)</span>
                </div>
              </td>
              {/* td2: 剩余列，z-[25] 高于月总工时列(z-20)使其被分组行覆盖，但低于 td1(z-[30])不遮挡分组名溢出 */}
              <td colSpan={days.length * 2 + 1} className="sticky top-[64px] z-[25] border border-gray-300 bg-gray-200 group-hover/grp:bg-gray-300"></td>
            </tr>
          </tbody>

          {!collapsedGroups[group] && (
            designersByGroup[group].map((d, groupIndex) => {
              const groupMembers = designersByGroup[group];
              const canMoveDesigner = canEditTasks && (groupIndex > 0 || groupIndex < groupMembers.length - 1);
              const canMoveDesignerUp = canEditTasks && groupIndex > 0;
              const canMoveDesignerDown = canEditTasks && groupIndex < groupMembers.length - 1;
              return (
                <tbody key={d.id}>
                  <tr className="align-top hover:bg-blue-50/20 group/row transition-colors">
                    <td className="sticky left-0 z-20 bg-white border border-gray-300 px-2 py-3 min-w-[6rem] font-bold text-gray-800 text-center align-middle shadow-[1px_0_0_0_#d1d5db] group-hover/row:bg-blue-50">
                      {/* 姓名悬停时才显示上移/下移按钮（样式与显示逻辑同主任务行的上下移按钮）：
                          按钮绝对定位在姓名正下方（锚点是姓名自身，不是整个姓名格），不占布局，
                          姓名始终在格子正中、列宽不变；姓名格给最小高度，当天没有任何任务时行也不会太矮。
                          有按钮时底部预留 22px（按钮 18 + 间距 4），让「姓名+按钮」整体在格子里居中 */}
                      <div className={`group/designer inline-flex items-center justify-center min-h-[56px] ${canMoveDesigner ? 'pb-[22px]' : ''}`}>
                        <div className="relative inline-block text-base font-bold text-gray-900 whitespace-nowrap">
                          {d.name}
                          {canMoveDesigner && (
                            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 flex items-center gap-1 whitespace-nowrap opacity-0 group-hover/designer:opacity-100 transition-opacity">
                              {canMoveDesignerUp && (
                                <button
                                  type="button"
                                  className="h-[18px] w-[18px] flex items-center justify-center rounded bg-blue-100 text-blue-600 border border-blue-300 shadow-sm hover:bg-blue-600 hover:text-white hover:border-blue-700 transition-colors"
                                  title="上移"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    h.onMoveDesigner(d, 'up');
                                  }}
                                >
                                  <ChevronUp size={14} strokeWidth={3} />
                                </button>
                              )}
                              {canMoveDesignerDown && (
                                <button
                                  type="button"
                                  className="h-[18px] w-[18px] flex items-center justify-center rounded bg-blue-100 text-blue-600 border border-blue-300 shadow-sm hover:bg-blue-600 hover:text-white hover:border-blue-700 transition-colors"
                                  title="下移"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    h.onMoveDesigner(d, 'down');
                                  }}
                                >
                                  <ChevronDown size={14} strokeWidth={3} />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    {days.map(day => {
                      const key = cellKey(d.id, day.fullDate);
                      const items = tableData.itemsByCell.get(key) ?? EMPTY_ITEMS;
                      const itemIds = tableData.idsByCell.get(key) ?? EMPTY_IDS;
                      // 单元格内全部编辑会话：按主任务粒度展示标记；itemId 为空的是旧版整格会话
                      const cellSessions = sessionsByCell.get(key) ?? [];
                      const legacyCellSession = cellSessions.find(s => s.userId !== user?.id && s.itemId == null) || null;
                      const isCellLocked = cellSessions.some(s => s.userId !== user?.id && s.itemId == null);
                      const isCellSelected = selectedCell?.designerId === d.id && selectedCell?.date === day.fullDate;
                      // 单元格内容一律顶部对齐：本格内容少、同行其他格子更高时，任务行贴着格子上沿排，
                      // 不做垂直居中（居中会让无任务内容的主任务悬在格子中间，与相邻格子的行位置错开）
                      // 主任务拖拽扫过本单元格时的预插入位置：itemId 命中某条主任务 → 其上方显示标记线；
                      // itemId 为 null → 最下方显示追加标记线；duplicate 时红色（复制内容重复）
                      const cellTaskDrop = taskDropTarget && taskDropTarget.designerId === d.id && taskDropTarget.date === day.fullDate ? taskDropTarget : null;
                      const showAppendMarker = Boolean(cellTaskDrop && cellTaskDrop.itemId === null);
                      // 枪名拖拽扫过本单元格：整格无主任务 → 整格高亮（松手新建）；
                      // 已有主任务但指针停在最下方加号上 → 只高亮加号（松手在该格最下面新建）
                      const gunCreate = gunDropTarget?.create && gunDropTarget.designerId === d.id && gunDropTarget.date === day.fullDate;
                      const isGunCreateCell = Boolean(gunCreate && !gunDropTarget?.append);
                      const isGunCreatePlus = Boolean(gunCreate && gunDropTarget?.append);
                      return (
                        <DroppableCell
                          key={`${d.id}-${day.fullDate}`}
                          designerId={d.id}
                          date={day.fullDate}
                          colSpan={2}
                          style={{ minWidth: dayColWidth }}
                          className={`border border-gray-300 p-0 align-top ${day.isWeekend && items.length === 0 ? 'bg-indigo-50' : ''} min-h-[40px] relative group/cell task-cell${isCellLocked ? ' task-cell--locked' : ''}${isGunCreateCell ? ' ring-2 ring-inset ring-emerald-500 bg-emerald-50/50' : ''}`}
                          onClick={(e: React.MouseEvent) => {
                            if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('flex') && !(e.target as HTMLElement).closest('[data-task-id]')) {
                              h.setSelectedTasks([]);
                              h.setSelectedCell(null);
                              h.stopEditingCell();
                            }
                          }}
                        >
                          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
                            <div className="task-cell-list flex flex-col min-h-[40px]">
                              {items.map((item, itemIndex) => {
                                const canMarkColor = Boolean(
                                  hasToken &&
                                  !isOfflineMode &&
                                  !item.leaveType &&
                                  (
                                    (user?.role === 'admin' || user?.role === 'superadmin') ||
                                    (user?.role === 'user' &&
                                      allowUserDesignPlanColorMark &&
                                      String(d.name || '').trim() === String(user.name || '').trim())
                                  )
                                );
                                return (
                                  <SortableTask
                                    key={item.id}
                                    item={item}
                                    designerId={d.id}
                                    date={day.fullDate}
                                    taskColWidth={taskColWidth}
                                    isAdmin={canEditTasks}
                                    canMarkColor={canMarkColor}
                                    canMoveUp={canEditTasks && items.length > 1 && itemIndex > 0}
                                    canMoveDown={canEditTasks && items.length > 1 && itemIndex < items.length - 1}
                                    onTaskClick={h.onTaskClick}
                                    onDeleteGun={h.onDeleteGun}
                                    onMoveGun={h.onMoveGun}
                                    onMoveTask={h.onMoveTask}
                                    onDeleteTask={h.onDeleteTask}
                                    onMarkColor={h.onMarkColor}
                                    onMarkGunColor={h.onMarkGunColor}
                                    selectedTasks={selectedTasks}
                                    metadataTitle={buildTaskMetadataTitle(item)}
                                    gunDropTarget={gunDropTarget && !gunDropTarget.isSelf && gunDropTarget.designerId === d.id && gunDropTarget.date === day.fullDate && gunDropTarget.itemId === item.id ? (gunDropTarget.invalid ? 'invalid' : 'valid') : null}
                                    taskInsertMarker={cellTaskDrop && cellTaskDrop.itemId === item.id ? (cellTaskDrop.duplicate ? 'invalid' : 'valid') : null}
                                    editingMarkSession={cellSessions.find(s => s.userId !== user?.id && s.itemId === item.id && (canViewEditingUser || s.mode === 'colorMark')) || null}
                                    // 刚安排好的任务定位后闪一圈高亮（2.8s 后自动清除）
                                    locateFlash={locateFlashKey === `${d.id}|${day.fullDate}|${item.id}`}
                                    // 同一天的第 2 条主任务起画分界线，区分「同一人同一天的不同主任务」
                                    showTopSeparator={itemIndex > 0}
                                    onSelectTask={h.selectTask}
                                  />
                                );
                              })}
                              {/* 主任务拖拽扫过本单元格但未命中任何主任务：最下方显示追加位置标记线 */}
                              {showAppendMarker && (
                                <div
                                  className="pointer-events-none"
                                  style={{
                                    height: 4,
                                    margin: '0 2px',
                                    borderRadius: 2,
                                    backgroundColor: cellTaskDrop?.duplicate ? '#ef4444' : '#16a34a',
                                    boxShadow: cellTaskDrop?.duplicate
                                      ? '0 0 0 1px rgba(239,68,68,0.55), 0 1px 4px rgba(239,68,68,0.5)'
                                      : '0 0 0 1px rgba(22,163,74,0.55), 0 1px 4px rgba(22,163,74,0.5)',
                                  }}
                                />
                              )}
                              {/* 加号区：默认隐藏，仅当指针停在本格空白处时显形（见 index.css 的 .task-cell-plus 规则）；
                                  指针停在已有任务行上时不显示。data-cell-plus 供枪名拖拽命中判定：
                                  拖到加号上松手 → 按源主任务名称在本格最下面新建主任务 */}
                              {canEditTasks && (
                                // 单击 → 选中该格等待 Ctrl+V 粘贴（加号常亮）；双击 → 直接新增任务。
                                // 加号的 title 固定不变：随选中状态改动 title 会让浏览器反复重建悬浮提示，看起来像加号在闪。
                                <div
                                  data-cell-plus="1"
                                  className={`task-cell-plus min-h-[24px] flex items-start justify-center pt-[3px] rounded transition-colors ${isCellLocked ? 'cursor-not-allowed' : 'cursor-pointer'}${isCellSelected ? ' task-cell-plus--selected' : ''}${isGunCreatePlus ? ' ring-2 ring-inset ring-emerald-500 !opacity-100 bg-emerald-50' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // 双击「+」时浏览器先派发两次 click 再派发 dblclick。
                                    // 第二次 click（detail>=2）不再提交选中态：否则两次整表重渲会
                                    // 挤在弹窗挂载之前，双击后要等表格画完才看得到模态框。
                                    if (e.detail >= 2) return;
                                    // 新增主任务不受他人主任务级编辑影响，仅旧版整格会话会拦截
                                    if (h.warnIfCellLocked(d.id, day.fullDate)) return;
                                    h.setSelectedCell({ designerId: d.id, date: day.fullDate });
                                    h.setSelectedTasks([]);
                                  }}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    if (h.warnIfCellLocked(d.id, day.fullDate)) return;
                                    h.openModal(d.id, day.fullDate, true);
                                  }}
                                  // 焦点离开加号就取消「已选中」高亮：此时 Ctrl+V 已不再粘到本格，常亮只会误导
                                  onBlur={() => {
                                    if (isCellSelected) h.setSelectedCell(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      // 实现粘贴功能
                                      if (h.clipboardRef.current && h.clipboardRef.current.length > 0) {
                                        void h.handlePaste(d.id, day.fullDate);
                                      }
                                    }
                                  }}
                                  tabIndex={0}
                                  title="单击选中此单元格（双击空格可直接新增任务，可 Ctrl+V 粘贴），双击新增任务"
                                >
                                  <span
                                    className={`inline-flex items-center justify-center h-[18px] w-[18px] rounded-full ring-1 shadow-sm transition-colors ${isCellLocked
                                      ? 'bg-gray-100 text-gray-400 ring-gray-300'
                                      : isGunCreatePlus
                                        ? 'bg-emerald-600 text-white ring-emerald-700 shadow-md'
                                        : isCellSelected
                                          ? 'bg-blue-600 text-white ring-blue-700 shadow-md'
                                          : 'bg-blue-100 text-blue-600 ring-blue-400 hover:bg-blue-600 hover:text-white hover:ring-blue-700 hover:shadow-md'
                                      }`}
                                  >
                                    <Plus size={12} strokeWidth={3.5} />
                                  </span>
                                </div>
                              )}
                              {/* 整格红色罩层仅保留给旧版整格会话；主任务级会话在对应任务行内显示标记 */}
                              {user && legacyCellSession && (canViewEditingUser || legacyCellSession.mode === 'colorMark') && (
                                <div className="absolute inset-0 bg-red-200/85 flex items-center justify-center z-10">
                                  <span className="text-xs font-bold text-white bg-red-600 px-2 py-1 rounded border border-red-700 shadow-sm">
                                    {legacyCellSession.name || legacyCellSession.username} {legacyCellSession.mode === 'colorMark' ? '正在修改任务完成状态' : '正在编辑'}
                                  </span>
                                </div>
                              )}
                            </div>
                          </SortableContext>
                        </DroppableCell>
                      );
                    })}
                    {/* 月总工时：字号与「当日合计」一档（14px）；
                        行的 align-top 只管任务格，这一格单独 align-middle 让数字在整行高度里上下居中 */}
                    <td className="sticky right-0 z-20 bg-[#f8f9fa] border border-gray-300 px-2 py-2 min-w-[6rem] text-[14px] font-bold text-center align-middle tabular-nums text-green-700 shadow-[-1px_0_0_0_#d1d5db] group-hover/row:bg-green-50">
                      {(tableData.monthlyTotalByDesigner.get(d.id) ?? 0).toFixed(1)}
                    </td>
                  </tr>
                  {/* 当日合计行：行高对齐上方枪名行（枪名行 = 内容 11px×1.5 + py-1.5 + 1px 上边框 ≈ 29.5px）。
                      这里不再靠 padding + 行高凑数，而是给单元格写死高度 27.5px（表格单元格的 height 即最小高度）
                      + 上下各 1px 边框 = 29.5px，与枪名行严格等高；这样数字想放多大都不会把行撑高。
                      数值 14px 特粗 + 深蓝 + 等宽数字，与「月总工时」同字号但更重、更醒目 */}
                  <tr className="bg-pink-50">
                    <td className="sticky left-0 z-20 bg-pink-50 border border-gray-300 h-[27.5px] px-2 py-0 min-w-[6rem] text-[11px] font-bold text-gray-500 text-center align-middle whitespace-nowrap shadow-[1px_0_0_0_#d1d5db]">
                      当日合计
                    </td>
                    {days.map(day => (
                      <td key={`total-${d.id}-${day.fullDate}`} colSpan={2} className={`border border-gray-300 h-[27.5px] px-1 py-0 text-center align-middle ${day.isWeekend ? 'bg-pink-100' : 'bg-pink-50'}`}>
                        <span className="inline-block text-[14px] leading-none font-extrabold tabular-nums tracking-tight text-blue-700">
                          {/* 工时是逐条累加出来的浮点数，直接输出会带出 9.049999999999999 这类尾差，
                              统一走 formatHoursValue：最多两位小数、去掉末尾的 0 */}
                          {formatHoursValue(tableData.dailyTotalByCell.get(cellKey(d.id, day.fullDate)))}
                        </span>
                      </td>
                    ))}
                    <td className="sticky right-0 z-20 bg-pink-50 border border-gray-300 min-w-[6rem] shadow-[-1px_0_0_0_#d1d5db]"></td>
                  </tr>
                </tbody>
              );
            })
          )}
        </React.Fragment>
      ))}
    </>
  );
};

export default React.memo(TaskTable);
