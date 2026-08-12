import { apiErrorSchema } from '@web-app-demo/contracts';
import type { z } from 'zod';

import { SessionGenerationChangedError } from '@/platform/session';

const defaultApiBaseUrl = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  retryOnUnauthorized?: boolean;
  signal?: AbortSignal;
};

export type ApiSession = {
  expire: (generation: number) => void | Promise<void>;
  getAccessToken: () => string | null;
  getGeneration: () => number;
  isGenerationCurrent: (generation: number) => boolean;
  refresh: (generation: number) => Promise<{ accessToken: string }>;
  setAccessToken: (accessToken: string | null, generation: number) => boolean;
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
  private refreshOperation: {
    generation: number;
    promise: Promise<{ accessToken: string }>;
  } | null = null;

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
    const generation = this.session.getGeneration();
    const response = await this.rawForGeneration(path, options, generation);
    const body = await response.json();
    this.assertGeneration(options, generation);
    return schema.parse(body);
  }

  async raw(path: string, options: ApiRequestOptions = {}): Promise<Response> {
    const generation = this.session.getGeneration();
    return this.rawForGeneration(path, options, generation);
  }

  private async rawForGeneration(
    path: string,
    options: ApiRequestOptions,
    generation: number,
  ): Promise<Response> {
    if (options.auth && !this.session.isGenerationCurrent(generation)) {
      throw new SessionGenerationChangedError();
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      credentials: this.credentials,
      headers: this.headers(options),
      signal: options.signal,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (options.auth && !this.session.isGenerationCurrent(generation)) {
      throw new SessionGenerationChangedError();
    }

    if (response.status === 401 && options.auth && options.retryOnUnauthorized !== false) {
      const refreshed = await this.refreshOnce(generation).catch(async (error: unknown) => {
        if (
          isTerminalAuthFailure(error) ||
          error instanceof SessionGenerationChangedError
        ) {
          await this.session.expire(generation);
        }
        throw error;
      });
      if (!this.session.isGenerationCurrent(generation)) {
        throw new SessionGenerationChangedError();
      }
      this.session.setAccessToken(refreshed.accessToken, generation);
      try {
        return await this.rawForGeneration(
          path,
          { ...options, retryOnUnauthorized: false },
          generation,
        );
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) {
          await this.session.expire(generation);
        }
        throw error;
      }
    }

    if (!response.ok) {
      const error = await toApiError(response);
      this.assertGeneration(options, generation);
      throw error;
    }
    return response;
  }

  private assertGeneration(options: ApiRequestOptions, generation: number) {
    if (options.auth && !this.session.isGenerationCurrent(generation)) {
      throw new SessionGenerationChangedError();
    }
  }

  private refreshOnce(generation: number) {
    if (this.refreshOperation?.generation === generation) {
      return this.refreshOperation.promise;
    }

    const promise = this.session.refresh(generation).finally(() => {
      if (this.refreshOperation?.promise === promise) {
        this.refreshOperation = null;
      }
    });
    this.refreshOperation = { generation, promise };
    return promise;
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

export function isTerminalAuthFailure(error: unknown) {
  return error instanceof ApiRequestError && (error.status === 400 || error.status === 401);
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
