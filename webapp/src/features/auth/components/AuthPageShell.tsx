import { GalleryVerticalEndIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { Typography } from '@/components/typography'

export function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-svh lg:grid-cols-2">
      <section className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <Link className="flex items-center gap-2" search={{ returnTo: undefined }} to="/login">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <HugeiconsIcon aria-hidden icon={GalleryVerticalEndIcon} size={16} strokeWidth={2} />
            </span>
            <Typography as="span" variant="control">
              web_app_demo
            </Typography>
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-xs">{children}</div>
        </div>
      </section>
      <section aria-hidden className="relative hidden overflow-hidden bg-muted lg:block">
        <img
          alt=""
          className="absolute inset-0 h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
          src="/auth-cover.svg"
        />
      </section>
    </main>
  )
}
