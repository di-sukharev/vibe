import { apiErrorSchema } from '@web-app-demo/contracts';
import type { z } from 'zod';

const defaultApiBaseUrl = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export type ApiRequestOptions = {
  method?: 'GET' | 'POST';
  body?: unknown;
  auth?: boolean;
  retryOnUnauthorized?: boolean;
};

export type ApiSession = {
  expire: () => void | Promise<void>;
  getAccessToken: () => string | null;
  refresh: () => Promise<{ accessToken: string }>;
  setAccessToken: (accessToken: string | null) => void;
};

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class ApiTransport {
  private refreshPromise: Promise<{ accessToken: string }> | null = null;

  constructor(
    private readonly session: ApiSession,
    private readonly baseUrl = defaultApiBaseUrl,
    private readonly credentials?: RequestCredentials,
  ) {}

  async request<TSchema extends z.ZodType>(
    path: string,
    schema: TSchema,
    options: ApiRequestOptions = {},
  ): Promise<z.infer<TSchema>> {
    const response = await this.raw(path, options);
    return schema.parse(await response.json());
  }

  async raw(path: string, options: ApiRequestOptions = {}): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      credentials: this.credentials,
      headers: this.headers(options),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (response.status === 401 && options.auth && options.retryOnUnauthorized !== false) {
      const refreshed = await this.refreshOnce().catch(async (error: unknown) => {
        await this.session.expire();
        throw error;
      });
      this.session.setAccessToken(refreshed.accessToken);
      return this.raw(path, { ...options, retryOnUnauthorized: false });
    }

    if (!response.ok) throw await toApiError(response);
    return response;
  }

  private refreshOnce() {
    this.refreshPromise ??= this.session.refresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private headers(options: ApiRequestOptions) {
    const headers = new Headers();
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (options.auth) {
      const accessToken = this.session.getAccessToken();
      if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    }
    return headers;
  }
}

async function toApiError(response: Response) {
  const fallbackMessage = `Request failed with status ${response.status}`;
  try {
    const parsed = apiErrorSchema.parse(await response.json());
    return new ApiRequestError(response.status, parsed.error.code, parsed.error.message);
  } catch {
    return new ApiRequestError(response.status, 'INTERNAL_ERROR', fallbackMessage);
  }
}
