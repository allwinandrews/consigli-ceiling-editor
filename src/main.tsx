// src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import "./index.css";
import App from "./App";
import { EditorProvider } from "./state/EditorProvider";

/**
 * Application entry point.
 *
 * Responsibilities:
 * - Mount the React app into the single HTML root element.
 * - Enable React StrictMode (dev-only) to catch unsafe patterns early.
 * - Configure client-side routing for page navigation (Editor, About, Saved layouts).
 * - Provide the global Editor state (grid, tools, placements, history, persistence)
 *   to every component that needs to read/update it.
 */
const rootEl = document.getElementById("root");

// In Vite + React, `index.html` always contains a single root element.
// The non-null assertion is safe here because the app cannot run without it.
if (!rootEl) {
  throw new Error('Root element "#root" not found. Check index.html.');
}

createRoot(rootEl).render(
  <StrictMode>
    {/*
      BrowserRouter enables SPA navigation using the HTML5 history API.
      All pages in this take-home project are route-driven (no full reloads).
    */}
    <BrowserRouter>
      {/*
        EditorProvider exposes the editor state + actions via React Context.
        Keeping it here ensures the editor state is shared across pages
        (e.g., EditorPage and SavedLayoutsPage can both access saved layouts).
      */}
      <EditorProvider>
        <App />
      </EditorProvider>
    </BrowserRouter>
  </StrictMode>
);
