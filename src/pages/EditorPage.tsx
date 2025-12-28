// src/pages/EditorPage.tsx
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { CanvasStage } from "../canvas/CanvasStage";
import { Toolbar } from "../ui/Toolbar";
import { ZoomControl } from "../ui/ZoomControl";
import { useEditorState } from "../state/useEditorState";

/**
 * Fixed sidebar width keeps the canvas area predictable and avoids reflow jitter
 * while toggling the sidebar (we slide it using transform instead of changing layout).
 */
const SIDEBAR_WIDTH = 320;

/**
 * EditorPage
 *
 * This page is responsible for:
 * - Rendering the main editor layout (Sidebar + Canvas + Zoom controls).
 * - Handling route-driven layout loading:
 *    - "/"           => "new/empty" editor experience (no selected saved layout)
 *    - "/saved/:id"  => load a specific saved layout by id
 * - Providing "Save" behavior that matches the route:
 *    - "/"           => save as a new layout and navigate to "/saved/:id"
 *    - "/saved/:id"  => overwrite that layout (same id)
 *
 * Important architectural choice:
 * - The URL is treated as the source of truth for which layout is selected.
 * - We avoid placing route orchestration inside the state layer to keep concerns
 *   separated: the provider manages state; the page decides what to load based on URL.
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
   * The editor state API exposed by the provider.
   * - state: current grid placements, tool selection, camera, etc.
   * - savedLayouts: list of saved snapshots (for validation/open)
   * - openLayout: load a saved snapshot by id into the editor state
   * - saveLayout: persist current state as either a new snapshot or overwrite by id
   * - clearSelectedLayout: ensures "/" behaves as a fresh editor (no selected snapshot)
   */
  const { state, savedLayouts, openLayout, saveLayout, clearSelectedLayout } =
    useEditorState();

  // Route interpretation -------------------------------------------------------

  // Canonical route detection for "new/empty layout"
  const isRootRoute = pathname === "/";

  // Route param `id` (only meaningful on "/saved/:id")
  const routeLayoutId =
    typeof params.id === "string" && params.id.trim().length > 0
      ? params.id
      : null;

  // Sidebar styling ------------------------------------------------------------

  /**
   * Sidebar is "always there" in the DOM (stable layout), but visually slides
   * out of view using transform. This avoids the canvas resizing/reflowing and
   * keeps pointer coordinate mapping simpler.
   */
  const sidebarStyle: CSSProperties = useMemo(
    () => ({
      width: SIDEBAR_WIDTH,
      borderRight: "1px solid #e5e7eb",
      background: "#ffffff",
      padding: 16,
      boxSizing: "border-box",
      overflowY: "auto",
      flexShrink: 0,

      // Slide animation: move the sidebar left by its own width when closed.
      transform: isSidebarOpen
        ? "translateX(0)"
        : `translateX(-${SIDEBAR_WIDTH}px)`,
      transition: "transform 180ms ease",
      willChange: "transform",

      // When hidden, prevent it from intercepting mouse/pen events over the canvas.
      pointerEvents: isSidebarOpen ? "auto" : "none",

      // Ensure it renders above the canvas edge while sliding.
      position: "relative",
      zIndex: 2,
    }),
    [isSidebarOpen]
  );

  // Save eligibility -----------------------------------------------------------

  /**
   * Only enable saving if there's meaningful editor data to persist.
   * This prevents filling the saved list with empty layouts.
   *
   * Note:
   * - `invalidCells` is a Set, so we depend on the Set instance; this is fine because
   *   the provider should create a new Set when changes occur.
   */
  const canSaveLayout = useMemo(() => {
    return state.components.length + state.invalidCells.size > 0;
  }, [state.components.length, state.invalidCells]);

  // Route-driven loading (avoid effect loops) ---------------------------------

  /**
   * Keep the latest savedLayouts in a ref so the route effect does NOT depend on it.
   *
   * Why:
   * - Depending on `savedLayouts` inside the route effect can create loops:
   *   openLayout/saveLayout updates savedLayouts -> effect runs again -> reopens.
   * - A ref gives us the latest value without re-triggering the effect.
   */
  const savedLayoutsRef = useRef(savedLayouts);
  useEffect(() => {
    savedLayoutsRef.current = savedLayouts;
  }, [savedLayouts]);

  /**
   * Guard: prevents re-opening the same layout repeatedly if provider updates
   * cause rerenders (which is normal in React).
   */
  const lastOpenedIdRef = useRef<string | null>(null);

  /**
   * Route-driven state loading (URL is the source of truth)
   *
   * - "/"            => always clear selected layout (fresh editor behavior)
   * - "/saved/:id"   => validate id exists, then open it
   *                   if missing: redirect back to "/saved"
   *
   * Important:
   * - This effect intentionally does NOT depend on `savedLayouts` or `state`.
   *   Those are expected to change during open/save operations and would create loops.
   */
  useEffect(() => {
    // "/" should never show a previously selected saved layout.
    if (isRootRoute) {
      lastOpenedIdRef.current = null; // leaving saved route resets the guard
      clearSelectedLayout();
      return;
    }

    // Only handle "/saved/:id"
    if (!routeLayoutId) return;

    // Guard: already opened this id
    if (lastOpenedIdRef.current === routeLayoutId) return;

    // Validate existence using ref (stable dependency)
    const exists = savedLayoutsRef.current.some((l) => l.id === routeLayoutId);
    if (!exists) {
      // If the id doesn't exist, ensure we don't keep a stale selection around.
      lastOpenedIdRef.current = null;
      clearSelectedLayout();
      navigate("/saved", { replace: true });
      return;
    }

    // Open and remember
    lastOpenedIdRef.current = routeLayoutId;
    openLayout(routeLayoutId);
  }, [isRootRoute, routeLayoutId, openLayout, clearSelectedLayout, navigate]);

  // Save behavior --------------------------------------------------------------

  /**
   * Save behavior matches the route:
   * - On "/": create a NEW saved layout id and then navigate to "/saved/:id"
   * - On "/saved/:id": overwrite that SAME id
   */
  const handleSaveLayout = useCallback(() => {
    if (!canSaveLayout) return;

    // Overwrite existing saved layout (no new id)
    if (routeLayoutId) {
      saveLayout({ id: routeLayoutId });

      // Keep guard aligned so the route effect doesn't attempt to reopen.
      lastOpenedIdRef.current = routeLayoutId;
      return;
    }

    // Create new saved layout, then navigate to the canonical opened route
    const newId = saveLayout();

    // Align guard BEFORE navigation to avoid an immediate redundant open.
    lastOpenedIdRef.current = newId;

    navigate(`/saved/${encodeURIComponent(newId)}`, { replace: true });
  }, [canSaveLayout, routeLayoutId, saveLayout, navigate]);

  // Render ---------------------------------------------------------------------

  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        overflow: "hidden",
      }}
    >
      {/* Sidebar (Toolbar). Kept mounted for stable internal UI state. */}
      <aside style={sidebarStyle}>
        <Toolbar
          onToggleSidebar={toggleSidebar}
          onSaveLayout={handleSaveLayout}
          canSaveLayout={canSaveLayout}
        />
      </aside>

      {/* Main canvas area */}
      <main
        style={{
          flex: 1,
          minWidth: 0, // allows the canvas to shrink properly in flex layouts
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* The interactive grid editor canvas */}
        <CanvasStage />

        {/* Floating zoom UI (kept separate from the canvas renderer) */}
        <ZoomControl />
      </main>
    </div>
  );
}
