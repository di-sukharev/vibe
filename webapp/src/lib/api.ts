import {
  apiErrorSchema,
  authResponseSchema,
  loginRequestSchema,
  logoutRequestSchema,
  meResponseSchema,
  refreshRequestSchema,
  refreshResponseSchema,
  registerRequestSchema,
  type AuthResponse,
  type LoginRequest,
  type LogoutRequest,
  type MeResponse,
  type RefreshRequest,
  type RefreshResponse,
  type RegisterRequest,
} from '@web-app-demo/contracts'
import type { z } from 'zod'

const apiBaseUrl = (import.meta.env?.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')

type ApiClientOptions = {
  getAccessToken: () => string | null
  setAccessToken: (accessToken: string | null) => void
  onAuthExpired?: () => void | Promise<void>
}

type RequestOptions = {
  method?: 'GET' | 'POST'
  body?: unknown
  auth?: boolean
  retryOnUnauthorized?: boolean
  accessTokenOverride?: string
}

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export class ApiClient {
  private readonly options: ApiClientOptions
  private refreshPromise: Promise<RefreshResponse> | null = null

  constructor(options: ApiClientOptions) {
    this.options = options
  }

  register(input: RegisterRequest): Promise<AuthResponse> {
    const payload = registerRequestSchema.parse(input)
    return this.request('/api/auth/register', authResponseSchema, {
      method: 'POST',
      body: payload,
      auth: false,
    })
  }

  login(input: LoginRequest): Promise<AuthResponse> {
    const payload = loginRequestSchema.parse(input)
    return this.request('/api/auth/login', authResponseSchema, {
      method: 'POST',
      body: payload,
      auth: false,
    })
  }

  refresh(input: RefreshRequest = {}): Promise<RefreshResponse> {
    const payload = refreshRequestSchema.parse(input)
    return this.request('/api/auth/refresh', refreshResponseSchema, {
      method: 'POST',
      body: payload,
      auth: false,
      retryOnUnauthorized: false,
    })
  }

  me(): Promise<MeResponse> {
    return this.request('/api/auth/me', meResponseSchema, {
      auth: true,
    })
  }

  async logout(input: LogoutRequest = {}) {
    const payload = logoutRequestSchema.parse(input)
    await this.rawRequest('/api/auth/logout', {
      method: 'POST',
      body: payload,
      auth: false,
      retryOnUnauthorized: false,
    })
  }

  async expireSession() {
    this.options.setAccessToken(null)
    await this.rawRequest('/api/auth/logout', {
      method: 'POST',
      body: {},
      auth: false,
      retryOnUnauthorized: false,
    }).catch(() => undefined)
    await this.options.onAuthExpired?.()
  }

  private async request<TSchema extends z.ZodType>(
    path: string,
    schema: TSchema,
    options: RequestOptions,
  ): Promise<z.infer<TSchema>> {
    const response = await this.rawRequest(path, options)
    const data = await response.json()
    return schema.parse(data)
  }

  private async rawRequest(path: string, options: RequestOptions): Promise<Response> {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: this.headers(options),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })

    if (response.status === 401 && options.auth && options.retryOnUnauthorized !== false) {
      const refreshed = await this.refreshOnce().catch(async (error: unknown) => {
        await this.expireSession()
        throw error
      })
      this.options.setAccessToken(refreshed.accessToken)
      return this.rawRequest(path, {
        ...options,
        accessTokenOverride: refreshed.accessToken,
        retryOnUnauthorized: false,
      })
    }

    if (!response.ok) {
      throw await toApiError(response)
    }

    return response
  }

  private refreshOnce() {
    this.refreshPromise ??= this.refresh().finally(() => {
      this.refreshPromise = null
    })

    return this.refreshPromise
  }

  private headers(options: RequestOptions) {
    const headers = new Headers({
      'X-Client-Platform': 'web',
    })

    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json')
    }

    if (options.auth) {
      const accessToken = options.accessTokenOverride ?? this.options.getAccessToken()
      if (accessToken) {
        headers.set('Authorization', `Bearer ${accessToken}`)
      }
    }

    return headers
  }
}

async function toApiError(response: Response) {
  const fallbackMessage = `Request failed with status ${response.status}`

  try {
    const parsed = apiErrorSchema.parse(await response.json())
    return new ApiRequestError(response.status, parsed.error.code, parsed.error.message)
  } catch {
    return new ApiRequestError(response.status, 'INTERNAL_ERROR', fallbackMessage)
  }
}
