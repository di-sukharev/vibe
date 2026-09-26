import { apiErrorSchema } from '@web-app-demo/contracts'

const errorResponseContent = {
  'application/json': {
    schema: apiErrorSchema,
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
  },
}

export const rateLimitErrorResponses = {
  429: ingressErrorResponses[429],
}
