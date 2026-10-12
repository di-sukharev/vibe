import { abandonedUploadGraceMs } from './deletion-tasks'
import type { AvatarMaintenanceStore, PrivateStorage } from './ports'

export async function cleanupPendingUploads(
  store: AvatarMaintenanceStore,
  storage: PrivateStorage,
  now: Date,
  onError: (objectKey: string, error: unknown) => void,
) {
  const abandoned = await store.findAbandoned(new Date(now.getTime() - abandonedUploadGraceMs), 500)
  const deleted: string[] = []
  for (const upload of abandoned) {
    try {
      await storage.deleteObject(upload.objectKey)
      deleted.push(upload.id)
    } catch (error) {
      onError(upload.objectKey, error)
    }
  }
  // Keep the row if storage fails: it is the record needed for the next attempt.
  const removed = deleted.length ? await store.removeAbandoned(deleted) : 0
  return { removed, leftToRetry: abandoned.length - deleted.length }
}
