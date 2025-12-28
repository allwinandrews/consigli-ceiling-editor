// src/state/EditorContext.ts
import { createContext } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { EditorState, GridCell } from "../types/editor";

/**
 * Metadata shown in the "Saved Layouts" list page.
 *
 * Notes:
 * - This is intentionally kept small (no heavy editor state here).
 * - The actual saved editor snapshot lives in the persistence layer
 *   implemented inside EditorProvider.
 */
export type SavedLayoutMeta = {
  id: string;
  name: string;
  createdAt: number; // Unix epoch in milliseconds
  updatedAt: number; // Unix epoch in milliseconds
};

/**
 * Arguments for saving the current editor snapshot.
 *
 * Behavior:
 * - If `id` is provided -> overwrite that saved layout (or create it if missing)
 * - If `id` is missing / null -> create a brand new saved layout id
 * - `name` is optional; provider may auto-generate one if not provided
 */
export type SaveLayoutArgs = {
  id?: string | null;
  name?: string;
};

/**
 * Public API exposed through the EditorStateContext.
 *
 * This is the "contract" between UI components and the state layer:
 * - UI reads `state` for rendering
 * - UI calls actions to make changes (tool changes, placement, grid resize, etc.)
 * - Provider decides which updates are undoable, persisted, validated, etc.
 */
export type EditorStateApi = {
  /**
   * Current in-memory editor state.
   * This includes runtime-only values (viewport size) and persisted values
   * (grid, components, invalid cells, selected items, etc.).
   */
  state: EditorState;

  /**
   * Low-level state setter.
   *
   * Intended use:
   * - Complex UI flows that need to update multiple parts of state at once
   *   (example: Toolbar renaming, clearing selections, etc.).
   *
   * Provider responsibility:
   * - Decide whether to record this change into the undo history.
   */
  setState: Dispatch<SetStateAction<EditorState>>;

  /**
   * Camera controls (pan/zoom).
   * Typically not part of undo history because it's "view state", not "layout state".
   */
  setCamera: (
    updater: (prev: EditorState["camera"]) => EditorState["camera"]
  ) => void;

  /**
   * Component placement list setter.
   * Provider can enforce rules such as:
   * - Removing selectedComponentId if the selected component no longer exists
   * - Recording in undo history
   */
  setComponents: (
    updater: (prev: EditorState["components"]) => EditorState["components"]
  ) => void;

  /**
   * Canvas viewport size (pixels).
   * Updated by CanvasStage resize observer; used for zoom-centering logic.
   * This is runtime-only and should not be persisted.
   */
  setViewportSize: (width: number, height: number) => void;

  /**
   * Grid size (in cells).
   * Provider should clean up out-of-bounds components/invalid cells after resizing.
   */
  setGrid: (cols: number, rows: number) => void;

  /**
   * Active editor tool, used by CanvasStage interactions.
   */
  setTool: (tool: EditorState["tool"]) => void;

  /**
   * Which component type is currently selected for placement.
   */
  setActiveComponentType: (type: EditorState["activeComponentType"]) => void;

  /**
   * Select a specific placed component by id, or clear selection with null.
   */
  setSelectedComponentId: (id: string | null) => void;

  /**
   * Invalid cell editing API.
   *
   * Invalid cells are treated as a first-class editable entity:
   * - They block component placement
   * - They can be created/removed
   * - They can be selected (via `selectedInvalidCellKey` stored in EditorState)
   */
  setInvalidCells: (
    updater: (prev: EditorState["invalidCells"]) => EditorState["invalidCells"]
  ) => void;

  /**
   * Convenience action to toggle a single cell as invalid/valid.
   * Provider may additionally enforce rules like removing components that now overlap.
   */
  toggleInvalidCell: (cell: GridCell) => void;

  /**
   * Undo the last undoable layout change.
   * (Redo is intentionally not exposed in this version.)
   */
  undo: () => void;
  canUndo: boolean;

  // ---------------------------------------------------------------------
  // Persistence: Saved Layouts
  // ---------------------------------------------------------------------

  /**
   * The currently selected saved layout id.
   *
   * Meaning:
   * - null -> "no layout selected" -> editor should load as empty on refresh
   * - string -> editor should restore the matching saved layout on refresh
   */
  selectedLayoutId: string | null;

  /**
   * Metadata list used by the Saved Layouts page (list/rename/delete/open).
   * The heavy editor snapshot is NOT included here on purpose.
   */
  savedLayouts: SavedLayoutMeta[];

  /**
   * Persist the current editor state into a saved layout entry.
   *
   * Rules:
   * - If args.id exists: overwrite that layout id (or create if missing).
   * - If args.id is missing/null: create a new layout id.
   *
   * Returns:
   * - The id of the saved layout (new or existing).
   */
  saveLayout: (args?: SaveLayoutArgs) => string;

  /**
   * Load a saved layout into the editor and mark it as selected.
   */
  openLayout: (id: string) => void;

  /**
   * Update the saved layout name (metadata only).
   */
  renameLayout: (id: string, name: string) => void;

  /**
   * Remove a saved layout permanently.
   * Provider should clear selection + reset editor if deleting the active one.
   */
  deleteLayout: (id: string) => void;

  /**
   * Clear the selected layout id AND reset the editor to an empty state.
   * Used by:
   * - SavedLayoutsPage "New empty"
   * - EditorPage when route is "/"
   */
  clearSelectedLayout: () => void;
};

/**
 * Global editor context.
 *
 * Implementation notes:
 * - The value is provided by <EditorProvider>.
 * - Consumers should use the `useEditorState()` hook instead of calling useContext directly.
 */
export const EditorStateContext = createContext<EditorStateApi | null>(null);
