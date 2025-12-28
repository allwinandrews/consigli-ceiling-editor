# Consigli Ceiling Editor – Frontend Take-Home Assignment

This project is my solution to the Consigli Frontend Take-Home Test.
It implements an interactive ceiling layout editor where users can define a room grid, place components, mark invalid areas, and manage layouts using a clean, predictable UI.

The focus of this solution is clarity, correctness, performance, and UX, rather than over-engineering.

---

PROBLEM OVERVIEW

The task was to build a browser-based ceiling editor that allows users to:

- Define a room ceiling as a grid
- Place different ceiling components
- Mark invalid (blocked) grid cells
- Interact with the layout using intuitive tools
- Manage state in a predictable and user-friendly way

This solution is implemented entirely on the frontend, with persistence handled via localStorage.

---

KEY FEATURES

GRID & CANVAS

- Adjustable grid size (rows × columns)
- Fixed real-world scale: each cell represents 0.6m × 0.6m
- Efficient canvas rendering (only visible cells are drawn)
- Clear grid boundaries and immediate visual feedback

COMPONENTS

- Supported types:
  - Light
  - Air Supply
  - Air Return
  - Smoke Detector
- One component per grid cell
- Automatic naming (L1, AS1, AR1, SD1, etc.)
- Optional custom renaming with global uniqueness enforced

INVALID CELLS

- Cells can be marked as invalid (blocked areas)
- Invalid cells prevent component placement
- Invalid cells can be selected, renamed, deleted, and moved
- Replacement logic when dropping invalid cells on components

TOOLS

- PAN: Move the canvas
- SELECT: Select and drag components or invalid cells
- PLACE: Place components or mark invalid cells
- ERASE: Remove components or invalid cells
- Tool availability is context-aware and disabled when not applicable

ZOOM & CAMERA

- Zoom in, zoom out, and reset zoom
- Zoom is centered around the viewport for natural behavior
- Zoom limits enforced for usability
- Pan and zoom state kept in sync across the UI

STATUS & TOOLBAR

- Component palette with live counts
- Status panel showing:
  - All placed components
  - Invalid cells
  - Coordinates for each item
- Click-to-select from the list
- Rename and delete directly from the status panel
- Helpful tooltips and inline hints throughout the UI

UNDO SUPPORT

Undo is supported only for meaningful editor actions:

- Component placement
- Component movement
- Rename
- Delete
- Grid resize
- Invalid cell edits

Camera interactions (pan and zoom) are intentionally excluded from undo history to avoid noise.

PERSISTENCE

- Layouts are saved to localStorage
- Supported actions:
  - Save current layout
  - Rename saved layouts
  - Open existing layouts
  - Delete layouts
- Refreshing the page restores the last selected layout
- If no layout is selected, the editor starts in an empty state

---

ARCHITECTURE & DESIGN DECISIONS

STATE MANAGEMENT

- Centralized editor state using EditorProvider
- Clear separation between:
  - Editor state (grid, components, invalid cells)
  - Camera state (pan and zoom)
  - UI state (tool selection, rename drafts, filters)

CANVAS RENDERING

- Imperative rendering using the HTML Canvas API for performance
- React is used for state orchestration, not per-cell rendering
- Refs are used to avoid unnecessary re-bindings in event handlers

PERFORMANCE

- Only visible grid cells are rendered
- Drag, hover, and pan interactions do not trigger React re-renders
- Redraws occur only when relevant state changes

CODE QUALITY

- Fully typed with TypeScript
- No usage of `any`
- Defensive handling of persisted state
- Clear, descriptive comments throughout the codebase
- Review-friendly structure tailored for a take-home assignment

---

TECH STACK

- React 19
- TypeScript
- Vite
- HTML Canvas API
- React Router
- LocalStorage for persistence

No external UI libraries were used to keep behavior explicit and easy to reason about.

---

GETTING STARTED

Install dependencies:
npm install

Start development server:
npm run dev

The app will be available at:
http://localhost:5173

---

PROJECT STRUCTURE (HIGH LEVEL)

src/
canvas/ - CanvasStage (drawing and interactions)
state/ - EditorProvider, context, persistence, undo logic
ui/ - Toolbar, ZoomControl, and UI components
utils/ - Grid math and coordinate utilities
types/ - Core domain types
App.tsx - Application entry point

---

NOTES FOR REVIEWERS

- The solution prioritizes correctness and UX clarity over visual polish
- All interactions are designed to be discoverable and predictable
- The editor is robust against edge cases such as:
  - Invalid drops
  - Out-of-bounds interactions
  - Stale or corrupted persisted state
- The codebase is structured to be easily extensible, including future backend-driven layouts

---

AUTHOR

Allwin James Andrews
Full-Stack Software Engineer

GitHub:
https://github.com/allwinandrews

LinkedIn:
https://www.linkedin.com/in/allwinjandrews

Thank you for reviewing this submission.
I look forward to discussing the design decisions and trade-offs during the technical interview.
