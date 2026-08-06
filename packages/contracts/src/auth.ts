import { z } from 'zod'

import { expoPushTokenSchema } from './notifications'

const displayNameSchema = z
  .union([z.string().trim().min(2).max(80), z.literal('')])
  .optional()
  .transform((value) => (value === '' || value === undefined ? undefined : value))

export const emailSchema = z.string().trim().toLowerCase().email().max(254)

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')

export const userRoleSchema = z.enum(['user', 'admin'])

// The user contract deliberately carries no subscription: billing is an optional capability,
// and clients that need it read `GET /api/iap/entitlement` through their billing feature.
export const userSchema = z.object({
  id: z.string(),
  email: emailSchema,
  displayName: z.string().nullable(),
  role: userRoleSchema,
  createdAt: z.string().datetime(),
})

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
})

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
})

export const socialAuthProviderSchema = z.enum(['apple', 'google'])
export const socialAuthProviderParamsSchema = z.object({ provider: socialAuthProviderSchema })
export const socialAuthRequestSchema = z.object({
  idToken: z.string().trim().min(1).max(4096),
  displayName: displayNameSchema,
})

export const passwordResetRequestSchema = z.object({
  email: emailSchema,
})

export const passwordResetRequestResponseSchema = z.object({
  accepted: z.literal(true),
})

export const passwordResetConfirmRequestSchema = z.object({
  token: z.string().trim().min(43).max(256),
  password: passwordSchema,
})

export const cookieRefreshRequestSchema = z.object({}).strict().optional().default({})
export const cookieLogoutRequestSchema = z.object({}).strict().optional().default({})

export const tokenRefreshRequestSchema = z.object({
  refreshToken: z.string().min(32),
})

export const tokenLogoutRequestSchema = tokenRefreshRequestSchema.extend({
  expoPushToken: expoPushTokenSchema.optional(),
  expoPushTokens: z.array(expoPushTokenSchema).max(20).optional(),
})

export const cookieAuthResponseSchema = z
  .object({
    user: userSchema,
    accessToken: z.string(),
  })
  .strict()

export const tokenAuthResponseSchema = cookieAuthResponseSchema.extend({
  refreshToken: z.string(),
})

export const authSessionIdentitySchema = z
  .object({
    userId: z.string().min(1),
    sessionId: z.string().min(1),
  })
  .strict()

export const cookieRefreshResponseSchema = z
  .object({
    accessToken: z.string(),
  })
  .strict()
export const tokenRefreshResponseSchema = cookieRefreshResponseSchema.extend({
  refreshToken: z.string(),
})

export const meResponseSchema = z.object({ user: userSchema })

export type UserDto = z.infer<typeof userSchema>
export type UserRole = z.infer<typeof userRoleSchema>
export type RegisterRequest = z.input<typeof registerRequestSchema>
export type RegisterPayload = z.output<typeof registerRequestSchema>
export type LoginRequest = z.infer<typeof loginRequestSchema>
export type SocialAuthProvider = z.infer<typeof socialAuthProviderSchema>
export type SocialAuthRequest = z.input<typeof socialAuthRequestSchema>
export type SocialAuthPayload = z.output<typeof socialAuthRequestSchema>
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>
export type PasswordResetRequestResponse = z.infer<typeof passwordResetRequestResponseSchema>
export type PasswordResetConfirmRequest = z.infer<typeof passwordResetConfirmRequestSchema>
export type CookieRefreshRequest = z.infer<typeof cookieRefreshRequestSchema>
export type CookieLogoutRequest = z.infer<typeof cookieLogoutRequestSchema>
export type TokenRefreshRequest = z.infer<typeof tokenRefreshRequestSchema>
export type TokenLogoutRequest = z.infer<typeof tokenLogoutRequestSchema>
export type CookieAuthResponse = z.infer<typeof cookieAuthResponseSchema>
export type TokenAuthResponse = z.infer<typeof tokenAuthResponseSchema>
export type AuthSessionIdentity = z.infer<typeof authSessionIdentitySchema>
export type CookieRefreshResponse = z.infer<typeof cookieRefreshResponseSchema>
export type TokenRefreshResponse = z.infer<typeof tokenRefreshResponseSchema>
export type MeResponse = z.infer<typeof meResponseSchema>
