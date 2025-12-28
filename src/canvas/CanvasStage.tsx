// src/canvas/CanvasStage.tsx
import { useEffect, useMemo, useRef } from "react";
import { useEditorState } from "../state/useEditorState";
import type {
  Camera,
  ComponentType,
  GridCell,
  PlacedComponent,
} from "../types/editor";
import {
  DEFAULT_CELL_SIZE,
  canvasToWorld,
  getVisibleCellBounds,
  isWithinGrid,
  worldToCell,
} from "../utils/gridMath";

/**
 * Shared color palette across the UI (Toolbar + Canvas).
 * This keeps type recognition consistent throughout the app.
 *
 * Usage on canvas:
 * - Component outlines/icons
 * - Selection ring
 * - Hover label accent
 * - Invalid cell borders/fills
 */
const TYPE_COLOR: Record<ComponentType | "INVALID_CELL", string> = {
  LIGHT: "#f59e0b", // amber
  AIR_SUPPLY: "#3b82f6", // blue
  AIR_RETURN: "#10b981", // green
  SMOKE_DETECTOR: "#8b5cf6", // violet
  INVALID_CELL: "#ef4444", // red
};

function cellEquals(a: GridCell, b: GridCell) {
  return a.x === b.x && a.y === b.y;
}

/**
 * Finds the index of the first component occupying a given cell.
 * Returns -1 when the cell is empty.
 */
function findComponentIndexAtCell(
  components: PlacedComponent[],
  cell: GridCell
) {
  return components.findIndex((c) => cellEquals(c.cell, cell));
}

/**
 * Draw a simple icon representing a component inside a grid cell.
 *
 * Notes:
 * - Icons are intentionally minimal and readable at multiple zoom levels.
 * - We use zoom-adjusted line widths so strokes look consistent while zooming.
 * - `isGhost` is used during drag to show a semi-transparent preview.
 * - `isSelected` draws a subtle selection ring to match the toolbar selection behavior.
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

  // Selection outline (subtle but visible).
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

  // Shape by type.
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
    // SMOKE_DETECTOR
    ctx.beginPath();
    ctx.arc(cx, cy, cellSize * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, cellSize * 0.06, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Always restore alpha to avoid leaking into later drawing.
  ctx.globalAlpha = 1;
}

/**
 * UI naming prefixes used for auto-generated labels:
 * L1, AS1, AR1, SD1...
 */
function typePrefix(type: ComponentType) {
  if (type === "LIGHT") return "L";
  if (type === "AIR_SUPPLY") return "AS";
  if (type === "AIR_RETURN") return "AR";
  return "SD";
}

/**
 * Builds a stable auto-name map for the current component list.
 *
 * Why this exists:
 * - Components have UUIDs for identity, but humans want short names.
 * - We keep the same approach as the Toolbar: sort by id per type.
 * - Auto names are computed dynamically so they always reflect the current set.
 */
function buildAutoNameMap(components: PlacedComponent[]) {
  const byType: Record<ComponentType, string[]> = {
    LIGHT: [],
    AIR_SUPPLY: [],
    AIR_RETURN: [],
    SMOKE_DETECTOR: [],
  };

  for (const c of components) byType[c.type].push(c.id);

  for (const t of Object.keys(byType) as ComponentType[]) {
    byType[t].sort((a, b) => a.localeCompare(b));
  }

  const map = new Map<string, string>();
  for (const t of Object.keys(byType) as ComponentType[]) {
    const prefix = typePrefix(t);
    const ids = byType[t];
    for (let i = 0; i < ids.length; i += 1) {
      map.set(ids[i], `${prefix}${i + 1}`);
    }
  }

  return map;
}

/**
 * Draw a floating label above a cell (used on hover).
 *
 * This helps usability at lower zoom levels:
 * - Users can confirm which component they're pointing at.
 * - We also show "Invalid" when hovering invalid cells.
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

  // Zoom-aware font size (kept within a readable range).
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

  // Label background.
  ctx.fillStyle = "rgba(17,24,39,0.92)";
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1 / zoom;

  // Rounded rect.
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

  // Accent underline (matches component type color).
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

  // Text.
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x, y - padY);
}

function cellKey(cell: GridCell) {
  return `${cell.x},${cell.y}`;
}

function parseKey(key: string): GridCell | null {
  const [xs, ys] = key.split(",");
  const x = Number(xs);
  const y = Number(ys);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/**
 * The invalid selection lives inside EditorState as an "escape hatch"
 * (because invalid-cells are a Set and not part of the PlacedComponent array).
 * We guard reads because `placeMode/selectedInvalidCellKey` were added later
 * and may not exist in older persisted states.
 */
function getSelectedInvalidKeyFromState(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  if (!("selectedInvalidCellKey" in state)) return null;

  const v = (state as { selectedInvalidCellKey?: unknown })
    .selectedInvalidCellKey;
  return typeof v === "string" ? v : null;
}

/**
 * CanvasStage
 *
 * The main interactive canvas:
 * - Renders a grid representing the room ceiling
 * - Renders placed components + invalid cells
 * - Handles pointer interactions (pan, select/drag, place, erase)
 * - Handles wheel zoom around pointer position
 *
 * Performance approach:
 * - Uses refs for `state` and `camera` to avoid re-binding event handlers on every render.
 * - Drawing is imperative: `draw()` paints based on the latest refs.
 * - A lightweight `redrawTick` triggers redraws when relevant state changes.
 */
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
    setState, // stores selectedInvalidCellKey + other extended state
  } = useEditorState();

  // "Mirror" refs that event handlers can safely read without stale closures.
  const cameraRef = useRef<Camera>(state.camera);
  const stateRef = useRef(state);

  /**
   * Hover state is managed outside React state to avoid re-rendering on every pointer move.
   * We only trigger a draw when hover target changes.
   */
  const hoverRef = useRef<{
    isOverSelectable: boolean; // component OR invalid cell
    hoveredComponentId: string | null;
    hoveredCell: GridCell | null;
    hoveredInvalidKey: string | null;
  }>({
    isOverSelectable: false,
    hoveredComponentId: null,
    hoveredCell: null,
    hoveredInvalidKey: null,
  });

  // PAN tool drag state.
  const isPanningRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  // Dragging a component (SELECT tool).
  const dragRef = useRef<{
    componentId: string;
    hoverCell: GridCell;
    pointerId: number;
  } | null>(null);

  // Dragging an invalid cell (SELECT tool).
  const invalidDragRef = useRef<{
    fromKey: string; // original "x,y"
    hoverCell: GridCell;
    pointerId: number;
  } | null>(null);

  // draw() is assigned once and called from multiple effects/handlers.
  const drawRef = useRef<(() => void) | null>(null);

  // Resize/viewport tracking (throttled through RAF).
  const lastViewportRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const rafViewportRef = useRef<number | null>(null);

  /**
   * Redraw trigger:
   * We intentionally track only the fields that affect the canvas rendering.
   * If a state update changes something unrelated, it shouldn't force a repaint.
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

  // Keep refs updated for event handlers.
  useEffect(() => {
    cameraRef.current = state.camera;
  }, [state.camera]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /**
   * When the tool changes, cancel any active interaction state.
   * This prevents "stuck dragging" or panning when switching tools mid-action.
   */
  useEffect(() => {
    isPanningRef.current = false;
    lastPointerRef.current = null;
    dragRef.current = null;
    invalidDragRef.current = null;
  }, [state.tool]);

  /**
   * Main canvas setup:
   * - ResizeObserver: keeps canvas pixel size in sync with CSS size
   * - Pointer events: all primary interactions
   * - Wheel: zoom around mouse pointer
   */
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
     * Resize canvas internal resolution to match the element size.
     * Then redraw.
     *
     * Note: We batch viewport state updates via RAF to avoid spamming state
     * during continuous resize.
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

    /**
     * Convert a pointer/wheel event into coordinates relative to the canvas.
     */
    const getCanvasPoint = (e: PointerEvent | WheelEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    /**
     * Convert a pointer/wheel event into a grid cell (world space -> cell space).
     */
    const getCellFromPointer = (e: PointerEvent | WheelEvent) => {
      const pt = getCanvasPoint(e);
      const world = canvasToWorld(pt, cameraRef.current);
      return worldToCell(world, cellSize);
    };

    /**
     * Persist the camera ref into state.
     * We store camera in state so other UI (ZoomControl) stays in sync.
     */
    const commitCameraToState = () => {
      const next = cameraRef.current;
      setCamera(() => next);
    };

    // Cell utility checks based on latest state ref.
    const isCellInvalid = (cell: GridCell) =>
      stateRef.current.invalidCells.has(cellKey(cell));

    const isCellOccupiedByOther = (cell: GridCell, movingId: string) =>
      stateRef.current.components.some(
        (c) => c.id !== movingId && cellEquals(c.cell, cell)
      );

    const isCellOccupied = (cell: GridCell) =>
      stateRef.current.components.some((c) => cellEquals(c.cell, cell));

    /**
     * Drop validation for components:
     * - must be within grid
     * - cannot drop on invalid cell
     * - cannot collide with a different component
     */
    const canDropOnCell = (cell: GridCell, movingId: string) => {
      if (!isWithinGrid(cell, stateRef.current.grid)) return false;
      if (isCellInvalid(cell)) return false;
      if (isCellOccupiedByOther(cell, movingId)) return false;
      return true;
    };

    /**
     * Drop validation for invalid cells (when dragging them in SELECT):
     * - must be within grid
     * - cannot land on another invalid cell (unless it's the original key)
     * - CAN land on a component (we remove the component on drop)
     */
    const canDropInvalidOnCell = (toCell: GridCell, fromKey: string) => {
      if (!isWithinGrid(toCell, stateRef.current.grid)) return false;

      const toKey = cellKey(toCell);

      // Allow dropping back on itself.
      if (toKey !== fromKey && stateRef.current.invalidCells.has(toKey)) {
        return false;
      }

      // Allow landing on a component (replacement behavior).
      return true;
    };

    /**
     * Cursor feedback is a big part of editor UX.
     * We compute it imperatively (based on refs) so it updates instantly.
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

      // ERASE and any fallback modes.
      canvas.style.cursor = "crosshair";
    };

    /**
     * Draw a ghosted invalid cell while dragging it.
     * We add a green/red outline to indicate whether dropping is allowed.
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
     * draw()
     * The single rendering function that paints the entire scene from scratch.
     *
     * Structure:
     * 1) Clear background
     * 2) Apply camera transform
     * 3) Draw visible grid + outline
     * 4) Draw invalid cells (with selection)
     * 5) Draw components (excluding the one being dragged)
     * 6) Draw drag ghosts + drop outlines
     * 7) Draw hover label
     */
    const draw = () => {
      const s = stateRef.current;
      const { panX, panY, zoom } = cameraRef.current;

      const autoNameById = buildAutoNameMap(s.components);
      const selectedInvalidKey = getSelectedInvalidKeyFromState(s);

      // Clear + background.
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f5f5f5";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Apply camera transform.
      ctx.save();
      ctx.translate(panX, panY);
      ctx.scale(zoom, zoom);

      // Only draw visible region for performance on huge grids.
      const { minX, minY, maxX, maxY } = getVisibleCellBounds({
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        camera: cameraRef.current,
        grid: s.grid,
        cellSize,
      });

      // Grid lines.
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

      // Outer grid outline (helps users understand bounds).
      ctx.strokeStyle = "#999";
      ctx.lineWidth = 2 / zoom;
      ctx.strokeRect(0, 0, s.grid.cols * cellSize, s.grid.rows * cellSize);

      // Invalid cells (rendered as translucent red blocks).
      if (s.invalidCells.size > 0) {
        ctx.fillStyle = "rgba(239, 68, 68, 0.12)";

        const invalidDragging = invalidDragRef.current;

        for (const key of s.invalidCells) {
          // While dragging an invalid cell, hide its original position.
          if (invalidDragging && key === invalidDragging.fromKey) continue;

          const parsed = parseKey(key);
          if (!parsed) continue;

          const { x, y } = parsed;
          if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
            ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
          }
        }

        // Selected invalid cell gets a thicker border.
        if (selectedInvalidKey && s.invalidCells.has(selectedInvalidKey)) {
          const parsed = parseKey(selectedInvalidKey);
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

      // Components (skip the one being dragged).
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

      // Component drag ghost + drop feedback.
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

      // Invalid cell drag ghost + drop feedback.
      const invalidDragging = invalidDragRef.current;
      if (invalidDragging) {
        const ok = canDropInvalidOnCell(
          invalidDragging.hoverCell,
          invalidDragging.fromKey
        );
        drawInvalidGhost(invalidDragging.hoverCell, ok);
      }

      // Hover labels (component label or "Invalid").
      const hoveredId = hoverRef.current.hoveredComponentId;
      const hoveredCell = hoverRef.current.hoveredCell;

      if (hoveredId) {
        const comp = s.components.find((c) => c.id === hoveredId);
        if (comp) {
          const label =
            (comp as { label?: string }).label?.trim() ||
            autoNameById.get(comp.id) ||
            "Item";

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
     * If an invalid cell is selected but later removed, clear the selection.
     * This prevents UI referencing stale invalid keys.
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

    const beginComponentDrag = (
      pointerId: number,
      componentId: string,
      cell: GridCell
    ) => {
      dragRef.current = { componentId, hoverCell: cell, pointerId };
      invalidDragRef.current = null;
      canvas.setPointerCapture(pointerId);
    };

    const beginInvalidDrag = (
      pointerId: number,
      fromKey: string,
      cell: GridCell
    ) => {
      invalidDragRef.current = { fromKey, hoverCell: cell, pointerId };
      dragRef.current = null;
      canvas.setPointerCapture(pointerId);
    };

    /**
     * Pointer down:
     * - PAN: start panning
     * - SELECT: select + begin dragging components/invalid cells
     * - PLACE: place components OR toggle invalid cells
     * - ERASE: delete components or invalid cells
     */
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
        // Select + drag a component if present.
        const idx = findComponentIndexAtCell(s.components, cell);
        if (idx !== -1) {
          const comp = s.components[idx];

          setState((prev) => ({ ...prev, selectedInvalidCellKey: null }));
          setSelectedComponentId(comp.id);

          beginComponentDrag(e.pointerId, comp.id, comp.cell);
          draw();
          return;
        }

        // Select + drag invalid cell if present.
        if (isWithinGrid(cell, s.grid) && isCellInvalid(cell)) {
          const k = cellKey(cell);

          setSelectedComponentId(null);
          setState((prev) => ({ ...prev, selectedInvalidCellKey: k }));

          beginInvalidDrag(e.pointerId, k, cell);
          draw();
          return;
        }

        // Clicked empty space => clear selection.
        setSelectedComponentId(null);
        setState((prev) => ({ ...prev, selectedInvalidCellKey: null }));
        draw();
        return;
      }

      // From here on, PLACE / ERASE only act within the grid.
      if (!isWithinGrid(cell, s.grid)) return;

      if (s.tool === "PLACE") {
        // Place invalid cells (toggle).
        if (s.placeMode === "INVALID_CELL") {
          const k = cellKey(cell);
          const willBeInvalid = !s.invalidCells.has(k);

          toggleInvalidCell(cell);

          // Selecting the toggled invalid cell makes it easy to rename/delete via toolbar list.
          setSelectedComponentId(null);
          setState((prev) => ({
            ...prev,
            selectedInvalidCellKey: willBeInvalid ? k : null,
          }));

          return;
        }

        // Place a component.
        if (isCellInvalid(cell)) return;

        setState((prev) => ({ ...prev, selectedInvalidCellKey: null }));

        setComponents((prev) => {
          // Prevent duplicate placement in the same cell.
          if (findComponentIndexAtCell(prev, cell) !== -1) return prev;

          const id = crypto.randomUUID();
          return [...prev, { id, type: s.activeComponentType, cell }];
        });
        return;
      }

      if (s.tool === "ERASE") {
        // Erase a component first (if present).
        const idx2 = findComponentIndexAtCell(s.components, cell);
        if (idx2 !== -1) {
          setComponents((prev) =>
            prev.filter((c) => !cellEquals(c.cell, cell))
          );
          if (s.selectedComponentId) setSelectedComponentId(null);
          return;
        }

        // Otherwise erase invalid cell if present.
        const k = cellKey(cell);
        setInvalidCells((prev) => {
          if (!prev.has(k)) return prev;
          const next = new Set(prev);
          next.delete(k);
          return next;
        });

        const selectedInvalidKey = getSelectedInvalidKeyFromState(s);
        if (selectedInvalidKey === k) {
          setState((prev) => ({ ...prev, selectedInvalidCellKey: null }));
        }

        if (selectedInvalidKey)
          clearInvalidSelectionIfMissing(selectedInvalidKey);
      }
    };

    /**
     * Pointer move:
     * - Update hover cell
     * - If dragging, update ghost position and redraw
     * - If panning, update camera ref and redraw
     * - If selecting, compute hover target and redraw when it changes
     */
    const onPointerMove = (e: PointerEvent) => {
      const s = stateRef.current;

      hoverRef.current.hoveredCell = getCellFromPointer(e);

      // Dragging component.
      if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
        dragRef.current.hoverCell = hoverRef.current.hoveredCell;
        draw();
        return;
      }

      // Dragging invalid cell.
      if (
        invalidDragRef.current &&
        invalidDragRef.current.pointerId === e.pointerId
      ) {
        invalidDragRef.current.hoverCell = hoverRef.current.hoveredCell;
        draw();
        return;
      }

      // Panning.
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

      // Hover logic for SELECT tool (shows pointer cursor + hover label).
      if (s.tool === "SELECT") {
        const cell = hoverRef.current.hoveredCell;

        const idx = findComponentIndexAtCell(s.components, cell);
        const overComponent = idx !== -1;
        const overInvalid =
          !overComponent && isWithinGrid(cell, s.grid) && isCellInvalid(cell);

        const nextHoveredId = overComponent ? s.components[idx].id : null;
        const nextHoveredInvalidKey = overInvalid ? cellKey(cell) : null;

        const nextOverSelectable = overComponent || overInvalid;

        if (hoverRef.current.isOverSelectable !== nextOverSelectable) {
          hoverRef.current.isOverSelectable = nextOverSelectable;
          updateCursor();
        }

        const changed =
          hoverRef.current.hoveredComponentId !== nextHoveredId ||
          hoverRef.current.hoveredInvalidKey !== nextHoveredInvalidKey;

        if (changed) {
          hoverRef.current.hoveredComponentId = nextHoveredId;
          hoverRef.current.hoveredInvalidKey = nextHoveredInvalidKey;
          draw();
        }

        return;
      }

      // PLACE/ERASE cursor updates are simple and don't require full redraw.
      if (s.tool === "PLACE") updateCursor();

      // If we had hover state from SELECT and tool changed, clear it.
      if (
        hoverRef.current.hoveredComponentId ||
        hoverRef.current.hoveredInvalidKey
      ) {
        hoverRef.current.hoveredComponentId = null;
        hoverRef.current.hoveredInvalidKey = null;
        draw();
      }
    };

    /**
     * Component drag drop:
     * - If valid, update component cell
     * - Clear drag state and redraw
     *
     * Note:
     * We also register window-level pointerup handlers (below) so the drop
     * is committed even if the pointer is released outside the canvas.
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

        // Keep the local mirror ref in sync to avoid one-frame inconsistencies.
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
     * Invalid cell drag drop:
     * - Moves invalid cell from fromKey -> toKey
     * - If dropped onto a component cell, removes that component (replacement behavior)
     * - Keeps invalid selection focused on new position
     */
    const finalizeInvalidDrag = (e: PointerEvent) => {
      const drag = invalidDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;

      const dropCell = getCellFromPointer(e);
      drag.hoverCell = dropCell;

      const s = stateRef.current;

      const fromKey = drag.fromKey;
      const toKey = cellKey(dropCell);

      if (canDropInvalidOnCell(dropCell, fromKey)) {
        const nextInvalid = new Set(s.invalidCells);
        nextInvalid.delete(fromKey);
        nextInvalid.add(toKey);

        // Replacement behavior: invalid cell can land on components (component removed).
        const nextComponents = s.components.filter(
          (c) => !cellEquals(c.cell, dropCell)
        );

        setInvalidCells(() => nextInvalid);
        setComponents(() => nextComponents);

        setSelectedComponentId(null);
        setState((prev) => ({ ...prev, selectedInvalidCellKey: toKey }));

        // Mirror ref update so subsequent handlers read the updated sets immediately.
        stateRef.current = {
          ...s,
          invalidCells: nextInvalid,
          components: nextComponents,
          selectedComponentId: null,
        };
      } else {
        // Invalid drop => keep selection on original cell.
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

    /**
     * Pointer up:
     * - If dragging, finalize drop
     * - If panning, commit camera to state
     */
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
     * Wheel zoom:
     * - Zooms in/out around the mouse pointer (not center)
     * - Commits camera immediately so other UI stays synced
     */
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      const { x: cx, y: cy } = getCanvasPoint(e);
      const camera = cameraRef.current;

      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const nextZoom = clampZoom(camera.zoom * zoomFactor);

      // World point under cursor BEFORE zoom.
      const worldX = (cx - camera.panX) / camera.zoom;
      const worldY = (cy - camera.panY) / camera.zoom;

      // Adjust pan so cursor stays anchored to the same world point AFTER zoom.
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

    // Watch for layout size changes.
    const ro = new ResizeObserver(() => {
      resizeCanvasToClient();
    });
    ro.observe(canvas);

    // Initial sizing + draw.
    resizeCanvasToClient();

    // Canvas event listeners.
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    /**
     * Window-level finalize handlers:
     * These ensure drop commits even if pointerup happens outside the canvas.
     * This also fixes common "drop doesn't happen until I move the cursor" issues.
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

  // Redraw whenever relevant editor state changes.
  useEffect(() => {
    drawRef.current?.();
  }, [redrawTick]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        // Disable browser gestures (panning/zooming) so pointer events behave predictably.
        touchAction: "none",
      }}
    />
  );
}
