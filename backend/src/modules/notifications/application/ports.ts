import type {
  RegisterPushTokenRequest,
  TestPushNotificationPayload,
  UnregisterPushTokenRequest,
} from '@web-app-demo/contracts'

export type EnqueuePushNotificationInput = {
  body: string
  data?: Record<string, unknown>
  dedupeKey: string
  scheduledFor?: Date
  title: string
  userId: string
}

export type ProcessPushOutboxMetrics = {
  failed: number
  loops: number
  pendingCount: number
  processed: number
  requeuedStale: number
  sent: number
  skipped: number
  transientFailed: number
}

export type CheckPushReceiptsMetrics = {
  checked: number
  delivered: number
  failed: number
  tokensDisabled: number
}

export type NotificationOperations = {
  registerToken(userId: string, input: RegisterPushTokenRequest): Promise<void>
  unregisterToken(userId: string, input: UnregisterPushTokenRequest): Promise<void>
  cleanupTokens(userId: string, expoPushTokens: string[]): Promise<void>
  hasActiveToken(userId: string): Promise<boolean>
  enqueueAndProcess(input: EnqueuePushNotificationInput): Promise<{ created: boolean; id: string }>
  processOutbox(options?: {
    limit?: number
    maxLoops?: number
    maxRuntimeMs?: number
    now?: Date
    onlyIds?: string[]
    processingStaleMs?: number
  }): Promise<ProcessPushOutboxMetrics>
  checkReceipts(options?: { limit?: number; now?: Date }): Promise<CheckPushReceiptsMetrics>
}

export type TestPushInputBuilder = (
  userId: string,
  payload: TestPushNotificationPayload,
) => EnqueuePushNotificationInput
