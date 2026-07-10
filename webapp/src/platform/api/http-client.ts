import { apiErrorSchema } from '@web-app-demo/contracts'
import type { z } from 'zod'

const defaultApiBaseUrl = (import.meta.env?.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')

export type HttpRequestOptions = {
  method?: 'GET' | 'POST'
  body?: unknown
  headers?: HeadersInit
  credentials?: RequestCredentials
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

export class HttpClient {
  private readonly baseUrl: string

  constructor(baseUrl = defaultApiBaseUrl) {
    this.baseUrl = baseUrl
  }

  async request<TSchema extends z.ZodType>(
    path: string,
    schema: TSchema,
    options: HttpRequestOptions = {},
  ): Promise<z.infer<TSchema>> {
    const response = await this.raw(path, options)
    return schema.parse(await response.json())
  }

  async raw(path: string, options: HttpRequestOptions = {}): Promise<Response> {
    const headers = new Headers(options.headers)
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json')
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      credentials: options.credentials ?? 'include',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })

    if (!response.ok) {
      throw await toApiError(response)
    }

    return response
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
