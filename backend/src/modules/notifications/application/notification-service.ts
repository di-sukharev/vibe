import type {
  RegisterPushTokenRequest,
  TestPushNotificationPayload,
  UnregisterPushTokenRequest,
} from '@web-app-demo/contracts'

import type {
  CheckPushReceiptsOptions,
  NotificationServiceDependencies,
  ProcessPushOutboxOptions,
  RedactTerminalNotificationDataOptions,
} from './ports'

export class NotificationService {
  constructor(private readonly dependencies: NotificationServiceDependencies) {}

  registerToken(
    userId: string,
    sessionId: string,
    input: RegisterPushTokenRequest,
  ) {
    return this.dependencies.tokens.register(userId, sessionId, input, this.dependencies.now())
  }

  unregisterToken(
    userId: string,
    sessionId: string,
    input: UnregisterPushTokenRequest,
  ) {
    return this.dependencies.tokens.unregister(userId, sessionId, input, this.dependencies.now())
  }

  cleanupTokens(userId: string, expoPushTokens: string[]) {
    return this.dependencies.tokens.cleanup(userId, expoPushTokens)
  }

  hasActiveToken(userId: string) {
    return this.dependencies.tokens.hasActive(userId)
  }

  sendTestPush(userId: string, payload: TestPushNotificationPayload) {
    const minuteBucket = Math.floor(this.dependencies.now().getTime() / 60_000)
    return this.dependencies.outbox.enqueue({
      body: payload.body,
      data: {
        href: payload.href,
        kind: 'test_push',
      },
      dedupeKey: `test-push:${minuteBucket}`,
      title: payload.title,
      userId,
    })
  }

  processOutbox(options?: ProcessPushOutboxOptions) {
    return this.dependencies.outbox.process(options)
  }

  redactTerminalData(options?: RedactTerminalNotificationDataOptions) {
    return this.dependencies.outbox.redactTerminalData(options)
  }

  checkReceipts(options?: CheckPushReceiptsOptions) {
    return this.dependencies.receipts.check(options)
  }
}
