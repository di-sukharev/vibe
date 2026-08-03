import { apiErrorSchema } from '@web-app-demo/contracts'

const errorResponseContent = {
  'application/json': {
    schema: apiErrorSchema,
  },
}

const retryAfterHeader = {
  'Retry-After': {
    description: 'Seconds before the client should retry the request',
    schema: {
      type: 'integer' as const,
      minimum: 1,
    },
    example: 60,
  },
}

export const ingressErrorResponses = {
  413: {
    content: errorResponseContent,
    description: 'Request body is too large',
  },
  429: {
    content: errorResponseContent,
    description: 'Too many requests',
    headers: retryAfterHeader,
  },
}

export const rateLimitErrorResponses = {
  429: ingressErrorResponses[429],
}
