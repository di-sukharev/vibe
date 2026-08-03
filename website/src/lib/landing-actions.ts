export const TEMPLATE_ACTION = {
  href: 'https://github.com/di-sukharev/vibe/tree/mobile',
  label: 'Открыть шаблон на GitHub',
} as const

export function getSecondaryAction(publicWebappUrl?: string) {
  const webappUrl = publicWebappUrl?.trim()

  return webappUrl
    ? { href: webappUrl, label: 'Открыть веб-приложение' }
    : { href: '#process', label: 'Как начать: 3 шага' }
}
