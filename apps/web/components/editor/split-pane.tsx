"use client";

import { cn } from "cn";
import {
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  clampPanelWidth,
  DEFAULT_PANEL_WIDTH_PERCENT,
  MAX_PANEL_WIDTH_PERCENT,
  MIN_PANEL_WIDTH_PERCENT,
} from "./clamp-panel-width";

/** `localStorage` key the Control Panel width is persisted under, per browser. */
const STORAGE_KEY = "vm-panel-width";
const KEYBOARD_STEP_PERCENT = 1;

/**
 * `localStorage` never changes from outside this component (no other tab
 * writes `vm-panel-width`), so the store never needs to notify React of a
 * change — this subscription is a one-shot read, not a live one.
 */
function subscribeToStoredWidth(): () => void {
  return () => {};
}

/**
 * Reads the persisted width via `useSyncExternalStore` rather than a `useState`
 * + `useEffect` pair: React renders `getServerSnapshot()` for both the server
 * render and the first client (hydration) render, so the two always match,
 * then swaps in `getSnapshot()`'s real value immediately after — the
 * "read after mount" the width must do without a hydration mismatch, with no
 * synchronous `setState` inside an effect.
 */
function getStoredWidth(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_PANEL_WIDTH_PERCENT;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampPanelWidth(parsed) : DEFAULT_PANEL_WIDTH_PERCENT;
  } catch {
    // localStorage unavailable (private mode, disabled) - keep the default.
    return DEFAULT_PANEL_WIDTH_PERCENT;
  }
}

function getServerWidth(): number {
  return DEFAULT_PANEL_WIDTH_PERCENT;
}

type SplitPaneProps = {
  /**
   * The wide pane, on the left. A render prop so the caller (the preview
   * iframe) can disable its own pointer events while dragging — an iframe is
   * a separate browsing context and can otherwise swallow the pointermove
   * events that drive the drag.
   */
  left: ReactNode | ((isDragging: boolean) => ReactNode);
  /** The narrow pane, on the right — sized to `panelWidth`%. */
  right: ReactNode;
  /** Accessible name for the drag handle. */
  separatorLabel?: string;
};

/**
 * Two panes divided by a draggable, keyboard-operable `role="separator"`
 * handle. The right pane's width is a percentage of the container, clamped to
 * [20, 30] and persisted per browser in `localStorage` (`vm-panel-width`).
 */
export function SplitPane({
  left,
  right,
  separatorLabel = "Resize Control Panel",
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const storedWidth = useSyncExternalStore(subscribeToStoredWidth, getStoredWidth, getServerWidth);
  // Once the user drags or presses a key, their choice for this render tree
  // wins over the persisted value (which `useSyncExternalStore` still reads,
  // but stops reflecting live once this is set).
  const [overrideWidth, setOverrideWidth] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const panelWidth = overrideWidth ?? storedWidth;

  const persist = useCallback((value: number) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // Best-effort only; the width still works for this session.
    }
  }, []);

  const updateWidth = useCallback(
    (next: number) => {
      const clamped = clampPanelWidth(next);
      setOverrideWidth(clamped);
      persist(clamped);
    },
    [persist],
  );

  const widthFromClientX = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    // The panel occupies the right side of the container; moving the
    // pointer left grows it, moving it right shrinks it.
    return ((rect.right - clientX) / rect.width) * 100;
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const next = widthFromClientX(event.clientX);
    if (next !== null) updateWidth(next);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        updateWidth(panelWidth + KEYBOARD_STEP_PERCENT);
        break;
      case "ArrowRight":
        event.preventDefault();
        updateWidth(panelWidth - KEYBOARD_STEP_PERCENT);
        break;
      case "Home":
        event.preventDefault();
        updateWidth(MAX_PANEL_WIDTH_PERCENT);
        break;
      case "End":
        event.preventDefault();
        updateWidth(MIN_PANEL_WIDTH_PERCENT);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1">{typeof left === "function" ? left(isDragging) : left}</div>
      <div
        role="separator"
        aria-label={separatorLabel}
        aria-orientation="vertical"
        aria-valuemin={MIN_PANEL_WIDTH_PERCENT}
        aria-valuemax={MAX_PANEL_WIDTH_PERCENT}
        aria-valuenow={Math.round(panelWidth)}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleKeyDown}
        className={cn(
          "w-1.5 shrink-0 cursor-col-resize touch-none bg-border transition-colors hover:bg-ring/50 focus-visible:bg-ring focus-visible:outline-none",
          isDragging && "bg-ring/50",
        )}
      />
      <div className="shrink-0 overflow-hidden" style={{ width: `${panelWidth}%` }}>
        {right}
      </div>
    </div>
  );
}
