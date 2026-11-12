export interface DropPoint { x: number; y: number }

/**
 * Wry 0.57 on macOS passes AppKit NSPoint values through as PhysicalPosition.
 * Those values are window points already; dividing by Retina DPR moves the drop
 * into a different frame. Other backends supply physical pixels as documented.
 */
export function nativeDropPoint(point: DropPoint, devicePixelRatio: number, platform: string): DropPoint | null {
  if (![point.x, point.y, devicePixelRatio].every(Number.isFinite) || devicePixelRatio <= 0) return null;
  const divisor = /mac/i.test(platform) ? 1 : devicePixelRatio;
  return { x: point.x / divisor, y: point.y / divisor };
}
