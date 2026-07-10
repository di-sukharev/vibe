import {
  loginRequestSchema,
  meResponseSchema,
  registerRequestSchema,
  socialAuthProviderSchema,
  socialAuthRequestSchema,
  tokenAuthResponseSchema,
  tokenLogoutRequestSchema,
  tokenRefreshRequestSchema,
  tokenRefreshResponseSchema,
  type LoginRequest,
  type MeResponse,
  type RegisterRequest,
  type SocialAuthProvider,
  type SocialAuthRequest,
  type TokenAuthResponse,
  type TokenLogoutRequest,
  type TokenRefreshResponse,
} from '@web-app-demo/contracts';

import type { ApiTransport } from '@/platform/api';

type AuthApiOptions = {
  clearRefreshToken: () => Promise<void>;
  getRefreshToken: () => Promise<string | null>;
  setRefreshToken: (refreshToken: string) => Promise<void>;
};

type TokenLogoutInput = Omit<TokenLogoutRequest, 'refreshToken'> & { refreshToken?: string };

export class AuthApi {
  constructor(
    private readonly transport: ApiTransport,
    private readonly options: AuthApiOptions,
  ) {}

  register(input: RegisterRequest): Promise<TokenAuthResponse> {
    return this.transport.request(
      '/api/auth/token/register',
      tokenAuthResponseSchema,
      { method: 'POST', body: registerRequestSchema.parse(input) },
    );
  }

  login(input: LoginRequest): Promise<TokenAuthResponse> {
    return this.transport.request('/api/auth/token/login', tokenAuthResponseSchema, {
      method: 'POST',
      body: loginRequestSchema.parse(input),
    });
  }

  socialAuth(provider: SocialAuthProvider, input: SocialAuthRequest): Promise<TokenAuthResponse> {
    const parsedProvider = socialAuthProviderSchema.parse(provider);
    return this.transport.request(
      `/api/auth/token/social/${parsedProvider}`,
      tokenAuthResponseSchema,
      { method: 'POST', body: socialAuthRequestSchema.parse(input) },
    );
  }

  async refresh(): Promise<TokenRefreshResponse> {
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
}

export type AuthApiPort = Pick<AuthApi, 'login' | 'logout' | 'me' | 'refresh' | 'register' | 'socialAuth'>;
