export const TEMPLATE_ACTION = {
  href: 'https://github.com/di-sukharev/vibe/tree/mobile',
  label: 'Открыть шаблон на GitHub',
} as const

/**
 * `VITE_WEBAPP_URL` is public build-time configuration read by `src/routes/home.tsx`.
 * Leave it unset for the local next-step link. A nonempty value must be an absolute
 * http(s) URL. Invalid values fail `react-router build` so the published link is usable.
 */
export function resolvePublicWebappUrl(value: string | undefined): string | undefined {
  const webappUrl = value?.trim()
  if (!webappUrl) return undefined

  if (!isAbsoluteHttpUrl(webappUrl)) {
    throw new Error(
      `VITE_WEBAPP_URL must be an absolute http(s) URL such as https://app.example.com, got "${webappUrl}". ` +
        'Leave it unset to build the website without a link to the web app.',
    )
  }

  return webappUrl
}

function isAbsoluteHttpUrl(value: string) {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function getSecondaryAction(publicWebappUrl?: string) {
  const webappUrl = resolvePublicWebappUrl(publicWebappUrl)

  return webappUrl
    ? { href: webappUrl, label: 'Открыть веб-приложение' }
    : { href: '#process', label: 'Как начать: 3 шага' }
}
