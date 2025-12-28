// src/pages/AboutPage.tsx
import type { CSSProperties } from "react";

/**
 * AboutPage
 *
 * A lightweight “project summary” screen for reviewers.
 * Keep this page simple and readable:
 * - What the project is
 * - What it supports
 * - Who built it
 *
 * This is helpful in take-home projects because it reduces guesswork for
 * anyone reviewing the UI without reading the full codebase first.
 */
export function AboutPage() {
  const card: CSSProperties = {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 16,
    maxWidth: 900,
    width: "100%",
    boxSizing: "border-box",
  };

  const h2: CSSProperties = {
    margin: 0,
    fontSize: 16,
    fontWeight: 950,
    color: "#111827",
  };

  const p: CSSProperties = {
    margin: "10px 0 0",
    fontSize: 13,
    color: "#374151",
    lineHeight: 1.55,
  };

  const list: CSSProperties = {
    margin: "10px 0 0",
    paddingLeft: 18,
    color: "#374151",
    fontSize: 13,
    lineHeight: 1.55,
  };

  return (
    <div style={{ padding: 16, display: "flex", justifyContent: "center" }}>
      <div style={card}>
        <h2 style={h2}>Project overview</h2>
        <p style={p}>
          This is a ceiling layout editor built as a take-home test. It supports
          placing and managing ceiling components on a grid, plus pan and zoom
          interactions for fast layout work.
        </p>

        <div style={{ height: 12 }} />

        <h2 style={h2}>Key features</h2>
        <ul style={list}>
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

        <div style={{ height: 12 }} />

        <h2 style={h2}>Author</h2>
        <p style={p}>Allwin James Andrews</p>
      </div>
    </div>
  );
}
