import { Code2, Gauge, Layers3, Search } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import SectionIntro from './SectionIntro'

const kitItems = [
  {
    icon: Layers3,
    title: 'Четыре части продукта',
    description:
      'Лендинг, веб-приложение, мобильное приложение и сервер находятся в одном проекте.',
  },
  {
    icon: Code2,
    title: 'Инструкции для агента',
    description:
      'В проекте описано, где менять код, как связаны его части и какие проверки запускать.',
  },
  {
    icon: Search,
    title: 'Компоненты и стили',
    description:
      'Готовые секции, формы и общие стили избавляют от настройки каждого элемента с нуля.',
  },
  {
    icon: Gauge,
    title: 'Проверки изменений',
    description:
      'Автоматические проверки и тесты помогают находить ошибки после изменений.',
  },
]

const firstSetup = [
  ['Название и тексты', 'Заменить'],
  ['Цвета и шрифты', 'Выбрать'],
  ['Первая функция', 'Описать'],
  ['Публикация', 'Настроить позже'],
]

export default function LaunchKitSection() {
  return (
    <section
      className="border-b py-20 sm:py-24"
      id="launch-kit"
      aria-labelledby="launch-kit-title"
    >
      <div className="site-container grid items-center gap-12 lg:grid-cols-[1fr_0.9fr] lg:gap-20">
        <div>
          <div>
            <SectionIntro
              eyebrow="Что входит в шаблон"
              title="Начните с продукта, а не с настройки проекта"
              titleId="launch-kit-title"
              description="Структура и проверки уже настроены. Выберите нужную часть проекта и добавляйте функции по одной."
            />
          </div>

          <div className="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-2">
            {kitItems.map(({ icon: Icon, title, description }) => (
              <div key={title} className="grid grid-cols-[auto_1fr] gap-3">
                <span className="mt-0.5 grid size-9 place-items-center rounded-lg bg-white/10 text-white">
                  <Icon className="size-4.5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="font-heading font-bold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                    {description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-lg">
          <div
            className="glow-halo absolute -inset-6 -z-10 rounded-[2.5rem] blur-3xl"
            aria-hidden="true"
          ></div>
          <Card className="glow-surface gap-0 overflow-hidden rounded-2xl bg-[#0d0d0d] py-0 text-white ring-1 ring-white/12">
            <CardHeader className="flex flex-row items-center justify-between border-b border-white/10 px-6 py-5">
              <div>
                <p className="text-xs text-white/55">Перед первой задачей</p>
                <p className="mt-1 font-heading text-lg font-bold">
                  Что настроить под себя
                </p>
              </div>
              <Badge className="font-bold">4 пункта</Badge>
            </CardHeader>
            <CardContent className="p-6">
              <ul className="space-y-3">
                {firstSetup.map(([label, action], index) => (
                  <li
                    key={label}
                    className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3.5"
                  >
                    <span className="flex items-center gap-3 text-sm">
                      <span className="grid size-6 place-items-center rounded-full bg-white/10 text-xs text-white/70 tabular-nums">
                        {index + 1}
                      </span>
                      {label}
                    </span>
                    <span className="text-xs font-bold text-white/60">
                      {action}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  )
}
