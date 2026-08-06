import { AuthApi, type AuthTransportKind } from '@/features/auth';
// capability:billing:start
import { BillingApi } from '@/features/billing';
// capability:billing:end
import { NotificationsApi } from '@/features/notifications';
import { ApiTransport } from '@/platform/api';
import { SessionController } from '@/platform/session';

export { SessionController } from '@/platform/session';

export function createMobileApis(input: {
  authTransport: AuthTransportKind;
  session: SessionController;
}) {
  let auth!: AuthApi;
  const transport = new ApiTransport(
    {
      expire: input.session.expire,
      getAccessToken: input.session.getAccessToken,
      getGeneration: input.session.getGeneration,
      isGenerationCurrent: input.session.isGenerationCurrent,
      refresh: (generation) => auth.refresh(generation),
      setAccessToken: input.session.setAccessToken,
    },
    undefined,
    input.authTransport === 'cookie' ? 'include' : undefined,
  );
  auth = new AuthApi(transport, {
    clearRefreshToken: input.session.clearRefreshToken,
    getAccessToken: input.session.getAccessToken,
    getGeneration: input.session.getGeneration,
    getRefreshToken: input.session.getRefreshToken,
    isGenerationCurrent: input.session.isGenerationCurrent,
    setRefreshToken: input.session.setRefreshToken,
  }, input.authTransport);

  return {
    auth,
    // capability:billing:start
    billing: new BillingApi(transport),
    // capability:billing:end
    notifications: new NotificationsApi(transport),
  };
}

export type MobileApis = ReturnType<typeof createMobileApis>;
