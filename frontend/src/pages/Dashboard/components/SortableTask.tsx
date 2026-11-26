import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { RefreshCw, ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import type { EditingSession, SelectedTask, TaskItem } from '../types';
import { hasStoredUserMarkColor, isWhiteTaskColor, taskSelectionKey } from '../utils';
import { getLeaveRowColors, getTaskDisplayColors } from '../../../utils/taskColors';
import { useSystemSettings } from '../../../context/SystemSettingsContext';
import GunDragHandle from './GunDragHandle';
import GunNameCopyButton from './GunNameCopyButton';
import { usePageZoom } from '../../../utils/pageZoom';

// 工时单元格显示：0 或空值不显示数字（避免「暂停/取消」等 0 工时任务满屏 0）
const formatHoursCell = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === '') return '';
  const numeric = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(numeric) && numeric > 0 ? value : '';
};

const SortableTask = ({ item, designerId, date, isAdmin, canMarkColor, canMoveUp, canMoveDown, onTaskClick, onDeleteGun, onMoveGun, onMoveTask, onDeleteTask, onMarkColor, onMarkGunColor, selectedTasks, onSelectTask, metadataTitle, taskColWidth = 288, editingMarkSession = null, showTopSeparator = false, locateFlash = false }: { item: TaskItem, designerId: string, date: string, isAdmin: boolean, canMarkColor: boolean, canMoveUp: boolean, canMoveDown: boolean, onTaskClick: (item: TaskItem, designerId: string, date: string, type: 'task' | 'hours' | 'gun' | 'gunHours', gunIndex?: number) => void, onDeleteGun: (item: TaskItem, designerId: string, date: string, gunIndex: number) => void, onMoveGun: (item: TaskItem, designerId: string, date: string, gunIndex: number, direction: 'up' | 'down') => void, onMoveTask: (item: TaskItem, designerId: string, date: string, direction: 'up' | 'down') => void, onDeleteTask: (item: TaskItem, designerId: string, date: string) => void, onMarkColor: (item: TaskItem, designerId: string, date: string, action: 'white' | 'restore') => void, onMarkGunColor: (item: TaskItem, designerId: string, date: string, gunIndex: number, action: 'white' | 'restore') => void, selectedTasks: SelectedTask[], onSelectTask: (itemId: string, designerId: string, date: string, append: boolean) => void, metadataTitle: string, taskColWidth?: number, editingMarkSession?: EditingSession | null, showTopSeparator?: boolean, locateFlash?: boolean }) => {
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

  // dnd-kit 给的位移是屏幕 px，而这一行在主页面的缩放层里，translate 要按倍率折成本地 px，
  // 否则缩放不是 100% 时拖动会「跑得比光标快」（浮层本身已经在缩放层外，见 Dashboard 的 DragOverlay）。
  // 用订阅版钩子：缩放变化后这一行必须跟着按新倍率换算，否则拖动位移会与光标脱节
  const pageZoom = usePageZoom();
  const style = {
    transform: transform
      ? `translate3d(${transform.x / pageZoom}px, ${transform.y / pageZoom}px, 0)`
      : undefined,
    transition,
    backgroundColor: rowBackground,
    color: rowTextColor,
    opacity: isDragging ? 0.3 : 1,
    border: isSelected ? '2px solid #3b82f6' : '1px solid transparent',
    // 行与行之间的分隔线：inline 的 border 会盖掉 className 里的 border-b，
    // 所以这条底线必须写进 inline style 才看得见（选中态由 2px 蓝框整圈接管）。
    // 颜色用 gray-400(#9ca3af) 而不是原来的 gray-300，行间距更清楚。
    borderBottom: isSelected ? '2px solid #3b82f6' : '1px solid #9ca3af',
    borderRadius: isSelected ? '4px' : '0',
    // 列宽随视口变化（任务内容列由主页面反算后传进来，工时列固定 3rem 不变），
    // 必须和表头的任务内容/工时两列严格对齐，所以用内联值而不是写死的 grid-cols
    gridTemplateColumns: `${taskColWidth}px 3rem`,
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

  // 选中任务后按任意键会冒出一圈黑框，来源是这个 div 本身可聚焦（tabIndex=0 + dnd-kit 注入的 role="button"）：
  // 鼠标点中后再按键盘，浏览器会把当前焦点判为「键盘焦点」并画出 UA 默认焦点框（Windows 上就是黑色圆角描边）。
  // 下面的 focus:outline-none 用来关掉它；选中态已有 2px 蓝框标识，键盘拖拽（Tab 聚焦 / Space 起拖）不受影响。
  return (
    <div
      ref={setNodeRef}
      data-task-id={item.id}
      data-designer-id={designerId}
      data-date={date}
      title={isAdmin ? `${metadataTitle}\n单击选中后连按两次空格，可直接编辑本任务（双击任务同样可编辑）` : undefined}
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
        // 双击主任务时第二次 click 不再开一次编辑会话/改选中态，
        // 避免 dblclick 打开弹窗前先被两次整表重渲阻塞（会话由 dblclick 统一开启）。
        if (e.detail >= 2) return;
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
      className={`task-row relative group/task grid cursor-grab active:cursor-grabbing hover:bg-black/5 focus:outline-none focus-visible:outline-none ${isLeaveType ? 'opacity-90' : ''} ${isSelected ? 'bg-blue-50/30' : ''}`}
    >
      {/* 同一设计人员同一天有多个主任务时，第 2 条起在顶部画一条分界线：
          主任务之间是 2px 深灰线（#6b7280），主任务与它自己的枪名行之间是 1px 灰线（#9ca3af），
          靠粗细 + 深浅拉开层级，避免两条同色主任务（尤其都是「设计」浅黄）糊成一片。
          top:-2 / height:2：正好盖住上一条任务的 1px 底线，接缝处只剩一条深灰线，不会出现双线。
          用绝对定位而不是 border-top：外层 div 已用 inline style 写了 border（选中态 2px 蓝框），
          inline 会盖掉 className 里的边框；绝对定位也让它不占布局高度，拖拽/行高实测不受影响。
          该主任务被选中时隐藏本线：蓝色 2px 选中框本身就画在这一圈，叠在一起会显得边框发脏。 */}
      {showTopSeparator && !isSelected && (
        <div
          className="absolute left-0 right-0 pointer-events-none z-[5]"
          style={{ top: -2, height: 2, backgroundColor: '#6b7280' }}
        />
      )}
      {/* 定位高亮：查找到 / 安排新增成功后滚到本行，用一圈大红色粗框连闪几下标出「就是这一条」，
          2.8s 后由调用方卸载（locateFlash 由调用方计时清除）。
          大红色（#dc2626）在任何任务底色/选中蓝框上都跳得出来，描边 3px + 外圈光晕更醒目；
          层级最高但完全不挡鼠标 */}
      {locateFlash && (
        <div
          className="task-locate-flash absolute inset-0 z-30 pointer-events-none"
          style={{
            border: '3px solid #dc2626',
            borderRadius: 4,
            backgroundColor: 'rgba(220,38,38,0.16)',
          }}
        />
      )}
      {/* 枪名拖拽 / 主任务拖拽的落点高亮由 dragHighlight 直接写 data-* 属性 + index.css 绘制，
          不再作为 props 参与渲染（避免落点每变化一次就把整张表重渲一遍） */}
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
            className="gun-row border-r border-gray-200 px-2 py-1.5 min-h-[24px] flex items-center text-[11px] font-medium border-t border-gray-400 hover:bg-blue-50/50 transition cursor-pointer group/gun-row"
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
            /* 枪名操作按钮组：复制 / 拖动 / 上移 / 下移 / 删除，拉开间距避免相互干扰 */
            <div className="flex items-center gap-2 shrink-0 pl-2">
            {/* 复制枪名：拖动手柄左侧，所有登录用户可用（不区分权限） */}
            <GunNameCopyButton gunName={gun.name} />
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
            className="px-1 py-1 min-h-[24px] flex items-center justify-center font-mono font-bold border-t border-gray-400 hover:bg-blue-50/50 transition cursor-pointer"
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

// 主表格每次因 sheets 变化重渲时，绝大多数主任务的 item 与回调引用都没变：
// memo 挡掉这些行的重渲，只让真正被改动的那一条走一遍渲染。
// 注意它同时是 dnd-kit 的 context 消费者，memo 挡不住 context 更新——
// 那部分由 DashboardBoard 的 memo + 稳定的 sensors 处理。
export default React.memo(SortableTask);
