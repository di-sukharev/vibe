import { AuthApi, type AuthTransportKind } from '@/features/auth';
import { BillingApi } from '@/features/billing';
import { NotificationsApi } from '@/features/notifications';
import { ApiTransport } from '@/platform/api';

export class SessionController {
  private accessToken: string | null = null;
  private expiredHandler: () => void | Promise<void> = () => undefined;

  getAccessToken = () => this.accessToken;
  setAccessToken = (accessToken: string | null) => {
    this.accessToken = accessToken;
  };
  expire = () => this.expiredHandler();
  setExpiredHandler(handler: () => void | Promise<void>) {
    this.expiredHandler = handler;
  }
}

export function createMobileApis(input: {
  authTransport: AuthTransportKind;
  clearRefreshToken: () => Promise<void>;
  getRefreshToken: () => Promise<string | null>;
  session: SessionController;
  setRefreshToken: (refreshToken: string) => Promise<void>;
}) {
  let auth!: AuthApi;
  const transport = new ApiTransport(
    {
      expire: input.session.expire,
      getAccessToken: input.session.getAccessToken,
      refresh: () => auth.refresh(),
      setAccessToken: input.session.setAccessToken,
    },
    undefined,
    input.authTransport === 'cookie' ? 'include' : undefined,
  );
  auth = new AuthApi(transport, input, input.authTransport);

  return {
    auth,
    billing: new BillingApi(transport),
    notifications: new NotificationsApi(transport),
  };
}

export type MobileApis = ReturnType<typeof createMobileApis>;
