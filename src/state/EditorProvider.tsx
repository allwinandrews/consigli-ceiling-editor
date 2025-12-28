// src/state/EditorProvider.tsx
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { EditorState, GridCell } from "../types/editor";
import { initialEditorState } from "./initialState";
import {
  EditorStateContext,
  type EditorStateApi,
  type SavedLayoutMeta,
  type SaveLayoutArgs,
} from "./EditorContext";

const HISTORY_LIMIT = 50;

// localStorage keys used by the “Saved Layouts” feature.
const STORAGE_KEY_SAVED_LAYOUTS = "consigli_saved_layouts_v1";
const STORAGE_KEY_SELECTED_LAYOUT_ID = "consigli_selected_layout_id_v1";

// --------------------------------------
// Persistence schema (versioned) — v1
// --------------------------------------

/**
 * A JSON-serializable snapshot of the editor state.
 *
 * Notes:
 * - We store a version number so we can migrate later if the state shape changes.
 * - Sets cannot be JSON-serialized directly, so we store invalidCells as an array.
 * - viewport is intentionally excluded: it is runtime-only and comes from CanvasStage.
 */
type PersistedEditorStateV1 = {
  v: 1;
  grid: EditorState["grid"];
  components: EditorState["components"];
  camera: EditorState["camera"];
  tool: EditorState["tool"];
  activeComponentType: EditorState["activeComponentType"];
  selectedComponentId: EditorState["selectedComponentId"];
  placeMode: EditorState["placeMode"];

  // Set can't be JSON, so we persist as an array of "x,y" strings.
  invalidCells: string[];

  // Optional fields for backward compatibility with older stored states.
  selectedInvalidCellKey?: string | null;
  invalidCellLabels?: Record<string, string>;
};

/**
 * Each saved layout entry stores:
 * - user-facing metadata (name, timestamps)
 * - schemaVersion for the wrapper entry
 * - persisted editor data (versioned independently)
 */
type SavedLayoutEntryV1 = SavedLayoutMeta & {
  schemaVersion: 1;
  data: PersistedEditorStateV1;
};

// -----------------------
// Utilities / helpers
// -----------------------

/**
 * Parse JSON safely without throwing.
 * Returns `null` if the input is invalid JSON.
 */
function safeParseJson(txt: string): unknown {
  try {
    return JSON.parse(txt) as unknown;
  } catch {
    return null;
  }
}

/**
 * Generate a local id for saved layouts.
 * We prefer crypto.randomUUID (best uniqueness), but provide a fallback for older browsers.
 */
function generateId(): string {
  const c = globalThis.crypto as unknown as
    | { randomUUID?: () => string }
    | undefined;

  if (c?.randomUUID) return c.randomUUID();

  // Fallback: good enough for client-only local storage usage.
  return `layout_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Convert a cell into its stable "x,y" key form.
 * This format is used across the app for invalid cell sets and label dictionaries.
 */
function cellKey(cell: GridCell): string {
  return `${cell.x},${cell.y}`;
}

/**
 * Parse a "x,y" string back into numbers.
 * We sanitize by flooring to integers since grid coordinates must be integers.
 */
function parseCellKey(key: string): { x: number; y: number } | null {
  const [xs, ys] = key.split(",");
  const x = Number(xs);
  const y = Number(ys);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.floor(x), y: Math.floor(y) };
}

/**
 * Validate and normalize invalid cell keys loaded from storage.
 *
 * Why this exists:
 * - localStorage can be edited manually or become corrupted
 * - grid size might change between saves
 * - we only keep keys that are valid "x,y" and within bounds
 */
function sanitizeInvalidCells(
  keys: unknown,
  grid: EditorState["grid"]
): Set<string> {
  if (!Array.isArray(keys)) return new Set();

  const next = new Set<string>();
  for (const k of keys) {
    if (typeof k !== "string") continue;

    const parsed = parseCellKey(k);
    if (!parsed) continue;

    const { x, y } = parsed;
    if (x < 0 || y < 0 || x >= grid.cols || y >= grid.rows) continue;

    next.add(`${x},${y}`);
  }

  return next;
}

/**
 * Validate and normalize invalid-cell labels loaded from storage.
 *
 * Rules:
 * 1) key must be valid "x,y"
 * 2) key must be in bounds
 * 3) key must exist inside invalidCells
 * 4) label must be a non-empty trimmed string
 */
function sanitizeInvalidCellLabels(args: {
  labels: unknown;
  grid: EditorState["grid"];
  invalidCells: Set<string>;
}): Record<string, string> {
  const { labels, grid, invalidCells } = args;

  if (!labels || typeof labels !== "object") return {};
  const obj = labels as Record<string, unknown>;

  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "string") continue;

    const parsed = parseCellKey(k);
    if (!parsed) continue;

    const { x, y } = parsed;
    if (x < 0 || y < 0 || x >= grid.cols || y >= grid.rows) continue;

    const key = `${x},${y}`;
    if (!invalidCells.has(key)) continue;

    const trimmed = v.trim();
    if (trimmed.length === 0) continue;

    next[key] = trimmed;
  }

  return next;
}

/**
 * Convert the in-memory EditorState into a storage-friendly snapshot.
 *
 * Important:
 * - We read optional fields defensively because not every state instance
 *   is guaranteed to include them (older versions, partial migrations, etc.).
 */
function toPersistedEditorState(state: EditorState): PersistedEditorStateV1 {
  const selectedInvalidCellKey =
    typeof (state as unknown as { selectedInvalidCellKey?: unknown })
      .selectedInvalidCellKey === "string"
      ? ((state as unknown as { selectedInvalidCellKey: string })
          .selectedInvalidCellKey as string)
      : null;

  const invalidCellLabelsRaw = (
    state as unknown as { invalidCellLabels?: unknown }
  ).invalidCellLabels;

  const invalidCellLabels =
    invalidCellLabelsRaw && typeof invalidCellLabelsRaw === "object"
      ? (invalidCellLabelsRaw as Record<string, string>)
      : undefined;

  return {
    v: 1,
    grid: state.grid,
    components: state.components,
    camera: state.camera,
    tool: state.tool,
    activeComponentType: state.activeComponentType,
    selectedComponentId: state.selectedComponentId,
    placeMode: state.placeMode,
    invalidCells: Array.from(state.invalidCells),
    selectedInvalidCellKey,
    invalidCellLabels,
  };
}

/**
 * Convert a persisted snapshot back into a valid EditorState.
 *
 * Goals:
 * - Be tolerant of missing optional fields
 * - Sanitize invalid cell sets and labels
 * - Avoid persisting runtime-only viewport values
 */
function fromPersistedEditorState(raw: unknown): EditorState | null {
  if (!raw || typeof raw !== "object") return null;

  const data = raw as Partial<PersistedEditorStateV1>;
  if (data.v !== 1) return null;

  // Validate minimum required structure.
  if (
    !data.grid ||
    typeof data.grid.cols !== "number" ||
    typeof data.grid.rows !== "number"
  ) {
    return null;
  }

  if (!Array.isArray(data.components)) return null;
  if (!data.camera || typeof data.camera.zoom !== "number") return null;

  // Normalize grid values.
  const nextGrid = {
    cols: Math.max(1, Math.floor(data.grid.cols)),
    rows: Math.max(1, Math.floor(data.grid.rows)),
  };

  // Restore invalid cells + labels safely.
  const restoredInvalid = sanitizeInvalidCells(data.invalidCells, nextGrid);

  const restoredLabels = sanitizeInvalidCellLabels({
    labels: data.invalidCellLabels,
    grid: nextGrid,
    invalidCells: restoredInvalid,
  });

  // Only keep selected invalid key if it still exists in invalidCells.
  const restoredSelectedInvalid =
    typeof data.selectedInvalidCellKey === "string" &&
    restoredInvalid.has(data.selectedInvalidCellKey)
      ? data.selectedInvalidCellKey
      : null;

  return {
    ...initialEditorState,
    grid: nextGrid,
    invalidCells: restoredInvalid,
    components: data.components as EditorState["components"],
    camera: data.camera as EditorState["camera"],
    tool: (data.tool ?? initialEditorState.tool) as EditorState["tool"],
    activeComponentType: (data.activeComponentType ??
      initialEditorState.activeComponentType) as EditorState["activeComponentType"],
    selectedComponentId: (data.selectedComponentId ??
      null) as EditorState["selectedComponentId"],
    placeMode: (data.placeMode ??
      initialEditorState.placeMode) as EditorState["placeMode"],

    // viewport is runtime-only; CanvasStage will populate it.
    viewport: { width: 0, height: 0 },

    // Extra fields consumed by Toolbar/Canvas (kept even if not in the base type).
    selectedInvalidCellKey: restoredSelectedInvalid,
    invalidCellLabels: restoredLabels,
  } as unknown as EditorState;
}

/**
 * Creates a clean editor state with no saved layout selected.
 * This is what the app should show at "/" when no layout is open.
 */
function makeEmptyEditorState(): EditorState {
  return {
    ...(initialEditorState as unknown as EditorState),
    components: [],
    invalidCells: new Set<string>(),
    selectedComponentId: null,
    viewport: { width: 0, height: 0 },
    selectedInvalidCellKey: null,
    invalidCellLabels: {},
  } as unknown as EditorState;
}

// -----------------------
// Saved layouts storage
// -----------------------

/**
 * Read the selected layout id from localStorage.
 * This is the lightweight “which layout is open” pointer.
 */
function readSelectedLayoutId(): string | null {
  const v = localStorage.getItem(STORAGE_KEY_SELECTED_LAYOUT_ID);
  return v && v.length > 0 ? v : null;
}

/**
 * Write (or clear) the selected layout id to localStorage.
 * Clearing selection means the editor will render the empty state.
 */
function writeSelectedLayoutId(id: string | null) {
  if (!id) {
    localStorage.removeItem(STORAGE_KEY_SELECTED_LAYOUT_ID);
    return;
  }
  localStorage.setItem(STORAGE_KEY_SELECTED_LAYOUT_ID, id);
}

/**
 * Read saved layouts from localStorage and validate them.
 * Invalid entries are ignored to prevent the UI from crashing.
 */
function readSavedLayouts(): SavedLayoutEntryV1[] {
  const raw = localStorage.getItem(STORAGE_KEY_SAVED_LAYOUTS);
  if (!raw) return [];

  const parsed = safeParseJson(raw);
  if (!Array.isArray(parsed)) return [];

  const out: SavedLayoutEntryV1[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;

    const o = item as Partial<SavedLayoutEntryV1>;

    // Validate wrapper metadata.
    if (o.schemaVersion !== 1) continue;
    if (typeof o.id !== "string" || o.id.length === 0) continue;
    if (typeof o.name !== "string") continue;
    if (typeof o.createdAt !== "number") continue;
    if (typeof o.updatedAt !== "number") continue;

    // Validate + re-serialize editor data.
    const restored = fromPersistedEditorState(o.data);
    if (!restored) continue;

    out.push({
      schemaVersion: 1,
      id: o.id,
      name: o.name,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      data: toPersistedEditorState(restored),
    });
  }

  // Keep list ordered by "most recently updated" for nicer UX.
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/**
 * Persist the saved layouts list to localStorage.
 * This is called whenever `savedLayouts` changes.
 */
function writeSavedLayouts(entries: SavedLayoutEntryV1[]) {
  localStorage.setItem(STORAGE_KEY_SAVED_LAYOUTS, JSON.stringify(entries));
}

/**
 * Ensure a stored selected id is still present in the layouts array.
 * If not, we treat it as "no layout selected" (render empty editor).
 */
function normalizeSelectedId(
  candidate: string | null,
  layouts: SavedLayoutEntryV1[]
): string | null {
  if (!candidate) return null;
  const exists = layouts.some((l) => l.id === candidate);
  return exists ? candidate : null;
}

// -----------------------
// Provider implementation
// -----------------------

export function EditorProvider({ children }: { children: ReactNode }) {
  /**
   * Saved layouts list is loaded once on startup from localStorage.
   * The provider owns this data and exposes meta + actions to pages.
   */
  const [savedLayouts, setSavedLayouts] = useState<SavedLayoutEntryV1[]>(() => {
    return readSavedLayouts();
  });

  /**
   * Selected layout id is stored separately so refresh can reopen the last layout.
   * We normalize it against the currently loaded layout list to avoid stale references.
   */
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(
    () => {
      const rawSelected = readSelectedLayoutId();
      const layouts = readSavedLayouts(); // read once in initializer
      const normalized = normalizeSelectedId(rawSelected, layouts);

      // If localStorage had a stale id, clean it immediately (no effect needed).
      if (rawSelected && !normalized) writeSelectedLayoutId(null);

      return normalized;
    }
  );

  /**
   * The live editor state comes from:
   * - the selected saved layout (if one is selected)
   * - otherwise an empty editor state
   */
  const [state, setStateInternal] = useState<EditorState>(() => {
    const layouts = readSavedLayouts();
    const selected = normalizeSelectedId(readSelectedLayoutId(), layouts);

    if (!selected) return makeEmptyEditorState();

    const found = layouts.find((l) => l.id === selected);
    if (!found) return makeEmptyEditorState();

    const restored = fromPersistedEditorState(found.data);
    return restored ?? makeEmptyEditorState();
  });

  // -----------------------
  // Undo history (single stack)
  // -----------------------

  /**
   * We keep a single "past" stack for undo.
   * Redo was intentionally removed for now to keep behavior predictable.
   */
  const pastRef = useRef<EditorState[]>([]);
  const [historyLen, setHistoryLen] = useState(0);

  const resetHistory = useCallback(() => {
    pastRef.current = [];
    setHistoryLen(0);
  }, []);

  /**
   * Push a snapshot into history while enforcing a max length.
   * We push PREVIOUS state (not next) so undo returns to that snapshot.
   */
  const pushHistory = useCallback((snapshot: EditorState) => {
    const next = pastRef.current.concat(snapshot);
    pastRef.current =
      next.length > HISTORY_LIMIT
        ? next.slice(next.length - HISTORY_LIMIT)
        : next;

    setHistoryLen(pastRef.current.length);
  }, []);

  /**
   * History-aware setState exposed to consumers.
   * Anything using setState directly will become undoable (unless it returns prev).
   */
  const setState: EditorStateApi["setState"] = useCallback(
    (action) => {
      setStateInternal((prev) => {
        const next =
          typeof action === "function"
            ? (action as (p: EditorState) => EditorState)(prev)
            : action;

        if (next !== prev) pushHistory(prev);
        return next;
      });
    },
    [pushHistory]
  );

  /**
   * Internal helper used by the typed setters below.
   * `recordHistory` determines whether the update should be undoable.
   */
  const applyUpdate = useCallback(
    (updater: (prev: EditorState) => EditorState, recordHistory: boolean) => {
      setStateInternal((prev) => {
        const next = updater(prev);
        if (recordHistory && next !== prev) pushHistory(prev);
        return next;
      });
    },
    [pushHistory]
  );

  // -----------------------
  // Editor actions
  // -----------------------

  /**
   * Camera updates are NOT undoable.
   * Reason: zoom/pan changes are continuous and would pollute undo history.
   */
  const setCamera = useCallback<EditorStateApi["setCamera"]>(
    (updater) => {
      applyUpdate(
        (prev) => ({
          ...prev,
          camera: updater(prev.camera),
        }),
        false
      );
    },
    [applyUpdate]
  );

  /**
   * Component list updates ARE undoable.
   * This includes placing, erasing, dragging, and any future renaming/editing.
   */
  const setComponents = useCallback<EditorStateApi["setComponents"]>(
    (updater) => {
      applyUpdate((prev) => {
        const nextComponents = updater(prev.components);

        // If a selected component was removed, clear selection automatically.
        const nextSelected =
          prev.selectedComponentId &&
          !nextComponents.some((c) => c.id === prev.selectedComponentId)
            ? null
            : prev.selectedComponentId;

        return {
          ...prev,
          components: nextComponents,
          selectedComponentId: nextSelected,
        };
      }, true);
    },
    [applyUpdate]
  );

  /**
   * Viewport size updates are NOT undoable.
   * Viewport is runtime-only and is driven by CanvasStage + ResizeObserver.
   */
  const setViewportSize = useCallback<EditorStateApi["setViewportSize"]>(
    (width, height) => {
      applyUpdate((prev) => {
        if (prev.viewport.width === width && prev.viewport.height === height) {
          return prev;
        }
        return {
          ...prev,
          viewport: { width, height },
        };
      }, false);
    },
    [applyUpdate]
  );

  /**
   * Grid resizing IS undoable because it materially changes the layout.
   * We also sanitize:
   * - invalid cells (drop anything that goes out of bounds)
   * - components (drop anything out of bounds or now invalid)
   * - labels and selected invalid key
   */
  const setGrid = useCallback<EditorStateApi["setGrid"]>(
    (cols, rows) => {
      const nextCols = Math.max(1, Math.floor(cols));
      const nextRows = Math.max(1, Math.floor(rows));

      applyUpdate((prev) => {
        const nextGrid = { cols: nextCols, rows: nextRows };

        // Keep only invalid cells that remain in bounds.
        const nextInvalid = new Set<string>();
        for (const key of prev.invalidCells) {
          const parsed = parseCellKey(key);
          if (!parsed) continue;

          const { x, y } = parsed;
          if (x >= 0 && y >= 0 && x < nextCols && y < nextRows) {
            nextInvalid.add(`${x},${y}`);
          }
        }

        // Remove components that become out of bounds OR now invalid.
        const nextComponents = prev.components.filter((c) => {
          const inBounds =
            c.cell.x >= 0 &&
            c.cell.y >= 0 &&
            c.cell.x < nextCols &&
            c.cell.y < nextRows;
          if (!inBounds) return false;

          const k = cellKey(c.cell);
          return !nextInvalid.has(k);
        });

        const prevLabels = (prev as unknown as { invalidCellLabels?: unknown })
          .invalidCellLabels;

        const nextLabels = sanitizeInvalidCellLabels({
          labels: prevLabels,
          grid: nextGrid,
          invalidCells: nextInvalid,
        });

        const prevSelectedInvalid = (
          prev as unknown as { selectedInvalidCellKey?: unknown }
        ).selectedInvalidCellKey;

        const nextSelectedInvalid =
          typeof prevSelectedInvalid === "string" &&
          nextInvalid.has(prevSelectedInvalid)
            ? prevSelectedInvalid
            : null;

        return {
          ...prev,
          grid: nextGrid,
          invalidCells: nextInvalid,
          components: nextComponents,
          selectedComponentId: null,
          invalidCellLabels: nextLabels,
          selectedInvalidCellKey: nextSelectedInvalid,
        } as unknown as EditorState;
      }, true);
    },
    [applyUpdate]
  );

  /**
   * Tool and mode changes are NOT undoable.
   * Reason: they do not change the layout output, only user interaction mode.
   */
  const setTool = useCallback<EditorStateApi["setTool"]>(
    (tool) => {
      applyUpdate(
        (prev) => ({
          ...prev,
          tool,
        }),
        false
      );
    },
    [applyUpdate]
  );

  const setActiveComponentType = useCallback<
    EditorStateApi["setActiveComponentType"]
  >(
    (type) => {
      applyUpdate(
        (prev) => ({
          ...prev,
          activeComponentType: type,
        }),
        false
      );
    },
    [applyUpdate]
  );

  const setSelectedComponentId = useCallback<
    EditorStateApi["setSelectedComponentId"]
  >(
    (id) => {
      applyUpdate(
        (prev) =>
          ({
            ...prev,
            selectedComponentId: id,
          } as EditorState),
        false
      );
    },
    [applyUpdate]
  );

  /**
   * Invalid cell set updates ARE undoable.
   * We also enforce consistency:
   * - any component that now sits on an invalid cell is removed
   * - labels + selection are sanitized
   */
  const setInvalidCells = useCallback<EditorStateApi["setInvalidCells"]>(
    (updater) => {
      applyUpdate((prev) => {
        const nextInvalid = updater(prev.invalidCells);

        // Drop any components that now collide with invalid cells.
        const nextComponents = prev.components.filter((c) => {
          const k = cellKey(c.cell);
          return !nextInvalid.has(k);
        });

        const prevLabels = (prev as unknown as { invalidCellLabels?: unknown })
          .invalidCellLabels;

        const nextLabels = sanitizeInvalidCellLabels({
          labels: prevLabels,
          grid: prev.grid,
          invalidCells: nextInvalid,
        });

        const prevSelectedInvalid = (
          prev as unknown as { selectedInvalidCellKey?: unknown }
        ).selectedInvalidCellKey;

        const nextSelectedInvalid =
          typeof prevSelectedInvalid === "string" &&
          nextInvalid.has(prevSelectedInvalid)
            ? prevSelectedInvalid
            : null;

        return {
          ...prev,
          invalidCells: nextInvalid,
          components: nextComponents,
          selectedComponentId: null,
          invalidCellLabels: nextLabels,
          selectedInvalidCellKey: nextSelectedInvalid,
        } as unknown as EditorState;
      }, true);
    },
    [applyUpdate]
  );

  /**
   * Toggle a single invalid cell on/off (undoable).
   *
   * Behavior:
   * - Turning a cell invalid removes any component in that cell.
   * - Turning a cell valid removes its label (if present).
   * - Selection is kept consistent (cleared if the selected invalid is removed).
   */
  const toggleInvalidCell = useCallback<EditorStateApi["toggleInvalidCell"]>(
    (cell) => {
      applyUpdate((prev) => {
        const k = cellKey(cell);

        const nextInvalid = new Set(prev.invalidCells);
        const willBeInvalid = !nextInvalid.has(k);

        if (willBeInvalid) nextInvalid.add(k);
        else nextInvalid.delete(k);

        // If cell becomes invalid, remove any component in that cell.
        const nextComponents = willBeInvalid
          ? prev.components.filter((c) => cellKey(c.cell) !== k)
          : prev.components;

        // If cell becomes valid, its label is no longer relevant.
        const prevLabels =
          (prev as unknown as { invalidCellLabels?: Record<string, string> })
            .invalidCellLabels ?? {};
        const nextLabels: Record<string, string> = { ...prevLabels };
        if (!willBeInvalid) delete nextLabels[k];

        const prevSelectedInvalid = (
          prev as unknown as { selectedInvalidCellKey?: unknown }
        ).selectedInvalidCellKey;

        // If we removed the selected invalid cell, clear selection.
        const nextSelectedInvalid = willBeInvalid
          ? (prevSelectedInvalid as string | null)
          : typeof prevSelectedInvalid === "string" && prevSelectedInvalid === k
          ? null
          : (prevSelectedInvalid as string | null);

        return {
          ...prev,
          invalidCells: nextInvalid,
          components: nextComponents,
          selectedComponentId: null,
          invalidCellLabels: nextLabels,
          selectedInvalidCellKey: nextSelectedInvalid ?? null,
        } as unknown as EditorState;
      }, true);
    },
    [applyUpdate]
  );

  /**
   * Undo:
   * - Pops the last snapshot from history and applies it.
   * - Preserves the current viewport because viewport is runtime-only.
   */
  const undo = useCallback(() => {
    const past = pastRef.current;
    if (past.length === 0) return;

    const prevState = past[past.length - 1];
    pastRef.current = past.slice(0, past.length - 1);
    setHistoryLen(pastRef.current.length);

    setStateInternal((curr) => ({
      ...prevState,
      viewport: curr.viewport,
    }));
  }, []);

  const canUndo = historyLen > 0;

  // -----------------------
  // Persistence: localStorage sync
  // -----------------------

  /**
   * Persist the saved layouts list whenever it changes.
   * This is intentionally decoupled from `state` changes because:
   * - state changes happen frequently (dragging, typing)
   * - layouts only change on explicit actions (save/rename/delete)
   */
  useEffect(() => {
    writeSavedLayouts(savedLayouts);
  }, [savedLayouts]);

  /**
   * Persist the selected layout pointer whenever it changes.
   * This drives refresh behavior: if an id exists, the app loads that layout.
   */
  useEffect(() => {
    writeSelectedLayoutId(selectedLayoutId);
  }, [selectedLayoutId]);

  // -----------------------
  // Saved layout actions
  // -----------------------

  /**
   * Save the current editor state into the saved layout list.
   *
   * Modes:
   * - Create new (no id provided): generates id and default name.
   * - Overwrite (id provided): updates that entry if it exists, or creates it if missing.
   *
   * After saving:
   * - we setSelectedLayoutId(id) so refresh reliably opens the saved layout.
   */
  const saveLayout = useCallback<EditorStateApi["saveLayout"]>(
    (args?: SaveLayoutArgs) => {
      const now = Date.now();
      const requestedId = args?.id ?? null;

      const id =
        requestedId && requestedId.trim().length > 0
          ? requestedId
          : generateId();

      const providedName = (args?.name ?? "").trim();

      setSavedLayouts((prev) => {
        const existing = prev.find((l) => l.id === id);

        // Default name selection:
        // - If overwriting: keep existing name unless a new name is provided.
        // - If creating: "Layout N" (based on current count).
        const defaultCreateName = `Layout ${prev.length + 1}`;
        const finalName =
          providedName.length > 0
            ? providedName
            : existing
            ? existing.name
            : defaultCreateName;

        const nextEntry: SavedLayoutEntryV1 = {
          schemaVersion: 1,
          id,
          name: finalName,
          createdAt: existing ? existing.createdAt : now,
          updatedAt: now,
          data: toPersistedEditorState(state),
        };

        const without = prev.filter((l) => l.id !== id);

        // Store most recently updated first for the Saved Layouts page.
        return [nextEntry, ...without];
      });

      setSelectedLayoutId(id);

      return id;
    },
    [state]
  );

  /**
   * Open a saved layout by id.
   *
   * Behavior:
   * - If layout is missing/corrupt: clears selection and loads empty state.
   * - Resets undo history because “switching documents” should start fresh.
   * - Preserves current viewport runtime values.
   */
  const openLayout = useCallback<EditorStateApi["openLayout"]>(
    (id) => {
      const found = savedLayouts.find((l) => l.id === id);
      if (!found) {
        setSelectedLayoutId(null);
        resetHistory();
        setStateInternal((curr) => ({
          ...makeEmptyEditorState(),
          viewport: curr.viewport,
        }));
        return;
      }

      const restored = fromPersistedEditorState(found.data);
      if (!restored) {
        setSelectedLayoutId(null);
        resetHistory();
        setStateInternal((curr) => ({
          ...makeEmptyEditorState(),
          viewport: curr.viewport,
        }));
        return;
      }

      setSelectedLayoutId(id);
      resetHistory();

      setStateInternal((curr) => ({
        ...restored,
        viewport: curr.viewport,
      }));
    },
    [savedLayouts, resetHistory]
  );

  /**
   * Rename a saved layout (metadata-only).
   * This does not affect the editor state directly.
   */
  const renameLayout = useCallback<EditorStateApi["renameLayout"]>(
    (id, name) => {
      const nextName = name.trim();
      if (nextName.length === 0) return;

      setSavedLayouts((prev) =>
        prev.map((l) =>
          l.id === id ? { ...l, name: nextName, updatedAt: Date.now() } : l
        )
      );
    },
    []
  );

  /**
   * Delete a saved layout.
   *
   * Important:
   * - If the deleted layout is currently selected, we immediately clear selection
   *   and reset the editor to the empty state (no effects required).
   */
  const deleteLayout = useCallback<EditorStateApi["deleteLayout"]>(
    (id) => {
      setSavedLayouts((prev) => prev.filter((l) => l.id !== id));

      setSelectedLayoutId((currSelected) => {
        if (currSelected !== id) return currSelected;

        resetHistory();
        setStateInternal((curr) => ({
          ...makeEmptyEditorState(),
          viewport: curr.viewport,
        }));

        return null;
      });
    },
    [resetHistory]
  );

  /**
   * Clear the selected layout id and reset the editor to a clean empty state.
   * This is used by the Saved Layouts page “New empty” action.
   */
  const clearSelectedLayout = useCallback<
    EditorStateApi["clearSelectedLayout"]
  >(() => {
    setSelectedLayoutId(null);
    resetHistory();
    setStateInternal((curr) => ({
      ...makeEmptyEditorState(),
      viewport: curr.viewport,
    }));
  }, [resetHistory]);

  /**
   * Expose saved layout metadata only (not the full stored state),
   * so consumers don’t re-render on every editor change.
   *
   * This was previously a performance issue: returning the full entries
   * (which embed `data`) created new objects too frequently.
   */
  const savedLayoutsMeta = useMemo<SavedLayoutMeta[]>(() => {
    return savedLayouts.map((l) => ({
      id: l.id,
      name: l.name,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    }));
  }, [savedLayouts]);

  /**
   * Build the API object provided through context.
   * We memoize it so consumers only re-render when relevant pieces change.
   */
  const api = useMemo<EditorStateApi>(() => {
    return {
      state,
      setState,
      setCamera,
      setComponents,
      setViewportSize,
      setGrid,
      setTool,
      setActiveComponentType,
      setSelectedComponentId,

      setInvalidCells,
      toggleInvalidCell,

      undo,
      canUndo,

      selectedLayoutId,
      savedLayouts: savedLayoutsMeta,

      saveLayout,
      openLayout,
      renameLayout,
      deleteLayout,
      clearSelectedLayout,
    };
  }, [
    state,
    setState,
    setCamera,
    setComponents,
    setViewportSize,
    setGrid,
    setTool,
    setActiveComponentType,
    setSelectedComponentId,
    setInvalidCells,
    toggleInvalidCell,
    undo,
    canUndo,
    selectedLayoutId,
    savedLayoutsMeta,
    saveLayout,
    openLayout,
    renameLayout,
    deleteLayout,
    clearSelectedLayout,
  ]);

  return (
    <EditorStateContext.Provider value={api}>
      {children}
    </EditorStateContext.Provider>
  );
}
