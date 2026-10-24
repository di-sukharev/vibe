import { Separator } from '@/components/ui/separator'
import BrandMark from './BrandMark'

const year = new Date().getFullYear()

export default function SiteFooter() {
  return (
    <footer className="border-t bg-black">
      <div className="site-container py-10">
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-start">
          <div className="max-w-sm">
            <a
              className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href="#top"
            >
              <BrandMark />
            </a>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Шаблон ЙЙ для создания сайтов и приложений с ИИ.
            </p>
          </div>
          <nav
            className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm"
            aria-label="Навигация в подвале"
          >
            <a
              className="text-muted-foreground hover:text-foreground"
              href="#features"
            >
              Как работает
            </a>
            <a
              className="text-muted-foreground hover:text-foreground"
              href="#launch-kit"
            >
              Что входит
            </a>
            <a
              className="text-muted-foreground hover:text-foreground"
              href="#scenarios"
            >
              Что можно собрать
            </a>
            <a
              className="text-muted-foreground hover:text-foreground"
              href="#faq"
            >
              Вопросы
            </a>
            <a
              className="text-muted-foreground hover:text-foreground"
              href="#top"
            >
              Наверх
            </a>
          </nav>
        </div>
        <Separator className="my-8" />
        <div className="flex flex-col justify-between gap-3 text-xs text-muted-foreground sm:flex-row">
          <p>
            © {year} ЙЙ · Автор шаблона —{' '}
            <a
              className="font-bold text-foreground underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white"
              href="https://sukharev.dev"
            >
              sukharev.dev
            </a>
          </p>
          <p>React Router · React · Expo · Hono · Prisma</p>
        </div>
      </div>
    </footer>
  )
}
