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
/** The keys `handleKeyDown` resizes on, and so the ones whose release persists. */
const RESIZE_KEYS: ReadonlySet<string> = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

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
 *
 * The panel percentage is what the component works in and what is persisted;
 * what the separator *announces* is the other pane. APG's window-splitter
 * pattern puts `aria-valuenow`/`min`/`max` on the primary pane — here the
 * preview — so a 25% panel is announced as a 75% preview in [70, 80].
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

  /**
   * Live only. Persisting belongs at the *end* of a gesture (`pointerup`,
   * `keyup`): a `localStorage.setItem` per `pointermove` is a synchronous
   * write at 60–120 Hz, and each one changes what `getStoredWidth` — the
   * `useSyncExternalStore` snapshot above — returns at render time, costing a
   * second render over a value `overrideWidth` already supersedes.
   */
  const updateWidth = useCallback((next: number) => {
    setOverrideWidth(clampPanelWidth(next));
  }, []);

  const widthFromClientX = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    // The panel occupies the right side of the container; moving the
    // pointer left grows it, moving it right shrinks it.
    return ((rect.right - clientX) / rect.width) * 100;
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // The primary button only: anything else — a right-click opening a context
    // menu, a back button — would otherwise begin a resize that runs under the
    // menu and ends on the next pointerup.
    if (event.button !== 0) return;
    // And no `preventDefault()`: it would deny the `tabIndex={0}` separator the
    // focus a click gives every other focusable control.
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
    persist(panelWidth);
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

  /** One write per press, however long the key auto-repeats. */
  const handleKeyUp = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!RESIZE_KEYS.has(event.key)) return;
    persist(panelWidth);
  };

  return (
    <div
      ref={containerRef}
      // `handlePointerDown` deliberately does not `preventDefault()` — that is
      // what lets a click focus the separator — so the browser still treats the
      // drag as a text selection and paints the panel's labels blue as the
      // pointer sweeps over them. Suppressing selection for the duration of the
      // gesture costs nothing else: it is off again the moment the drag ends.
      className={cn("flex min-h-0 flex-1", isDragging && "select-none")}
    >
      {/* A flex container, not a block: the pane's child (the preview and its
          sheet) has to be able to fill the row's full height. */}
      <div className="flex min-w-0 flex-1">
        {typeof left === "function" ? left(isDragging) : left}
      </div>
      <div
        role="separator"
        aria-label={separatorLabel}
        aria-orientation="vertical"
        // The primary pane's share, not the panel's — see the component note.
        aria-valuemin={100 - MAX_PANEL_WIDTH_PERCENT}
        aria-valuemax={100 - MIN_PANEL_WIDTH_PERCENT}
        aria-valuenow={100 - Math.round(panelWidth)}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        // The handoff draws no handle at all: the divider *is* the panel's 1px
        // left border (ruling in docs/plans/phase-3-web-shell.md, "Design
        // handoff"). So the hairline stays a hairline and the grabbable strip
        // is an invisible pseudo-element either side of it.
        className={cn(
          "relative w-px shrink-0 cursor-col-resize touch-none bg-vm-border",
          "transition-colors duration-(--dur-fast) ease-standard hover:bg-vm-accent",
          "after:absolute after:inset-y-0 after:-left-1 after:-right-1",
          isDragging && "bg-vm-accent",
        )}
      />
      <div className="shrink-0 overflow-hidden" style={{ width: `${panelWidth}%` }}>
        {right}
      </div>
    </div>
  );
}
