import * as React from "react"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon, MoreHorizontalCircle01Icon } from "@hugeicons/core-free-icons"
import { Typography } from "@/components/ui/typography"

function Breadcrumb({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      aria-label="breadcrumb"
      data-slot="breadcrumb"
      className={cn(className)}
      {...props}
    />
  )
}

function BreadcrumbList({ className, ...props }: React.ComponentProps<"ol">) {
  return (
    <Typography asChild variant="bodySm" tone="muted">
      <ol
        data-slot="breadcrumb-list"
        className={cn(
          "flex flex-wrap items-center gap-1.5 wrap-break-word sm:gap-2.5",
          className
        )}
        {...props}
      />
    </Typography>
  )
}

function BreadcrumbItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn("inline-flex items-center gap-1.5", className)}
      {...props}
    />
  )
}

function BreadcrumbLink({
  asChild,
  className,
  ...props
}: React.ComponentProps<"a"> & {
  asChild?: boolean
}) {
  const Comp = asChild ? Slot.Root : "a"

  return (
    <Typography asChild variant="bodySm">
      <Comp
        data-slot="breadcrumb-link"
        className={cn("transition-colors hover:text-foreground", className)}
        {...props}
      />
    </Typography>
  )
}

function BreadcrumbPage({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <Typography asChild variant="bodySm" tone="default">
      <span
        data-slot="breadcrumb-page"
        role="link"
        aria-disabled="true"
        aria-current="page"
        className={className}
        {...props}
      />
    </Typography>
  )
}

function BreadcrumbSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      className={cn("[&>svg]:size-3.5", className)}
      {...props}
    >
      {children ?? (
        <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
      )}
    </li>
  )
}

function BreadcrumbEllipsis({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-ellipsis"
      role="presentation"
      aria-hidden="true"
      className={cn(
        "flex size-5 items-center justify-center [&>svg]:size-4",
        className
      )}
      {...props}
    >
      <HugeiconsIcon icon={MoreHorizontalCircle01Icon} strokeWidth={2} />
      <Typography variant="srOnly">More</Typography>
    </span>
  )
}

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
}
