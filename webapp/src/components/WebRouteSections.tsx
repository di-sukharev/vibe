import {
  Alert02Icon,
  FileNotFoundIcon,
  ShieldUserIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { AuthForm } from '@/features/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
} from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'

type HomeDestination = '/' | '/app' | '/admin'

const templateCapabilities = [
  'Role-aware workspace routing',
  'Shared validation contracts',
  'Recoverable browser sessions',
] as const

export function GuestAuthSection() {
  return (
    <main className="grid min-h-svh bg-muted/30 lg:grid-cols-[minmax(0,1fr)_minmax(28rem,0.8fr)]">
      <section className="flex flex-col gap-8 border-b bg-sidebar p-6 text-sidebar-foreground lg:justify-between lg:gap-12 lg:border-r lg:border-b-0 lg:p-12">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            <Typography variant="control">W</Typography>
          </span>
          <Typography variant="h6">web_app_demo</Typography>
        </div>

        <div className="grid max-w-2xl gap-6">
          <Badge variant="outline" className="hidden w-fit lg:inline-flex">
            Golden path template
          </Badge>
          <div className="grid gap-4">
            <Typography as="h1" variant="h1" balance>
              Auth, validation, and role-aware workspaces—ready from day one.
            </Typography>
            <Typography className="hidden lg:block" tone="muted" pretty>
              Start with a production-shaped account flow backed by shared contracts,
              current database roles, and explicit session recovery.
            </Typography>
          </div>
          <ul className="hidden gap-3 lg:grid">
            {templateCapabilities.map((capability) => (
              <li className="flex items-center gap-3" key={capability}>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sidebar-accent">
                  <HugeiconsIcon aria-hidden icon={Tick02Icon} strokeWidth={2} />
                </span>
                <Typography as="span" variant="bodySm">
                  {capability}
                </Typography>
              </li>
            ))}
          </ul>
        </div>

        <Typography className="hidden lg:block" variant="caption" tone="muted">
          Secure defaults stay server-enforced.
        </Typography>
      </section>

      <section className="flex items-center justify-center p-5 sm:p-8 lg:p-12">
        <div className="w-full max-w-md">
          <AuthForm />
        </div>
      </section>
    </main>
  )
}

export function SessionLoadingSection() {
  return (
    <RouteStateCard
      description="Checking session..."
      icon={ShieldUserIcon}
      title="Loading workspace"
    >
      <Spinner />
    </RouteStateCard>
  )
}

export function SessionErrorSection({ retry }: { retry: () => Promise<void> }) {
  const [retryPending, setRetryPending] = useState(false)

  async function retrySession() {
    setRetryPending(true)
    try {
      await retry()
    } catch {
      // The existing session error remains visible and retryable.
    } finally {
      setRetryPending(false)
    }
  }

  return (
    <RouteStateCard
      alert
      description="Your session was not cleared. Check the connection and try again."
      icon={Alert02Icon}
      title="Session check is temporarily unavailable"
    >
      <Button
        disabled={retryPending}
        onClick={() => void retrySession()}
        type="button"
      >
        {retryPending ? 'Trying again…' : 'Try again'}
      </Button>
    </RouteStateCard>
  )
}

export function NotFoundSection({ destination }: { destination: HomeDestination }) {
  const authenticated = destination !== '/'

  return (
    <RouteStateCard
      description="The page you requested does not exist or may have moved."
      icon={FileNotFoundIcon}
      title="Page not found"
    >
      <Button asChild>
        {authenticated ? (
          <Link to={destination}>Return to workspace</Link>
        ) : (
          <Link search={{ returnTo: undefined }} to="/">Return to sign in</Link>
        )}
      </Button>
    </RouteStateCard>
  )
}

function RouteStateCard({
  alert = false,
  children,
  description,
  icon,
  title,
}: {
  alert?: boolean
  children: ReactNode
  description: string
  icon: IconSvgElement
  title: string
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-5">
      <Card className="w-full max-w-lg shadow-sm">
        <CardContent>
          <Empty
            aria-live={alert ? 'assertive' : undefined}
            className="border-0 p-4 sm:p-8"
            role={alert ? 'alert' : undefined}
          >
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon aria-hidden icon={icon} strokeWidth={2} />
              </EmptyMedia>
              <Typography as="h1" variant="h4" balance>
                {title}
              </Typography>
              <Typography variant="bodySm" tone="muted" align="center" pretty>
                {description}
              </Typography>
            </EmptyHeader>
            <EmptyContent>{children}</EmptyContent>
          </Empty>
        </CardContent>
      </Card>
    </main>
  )
}
