import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { RefreshCw, ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import type { EditingSession, GunDropTargetState, SelectedTask, TaskItem } from '../types';
import { hasStoredUserMarkColor, isWhiteTaskColor, taskSelectionKey } from '../utils';
import { getLeaveRowColors, getTaskDisplayColors } from '../../../utils/taskColors';
import { useSystemSettings } from '../../../context/SystemSettingsContext';
import GunDragHandle from './GunDragHandle';

// 工时单元格显示：0 或空值不显示数字（避免「暂停/取消」等 0 工时任务满屏 0）
const formatHoursCell = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === '') return '';
  const numeric = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(numeric) && numeric > 0 ? value : '';
};

const SortableTask = ({ item, designerId, date, isAdmin, canMarkColor, canMoveUp, canMoveDown, onTaskClick, onDeleteGun, onMoveGun, onMoveTask, onDeleteTask, onMarkColor, onMarkGunColor, selectedTasks, onSelectTask, metadataTitle, gunDropTarget = null, taskInsertMarker = null, editingMarkSession = null }: { item: TaskItem, designerId: string, date: string, isAdmin: boolean, canMarkColor: boolean, canMoveUp: boolean, canMoveDown: boolean, onTaskClick: (item: TaskItem, designerId: string, date: string, type: 'task' | 'hours' | 'gun' | 'gunHours', gunIndex?: number) => void, onDeleteGun: (item: TaskItem, designerId: string, date: string, gunIndex: number) => void, onMoveGun: (item: TaskItem, designerId: string, date: string, gunIndex: number, direction: 'up' | 'down') => void, onMoveTask: (item: TaskItem, designerId: string, date: string, direction: 'up' | 'down') => void, onDeleteTask: (item: TaskItem, designerId: string, date: string) => void, onMarkColor: (item: TaskItem, designerId: string, date: string, action: 'white' | 'restore') => void, onMarkGunColor: (item: TaskItem, designerId: string, date: string, gunIndex: number, action: 'white' | 'restore') => void, selectedTasks: SelectedTask[], onSelectTask: (itemId: string, designerId: string, date: string, append: boolean) => void, metadataTitle: string, gunDropTarget?: GunDropTargetState, taskInsertMarker?: 'valid' | 'invalid' | null, editingMarkSession?: EditingSession | null }) => {
  const { settings } = useSystemSettings();
  const currentSelection = { itemId: item.id, designerId, date };
  const isSelected = selectedTasks.some(selection => taskSelectionKey(selection) === taskSelectionKey(currentSelection));
  const isAutoMarked = item.colorMarkedBy?.id === 'auto';
  // 白色任务无 colorBeforeUserMark 记录时（如拷贝自已完成的任务），也允许恢复为未完成（后端按任务内容派生底色）
  const canRestoreColor = canMarkColor && isWhiteTaskColor(item.color) && (!hasStoredUserMarkColor(item) || item.colorMarkedBy);
  const showMarkWhite = canMarkColor && !isWhiteTaskColor(item.color);

  // 任务内容配色体系：底色/文字色由「任务内容后缀 + 加急」实时派生（白色=已完成时保留白底）
  const display = getTaskDisplayColors(settings.taskColorConfig, item);
  // 请假/出差使用自身固定底色，不参与任务内容配色
  const leaveColors = getLeaveRowColors(item.leaveType);
  const rowBackground = leaveColors?.bg || display.bg;
  const rowTextColor = leaveColors ? leaveColors.text : display.text;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    data: {
      type: 'task',
      item,
      designerId,
      date,
    },
    disabled: !isAdmin || !isSelected,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    backgroundColor: rowBackground,
    color: rowTextColor,
    opacity: isDragging ? 0.3 : 1,
    border: isSelected ? '2px solid #3b82f6' : '1px solid transparent',
    borderRadius: isSelected ? '4px' : '0',
  };

  const typeLabel = (() => {
    if (item.leaveType === 'sick') return '事假';
    if (item.leaveType === 'vacation') return '休假';
    if (item.leaveType === 'illness') return '病假';
    if (item.leaveType === 'trip') {
      const name = (item.taskName || '').trim();
      if (!name) return '出差';
      return name.endsWith('出差') ? name : `${name}出差`;
    }
    return '';
  })();

  const isLeaveType = item.leaveType === 'sick' || item.leaveType === 'vacation' || item.leaveType === 'illness';

  // 没有枪名 → 这一行只有一行内容（主任务、请假、出差行都只有一行），按钮不占布局宽度，内容按整行真居中
  const isSingleLineRow = (item.guns || []).length === 0;
  // 主任务名的居中只针对普通任务行；请假/出差行显示状态徽标，徽标本身在整行居中
  const centerTaskName = !item.leaveType && isSingleLineRow;
  // 单行内容的行：按钮绝对定位，不占位，文字/徽标按整行宽度居中
  // 有多行内容（带枪名）的行：按钮留在流内占位，文字只在按钮之间的剩余宽度里排布，长名字换行也不会被按钮压住
  const markBtnClass = isSingleLineRow
    ? 'absolute left-2 top-1/2 -translate-y-1/2 z-10 flex items-center gap-1'
    : 'flex items-center gap-1 mr-1 shrink-0';
  const moveBtnClass = isSingleLineRow
    ? 'absolute right-1.5 top-1/2 -translate-y-1/2 z-10 flex items-center gap-1'
    : 'flex items-center gap-1 ml-1 shrink-0';

  // 他人在本主任务上的编辑/标记会话：gunIndex 为 null/undefined 时标记主任务行，否则标记对应枪名行
  const editingMarkName = editingMarkSession ? (editingMarkSession.name || editingMarkSession.username) : '';
  const isMainMarkTarget = Boolean(editingMarkSession) && editingMarkSession?.gunIndex == null;
  const editingMarkBadge = editingMarkSession ? (
    <span className="ml-1 shrink-0 text-[10px] font-bold text-white bg-red-600 px-1 py-0.5 rounded border border-red-700 shadow-sm whitespace-nowrap animate-pulse">
      {editingMarkName} {editingMarkSession.mode === 'colorMark' ? '正在修改任务状态' : '正在编辑'}
    </span>
  ) : null;

  return (
    <div
      ref={setNodeRef}
      data-task-id={item.id}
      data-designer-id={designerId}
      data-date={date}
      title={isAdmin ? metadataTitle : undefined}
      style={{ ...style }}
      {...attributes}
      {...listeners}

      onKeyDown={(e: any) => {
        if (isAdmin) {
          if (e.key === 'Delete') {
            e.preventDefault();
            e.stopPropagation();
            onDeleteTask(item, designerId, date);
          } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
            e.preventDefault();
            const copyEvent = new CustomEvent('task-copy', { detail: { item, designerId, date } });
            window.dispatchEvent(copyEvent);
          } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
            e.preventDefault();
            const cutEvent = new CustomEvent('task-cut', { detail: { item, designerId, date } });
            window.dispatchEvent(cutEvent);
          } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
            e.preventDefault();
            const pasteEvent = new CustomEvent('task-paste', { detail: { item, designerId, date } });
            window.dispatchEvent(pasteEvent);
          }
        }
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (isAdmin) {
          onSelectTask(item.id, designerId, date, e.ctrlKey || e.metaKey);
        }
      }}
      onDoubleClick={(e) => {
        if (e.ctrlKey || e.metaKey) return;
        e.stopPropagation();
        if (isAdmin) {
          onTaskClick(item, designerId, date, 'task');
        }
      }}
      tabIndex={isAdmin ? 0 : -1}
      className={`task-row relative group/task grid grid-cols-[18rem_3rem] border-b border-gray-300 last:border-0 cursor-grab active:cursor-grabbing hover:bg-black/5 ${isLeaveType ? 'opacity-90' : ''} ${isSelected ? 'bg-blue-50/30' : ''}`}
    >
      {/* 枪名拖拽路径扫过时的预选中高亮：整条主任务描边变色（绿=可放置，红=重复不可放置） */}
      {gunDropTarget && (
        <div
          className="absolute inset-0 z-20 pointer-events-none"
          style={{
            border: `2px solid ${gunDropTarget === 'invalid' ? '#ef4444' : '#16a34a'}`,
            borderRadius: 3,
            backgroundColor: gunDropTarget === 'invalid' ? 'rgba(239,68,68,0.16)' : 'rgba(22,163,74,0.14)',
            boxShadow: gunDropTarget === 'invalid'
              ? '0 0 0 1px rgba(239,68,68,0.45)'
              : '0 0 0 1px rgba(22,163,74,0.45)',
          }}
        />
      )}
      {/* 主任务拖拽路径扫过时的预插入标记：顶部粗线表示将插入到该主任务上方（绿=可放置，红=复制内容重复） */}
      {taskInsertMarker && (
        <div
          className="absolute left-0 right-0 z-20 pointer-events-none"
          style={{
            top: -2,
            height: 4,
            borderRadius: 2,
            backgroundColor: taskInsertMarker === 'invalid' ? '#ef4444' : '#16a34a',
            boxShadow: taskInsertMarker === 'invalid'
              ? '0 0 0 1px rgba(239,68,68,0.55), 0 1px 4px rgba(239,68,68,0.5)'
              : '0 0 0 1px rgba(22,163,74,0.55), 0 1px 4px rgba(22,163,74,0.5)',
          }}
        />
      )}
      {/* Main Task Row */}
      <div
        className={`relative pl-2 pr-1.5 py-1.5 min-h-[28px] flex items-center break-all leading-relaxed text-[11px] font-medium hover:bg-blue-50/50 transition cursor-pointer ${isLeaveType ? 'border-r border-gray-300' : 'border-r border-gray-200'}`}
      >
        <div className="flex items-center w-full">
            {/* Mark buttons before task text（居中行绝对定位不占位；多行内容的行留在流内避让文字） */}
            {!item.leaveType && canMarkColor && (
              <div className={`${markBtnClass} opacity-0 group-hover/task:opacity-100 transition-opacity`}>
                {showMarkWhite && (
                  <button
                    type="button"
                    className="h-[18px] w-[18px] rounded bg-white border border-blue-300 shadow-sm flex-shrink-0 transition-all hover:border-blue-500 hover:ring-2 hover:ring-blue-300"
                    title="任务完成"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMarkColor(item, designerId, date, 'white');
                    }}
                  />
                )}
                {canRestoreColor && (
                  <button
                    type="button"
                    className="h-[18px] w-[18px] rounded bg-blue-100 border border-blue-300 shadow-sm flex items-center justify-center text-blue-600 transition-colors hover:bg-blue-600 hover:text-white hover:border-blue-700 flex-shrink-0"
                    title={isAutoMarked ? '任务未完成（联动恢复主任务及所有枪名）' : hasStoredUserMarkColor(item) ? '任务未完成' : '任务未完成（无原色记录，恢复为任务内容配色）'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMarkColor(item, designerId, date, 'restore');
                    }}
                  >
                    <RefreshCw size={11} strokeWidth={3} />
                  </button>
                )}
              </div>
            )}
            {typeLabel ? (
              /* 请假/出差文字：单行内容，按钮已绝对定位不占位，文字在整行真居中；
                 对称内边距只用来挡住两端的按钮，不改变居中位置。
                 出差行整行本身就是湖水青底色，文字不再套浅色徽标框，直接按行文字色显示 */
              <div className={`flex-1 min-w-0 flex items-center justify-center ${isSingleLineRow ? 'px-12' : ''}`}>
                <span className={`text-xs font-bold ${item.leaveType === 'sick' ? 'px-1.5 py-0.5 rounded bg-red-100 text-red-700' : item.leaveType === 'vacation' ? 'px-1.5 py-0.5 rounded bg-blue-100 text-blue-700' : item.leaveType === 'illness' ? 'px-1.5 py-0.5 rounded bg-pink-100 text-pink-700' : ''}`}>
                  {typeLabel}
                </span>
              </div>
            ) : (
              /* 主任务名占满剩余宽度（居中行绝对定位的按钮浮在两侧，用对称内边距把文字挡在按钮之间，
                 对称 padding 不改变居中位置）；本条任务没有枪名（只有一行内容）时文字水平居中 */
              <div className={`task-name flex-1 min-w-0 ${centerTaskName ? 'text-center px-12' : ''}`}>
                {item.taskName || <span className="text-gray-300 italic">无</span>}
              </div>
            )}
            {isMainMarkTarget && (
              <div className={isSingleLineRow ? 'absolute right-1.5 top-1/2 -translate-y-1/2 z-10' : 'flex items-center'}>{editingMarkBadge}</div>
            )}
            {/* Move up/down buttons（居中行绝对定位贴行右端，不占布局宽度；多行内容的行留在流内，
                长名换行不会被按钮覆盖；请假/出差同样可排序；他人正在编辑/标记本主任务时隐藏） */}
            {isAdmin && !isMainMarkTarget && (canMoveUp || canMoveDown) && (
              <div className={`${moveBtnClass} opacity-0 group-hover/task:opacity-100 transition-opacity`}>
                {canMoveUp && (
                  <button
                    className="h-[18px] w-[18px] flex items-center justify-center rounded bg-blue-100 text-blue-600 border border-blue-300 shadow-sm hover:bg-blue-600 hover:text-white hover:border-blue-700 transition-colors"
                    title="上移"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveTask(item, designerId, date, 'up');
                    }}
                  >
                    <ChevronUp size={14} strokeWidth={3} />
                  </button>
                )}
                {canMoveDown && (
                  <button
                    className="h-[18px] w-[18px] flex items-center justify-center rounded bg-blue-100 text-blue-600 border border-blue-300 shadow-sm hover:bg-blue-600 hover:text-white hover:border-blue-700 transition-colors"
                    title="下移"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveTask(item, designerId, date, 'down');
                    }}
                  >
                    <ChevronDown size={14} strokeWidth={3} />
                  </button>
                )}
              </div>
            )}
          </div>
      </div>
      <div 
        className="px-1 py-1 min-h-[24px] flex items-center justify-center font-mono font-bold hover:bg-blue-50/50 transition cursor-pointer"
        style={{ color: rowTextColor }}
        title={display.paused ? '「暂停/取消」任务：工时沿用当前值，0 也能保存；不为 0 时计入工时统计' : undefined}
      >
        {item.guns && item.guns.length > 0 ? '' : formatHoursCell(item.hours)}
      </div>

      {/* Gun Rows */}
      {(item.guns || []).map((gun, index) => {
        const gunIsWhite = isWhiteTaskColor(gun.color);
        const gunCanRestore = canMarkColor && gunIsWhite && (!hasStoredUserMarkColor(gun) || gun.colorMarkedBy);
        const gunShowMarkWhite = canMarkColor && !gunIsWhite;
        const gunCount = (item.guns || []).length;
        const canMoveUp = isAdmin && gunCount > 1 && index > 0;
        const canMoveDown = isAdmin && gunCount > 1 && index < gunCount - 1;
        
        return (
        <React.Fragment key={gun.id}>
          <div
            data-gun-index={index}
            className="gun-row border-r border-gray-200 px-2 py-1.5 min-h-[24px] flex items-center text-[11px] font-medium border-t border-gray-200/50 hover:bg-blue-50/50 transition cursor-pointer group/gun-row"
            style={{ backgroundColor: gunIsWhite ? '#ffffff' : rowBackground }}
          >
            {/* Gun mark buttons before gun name */}
            {canMarkColor && (
              <div className="flex items-center gap-1 mr-1 shrink-0 opacity-0 group-hover/gun-row:opacity-100 transition-opacity">
                {gunShowMarkWhite && (
                  <button
                    type="button"
                    className="h-[18px] w-[18px] rounded bg-white border border-blue-300 shadow-sm flex-shrink-0 transition-all hover:border-blue-500 hover:ring-2 hover:ring-blue-300"
                    title="任务完成"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMarkGunColor(item, designerId, date, index, 'white');
                    }}
                  />
                )}
                {gunCanRestore && (
                  <button
                    type="button"
                    className="h-[18px] w-[18px] rounded bg-blue-100 border border-blue-300 shadow-sm flex items-center justify-center text-blue-600 transition-colors hover:bg-blue-600 hover:text-white hover:border-blue-700 flex-shrink-0"
                    title={hasStoredUserMarkColor(gun) ? '任务未完成' : '任务未完成（无原色记录，恢复为任务内容配色）'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMarkGunColor(item, designerId, date, index, 'restore');
                    }}
                  >
                    <RefreshCw size={11} strokeWidth={3} />
                  </button>
                )}
              </div>
            )}
            <div className="flex-1 flex items-center gap-1">
              <span>{gun.name || '未命名'}</span>
            </div>
            {/* 他人正在修改本枪名完成状态时：隐藏悬停操作按钮组，原位显示「正在修改」标记 */}
            {editingMarkSession?.gunIndex === index ? editingMarkBadge : (
            /* 枪名操作按钮组：拖动 / 上移 / 下移 / 删除，拉开间距避免相互干扰 */
            <div className="flex items-center gap-1 shrink-0 pl-1">
            {isAdmin && (
              <GunDragHandle
                item={item}
                designerId={designerId}
                date={date}
                gunIndex={index}
                gun={gun}
                disabled={!isAdmin}
              />
            )}
            {canMoveUp && (
              <button
                className="opacity-0 group-hover/gun-row:opacity-100 h-[18px] w-[18px] flex items-center justify-center rounded bg-blue-100 text-blue-600 border border-blue-300 shadow-sm hover:bg-blue-600 hover:text-white hover:border-blue-700 transition-colors"
                title="上移"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveGun(item, designerId, date, index, 'up');
                }}
              >
                <ChevronUp size={14} strokeWidth={3} />
              </button>
            )}
            {canMoveDown && (
              <button
                className="opacity-0 group-hover/gun-row:opacity-100 h-[18px] w-[18px] flex items-center justify-center rounded bg-blue-100 text-blue-600 border border-blue-300 shadow-sm hover:bg-blue-600 hover:text-white hover:border-blue-700 transition-colors"
                title="下移"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveGun(item, designerId, date, index, 'down');
                }}
              >
                <ChevronDown size={14} strokeWidth={3} />
              </button>
            )}
             {isAdmin && (
               <button
                 className="opacity-0 group-hover/gun-row:opacity-100 h-[18px] w-[18px] flex items-center justify-center rounded bg-red-100 text-red-600 border border-red-300 shadow-sm hover:bg-red-600 hover:text-white hover:border-red-700 transition-colors"
                 title="删除枪名"
                 onClick={(e) => {
                   e.stopPropagation();
                   onDeleteGun(item, designerId, date, index);
                 }}
               >
                 <Trash2 size={13} strokeWidth={3} />
               </button>
             )}
            </div>
            )}
            </div>
          <div
            data-gun-index={index}
            className="px-1 py-1 min-h-[24px] flex items-center justify-center font-mono font-bold border-t border-gray-200/50 hover:bg-blue-50/50 transition cursor-pointer"
            style={{ backgroundColor: gunIsWhite ? '#ffffff' : rowBackground, color: rowTextColor }}
          >
            {formatHoursCell(gun.hours)}
          </div>
        </React.Fragment>
        );
      })}
    </div>
  );
};

export default SortableTask;
