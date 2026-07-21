import * as React from "react"

import { cn } from "@/lib/utils"
import { Typography } from "@/components/typography"

function MessageGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-group"
      className={cn("flex min-w-0 flex-col gap-2", className)}
      {...props}
    />
  )
}

function Message({
  className,
  align = "start",
  ...props
}: React.ComponentProps<"div"> & { align?: "start" | "end" }) {
  return (
    <Typography asChild variant="bodySm">
      <div
        data-slot="message"
        data-align={align}
        className={cn(
          "group/message relative flex w-full min-w-0 gap-2 data-[align=end]:flex-row-reverse",
          className
        )}
        {...props}
      />
    </Typography>
  )
}

function MessageAvatar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-avatar"
      className={cn(
        "flex w-fit min-w-8 shrink-0 items-center justify-center self-end overflow-hidden rounded-full bg-muted group-has-data-[slot=message-footer]/message:-translate-y-8",
        className
      )}
      {...props}
    />
  )
}

function MessageContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-content"
      className={cn(
        "flex w-full min-w-0 flex-col gap-2.5 wrap-break-word group-data-[align=end]/message:*:data-slot:self-end",
        className
      )}
      {...props}
    />
  )
}

function MessageHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <Typography asChild variant="captionMedium" tone="muted">
      <div
        data-slot="message-header"
        className={cn(
          "flex max-w-full min-w-0 items-center px-3.5 group-has-data-[variant=ghost]/message:px-0",
          className
        )}
        {...props}
      />
    </Typography>
  )
}

function MessageFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <Typography asChild variant="captionMedium" tone="muted">
      <div
        data-slot="message-footer"
        className={cn(
          "flex max-w-full min-w-0 items-center px-3.5 group-has-data-[variant=ghost]/message:px-0 group-data-[align=end]/message:justify-end",
          className
        )}
        {...props}
      />
    </Typography>
  )
}

export {
  MessageGroup,
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
}
