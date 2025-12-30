// src/ui/Navbar.tsx
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
   * NavLink provides `isActive`, which we map to a CSS class so the Navbar
   * is styled entirely via index.css (no inline styles needed).
   */
  const getNavLinkClass = ({ isActive }: { isActive: boolean }) =>
    `navBarLink${isActive ? " navBarLinkActive" : ""}`;

  return (
    <header className="navBar">
      <div className="navBarLeft">
        {isEditorRoute && !isSidebarOpen ? (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="navBarIconButton"
            aria-label="Open toolbar"
            title="Open toolbar"
          >
            <MenuIcon size={18} />
          </button>
        ) : null}

        <div className="navBarTitleBlock">
          <div className="navBarTitle">Ceiling Editor</div>

          {isEditorRoute ? (
            <div
              className="navBarPill"
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

        <nav className="navBarNav">
          <NavLink to="/" end className={getNavLinkClass}>
            New
          </NavLink>

          <NavLink to="/saved" className={getNavLinkClass}>
            Saved Layouts
          </NavLink>

          <NavLink to="/about" className={getNavLinkClass}>
            About
          </NavLink>
        </nav>
      </div>

      <div className="navBarAuthor">
        Author: <span className="navBarAuthorName">Allwin James Andrews</span>
      </div>
    </header>
  );
}
