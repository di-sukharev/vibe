import type { PropsWithChildren, ReactNode } from 'react'

import { Typography } from '@/components/typography'

export function PageContainer({ children }: PropsWithChildren) {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 p-5 md:p-8">
      {children}
    </div>
  )
}

export function PageHeader({
  actions,
  description,
  title,
}: {
  actions?: ReactNode
  description: ReactNode
  title: string
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="grid gap-2">
        <Typography as="h1" variant="h2">{title}</Typography>
        <Typography tone="muted">{description}</Typography>
      </div>
      {actions && <PageHeaderActions>{actions}</PageHeaderActions>}
    </div>
  )
}

function PageHeaderActions({ children }: PropsWithChildren) {
  return <div>{children}</div>
}
