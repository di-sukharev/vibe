import type {
  RegisterPushTokenRequest,
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

export type ProcessPushOutboxOptions = {
  limit?: number
  maxLoops?: number
  maxRuntimeMs?: number
  now?: Date
  onlyIds?: string[]
  processingStaleMs?: number
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

export type PushTokenRepository = {
  cleanup(userId: string, expoPushTokens: string[]): Promise<void>
  hasActive(userId: string): Promise<boolean>
  register(userId: string, input: RegisterPushTokenRequest): Promise<void>
  unregister(userId: string, input: UnregisterPushTokenRequest): Promise<void>
}

export type PushOutbox = {
  enqueue(
    input: EnqueuePushNotificationInput,
  ): Promise<{ created: boolean; id: string }>
  process(options?: ProcessPushOutboxOptions): Promise<ProcessPushOutboxMetrics>
}

export type PushReceipts = {
  check(options?: { limit?: number; now?: Date }): Promise<CheckPushReceiptsMetrics>
}

export type NotificationServiceDependencies = {
  createDedupeId(): string
  outbox: PushOutbox
  receipts: PushReceipts
  tokens: PushTokenRepository
}
