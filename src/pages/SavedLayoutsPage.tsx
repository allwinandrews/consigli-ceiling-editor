// src/pages/SavedLayoutsPage.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEditorState } from "../state/useEditorState";

/**
 * Formats a unix timestamp (ms) into a readable local time string.
 * Intentionally simple for the take-home (no external date libraries).
 */
function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString();
}

/**
 * SavedLayoutsPage
 *
 * Management screen for layouts stored in localStorage (via EditorProvider).
 * Users can:
 * - Open a layout (navigates to /saved/:id)
 * - Rename a layout (unique name validation)
 * - Delete a layout
 * - Start a new empty layout (navigates to "/" and clears selected layout)
 *
 * Architecture note:
 * - This page does not call openLayout() directly.
 *   The URL is the source of truth; EditorPage loads the layout from route params.
 */
export function SavedLayoutsPage() {
  const navigate = useNavigate();

  const { savedLayouts, renameLayout, deleteLayout, clearSelectedLayout } =
    useEditorState();

  // Inline rename UI state (only one row can be renamed at a time).
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  /**
   * Begin rename mode for a specific layout.
   * Prefills the draft with the current name.
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
   * - Required (non-empty after trim)
   * - Unique across layouts (case-insensitive)
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
   * If the currently-renamed layout is deleted, also exit rename mode.
   */
  const onDelete = (id: string) => {
    const layout = savedLayouts.find((l) => l.id === id);
    const ok = window.confirm(`Delete "${layout?.name ?? "this layout"}"?`);
    if (!ok) return;

    deleteLayout(id);

    if (renamingId === id) cancelRename();
  };

  /**
   * Open a saved layout by navigating to /saved/:id.
   * EditorPage reads the route param and loads it.
   */
  const onOpen = (id: string) => {
    navigate(`/saved/${encodeURIComponent(id)}`, { replace: false });
  };

  /**
   * Navigate to a clean empty editor state and clear any selected layout id.
   */
  const startNewEmpty = () => {
    clearSelectedLayout();
    navigate("/", { replace: false });
  };

  return (
    <div className="savedPage">
      <div className="savedHeaderRow">
        <div className="savedHeaderLeft">
          <div className="savedTitle">Saved Layouts</div>
          <div className="savedSub">
            Open navigates to /saved/:id. Rename and Delete manage saved
            entries.
          </div>
        </div>

        <div className="savedHeaderActions">
          <button
            type="button"
            onClick={startNewEmpty}
            className="savedBtn"
            title="Go to empty editor"
          >
            New empty
          </button>
        </div>
      </div>

      <div className="savedListWrap">
        {error ? (
          <div className="savedCard savedErrorCard">
            <div className="savedErrorTitle">Rename error</div>
            <div className="savedErrorText">{error}</div>
          </div>
        ) : null}

        {savedLayouts.length === 0 ? (
          <div className="savedCard">
            <div className="savedEmptyTitle">No saved layouts yet</div>
            <div className="savedEmptySub">
              Go to the editor and click Save to create your first layout.
            </div>
          </div>
        ) : (
          savedLayouts.map((l) => {
            const isRenaming = renamingId === l.id;

            return (
              <div key={l.id} className="savedCard">
                <div className="savedRow">
                  <div className="savedRowLeft">
                    {!isRenaming ? (
                      <div className="savedLayoutName" title={l.name}>
                        {l.name}
                      </div>
                    ) : (
                      <input
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        className="savedRenameInput"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(l.id);
                          if (e.key === "Escape") cancelRename();
                        }}
                        aria-label="Rename layout"
                      />
                    )}

                    <div className="savedMeta">
                      Updated:{" "}
                      <strong className="savedMetaStrong">
                        {formatDate(l.updatedAt)}
                      </strong>
                      {" · "}
                      Created:{" "}
                      <strong className="savedMetaStrong">
                        {formatDate(l.createdAt)}
                      </strong>
                    </div>
                  </div>

                  {!isRenaming ? (
                    <div className="savedRowActions">
                      <button
                        type="button"
                        className="savedBtn savedBtnPrimary"
                        onClick={() => onOpen(l.id)}
                        title="Open this layout"
                      >
                        Open
                      </button>

                      <button
                        type="button"
                        className="savedBtn"
                        onClick={() => startRename(l.id, l.name)}
                        title="Rename"
                      >
                        Rename
                      </button>

                      <button
                        type="button"
                        className="savedBtn"
                        onClick={() => onDelete(l.id)}
                        title="Delete"
                      >
                        Delete
                      </button>
                    </div>
                  ) : (
                    <div className="savedRowActions">
                      <button
                        type="button"
                        className="savedBtn savedBtnPrimary"
                        onClick={() => commitRename(l.id)}
                        title="Save new name"
                      >
                        Save
                      </button>

                      <button
                        type="button"
                        className="savedBtn"
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
