import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type LoginRequest,
  type RegisterRequest,
  type SocialAuthProvider,
  type SocialAuthRequest,
  type SubscriptionSnapshot,
  type UserDto,
} from '@web-app-demo/contracts';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import type { AuthApiPort } from './api';
import { clearBootstrapAuthState, refreshBootstrapSession } from './bootstrap';
import { logoutWithPushCleanup, type LogoutPushCleanupInput } from './logout';
import {
  clearStoredRefreshToken,
  getStoredRefreshToken,
  setStoredRefreshToken,
} from './token-store';

type AuthContextValue = {
  user: UserDto | null;
  isBootstrapping: boolean;
  isAuthenticated: boolean;
  refreshUser: () => Promise<void>;
  register: (input: RegisterRequest) => Promise<void>;
  login: (input: LoginRequest) => Promise<void>;
  socialAuth: (provider: SocialAuthProvider, input: SocialAuthRequest) => Promise<void>;
  logout: () => Promise<void>;
  setSubscription: (subscription: SubscriptionSnapshot) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const meQueryKey = ['auth', 'me'] as const;
type MeQueryData = { user: UserDto };

export type AuthSessionPort = {
  setAccessToken: (accessToken: string | null) => void;
  setExpiredHandler: (handler: () => void | Promise<void>) => void;
};

export type AuthLogoutSupport = Omit<
  LogoutPushCleanupInput,
  'authApi' | 'getStoredRefreshToken'
> & {
  markStoredExpoPushTokenForCleanup: () => Promise<void>;
};

export function AuthProvider({
  api,
  children,
  logoutSupport,
  session,
}: PropsWithChildren<{
  api: AuthApiPort;
  logoutSupport: AuthLogoutSupport;
  session: AuthSessionPort;
}>) {
  const queryClient = useQueryClient();
  const [accessToken, setAccessTokenState] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  const setAccessToken = useCallback((nextAccessToken: string | null) => {
    session.setAccessToken(nextAccessToken);
    setAccessTokenState(nextAccessToken);
  }, [session]);
  const handleAuthExpired = useCallback(async () => {
    await logoutSupport.unregisterStoredExpoPushToken({
      clearStoredOnFailure: true,
      retryOnUnauthorized: false,
    }).catch(() => logoutSupport.markStoredExpoPushTokenForCleanup().catch(() => undefined));
    setAccessToken(null);
    await clearStoredRefreshToken();
    queryClient.removeQueries({ queryKey: meQueryKey });
  }, [logoutSupport, queryClient, setAccessToken]);

  useEffect(() => {
    session.setExpiredHandler(handleAuthExpired);
  }, [handleAuthExpired, session]);

  useEffect(() => {
    let isMounted = true;

    refreshBootstrapSession(api)
      .then(async (response) => {
        if (!isMounted || !response) return;
        setAccessToken(response.accessToken);
      })
      .catch(async () => {
        if (!isMounted) return;
        await clearBootstrapAuthState({
          clearStoredExpoPushToken: logoutSupport.clearStoredExpoPushToken,
          clearStoredRefreshToken,
          markStoredExpoPushTokenForCleanup:
            logoutSupport.markStoredExpoPushTokenForCleanup,
          setAccessToken,
        });
      })
      .finally(() => {
        if (isMounted) {
          setIsBootstrapping(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [api, logoutSupport, setAccessToken]);

  const meQuery = useQuery({
    queryKey: meQueryKey,
    enabled: !isBootstrapping && Boolean(accessToken),
    queryFn: () => api.me(),
  });
  const user = meQuery.data?.user ?? null;
  const isResolvingUser = !isBootstrapping && Boolean(accessToken) && !user && meQuery.isPending;
  const isAuthBootstrapping = isBootstrapping || isResolvingUser;

  const refreshUser = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: meQueryKey });
  }, [queryClient]);

  const setSubscription = useCallback(
    (subscription: SubscriptionSnapshot) => {
      queryClient.setQueryData<MeQueryData | undefined>(meQueryKey, (current) =>
        updateCachedSubscription(current, subscription),
      );
    },
    [queryClient],
  );

  const register = useCallback(
    async (input: RegisterRequest) => {
      const response = await api.register(input);
      setAccessToken(response.accessToken);

      if (response.refreshToken) await setStoredRefreshToken(response.refreshToken);

      queryClient.setQueryData(meQueryKey, { user: response.user });
    },
    [api, queryClient, setAccessToken],
  );

  const login = useCallback(
    async (input: LoginRequest) => {
      const response = await api.login(input);
      setAccessToken(response.accessToken);

      if (response.refreshToken) await setStoredRefreshToken(response.refreshToken);

      queryClient.setQueryData(meQueryKey, { user: response.user });
    },
    [api, queryClient, setAccessToken],
  );

  const socialAuth = useCallback(
    async (provider: SocialAuthProvider, input: SocialAuthRequest) => {
      const response = await api.socialAuth(provider, input);
      setAccessToken(response.accessToken);

      if (response.refreshToken) await setStoredRefreshToken(response.refreshToken);

      queryClient.setQueryData(meQueryKey, { user: response.user });
    },
    [api, queryClient, setAccessToken],
  );

  const logout = useCallback(async () => {
    await logoutWithPushCleanup({
      authApi: api,
      ...logoutSupport,
      getStoredRefreshToken,
    });
    setAccessToken(null);
    await clearStoredRefreshToken();
    queryClient.removeQueries({ queryKey: meQueryKey });
  }, [api, logoutSupport, queryClient, setAccessToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isBootstrapping: isAuthBootstrapping,
      isAuthenticated: Boolean(user),
      refreshUser,
      register,
      login,
      socialAuth,
      logout,
      setSubscription,
    }),
    [isAuthBootstrapping, login, logout, refreshUser, register, setSubscription, socialAuth, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}

function updateCachedSubscription(
  current: MeQueryData | undefined,
  subscription: SubscriptionSnapshot,
): MeQueryData | undefined {
  if (!current?.user) return current;
  if (areSubscriptionSnapshotsEqual(current.user.subscription, subscription)) return current;

  return {
    user: {
      ...current.user,
      subscription,
    },
  };
}

function areSubscriptionSnapshotsEqual(
  left: SubscriptionSnapshot,
  right: SubscriptionSnapshot,
) {
  return (
    left.entitlement === right.entitlement &&
    left.isActive === right.isActive &&
    left.state === right.state &&
    left.platform === right.platform &&
    left.productId === right.productId &&
    left.originalTransactionId === right.originalTransactionId &&
    left.transactionId === right.transactionId &&
    left.expiresAt === right.expiresAt &&
    left.willAutoRenew === right.willAutoRenew &&
    left.updatedAt === right.updatedAt
  );
}
