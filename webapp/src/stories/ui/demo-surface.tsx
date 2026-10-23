import type { ReactNode } from 'react'

export function DemoSurface({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-2xl p-6">{children}</div>
}
