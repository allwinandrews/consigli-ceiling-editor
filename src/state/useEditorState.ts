// src/state/useEditorState.ts
import { useContext } from "react";
import { EditorStateContext, type EditorStateApi } from "./EditorContext";

/**
 * Primary hook used by the application to access editor state and actions.
 *
 * This hook:
 * - Reads the EditorStateContext created in EditorContext.ts
 * - Guarantees that the caller is wrapped inside <EditorProvider>
 * - Exposes the full EditorStateApi (state + all editor actions)
 *
 * Why this exists:
 * - Prevents direct use of useContext(EditorStateContext) throughout the app
 * - Centralizes the safety check so mistakes fail fast and loudly
 *
 * Usage:
 *   const { state, setTool, setComponents, undo } = useEditorState();
 */
export function useEditorState(): EditorStateApi {
  const ctx = useContext(EditorStateContext);

  // If this throws, it means the hook is being used outside <EditorProvider>
  // This is a developer error and should never happen in production.
  if (!ctx) {
    throw new Error("useEditorState must be used within an EditorProvider");
  }

  return ctx;
}
