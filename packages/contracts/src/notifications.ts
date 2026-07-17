import { z } from 'zod'

export const expoPushTokenSchema = z
  .string()
  .trim()
  .min(10)
  .max(512)
  .refine(
    (value) => /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(value),
    'Invalid Expo push token',
  )

export const pushTokenPlatformSchema = z.enum(['android', 'ios']).nullable().optional()

export const pushInstallationIdSchema = z.uuid()
export const pushInstallationSecretSchema = z.uuid()

export const pushInstallationGenerationSchema = z
  .number()
  .int()
  .positive()
  .max(2_147_483_647)

const expoPushTokenListSchema = z.array(expoPushTokenSchema).max(12)

export const internalNotificationHrefSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (value) =>
      value.startsWith('/') &&
      !value.startsWith('//') &&
      !value.includes('\\') &&
      !/^[a-z][a-z\d+.-]*:/i.test(value),
    'Notification href must be an internal app path',
  )

const modernRegisterPushTokenRequestSchema = z.object({
  expoPushToken: expoPushTokenSchema,
  deviceId: z.string().trim().min(1).max(200).optional(),
  generation: pushInstallationGenerationSchema,
  installationId: pushInstallationIdSchema,
  installationSecret: pushInstallationSecretSchema,
  platform: pushTokenPlatformSchema,
  previousExpoPushTokens: expoPushTokenListSchema.optional(),
})

const legacyRegisterPushTokenRequestSchema = z.object({
  expoPushToken: expoPushTokenSchema,
  deviceId: z.string().trim().min(1).max(200).optional(),
  platform: pushTokenPlatformSchema,
}).strict()

export const registerPushTokenRequestSchema = z.union([
  modernRegisterPushTokenRequestSchema,
  legacyRegisterPushTokenRequestSchema,
])

const modernUnregisterPushTokenRequestSchema = z.object({
  expoPushTokens: expoPushTokenListSchema.optional(),
  generation: pushInstallationGenerationSchema,
  installationId: pushInstallationIdSchema,
  installationSecret: pushInstallationSecretSchema,
})

const legacyUnregisterPushTokenRequestSchema = z.object({
  expoPushToken: expoPushTokenSchema.optional(),
}).strict()

export const unregisterPushTokenRequestSchema = z.union([
  modernUnregisterPushTokenRequestSchema,
  legacyUnregisterPushTokenRequestSchema,
])

export const pushMutationResponseSchema = z.object({
  applied: z.boolean().default(true),
  ok: z.literal(true),
})

export const testPushNotificationRequestSchema = z.preprocess(
  (value) => value ?? {},
  z.object({
    title: z.string().trim().min(1).max(80).default('Test notification'),
    body: z.string().trim().min(1).max(180).default('Expo Push is configured.'),
    href: internalNotificationHrefSchema.default('/'),
  }),
)

export const testPushNotificationResponseSchema = z.object({
  ok: z.literal(true),
  outboxId: z.string(),
})

export type RegisterPushTokenRequest = z.infer<typeof registerPushTokenRequestSchema>
export type UnregisterPushTokenRequest = z.infer<typeof unregisterPushTokenRequestSchema>
export type LegacyRegisterPushTokenRequest = z.infer<typeof legacyRegisterPushTokenRequestSchema>
export type LegacyUnregisterPushTokenRequest = z.infer<typeof legacyUnregisterPushTokenRequestSchema>
export type PushMutationResponse = z.infer<typeof pushMutationResponseSchema>
export type TestPushNotificationRequest = z.input<typeof testPushNotificationRequestSchema>
export type TestPushNotificationPayload = z.output<typeof testPushNotificationRequestSchema>
export type TestPushNotificationResponse = z.infer<typeof testPushNotificationResponseSchema>
