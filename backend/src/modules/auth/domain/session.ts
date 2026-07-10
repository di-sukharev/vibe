export type SessionMetadata = {
  userAgent?: string
  ipAddress?: string
}

export function sessionExpiresAt(now: Date, ttlDays: number) {
  return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000)
}
