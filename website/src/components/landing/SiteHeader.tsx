import { Menu, X } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import BrandMark from './BrandMark'

interface Props {
  primaryHref: string
  primaryLabel: string
}

const navigation = [
  { href: '#features', label: 'Как работает' },
  { href: '#launch-kit', label: 'Что входит' },
  { href: '#scenarios', label: 'Что можно собрать' },
  { href: '#faq', label: 'Вопросы' },
]

export default function SiteHeader({ primaryHref, primaryLabel }: Props) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-black/70 backdrop-blur-xl">
      <div className="site-container flex h-16 items-center justify-between gap-6">
        <a
          className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href="#top"
        >
          <BrandMark />
        </a>

        <nav
          className="hidden items-center gap-5 md:flex lg:gap-7"
          aria-label="Основная навигация"
        >
          {navigation.map((item) => (
            <a
              key={item.href}
              className="text-sm text-white/60 transition-colors hover:text-white focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={item.href}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="hidden md:block">
          <a
            className={buttonVariants({
              className: 'glow-surface rounded-full px-4 font-bold',
              size: 'sm',
            })}
            href={primaryHref}
          >
            {primaryLabel}
          </a>
        </div>

        <details className="group relative md:hidden">
          <summary
            className="grid size-10 cursor-pointer list-none place-items-center rounded-md border border-white/15 bg-white/5 text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
            aria-label="Меню"
          >
            <Menu className="size-5 group-open:hidden" aria-hidden="true" />
            <X className="hidden size-5 group-open:block" aria-hidden="true" />
          </summary>
          <nav
            className="glow-surface absolute right-0 mt-3 flex w-72 flex-col gap-1 rounded-xl border border-white/12 bg-[#0b0b0b] p-2"
            aria-label="Мобильная навигация"
          >
            {navigation.map((item) => (
              <a
                key={item.href}
                className="rounded-lg px-3 py-2.5 text-sm text-white/75 hover:bg-white/8 hover:text-white"
                href={item.href}
              >
                {item.label}
              </a>
            ))}
            <a
              className={buttonVariants({
                className: 'mt-2 w-full rounded-full font-bold',
                size: 'sm',
              })}
              href={primaryHref}
            >
              {primaryLabel}
            </a>
          </nav>
        </details>
      </div>
    </header>
  )
}
