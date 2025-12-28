// src/ui/Navbar.tsx
import type { CSSProperties } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useEditorState } from "../state/useEditorState";

/**
 * Small inline SVG icon used for the "open toolbar" button.
 * Keeping it as a component avoids repeating SVG markup and makes sizing consistent.
 */
function MenuIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 7h16M4 12h16M4 17h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Navbar
 *
 * Responsibilities:
 * - Provide primary navigation between the take-home app pages:
 *   Editor, Saved Layouts, About.
 * - Expose an "open toolbar" button when the editor sidebar is hidden.
 *
 * Design note:
 * - The toolbar/sidebar only exists on editor routes ("/" and "/saved/:id").
 *   We hide the menu button elsewhere to avoid confusing users.
 */
export function Navbar({
  isSidebarOpen,
  onToggleSidebar,
}: {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const { pathname } = useLocation();

  const { selectedLayoutId, savedLayouts } = useEditorState();

  /**
   * The toolbar exists only on the Editor page routes:
   * - "/" for a new/empty layout
   * - "/saved/:id" for editing a saved layout
   */
  const isEditorRoute = pathname === "/" || pathname.startsWith("/saved/");

  const currentLayout = selectedLayoutId
    ? savedLayouts.find((l) => l.id === selectedLayoutId) ?? null
    : null;

  const currentLayoutName = currentLayout?.name ?? "Empty layout";

  /**
   * Base link style shared by all nav links.
   * We apply "active" styling through `getLinkStyle`.
   */
  const linkBase: CSSProperties = {
    padding: "8px 10px",
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 900,
    textDecoration: "none",
    border: "1px solid transparent",
    whiteSpace: "nowrap",
  };

  /**
   * React Router passes `isActive` to this style function.
   * We keep the styling logic centralized to ensure consistent active states.
   */
  const getLinkStyle = ({
    isActive,
  }: {
    isActive: boolean;
  }): CSSProperties => ({
    ...linkBase,
    color: isActive ? "#111827" : "#374151",
    background: isActive ? "#ffffff" : "transparent",
    borderColor: isActive ? "#e5e7eb" : "transparent",
  });

  /**
   * Shared styling for the icon button used to reopen the toolbar.
   * We prefer a button (not a div) for proper keyboard/accessibility behavior.
   */
  const iconButton: CSSProperties = {
    width: 34,
    height: 34,
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    color: "#111827",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
  };

  return (
    <header
      style={{
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 14px",
        borderBottom: "1px solid #e5e7eb",
        background: "#ffffff",
        flex: "0 0 auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {isEditorRoute && !isSidebarOpen ? (
          <button
            type="button"
            onClick={onToggleSidebar}
            style={iconButton}
            aria-label="Open toolbar"
            title="Open toolbar"
          >
            <MenuIcon size={18} />
          </button>
        ) : null}

        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <div style={{ fontWeight: 950, color: "#111827", fontSize: 14 }}>
            Ceiling Editor
          </div>

          {isEditorRoute ? (
            <div
              style={{
                fontSize: 12,
                fontWeight: 800,
                color: "#6b7280",
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
                padding: "4px 8px",
                borderRadius: 999,
                maxWidth: 260,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={
                selectedLayoutId
                  ? `${currentLayoutName} (${selectedLayoutId})`
                  : currentLayoutName
              }
            >
              {currentLayoutName}
            </div>
          ) : null}
        </div>

        <nav style={{ display: "flex", gap: 8 }}>
          <NavLink to="/" end style={getLinkStyle}>
            New
          </NavLink>

          <NavLink to="/saved" style={getLinkStyle}>
            Saved Layouts
          </NavLink>

          <NavLink to="/about" style={getLinkStyle}>
            About
          </NavLink>
        </nav>
      </div>

      <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>
        Author: <span style={{ color: "#111827" }}>Allwin James Andrews</span>
      </div>
    </header>
  );
}
