import { Link } from '@tanstack/react-router'
import type { UserDto } from '@web-app-demo/contracts'
import type { PropsWithChildren, ReactNode } from 'react'

import { AuthForm } from '@/components/AuthForm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
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

export function ActiveSessionSection({ user }: { user: UserDto }) {
  return (
    <PageSection>
      <SectionIntro eyebrow="Authenticated starter" title="Session is active">
        Logged in as{' '}
        <Typography as="strong" variant="emphasis" tone="default">
          {user.email}
        </Typography>
        . This is the baseline auth pattern for future web features.
      </SectionIntro>
      <SectionAction to="/app">Open app</SectionAction>
    </PageSection>
  )
}

export function LoginRequiredSection() {
  return (
    <PageSection>
      <SectionIntro eyebrow="Protected example" title="Login required">
        This route intentionally stays small and shows where protected product UI
        begins.
      </SectionIntro>
      <SectionAction to="/">Go to auth</SectionAction>
    </PageSection>
  )
}

export function CurrentUserSection({ user }: { user: UserDto }) {
  return (
    <PageSection>
      <div className="grid gap-3">
        <Badge variant="outline">Current user</Badge>
        <Typography variant="h1">{user.displayName ?? user.email}</Typography>
        <Typography tone="muted">{user.email}</Typography>
      </div>

      <Separator />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>User ID</CardTitle>
            <CardDescription wrap="break">{user.id}</CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Created</CardTitle>
            <CardDescription>{new Date(user.createdAt).toLocaleString()}</CardDescription>
          </CardHeader>
        </Card>
      </div>
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

function PageSection({ children, layout = 'stack' }: PageSectionProps) {
  return <section className={sectionLayoutClasses[layout]}>{children}</section>
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

function SectionAction({
  children,
  to,
}: PropsWithChildren<{
  to: '/'
} | {
  to: '/app'
}>) {
  return (
    <div className="justify-self-start">
      <Button asChild size="lg">
        <Link to={to}>{children}</Link>
      </Button>
    </div>
  )
}
