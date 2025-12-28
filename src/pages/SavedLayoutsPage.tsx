// src/pages/SavedLayoutsPage.tsx
import { useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useEditorState } from "../state/useEditorState";

/**
 * Formats a unix timestamp (ms) into a readable local time string.
 * This is intentionally simple for the take-home (no external date libraries).
 */
function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString();
}

/**
 * SavedLayoutsPage
 *
 * A management screen for persisted layouts stored in localStorage (via EditorProvider).
 * Users can:
 * - Open a layout (navigates to /saved/:id)
 * - Rename a layout (unique name validation)
 * - Delete a layout
 * - Start a new empty layout (navigates to "/" and clears selected layout)
 *
 * Important architecture decision:
 * - This page does NOT call openLayout() directly.
 *   The URL is the source of truth; EditorPage loads the layout based on route params.
 *   This avoids double-loading and keeps navigation predictable.
 */
export function SavedLayoutsPage() {
  const navigate = useNavigate();

  const { savedLayouts, renameLayout, deleteLayout, clearSelectedLayout } =
    useEditorState();

  // Inline rename UI state (only one row can be renamed at a time).
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Layout/styling kept inline to make the take-home easy to review.
  const pageStyle: CSSProperties = {
    height: "100%",
    padding: 16,
    boxSizing: "border-box",
    overflow: "auto",
  };

  const headerRow: CSSProperties = {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  };

  const titleStyle: CSSProperties = {
    fontSize: 18,
    fontWeight: 900,
    color: "#111827",
  };

  const subStyle: CSSProperties = {
    marginTop: 6,
    fontSize: 12,
    color: "#6b7280",
  };

  const btn: CSSProperties = {
    height: 36,
    padding: "0 12px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    color: "#111827",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    whiteSpace: "nowrap",
  };

  const btnPrimary: CSSProperties = {
    ...btn,
    background: "#111827",
    borderColor: "#111827",
    color: "#ffffff",
  };

  const card: CSSProperties = {
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    borderRadius: 14,
    padding: 12,
  };

  const listWrap: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginTop: 12,
  };

  /**
   * Begin rename mode for a specific layout.
   * We prefill draft with the current name for a smoother experience.
   */
  const startRename = (id: string, currentName: string) => {
    setError(null);
    setRenamingId(id);
    setRenameDraft(currentName);
  };

  /**
   * Exit rename mode and clear temporary UI state.
   */
  const cancelRename = () => {
    setRenamingId(null);
    setRenameDraft("");
    setError(null);
  };

  /**
   * Validate and persist the new layout name.
   * Constraints:
   * - name is required (non-empty after trim)
   * - name must be unique across layouts (case-insensitive)
   */
  const commitRename = (id: string) => {
    const nextName = renameDraft.trim();

    if (nextName.length === 0) {
      setError("Name cannot be empty.");
      return;
    }

    const nameTaken = savedLayouts.some(
      (l) =>
        l.id !== id && l.name.trim().toLowerCase() === nextName.toLowerCase()
    );

    if (nameTaken) {
      setError("A layout with this name already exists.");
      return;
    }

    renameLayout(id, nextName);
    setRenamingId(null);
    setRenameDraft("");
    setError(null);
  };

  /**
   * Delete flow uses a confirm prompt to prevent accidental loss.
   * If the currently-renamed layout is deleted, we also exit rename mode.
   */
  const onDelete = (id: string) => {
    const layout = savedLayouts.find((l) => l.id === id);
    const ok = window.confirm(`Delete "${layout?.name ?? "this layout"}"?`);
    if (!ok) return;

    // If user deletes the one currently open elsewhere, provider can clear selection if needed.
    deleteLayout(id);

    if (renamingId === id) cancelRename();
  };

  /**
   * Open a saved layout by navigating to /saved/:id.
   * EditorPage will read the route param and load it.
   */
  const onOpen = (id: string) => {
    navigate(`/saved/${encodeURIComponent(id)}`, { replace: false });
  };

  /**
   * Navigate to a clean empty editor state.
   * This also clears any "selected" layout id persisted by the provider.
   */
  const startNewEmpty = () => {
    clearSelectedLayout();
    navigate("/", { replace: false });
  };

  return (
    <div style={pageStyle}>
      <div style={headerRow}>
        <div style={{ minWidth: 0 }}>
          <div style={titleStyle}>Saved Layouts</div>
          <div style={subStyle}>
            Open navigates to /saved/:id. Rename and Delete manage saved
            entries.
          </div>
        </div>

        <div style={{ display: "inline-flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={startNewEmpty}
            style={btn}
            title="Go to empty editor"
          >
            New empty
          </button>
        </div>
      </div>

      <div style={listWrap}>
        {error ? (
          <div
            style={{
              ...card,
              borderColor: "#fecaca",
              background: "#fff1f2",
              color: "#991b1b",
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 12 }}>Rename error</div>
            <div style={{ marginTop: 6, fontSize: 12 }}>{error}</div>
          </div>
        ) : null}

        {savedLayouts.length === 0 ? (
          <div style={card}>
            <div style={{ fontSize: 14, fontWeight: 900, color: "#111827" }}>
              No saved layouts yet
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
              Go to the editor and click Save to create your first layout.
            </div>
          </div>
        ) : (
          savedLayouts.map((l) => {
            const isRenaming = renamingId === l.id;

            return (
              <div key={l.id} style={card}>
                <div
                  style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {!isRenaming ? (
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 900,
                          color: "#111827",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={l.name}
                      >
                        {l.name}
                      </div>
                    ) : (
                      <input
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        style={{
                          width: "100%",
                          height: 36,
                          padding: "0 12px",
                          borderRadius: 12,
                          border: "1px solid #e5e7eb",
                          outline: "none",
                          fontSize: 13,
                          fontWeight: 900,
                          color: "#111827",
                          boxSizing: "border-box",
                        }}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(l.id);
                          if (e.key === "Escape") cancelRename();
                        }}
                        aria-label="Rename layout"
                      />
                    )}

                    <div
                      style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}
                    >
                      Updated:{" "}
                      <strong style={{ color: "#111827" }}>
                        {formatDate(l.updatedAt)}
                      </strong>
                      {" · "}
                      Created:{" "}
                      <strong style={{ color: "#111827" }}>
                        {formatDate(l.createdAt)}
                      </strong>
                    </div>
                  </div>

                  {!isRenaming ? (
                    <div
                      style={{
                        display: "inline-flex",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        type="button"
                        style={btnPrimary}
                        onClick={() => onOpen(l.id)}
                        title="Open this layout"
                      >
                        Open
                      </button>

                      <button
                        type="button"
                        style={btn}
                        onClick={() => startRename(l.id, l.name)}
                        title="Rename"
                      >
                        Rename
                      </button>

                      <button
                        type="button"
                        style={btn}
                        onClick={() => onDelete(l.id)}
                        title="Delete"
                      >
                        Delete
                      </button>
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "inline-flex",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        type="button"
                        style={btnPrimary}
                        onClick={() => commitRename(l.id)}
                        title="Save new name"
                      >
                        Save
                      </button>

                      <button
                        type="button"
                        style={btn}
                        onClick={cancelRename}
                        title="Cancel rename"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
