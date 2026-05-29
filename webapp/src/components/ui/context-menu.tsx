import * as React from "react"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Typography } from "@/components/ui/typography"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon, Tick02Icon } from "@hugeicons/core-free-icons"

function ContextMenu({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      className={cn("select-none", className)}
      {...props}
    />
  )
}

function ContextMenuGroup({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Group>) {
  return (
    <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
  )
}

function ContextMenuPortal({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Portal>) {
  return (
    <ContextMenuPrimitive.Portal data-slot="context-menu-portal" {...props} />
  )
}

function ContextMenuSub({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />
}

function ContextMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioGroup>) {
  return (
    <ContextMenuPrimitive.RadioGroup
      data-slot="context-menu-radio-group"
      {...props}
    />
  )
}

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
}) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn("z-50 max-h-(--radix-context-menu-content-available-height) min-w-48 origin-(--radix-context-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-2xl bg-popover p-1 text-popover-foreground shadow-2xl ring-1 ring-foreground/5 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <Typography asChild variant="bodySm">
      <ContextMenuPrimitive.Item
        data-slot="context-menu-item"
        data-inset={inset}
        data-variant={variant}
        className={cn(
          "group/context-menu-item relative flex cursor-default items-center gap-2.5 rounded-xl px-3 py-2 outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-9.5 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 focus:*:[svg]:text-accent-foreground data-[variant=destructive]:*:[svg]:text-destructive",
          className
        )}
        {...props}
      />
    </Typography>
  )
}

function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <Typography asChild variant="bodySm">
      <ContextMenuPrimitive.SubTrigger
        data-slot="context-menu-sub-trigger"
        data-inset={inset}
        className={cn(
          "flex cursor-default items-center rounded-xl px-3 py-2 outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-9.5 data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className
        )}
        {...props}
      >
        {children}
        <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="ml-auto" />
      </ContextMenuPrimitive.SubTrigger>
    </Typography>
  )
}

function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.SubContent
      data-slot="context-menu-sub-content"
      className={cn("z-50 min-w-32 origin-(--radix-context-menu-content-transform-origin) overflow-hidden rounded-2xl border bg-popover p-1 text-popover-foreground shadow-lg duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className )}
      {...props}
    />
  )
}

function ContextMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem> & {
  inset?: boolean
}) {
  return (
    <Typography asChild variant="bodySm">
      <ContextMenuPrimitive.CheckboxItem
        data-slot="context-menu-checkbox-item"
        data-inset={inset}
        className={cn(
          "relative flex cursor-default items-center gap-2 rounded-xl py-2 pr-8 pl-3 outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-9.5 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className
        )}
        checked={checked}
        {...props}
      >
        <span className="pointer-events-none absolute right-2">
          <ContextMenuPrimitive.ItemIndicator>
            <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
          </ContextMenuPrimitive.ItemIndicator>
        </span>
        {children}
      </ContextMenuPrimitive.CheckboxItem>
    </Typography>
  )
}

function ContextMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioItem> & {
  inset?: boolean
}) {
  return (
    <Typography asChild variant="bodySm">
      <ContextMenuPrimitive.RadioItem
        data-slot="context-menu-radio-item"
        data-inset={inset}
        className={cn(
          "relative flex cursor-default items-center gap-2 rounded-xl py-2 pr-8 pl-3 outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-9.5 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className
        )}
        {...props}
      >
        <span className="pointer-events-none absolute right-2">
          <ContextMenuPrimitive.ItemIndicator>
            <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
          </ContextMenuPrimitive.ItemIndicator>
        </span>
        {children}
      </ContextMenuPrimitive.RadioItem>
    </Typography>
  )
}

function ContextMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <Typography asChild variant="caption" tone="muted">
      <ContextMenuPrimitive.Label
        data-slot="context-menu-label"
        data-inset={inset}
        className={cn("px-3 py-2.5 data-inset:pl-9.5", className)}
        {...props}
      />
    </Typography>
  )
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border/50", className)}
      {...props}
    />
  )
}

function ContextMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <Typography
      as="span"
      variant="shortcut"
      tone="muted"
      data-slot="context-menu-shortcut"
      className={cn(
        "ml-auto group-focus/context-menu-item:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
}
