/**
 * Core domain types for the ceiling grid editor.
 *
 * This file is intentionally UI-agnostic:
 * - No React
 * - No browser APIs
 * - Only pure domain concepts
 *
 * Keeping these types clean makes the editor easier to reason about,
 * test, and evolve as requirements change.
 */

// ----------------------
// Grid fundamentals
// ----------------------

/**
 * Logical grid dimensions.
 * Each cell represents a fixed physical size (e.g. 0.6m × 0.6m).
 */
export type GridSize = {
  cols: number;
  rows: number;
};

/**
 * A single grid coordinate.
 * Uses 0-based indexing (top-left = { x: 0, y: 0 }).
 */
export type GridCell = {
  x: number; // column index
  y: number; // row index
};

// ----------------------
// Component types
// ----------------------

/**
 * All supported ceiling component categories.
 *
 * NOTE:
 * If new component types are added, update:
 * - Toolbar UI
 * - CanvasStage rendering logic
 * - Naming rules (prefix + sequence)
 */
export type ComponentType =
  | "LIGHT"
  | "AIR_SUPPLY"
  | "AIR_RETURN"
  | "SMOKE_DETECTOR";

/**
 * A component placed on the grid.
 *
 * Naming model:
 * - `autoName` is assigned once at creation time (e.g. "L1", "AS2") and persisted.
 *   It must not be recomputed from the current list order, otherwise deletes would
 *   cause remaining components to be renumbered.
 * - `label` is an optional user override shown in the UI.
 *   If present, it takes precedence over `autoName`.
 */
export type PlacedComponent = {
  /**
   * Globally unique identifier for this placed component.
   * Used for selection, drag, and persistence.
   */
  id: string;

  /**
   * Component category (drives rendering and naming prefix).
   */
  type: ComponentType;

  /**
   * Grid cell occupied by this component (one component per cell).
   */
  cell: GridCell;

  /**
   * Stable default name assigned when the component is created.
   * Example: "L1", "AS1", "AR3", "SD2".
   */
  autoName: string;

  /**
   * Optional user-defined label.
   * When present, the UI should display this instead of `autoName`.
   */
  label?: string;
};

// ----------------------
// Camera / viewport
// ----------------------

/**
 * Camera transform applied to the canvas.
 *
 * panX / panY are screen-space pixels.
 * zoom is a scale factor (1 = 100%).
 */
export type Camera = {
  panX: number;
  panY: number;
  zoom: number;
};

/**
 * Runtime canvas viewport size (in pixels).
 *
 * Used to:
 * - Zoom around the center of the visible area
 * - Keep zoom behavior consistent when resizing
 *
 * This is NOT persisted.
 */
export type Viewport = {
  width: number;
  height: number;
};

// ----------------------
// Editor tools / modes
// ----------------------

/**
 * Active editor tool selected by the user.
 */
export type EditorTool = "PAN" | "PLACE" | "SELECT" | "ERASE";

/**
 * Sub-mode for the PLACE tool.
 *
 * - COMPONENT: place ceiling components
 * - INVALID_CELL: mark grid cells as unusable
 */
export type PlaceMode = "COMPONENT" | "INVALID_CELL";

// ----------------------
// Editor state
// ----------------------

/**
 * Complete in-memory editor state.
 *
 * Notes:
 * - Some fields are persisted (grid, components, invalidCells, etc.)
 * - Some fields are runtime-only (viewport)
 * - The provider decides which changes are undoable
 */
export type EditorState = {
  /**
   * Grid dimensions (cell count).
   */
  grid: GridSize;

  /**
   * Cells where components cannot be placed.
   *
   * Stored as string keys ("x,y") for fast lookup and easy persistence.
   */
  invalidCells: Set<string>;

  /**
   * All placed components in the layout.
   */
  components: PlacedComponent[];

  /**
   * Camera state used by CanvasStage.
   */
  camera: Camera;

  /**
   * Current canvas viewport size (pixels).
   */
  viewport: Viewport;

  /**
   * Active tool and component selection.
   */
  tool: EditorTool;
  activeComponentType: ComponentType;

  /**
   * Current placement target when using PLACE tool.
   */
  placeMode: PlaceMode;

  /**
   * Selected component id (for move / delete).
   */
  selectedComponentId: string | null;

  /**
   * Selected invalid cell key ("x,y"), if any.
   */
  selectedInvalidCellKey: string | null;

  /**
   * Optional user-defined labels for invalid cells.
   * Example: { "3,7": "IV Kitchen" }
   */
  invalidCellLabels: Record<string, string>;
};

// ----------------------
// Small domain helpers
// ----------------------

/**
 * Build a stable string key for a grid cell.
 *
 * Use this helper instead of re-implementing `${x},${y}` everywhere
 * to keep behavior consistent.
 */
export function cellKey(cell: GridCell): string {
  return `${cell.x},${cell.y}`;
}

/**
 * Check whether a cell is inside the grid bounds.
 */
export function isWithinGrid(cell: GridCell, grid: GridSize): boolean {
  return cell.x >= 0 && cell.y >= 0 && cell.x < grid.cols && cell.y < grid.rows;
}
