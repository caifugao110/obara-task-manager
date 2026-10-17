import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Designer } from '../types';

const SortableDesignerTbody = ({ designer, isAdmin, children }: { designer: Designer, isAdmin: boolean, children: (args: { attributes: any, listeners: any, isDragging: boolean }) => React.ReactNode }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `designer-${designer.id}`,
    data: {
      type: 'designer',
      designerId: designer.id,
      group: designer.group || '未分组',
    },
    disabled: !isAdmin,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <tbody ref={setNodeRef} style={style}>
      {children({ attributes, listeners, isDragging })}
    </tbody>
  );
};

export default SortableDesignerTbody;
