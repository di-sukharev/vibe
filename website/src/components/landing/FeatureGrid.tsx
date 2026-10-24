import { Blocks, Layers3, Palette } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import SectionIntro from './SectionIntro'

const roles = [
  {
    icon: Palette,
    title: 'Вы задаёте результат',
    description:
      'Опишите нужный экран или сценарий, проверьте, что получилось, и решите, что делать дальше.',
  },
  {
    icon: Blocks,
    title: 'Агент меняет код',
    description:
      'Агент находит нужную часть проекта, вносит изменения, запускает проверки и показывает результат.',
  },
  {
    icon: Layers3,
    title: 'Шаблон задаёт правила',
    description:
      'В шаблоне уже выбраны технологии, связаны части проекта и описано, где и как агенту менять код.',
  },
]

export default function FeatureGrid() {
  return (
    <section
      className="border-b py-20 sm:py-24"
      id="features"
      aria-labelledby="features-title"
    >
      <div className="site-container">
        <div>
          <SectionIntro
            align="center"
            eyebrow="Кто за что отвечает"
            title="Вы решаете, что строить. Агент вносит изменения."
            titleId="features-title"
            description="Шаблон даёт готовую техническую основу: вам не нужно выбирать технологии, а агенту уже описано, где и как менять код."
          />
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {roles.map(({ icon: Icon, title, description }) => (
            <Card
              key={title}
              className="h-full transition-all duration-200 hover:-translate-y-1 hover:ring-white/25"
            >
              <CardHeader>
                <span className="mb-3 grid size-10 place-items-center rounded-xl bg-white/10 text-white">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <CardTitle className="text-lg font-bold">{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="leading-6 text-muted-foreground">{description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
