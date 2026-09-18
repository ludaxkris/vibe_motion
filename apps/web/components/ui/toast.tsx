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

export const useToastStore = create<ToastState>((set, get) => ({
  current: null,
  show: (message) => set({ current: { id: (get().current?.id ?? 0) + 1, message } }),
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
      {current ? (
        <span
          key={current.id}
          data-slot="toast"
          className="rounded-pill bg-vm-ink px-3.5 py-2 text-sm font-medium whitespace-nowrap text-vm-ink-inverse shadow-popover animate-in fade-in slide-in-from-bottom-2 duration-(--dur-base) ease-standard"
        >
          {current.message}
        </span>
      ) : null}
    </div>
  )
}
