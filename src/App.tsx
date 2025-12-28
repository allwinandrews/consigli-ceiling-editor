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
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        flexDirection: "column",
        background: "#f3f4f6",
        overflow: "hidden",
      }}
    >
      {/*
        Global navigation and app-level controls.
        Keeping this outside <Routes> ensures it never unmounts during navigation.
      */}
      <Navbar isSidebarOpen={isSidebarOpen} onToggleSidebar={toggleSidebar} />

      {/*
        The content area fills the remaining height. `minHeight: 0` is important
        when using flex layouts to allow children to properly shrink and avoid
        overflow issues (especially for scrollable/canvas content).
      */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Routes>
          {/*
            Editor (new/empty layout).
            EditorPage will initialize from persisted state or defaults based on
            your state layer rules.
          */}
          <Route path="/" element={editorPageEl} />

          {/*
            Saved layouts list page (view, rename, open).
            This page does not need editor sidebar props.
          */}
          <Route path="/saved" element={<SavedLayoutsPage />} />

          {/*
            Editor for a specific saved layout.
            EditorPage reads `id` from the route params and loads the layout.
          */}
          <Route path="/saved/:id" element={editorPageEl} />

          {/*
            Take-home friendly documentation page: controls, assumptions,
            scalability notes, etc.
          */}
          <Route path="/about" element={<AboutPage />} />

          {/*
            Fallback route:
            - Redirect any unknown path back to the editor home.
            - `replace` avoids polluting browser history with invalid routes.
          */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default App;
