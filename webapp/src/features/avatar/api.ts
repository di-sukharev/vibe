import {
  avatarResponseSchema,
  createAvatarUploadRequestSchema,
  createAvatarUploadResponseSchema,
  type CreateAvatarUploadRequest,
} from '@web-app-demo/contracts'

import type { AuthenticatedTransport } from '@/platform/api'

export function createAvatarUpload(
  transport: AuthenticatedTransport,
  input: CreateAvatarUploadRequest,
) {
  return transport.request('/api/uploads/avatar', createAvatarUploadResponseSchema, {
    method: 'POST',
    body: createAvatarUploadRequestSchema.parse(input),
  })
}

export function finalizeAvatarUpload(transport: AuthenticatedTransport, uploadId: string) {
  return transport.request(
    `/api/uploads/avatar/${encodeURIComponent(uploadId)}/finalize`,
    avatarResponseSchema,
    { method: 'POST' },
  )
}

export function fetchAvatar(transport: AuthenticatedTransport) {
  return transport.request('/api/uploads/avatar', avatarResponseSchema)
}

export function deleteAvatar(transport: AuthenticatedTransport) {
  return transport.request('/api/uploads/avatar', avatarResponseSchema, { method: 'DELETE' })
}
