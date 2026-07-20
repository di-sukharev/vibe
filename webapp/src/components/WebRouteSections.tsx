import type { PropsWithChildren, ReactNode } from 'react'

import { AuthForm } from '@/features/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'

type PageSectionProps = PropsWithChildren<{
  layout?: 'stack' | 'split'
}>

const sectionLayoutClasses = {
  stack: 'mx-auto grid w-full max-w-6xl gap-6 px-5 py-16',
  split:
    'mx-auto grid w-full max-w-6xl gap-8 px-5 py-12 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center',
}

export function GuestAuthSection() {
  return (
    <PageSection layout="split">
      <SectionIntro
        eyebrow="Golden path template"
        title="Auth, validation, API state, and forms are wired from day one."
      >
        The web app uses shared Zod contracts, TanStack Query for server state,
        TanStack Form for input state, and an API client that refreshes sessions
        through the backend.
      </SectionIntro>
      <AuthForm />
    </PageSection>
  )
}

export function SessionLoadingSection() {
  return (
    <PageSection>
      <div className="justify-self-start">
        <Card>
          <CardContent className="flex items-center gap-3">
            <Spinner />
            <Typography variant="bodySm" tone="muted">
              Checking session...
            </Typography>
          </CardContent>
        </Card>
      </div>
    </PageSection>
  )
}

export function SessionErrorSection({ retry }: { retry: () => Promise<void> }) {
  return (
    <PageSection>
      <div className="grid max-w-2xl gap-4" role="alert">
        <Typography variant="h2">Session check is temporarily unavailable</Typography>
        <Typography tone="muted">
          Your session was not cleared. Check the connection and try again.
        </Typography>
        <div className="justify-self-start">
          <Button type="button" onClick={() => void retry()}>
            Try again
          </Button>
        </div>
      </div>
    </PageSection>
  )
}

function PageSection({ children, layout = 'stack' }: PageSectionProps) {
  return <main className={sectionLayoutClasses[layout]}>{children}</main>
}

function SectionIntro({
  children,
  eyebrow,
  title,
}: {
  children: ReactNode
  eyebrow: string
  title: string
}) {
  return (
    <div className="grid max-w-3xl gap-5">
      <Badge variant="outline">{eyebrow}</Badge>
      <div className="grid max-w-2xl gap-4">
        <Typography variant="h1">{title}</Typography>
        <Typography tone="muted">{children}</Typography>
      </div>
    </div>
  )
}
