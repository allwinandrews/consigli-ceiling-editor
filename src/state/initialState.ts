// src/state/initialState.ts
import type { EditorState } from "../types/editor";

/**
 * Default grid dimensions used when the editor first loads.
 *
 * These values represent a reasonable working area for the take-home task.
 * The grid can later be resized via editor controls.
 */
const DEFAULT_GRID = {
  cols: 20,
  rows: 20,
};

/**
 * Initial editor state.
 *
 * This state is used when:
 * - The application first loads with no saved layout selected
 * - The user explicitly starts a new empty layout
 * - A saved layout fails to restore (corrupt or incompatible data)
 *
 * Important:
 * - This file defines ONLY defaults.
 * - Persistence, hydration, and undo history are handled in EditorProvider.
 */
export const initialEditorState: EditorState = {
  /**
   * Logical grid dimensions.
   */
  grid: DEFAULT_GRID,

  /**
   * Set of invalid grid cells ("x,y").
   *
   * Invalid cells are fully user-defined.
   * Any persisted invalid cells are restored by the provider,
   * not initialized here.
   */
  invalidCells: new Set(),

  /**
   * All placed components in the current layout.
   */
  components: [],

  /**
   * Camera transform for the canvas.
   * Starts centered at origin with 100% zoom.
   */
  camera: {
    panX: 0,
    panY: 0,
    zoom: 1,
  },

  /**
   * Runtime-only viewport size.
   * CanvasStage updates this when the canvas is resized.
   */
  viewport: {
    width: 0,
    height: 0,
  },

  /**
   * Default active tool when the editor opens.
   */
  tool: "PAN",

  /**
   * Default component type selected for placement.
   */
  activeComponentType: "LIGHT",

  /**
   * Default PLACE tool mode.
   * Users can switch between placing components and marking invalid cells.
   */
  placeMode: "COMPONENT",

  /**
   * Currently selected component (if any).
   */
  selectedComponentId: null,

  /**
   * Currently selected invalid cell key ("x,y"), if any.
   */
  selectedInvalidCellKey: null,

  /**
   * Optional user-defined labels for invalid cells.
   * Stored as a map keyed by "x,y".
   */
  invalidCellLabels: {},
};
