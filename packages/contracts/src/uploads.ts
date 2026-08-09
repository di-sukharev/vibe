import { z } from 'zod'

/**
 * Avatar upload contracts.
 *
 * The browser never talks to the backend for the bytes themselves: it asks for an upload
 * ticket, PUTs the file straight at the storage endpoint, then asks the backend to finalize.
 * The ticket therefore has to carry the exact headers the browser must replay, because the
 * storage provider signs them and rejects anything else.
 */

export const AVATAR_MIN_BYTES = 64
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024

/**
 * HEIC arrives under two names: browsers and phones disagree about whether an ISO-BMFF image
 * is `image/heic` or `image/heif`, and the declared type is part of the upload signature, so a
 * mismatch would break the PUT rather than degrade it. Both are accepted and treated alike.
 */
export const avatarContentTypeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
])

/**
 * `z.url()` accepts `javascript:` and `data:`, which is exactly the hazard docs/STORAGE.md
 * warns about for stored URLs. Parse the URL and pin the scheme instead.
 */
const httpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return false
    }
    return url.protocol === 'http:' || url.protocol === 'https:'
  }, 'Storage URLs must use http or https')

export const createAvatarUploadRequestSchema = z
  .object({
    contentType: avatarContentTypeSchema,
    byteSize: z.number().int().min(AVATAR_MIN_BYTES).max(AVATAR_MAX_BYTES),
  })
  .strict()

export const uploadTicketSchema = z
  .object({
    uploadId: z.uuid(),
    method: z.literal('PUT'),
    url: httpUrlSchema,
    /** Replay verbatim. Includes `Content-Type` and `If-None-Match: *`; both are signed. */
    headers: z.record(z.string(), z.string()),
    contentLength: z.number().int().positive(),
    expiresAt: z.string().datetime(),
  })
  .strict()

export const createAvatarUploadResponseSchema = z
  .object({
    upload: uploadTicketSchema,
  })
  .strict()

export const avatarUploadParamsSchema = z
  .object({
    uploadId: z.uuid(),
  })
  .strict()

export const avatarSchema = z
  .object({
    contentType: avatarContentTypeSchema,
    byteSize: z.number().int().positive(),
    updatedAt: z.string().datetime(),
    downloadUrl: httpUrlSchema,
    downloadUrlExpiresAt: z.string().datetime(),
  })
  .strict()

export const avatarResponseSchema = z
  .object({
    avatar: avatarSchema.nullable(),
  })
  .strict()

export type AvatarContentType = z.infer<typeof avatarContentTypeSchema>
export type CreateAvatarUploadRequest = z.infer<typeof createAvatarUploadRequestSchema>
export type UploadTicket = z.infer<typeof uploadTicketSchema>
export type CreateAvatarUploadResponse = z.infer<typeof createAvatarUploadResponseSchema>
export type AvatarUploadParams = z.infer<typeof avatarUploadParamsSchema>
export type Avatar = z.infer<typeof avatarSchema>
export type AvatarResponse = z.infer<typeof avatarResponseSchema>
