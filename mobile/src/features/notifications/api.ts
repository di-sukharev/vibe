import {
  pushMutationResponseSchema,
  registerPushTokenRequestSchema,
  testPushNotificationRequestSchema,
  testPushNotificationResponseSchema,
  unregisterPushTokenRequestSchema,
  type PushMutationResponse,
  type RegisterPushTokenRequest,
  type TestPushNotificationRequest,
  type TestPushNotificationResponse,
  type UnregisterPushTokenRequest,
} from '@web-app-demo/contracts';

import type { ApiTransport } from '@/platform/api';

export class NotificationsApi {
  constructor(private readonly transport: ApiTransport) {}

  registerExpoPushToken(input: RegisterPushTokenRequest): Promise<PushMutationResponse> {
    return this.transport.request('/api/notifications/push-token', pushMutationResponseSchema, {
      method: 'POST', body: registerPushTokenRequestSchema.parse(input), auth: true,
    });
  }

  unregisterExpoPushToken(
    input: UnregisterPushTokenRequest,
    options: { retryOnUnauthorized?: boolean } = {},
  ): Promise<PushMutationResponse> {
    return this.transport.request(
      '/api/notifications/push-token/unregister',
      pushMutationResponseSchema,
      {
        method: 'POST',
        body: unregisterPushTokenRequestSchema.parse(input),
        auth: true,
        retryOnUnauthorized: options.retryOnUnauthorized,
      },
    );
  }

  sendTestPushNotification(
    input: TestPushNotificationRequest = {},
  ): Promise<TestPushNotificationResponse> {
    return this.transport.request(
      '/api/notifications/test-push',
      testPushNotificationResponseSchema,
      {
        method: 'POST', body: testPushNotificationRequestSchema.parse(input), auth: true,
      },
    );
  }
}

export type NotificationsApiPort = NotificationsApi;
