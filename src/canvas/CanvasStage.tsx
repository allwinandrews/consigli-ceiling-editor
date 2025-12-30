// src/canvas/CanvasStage.tsx
import { useEffect, useMemo, useRef } from "react";
import { useEditorState } from "../state/useEditorState";
import type {
  Camera,
  ComponentType,
  GridCell,
  PlacedComponent,
} from "../types/editor";
import { cellKey as toCellKey } from "../types/editor";
import {
  DEFAULT_CELL_SIZE,
  canvasToWorld,
  getVisibleCellBounds,
  isWithinGrid,
  worldToCell,
} from "../utils/gridMath";

/**
 * Centralized color mapping for component types and invalid cells.
 * Keeping the palette consistent across canvas and toolbar makes the UI easier to scan.
 */
const TYPE_COLOR: Record<ComponentType | "INVALID_CELL", string> = {
  LIGHT: "#f59e0b", // amber
  AIR_SUPPLY: "#3b82f6", // blue
  AIR_RETURN: "#10b981", // green
  SMOKE_DETECTOR: "#8b5cf6", // violet
  INVALID_CELL: "#ef4444", // red
};

/**
 * Grid cells are treated as immutable coordinate pairs.
 * Equality is used for hit testing (hover/select) and occupancy checks.
 */
function cellEquals(a: GridCell, b: GridCell) {
  return a.x === b.x && a.y === b.y;
}

/**
 * Returns the index of the first component occupying a given cell.
 * -1 means the cell is empty.
 */
function findComponentIndexAtCell(
  components: PlacedComponent[],
  cell: GridCell
) {
  return components.findIndex((c) => cellEquals(c.cell, cell));
}

/**
 * Default naming prefixes used for newly placed components:
 * L1, AS1, AR1, SD1, etc.
 */
function typePrefix(type: ComponentType) {
  if (type === "LIGHT") return "L";
  if (type === "AIR_SUPPLY") return "AS";
  if (type === "AIR_RETURN") return "AR";
  return "SD";
}

/**
 * Computes the next default name for a newly placed component of the given type.
 *
 * Naming is monotonic per type: it does not renumber existing items.
 * Example: if L1 is deleted, the next Light becomes L4 rather than reusing L1.
 * This prevents names from shifting when items are removed.
 */
function getNextAutoName(
  components: PlacedComponent[],
  type: ComponentType
): string {
  const prefix = typePrefix(type);
  let max = 0;

  for (const c of components) {
    if (c.type !== type) continue;

    const name = c.autoName;
    if (!name.startsWith(prefix)) continue;

    const n = Number(name.slice(prefix.length));
    if (Number.isFinite(n)) max = Math.max(max, n);
  }

  return `${prefix}${max + 1}`;
}

/**
 * Draws a minimal, high-contrast icon centered inside a cell.
 *
 * Visual rules:
 * - White fill + type-colored stroke for strong readability.
 * - Stroke width is scaled by zoom so icons feel consistent while zooming.
 * - isGhost is used during drag to render a semi-transparent preview.
 * - isSelected draws a subtle ring to match the selected state in the UI.
 */
function drawComponentIcon(args: {
  ctx: CanvasRenderingContext2D;
  type: ComponentType;
  cell: GridCell;
  cellSize: number;
  zoom: number;
  isGhost?: boolean;
  isSelected?: boolean;
}) {
  const { ctx, type, cell, cellSize, zoom, isGhost, isSelected } = args;

  const x = cell.x * cellSize;
  const y = cell.y * cellSize;

  const pad = cellSize * 0.2;
  const cx = x + cellSize / 2;
  const cy = y + cellSize / 2;

  const stroke = TYPE_COLOR[type];

  ctx.lineWidth = 2 / zoom;
  ctx.strokeStyle = stroke;
  ctx.fillStyle = "#ffffff";

  if (isGhost) ctx.globalAlpha = 0.5;

  if (isSelected) {
    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3 / zoom;
    ctx.globalAlpha = 0.35;
    ctx.strokeRect(
      x + 2 / zoom,
      y + 2 / zoom,
      cellSize - 4 / zoom,
      cellSize - 4 / zoom
    );
    ctx.restore();
  }

  if (type === "LIGHT") {
    ctx.beginPath();
    ctx.arc(cx, cy, cellSize * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (type === "AIR_SUPPLY") {
    ctx.beginPath();
    ctx.moveTo(cx, y + pad);
    ctx.lineTo(x + cellSize - pad, y + cellSize - pad);
    ctx.lineTo(x + pad, y + cellSize - pad);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (type === "AIR_RETURN") {
    ctx.beginPath();
    ctx.rect(x + pad, y + pad, cellSize - pad * 2, cellSize - pad * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, cellSize * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, cellSize * 0.06, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

/**
 * Renders a floating label above a cell (used on hover).
 *
 * This improves usability at low zoom:
 * - Confirms which component is under the cursor (custom label or default name).
 * - Also communicates invalid areas when hovering invalid cells.
 */
function drawHoverLabel(args: {
  ctx: CanvasRenderingContext2D;
  zoom: number;
  cellSize: number;
  cell: GridCell;
  text: string;
  accentColor?: string;
}) {
  const { ctx, zoom, cellSize, cell, text, accentColor } = args;

  const x = cell.x * cellSize + cellSize / 2;
  const y = cell.y * cellSize - cellSize * 0.1;

  const fontSize = Math.max(10, Math.min(14, 12 / zoom));
  ctx.font = `900 ${fontSize}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";

  const padX = 8 / zoom;
  const padY = 5 / zoom;
  const metrics = ctx.measureText(text);
  const w = metrics.width + padX * 2;
  const h = fontSize + padY * 2;

  const rx = x - w / 2;
  const ry = y - h;

  ctx.fillStyle = "rgba(17,24,39,0.92)";
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1 / zoom;

  ctx.beginPath();
  const r = 8 / zoom;
  ctx.moveTo(rx + r, ry);
  ctx.lineTo(rx + w - r, ry);
  ctx.quadraticCurveTo(rx + w, ry, rx + w, ry + r);
  ctx.lineTo(rx + w, ry + h - r);
  ctx.quadraticCurveTo(rx + w, ry + h, rx + w - r, ry + h);
  ctx.lineTo(rx + r, ry + h);
  ctx.quadraticCurveTo(rx, ry + h, rx, ry + h - r);
  ctx.lineTo(rx, ry + r);
  ctx.quadraticCurveTo(rx, ry, rx + r, ry);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  if (accentColor) {
    ctx.save();
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 3 / zoom;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    const ux0 = rx + 10 / zoom;
    const ux1 = rx + w - 10 / zoom;
    const uy = ry + h - 4 / zoom;
    ctx.moveTo(ux0, uy);
    ctx.lineTo(ux1, uy);
    ctx.stroke();
    ctx.restore();
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x, y - padY);
}

/**
 * Parses a persisted cell key in "x,y" form.
 * Returns null for corrupted data.
 */
function parseKey(key: string): GridCell | null {
  const [xs, ys] = key.split(",");
  const x = Number(xs);
  const y = Number(ys);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/**
 * Selected invalid-cell key is stored as an extra field on state to avoid widening types.
 * Reads are defensive to stay compatible with older persisted states.
 */
function getSelectedInvalidKeyFromState(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  if (!("selectedInvalidCellKey" in state)) return null;

  const v = (state as { selectedInvalidCellKey?: unknown })
    .selectedInvalidCellKey;
  return typeof v === "string" ? v : null;
}

export function CanvasStage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const {
    state,
    setCamera,
    setComponents,
    setSelectedComponentId,
    setViewportSize,
    toggleInvalidCell,
    setInvalidCells,
    setState,
  } = useEditorState();

  /**
   * Pointer and wheel handlers are registered once, so they read from refs
   * to always use the latest camera/state without re-binding listeners.
   */
  const cameraRef = useRef<Camera>(state.camera);
  const stateRef = useRef(state);

  /**
   * Hover state is stored outside React state to avoid re-rendering on every mouse move.
   * The canvas is redrawn only when a meaningful hover target changes.
   */
  const hoverRef = useRef<{
    isOverSelectable: boolean;
    hoveredComponentId: string | null;
    hoveredCell: GridCell | null;
    hoveredInvalidKey: string | null;
  }>({
    isOverSelectable: false,
    hoveredComponentId: null,
    hoveredCell: null,
    hoveredInvalidKey: null,
  });

  /**
   * Panning uses pointer capture so drag continues smoothly even if the pointer
   * leaves the canvas bounds.
   */
  const isPanningRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  /**
   * Drag state for component moves (SELECT tool).
   * While dragging, we draw a ghost preview and validate the drop target.
   */
  const dragRef = useRef<{
    componentId: string;
    hoverCell: GridCell;
    pointerId: number;
  } | null>(null);

  /**
   * Drag state for moving invalid cells (SELECT tool).
   * This supports repositioning a single invalid cell via drag-and-drop.
   */
  const invalidDragRef = useRef<{
    fromKey: string;
    hoverCell: GridCell;
    pointerId: number;
  } | null>(null);

  /**
   * Draw function is stored in a ref so we can call it from event listeners
   * and from effects without re-registering handlers.
   */
  const drawRef = useRef<(() => void) | null>(null);

  /**
   * Viewport size updates are throttled through requestAnimationFrame to avoid
   * spamming state updates during resize.
   */
  const lastViewportRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const rafViewportRef = useRef<number | null>(null);

  /**
   * Produces a compact signature of values that should trigger a redraw.
   * This keeps redraw logic explicit and avoids missing visual updates.
   */
  const redrawTick = useMemo(
    () =>
      JSON.stringify({
        grid: state.grid,
        tool: state.tool,
        active: state.activeComponentType,
        selected: state.selectedComponentId,
        compsLen: state.components.length,
        invalidLen: state.invalidCells.size,
        camera: state.camera,
        placeMode: state.placeMode,
        selectedInvalid: getSelectedInvalidKeyFromState(state),
      }),
    [state]
  );

  const clampZoom = (z: number) => Math.min(4, Math.max(0.2, z));

  useEffect(() => {
    cameraRef.current = state.camera;
  }, [state.camera]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /**
   * Tool changes should cancel any in-progress pointer interactions to avoid
   * leaking pointer-capture state across modes.
   */
  useEffect(() => {
    isPanningRef.current = false;
    lastPointerRef.current = null;
    dragRef.current = null;
    invalidDragRef.current = null;
  }, [state.tool]);

  /**
   * Ensures a target cell is visible. If not, the camera is updated to bring it
   * near the center of the viewport and (optionally) bumped to a minimum zoom.
   */
  const focusCellInViewIfNeeded = (args: {
    canvas: HTMLCanvasElement;
    cell: GridCell;
    grid: typeof state.grid;
  }) => {
    const { canvas, cell, grid } = args;

    if (isPanningRef.current || dragRef.current || invalidDragRef.current) {
      return;
    }

    if (!isWithinGrid(cell, grid)) return;

    const cellSize = DEFAULT_CELL_SIZE;

    const bounds = getVisibleCellBounds({
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      camera: cameraRef.current,
      grid,
      cellSize,
    });

    const pad = 1;
    const isVisible =
      cell.x >= bounds.minX + pad &&
      cell.x <= bounds.maxX - pad &&
      cell.y >= bounds.minY + pad &&
      cell.y <= bounds.maxY - pad;

    if (isVisible) return;

    const current = cameraRef.current;
    const targetZoom = clampZoom(Math.max(current.zoom, 1.2));

    const worldX = (cell.x + 0.5) * cellSize;
    const worldY = (cell.y + 0.5) * cellSize;

    const next: Camera = {
      zoom: targetZoom,
      panX: canvas.width / 2 - worldX * targetZoom,
      panY: canvas.height / 2 - worldY * targetZoom,
    };

    cameraRef.current = next;
    setCamera(() => next);
  };

  const selectedInvalidKey = useMemo(() => {
    return getSelectedInvalidKeyFromState(state);
  }, [state]);

  /**
   * Auto-focus is only triggered when the selection target changes.
   * This prevents the camera snapping back after user-driven pan/zoom.
   */
  const lastFocusTargetRef = useRef<string | null>(null);

  const focusTarget = useMemo(() => {
    if (state.selectedComponentId) {
      const comp = state.components.find(
        (c) => c.id === state.selectedComponentId
      );
      if (!comp) return null;
      return `C:${comp.id}:${toCellKey(comp.cell)}`;
    }

    if (selectedInvalidKey) return `I:${selectedInvalidKey}`;

    return null;
  }, [state.selectedComponentId, state.components, selectedInvalidKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!focusTarget) {
      lastFocusTargetRef.current = null;
      return;
    }

    if (lastFocusTargetRef.current === focusTarget) return;
    lastFocusTargetRef.current = focusTarget;

    if (focusTarget.startsWith("C:")) {
      const comp = state.components.find(
        (c) => c.id === state.selectedComponentId
      );
      if (!comp) return;

      focusCellInViewIfNeeded({
        canvas,
        cell: comp.cell,
        grid: state.grid,
      });

      return;
    }

    if (focusTarget.startsWith("I:")) {
      const key = selectedInvalidKey;
      if (!key) return;

      const parsed = parseKey(key);
      if (!parsed) return;

      focusCellInViewIfNeeded({
        canvas,
        cell: parsed,
        grid: state.grid,
      });
    }
  }, [
    focusTarget,
    state.components,
    state.selectedComponentId,
    selectedInvalidKey,
    state.grid,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cellSize = DEFAULT_CELL_SIZE;

    const commitViewportSize = (w: number, h: number) => {
      const last = lastViewportRef.current;
      if (last.w === w && last.h === h) return;
      lastViewportRef.current = { w, h };
      setViewportSize(w, h);
    };

    /**
     * The canvas backing buffer is aligned to the element size.
     * This keeps drawing crisp and ensures coordinate math matches pixels.
     */
    const resizeCanvasToClient = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;

      if (rafViewportRef.current != null) {
        cancelAnimationFrame(rafViewportRef.current);
      }
      rafViewportRef.current = requestAnimationFrame(() => {
        rafViewportRef.current = null;
        commitViewportSize(w, h);
        drawRef.current?.();
      });
    };

    const getCanvasPoint = (e: PointerEvent | WheelEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    /**
     * Pointer events are received in screen coordinates; convert to:
     * canvas -> world -> cell coordinates using the current camera.
     */
    const getCellFromPointer = (e: PointerEvent | WheelEvent) => {
      const pt = getCanvasPoint(e);
      const world = canvasToWorld(pt, cameraRef.current);
      return worldToCell(world, cellSize);
    };

    /**
     * Camera is updated continuously during pan/zoom and persisted to state
     * when an interaction completes.
     */
    const commitCameraToState = () => {
      const next = cameraRef.current;
      setCamera(() => next);
    };

    const isCellInvalid = (cell: GridCell) =>
      stateRef.current.invalidCells.has(toCellKey(cell));

    const isCellOccupiedByOther = (cell: GridCell, movingId: string) =>
      stateRef.current.components.some(
        (c) => c.id !== movingId && cellEquals(c.cell, cell)
      );

    const isCellOccupied = (cell: GridCell) =>
      stateRef.current.components.some((c) => cellEquals(c.cell, cell));

    /**
     * A component can be dropped only if:
     * - the cell is within bounds
     * - the cell is not marked invalid
     * - the cell is not occupied by another component
     */
    const canDropOnCell = (cell: GridCell, movingId: string) => {
      if (!isWithinGrid(cell, stateRef.current.grid)) return false;
      if (isCellInvalid(cell)) return false;
      if (isCellOccupiedByOther(cell, movingId)) return false;
      return true;
    };

    /**
     * Invalid cells can be moved only within the grid.
     * Moving onto an existing invalid cell is blocked (unless it's the same cell).
     */
    const canDropInvalidOnCell = (toCell: GridCell, fromKey: string) => {
      if (!isWithinGrid(toCell, stateRef.current.grid)) return false;

      const toKey = toCellKey(toCell);

      if (toKey !== fromKey && stateRef.current.invalidCells.has(toKey)) {
        return false;
      }

      return true;
    };

    /**
     * Cursor styles communicate the active tool and whether an action is possible:
     * - grab/grabbing while panning
     * - pointer when hovering a selectable target in SELECT
     * - not-allowed when placement is invalid
     */
    const updateCursor = () => {
      const s = stateRef.current;

      if (s.tool === "PAN") {
        canvas.style.cursor = isPanningRef.current ? "grabbing" : "grab";
        return;
      }

      if (s.tool === "SELECT") {
        if (dragRef.current || invalidDragRef.current) {
          canvas.style.cursor = "grabbing";
          return;
        }
        canvas.style.cursor = hoverRef.current.isOverSelectable
          ? "pointer"
          : "default";
        return;
      }

      if (s.tool === "PLACE") {
        const cell = hoverRef.current.hoveredCell;
        if (!cell) {
          canvas.style.cursor = "crosshair";
          return;
        }

        if (s.placeMode === "INVALID_CELL") {
          const ok = isWithinGrid(cell, s.grid);
          canvas.style.cursor = ok ? "crosshair" : "not-allowed";
          return;
        }

        const invalid =
          !isWithinGrid(cell, s.grid) ||
          isCellInvalid(cell) ||
          isCellOccupied(cell);

        canvas.style.cursor = invalid ? "not-allowed" : "crosshair";
        return;
      }

      canvas.style.cursor = "crosshair";
    };

    /**
     * Visual preview for dragging an invalid cell:
     * - Semi-transparent fill
     * - Green border for valid drop, red border for invalid drop
     */
    const drawInvalidGhost = (cell: GridCell, ok: boolean) => {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = TYPE_COLOR.INVALID_CELL;
      ctx.fillRect(cell.x * cellSize, cell.y * cellSize, cellSize, cellSize);
      ctx.restore();

      ctx.strokeStyle = ok ? "#10b981" : "#ef4444";
      ctx.lineWidth = 3 / cameraRef.current.zoom;
      ctx.strokeRect(cell.x * cellSize, cell.y * cellSize, cellSize, cellSize);
    };

    /**
     * Computes hover targets for the given cell:
     * - component id if a component occupies the cell
     * - invalid key if the cell is invalid (and not covered by a component)
     *
     * This supports consistent hover labeling across tools and ensures SELECT
     * can switch between pointer/default cursor appropriately.
     */
    const updateHoverTargets = (cell: GridCell) => {
      const s = stateRef.current;

      const idx = findComponentIndexAtCell(s.components, cell);
      const overComponent = idx !== -1;

      const overInvalid =
        !overComponent && isWithinGrid(cell, s.grid) && isCellInvalid(cell);

      const nextHoveredId = overComponent ? s.components[idx].id : null;
      const nextHoveredInvalidKey = overInvalid ? toCellKey(cell) : null;
      const nextOverSelectable = overComponent || overInvalid;

      const changed =
        hoverRef.current.hoveredComponentId !== nextHoveredId ||
        hoverRef.current.hoveredInvalidKey !== nextHoveredInvalidKey;

      if (hoverRef.current.isOverSelectable !== nextOverSelectable) {
        hoverRef.current.isOverSelectable = nextOverSelectable;
        updateCursor();
      }

      if (!changed) return false;

      hoverRef.current.hoveredComponentId = nextHoveredId;
      hoverRef.current.hoveredInvalidKey = nextHoveredInvalidKey;
      return true;
    };

    /**
     * Single-frame render:
     * - Clears background
     * - Applies camera transform (pan + zoom)
     * - Draws visible grid lines only (performance on large grids)
     * - Draws invalid cells + selection rings
     * - Draws components, drag previews, and hover labels
     */
    const draw = () => {
      const s = stateRef.current;
      const { panX, panY, zoom } = cameraRef.current;
      const selectedInvalidKey2 = getSelectedInvalidKeyFromState(s);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f5f5f5";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.translate(panX, panY);
      ctx.scale(zoom, zoom);

      const { minX, minY, maxX, maxY } = getVisibleCellBounds({
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        camera: cameraRef.current,
        grid: s.grid,
        cellSize,
      });

      ctx.strokeStyle = "#d0d0d0";
      ctx.lineWidth = 1 / zoom;

      for (let x = minX; x <= maxX + 1; x += 1) {
        const worldX = x * cellSize;
        ctx.beginPath();
        ctx.moveTo(worldX, minY * cellSize);
        ctx.lineTo(worldX, (maxY + 1) * cellSize);
        ctx.stroke();
      }

      for (let y = minY; y <= maxY + 1; y += 1) {
        const worldY = y * cellSize;
        ctx.beginPath();
        ctx.moveTo(minX * cellSize, worldY);
        ctx.lineTo((maxX + 1) * cellSize, worldY);
        ctx.stroke();
      }

      ctx.strokeStyle = "#999";
      ctx.lineWidth = 2 / zoom;
      ctx.strokeRect(0, 0, s.grid.cols * cellSize, s.grid.rows * cellSize);

      if (s.invalidCells.size > 0) {
        ctx.fillStyle = "rgba(239, 68, 68, 0.12)";

        const invalidDragging = invalidDragRef.current;

        for (const key of s.invalidCells) {
          if (invalidDragging && key === invalidDragging.fromKey) continue;

          const parsed = parseKey(key);
          if (!parsed) continue;

          const { x, y } = parsed;
          if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
            ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
          }
        }

        if (selectedInvalidKey2 && s.invalidCells.has(selectedInvalidKey2)) {
          const parsed = parseKey(selectedInvalidKey2);
          if (parsed) {
            const { x, y } = parsed;
            if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
              ctx.strokeStyle = TYPE_COLOR.INVALID_CELL;
              ctx.lineWidth = 4 / zoom;
              ctx.strokeRect(x * cellSize, y * cellSize, cellSize, cellSize);
            }
          }
        }
      }

      const dragging = dragRef.current;
      for (const comp of s.components) {
        if (
          comp.cell.x < minX ||
          comp.cell.x > maxX ||
          comp.cell.y < minY ||
          comp.cell.y > maxY
        ) {
          continue;
        }
        if (dragging && comp.id === dragging.componentId) continue;

        drawComponentIcon({
          ctx,
          type: comp.type,
          cell: comp.cell,
          cellSize,
          zoom,
          isSelected: s.selectedComponentId === comp.id,
        });
      }

      if (dragging) {
        const comp = s.components.find((c) => c.id === dragging.componentId);
        if (comp) {
          drawComponentIcon({
            ctx,
            type: comp.type,
            cell: dragging.hoverCell,
            cellSize,
            zoom,
            isGhost: true,
            isSelected: true,
          });

          const ok = canDropOnCell(dragging.hoverCell, dragging.componentId);
          ctx.strokeStyle = ok ? "#10b981" : "#ef4444";
          ctx.lineWidth = 3 / zoom;
          ctx.strokeRect(
            dragging.hoverCell.x * cellSize,
            dragging.hoverCell.y * cellSize,
            cellSize,
            cellSize
          );
        }
      }

      const invalidDragging = invalidDragRef.current;
      if (invalidDragging) {
        const ok = canDropInvalidOnCell(
          invalidDragging.hoverCell,
          invalidDragging.fromKey
        );
        drawInvalidGhost(invalidDragging.hoverCell, ok);
      }

      const hoveredId = hoverRef.current.hoveredComponentId;
      const hoveredCell = hoverRef.current.hoveredCell;

      if (hoveredId) {
        const comp = s.components.find((c) => c.id === hoveredId);
        if (comp) {
          const label = comp.label?.trim() || comp.autoName;

          drawHoverLabel({
            ctx,
            zoom,
            cellSize,
            cell: comp.cell,
            text: label,
            accentColor: TYPE_COLOR[comp.type],
          });
        }
      } else if (hoveredCell && isWithinGrid(hoveredCell, s.grid)) {
        if (isCellInvalid(hoveredCell)) {
          drawHoverLabel({
            ctx,
            zoom,
            cellSize,
            cell: hoveredCell,
            text: "Invalid",
            accentColor: TYPE_COLOR.INVALID_CELL,
          });
        }
      }

      ctx.restore();
      updateCursor();
    };

    drawRef.current = draw;

    /**
     * If the selected invalid cell is removed (erase/move), clear the selection.
     */
    const clearInvalidSelectionIfMissing = (key: string) => {
      const s = stateRef.current;
      if (!s.invalidCells.has(key)) {
        setState((prev) => ({
          ...prev,
          selectedInvalidCellKey: null,
        }));
      }
    };

    /**
     * Begins a component drag operation using pointer capture so the drag remains active
     * even if the pointer leaves the canvas.
     */
    const beginComponentDrag = (
      pointerId: number,
      componentId: string,
      cell: GridCell
    ) => {
      dragRef.current = { componentId, hoverCell: cell, pointerId };
      invalidDragRef.current = null;
      canvas.setPointerCapture(pointerId);
    };

    /**
     * Begins an invalid-cell drag operation.
     * The source key is tracked so we can move the invalid marker as a single item.
     */
    const beginInvalidDrag = (
      pointerId: number,
      fromKey: string,
      cell: GridCell
    ) => {
      invalidDragRef.current = { fromKey, hoverCell: cell, pointerId };
      dragRef.current = null;
      canvas.setPointerCapture(pointerId);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;

      const s = stateRef.current;

      if (s.tool === "PAN") {
        isPanningRef.current = true;
        lastPointerRef.current = { x: e.clientX, y: e.clientY };
        canvas.setPointerCapture(e.pointerId);
        updateCursor();
        return;
      }

      const cell = getCellFromPointer(e);

      if (s.tool === "SELECT") {
        const idx = findComponentIndexAtCell(s.components, cell);
        if (idx !== -1) {
          const comp = s.components[idx];

          setState((prev) => ({ ...prev, selectedInvalidCellKey: null }));
          setSelectedComponentId(comp.id);

          beginComponentDrag(e.pointerId, comp.id, comp.cell);
          draw();
          return;
        }

        if (isWithinGrid(cell, s.grid) && isCellInvalid(cell)) {
          const k = toCellKey(cell);

          setSelectedComponentId(null);
          setState((prev) => ({ ...prev, selectedInvalidCellKey: k }));

          beginInvalidDrag(e.pointerId, k, cell);
          draw();
          return;
        }

        setSelectedComponentId(null);
        setState((prev) => ({ ...prev, selectedInvalidCellKey: null }));
        draw();
        return;
      }

      if (!isWithinGrid(cell, s.grid)) return;

      if (s.tool === "PLACE") {
        if (s.placeMode === "INVALID_CELL") {
          const k = toCellKey(cell);
          const willBeInvalid = !s.invalidCells.has(k);

          toggleInvalidCell(cell);

          setSelectedComponentId(null);
          setState((prev) => ({
            ...prev,
            selectedInvalidCellKey: willBeInvalid ? k : null,
          }));

          return;
        }

        if (isCellInvalid(cell)) return;

        setState((prev) => ({ ...prev, selectedInvalidCellKey: null }));

        setComponents((prev) => {
          if (findComponentIndexAtCell(prev, cell) !== -1) return prev;

          const id = crypto.randomUUID();
          const autoName = getNextAutoName(prev, s.activeComponentType);

          return [...prev, { id, type: s.activeComponentType, cell, autoName }];
        });
        return;
      }

      if (s.tool === "ERASE") {
        const idx2 = findComponentIndexAtCell(s.components, cell);
        if (idx2 !== -1) {
          setComponents((prev) =>
            prev.filter((c) => !cellEquals(c.cell, cell))
          );
          if (s.selectedComponentId) setSelectedComponentId(null);
          return;
        }

        const k = toCellKey(cell);
        setInvalidCells((prev) => {
          if (!prev.has(k)) return prev;
          const next = new Set(prev);
          next.delete(k);
          return next;
        });

        const selectedInvalidKey3 = getSelectedInvalidKeyFromState(s);
        if (selectedInvalidKey3 === k) {
          setState((prev) => ({ ...prev, selectedInvalidCellKey: null }));
        }

        if (selectedInvalidKey3)
          clearInvalidSelectionIfMissing(selectedInvalidKey3);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const s = stateRef.current;

      hoverRef.current.hoveredCell = getCellFromPointer(e);

      if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
        dragRef.current.hoverCell = hoverRef.current.hoveredCell;
        draw();
        return;
      }

      if (
        invalidDragRef.current &&
        invalidDragRef.current.pointerId === e.pointerId
      ) {
        invalidDragRef.current.hoverCell = hoverRef.current.hoveredCell;
        draw();
        return;
      }

      if (isPanningRef.current) {
        const last = lastPointerRef.current;
        if (!last) return;

        const dx = e.clientX - last.x;
        const dy = e.clientY - last.y;

        cameraRef.current = {
          ...cameraRef.current,
          panX: cameraRef.current.panX + dx,
          panY: cameraRef.current.panY + dy,
        };

        lastPointerRef.current = { x: e.clientX, y: e.clientY };
        draw();
        return;
      }

      const cell = hoverRef.current.hoveredCell;
      const changed = updateHoverTargets(cell);

      if (s.tool === "PLACE" || s.tool === "ERASE") updateCursor();

      if (changed) {
        draw();
      }
    };

    /**
     * Finalizes a component drag:
     * - Validates the drop cell
     * - Commits the position to state
     * - Releases pointer capture
     */
    const finalizeComponentDrag = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;

      const dropCell = getCellFromPointer(e);
      drag.hoverCell = dropCell;

      const s = stateRef.current;

      if (canDropOnCell(dropCell, drag.componentId)) {
        const nextComponents = s.components.map((c) =>
          c.id === drag.componentId ? { ...c, cell: dropCell } : c
        );

        setComponents(() => nextComponents);
        stateRef.current = { ...s, components: nextComponents };
      }

      dragRef.current = null;

      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore release errors if capture isn't active.
      }

      draw();
    };

    /**
     * Finalizes an invalid-cell drag:
     * - Moves the invalid marker to the new cell (if valid)
     * - Removes any component that would overlap the invalid cell after the move
     * - Updates invalid selection to follow the moved cell
     */
    const finalizeInvalidDrag = (e: PointerEvent) => {
      const drag = invalidDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;

      const dropCell = getCellFromPointer(e);
      drag.hoverCell = dropCell;

      const s = stateRef.current;

      const fromKey = drag.fromKey;
      const toKey = toCellKey(dropCell);

      if (canDropInvalidOnCell(dropCell, fromKey)) {
        const nextInvalid = new Set(s.invalidCells);
        nextInvalid.delete(fromKey);
        nextInvalid.add(toKey);

        const nextComponents = s.components.filter(
          (c) => !cellEquals(c.cell, dropCell)
        );

        setInvalidCells(() => nextInvalid);
        setComponents(() => nextComponents);

        setSelectedComponentId(null);
        setState((prev) => ({ ...prev, selectedInvalidCellKey: toKey }));

        stateRef.current = {
          ...s,
          invalidCells: nextInvalid,
          components: nextComponents,
          selectedComponentId: null,
        };
      } else {
        setState((prev) => ({ ...prev, selectedInvalidCellKey: fromKey }));
      }

      invalidDragRef.current = null;

      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // no-op
      }

      draw();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
        finalizeComponentDrag(e);
        return;
      }
      if (
        invalidDragRef.current &&
        invalidDragRef.current.pointerId === e.pointerId
      ) {
        finalizeInvalidDrag(e);
        return;
      }

      if (!isPanningRef.current) return;

      isPanningRef.current = false;
      lastPointerRef.current = null;

      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // no-op
      }

      commitCameraToState();
      draw();
    };

    /**
     * Wheel zoom is centered on the pointer position so users can zoom into a detail
     * without losing context.
     */
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      const { x: cx, y: cy } = getCanvasPoint(e);
      const camera = cameraRef.current;

      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const nextZoom = clampZoom(camera.zoom * zoomFactor);

      const worldX = (cx - camera.panX) / camera.zoom;
      const worldY = (cy - camera.panY) / camera.zoom;

      const updatedPanX = cx - worldX * nextZoom;
      const updatedPanY = cy - worldY * nextZoom;

      cameraRef.current = {
        panX: updatedPanX,
        panY: updatedPanY,
        zoom: nextZoom,
      };

      commitCameraToState();
      draw();
    };

    const ro = new ResizeObserver(() => {
      resizeCanvasToClient();
    });
    ro.observe(canvas);

    resizeCanvasToClient();

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    /**
     * Global listeners ensure drag finalization even if the pointer-up happens
     * outside the canvas while captured.
     */
    window.addEventListener("pointerup", finalizeComponentDrag);
    window.addEventListener("pointercancel", finalizeComponentDrag);
    window.addEventListener("pointerup", finalizeInvalidDrag);
    window.addEventListener("pointercancel", finalizeInvalidDrag);

    canvas.addEventListener("wheel", onWheel, { passive: false });

    updateCursor();
    draw();

    return () => {
      ro.disconnect();

      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);

      window.removeEventListener("pointerup", finalizeComponentDrag);
      window.removeEventListener("pointercancel", finalizeComponentDrag);
      window.removeEventListener("pointerup", finalizeInvalidDrag);
      window.removeEventListener("pointercancel", finalizeInvalidDrag);

      canvas.removeEventListener("wheel", onWheel);

      if (rafViewportRef.current != null) {
        cancelAnimationFrame(rafViewportRef.current);
        rafViewportRef.current = null;
      }

      if (drawRef.current === draw) drawRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    setCamera,
    setComponents,
    setSelectedComponentId,
    setViewportSize,
    toggleInvalidCell,
    setInvalidCells,
    setState,
  ]);

  /**
   * Redraw on meaningful state changes (tooling, camera, components, invalid cells).
   * Rendering stays imperative for performance on large grids.
   */
  useEffect(() => {
    drawRef.current?.();
  }, [redrawTick]);

  return (
    <canvas
      ref={canvasRef}
      className="canvasStage"
      aria-label="Ceiling editor canvas"
    />
  );
}
