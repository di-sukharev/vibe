import type { PushMaintenanceStore } from './ports'

export function maintainPushRegistrations(store: PushMaintenanceStore, now: Date, absoluteTtlDays: number) {
  return store.cleanup(now, new Date(now.getTime() - absoluteTtlDays * 86_400_000))
}
