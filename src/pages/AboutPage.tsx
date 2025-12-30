// src/pages/AboutPage.tsx

/**
 * AboutPage
 *
 * Lightweight “project summary” screen for reviewers.
 * Keeps the intent clear without requiring a deep code read:
 * - What the project is
 * - What it supports
 * - Who built it
 */
export function AboutPage() {
  return (
    <div className="aboutPage">
      <div className="aboutCard">
        <h2 className="aboutH2">Project overview</h2>
        <p className="aboutP">
          This is a ceiling layout editor built as a take-home test. It supports
          placing and managing ceiling components on a grid, plus pan and zoom
          interactions for fast layout work.
        </p>

        <div className="aboutSpacer" />

        <h2 className="aboutH2">Key features</h2>
        <ul className="aboutList">
          <li>
            Grid-based ceiling editor (each square represents 0.6m × 0.6m).
          </li>
          <li>Place / select / erase tools for components.</li>
          <li>Drag to move components and drag to pan the canvas.</li>
          <li>Zoom controls for detailed positioning.</li>
          <li>Clear toolbar with component counts and a placement list.</li>
          <li>
            Saved layouts page for opening, renaming, and deleting layouts.
          </li>
        </ul>

        <div className="aboutSpacer" />

        <h2 className="aboutH2">Author</h2>
        <p className="aboutP">Allwin James Andrews</p>
      </div>
    </div>
  );
}
