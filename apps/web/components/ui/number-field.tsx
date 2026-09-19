"use client"

import * as React from "react"
import { cn } from "cn"

/**
 * The editable half of a slider row: a 62×28 mono box with the unit in faint
 * ink (docs/design/design-system/components/core/NumberField.{jsx,prompt.md}).
 *
 * Typing is local — `onCommit` fires on blur, on Enter, and on every
 * ArrowUp/ArrowDown step — so a half-typed "1" on the way to "1500" never
 * clamps to `min` and never reaches the preview. Base UI's `NumberField` was
 * the obvious base but reports every keystroke through `onValueChange` and
 * does not treat Enter as a commit, which is the opposite contract.
 *
 * A plain text input with `role="spinbutton"` rather than `type="number"`:
 * the arrow keys have to be handled here anyway (to clamp and to commit), and
 * a native number input would step a second time on top.
 */
export function NumberField({
  value,
  min,
  max,
  step = 1,
  unit,
  onCommit,
  className,
  disabled,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "min" | "max" | "step" | "onChange"> & {
  value: number
  min?: number
  max?: number
  step?: number
  /** Shown inside the box, after the value ("ms", "px", "×"). Decorative. */
  unit?: string
  /** Fired only with a committed, clamped value. */
  onCommit?: (value: number) => void
}) {
  const [draft, setDraft] = React.useState(() => String(value))

  // The same param is also driven by its slider, so the box has to follow the
  // committed value rather than own it.
  const [lastValue, setLastValue] = React.useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setDraft(String(value))
  }

  const clamp = React.useCallback(
    (next: number) => {
      let clamped = next
      if (min != null) clamped = Math.max(min, clamped)
      if (max != null) clamped = Math.min(max, clamped)
      return clamped
    },
    [min, max]
  )

  /** The draft as a number, or `null` when it is empty or not a number. */
  const parseDraft = (): number | null => {
    const trimmed = draft.trim()
    if (trimmed === "") return null
    const parsed = Number(trimmed)
    return Number.isNaN(parsed) ? null : parsed
  }

  const commit = () => {
    const parsed = parseDraft()
    if (parsed === null) {
      setDraft(String(value))
      return
    }
    const clamped = clamp(parsed)
    setDraft(String(clamped))
    if (clamped !== value) onCommit?.(clamped)
  }

  const stepBy = (direction: 1 | -1) => {
    // `Number("")` is 0, so an emptied field has to step from the committed
    // value rather than from the bottom of the range.
    const from = parseDraft() ?? value
    // Floating-point steps (scale is 0.01) would otherwise drift to 1.0500000001.
    const next = clamp(Number((from + direction * step).toFixed(10)))
    // The box follows the step even when there is nothing to commit — a
    // half-typed 550 stepped up to the committed 600 has to stop reading 550,
    // or the blur that follows would commit the opposite of what was asked.
    setDraft(String(next))
    if (next === value) return
    onCommit?.(next)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      commit()
      return
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault()
      stepBy(event.key === "ArrowUp" ? 1 : -1)
    }
  }

  return (
    <div
      data-slot="number-field"
      className={cn(
        "flex h-[var(--control-h-xs)] w-[62px] shrink-0 items-center gap-0.5 rounded-sm border border-vm-border-strong bg-vm-surface px-1.5",
        "transition-[border-color,box-shadow] duration-(--dur-fast) ease-standard",
        "has-[input:focus-visible]:border-vm-accent has-[input:focus-visible]:focus-ring",
        disabled && "pointer-events-none opacity-40",
        className
      )}
    >
      <input
        {...props}
        type="text"
        inputMode="decimal"
        role="spinbutton"
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={unit ? `${value} ${unit}` : undefined}
        disabled={disabled}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        className="w-full min-w-0 bg-transparent text-right font-mono text-sm font-medium text-vm-ink outline-none"
      />
      {unit ? (
        <span aria-hidden="true" className="font-mono text-xs text-vm-ink-3">
          {unit}
        </span>
      ) : null}
    </div>
  )
}
