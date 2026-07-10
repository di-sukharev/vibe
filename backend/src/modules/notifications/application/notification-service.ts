import type {
  RegisterPushTokenRequest,
  TestPushNotificationPayload,
  UnregisterPushTokenRequest,
} from '@web-app-demo/contracts'

import type { NotificationOperations, TestPushInputBuilder } from './ports'

export class NotificationService {
  constructor(
    private readonly operations: NotificationOperations,
    private readonly buildTestPushInput: TestPushInputBuilder,
  ) {}

  registerToken(userId: string, input: RegisterPushTokenRequest) {
    return this.operations.registerToken(userId, input)
  }

  unregisterToken(userId: string, input: UnregisterPushTokenRequest) {
    return this.operations.unregisterToken(userId, input)
  }

  cleanupTokens(userId: string, expoPushTokens: string[]) {
    return this.operations.cleanupTokens(userId, expoPushTokens)
  }

  hasActiveToken(userId: string) {
    return this.operations.hasActiveToken(userId)
  }

  sendTestPush(userId: string, payload: TestPushNotificationPayload) {
    return this.operations.enqueueAndProcess(this.buildTestPushInput(userId, payload))
  }

  processOutbox(options?: Parameters<NotificationOperations['processOutbox']>[0]) {
    return this.operations.processOutbox(options)
  }

  checkReceipts(options?: Parameters<NotificationOperations['checkReceipts']>[0]) {
    return this.operations.checkReceipts(options)
  }
}
