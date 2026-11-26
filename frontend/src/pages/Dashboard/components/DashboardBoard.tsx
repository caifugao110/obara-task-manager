import React, { useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  type CollisionDetection,
  type DragStartEvent,
  type DragMoveEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { AlertCircle, Plus } from 'lucide-react';
import TaskTable, { type TaskTableProps } from './TaskTable';
import { screenToLocal } from '../../../utils/pageZoom';
import { getLeaveRowColors, getTaskDisplayColors } from '../../../utils/taskColors';
import { getWorkdayOverrideLabel, type WorkdayOverrides } from '../../../utils/workdayOverrides';
import { isWhiteTaskColor } from '../utils';
import type { TaskItem } from '../types';
import type { ActiveTaskState, ActiveGunState } from '../hooks/useGunDragDrop';

const DAY_HOURS_COL_WIDTH = 48;

type BoardDay = {
  fullDate: string;
  dayNum: number;
  monthNum: number;
  naturalIsWeekend: boolean;
  isWeekend: boolean;
  dayName: string;
};

export type WorkdayOverrideConfirmState = {
  date: string;
  naturalIsWeekend: boolean;
  checked: boolean;
} | null;

/**
 * 传给 DndContext 的回调集合走 ref：
 * 本组件被 React.memo 包着，输入框打字时整块会被跳过渲染，
 * 直接把 Dashboard 每次渲染新建的函数传进来会拿到过期闭包，也会让 memo 失效。
 * ref 引用恒定，内容每次渲染由 Dashboard 刷新；下面再用 useCallback 做一层
 * 「永久稳定、内部读 ref」的包装，保证 DndContext 始终能调到最新实现。
 */
export type DashboardBoardHandlers = {
  onDragStart: (event: DragStartEvent) => void;
  onDragMove: (event: DragMoveEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: () => void;
  setWorkdayOverrideConfirm: (value: WorkdayOverrideConfirmState) => void;
};

export type DashboardBoardProps = Omit<TaskTableProps, 'days'> & {
  days: BoardDay[];
  sensors: NonNullable<React.ComponentProps<typeof DndContext>['sensors']>;
  collisionDetection: CollisionDetection;
  boardHandlersRef: React.MutableRefObject<DashboardBoardHandlers>;
  tableContainerRef: React.RefObject<HTMLDivElement>;
  tableScrollRef: React.RefObject<HTMLDivElement>;
  isAdmin: boolean;
  workdayOverrides: WorkdayOverrides;
  updatingWorkdayOverrideDate: string | null;
  activeTask: ActiveTaskState;
  activeGun: ActiveGunState;
  taskDropDuplicate: boolean;
  gunDropCreateCell: boolean;
  gunDropInvalid: boolean;
  gunDropSelf: boolean;
  gunDropCreateAppend: boolean;
  gunDropNoGuns: boolean;
  pageZoom: number;
  getItemDisplayColors: (item: TaskItem) => ReturnType<typeof getTaskDisplayColors>;
};

/**
 * 主表格 + 拖拽上下文 + 拖拽浮层。
 *
 * 为什么抽出来并 React.memo：
 * Dashboard 是一个 7000 行的单组件，查找框 / 任务内容输入框的 state 都挂在它上面。
 * 每敲一个字符Dashboard 都会重渲，整棵 JSX 都会重新创建；即使 TaskTable 自身有 memo，
 * 表头、DragOverlay 和 DndContext 的 children 仍会重建，DndContext 也会被带着重渲。
 * 抽成 memo 组件后，只要 props 引用不变，输入时这一整块（约两千个 dnd 节点）会被直接跳过。
 *
 * 注意：props 里不要出现每次渲染新建的函数 / 对象 / 数组，memo 会立刻失效。
 */
const DashboardBoard: React.FC<DashboardBoardProps> = ({
  sensors,
  collisionDetection,
  boardHandlersRef,
  tableContainerRef,
  tableScrollRef,
  days,
  dayColWidth,
  taskColWidth,
  isAdmin,
  isOfflineMode,
  workdayOverrides,
  updatingWorkdayOverrideDate,
  sortedGroups,
  designersByGroup,
  collapsedGroups,
  sheetByDesignerId,
  editingSessions,
  selectedCell,
  selectedTasks,
  locateFlashKey,
  canEditTasks,
  canViewEditingUser,
  allowUserDesignPlanColorMark,
  hasToken,
  user,
  handlersRef,
  activeTask,
  activeGun,
  taskDropDuplicate,
  gunDropCreateCell,
  gunDropInvalid,
  gunDropSelf,
  gunDropCreateAppend,
  gunDropNoGuns,
  pageZoom,
  getItemDisplayColors,
}) => {
  const onDragStart = useCallback((event: DragStartEvent) => boardHandlersRef.current.onDragStart(event), [boardHandlersRef]);
  const onDragMove = useCallback((event: DragMoveEvent) => boardHandlersRef.current.onDragMove(event), [boardHandlersRef]);
  const onDragEnd = useCallback((event: DragEndEvent) => boardHandlersRef.current.onDragEnd(event), [boardHandlersRef]);
  const onDragCancel = useCallback(() => boardHandlersRef.current.onDragCancel(), [boardHandlersRef]);

  return (
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >


        <main className="flex-1 min-h-0 overflow-hidden p-0">
          <div className="h-full bg-white shadow-sm border border-b-0 border-gray-300 overflow-hidden" ref={tableContainerRef}>
            <div className="h-full overflow-auto" ref={tableScrollRef}>
              <table className="border-collapse text-[12px] w-full">
              <thead className="text-xs">
                <tr className="bg-[#f8f9fa] text-gray-600 h-10 table-header-row">
                  <th className="sticky left-0 bg-[#f8f9fa] border border-gray-300 w-24 min-w-[6rem] font-bold text-center shadow-[1px_0_0_0_#d1d5db] z-50">设计员</th>
                  {days.map(d => (
                    <th key={d.fullDate} data-date={d.fullDate} colSpan={2} style={{ minWidth: dayColWidth }} className={`group/date sticky top-0 border border-gray-300 text-center font-bold z-40 ${d.isWeekend ? 'bg-indigo-50' : ''}`}>
                      <div className="whitespace-nowrap">{d.monthNum}月{d.dayNum}日&nbsp;&nbsp;&nbsp;{d.dayName}</div>
                      {isAdmin && (
                        <label
                          className={`mt-1 hidden items-center justify-center gap-1 text-[10px] font-semibold leading-none select-none group-hover/date:flex group-focus-within/date:flex ${
                            isOfflineMode ? 'text-gray-400 opacity-60 cursor-not-allowed' : 'text-gray-600 cursor-pointer'
                          }`}
                          title={isOfflineMode ? '当前离线，无法修改工作日设置' : undefined}
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(workdayOverrides[d.fullDate])}
                            // 离线时禁用：这个开关会 PUT /settings/workday-overrides 落库
                            disabled={updatingWorkdayOverrideDate === d.fullDate || isOfflineMode}
                            onChange={(e) => boardHandlersRef.current.setWorkdayOverrideConfirm({
                              date: d.fullDate,
                              naturalIsWeekend: d.naturalIsWeekend,
                              checked: e.target.checked,
                            })}
                            className={`h-3 w-3 ${isOfflineMode ? 'cursor-not-allowed' : 'cursor-pointer'} disabled:cursor-not-allowed`}
                          />
                          <span>{getWorkdayOverrideLabel(d.naturalIsWeekend)}</span>
                        </label>
                      )}
                    </th>
                  ))}
                  <th className="sticky right-0 bg-[#f8f9fa] border border-gray-300 w-24 min-w-[6rem] font-bold text-center shadow-[-1px_0_0_0_#d1d5db] z-50">月总工时</th>
                </tr>
                <tr className="bg-[#f8f9fa] text-gray-500 text-[10px] h-6 table-header-row-secondary">
                  <th className="sticky left-0 top-10 bg-[#f8f9fa] border border-gray-300 min-w-[6rem] shadow-[1px_0_0_0_#d1d5db] z-40"></th>
                  {days.map(d => (
                    <React.Fragment key={`sub-${d.fullDate}`}>
                      <th style={{ width: taskColWidth, minWidth: taskColWidth }} className={`sticky top-10 border border-gray-300 z-30 ${d.isWeekend ? 'bg-indigo-50' : 'bg-[#f8f9fa]'}`}>任务内容</th>
                      <th style={{ width: DAY_HOURS_COL_WIDTH, minWidth: DAY_HOURS_COL_WIDTH }} className={`sticky top-10 border border-gray-300 z-30 ${d.isWeekend ? 'bg-indigo-50' : 'bg-[#f8f9fa]'}`}>工时</th>
                    </React.Fragment>
                  ))}
                  <th className="sticky right-0 top-10 bg-[#f8f9fa] border border-gray-300 min-w-[6rem] shadow-[-1px_0_0_0_#d1d5db] z-40"></th>
                </tr>
              </thead>
              <TaskTable
                sortedGroups={sortedGroups}
                designersByGroup={designersByGroup}
                collapsedGroups={collapsedGroups}
                days={days}
                sheetByDesignerId={sheetByDesignerId}
                editingSessions={editingSessions}
                selectedCell={selectedCell}
                selectedTasks={selectedTasks}
                locateFlashKey={locateFlashKey}
                taskColWidth={taskColWidth}
                dayColWidth={dayColWidth}
                canEditTasks={canEditTasks}
                canViewEditingUser={canViewEditingUser}
                isOfflineMode={isOfflineMode}
                allowUserDesignPlanColorMark={allowUserDesignPlanColorMark}
                hasToken={hasToken}
                user={user}
                handlersRef={handlersRef}
              />
              </table>
            </div>
            </div>
        </main>

        {/* 拖拽浮层挂到 body：dnd-kit 用 getBoundingClientRect 的**屏幕 px** 定位浮层，
            留在缩放层里会被再乘一次倍率、跟不上光标。浮层内部再按倍率放大回页面大小，
            这样拖动时浮层的字号/行高与表格里完全一致 */}
        {createPortal(
          <DragOverlay>
            <div style={{ position: 'absolute', top: 0, left: 0, transform: `scale(${pageZoom})`, transformOrigin: '0 0' }}>
          {activeTask && (
            <div className="relative">
              {/* 重复提示（移动/复制共用）：浮在拖拽主任务的正上方 */}
              {taskDropDuplicate && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    bottom: '100%',
                    marginBottom: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    whiteSpace: 'nowrap',
                    fontSize: 11,
                    lineHeight: '16px',
                    fontWeight: 700,
                    color: '#ffffff',
                    backgroundColor: '#dc2626',
                    border: '1px solid #b91c1c',
                    borderRadius: 4,
                    padding: '1px 6px',
                    boxShadow: '0 2px 6px rgba(220,38,38,0.45)',
                  }}
                >
                  <AlertCircle size={11} />
                  重复任务
                </div>
              )}
              {/* 等比复刻整个主任务：主任务行 + 全部枪名行（枪名格+工时格） */}
              <div className={`flex border ${taskDropDuplicate ? 'border-red-400' : 'border-blue-400'} shadow-2xl rounded opacity-90 scale-105 bg-white overflow-hidden pointer-events-none`}>
                <div className="border-r border-gray-200 flex flex-col bg-white" style={{ width: taskColWidth }}>
                  <div
                    className="px-1.5 py-1.5 min-h-[28px] flex items-center break-all leading-relaxed text-[11px] font-medium"
                    style={(() => {
                      const dragColors = getItemDisplayColors(activeTask.item);
                      const dragLeave = getLeaveRowColors(activeTask.item.leaveType);
                      return { backgroundColor: dragLeave?.bg || dragColors.bg, color: dragLeave ? dragLeave.text : dragColors.text };
                    })()}
                  >
                    {(() => {
                      const item = activeTask.item;
                      if (item.leaveType === 'sick') return <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">事假</span>;
                      if (item.leaveType === 'vacation') return <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">休假</span>;
                      if (item.leaveType === 'illness') return <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-pink-100 text-pink-700">病假</span>;
                      if (item.leaveType === 'trip') {
                        const name = (item.taskName || '').trim();
                        const label = !name ? '出差' : name.endsWith('出差') ? name : `${name}出差`;
                        // 出差行整行已是湖水青底色，文字不再套浅色徽标框（与表格里的行保持一致）
                        return <span className="text-xs font-bold">{label}</span>;
                      }
                      return item.taskName || <span className="text-gray-300 italic">无</span>;
                    })()}
                  </div>
                  {(activeTask.item.guns || []).map((gun) => (
                    <div
                      key={gun.id}
                      className="px-2 py-1 min-h-[24px] flex items-center text-[11px] font-medium border-t border-gray-200/50"
                      style={{ backgroundColor: isWhiteTaskColor(gun.color) ? '#ffffff' : getItemDisplayColors(activeTask.item).bg }}
                    >
                      {gun.name || '未命名'}
                    </div>
                  ))}
                </div>
                <div className="w-12 flex flex-col bg-white">
                  <div
                    className="px-1 py-1.5 min-h-[28px] flex items-center justify-center font-mono text-blue-700 font-bold"
                    style={{
                      backgroundColor: getItemDisplayColors(activeTask.item).bg,
                      color: getItemDisplayColors(activeTask.item).urgent ? getItemDisplayColors(activeTask.item).text : undefined,
                    }}
                  >
                    {activeTask.item.guns && activeTask.item.guns.length > 0 ? '' : activeTask.item.hours}
                  </div>
                  {(activeTask.item.guns || []).map((gun) => (
                    <div
                      key={gun.id}
                      className="px-1 py-1 min-h-[24px] flex items-center justify-center font-mono text-blue-700 font-bold border-t border-gray-200/50"
                      style={{
                        backgroundColor: isWhiteTaskColor(gun.color) ? '#ffffff' : getItemDisplayColors(activeTask.item).bg,
                        color: getItemDisplayColors(activeTask.item).urgent ? getItemDisplayColors(activeTask.item).text : undefined,
                      }}
                    >
                      {gun.hours}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {activeGun && (
            <div
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                pointerEvents: 'none',
                filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.22))',
                // DragOverlay 根容器宽高锁定为激活节点（手柄按钮），必须显式给整行尺寸，
                // 否则内容会被压缩成手柄大小（约 21px 宽的空白小矩形）；
                // 这里的尺寸是屏幕 px（getBoundingClientRect 实测），外层浮层再按倍率放大，
                // 所以先除以倍率换算回页面本地 px
                width: activeGun.dims ? screenToLocal(activeGun.dims.width) : 200,
                height: activeGun.dims ? screenToLocal(activeGun.dims.height) : 24,
                flexShrink: 0,
                transform:
                  activeGun.dims && (activeGun.dims.offsetX || activeGun.dims.offsetY)
                    ? `translate(${screenToLocal(activeGun.dims.offsetX || 0)}px, ${screenToLocal(activeGun.dims.offsetY || 0)}px)`
                    : undefined,
              }}
            >
              {/* 落点可新建主任务：空白单元格（整格高亮）或已有任务单元格最下方的加号（加号高亮）；
                  提示松手后会按源主任务名称新建主任务 */}
              {gunDropCreateCell && !gunDropInvalid && !gunDropSelf && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    bottom: '100%',
                    marginBottom: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                    fontSize: 11,
                    lineHeight: '16px',
                    fontWeight: 700,
                    color: '#ffffff',
                    backgroundColor: '#16a34a',
                    border: '1px solid #15803d',
                    borderRadius: 4,
                    padding: '1px 6px',
                    boxShadow: '0 2px 6px rgba(22,163,74,0.45)',
                  }}
                >
                  <Plus size={11} />
                  {gunDropCreateAppend ? '松手在下方新建主任务' : '松手新建主任务'}
                </div>
              )}
              {/* 禁止/重复提示：浮在拖拽枪名的正上方（而非右侧），更醒目 */}
              {(gunDropInvalid || gunDropSelf) && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    bottom: '100%',
                    marginBottom: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                    fontSize: 11,
                    lineHeight: '16px',
                    fontWeight: 700,
                    color: '#ffffff',
                    backgroundColor: gunDropSelf ? '#4b5563' : '#dc2626',
                    border: `1px solid ${gunDropSelf ? '#374151' : '#b91c1c'}`,
                    borderRadius: 4,
                    padding: '1px 6px',
                    boxShadow: gunDropSelf
                      ? '0 2px 6px rgba(75,85,99,0.45)'
                      : '0 2px 6px rgba(220,38,38,0.45)',
                  }}
                >
                  <AlertCircle size={11} />
                  {gunDropSelf ? '同任务内请用箭头' : gunDropNoGuns ? '目标无枪名，不能移入' : '重复枪名'}
                </div>
              )}
              {/* 等比复刻原枪名行：枪名格 + 工时格，宽高与原行一致，内容显示实际枪名与工时 */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  width: activeGun.dims ? screenToLocal(activeGun.dims.width) : 200,
                  height: activeGun.dims ? screenToLocal(activeGun.dims.height) : 24,
                  flexShrink: 0,
                  backgroundColor: activeGun.gun.color && !isWhiteTaskColor(activeGun.gun.color) ? activeGun.gun.color : '#ffffff',
                  border: `1px solid ${gunDropInvalid ? '#f87171' : gunDropSelf ? '#9ca3af' : '#93c5fd'}`,
                  borderRadius: 3,
                  overflow: 'hidden',
                  fontSize: 11,
                  whiteSpace: 'nowrap',
                }}
              >
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 8px',
                    backgroundColor: 'transparent',
                    fontWeight: 500,
                    overflow: 'hidden',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', color: gunDropInvalid ? '#dc2626' : '#111827' }}>
                    {activeGun.gun.name || '未命名'}
                  </span>
                </div>
                <div
                  style={{
                    width: activeGun.dims ? screenToLocal(activeGun.dims.hoursWidth) : 48,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'transparent',
                    borderLeft: '1px solid rgba(0,0,0,0.08)',
                    fontFamily: 'monospace',
                    color: '#1d4ed8',
                    fontWeight: 700,
                  }}
                >
                  {activeGun.gun.hours}
                </div>
              </div>
            </div>
          )}
            </div>
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
  );
};

export default React.memo(DashboardBoard);
