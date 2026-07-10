import {
  cookieAuthResponseSchema,
  cookieLogoutRequestSchema,
  cookieRefreshRequestSchema,
  cookieRefreshResponseSchema,
  loginRequestSchema,
  meResponseSchema,
  registerRequestSchema,
  socialAuthProviderSchema,
  socialAuthRequestSchema,
  tokenAuthResponseSchema,
  tokenLogoutRequestSchema,
  tokenRefreshRequestSchema,
  tokenRefreshResponseSchema,
  type CookieAuthResponse,
  type CookieRefreshResponse,
  type LoginRequest,
  type MeResponse,
  type RegisterRequest,
  type SocialAuthProvider,
  type SocialAuthRequest,
  type TokenLogoutRequest,
} from '@web-app-demo/contracts';

import { ApiRequestError, type ApiTransport } from '@/platform/api';

type AuthApiOptions = {
  clearRefreshToken: () => Promise<void>;
  getRefreshToken: () => Promise<string | null>;
  setRefreshToken: (refreshToken: string) => Promise<void>;
};

type TokenLogoutInput = Omit<TokenLogoutRequest, 'refreshToken'> & { refreshToken?: string };

export type AuthTransportKind = 'cookie' | 'token';
export type AuthSessionResponse = CookieAuthResponse & { refreshToken?: string };
export type AuthRefreshResponse = CookieRefreshResponse & { refreshToken?: string };

export class AuthApi {
  constructor(
    private readonly transport: ApiTransport,
    private readonly options: AuthApiOptions,
    private readonly kind: AuthTransportKind,
  ) {}

  register(input: RegisterRequest): Promise<AuthSessionResponse> {
    if (this.kind === 'cookie') {
      return this.transport.request('/api/auth/register', cookieAuthResponseSchema, {
        method: 'POST',
        body: registerRequestSchema.parse(input),
      });
    }
    return this.transport.request(
      '/api/auth/token/register',
      tokenAuthResponseSchema,
      { method: 'POST', body: registerRequestSchema.parse(input) },
    );
  }

  login(input: LoginRequest): Promise<AuthSessionResponse> {
    if (this.kind === 'cookie') {
      return this.transport.request('/api/auth/login', cookieAuthResponseSchema, {
        method: 'POST',
        body: loginRequestSchema.parse(input),
      });
    }
    return this.transport.request('/api/auth/token/login', tokenAuthResponseSchema, {
      method: 'POST',
      body: loginRequestSchema.parse(input),
    });
  }

  socialAuth(provider: SocialAuthProvider, input: SocialAuthRequest): Promise<AuthSessionResponse> {
    if (this.kind === 'cookie') {
      throw new ApiRequestError(
        400,
        'AUTH_SOCIAL_UNSUPPORTED',
        'Native social sign-in is unavailable in the Expo web build',
      );
    }
    const parsedProvider = socialAuthProviderSchema.parse(provider);
    return this.transport.request(
      `/api/auth/token/social/${parsedProvider}`,
      tokenAuthResponseSchema,
      { method: 'POST', body: socialAuthRequestSchema.parse(input) },
    );
  }

  async refresh(): Promise<AuthRefreshResponse> {
    if (this.kind === 'cookie') {
      return this.transport.request('/api/auth/refresh', cookieRefreshResponseSchema, {
        method: 'POST',
        body: cookieRefreshRequestSchema.parse({}),
        retryOnUnauthorized: false,
      });
    }
    const refreshToken = await this.options.getRefreshToken();
    const response = await this.transport.request(
      '/api/auth/token/refresh',
      tokenRefreshResponseSchema,
      {
        method: 'POST',
        body: tokenRefreshRequestSchema.parse({ refreshToken: refreshToken ?? undefined }),
        retryOnUnauthorized: false,
      },
    );
    await this.options.setRefreshToken(response.refreshToken);
    return response;
  }

  me(): Promise<MeResponse> {
    return this.transport.request('/api/auth/me', meResponseSchema, { auth: true });
  }

  async logout(input: TokenLogoutInput = {}) {
    if (this.kind === 'cookie') {
      await this.transport.raw('/api/auth/logout', {
        method: 'POST',
        body: cookieLogoutRequestSchema.parse({}),
        retryOnUnauthorized: false,
      });
      return true;
    }
    const storedRefreshToken = await this.options.getRefreshToken();
    const payload = tokenLogoutRequestSchema.parse({
      ...input,
      refreshToken: input.refreshToken ?? storedRefreshToken ?? undefined,
    });
    const response = await this.transport.raw('/api/auth/token/logout', {
      method: 'POST',
      body: payload,
      retryOnUnauthorized: false,
    });
    return response.headers.get('X-Auth-Session-Revoked') === 'true';
  }

  clearRefreshToken() {
    return this.options.clearRefreshToken();
  }

  async canRefresh() {
    return this.kind === 'cookie' || Boolean(await this.options.getRefreshToken());
  }
}

export type AuthApiPort = Pick<
  AuthApi,
  'canRefresh' | 'login' | 'logout' | 'me' | 'refresh' | 'register' | 'socialAuth'
>;
