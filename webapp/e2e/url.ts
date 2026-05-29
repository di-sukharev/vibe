export function portFromUrl(value: string | undefined) {
  if (!value) return undefined

  try {
    const url = new URL(value)
    if (url.port) return url.port
    if (url.protocol === 'http:') return '80'
    if (url.protocol === 'https:') return '443'
    if (url.protocol === 'postgresql:' || url.protocol === 'postgres:') return '5432'
    return undefined
  } catch {
    return undefined
  }
}
