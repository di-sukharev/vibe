import {
  updateProfileRequestSchema,
  updateProfileResponseSchema,
  type UpdateProfileRequest,
} from '@web-app-demo/contracts'

import type { AuthenticatedTransport } from '@/platform/api'

export function updateProfile(
  transport: AuthenticatedTransport,
  input: UpdateProfileRequest,
) {
  return transport.request(
    '/api/users/me',
    updateProfileResponseSchema,
    {
      method: 'PATCH',
      body: updateProfileRequestSchema.parse(input),
    },
  )
}
