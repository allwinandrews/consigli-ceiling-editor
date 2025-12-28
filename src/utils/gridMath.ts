import type { Camera, GridCell, GridSize } from "../types/editor";

/**
 * A point in canvas (screen) coordinates.
 * This represents raw pixel positions relative to the <canvas> element.
 */
export type CanvasPoint = {
  x: number; // X position in canvas pixels
  y: number; // Y position in canvas pixels
};

/**
 * A point in world coordinates.
 *
 * World space is the editor’s logical coordinate system:
 * - Before camera transforms (pan / zoom) are applied
 * - One world unit maps to one pixel at zoom = 1
 */
export type WorldPoint = {
  x: number;
  y: number;
};

/**
 * Default size of a single grid cell in world units.
 *
 * In this editor:
 * - 1 grid cell = 40 world units
 * - This value is shared across canvas math and rendering
 */
export const DEFAULT_CELL_SIZE = 40;

/**
 * Convert a canvas-space point into world-space coordinates.
 *
 * This reverses the camera transform:
 * - Remove pan offset
 * - Undo zoom scaling
 *
 * Used when translating mouse / pointer positions into grid interactions.
 */
export function canvasToWorld(point: CanvasPoint, camera: Camera): WorldPoint {
  return {
    x: (point.x - camera.panX) / camera.zoom,
    y: (point.y - camera.panY) / camera.zoom,
  };
}

/**
 * Convert a world-space point into canvas-space coordinates.
 *
 * This applies the camera transform:
 * - Scale by zoom
 * - Apply pan offset
 *
 * Used when drawing world elements onto the canvas.
 */
export function worldToCanvas(point: WorldPoint, camera: Camera): CanvasPoint {
  return {
    x: point.x * camera.zoom + camera.panX,
    y: point.y * camera.zoom + camera.panY,
  };
}

/**
 * Convert a world-space point into a grid cell.
 *
 * - World coordinates are snapped down using Math.floor
 * - This determines which grid cell a point belongs to
 *
 * Used for:
 * - Click / hover detection
 * - Drag and drop logic
 * - Placement validation
 */
export function worldToCell(
  world: WorldPoint,
  cellSize = DEFAULT_CELL_SIZE
): GridCell {
  return {
    x: Math.floor(world.x / cellSize),
    y: Math.floor(world.y / cellSize),
  };
}

/**
 * Convert a grid cell into world-space coordinates.
 *
 * The returned point represents the **top-left corner**
 * of the given grid cell in world space.
 *
 * Used during rendering to position cell-aligned visuals.
 */
export function cellToWorld(
  cell: GridCell,
  cellSize = DEFAULT_CELL_SIZE
): WorldPoint {
  return {
    x: cell.x * cellSize,
    y: cell.y * cellSize,
  };
}

/**
 * Check whether a grid cell is inside the grid bounds.
 *
 * This is a core safety check used throughout the editor
 * to prevent placing, dragging, or rendering outside the room.
 */
export function isWithinGrid(cell: GridCell, grid: GridSize): boolean {
  return cell.x >= 0 && cell.y >= 0 && cell.x < grid.cols && cell.y < grid.rows;
}

/**
 * Build a stable string key for a grid cell.
 *
 * Format: "x,y"
 *
 * Used as:
 * - Keys in Sets (invalid cells)
 * - Keys in Maps / label dictionaries
 * - A compact, serializable cell identifier
 */
export function cellKey(cell: GridCell): string {
  return `${cell.x},${cell.y}`;
}

/**
 * Compute which grid cells are currently visible in the viewport.
 *
 * This is critical for performance:
 * - Large grids may contain thousands of cells
 * - We only draw cells that are actually visible on screen
 *
 * The bounds are slightly expanded to avoid visual clipping
 * at the edges during panning and zooming.
 */
export function getVisibleCellBounds(args: {
  canvasWidth: number;
  canvasHeight: number;
  camera: Camera;
  grid: GridSize;
  cellSize?: number;
}) {
  const { canvasWidth, canvasHeight, camera, grid } = args;
  const cellSize = args.cellSize ?? DEFAULT_CELL_SIZE;

  // Convert the visible canvas corners into world space
  const topLeft = canvasToWorld({ x: 0, y: 0 }, camera);
  const bottomRight = canvasToWorld(
    { x: canvasWidth, y: canvasHeight },
    camera
  );

  // Convert world-space bounds into grid cell indices
  const minCell = worldToCell(topLeft, cellSize);
  const maxCell = worldToCell(bottomRight, cellSize);

  // Expand by one cell in each direction to prevent edge clipping
  const minX = Math.max(0, minCell.x - 1);
  const minY = Math.max(0, minCell.y - 1);

  const maxX = Math.min(grid.cols - 1, maxCell.x + 1);
  const maxY = Math.min(grid.rows - 1, maxCell.y + 1);

  return { minX, minY, maxX, maxY };
}
