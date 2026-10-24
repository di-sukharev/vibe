import { ArrowRight } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface Props {
  primaryHref: string
  primaryLabel: string
}

export default function CtaSection({ primaryHref, primaryLabel }: Props) {
  return (
    <section className="py-20 sm:py-24" id="cta" aria-labelledby="cta-title">
      <div className="site-container">
        <Card className="glow-surface relative overflow-hidden bg-[#0d0d0d] py-0 ring-1 ring-white/12">
          <div
            className="glow-halo absolute -right-24 -top-24 size-80 rounded-full blur-3xl"
            aria-hidden="true"
          ></div>
          <CardContent className="relative flex flex-col items-start justify-between gap-8 p-7 sm:p-10 lg:flex-row lg:items-center lg:p-12">
            <div className="max-w-2xl">
              <p className="text-sm font-bold tracking-[0.16em] text-white/55 uppercase">
                С чего начать
              </p>
              <h2
                className="glow-text mt-3 font-heading text-3xl font-bold tracking-tight text-balance sm:text-4xl"
                id="cta-title"
              >
                Начните с одного экрана или сценария.
              </h2>
              <p className="mt-4 text-base leading-7 text-muted-foreground text-pretty sm:text-lg">
                Например, попросите заменить название и текст, собрать первый
                экран лендинга или добавить карточки услуг.
              </p>
            </div>
            <a
              className={buttonVariants({
                className:
                  'glow-surface h-11 shrink-0 rounded-full px-6 font-bold',
                size: 'lg',
              })}
              href={primaryHref}
            >
              {primaryLabel}
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </a>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
