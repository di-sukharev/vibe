import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type LoginRequest,
  type RegisterRequest,
  type SocialAuthProvider,
  type SocialAuthRequest,
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

import type { AuthApiPort, AuthSessionResponse } from './api';
import {
  clearBootstrapAuthState,
  PendingLogoutRetryableError,
  restoreBootstrapAuthState,
} from './bootstrap';
import { browserSessionCoordinator } from './browser-session-coordinator';
import {
  createLogoutOperationCoordinator,
  logoutWithPushCleanup,
  preserveExpiredSessionPushEvidence,
  type LogoutPushCleanupInput,
} from './logout';
import { isTerminalAuthFailure } from '@/platform/api';

export type AuthAccountScope = {
  generation: number;
  userId: string;
};

type AuthContextValue = {
  accountScope: AuthAccountScope | null;
  user: UserDto | null;
  isBootstrapping: boolean;
  isAuthenticated: boolean;
  isTransitioning: boolean;
  sessionGeneration: number;
  sessionError: string | null;
  refreshUser: () => Promise<void>;
  retrySession: () => Promise<void>;
  register: (input: RegisterRequest) => Promise<void>;
  login: (input: LoginRequest) => Promise<void>;
  socialAuth: (provider: SocialAuthProvider, input: SocialAuthRequest) => Promise<void>;
  logout: () => Promise<void>;
  isAccountScopeCurrent: (scope: AuthAccountScope) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const meQueryKey = ['auth', 'me'] as const;
type MeQueryData = { user: UserDto };

export type AuthSessionPort = {
  beginTransition: () => number;
  clearRefreshToken: (generation?: number) => Promise<void>;
  completePendingLogout: (
    generation?: number,
    browserSessionEpoch?: number,
  ) => Promise<void>;
  getGeneration: () => number;
  getPendingLogout: () => Promise<boolean>;
  getRefreshToken: () => Promise<string | null>;
  isGenerationCurrent: (generation: number) => boolean;
  markPendingLogout: (
    generation?: number,
    browserSessionEpoch?: number,
  ) => Promise<void>;
  setAccessToken: (accessToken: string | null, generation?: number) => boolean;
  setExpiredHandler: (handler: (generation: number) => void | Promise<void>) => void;
  setRefreshToken: (refreshToken: string, generation?: number) => Promise<void>;
};

export type AuthLogoutSupport = Omit<
  LogoutPushCleanupInput,
  | 'authApi'
  | 'clearLocalSession'
  | 'completePendingLogout'
  | 'getStoredRefreshToken'
  | 'markPendingLogout'
  | 'sessionGeneration'
> & {
  markStoredExpoPushTokenForCleanup: (options?: {
    isCancelled?: () => boolean;
  }) => Promise<void>;
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
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionGeneration, setSessionGeneration] = useState(session.getGeneration());
  const logoutOperationCoordinator = useMemo(() => createLogoutOperationCoordinator(), []);

  const setAccessToken = useCallback((nextAccessToken: string | null, generation: number) => {
    if (!session.setAccessToken(nextAccessToken, generation)) return false;
    setAccessTokenState(nextAccessToken);
    return true;
  }, [session]);

  const beginSessionTransition = useCallback(() => {
    const generation = session.beginTransition();
    setSessionGeneration(generation);
    setSessionError(null);
    setIsTransitioning(true);
    return generation;
  }, [session]);

  const finishSessionTransition = useCallback((generation: number) => {
    if (session.isGenerationCurrent(generation)) {
      setIsTransitioning(false);
    }
  }, [session]);

  const handleAuthExpired = useCallback(async (expiredGeneration: number) => {
    if (!session.isGenerationCurrent(expiredGeneration)) return;
    const generation = beginSessionTransition();
    setAccessToken(null, generation);
    queryClient.removeQueries({ queryKey: meQueryKey });
    try {
      await session.clearRefreshToken(generation).catch(() => undefined);
      await preserveExpiredSessionPushEvidence({
        drainPushRegistrations: logoutSupport.drainPushRegistrations,
        isCancelled: () => !session.isGenerationCurrent(generation),
        markStoredExpoPushTokenForCleanup: logoutSupport.markStoredExpoPushTokenForCleanup,
      });
    } finally {
      finishSessionTransition(generation);
    }
  }, [beginSessionTransition, finishSessionTransition, logoutSupport, queryClient, session, setAccessToken]);

  useEffect(() => {
    session.setExpiredHandler(handleAuthExpired);
  }, [handleAuthExpired, session]);

  useEffect(
    () =>
      browserSessionCoordinator.subscribe((event) => {
        const generation = beginSessionTransition();
        setAccessToken(null, generation);
        queryClient.removeQueries({ queryKey: meQueryKey });
        setIsBootstrapping(event.state === 'authenticated');

        void session.clearRefreshToken(generation)
          .catch(() => undefined)
          .finally(() => {
            if (!session.isGenerationCurrent(generation)) return;
            if (event.state === 'authenticated') {
              setBootstrapAttempt((attempt) => attempt + 1);
            } else {
              setIsBootstrapping(false);
            }
            finishSessionTransition(generation);
          });
      }),
    [
      beginSessionTransition,
      finishSessionTransition,
      queryClient,
      session,
      setAccessToken,
    ],
  );

  const performLogout = useCallback(
    (generation: number) =>
      logoutWithPushCleanup({
        authApi: api,
        ...logoutSupport,
        clearLocalSession: async () => {
          setAccessToken(null, generation);
          queryClient.removeQueries({ queryKey: meQueryKey });
        },
        completePendingLogout: (browserSessionEpoch) =>
          session.completePendingLogout(generation, browserSessionEpoch),
        getStoredRefreshToken: session.getRefreshToken,
        markPendingLogout: (browserSessionEpoch) =>
          session.markPendingLogout(generation, browserSessionEpoch),
        sessionGeneration: generation,
      }),
    [api, logoutSupport, queryClient, session, setAccessToken],
  );

  useEffect(() => {
    let isMounted = true;
    const generation = session.getGeneration();
    setIsBootstrapping(true);
    setSessionError(null);

    restoreBootstrapAuthState(api, {
      clear: () => clearBootstrapAuthState({
        clearStoredExpoPushToken: logoutSupport.clearStoredExpoPushToken,
        clearStoredRefreshToken: () => session.clearRefreshToken(generation),
        markStoredExpoPushTokenForCleanup: logoutSupport.markStoredExpoPushTokenForCleanup,
        setAccessToken: (nextAccessToken) => {
          setAccessToken(nextAccessToken, generation);
        },
      }),
      getPendingLogout: session.getPendingLogout,
      resumePendingLogout: () => performLogout(generation),
    })
      .then((result) => {
        if (!isMounted || !session.isGenerationCurrent(generation)) return;
        if (result.status === 'authenticated') {
          setAccessToken(result.response.accessToken, generation);
        } else if (result.status === 'retryable-error') {
          setSessionError(authRecoveryMessage(result.error));
        }
      })
      .catch((error) => {
        if (!isMounted || !session.isGenerationCurrent(generation)) return;
        setSessionError(authRecoveryMessage(error));
      })
      .finally(() => {
        if (isMounted && session.isGenerationCurrent(generation)) {
          setIsBootstrapping(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [api, bootstrapAttempt, logoutSupport, performLogout, session, setAccessToken]);

  const meQuery = useQuery({
    queryKey: meQueryKey,
    enabled: !isBootstrapping && !sessionError && Boolean(accessToken),
    queryFn: () => api.me(),
  });

  useEffect(() => {
    if (!accessToken || !meQuery.error || isTerminalAuthFailure(meQuery.error)) return;
    setSessionError(authRecoveryMessage(meQuery.error));
  }, [accessToken, meQuery.error]);

  const user = meQuery.data?.user ?? null;
  const isResolvingUser = !sessionError && !isBootstrapping && Boolean(accessToken) && !user && meQuery.isPending;
  const isAuthBootstrapping = isBootstrapping || isResolvingUser;
  const accountScope = useMemo<AuthAccountScope | null>(
    () => user ? { generation: sessionGeneration, userId: user.id } : null,
    [sessionGeneration, user],
  );

  const refreshUser = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: meQueryKey });
  }, [queryClient]);

  const retrySession = useCallback(async () => {
    setSessionError(null);
    if (accessToken) {
      const result = await meQuery.refetch();
      if (result.error && !isTerminalAuthFailure(result.error)) {
        setSessionError(authRecoveryMessage(result.error));
      }
      return;
    }
    setBootstrapAttempt((attempt) => attempt + 1);
  }, [accessToken, meQuery]);

  const isAccountScopeCurrent = useCallback((scope: AuthAccountScope) => {
    if (!session.isGenerationCurrent(scope.generation)) return false;
    return queryClient.getQueryData<MeQueryData>(meQueryKey)?.user.id === scope.userId;
  }, [queryClient, session]);

  const establishSession = useCallback(async (
    request: (generation: number) => Promise<AuthSessionResponse>,
  ) => {
    if (await session.getPendingLogout()) {
      const error = new PendingLogoutRetryableError();
      setSessionError(authRecoveryMessage(error));
      throw error;
    }

    const generation = beginSessionTransition();
    let response: AuthSessionResponse | null = null;
    try {
      response = await request(generation);
      if (!session.isGenerationCurrent(generation)) {
        if (response.refreshToken) {
          await api.logout({ refreshToken: response.refreshToken }).catch(() => undefined);
        }
        return;
      }
      if (response.refreshToken) {
        await session.setRefreshToken(response.refreshToken, generation);
      }
      if (!session.isGenerationCurrent(generation)) return;
      setAccessToken(response.accessToken, generation);
      queryClient.setQueryData(meQueryKey, { user: response.user });
    } catch (error) {
      if (response?.refreshToken) {
        await api.logout({ refreshToken: response.refreshToken }).catch(() => undefined);
      }
      if (session.isGenerationCurrent(generation)) {
        setAccessToken(null, generation);
        await session.clearRefreshToken(generation).catch(() => undefined);
        queryClient.removeQueries({ queryKey: meQueryKey });
      }
      throw error;
    } finally {
      finishSessionTransition(generation);
    }
  }, [api, beginSessionTransition, finishSessionTransition, queryClient, session, setAccessToken]);

  const register = useCallback(
    (input: RegisterRequest) =>
      establishSession((generation) => api.register(input, generation)),
    [api, establishSession],
  );

  const login = useCallback(
    (input: LoginRequest) =>
      establishSession((generation) => api.login(input, generation)),
    [api, establishSession],
  );

  const socialAuth = useCallback(
    (provider: SocialAuthProvider, input: SocialAuthRequest) =>
      establishSession((generation) => api.socialAuth(provider, input, generation)),
    [api, establishSession],
  );

  const logout = useCallback(
    () => logoutOperationCoordinator.run(async () => {
      const generation = beginSessionTransition();
      try {
        const result = await performLogout(generation);
        if (result.status === 'retryable' && session.isGenerationCurrent(generation)) {
          setSessionError(authRecoveryMessage(new PendingLogoutRetryableError()));
        }
      } catch (error) {
        if (session.isGenerationCurrent(generation)) {
          setSessionError(authRecoveryMessage(new PendingLogoutRetryableError()));
        }
        throw error;
      } finally {
        finishSessionTransition(generation);
      }
    }),
    [beginSessionTransition, finishSessionTransition, logoutOperationCoordinator, performLogout, session],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      accountScope,
      user,
      isBootstrapping: isAuthBootstrapping,
      isAuthenticated: Boolean(user),
      isTransitioning,
      sessionGeneration,
      sessionError,
      refreshUser,
      retrySession,
      register,
      login,
      socialAuth,
      logout,
      isAccountScopeCurrent,
    }),
    [accountScope, isAccountScopeCurrent, isAuthBootstrapping, isTransitioning, login, logout, refreshUser, register, retrySession, sessionError, sessionGeneration, socialAuth, user],
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

function authRecoveryMessage(error: unknown) {
  if (error instanceof PendingLogoutRetryableError) {
    return 'We could not finish signing you out. Check your connection and try again.';
  }
  return 'We could not restore your session. Check your connection and try again.';
}
