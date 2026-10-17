// 模块级暂存：枪名拖拽手柄按下时直接量取所在枪名行（枪名格+工时格）的实测尺寸与位置，
// 供 DragOverlay 等比复刻（避免 document.querySelector 命中未布局元素量出 0/NaN）
// 同时保留触发拖拽的枪名格 DOM，防止 drag 激活后鼠标已移开导致 elementFromPoint 找不到源行
export interface GunRowDragDims {
  width: number;
  height: number;
  hoursWidth: number;
  x: number;
  y: number;
  handleX?: number;
  handleY?: number;
}

export const gunRowDragState: {
  dims: GunRowDragDims | null;
  originCell: HTMLElement | null;
} = {
  dims: null,
  originCell: null,
};
