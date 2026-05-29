import * as React from "react"

import { cn } from "@/lib/utils"
import { Typography } from "@/components/ui/typography"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <Typography asChild variant="bodySm">
        <table
          data-slot="table"
          className={cn("w-full caption-bottom", className)}
          {...props}
        />
      </Typography>
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <Typography asChild variant="bodySmMedium">
      <tfoot
        data-slot="table-footer"
        className={cn(
          "border-t bg-muted/50 [&>tr]:last:border-b-0",
          className
        )}
        {...props}
      />
    </Typography>
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <Typography asChild variant="bodySmMedium" tone="default">
      <th
        data-slot="table-head"
        className={cn(
          "h-12 px-3 text-left align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
          className
        )}
        {...props}
      />
    </Typography>
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-3 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <Typography asChild variant="bodySm" tone="muted">
      <caption
        data-slot="table-caption"
        className={cn("mt-4", className)}
        {...props}
      />
    </Typography>
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
