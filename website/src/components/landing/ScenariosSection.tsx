import {
  Database,
  LayoutTemplate,
  MonitorSmartphone,
  Smartphone,
} from 'lucide-react'

const scenarios = [
  {
    icon: LayoutTemplate,
    title: 'Сайты и лендинги',
    description:
      'Соберите сайт продукта, каталог или промостраницу из готовых адаптивных секций.',
  },
  {
    icon: MonitorSmartphone,
    title: 'Веб-приложения',
    description:
      'Добавьте личный кабинет, панель управления, формы и действия пользователей.',
  },
  {
    icon: Smartphone,
    title: 'Мобильное приложение',
    description:
      'Соберите приложение для iPhone и Android, которое работает с тем же сервером.',
  },
  {
    icon: Database,
    title: 'Аккаунты и данные',
    description:
      'Добавьте вход, хранение данных и внешние сервисы, когда они понадобятся продукту.',
  },
]

export default function ScenariosSection() {
  return (
    <section
      className="border-b bg-black py-20 text-white sm:py-24"
      id="scenarios"
      aria-labelledby="scenarios-title"
    >
      <div className="site-container">
        <div className="grid items-end gap-6 lg:grid-cols-[1fr_0.7fr]">
          <div>
            <p className="text-sm font-bold tracking-[0.16em] text-white/55 uppercase">
              Что можно собрать
            </p>
            <h2
              className="glow-text mt-3 max-w-3xl font-heading text-3xl font-bold tracking-tight text-balance sm:text-4xl"
              id="scenarios-title"
            >
              Соберите одну часть или весь продукт
            </h2>
          </div>
          <p className="text-base leading-7 text-white/60 text-pretty sm:text-lg lg:justify-self-end">
            Начните с того, что нужно сейчас. Остальные части можно подключить
            позже в том же проекте.
          </p>
        </div>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl bg-white/10 ring-1 ring-white/10 sm:grid-cols-2">
          {scenarios.map(({ icon: Icon, title, description }, index) => (
            <article
              key={title}
              className="group relative min-h-64 bg-black p-7 transition-colors hover:bg-white/5 sm:p-8"
            >
              <div className="flex items-start justify-between gap-4">
                <span className="grid size-11 place-items-center rounded-xl bg-white/10 text-white transition-colors group-hover:bg-white group-hover:text-black">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="font-heading text-sm font-bold text-white/55 tabular-nums">
                  0{index + 1}
                </span>
              </div>
              <h3 className="mt-12 max-w-sm font-heading text-xl font-bold">
                {title}
              </h3>
              <p className="mt-3 max-w-md leading-6 text-white/60">
                {description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
