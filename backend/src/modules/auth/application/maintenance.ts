import type { AuthMaintenanceStore } from './ports'

export async function maintainAuthState(
  store: AuthMaintenanceStore,
  now: Date,
  settings: { retentionDays: number; absoluteTtlDays: number },
) {
  const dayMs = 24 * 60 * 60 * 1000
  const [sessionsDeleted, passwordResetTokensDeleted] = await Promise.all([
    store.deleteSessions(
      new Date(now.getTime() - settings.retentionDays * dayMs),
      new Date(now.getTime() - (settings.absoluteTtlDays + settings.retentionDays) * dayMs),
    ),
    store.deleteResetTokens(now),
  ])
  return { sessionsDeleted, passwordResetTokensDeleted }
}
