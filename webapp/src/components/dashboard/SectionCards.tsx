import type { IconSvgElement } from '@hugeicons/react'
import { HugeiconsIcon } from '@hugeicons/react'

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'

export type SectionMetric = {
  description?: string
  icon?: IconSvgElement
  label: string
  value: number | string
}

export function SectionCards({
  items,
}: {
  items: ReadonlyArray<SectionMetric>
}) {
  return (
    <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs md:grid-cols-2 xl:grid-cols-3 dark:*:data-[slot=card]:bg-card">
      {items.map((item) => (
        <Card className="@container/card" key={item.label}>
          <CardHeader>
            <CardDescription>{item.label}</CardDescription>
            {item.icon && (
              <CardAction>
                <span
                  aria-hidden="true"
                  className="flex size-8 items-center justify-center rounded-lg border bg-background/70 text-muted-foreground"
                >
                  <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                </span>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            <Typography as="div" className="tabular-nums" variant="h3">
              {item.value}
            </Typography>
          </CardContent>
          {item.description && (
            <CardFooter>
              <Typography variant="bodySm" tone="muted">
                {item.description}
              </Typography>
            </CardFooter>
          )}
        </Card>
      ))}
    </div>
  )
}
