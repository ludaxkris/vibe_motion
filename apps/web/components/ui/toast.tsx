"use client"

import * as React from "react"
import { create } from "zustand"

/** "auto-dismiss ~2 s" (handoff, "Dialogs & toast"). */
export const TOAST_DURATION_MS = 2000

type ToastState = {
  /** At most one at a time: the handoff never stacks toasts. */
  current: { id: number; message: string } | null
  show: (message: string) => void
  /** `id` guards against a stale timer clearing a newer toast. */
  dismiss: (id?: number) => void
}

/**
 * Monotonic and never reused. Deriving the id from the toast currently showing
 * restarted it at 1 after every auto-dismiss, and `Toaster` keys the pill by
 * it: a `dismiss()` and a `show()` landing in one React batch would then
 * re-render with the same key, React would reuse the element, and the
 * entrance animation would never replay.
 */
let nextToastId = 0;

export const useToastStore = create<ToastState>((set) => ({
  current: null,
  show: (message) => {
    nextToastId += 1;
    set({ current: { id: nextToastId, message } });
  },
  dismiss: (id) =>
    set((state) => (id != null && state.current?.id !== id ? state : { current: null })),
}))

/** `const { toast } = useToast(); toast("Saved v6")`. */
export function useToast() {
  const show = useToastStore((state) => state.show)
  const dismiss = useToastStore((state) => state.dismiss)
  return React.useMemo(() => ({ toast: show, dismiss: () => dismiss() }), [show, dismiss])
}

/**
 * The pill itself (`docs/design/design-system/components/core/Toast.jsx`):
 * black, 12px/500, one line however long the message, sliding up 8px over
 * `--dur-base`. Separate from `Toaster` so `/dev` can show a standing one
 * without a timer running under it.
 */
export function ToastPill({ children }: { children: React.ReactNode }) {
  return (
    <span
      data-slot="toast"
      className="rounded-pill bg-vm-ink px-3.5 py-2 text-sm font-medium whitespace-nowrap text-vm-ink-inverse shadow-popover animate-in fade-in slide-in-from-bottom-2 duration-(--dur-base) ease-standard"
    >
      {children}
    </span>
  )
}

/**
 * Mount point for the confirmation pill, one per app (`app/providers.tsx`).
 *
 * The live region stays in the DOM whether or not a toast is showing, so the
 * message is announced when it arrives rather than when the region appears.
 */
export function Toaster() {
  const current = useToastStore((state) => state.current)
  const dismiss = useToastStore((state) => state.dismiss)

  React.useEffect(() => {
    if (!current) return
    const id = current.id
    const timer = setTimeout(() => dismiss(id), TOAST_DURATION_MS)
    return () => clearTimeout(timer)
  }, [current, dismiss])

  return (
    <div
      data-slot="toaster"
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center"
    >
      {current ? <ToastPill key={current.id}>{current.message}</ToastPill> : null}
    </div>
  )
}
