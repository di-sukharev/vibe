import { z } from 'zod'

export const apiErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VALIDATION_ERROR',
  'AUTH_EMAIL_ALREADY_EXISTS',
  'AUTH_INVALID_PROVIDER_TOKEN',
  'AUTH_PROVIDER_ACCOUNT_ALREADY_LINKED',
  'AUTH_PROVIDER_EMAIL_REQUIRED',
  'AUTH_PROVIDER_NOT_CONFIGURED',
  'AUTH_PROVIDER_UNAVAILABLE',
  'IAP_NOT_CONFIGURED',
  'IAP_INVALID_TRANSACTION',
  'IAP_OWNERSHIP_MISMATCH',
  'IAP_WEBHOOK_IN_PROGRESS',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'AUTH_PASSWORD_RESET_INVALID',
  // Upload failures a client can actually recover from, kept apart from generic CONFLICT so the
  // UI can say what to do: retry the transfer, pick a different file, or start over.
  'UPLOAD_NOT_COMPLETED',
  'UPLOAD_REJECTED',
  'UPLOAD_EXPIRED',
  'INTERNAL_ERROR',
])

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
})

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>
export type ApiErrorResponse = z.infer<typeof apiErrorSchema>
