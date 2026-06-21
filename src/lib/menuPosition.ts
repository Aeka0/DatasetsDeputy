export interface PointPosition {
  x: number;
  y: number;
}

export function clampContextMenuPosition(
  x: number,
  y: number,
  { width = 188, height = 158, padding = 8 }: { width?: number; height?: number; padding?: number } = {}
): PointPosition {
  return {
    x: Math.max(padding, Math.min(x, window.innerWidth - width - padding)),
    y: Math.max(padding, Math.min(y, window.innerHeight - height - padding))
  };
}
