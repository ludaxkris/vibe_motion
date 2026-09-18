import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "cn"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  "aria-label": ariaLabel,
  ...props
}: SliderPrimitive.Root.Props & { "aria-label"?: string }) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]

  // The interactive, focusable element is the nested `<input type="range">`
  // rendered by each Thumb, not this Root — an `aria-label` here would land
  // on a non-interactive wrapper `<div>`. `getAriaLabel` forwards it to the
  // input itself. Only meaningful for a single-thumb slider (our only use);
  // a range slider should label its thumbs individually instead.
  const getAriaLabel = ariaLabel ? () => ariaLabel : undefined;

  return (
    <SliderPrimitive.Root
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-40 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-full bg-vm-surface-sunken select-none data-horizontal:h-[var(--slider-track-h)] data-horizontal:w-full data-vertical:h-full data-vertical:w-[var(--slider-track-h)]"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-vm-accent select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          // `shadow-thumb` is the handoff's 1.5px accent ring; the focus ring
          // is an outline (globals.css) so it sits outside that rather than
          // replacing it.
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            getAriaLabel={getAriaLabel}
            className="relative block size-[var(--slider-thumb)] shrink-0 rounded-full bg-vm-surface shadow-thumb transition-shadow duration-fast ease-standard select-none after:absolute after:-inset-2 disabled:pointer-events-none disabled:opacity-40"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
