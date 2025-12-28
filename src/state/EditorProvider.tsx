// src/state/EditorProvider.tsx
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { EditorState, PlacedComponent, cellKey } from "../types/editor";
import { initialEditorState } from "./initialState";
import {
  EditorStateContext,
  type EditorStateApi,
  type SavedLayoutMeta,
  type SaveLayoutArgs,
} from "./EditorContext";

const HISTORY_LIMIT = 50;

/**
 * localStorage keys used by the "Saved Layouts" workflow.
 * - layouts: stores an array of saved layout entries (metadata + editor snapshot)
 * - selected id: stores which layout should be auto-opened on refresh
 */
const STORAGE_KEY_SAVED_LAYOUTS = "consigli_saved_layouts_v1";
const STORAGE_KEY_SELECTED_LAYOUT_ID = "consigli_selected_layout_id_v1";

/**
 * Versioned persistence wrapper for the editor snapshot.
 *
 * Why version:
 * - The in-memory EditorState can evolve over time.
 * - A version field makes migrations possible without breaking existing users.
 *
 * Notes:
 * - Set cannot be JSON-serialized, so invalidCells is stored as an array.
 * - viewport is excluded because it is runtime-only (measured by CanvasStage).
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
  invalidCells: string[];

  /**
   * Optional fields allow older persisted states to load safely.
   * These may not exist in early app versions or partial migrations.
   */
  selectedInvalidCellKey?: string | null;
  invalidCellLabels?: Record<string, string>;
};

/**
 * Stored layout entry combines user-facing metadata and the persisted editor snapshot.
 * The entry has its own schemaVersion, independent from the editor snapshot version.
 */
type SavedLayoutEntryV1 = SavedLayoutMeta & {
  schemaVersion: 1;
  data: PersistedEditorStateV1;
};

/**
 * Parse JSON safely without throwing, returning null on invalid input.
 * localStorage can be corrupted or edited manually, so parsing must be defensive.
 */
function safeParseJson(txt: string): unknown {
  try {
    return JSON.parse(txt) as unknown;
  } catch {
    return null;
  }
}

/**
 * Generates a unique id for a saved layout.
 * Uses crypto.randomUUID when available; falls back to a timestamp-based id.
 */
function generateId(): string {
  const c = globalThis.crypto as unknown as
    | { randomUUID?: () => string }
    | undefined;

  if (c?.randomUUID) return c.randomUUID();

  return `layout_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Parses a "x,y" cell key string into integer coordinates.
 * Returns null if the input is not in a usable form.
 */
function parseCellKey(key: string): { x: number; y: number } | null {
  const [xs, ys] = key.split(",");
  const x = Number(xs);
  const y = Number(ys);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.floor(x), y: Math.floor(y) };
}

/**
 * Normalizes invalid cell keys loaded from persistence.
 *
 * Guarantees:
 * - Only "x,y" strings that parse to integers are kept.
 * - Keys must be within the current grid bounds.
 *
 * This protects the editor from:
 * - corrupted storage
 * - manual edits
 * - grid size changes across saves
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
 * Normalizes invalid-cell labels loaded from persistence.
 *
 * Rules:
 * - key must be a valid in-bounds "x,y"
 * - key must exist in invalidCells (labels only apply to invalid cells)
 * - value must be a non-empty trimmed string
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
 * Reads existing autoNames and returns a map of { prefix -> maxIndex }.
 * This is used to continue numbering without reusing names.
 */
function seedAutoNameCounters(
  components: PlacedComponent[]
): Record<string, number> {
  const counters: Record<string, number> = {};

  for (const c of components) {
    const raw = (c as unknown as { autoName?: unknown }).autoName;
    if (typeof raw !== "string") continue;

    const name = raw.trim();
    if (name.length === 0) continue;

    const match = /^([A-Z]+)(\d+)$/.exec(name);
    if (!match) continue;

    const prefix = match[1];
    const num = Number(match[2]);
    if (!Number.isFinite(num)) continue;

    counters[prefix] = Math.max(counters[prefix] ?? 0, num);
  }

  return counters;
}

/**
 * Ensures every component in the list has an autoName.
 *
 * When used:
 * - loading older snapshots (autoName may be missing)
 * - callers creating components without autoName
 *
 * Naming is stable:
 * - existing autoNames are kept as-is
 * - new names continue from the highest number per prefix
 */
function ensureAutoNames(components: PlacedComponent[]): PlacedComponent[] {
  const prefix: Record<PlacedComponent["type"], string> = {
    LIGHT: "L",
    AIR_SUPPLY: "AS",
    AIR_RETURN: "AR",
    SMOKE_DETECTOR: "SD",
  };

  const counters = seedAutoNameCounters(components);

  return components.map((c) => {
    const raw = (c as unknown as { autoName?: unknown }).autoName;
    const hasAutoName = typeof raw === "string" && raw.trim().length > 0;
    if (hasAutoName) return c;

    const p = prefix[c.type] ?? "C";
    const next = (counters[p] ?? 0) + 1;
    counters[p] = next;

    return { ...c, autoName: `${p}${next}` };
  });
}

/**
 * Converts the in-memory EditorState into a JSON-serializable snapshot.
 * Optional fields are read defensively because older states may not contain them.
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
 * Converts a persisted snapshot into a safe, usable EditorState.
 *
 * Goals:
 * - validate minimum required data
 * - sanitize invalid cells and their labels
 * - restore missing optional fields safely
 * - keep runtime-only viewport excluded (CanvasStage will populate it)
 */
function fromPersistedEditorState(raw: unknown): EditorState | null {
  if (!raw || typeof raw !== "object") return null;

  const data = raw as Partial<PersistedEditorStateV1>;
  if (data.v !== 1) return null;

  if (
    !data.grid ||
    typeof data.grid.cols !== "number" ||
    typeof data.grid.rows !== "number"
  ) {
    return null;
  }

  if (!Array.isArray(data.components)) return null;
  if (!data.camera || typeof data.camera.zoom !== "number") return null;

  const nextGrid = {
    cols: Math.max(1, Math.floor(data.grid.cols)),
    rows: Math.max(1, Math.floor(data.grid.rows)),
  };

  const restoredInvalid = sanitizeInvalidCells(data.invalidCells, nextGrid);

  const restoredLabels = sanitizeInvalidCellLabels({
    labels: data.invalidCellLabels,
    grid: nextGrid,
    invalidCells: restoredInvalid,
  });

  const restoredSelectedInvalid =
    typeof data.selectedInvalidCellKey === "string" &&
    restoredInvalid.has(data.selectedInvalidCellKey)
      ? data.selectedInvalidCellKey
      : null;

  const restoredComponents = ensureAutoNames(
    data.components as EditorState["components"]
  );

  return {
    ...initialEditorState,
    grid: nextGrid,
    invalidCells: restoredInvalid,
    components: restoredComponents,
    camera: data.camera as EditorState["camera"],
    tool: (data.tool ?? initialEditorState.tool) as EditorState["tool"],
    activeComponentType: (data.activeComponentType ??
      initialEditorState.activeComponentType) as EditorState["activeComponentType"],
    selectedComponentId: (data.selectedComponentId ??
      null) as EditorState["selectedComponentId"],
    placeMode: (data.placeMode ??
      initialEditorState.placeMode) as EditorState["placeMode"],
    viewport: { width: 0, height: 0 },
    selectedInvalidCellKey: restoredSelectedInvalid,
    invalidCellLabels: restoredLabels,
  } as unknown as EditorState;
}

/**
 * Creates the "blank document" editor state used when no layout is selected.
 * This ensures refresh behaves predictably: either a layout is open, or it's empty.
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

/**
 * Reads the selected layout id from localStorage.
 * This acts as the "open document pointer" for refresh behavior.
 */
function readSelectedLayoutId(): string | null {
  const v = localStorage.getItem(STORAGE_KEY_SELECTED_LAYOUT_ID);
  return v && v.length > 0 ? v : null;
}

/**
 * Writes the selected layout id to localStorage.
 * Passing null clears selection, meaning the app should show an empty state.
 */
function writeSelectedLayoutId(id: string | null) {
  if (!id) {
    localStorage.removeItem(STORAGE_KEY_SELECTED_LAYOUT_ID);
    return;
  }
  localStorage.setItem(STORAGE_KEY_SELECTED_LAYOUT_ID, id);
}

/**
 * Reads saved layouts from localStorage and validates each entry.
 * Corrupt or unsupported entries are ignored to keep the app resilient.
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

    if (o.schemaVersion !== 1) continue;
    if (typeof o.id !== "string" || o.id.length === 0) continue;
    if (typeof o.name !== "string") continue;
    if (typeof o.createdAt !== "number") continue;
    if (typeof o.updatedAt !== "number") continue;

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

  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/**
 * Writes the saved layouts array to localStorage.
 * This is called only when the saved layouts list changes (save/rename/delete).
 */
function writeSavedLayouts(entries: SavedLayoutEntryV1[]) {
  localStorage.setItem(STORAGE_KEY_SAVED_LAYOUTS, JSON.stringify(entries));
}

/**
 * Ensures a selected layout id still exists in the saved layouts array.
 * If it does not exist, selection is treated as empty.
 */
function normalizeSelectedId(
  candidate: string | null,
  layouts: SavedLayoutEntryV1[]
): string | null {
  if (!candidate) return null;
  const exists = layouts.some((l) => l.id === candidate);
  return exists ? candidate : null;
}

export function EditorProvider({ children }: { children: ReactNode }) {
  /**
   * Saved layouts are the durable "documents" stored in localStorage.
   * The provider owns the list and exposes metadata + actions via context.
   */
  const [savedLayouts, setSavedLayouts] = useState<SavedLayoutEntryV1[]>(() => {
    return readSavedLayouts();
  });

  /**
   * Selected layout id controls which saved layout is opened on load/refresh.
   * This is separate from editor state so "saved documents" and "current view"
   * are easy to reason about.
   */
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(
    () => {
      const rawSelected = readSelectedLayoutId();
      const layouts = readSavedLayouts();
      const normalized = normalizeSelectedId(rawSelected, layouts);

      if (rawSelected && !normalized) writeSelectedLayoutId(null);

      return normalized;
    }
  );

  /**
   * Editor state is derived from the selected layout:
   * - if selected: load and restore that snapshot
   * - if not selected: show a clean, empty state
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

  /**
   * Undo is implemented as a single "past snapshots" stack.
   * We store whole EditorState snapshots for simplicity and predictability.
   */
  const pastRef = useRef<EditorState[]>([]);
  const [historyLen, setHistoryLen] = useState(0);

  /**
   * Clears undo history.
   * Used when switching documents (open/delete/clear selection).
   */
  const resetHistory = useCallback(() => {
    pastRef.current = [];
    setHistoryLen(0);
  }, []);

  /**
   * Pushes a snapshot into undo history while enforcing a maximum size.
   * We push the previous state so Undo returns to that exact snapshot.
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
   * Public setState wrapper that automatically records undo history.
   * Any consumer using setState becomes undoable unless the update is a no-op.
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
   * recordHistory is used to keep undo focused on layout-affecting changes only.
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

  /**
   * Camera updates are not recorded in undo history.
   * Pan/zoom are continuous interactions and would crowd out meaningful edits.
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
   * Component list updates are undoable.
   * This includes placement, erasing, dragging, and renaming (if implemented).
   *
   * The component list is normalized to ensure each item has a stable autoName.
   */
  const setComponents = useCallback<EditorStateApi["setComponents"]>(
    (updater) => {
      applyUpdate((prev) => {
        const rawNext = updater(prev.components);

        const nextComponents = ensureAutoNames(
          rawNext as unknown as PlacedComponent[]
        ) as EditorState["components"];

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
   * Viewport changes are runtime-only (CanvasStage measures the canvas area).
   * These updates are intentionally excluded from undo history.
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
   * Grid resizing is undoable because it changes the "document" itself.
   * The update also enforces consistency by removing out-of-bounds data:
   * - invalid cells outside bounds
   * - components outside bounds or that collide with invalid cells
   * - invalid cell labels and selection are re-sanitized
   */
  const setGrid = useCallback<EditorStateApi["setGrid"]>(
    (cols, rows) => {
      const nextCols = Math.max(1, Math.floor(cols));
      const nextRows = Math.max(1, Math.floor(rows));

      applyUpdate((prev) => {
        const nextGrid = { cols: nextCols, rows: nextRows };

        const nextInvalid = new Set<string>();
        for (const key of prev.invalidCells) {
          const parsed = parseCellKey(key);
          if (!parsed) continue;

          const { x, y } = parsed;
          if (x >= 0 && y >= 0 && x < nextCols && y < nextRows) {
            nextInvalid.add(`${x},${y}`);
          }
        }

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
   * Tool and mode toggles are interaction-only; they do not change the layout output.
   * These updates are not recorded in undo history.
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
   * Invalid cell updates are undoable because they directly change the usable layout.
   * When invalid cells change, we enforce consistency by:
   * - removing any components that now collide with invalid cells
   * - sanitizing labels and selected invalid key
   */
  const setInvalidCells = useCallback<EditorStateApi["setInvalidCells"]>(
    (updater) => {
      applyUpdate((prev) => {
        const nextInvalid = updater(prev.invalidCells);

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
   * Toggles a single cell as invalid/valid (undoable).
   *
   * Rules:
   * - if a cell becomes invalid, any component in that cell is removed
   * - if a cell becomes valid, its label is removed
   * - selected invalid key is cleared if the selected cell is removed
   */
  const toggleInvalidCell = useCallback<EditorStateApi["toggleInvalidCell"]>(
    (cell) => {
      applyUpdate((prev) => {
        const k = cellKey(cell);

        const nextInvalid = new Set(prev.invalidCells);
        const willBeInvalid = !nextInvalid.has(k);

        if (willBeInvalid) nextInvalid.add(k);
        else nextInvalid.delete(k);

        const nextComponents = willBeInvalid
          ? prev.components.filter((c) => cellKey(c.cell) !== k)
          : prev.components;

        const prevLabels =
          (prev as unknown as { invalidCellLabels?: Record<string, string> })
            .invalidCellLabels ?? {};
        const nextLabels: Record<string, string> = { ...prevLabels };
        if (!willBeInvalid) delete nextLabels[k];

        const prevSelectedInvalid = (
          prev as unknown as { selectedInvalidCellKey?: unknown }
        ).selectedInvalidCellKey;

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
   * Undo applies the latest snapshot from the history stack.
   * viewport is preserved because it is runtime-only and should not be undone.
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

  /**
   * Persist the saved layouts list when it changes.
   * Editor changes do not write here; only explicit save/rename/delete affects the list.
   */
  useEffect(() => {
    writeSavedLayouts(savedLayouts);
  }, [savedLayouts]);

  /**
   * Persist the selected layout pointer.
   * This drives which layout will be restored after a browser refresh.
   */
  useEffect(() => {
    writeSelectedLayoutId(selectedLayoutId);
  }, [selectedLayoutId]);

  /**
   * Saves the current editor state into the saved layouts list.
   *
   * Behavior:
   * - if args.id is provided: overwrite that entry (or create it if missing)
   * - otherwise: create a new entry with a generated id
   *
   * After saving:
   * - the saved layout becomes selected so refresh reopens it
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
        return [nextEntry, ...without];
      });

      setSelectedLayoutId(id);

      return id;
    },
    [state]
  );

  /**
   * Loads a saved layout into the editor.
   *
   * Failure behavior:
   * - missing/corrupt layouts clear selection and load empty state
   *
   * Undo history is reset because opening a different layout is a document switch.
   * viewport is preserved because it reflects current canvas size, not document data.
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
   * Renames a saved layout (metadata only).
   * The editor content is not modified by this action.
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
   * Deletes a saved layout entry.
   * If the deleted entry is currently selected, the editor resets to empty immediately.
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
   * Clears the selected layout id and resets the editor.
   * Intended for a "New empty layout" action on the Saved Layouts page.
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
   * Exposes layout metadata only (not the full stored state payload).
   * This avoids rerenders in consumers when the embedded snapshot data changes.
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
   * Memoized API exposed through context.
   * Consumers will re-render only when the referenced values change.
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
