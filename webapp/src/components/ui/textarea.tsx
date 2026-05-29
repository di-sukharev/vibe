import * as React from "react"

import { cn } from "@/lib/utils"
import { Typography } from "@/components/ui/typography"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <Typography asChild variant="input">
      <textarea
        data-slot="textarea"
        className={cn(
          "flex field-sizing-content min-h-16 w-full resize-none rounded-xl border border-input bg-input/30 px-3 py-3 transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
          className
        )}
        {...props}
      />
    </Typography>
  )
}

export { Textarea }
