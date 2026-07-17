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
  signal?: AbortSignal
}

export type CheckPushReceiptsOptions = {
  limit?: number
  now?: Date
  signal?: AbortSignal
}

export type RedactTerminalNotificationDataOptions = {
  limit?: number
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
  register(
    userId: string,
    sessionId: string,
    input: RegisterPushTokenRequest,
    now: Date,
  ): Promise<PushInstallationMutationResult>
  unregister(
    userId: string,
    sessionId: string,
    input: UnregisterPushTokenRequest,
    now: Date,
  ): Promise<PushInstallationMutationResult>
}

export type PushInstallationMutationResult =
  | 'applied'
  | 'forbidden'
  | 'inactive-session'
  | 'stale'

export type PushOutbox = {
  enqueue(
    input: EnqueuePushNotificationInput,
  ): Promise<{ created: boolean; id: string }>
  process(options?: ProcessPushOutboxOptions): Promise<ProcessPushOutboxMetrics>
  redactTerminalData(options?: RedactTerminalNotificationDataOptions): Promise<number>
}

export type PushReceipts = {
  check(options?: CheckPushReceiptsOptions): Promise<CheckPushReceiptsMetrics>
}

export type NotificationServiceDependencies = {
  now(): Date
  outbox: PushOutbox
  receipts: PushReceipts
  tokens: PushTokenRepository
}
