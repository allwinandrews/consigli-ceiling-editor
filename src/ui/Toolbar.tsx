// src/ui/Toolbar.tsx
import {
  useMemo,
  useState,
  type CSSProperties,
  useRef,
  useEffect,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

import { useEditorState } from "../state/useEditorState";
import type { ComponentType, EditorTool } from "../types/editor";

/**
 * The set of tools the editor supports.
 *
 * These values must match what CanvasStage expects, because CanvasStage
 * decides how pointer/drag interactions behave based on the active tool.
 */
const TOOLS: EditorTool[] = ["PAN", "SELECT", "PLACE", "ERASE"];

/**
 * A single shared color system for the entire app.
 *
 * Keeping these colors consistent across:
 * - Toolbar cards and badges
 * - Status group headers
 * - Canvas hover/selection accents
 *
 * makes it much easier for a reviewer to understand what they’re looking at.
 */
const TYPE_COLOR: Record<ComponentType | "INVALID_CELL", string> = {
  LIGHT: "#f59e0b", // amber
  AIR_SUPPLY: "#3b82f6", // blue
  AIR_RETURN: "#10b981", // green
  SMOKE_DETECTOR: "#8b5cf6", // violet
  INVALID_CELL: "#ef4444", // red
};

/**
 * Component palette shown as clickable cards.
 *
 * Each entry includes:
 * - label: human readable name
 * - value: enum value stored in state
 * - short: prefix used for auto-generated names (L1, AS1, ...)
 * - icon: small inline SVG rendered on the card
 */
const COMPONENTS: {
  label: string;
  value: ComponentType;
  short: string;
  icon: (size: number) => ReactElement;
}[] = [
  {
    label: "Light",
    value: "LIGHT",
    short: "L",
    icon: (s) => (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="2" />
        <path
          d="M12 2v3M12 19v3M2 12h3M19 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M19.4 4.6l-2.1 2.1M6.7 17.3l-2.1 2.1"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    label: "Air Supply",
    value: "AIR_SUPPLY",
    short: "AS",
    icon: (s) => (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
        <path
          d="M12 4l8 16H4L12 4z"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
        />
      </svg>
    ),
  },
  {
    label: "Air Return",
    value: "AIR_RETURN",
    short: "AR",
    icon: (s) => (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
        <rect
          x="5"
          y="5"
          width="14"
          height="14"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
        />
      </svg>
    ),
  },
  {
    label: "Smoke Detector",
    value: "SMOKE_DETECTOR",
    short: "SD",
    icon: (s) => (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
  },
];

type PlaceMode = "COMPONENT" | "INVALID_CELL";
type FilterValue = "ALL" | ComponentType | "INVALID_CELL";
type StatusGroupType = ComponentType | "INVALID_CELL";

/**
 * Normalized item structure used by the Status section.
 *
 * We merge two different “things” into one list:
 * - placed components (identified by component id)
 * - invalid cells (identified by "x,y" key)
 *
 * This lets the Status UI render and manage both in a consistent way.
 */
type ListItem = {
  id: string; // component id OR invalid cell key ("x,y")
  name: string; // display name (custom label preferred, otherwise autoName)
  autoName: string; // generated name (L1, AS1, IV1, ...)
  x: number;
  y: number;
  kind: "COMPONENT" | "INVALID_CELL";
};

/**
 * Clamp a numeric value to an integer range.
 *
 * Used for grid sizing:
 * - users can type anything in the input
 * - we normalize it to safe bounds before calling setGrid(...)
 */
function clampInt(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

/**
 * Returns a stable portal mount (document.body) for tooltips.
 *
 * Tooltips rendered inside the toolbar would often be clipped because
 * the toolbar is scrollable (overflow). Portalling to body avoids that.
 */
function useBodyPortal(): HTMLElement | null {
  const [body] = useState<HTMLElement | null>(() => {
    return typeof document !== "undefined" ? document.body : null;
  });
  return body;
}

/**
 * Minimal “info” icon used as the tooltip anchor.
 *
 * We keep this as a component so:
 * - styles are consistent everywhere
 * - it remains keyboard focusable via Tooltip wrapper
 */
function InfoIcon({ size = 18 }: { size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        border: "1px solid #e5e7eb",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 900,
        color: "#6b7280",
        background: "#ffffff",
        cursor: "help",
        lineHeight: 1,
        userSelect: "none",
      }}
      aria-hidden="true"
    >
      i
    </span>
  );
}

/**
 * Chevron used by accordion section headers.
 * Rotation indicates open/closed state.
 */
function ChevronIcon({ size = 16, open }: { size?: number; open: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 150ms ease",
      }}
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Trash icon for delete actions inside the Status list.
 */
function TrashIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M9 3h6m-7 4h8m-9 0l1 14h8l1-14M10 11v7m4-7v7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Tooltip
 *
 * Dependency-free tooltip implementation:
 * - renders into a portal (avoids overflow clipping)
 * - supports mouse hover and keyboard focus
 * - closes on Escape
 * - uses fixed positioning so it stays anchored during scrolling
 */
function Tooltip({
  text,
  children,
  width = 260,
}: {
  text: string;
  children: React.ReactNode;
  width?: number;
}) {
  const portal = useBodyPortal();
  const anchorRef = useRef<HTMLSpanElement | null>(null);

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: 0,
    top: 0,
  });

  // Computes tooltip position relative to the anchor and clamps it on-screen.
  const updatePos = () => {
    const el = anchorRef.current;
    if (!el) return;

    const r = el.getBoundingClientRect();
    let left = r.left;
    let top = r.bottom + 10;

    const pad = 10;
    const maxLeft = window.innerWidth - width - pad;

    left = Math.max(pad, Math.min(maxLeft, left));
    top = Math.max(pad, Math.min(window.innerHeight - pad, top));

    setPos({ left, top });
  };

  // While tooltip is open, keep it aligned during scroll/resize.
  useEffect(() => {
    if (!open) return;

    updatePos();

    const onScroll = () => updatePos();
    const onResize = () => updatePos();

    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, width]);

  const anchorStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    position: "relative",
  };

  const tipStyle: CSSProperties = {
    position: "fixed",
    left: pos.left,
    top: pos.top,
    width,
    padding: "10px 10px",
    borderRadius: 12,
    background: "rgba(17,24,39,0.96)",
    color: "#ffffff",
    fontSize: 12,
    lineHeight: 1.45,
    whiteSpace: "pre-line",
    boxShadow: "0 12px 24px rgba(0,0,0,0.22)",
    zIndex: 9999,
    pointerEvents: "none", // tooltip must never block clicks
  };

  return (
    <>
      <span
        ref={anchorRef}
        style={anchorStyle}
        tabIndex={0}
        role="button"
        aria-label="Help"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        {children}
      </span>

      {open && portal
        ? createPortal(<div style={tipStyle}>{text}</div>, portal)
        : null}
    </>
  );
}

/**
 * Small color marker used for quick visual grouping in the UI.
 */
function ColorSwatch({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        background: color,
        display: "inline-block",
        flex: "0 0 auto",
      }}
      aria-hidden="true"
    />
  );
}

/**
 * AccordionSection
 *
 * A reusable “collapsible card” used throughout the toolbar so the UI
 * stays compact and scannable:
 * - Grid sizing
 * - Tool selection
 * - Component palette
 * - Status list
 *
 * The header button controls a region with proper ARIA wiring.
 */
function AccordionSection({
  id,
  title,
  hint,
  tooltip,
  children,
  open,
  onToggle,
}: {
  id: string;
  title: string;
  hint?: string;
  tooltip?: string;
  children: React.ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  const headerId = `${id}-header`;
  const panelId = `${id}-panel`;

  const cardStyle: CSSProperties = {
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    background: "#ffffff",
    overflow: "hidden",
  };

  const headerStyle: CSSProperties = {
    padding: "10px 12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    background: "#ffffff",
  };

  const leftStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
    flex: 1,
  };

  const titleRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  };

  const titleStyle: CSSProperties = {
    fontSize: 12,
    fontWeight: 900,
    color: "#111827",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  const hintStyle: CSSProperties = {
    fontSize: 12,
    color: "#6b7280",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  const headerBtnStyle: CSSProperties = {
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    borderRadius: 12,
    padding: "8px 10px",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    color: "#111827",
    fontWeight: 900,
  };

  const panelStyle: CSSProperties = {
    padding: 12,
    borderTop: "1px solid #e5e7eb",
    background: "#ffffff",
    display: open ? "block" : "none",
  };

  return (
    <section style={cardStyle}>
      <div style={headerStyle}>
        <div style={leftStyle}>
          <div style={titleRowStyle}>
            <span style={titleStyle}>{title}</span>

            {tooltip ? (
              <Tooltip text={tooltip}>
                {/* Wrapper span ensures tooltip has a reliable inline anchor */}
                <span>
                  <InfoIcon />
                </span>
              </Tooltip>
            ) : null}
          </div>

          {hint ? <div style={hintStyle}>{hint}</div> : null}
        </div>

        <button
          id={headerId}
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          style={headerBtnStyle}
          title={open ? "Collapse" : "Expand"}
        >
          <ChevronIcon open={open} />
        </button>
      </div>

      <div
        id={panelId}
        role="region"
        aria-labelledby={headerId}
        style={panelStyle}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * Safe readers for editor state fields.
 *
 * Even though the current EditorState type includes these properties,
 * these helpers keep us resilient if the state shape changes in the future
 * or if older persisted data is loaded.
 */
function getPlaceModeFromState(state: unknown): PlaceMode {
  if (state && typeof state === "object" && "placeMode" in state) {
    const v = (state as { placeMode?: unknown }).placeMode;
    if (v === "INVALID_CELL" || v === "COMPONENT") return v;
  }
  return "COMPONENT";
}

function getSelectedInvalidKeyFromState(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  if (!("selectedInvalidCellKey" in state)) return null;

  const v = (state as { selectedInvalidCellKey?: unknown })
    .selectedInvalidCellKey;
  return typeof v === "string" ? v : null;
}

function getInvalidLabelsFromState(state: unknown): Record<string, string> {
  if (!state || typeof state !== "object") return {};
  if (!("invalidCellLabels" in state)) return {};

  const v = (state as { invalidCellLabels?: unknown }).invalidCellLabels;
  if (!v || typeof v !== "object") return {};
  return v as Record<string, string>;
}

/**
 * Parse invalid cell key "x,y" into numeric coordinates.
 * Returns null for malformed keys.
 */
function parseCellKey(key: string): { x: number; y: number } | null {
  const [xs, ys] = key.split(",");
  const x = Number(xs);
  const y = Number(ys);

  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.floor(x), y: Math.floor(y) };
}

function groupColor(type: StatusGroupType): string {
  return TYPE_COLOR[type];
}

type ToolbarProps = {
  // Used to collapse/expand the sidebar (Toolbar wrapper lives outside this file).
  onToggleSidebar: () => void;

  /**
   * Route-aware save handler.
   *
   * EditorPage owns URL rules:
   * - "/"          => create a new layout id and navigate to "/saved/:id"
   * - "/saved/:id" => overwrite that layout id
   *
   * Toolbar only triggers the action.
   */
  onSaveLayout?: () => void;

  /**
   * Allows the parent to disable Save (for example, when there's nothing to save).
   * If not provided, Save stays enabled.
   */
  canSaveLayout?: boolean;
};

/**
 * Toolbar
 *
 * Primary control surface for the editor:
 * - Change grid dimensions
 * - Choose tool (PAN/SELECT/PLACE/ERASE)
 * - Select component type to place
 * - Switch PLACE mode between components and invalid cells
 * - View and manage all placed items (Status list)
 * - Clear selections or clear all
 * - Undo last meaningful edit
 */
export function Toolbar({
  onToggleSidebar,
  onSaveLayout,
  canSaveLayout,
}: ToolbarProps) {
  const {
    state,
    setTool,
    setActiveComponentType,
    setGrid,
    setState,
    setSelectedComponentId,
    undo,
    canUndo,

    // Fallback save for cases where Toolbar is rendered without route logic.
    saveLayout,
  } = useEditorState();

  // Keep grid inputs as strings so the user can type freely (including partial numbers).
  const [colsInput, setColsInput] = useState<string>(String(state.grid.cols));
  const [rowsInput, setRowsInput] = useState<string>(String(state.grid.rows));

  // Status filter lets you focus on a single type or just invalid cells.
  const [statusFilter, setStatusFilter] = useState<FilterValue>("ALL");

  // Rename UI state is local to the toolbar so we can keep it responsive.
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  // Accordion open/close state.
  const [openGrid, setOpenGrid] = useState(true);
  const [openTool, setOpenTool] = useState(true);
  const [openComponents, setOpenComponents] = useState(true);
  const [openStatus, setOpenStatus] = useState(true);

  // Read optional selection/label fields from state.
  const selectedInvalidKey = getSelectedInvalidKeyFromState(state);
  const invalidLabels = getInvalidLabelsFromState(state);

  // Used to enable/disable parts of the UI (SELECT/ERASE are pointless when nothing exists).
  const placedCount = state.components.length;
  const invalidCount = state.invalidCells.size;
  const totalPlaced = placedCount + invalidCount;
  const hasAnyPlaced = totalPlaced > 0;

  const placeMode = getPlaceModeFromState(state);
  const isInvalidModeActive = placeMode === "INVALID_CELL";

  // Inputs are “valid enough” to apply if they parse to numbers (final clamp happens on apply).
  const canApplyGrid = useMemo(() => {
    const cols = Number(colsInput);
    const rows = Number(rowsInput);
    return Number.isFinite(cols) && Number.isFinite(rows);
  }, [colsInput, rowsInput]);

  // Apply grid resize via provider action, then reflect normalized values back into inputs.
  const applyGridSize = () => {
    const cols = clampInt(Number(colsInput), 1, 1000);
    const rows = clampInt(Number(rowsInput), 1, 1000);

    setColsInput(String(cols));
    setRowsInput(String(rows));
    setGrid(cols, rows);
  };

  /**
   * Delete a single item from Status list.
   *
   * Components are removed from `components`.
   * Invalid cells are removed from `invalidCells` and their label removed from `invalidCellLabels`.
   */
  const deleteItem = (it: ListItem) => {
    const ok = window.confirm(`Delete "${it.name}"?`);
    if (!ok) return;

    if (it.kind === "INVALID_CELL") {
      setState((prev) => {
        const nextInvalid = new Set(prev.invalidCells);
        nextInvalid.delete(it.id);

        const currentLabels = getInvalidLabelsFromState(prev);
        const nextLabels = { ...currentLabels };
        delete nextLabels[it.id];

        const prevSelectedInvalid = getSelectedInvalidKeyFromState(prev);
        const wasSelected = prevSelectedInvalid === it.id;

        return {
          ...prev,
          invalidCells: nextInvalid,
          invalidCellLabels: nextLabels,
          selectedInvalidCellKey: wasSelected ? null : prevSelectedInvalid,
        } as typeof prev;
      });
      return;
    }

    setState((prev) => {
      const nextComponents = prev.components.filter((c) => c.id !== it.id);
      const wasSelected = prev.selectedComponentId === it.id;

      return {
        ...prev,
        components: nextComponents,
        selectedComponentId: wasSelected ? null : prev.selectedComponentId,
      };
    });
  };

  // Reset the entire layout (but does not affect saved layouts storage).
  const clearAll = () => {
    setState((prev) => ({
      ...prev,
      components: [],
      invalidCells: new Set(),
      selectedComponentId: null,
      selectedInvalidCellKey: null,
      invalidCellLabels: {},
    }));

    // Also reset rename UI so we don’t show drafts for items that no longer exist.
    setRenameDrafts({});
    setRenamingId(null);
    setRenameError(null);
  };

  // Clear only the current selection.
  const clearSelection = () => {
    setSelectedComponentId(null);

    setState((prev) => ({
      ...prev,
      selectedInvalidCellKey: null,
    }));

    setRenamingId(null);
    setRenameError(null);
  };

  // Shared UI styles -----------------------------------------------------------

  const inputStyle: CSSProperties = {
    width: "100%",
    padding: "10px 10px",
    fontSize: 14,
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    color: "#111827",
    outline: "none",
    boxSizing: "border-box",
  };

  const baseButton: CSSProperties = {
    padding: "10px 10px",
    fontSize: 13,
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    color: "#111827",
    cursor: "pointer",
    fontWeight: 800,
  };

  const iconButton: CSSProperties = {
    width: 34,
    height: 34,
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    color: "#111827",
    cursor: "pointer",
    fontWeight: 900,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
  };

  // If parent doesn’t provide a value, treat Save as enabled.
  const saveEnabled = canSaveLayout ?? true;

  const saveButton: CSSProperties = {
    height: 34,
    padding: "0 12px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#111827",
    color: "#ffffff",
    cursor: saveEnabled ? "pointer" : "not-allowed",
    fontWeight: 900,
    fontSize: 12,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: saveEnabled ? 1 : 0.6,
    whiteSpace: "nowrap",
  };

  // Derived data ---------------------------------------------------------------

  // Count how many components of each type exist (used in palette + filter hinting).
  const countsByType = useMemo(() => {
    const map: Record<ComponentType, number> = {
      LIGHT: 0,
      AIR_SUPPLY: 0,
      AIR_RETURN: 0,
      SMOKE_DETECTOR: 0,
    };
    for (const c of state.components) map[c.type] += 1;
    return map;
  }, [state.components]);

  /**
   * Build a case-insensitive set of all names currently in use.
   *
   * This is used to enforce unique names during rename.
   * The uniqueness rule applies across:
   * - component labels (custom or auto)
   * - invalid cell labels (custom or auto)
   */
  const takenNames = useMemo(() => {
    const set = new Set<string>();

    // Group component ids by type so we can assign stable auto names per type.
    const groups: Record<ComponentType, { id: string; autoName: string }[]> = {
      LIGHT: [],
      AIR_SUPPLY: [],
      AIR_RETURN: [],
      SMOKE_DETECTOR: [],
    };

    for (const c of state.components) {
      groups[c.type].push({ id: c.id, autoName: "" });
    }

    // Deterministic auto names: sort by id, then assign 1..n.
    for (const def of COMPONENTS) {
      const arr = groups[def.value]
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id));
      for (let i = 0; i < arr.length; i += 1) {
        arr[i].autoName = `${def.short}${i + 1}`;
      }
      groups[def.value] = arr;
    }

    const autoById = new Map<string, string>();
    for (const def of COMPONENTS) {
      for (const it of groups[def.value]) autoById.set(it.id, it.autoName);
    }

    // Add component display names.
    for (const c of state.components) {
      const custom = (c as { label?: string }).label?.trim();
      const auto = autoById.get(c.id) ?? "UNKNOWN";
      const display = custom && custom.length > 0 ? custom : auto;
      set.add(display.toLowerCase());
    }

    // Add invalid cell display names.
    const invalidKeys = Array.from(state.invalidCells)
      .slice()
      .sort((a, b) => a.localeCompare(b));

    for (let i = 0; i < invalidKeys.length; i += 1) {
      const k = invalidKeys[i];
      const custom = invalidLabels[k]?.trim();
      const auto = `IV${i + 1}`;
      const display = custom && custom.length > 0 ? custom : auto;
      set.add(display.toLowerCase());
    }

    return set;
  }, [state.components, state.invalidCells, invalidLabels]);

  /**
   * Build the grouped “Status list”.
   *
   * - Components are grouped by type and assigned auto names (L1, AS1, ...)
   * - Invalid cells are grouped under INVALID_CELL and assigned (IV1, IV2, ...)
   * - We keep coordinates so clicking an item can highlight/select it on the canvas.
   */
  const placedList = useMemo(() => {
    const groups: Record<StatusGroupType, ListItem[]> = {
      LIGHT: [],
      AIR_SUPPLY: [],
      AIR_RETURN: [],
      SMOKE_DETECTOR: [],
      INVALID_CELL: [],
    };

    // Build component items first (autoName is assigned after sorting).
    for (const c of state.components) {
      const custom = (c as { label?: string }).label;
      groups[c.type].push({
        id: c.id,
        name: custom?.trim() ?? "",
        x: c.cell.x,
        y: c.cell.y,
        autoName: "",
        kind: "COMPONENT",
      });
    }

    // Assign deterministic auto names per component group.
    for (const def of COMPONENTS) {
      const arr = groups[def.value]
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id));

      for (let i = 0; i < arr.length; i += 1) {
        arr[i].autoName = `${def.short}${i + 1}`;
        if (!arr[i].name) arr[i].name = arr[i].autoName;
      }

      groups[def.value] = arr;
    }

    // Invalid cells: stable ordering by key ensures IV numbers don’t jump around randomly.
    const invalidKeys = Array.from(state.invalidCells)
      .slice()
      .sort((a, b) => a.localeCompare(b));

    const invalidArr: ListItem[] = [];
    for (let i = 0; i < invalidKeys.length; i += 1) {
      const key = invalidKeys[i];
      const xy = parseCellKey(key);
      if (!xy) continue;

      const autoName = `IV${i + 1}`;
      const custom = invalidLabels[key]?.trim() ?? "";

      invalidArr.push({
        id: key,
        name: custom.length > 0 ? custom : autoName,
        autoName,
        x: xy.x,
        y: xy.y,
        kind: "INVALID_CELL",
      });
    }
    groups.INVALID_CELL = invalidArr;

    return groups;
  }, [state.components, state.invalidCells, invalidLabels]);

  // Used for hint text when a filter is active.
  const filteredPlacedCount = useMemo(() => {
    if (statusFilter === "ALL") return totalPlaced;
    if (statusFilter === "INVALID_CELL") return invalidCount;
    return countsByType[statusFilter];
  }, [statusFilter, totalPlaced, invalidCount, countsByType]);

  /**
   * UX rule: SELECT and ERASE do nothing useful when the grid is empty.
   * We disable them and explain why with a tooltip.
   */
  const getToolDisabledReason = (tool: EditorTool): string | null => {
    if ((tool === "SELECT" || tool === "ERASE") && !hasAnyPlaced) {
      return "Add at least one component or invalid cell before using this tool.";
    }
    return null;
  };

  /**
   * Renders one tool button with:
   * - active styling
   * - disabled handling + tooltip
   */
  const renderToolButton = (tool: EditorTool) => {
    const active = state.tool === tool;
    const disabledReason = getToolDisabledReason(tool);
    const isDisabled = Boolean(disabledReason);

    const btn = (
      <button
        key={tool}
        type="button"
        onClick={() => setTool(tool)}
        disabled={isDisabled}
        style={{
          ...baseButton,
          background: active ? "#111827" : "#ffffff",
          color: active ? "#ffffff" : isDisabled ? "#9ca3af" : "#111827",
          borderColor: active ? "#111827" : "#e5e7eb",
          cursor: isDisabled ? "not-allowed" : "pointer",
          opacity: isDisabled ? 0.7 : 1,
        }}
        title={
          tool === "PAN"
            ? "Drag to move the canvas"
            : tool === "SELECT"
            ? "Select and drag components, or select invalid cells"
            : tool === "PLACE"
            ? "Place selected component / toggle invalid cells"
            : "Erase components or invalid cells"
        }
      >
        {tool}
      </button>
    );

    // Disabled buttons can lose hover events; wrap so Tooltip still works reliably.
    if (!isDisabled) return btn;

    return (
      <Tooltip key={tool} text={disabledReason ?? ""}>
        <span style={{ display: "inline-flex" }}>{btn}</span>
      </Tooltip>
    );
  };

  // Rename flow ----------------------------------------------------------------

  // Enter rename mode for the given item.
  const startRename = (id: string, currentName: string) => {
    setRenamingId(id);
    setRenameError(null);

    // Only set the initial draft once so typing isn't overwritten by rerenders.
    setRenameDrafts((prev) => ({
      ...prev,
      [id]: prev[id] ?? currentName,
    }));
  };

  // Exit rename mode without saving.
  const cancelRename = () => {
    setRenamingId(null);
    setRenameError(null);
  };

  /**
   * Persist a renamed label.
   *
   * Rules:
   * - Blank name => clear custom label (falls back to autoName)
   * - Non-blank => must be unique across all items
   * - Components store label on the component object
   * - Invalid cells store label in `invalidCellLabels["x,y"]`
   */
  const commitRename = (group: StatusGroupType, id: string) => {
    const raw = renameDrafts[id] ?? "";
    const next = raw.trim();

    // Blank means: remove custom label and let auto-name be displayed instead.
    if (next.length === 0) {
      if (group === "INVALID_CELL") {
        setState((prev) => {
          const current = getInvalidLabelsFromState(prev);
          if (!current[id]) return prev;

          const nextMap: Record<string, string> = { ...current };
          delete nextMap[id];

          return {
            ...prev,
            invalidCellLabels: nextMap,
          };
        });
      } else {
        setState((prev) => ({
          ...prev,
          components: prev.components.map((c) =>
            c.id === id ? ({ ...c, label: "" } as typeof c) : c
          ),
        }));
      }

      setRenamingId(null);
      setRenameError(null);
      return;
    }

    // If name is effectively unchanged, treat it as a no-op.
    const currentDisplay =
      group === "INVALID_CELL"
        ? invalidLabels[id]?.trim() ?? ""
        : (
            state.components.find((c) => c.id === id) as
              | { label?: string }
              | undefined
          )?.label?.trim() ?? "";

    if (currentDisplay && currentDisplay.toLowerCase() === next.toLowerCase()) {
      setRenamingId(null);
      setRenameError(null);
      return;
    }

    // Enforce uniqueness across all items.
    if (takenNames.has(next.toLowerCase())) {
      setRenameError("Name already exists. Choose a unique name.");
      return;
    }

    // Persist rename to the correct storage location.
    if (group === "INVALID_CELL") {
      setState((prev) => {
        const current = getInvalidLabelsFromState(prev);
        return {
          ...prev,
          invalidCellLabels: {
            ...current,
            [id]: next,
          },
        };
      });
    } else {
      setState((prev) => ({
        ...prev,
        components: prev.components.map((c) => {
          if (c.id !== id) return c;
          return { ...c, label: next } as typeof c;
        }),
      }));
    }

    setRenamingId(null);
    setRenameError(null);
  };

  // Rename UI styles -----------------------------------------------------------

  const renamePanelStyle: CSSProperties = {
    marginTop: 8,
    padding: 10,
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    width: "100%",
    boxSizing: "border-box",
  };

  const renameInputStyle: CSSProperties = {
    width: "100%",
    height: 36,
    padding: "0 12px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    outline: "none",
    fontSize: 13,
    fontWeight: 700,
    color: "#111827",
    background: "#ffffff",
    boxSizing: "border-box",
  };

  const renameBtnRowStyle: CSSProperties = {
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
    flexWrap: "wrap",
  };

  const btnBaseSmall: CSSProperties = {
    height: 34,
    padding: "0 12px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    color: "#111827",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 12,
    whiteSpace: "nowrap",
  };

  const btnPrimarySmall: CSSProperties = {
    ...btnBaseSmall,
    background: "#111827",
    borderColor: "#111827",
    color: "#ffffff",
  };

  /**
   * When PLACE tool is active, placeMode decides what the click does:
   * - COMPONENT: add the selected component type
   * - INVALID_CELL: toggle invalid/valid for that cell
   */
  const setPlaceMode = (mode: PlaceMode) => {
    setState((prev) => ({
      ...prev,
      placeMode: mode,
    }));
  };

  /**
   * Determines which status groups are rendered:
   * - "ALL" => show all groups in a stable order
   * - otherwise => show only the matching group
   */
  const listForRender = useMemo(() => {
    const order: StatusGroupType[] = [
      "LIGHT",
      "AIR_SUPPLY",
      "AIR_RETURN",
      "SMOKE_DETECTOR",
      "INVALID_CELL",
    ];

    if (statusFilter !== "ALL") {
      return [
        {
          type: statusFilter as StatusGroupType,
          items: placedList[statusFilter as StatusGroupType],
        },
      ];
    }

    return order.map((t) => ({
      type: t,
      items: placedList[t],
    }));
  }, [placedList, statusFilter]);

  /**
   * Clicking an item in Status:
   * - selects it
   * - switches to SELECT tool
   *
   * This keeps the workflow fast: click in list → drag on grid immediately.
   */
  const selectListItem = (it: ListItem) => {
    setRenameError(null);

    if (it.kind === "INVALID_CELL") {
      setSelectedComponentId(null);
      setState((prev) => ({
        ...prev,
        selectedInvalidCellKey: it.id,
      }));
      setTool("SELECT");
      return;
    }

    setState((prev) => ({
      ...prev,
      selectedInvalidCellKey: null,
    }));
    setSelectedComponentId(it.id);
    setTool("SELECT");
  };

  /**
   * Save button behavior:
   * - If the page provides route-aware saving, use it.
   * - Otherwise use provider saveLayout() as a fallback.
   */
  const handleSave = () => {
    if (!saveEnabled) return;

    if (onSaveLayout) {
      onSaveLayout();
      return;
    }

    saveLayout();
  };

  // Render ---------------------------------------------------------------------

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: "#111827" }}>
            Ceiling Editor
          </div>

          <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
            Grid square size:{" "}
            <strong style={{ color: "#111827" }}>0.6m × 0.6m</strong>
          </div>
        </div>

        {/* Header actions:
            - Save: persists current state (new or overwrite depending on route)
            - ×: collapses the toolbar panel */}
        <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            onClick={handleSave}
            disabled={!saveEnabled}
            style={saveButton}
            aria-label="Save layout"
            title="Save (creates a new layout on Home, overwrites on Saved)"
          >
            Save
          </button>

          <button
            type="button"
            onClick={onToggleSidebar}
            style={iconButton}
            aria-label="Collapse toolbar"
            title="Collapse toolbar"
          >
            ×
          </button>
        </div>
      </div>

      {/* Grid sizing controls:
          Updates the logical grid and automatically trims anything out of bounds. */}
      <AccordionSection
        id="grid"
        title="Room Ceiling size"
        hint={`Cols: ${state.grid.cols} · Rows: ${state.grid.rows}`}
        tooltip={
          "Sets the ceiling grid size\n" +
          "Defined by number of rows and columns\n" +
          "Components outside new bounds are removed\n" +
          "Components on invalid cells are also removed"
        }
        open={openGrid}
        onToggle={() => setOpenGrid((v) => !v)}
      >
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: "#374151", marginBottom: 6 }}>
              Cols
            </div>
            <input
              value={colsInput}
              onChange={(e) => setColsInput(e.target.value)}
              inputMode="numeric"
              style={inputStyle}
            />
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: "#374151", marginBottom: 6 }}>
              Rows
            </div>
            <input
              value={rowsInput}
              onChange={(e) => setRowsInput(e.target.value)}
              inputMode="numeric"
              style={inputStyle}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={applyGridSize}
          disabled={!canApplyGrid}
          style={{
            ...baseButton,
            width: "100%",
            marginTop: 10,
            background: canApplyGrid ? "#111827" : "#f3f4f6",
            color: canApplyGrid ? "#ffffff" : "#9ca3af",
            borderColor: canApplyGrid ? "#111827" : "#e5e7eb",
            cursor: canApplyGrid ? "pointer" : "not-allowed",
          }}
        >
          Apply
        </button>

        <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
          Range: 1–1000
        </div>
      </AccordionSection>

      {/* Tool selection:
          Disabled rules ensure users don’t pick tools that would do nothing. */}
      <AccordionSection
        id="tool"
        title="Tool"
        hint={`Current: ${state.tool}`}
        tooltip={
          "PAN: drag to move view.\n" +
          "SELECT: click to select and drag components, or click invalid cells to highlight.\n" +
          "PLACE: click to add or toggle invalid cells.\n" +
          "ERASE: click to delete components or invalid cells."
        }
        open={openTool}
        onToggle={() => setOpenTool((v) => !v)}
      >
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
        >
          {TOOLS.map(renderToolButton)}
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
          Tip: SELECT lets you drag-move components. Invalid cells highlight
          with a red border.
        </div>
      </AccordionSection>

      {/* Component palette:
          Clicking a card:
          - sets PLACE mode to COMPONENT
          - selects the active component type
          - switches tool to PLACE for immediate placement */}
      <AccordionSection
        id="components"
        title="Components"
        hint={`Placed: ${placedCount} · Invalid: ${invalidCount}`}
        tooltip={
          "Pick a component to place\n" +
          "Clicking a card switches to PLACE tool\n" +
          "Invalid cell marks empty cells\n" +
          "Components cannot be placed on invalid cells"
        }
        open={openComponents}
        onToggle={() => setOpenComponents((v) => !v)}
      >
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
        >
          {COMPONENTS.map((c) => {
            const active =
              !isInvalidModeActive && state.activeComponentType === c.value;
            const count = countsByType[c.value];
            const color = TYPE_COLOR[c.value];

            return (
              <button
                key={c.value}
                type="button"
                onClick={() => {
                  setPlaceMode("COMPONENT");
                  setActiveComponentType(c.value);
                  setTool("PLACE");
                }}
                style={{
                  ...baseButton,
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: 12,
                  background: "#ffffff",
                  borderColor: active ? color : "#e5e7eb",
                  boxShadow: active ? `0 0 0 3px ${color}22` : "none",
                }}
                title={`Place ${c.label}`}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 12,
                    border: `1px solid ${active ? color : "#e5e7eb"}`,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color,
                    background: "#ffffff",
                    flex: "0 0 auto",
                  }}
                >
                  {c.icon(18)}
                </span>

                <span style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{ fontSize: 13, fontWeight: 900, color: "#111827" }}
                  >
                    {c.label}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                    Count: <strong style={{ color: "#111827" }}>{count}</strong>
                  </div>
                </span>
              </button>
            );
          })}

          {/* Invalid cell “palette card”:
              Activates invalid placement mode and switches to PLACE tool. */}
          <button
            type="button"
            onClick={() => {
              setPlaceMode("INVALID_CELL");
              setTool("PLACE");
            }}
            style={{
              ...baseButton,
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: 12,
              background: "#ffffff",
              borderColor: isInvalidModeActive
                ? TYPE_COLOR.INVALID_CELL
                : "#e5e7eb",
              boxShadow: isInvalidModeActive
                ? `0 0 0 3px ${TYPE_COLOR.INVALID_CELL}22`
                : "none",
            }}
            title="Mark cells as invalid (blocks placement)"
          >
            <span
              style={{
                width: 34,
                height: 34,
                borderRadius: 12,
                border: `1px solid ${
                  isInvalidModeActive ? TYPE_COLOR.INVALID_CELL : "#e5e7eb"
                }`,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: TYPE_COLOR.INVALID_CELL,
                background: "#ffffff",
                flex: "0 0 auto",
              }}
            >
              <ColorSwatch color={TYPE_COLOR.INVALID_CELL} size={18} />
            </span>

            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: "#111827" }}>
                Invalid Cell
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                Count:{" "}
                <strong style={{ color: "#111827" }}>{invalidCount}</strong>
              </div>
            </span>
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
          Tip: Invalid cells remain empty and block components.
        </div>
      </AccordionSection>

      {/* Status list:
          This is where users can:
          - see everything placed
          - filter by type
          - click to select
          - rename and delete items */}
      <AccordionSection
        id="status"
        title="Status"
        hint={`Total: ${totalPlaced}${
          statusFilter === "ALL" ? "" : ` · Filtered: ${filteredPlacedCount}`
        }`}
        tooltip={
          "Shows what’s placed and where\n" +
          "Includes components and invalid cells\n" +
          "Use the filter to view one type\n" +
          "Click an item to highlight it on the grid\n" +
          "Rename assigns a unique label"
        }
        open={openStatus}
        onToggle={() => setOpenStatus((v) => !v)}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 13, color: "#111827", flex: 1 }}>
            Placed: <strong>{totalPlaced}</strong>
            {state.selectedComponentId || selectedInvalidKey ? (
              <span style={{ color: "#111827" }}> (Selected)</span>
            ) : null}
          </div>

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as FilterValue);
              setRenamingId(null);
              setRenameError(null);
            }}
            style={{
              height: 34,
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: "#ffffff",
              color: "#111827",
              fontWeight: 800,
              fontSize: 12,
              padding: "0 10px",
              cursor: "pointer",
            }}
            aria-label="Filter placed items"
            title="Filter placed items"
          >
            <option value="ALL">All</option>
            <option value="LIGHT">Light</option>
            <option value="AIR_SUPPLY">Air Supply</option>
            <option value="AIR_RETURN">Air Return</option>
            <option value="SMOKE_DETECTOR">Smoke Detector</option>
            <option value="INVALID_CELL">Invalid Cells</option>
          </select>
        </div>

        {renameError ? (
          <div style={{ marginTop: 10, fontSize: 12, color: "#b91c1c" }}>
            {renameError}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {hasAnyPlaced ? (
            listForRender.map(({ type, items }) => {
              if (items.length === 0) return null;

              const color = groupColor(type);

              return (
                <div
                  key={type}
                  style={{
                    border: `1px solid ${color}66`,
                    borderRadius: 14,
                    overflow: "hidden",
                    background: `${color}06`,
                  }}
                >
                  <div
                    style={{
                      padding: "10px 10px",
                      background: "#ffffff",
                      fontSize: 12,
                      fontWeight: 900,
                      color: "#111827",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                      borderBottom: `1px solid ${color}33`,
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <ColorSwatch color={color} />
                      {type === "LIGHT"
                        ? "Lights"
                        : type === "AIR_SUPPLY"
                        ? "Air Supply"
                        : type === "AIR_RETURN"
                        ? "Air Return"
                        : type === "SMOKE_DETECTOR"
                        ? "Smoke Detectors"
                        : "Invalid Cells"}
                    </span>

                    <span style={{ color: "#6b7280", fontWeight: 800 }}>
                      {items.length}
                    </span>
                  </div>

                  <div
                    style={{
                      padding: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      background: "#ffffff",
                    }}
                  >
                    {items.map((it) => {
                      const selected =
                        it.kind === "INVALID_CELL"
                          ? selectedInvalidKey === it.id
                          : state.selectedComponentId === it.id;

                      const isRenaming = renamingId === it.id;

                      return (
                        <div
                          key={`${type}:${it.id}`}
                          style={{
                            border: `1px solid ${selected ? color : "#e5e7eb"}`,
                            borderRadius: 14,
                            padding: 10,
                            background: "#ffffff",
                            boxShadow: selected
                              ? `0 0 0 3px ${color}22`
                              : "none",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => selectListItem(it)}
                            style={{
                              ...baseButton,
                              padding: "8px 10px",
                              borderRadius: 12,
                              borderColor: "#e5e7eb",
                              background: "#ffffff",
                              width: "100%",
                              textAlign: "left",
                              display: "flex",
                              alignItems: "flex-start",
                              gap: 10,
                            }}
                            title="Select on grid"
                          >
                            <span style={{ marginTop: 2 }}>
                              <ColorSwatch
                                color={
                                  it.kind === "INVALID_CELL"
                                    ? TYPE_COLOR.INVALID_CELL
                                    : color
                                }
                              />
                            </span>

                            <span style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 900,
                                  color: "#111827",
                                }}
                              >
                                {it.name}
                                {it.name === it.autoName ? null : (
                                  <span
                                    style={{
                                      marginLeft: 8,
                                      fontSize: 12,
                                      color: "#6b7280",
                                      fontWeight: 800,
                                    }}
                                  >
                                    ({it.autoName})
                                  </span>
                                )}
                              </div>

                              <div
                                style={{
                                  marginTop: 2,
                                  fontSize: 12,
                                  color: "#6b7280",
                                }}
                              >
                                Cell:{" "}
                                <strong style={{ color: "#111827" }}>
                                  {it.x},{it.y}
                                </strong>
                              </div>
                            </span>
                          </button>

                          {!isRenaming ? (
                            <div
                              style={{
                                marginTop: 8,
                                display: "flex",
                                justifyContent: "flex-end",
                                gap: 8,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => startRename(it.id, it.name)}
                                style={btnBaseSmall}
                                title="Rename"
                              >
                                Rename
                              </button>

                              <button
                                type="button"
                                onClick={() => deleteItem(it)}
                                style={{
                                  ...btnBaseSmall,
                                  width: 38,
                                  padding: 0,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                                aria-label="Delete"
                                title="Delete"
                              >
                                <TrashIcon size={16} />
                              </button>
                            </div>
                          ) : null}

                          {isRenaming ? (
                            <div style={renamePanelStyle}>
                              <input
                                value={renameDrafts[it.id] ?? it.name}
                                onChange={(e) =>
                                  setRenameDrafts((prev) => ({
                                    ...prev,
                                    [it.id]: e.target.value,
                                  }))
                                }
                                style={renameInputStyle}
                                placeholder={it.autoName}
                                aria-label="Rename item"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter")
                                    commitRename(type, it.id);
                                  if (e.key === "Escape") cancelRename();
                                }}
                                autoFocus
                              />

                              <div style={renameBtnRowStyle}>
                                <button
                                  type="button"
                                  onClick={() => commitRename(type, it.id)}
                                  style={btnPrimarySmall}
                                  title="Save name"
                                >
                                  Save
                                </button>

                                <button
                                  type="button"
                                  onClick={cancelRename}
                                  style={btnBaseSmall}
                                  title="Cancel rename"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ padding: 12, fontSize: 12, color: "#6b7280" }}>
              No components or invalid cells yet.
            </div>
          )}
        </div>

        {/* Status footer actions:
            - Clear all: wipe the current working layout
            - Unselect: remove the current highlight without deleting anything */}
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button
            type="button"
            onClick={clearAll}
            disabled={!hasAnyPlaced}
            style={{
              ...baseButton,
              flex: 1,
              background: !hasAnyPlaced ? "#f3f4f6" : "#ffffff",
              color: !hasAnyPlaced ? "#9ca3af" : "#111827",
              cursor: !hasAnyPlaced ? "not-allowed" : "pointer",
            }}
            title="Remove all components and invalid cells"
          >
            Clear all
          </button>

          <button
            type="button"
            onClick={clearSelection}
            disabled={!state.selectedComponentId && !selectedInvalidKey}
            style={{
              ...baseButton,
              flex: 1,
              background:
                !state.selectedComponentId && !selectedInvalidKey
                  ? "#f3f4f6"
                  : "#ffffff",
              color:
                !state.selectedComponentId && !selectedInvalidKey
                  ? "#9ca3af"
                  : "#111827",
              cursor:
                !state.selectedComponentId && !selectedInvalidKey
                  ? "not-allowed"
                  : "pointer",
            }}
            title="Clear current selection"
          >
            Unselect
          </button>
        </div>

        {/* Undo button:
            Only enabled when provider has history available. */}
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          style={{
            ...baseButton,
            width: "100%",
            marginTop: 10,
            background: canUndo ? "#111827" : "#f3f4f6",
            color: canUndo ? "#ffffff" : "#9ca3af",
            borderColor: canUndo ? "#111827" : "#e5e7eb",
            cursor: canUndo ? "pointer" : "not-allowed",
          }}
          title={canUndo ? "Undo last change" : "Nothing to undo"}
        >
          Undo
        </button>
      </AccordionSection>
    </div>
  );
}
