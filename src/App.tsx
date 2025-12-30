// src/App.tsx
import { useCallback, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { Navbar } from "./ui/Navbar";
import { EditorPage } from "./pages/EditorPage";
import { AboutPage } from "./pages/AboutPage";
import { SavedLayoutsPage } from "./pages/SavedLayoutsPage";

/**
 * Top-level application shell.
 *
 * Responsibilities:
 * - Own shared UI state that spans pages (e.g., whether the sidebar/toolbar is open).
 * - Render the global layout (Navbar + page content area).
 * - Define the app routes (Editor, Saved layouts list, About).
 *
 * Notes:
 * - We keep the sidebar open/closed state here so it persists while navigating
 *   between routes, and so Navbar + EditorPage stay in sync.
 * - `EditorPage` is used for both the "new layout" editor ("/") and the
 *   "edit saved layout" editor ("/saved/:id"). The page decides what to load
 *   based on the presence of `:id`.
 */
function App() {
  // Whether the editor sidebar/toolbar is currently visible.
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  /**
   * Toggle handler passed down to Navbar and EditorPage.
   * `useCallback` prevents unnecessary rerenders in children that
   * memoize props or rely on referential equality.
   */
  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => !prev);
  }, []);

  /**
   * The EditorPage element is reused for multiple routes.
   * Creating it once avoids duplicating the same JSX across routes.
   */
  const editorPageEl = useMemo(
    () => (
      <EditorPage isSidebarOpen={isSidebarOpen} toggleSidebar={toggleSidebar} />
    ),
    [isSidebarOpen, toggleSidebar]
  );

  return (
    /**
     * App layout uses simple class-based styling instead of large inline objects:
     * - Keeps layout rules consistent and easier to maintain
     * - Avoids style duplication across files as the UI grows
     * - Makes theme/layout adjustments low-risk (single place to change)
     */
    <div className="appShell">
      {/* Keeping Navbar outside <Routes> ensures it never unmounts during navigation. */}
      <Navbar isSidebarOpen={isSidebarOpen} onToggleSidebar={toggleSidebar} />

      {/* `minHeight: 0` via CSS is important for flex children to shrink correctly. */}
      <div className="appContent">
        <Routes>
          {/* Editor (new/empty layout). */}
          <Route path="/" element={editorPageEl} />

          {/* Saved layouts list page (view, rename, open). */}
          <Route path="/saved" element={<SavedLayoutsPage />} />

          {/* Editor for a specific saved layout. */}
          <Route path="/saved/:id" element={editorPageEl} />

          {/* Take-home documentation page: controls, assumptions, scalability notes, etc. */}
          <Route path="/about" element={<AboutPage />} />

          {/* Redirect unknown routes back to the editor home. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default App;
