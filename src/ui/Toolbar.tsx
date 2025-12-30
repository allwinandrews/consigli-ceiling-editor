// src/ui/Toolbar.tsx
import {
  useMemo,
  useState,
  type CSSProperties,
  useRef,
  useEffect,
  type ReactElement,
  useCallback,
} from "react";
import { createPortal } from "react-dom";

import { useEditorState } from "../state/useEditorState";
import type {
  ComponentType,
  EditorTool,
  PlacedComponent,
} from "../types/editor";

/**
 * Toolbar for the ceiling editor.
 *
 * What lives here:
 * - Grid sizing inputs (draft values + apply validation)
 * - Tool selection (PAN / SELECT / PLACE / ERASE)
 * - Component palette (component cards + invalid cell mode)
 * - Status list (select, rename, delete)
 * - High-level actions (save, undo, clear)
 *
 * Styling approach:
 * - Most visuals are driven by scoped CSS classes (tb*)
 * - Inline styles are reserved for state-driven colors (active/selected/type colors)
 */
const TOOLS: EditorTool[] = ["PAN", "SELECT", "PLACE", "ERASE"];

const GRID_MAX_RECOMMENDED = 100;
const GRID_MAX_HARD = 1000;

/**
 * Shared semantic colors for the editor.
 * These colors are used consistently across toolbar + canvas.
 */
const TYPE_COLOR: Record<ComponentType | "INVALID_CELL", string> = {
  LIGHT: "#f59e0b", // amber
  AIR_SUPPLY: "#3b82f6", // blue
  AIR_RETURN: "#10b981", // green
  SMOKE_DETECTOR: "#8b5cf6", // violet
  INVALID_CELL: "#ef4444", // red
};

/**
 * Component palette shown as selectable cards.
 * - short is used to build stable auto-names (L1, AS1, ...)
 * - icon is a small inline SVG rendered inside the card
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
 * Normalized row used by the Status list.
 * We merge:
 * - placed components (id = component id)
 * - invalid cells (id = "x,y")
 */
type ListItem = {
  id: string;
  name: string;
  autoName: string;
  x: number;
  y: number;
  kind: "COMPONENT" | "INVALID_CELL";
};

/**
 * Clamp numeric values safely.
 * The UI allows temporary invalid drafts; bounds are enforced on apply.
 */
function clampInt(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

/**
 * Returns document.body once on mount.
 * Used for tooltips so they are not clipped by scroll/overflow containers.
 */
function useBodyPortal(): HTMLElement | null {
  const [body] = useState<HTMLElement | null>(() => {
    return typeof document !== "undefined" ? document.body : null;
  });
  return body;
}

/**
 * Small "info" badge used as a tooltip anchor.
 * Visual styling is owned by the global tbInfoIcon class.
 */
function InfoIcon({ size = 18 }: { size?: number }) {
  return (
    <span
      className="tbInfoIcon"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      i
    </span>
  );
}

/**
 * Chevron used in accordion headers.
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
 * Trash icon used for delete actions in the Status list.
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
 * Dependency-free tooltip:
 * - portals to body (prevents clipping)
 * - opens on hover and focus
 * - closes on mouse leave, blur, or Escape
 * - fixed positioning so it stays aligned during scrolling
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

  const updatePos = useCallback(() => {
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
  }, [width]);

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
  }, [open, updatePos]);

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
    pointerEvents: "none",
  };

  return (
    <>
      <span
        ref={anchorRef}
        className="tbTooltipAnchor"
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
 * Small color marker used to visually reinforce grouping.
 */
function ColorSwatch({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <span
      className="tbColorSwatch"
      style={{
        width: size,
        height: size,
        background: color,
      }}
      aria-hidden="true"
    />
  );
}

/**
 * AccordionSection
 *
 * Collapsible card used throughout the toolbar.
 * ARIA wiring ensures the header controls a labeled region.
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

  return (
    <section className="tbCard">
      <div className="tbCardHeader">
        <div className="tbCardHeaderLeft">
          <div className="tbCardTitleRow">
            <span className="tbCardTitle">{title}</span>

            {tooltip ? (
              <Tooltip text={tooltip}>
                <span>
                  <InfoIcon />
                </span>
              </Tooltip>
            ) : null}
          </div>

          {hint ? <div className="tbCardHint">{hint}</div> : null}
        </div>

        <button
          id={headerId}
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="tbCardHeaderBtn"
          title={open ? "Collapse" : "Expand"}
        >
          <ChevronIcon open={open} />
        </button>
      </div>

      <div
        id={panelId}
        role="region"
        aria-labelledby={headerId}
        className="tbCardPanel"
        style={{ display: open ? "block" : "none" }}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * Defensive readers for toolbar-only state fields.
 * These protect the UI if older persisted layouts are missing newer fields.
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
 * Parse invalid cell keys formatted as "x,y".
 */
function parseCellKey(key: string): { x: number; y: number } | null {
  const [xs, ys] = key.split(",");
  const x = Number(xs);
  const y = Number(ys);

  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.floor(x), y: Math.floor(y) };
}

/**
 * Returns the grouping color for status sections.
 */
function groupColor(type: StatusGroupType): string {
  return TYPE_COLOR[type];
}

type ToolbarProps = {
  onToggleSidebar: () => void;
  onSaveLayout?: () => void;
  canSaveLayout?: boolean;
};

/**
 * Returns the display name for a placed component.
 * - label (user) takes precedence
 * - autoName is the stable fallback (L1, AS1, ...)
 */
function getComponentDisplayName(c: PlacedComponent): {
  name: string;
  autoName: string;
} {
  const autoName = c.autoName;
  const custom = (c as { label?: string }).label?.trim();
  const name = custom && custom.length > 0 ? custom : autoName;
  return { name, autoName };
}

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
    saveLayout,
  } = useEditorState();

  /**
   * Grid inputs use a draft-or-state model:
   * - When not editing, the displayed value comes directly from editor state.
   * - When editing, we hold a local string draft so users can type freely.
   *
   * This avoids syncing drafts via an effect (and avoids cascading render warnings).
   */
  const [colsDraft, setColsDraft] = useState<string | null>(null);
  const [rowsDraft, setRowsDraft] = useState<string | null>(null);
  const gridInputsEditingRef = useRef(false);

  const colsValue = colsDraft ?? String(state.grid.cols);
  const rowsValue = rowsDraft ?? String(state.grid.rows);

  const [gridError, setGridError] = useState<string | null>(null);

  /**
   * Status filter + rename state are UI-only.
   * They do not belong in EditorState because they don’t affect exported layout data.
   */
  const [statusFilter, setStatusFilter] = useState<FilterValue>("ALL");
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  /**
   * Accordion open/closed state is local to the toolbar UI.
   */
  const [openGrid, setOpenGrid] = useState(true);
  const [openTool, setOpenTool] = useState(true);
  const [openComponents, setOpenComponents] = useState(true);
  const [openStatus, setOpenStatus] = useState(true);

  const selectedInvalidKey = getSelectedInvalidKeyFromState(state);
  const invalidLabels = getInvalidLabelsFromState(state);

  const placedCount = state.components.length;
  const invalidCount = state.invalidCells.size;
  const totalPlaced = placedCount + invalidCount;
  const hasAnyPlaced = totalPlaced > 0;

  const placeMode = getPlaceModeFromState(state);
  const isInvalidModeActive = placeMode === "INVALID_CELL";

  const parsedGrid = useMemo(() => {
    const cols = Number(colsValue);
    const rows = Number(rowsValue);
    return {
      cols,
      rows,
      colsOk: Number.isFinite(cols),
      rowsOk: Number.isFinite(rows),
    };
  }, [colsValue, rowsValue]);

  const gridWithinHardLimit = useMemo(() => {
    if (!parsedGrid.colsOk || !parsedGrid.rowsOk) return false;
    if (parsedGrid.cols < 1 || parsedGrid.rows < 1) return false;
    if (parsedGrid.cols > GRID_MAX_HARD || parsedGrid.rows > GRID_MAX_HARD)
      return false;
    return true;
  }, [parsedGrid]);

  /**
   * Apply is enabled only when drafts are numeric and inside hard bounds.
   */
  const canApplyGrid = useMemo(
    () => gridWithinHardLimit,
    [gridWithinHardLimit]
  );

  const applyGridSize = () => {
    const cols = Number(colsValue);
    const rows = Number(rowsValue);

    if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
      setGridError("Enter valid numbers for rows and columns.");
      return;
    }

    if (cols < 1 || rows < 1) {
      setGridError("Grid size must be at least 1×1.");
      return;
    }

    if (cols > GRID_MAX_HARD || rows > GRID_MAX_HARD) {
      setGridError(`Max supported grid is ${GRID_MAX_HARD}×${GRID_MAX_HARD}.`);
      return;
    }

    setGridError(null);

    const nextCols = clampInt(cols, 1, GRID_MAX_HARD);
    const nextRows = clampInt(rows, 1, GRID_MAX_HARD);

    // Normalize drafts to the applied values (keeps UI consistent after apply).
    setColsDraft(String(nextCols));
    setRowsDraft(String(nextRows));
    setGrid(nextCols, nextRows);
  };

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

  const clearAll = () => {
    setState((prev) => ({
      ...prev,
      components: [],
      invalidCells: new Set(),
      selectedComponentId: null,
      selectedInvalidCellKey: null,
      invalidCellLabels: {},
    }));

    setRenameDrafts({});
    setRenamingId(null);
    setRenameError(null);
  };

  const clearSelection = () => {
    setSelectedComponentId(null);

    setState((prev) => ({
      ...prev,
      selectedInvalidCellKey: null,
    }));

    setRenamingId(null);
    setRenameError(null);
  };

  const saveEnabled = canSaveLayout ?? true;

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

  const takenNames = useMemo(() => {
    const set = new Set<string>();

    for (const c of state.components) {
      const { name } = getComponentDisplayName(c);
      set.add(name.toLowerCase());
    }

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

  const placedList = useMemo(() => {
    const groups: Record<StatusGroupType, ListItem[]> = {
      LIGHT: [],
      AIR_SUPPLY: [],
      AIR_RETURN: [],
      SMOKE_DETECTOR: [],
      INVALID_CELL: [],
    };

    for (const c of state.components) {
      const { name, autoName } = getComponentDisplayName(c);
      groups[c.type].push({
        id: c.id,
        name,
        autoName,
        x: c.cell.x,
        y: c.cell.y,
        kind: "COMPONENT",
      });
    }

    for (const def of COMPONENTS) {
      groups[def.value] = groups[def.value]
        .slice()
        .sort((a, b) => a.autoName.localeCompare(b.autoName));
    }

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

  const filteredPlacedCount = useMemo(() => {
    if (statusFilter === "ALL") return totalPlaced;
    if (statusFilter === "INVALID_CELL") return invalidCount;
    return countsByType[statusFilter];
  }, [statusFilter, totalPlaced, invalidCount, countsByType]);

  const getToolDisabledReason = (tool: EditorTool): string | null => {
    if ((tool === "SELECT" || tool === "ERASE") && !hasAnyPlaced) {
      return "Add at least one component or invalid cell before using this tool.";
    }
    return null;
  };

  const renderToolButton = (tool: EditorTool) => {
    const active = state.tool === tool;
    const disabledReason = getToolDisabledReason(tool);
    const isDisabled = Boolean(disabledReason);

    const btnStyle: CSSProperties = {
      background: active ? "#111827" : "#ffffff",
      color: active ? "#ffffff" : isDisabled ? "#9ca3af" : "#111827",
      borderColor: active ? "#111827" : "#e5e7eb",
      cursor: isDisabled ? "not-allowed" : "pointer",
      opacity: isDisabled ? 0.7 : 1,
    };

    const btn = (
      <button
        key={tool}
        type="button"
        onClick={() => setTool(tool)}
        disabled={isDisabled}
        className="tbToolBtn"
        style={btnStyle}
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

    if (!isDisabled) return btn;

    return (
      <Tooltip key={tool} text={disabledReason ?? ""}>
        <span className="tbInlineFlex">{btn}</span>
      </Tooltip>
    );
  };

  const startRename = (id: string, currentName: string) => {
    setRenamingId(id);
    setRenameError(null);

    setRenameDrafts((prev) => ({
      ...prev,
      [id]: prev[id] ?? currentName,
    }));
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameError(null);
  };

  const getCurrentDisplayNameForId = (
    group: StatusGroupType,
    id: string
  ): string => {
    if (group === "INVALID_CELL") {
      const keys = Array.from(state.invalidCells)
        .slice()
        .sort((a, b) => a.localeCompare(b));
      const index = keys.indexOf(id);
      const autoName = index >= 0 ? `IV${index + 1}` : "IV";
      const custom = invalidLabels[id]?.trim();
      return custom && custom.length > 0 ? custom : autoName;
    }

    const c = state.components.find((x) => x.id === id);
    if (!c) return "";
    return getComponentDisplayName(c).name;
  };

  const commitRename = (group: StatusGroupType, id: string) => {
    const raw = renameDrafts[id] ?? "";
    const next = raw.trim();

    // Empty input means "clear custom label" and fall back to autoName.
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

    // No-op rename (case-insensitive)
    const currentDisplay = getCurrentDisplayNameForId(group, id);
    if (currentDisplay && currentDisplay.toLowerCase() === next.toLowerCase()) {
      setRenamingId(null);
      setRenameError(null);
      return;
    }

    if (takenNames.has(next.toLowerCase())) {
      setRenameError("Name already exists. Choose a unique name.");
      return;
    }

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

  const setPlaceMode = (mode: PlaceMode) => {
    setState((prev) => ({
      ...prev,
      placeMode: mode,
    }));
  };

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

  const handleSave = () => {
    if (!saveEnabled) return;

    if (onSaveLayout) {
      onSaveLayout();
      return;
    }

    saveLayout();
  };

  return (
    <div className="tbRoot">
      <div className="tbHeader">
        <div className="tbHeaderLeft">
          <div className="tbHeaderTitle">Ceiling Editor</div>
          <div className="tbHeaderSub">
            Grid square size: <strong className="tbStrong">0.6m × 0.6m</strong>
          </div>
        </div>

        <div className="tbHeaderActions">
          <button
            type="button"
            onClick={handleSave}
            disabled={!saveEnabled}
            className="tbSaveBtn"
            aria-label="Save layout"
            title="Save (creates a new layout on Home, overwrites on Saved)"
          >
            Save
          </button>

          <button
            type="button"
            onClick={onToggleSidebar}
            className="tbIconBtn"
            aria-label="Collapse toolbar"
            title="Collapse toolbar"
          >
            ×
          </button>
        </div>
      </div>

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
        <div className="tbGridInputsRow">
          <div className="tbGridField">
            <div className="tbFieldLabel">Cols</div>
            <input
              value={colsValue}
              onChange={(e) => {
                setColsDraft(e.target.value);
                setGridError(null);
              }}
              onFocus={() => {
                gridInputsEditingRef.current = true;
                setColsDraft((prev) => prev ?? String(state.grid.cols));
              }}
              onBlur={() => {
                gridInputsEditingRef.current = false;

                const cols = Number(colsValue);
                if (!Number.isFinite(cols) || colsValue.trim().length === 0) {
                  setColsDraft(null); // snap back to state value
                }
              }}
              inputMode="numeric"
              className="tbInput"
            />
          </div>

          <div className="tbGridField">
            <div className="tbFieldLabel">Rows</div>
            <input
              value={rowsValue}
              onChange={(e) => {
                setRowsDraft(e.target.value);
                setGridError(null);
              }}
              onFocus={() => {
                gridInputsEditingRef.current = true;
                setRowsDraft((prev) => prev ?? String(state.grid.rows));
              }}
              onBlur={() => {
                gridInputsEditingRef.current = false;

                const rows = Number(rowsValue);
                if (!Number.isFinite(rows) || rowsValue.trim().length === 0) {
                  setRowsDraft(null); // snap back to state value
                }
              }}
              inputMode="numeric"
              className="tbInput"
            />
          </div>
        </div>

        {gridError ? <div className="tbError">{gridError}</div> : null}

        <button
          type="button"
          onClick={applyGridSize}
          disabled={!canApplyGrid}
          className="tbApplyBtn"
          style={{
            background: canApplyGrid ? "#111827" : "#f3f4f6",
            color: canApplyGrid ? "#ffffff" : "#9ca3af",
            borderColor: canApplyGrid ? "#111827" : "#e5e7eb",
            cursor: canApplyGrid ? "pointer" : "not-allowed",
          }}
        >
          Apply
        </button>

        <div className="tbMuted">
          Recommended: 1–{GRID_MAX_RECOMMENDED} · Max: 1–{GRID_MAX_HARD}
        </div>
      </AccordionSection>

      <AccordionSection
        id="tool"
        title="Tool"
        hint={`Current: ${state.tool}`}
        tooltip={
          "PAN: Drag to move view.\n" +
          "SELECT: Click to select and drag components, or click invalid cells to highlight.\n" +
          "PLACE: Click to add or toggle invalid cells.\n" +
          "ERASE: Click to delete components or invalid cells."
        }
        open={openTool}
        onToggle={() => setOpenTool((v) => !v)}
      >
        <div className="tbToolGrid">{TOOLS.map(renderToolButton)}</div>

        <div className="tbMuted">
          Tip: SELECT lets you drag-move components. Invalid cells highlight
          with a red border.
        </div>
      </AccordionSection>

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
                className="tbToolBtn"
                style={{
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: 12,
                  background: "#ffffff",
                  borderColor: active ? color : "#e5e7eb",
                  boxShadow: active
                    ? `0 0 0 3px ${color}22`
                    : "var(--shadow-1)",
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

          <button
            type="button"
            onClick={() => {
              setPlaceMode("INVALID_CELL");
              setTool("PLACE");
            }}
            className="tbToolBtn"
            style={{
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
                : "var(--shadow-1)",
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

        <div className="tbMuted">
          Tip: Invalid cells remain empty and block components.
        </div>
      </AccordionSection>

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
            className="tbInput"
            style={{
              height: 34,
              padding: "0 10px",
              fontWeight: 800,
              fontSize: 12,
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

        {renameError ? <div className="tbError">{renameError}</div> : null}

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
                              : "var(--shadow-1)",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => selectListItem(it)}
                            className="tbToolBtn"
                            style={{
                              padding: "8px 10px",
                              borderRadius: 12,
                              borderColor: "#e5e7eb",
                              background: "#ffffff",
                              width: "100%",
                              textAlign: "left",
                              display: "flex",
                              alignItems: "flex-start",
                              gap: 10,
                              boxShadow: "none",
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
                                className="savedBtn"
                                style={{ height: 34, fontSize: 12 }}
                                title="Rename"
                              >
                                Rename
                              </button>

                              <button
                                type="button"
                                onClick={() => deleteItem(it)}
                                className="savedBtn"
                                style={{
                                  width: 38,
                                  height: 34,
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
                            <div
                              style={{
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
                              }}
                            >
                              <input
                                value={renameDrafts[it.id] ?? it.name}
                                onChange={(e) =>
                                  setRenameDrafts((prev) => ({
                                    ...prev,
                                    [it.id]: e.target.value,
                                  }))
                                }
                                className="savedRenameInput"
                                placeholder={it.autoName}
                                aria-label="Rename item"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter")
                                    commitRename(type, it.id);
                                  if (e.key === "Escape") cancelRename();
                                }}
                                autoFocus
                              />

                              <div
                                style={{
                                  display: "flex",
                                  gap: 8,
                                  justifyContent: "flex-end",
                                  flexWrap: "wrap",
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() => commitRename(type, it.id)}
                                  className="savedBtn savedBtnPrimary"
                                  style={{ height: 34, fontSize: 12 }}
                                  title="Save name"
                                >
                                  Save
                                </button>

                                <button
                                  type="button"
                                  onClick={cancelRename}
                                  className="savedBtn"
                                  style={{ height: 34, fontSize: 12 }}
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

        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button
            type="button"
            onClick={clearAll}
            disabled={!hasAnyPlaced}
            className="tbToolBtn"
            style={{
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
            className="tbToolBtn"
            style={{
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

        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          className="tbApplyBtn"
          style={{
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
