import {
  avatarResponseSchema,
  createAvatarUploadRequestSchema,
  createAvatarUploadResponseSchema,
  type AvatarResponse,
  type CreateAvatarUploadRequest,
  type CreateAvatarUploadResponse,
} from '@web-app-demo/contracts';

import type { ApiTransport } from '@/platform/api';

export class AvatarApi {
  constructor(private readonly transport: ApiTransport) {}

  /** Asks the backend for a presigned ticket. The bytes are not sent here. */
  createUpload(input: CreateAvatarUploadRequest): Promise<CreateAvatarUploadResponse> {
    return this.transport.request('/api/uploads/avatar', createAvatarUploadResponseSchema, {
      method: 'POST',
      body: createAvatarUploadRequestSchema.parse(input),
      auth: true,
    });
  }

  /** Publishes an upload once the bytes are in storage. The backend verifies them first. */
  finalizeUpload(uploadId: string): Promise<AvatarResponse> {
    return this.transport.request(
      `/api/uploads/avatar/${encodeURIComponent(uploadId)}/finalize`,
      avatarResponseSchema,
      { method: 'POST', auth: true },
    );
  }

  getAvatar(): Promise<AvatarResponse> {
    return this.transport.request('/api/uploads/avatar', avatarResponseSchema, { auth: true });
  }

  /** Idempotent on the backend, so a retry after a dropped response is safe. */
  removeAvatar(): Promise<AvatarResponse> {
    return this.transport.request('/api/uploads/avatar', avatarResponseSchema, {
      method: 'DELETE',
      auth: true,
    });
  }
}

export type AvatarApiPort = AvatarApi;
