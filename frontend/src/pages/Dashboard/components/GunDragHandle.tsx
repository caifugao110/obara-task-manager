import { useDraggable } from '@dnd-kit/core';
import { Move } from 'lucide-react';
import type { GunItem, TaskItem } from '../types';
import { gunRowDragState } from '../gunDragState';

// 枪名跨主任务拖拽手柄：仅支持按住不放进行拖动（无点击等其它操作），
// 落点判定由 Dashboard 的 handleDragEnd 通过指针位置命中 DOM 完成
const GunDragHandle = ({ item, designerId, date, gunIndex, gun, disabled }: {
  item: TaskItem;
  designerId: string;
  date: string;
  gunIndex: number;
  gun: GunItem;
  disabled: boolean;
}) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `gun-${designerId}-${date}-${item.id}-${gun.id}`,
    data: { type: 'gun', item, designerId, date, gunIndex, gun },
    disabled,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      onPointerDown={(e) => {
        // 阻止冒泡到主任务行的拖拽/选中逻辑，仅启动枪名拖拽
        e.stopPropagation();
        // 直接量取本手柄所在的枪名行：枪名格 + 相邻工时格
        const cell = (e.currentTarget as HTMLElement).closest('[data-gun-index]') as HTMLElement | null;
        const hoursCell = cell?.nextElementSibling as HTMLElement | null;
        if (cell) {
          gunRowDragState.originCell = cell;
          const r = cell.getBoundingClientRect();
          const hr = hoursCell?.getBoundingClientRect();
          // DragOverlay 根容器锚定在手柄按钮的初始矩形上，这里同帧量取手柄坐标用于平移对齐
          const hb = (e.currentTarget as HTMLElement).getBoundingClientRect();
          gunRowDragState.dims = {
            width: r.width + (hr?.width ?? 48),
            height: r.height,
            hoursWidth: hr?.width ?? 48,
            x: r.x,
            y: r.y,
            handleX: hb.x,
            handleY: hb.y,
          };
        } else {
          gunRowDragState.dims = null;
          gunRowDragState.originCell = null;
        }
        (listeners?.onPointerDown as any)?.(e);
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`shrink-0 p-1 transition-all cursor-grab active:cursor-grabbing ${isDragging ? 'opacity-30' : 'opacity-0 group-hover/gun-row:opacity-100 text-gray-300 hover:text-blue-600'}`}
      style={{ touchAction: 'none' }}
      title="按住拖动到其他主任务"
      tabIndex={-1}
    >
      <Move size={13} />
    </button>
  );
};

export default GunDragHandle;
