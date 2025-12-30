// src/ui/ZoomControl.tsx
import { useState } from "react";
import { useEditorState } from "../state/useEditorState";

/**
 * Zoom constraints.
 * The canvas supports large grids, so we allow a reasonable zoom range
 * without letting users zoom so far that the UI becomes unusable.
 */
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;

function clampZoom(z: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/**
 * Display helpers:
 * - Internal zoom uses a scalar (1 = 100%).
 * - UI shows an integer percent (e.g., 125%).
 */
function zoomToPercent(z: number) {
  return Math.round(z * 100);
}

function percentToZoom(p: number) {
  return p / 100;
}

function clampPercent(p: number) {
  // zoom clamp [0.2, 4] => percent [20, 400]
  return Math.max(20, Math.min(400, Math.round(p)));
}

/**
 * ZoomControl
 *
 * Floating UI that controls the editor camera zoom:
 * - Zoom in/out buttons (10% steps)
 * - Editable percent input (apply on blur/Enter, revert on Escape)
 * - Optional "100%" reset button (hidden when already at 100%)
 *
 * Key behavior:
 * - Zoom is applied around the viewport center so the user doesn't "lose"
 *   what they're looking at while zooming.
 */
export function ZoomControl() {
  const { state, setCamera } = useEditorState();

  /**
   * Draft text shown while the user is typing.
   * When draft is null, we display the live zoom percent from state.
   */
  const [draft, setDraft] = useState<string | null>(null);

  const livePercent = zoomToPercent(state.camera.zoom);
  const percentInput = draft ?? String(livePercent);

  /**
   * Apply zoom while keeping the same world point under the viewport center.
   *
   * Why:
   * - If we only change zoom, the content appears to drift.
   * - This "zoom around center" approach feels natural and matches common editors.
   *
   * Implementation:
   * - Convert viewport center (screen space) into world coordinates using the
   *   previous camera values.
   * - After changing zoom, compute new pan values so that world point maps back
   *   to the same viewport center.
   */
  const setZoomAtViewportCenter = (nextZoomRaw: number) => {
    const nextZoom = clampZoom(nextZoomRaw);

    // Read viewport at the moment the action occurs.
    const vw = state.viewport.width;
    const vh = state.viewport.height;

    setCamera((prevCam) => {
      // If we don't know the viewport yet, we can't preserve center.
      if (vw <= 0 || vh <= 0) return { ...prevCam, zoom: nextZoom };

      const cx = vw / 2;
      const cy = vh / 2;

      // World point under viewport center BEFORE the zoom change.
      const worldX = (cx - prevCam.panX) / prevCam.zoom;
      const worldY = (cy - prevCam.panY) / prevCam.zoom;

      // Adjust pan so the same world point stays under center AFTER the zoom change.
      const nextPanX = cx - worldX * nextZoom;
      const nextPanY = cy - worldY * nextZoom;

      return { ...prevCam, panX: nextPanX, panY: nextPanY, zoom: nextZoom };
    });
  };

  /**
   * Parse and apply a percent string.
   * Returns false if the input isn't a number (we simply ignore invalid input).
   */
  const applyPercentFromString = (raw: string) => {
    const n = Number(raw.trim());
    if (!Number.isFinite(n)) return false;

    const clamped = clampPercent(n);
    setZoomAtViewportCenter(percentToZoom(clamped));
    return true;
  };

  /**
   * Apply whatever is currently in the percent input and then exit draft mode.
   * If input is invalid, we still clear draft to revert the UI to the live value.
   */
  const applyAndClearDraft = () => {
    const ok = applyPercentFromString(percentInput);
    setDraft(null);
    return ok;
  };

  /**
   * Zoom in/out by a constant factor.
   * We clear draft so the input immediately reflects the live zoom.
   */
  const step = (direction: "in" | "out") => {
    const factor = direction === "in" ? 1.1 : 0.9;
    setDraft(null);
    setZoomAtViewportCenter(state.camera.zoom * factor);
  };

  /**
   * Reset zoom back to 100% (zoom = 1).
   */
  const reset = () => {
    setDraft(null);
    setZoomAtViewportCenter(1);
  };

  /**
   * Hide the "100%" button when we're already at 100%.
   * This avoids redundant UI and keeps the control compact.
   */
  const showReset = livePercent !== 100;

  return (
    <div className="zoomCtrl">
      {showReset ? (
        <button
          type="button"
          onClick={reset}
          className="zoomBtn zoomBtnWide"
          title="Reset zoom to 100%"
        >
          100%
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => step("out")}
        className="zoomBtn zoomBtnIcon"
        aria-label="Zoom out"
        title="Zoom out"
      >
        −
      </button>

      <div className="zoomInputWrap">
        <div className="zoomInputBox">
          <input
            value={percentInput}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => setDraft(String(livePercent))}
            onBlur={() => {
              // Apply on blur (common UI expectation for numeric inputs).
              applyAndClearDraft();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                applyAndClearDraft();
              }
              if (e.key === "Escape") {
                // Revert UI back to the live zoom value without applying changes.
                setDraft(null);
              }
            }}
            inputMode="numeric"
            className="zoomInput"
            aria-label="Zoom percent"
          />
          <span className="zoomPercent">%</span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => step("in")}
        className="zoomBtn zoomBtnIcon"
        aria-label="Zoom in"
        title="Zoom in"
      >
        +
      </button>
    </div>
  );
}
