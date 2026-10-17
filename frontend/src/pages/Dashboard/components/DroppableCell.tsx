import { useDroppable } from '@dnd-kit/core';

const DroppableCell = ({ designerId, date, children, className, ...props }: any) => {
  const { setNodeRef } = useDroppable({
    id: `cell-${designerId}-${date}`,
    data: {
      type: 'cell',
      designerId,
      date,
    }
  });

  return (
    <td ref={setNodeRef} className={className} data-cell-designer-id={designerId} data-cell-date={date} {...props}>
      {children}
    </td>
  );
};

export default DroppableCell;
