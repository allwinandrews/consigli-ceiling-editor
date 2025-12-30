// src/pages/EditorPage.tsx
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { CanvasStage } from "../canvas/CanvasStage";
import { Toolbar } from "../ui/Toolbar";
import { ZoomControl } from "../ui/ZoomControl";
import { useEditorState } from "../state/useEditorState";

/**
 * Fixed sidebar width keeps the canvas area predictable and avoids layout reflow.
 * The sidebar is animated using transforms rather than changing flex layout.
 */
const SIDEBAR_WIDTH = 320;

/**
 * EditorPage
 *
 * Responsibilities:
 * - Render the main editor layout (Toolbar sidebar + Canvas + Zoom).
 * - Load layouts based on the URL:
 *    - "/"           => fresh editor state (no selected saved layout)
 *    - "/saved/:id"  => load the saved layout by id
 * - Save behavior matches the route:
 *    - "/"           => save as new layout and navigate to "/saved/:id"
 *    - "/saved/:id"  => overwrite that layout
 *
 * Architectural note:
 * - The URL is the source of truth for which saved layout is selected.
 * - The state layer manages editor data; the page orchestrates route behavior.
 */
export function EditorPage({
  isSidebarOpen,
  toggleSidebar,
}: {
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const params = useParams<{ id?: string }>();

  /**
   * Provider API:
   * - state: current editor data (grid, components, camera, tool, etc.)
   * - savedLayouts: persisted snapshots list
   * - openLayout: load a saved snapshot into the editor
   * - saveLayout: persist current editor state (new or overwrite)
   * - clearSelectedLayout: ensures "/" behaves as a fresh editor
   */
  const { state, savedLayouts, openLayout, saveLayout, clearSelectedLayout } =
    useEditorState();

  // Route interpretation -------------------------------------------------------

  const isRootRoute = pathname === "/";

  const routeLayoutId =
    typeof params.id === "string" && params.id.trim().length > 0
      ? params.id
      : null;

  // Sidebar styling ------------------------------------------------------------

  /**
   * Sidebar stays mounted to preserve internal toolbar UI state.
   * Only the open/close behavior is dynamic (transform + pointer-events).
   */
  const sidebarDynamicStyle = useMemo(() => {
    return {
      transform: isSidebarOpen
        ? "translateX(0)"
        : `translateX(-${SIDEBAR_WIDTH}px)`,
      pointerEvents: isSidebarOpen ? "auto" : "none",
    } as const;
  }, [isSidebarOpen]);

  // Save eligibility -----------------------------------------------------------

  /**
   * Only enable saving when there is something meaningful to persist.
   * This avoids creating empty layouts in the saved list.
   */
  const canSaveLayout = useMemo(() => {
    return state.components.length + state.invalidCells.size > 0;
  }, [state.components.length, state.invalidCells]);

  // Route-driven loading (avoid effect loops) ---------------------------------

  /**
   * Keep latest savedLayouts in a ref so the route effect does not depend on it.
   * This avoids loops where open/save updates savedLayouts and re-triggers the effect.
   */
  const savedLayoutsRef = useRef(savedLayouts);
  useEffect(() => {
    savedLayoutsRef.current = savedLayouts;
  }, [savedLayouts]);

  /**
   * Guard: prevents repeatedly re-opening the same layout on rerenders.
   */
  const lastOpenedIdRef = useRef<string | null>(null);

  /**
   * Route-driven state loading:
   * - "/"            => clear selected layout
   * - "/saved/:id"   => validate id exists, then open it
   *                   if missing: redirect back to "/saved"
   *
   * This effect intentionally does not depend on `savedLayouts` or `state`.
   */
  useEffect(() => {
    if (isRootRoute) {
      lastOpenedIdRef.current = null;
      clearSelectedLayout();
      return;
    }

    if (!routeLayoutId) return;

    if (lastOpenedIdRef.current === routeLayoutId) return;

    const exists = savedLayoutsRef.current.some((l) => l.id === routeLayoutId);
    if (!exists) {
      lastOpenedIdRef.current = null;
      clearSelectedLayout();
      navigate("/saved", { replace: true });
      return;
    }

    lastOpenedIdRef.current = routeLayoutId;
    openLayout(routeLayoutId);
  }, [isRootRoute, routeLayoutId, openLayout, clearSelectedLayout, navigate]);

  // Save behavior --------------------------------------------------------------

  /**
   * Save behavior matches the route:
   * - "/": create a new id and navigate to "/saved/:id"
   * - "/saved/:id": overwrite that id
   */
  const handleSaveLayout = useCallback(() => {
    if (!canSaveLayout) return;

    if (routeLayoutId) {
      saveLayout({ id: routeLayoutId });
      lastOpenedIdRef.current = routeLayoutId;
      return;
    }

    const newId = saveLayout();
    lastOpenedIdRef.current = newId;
    navigate(`/saved/${encodeURIComponent(newId)}`, { replace: true });
  }, [canSaveLayout, routeLayoutId, saveLayout, navigate]);

  // Render ---------------------------------------------------------------------

  return (
    <div className="editorRoot">
      <aside className="editorSidebar" style={sidebarDynamicStyle}>
        <Toolbar
          onToggleSidebar={toggleSidebar}
          onSaveLayout={handleSaveLayout}
          canSaveLayout={canSaveLayout}
        />
      </aside>

      <main className="editorMain">
        <CanvasStage />
        <ZoomControl />
      </main>
    </div>
  );
}
