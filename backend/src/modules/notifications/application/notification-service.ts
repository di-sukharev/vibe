import type {
  RegisterPushTokenRequest,
  TestPushNotificationPayload,
  UnregisterPushTokenRequest,
} from '@web-app-demo/contracts'

import type {
  NotificationServiceDependencies,
  ProcessPushOutboxOptions,
} from './ports'

export class NotificationService {
  constructor(private readonly dependencies: NotificationServiceDependencies) {}

  registerToken(userId: string, input: RegisterPushTokenRequest) {
    return this.dependencies.tokens.register(userId, input)
  }

  unregisterToken(userId: string, input: UnregisterPushTokenRequest) {
    return this.dependencies.tokens.unregister(userId, input)
  }

  cleanupTokens(userId: string, expoPushTokens: string[]) {
    return this.dependencies.tokens.cleanup(userId, expoPushTokens)
  }

  hasActiveToken(userId: string) {
    return this.dependencies.tokens.hasActive(userId)
  }

  async sendTestPush(userId: string, payload: TestPushNotificationPayload) {
    const queued = await this.dependencies.outbox.enqueue({
      body: payload.body,
      data: {
        href: payload.href,
        kind: 'test_push',
      },
      dedupeKey: `test-push:${userId}:${this.dependencies.createDedupeId()}`,
      title: payload.title,
      userId,
    })
    await this.dependencies.outbox.process({ maxLoops: 1, onlyIds: [queued.id] })
    return queued
  }

  processOutbox(options?: ProcessPushOutboxOptions) {
    return this.dependencies.outbox.process(options)
  }

  checkReceipts(options?: { limit?: number; now?: Date }) {
    return this.dependencies.receipts.check(options)
  }
}
