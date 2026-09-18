"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-vm-ink-2 group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-vm-surface-muted",
        line: "gap-1 bg-transparent",
        // Folder tabs attach to the top edge of the panel card: full width,
        // 2px apart, sitting on the card's 1px border (handoff, Editor panel).
        folder:
          "w-full gap-0.5 rounded-none bg-transparent p-0 px-3 pt-3 group-data-horizontal/tabs:h-auto",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-vm-ink-2 transition-colors duration-fast ease-standard group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-vm-ink disabled:pointer-events-none disabled:opacity-40 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-40 group-data-[variant=default]/tabs-list:data-active:shadow-raised group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-vm-surface data-active:text-vm-accent-strong",
        // Folder tab: the active one is a white card with a hairline border
        // whose bottom edge is hidden behind the panel card it sits on.
        "group-data-[variant=folder]/tabs-list:h-auto group-data-[variant=folder]/tabs-list:-mb-px group-data-[variant=folder]/tabs-list:rounded-t-md group-data-[variant=folder]/tabs-list:rounded-b-none group-data-[variant=folder]/tabs-list:py-2 group-data-[variant=folder]/tabs-list:shadow-none",
        "group-data-[variant=folder]/tabs-list:data-active:border-vm-border group-data-[variant=folder]/tabs-list:data-active:border-b-vm-surface group-data-[variant=folder]/tabs-list:data-active:bg-vm-surface group-data-[variant=folder]/tabs-list:data-active:font-semibold group-data-[variant=folder]/tabs-list:data-active:text-vm-accent-strong",
        "after:absolute after:bg-vm-ink after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
