import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Typography } from "@/components/ui/typography"

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <Typography asChild variant="label">
      <LabelPrimitive.Root
        data-slot="label"
        className={cn(
          "flex items-center gap-2 select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
          className
        )}
        {...props}
      />
    </Typography>
  )
}

export { Label }
