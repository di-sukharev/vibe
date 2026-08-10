import type { AppEnv } from '../env'
import { EmailDeliveryError } from './errors'

export type DisabledEmailConfig = { driver: 'disabled' }

export type ConsoleEmailConfig = { driver: 'console' }

/** Shared by every driver that actually reaches a provider. */
type SendingEmailConfig = {
  /** Sender in wire form: `addr@domain` or `Display Name <addr@domain>`. Both providers take both. */
  from: string
  replyTo?: string
  requestTimeoutMs: number
}

export type PostboxEmailConfig = SendingEmailConfig & {
  driver: 'postbox'
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  configurationSet?: string
}

export type ResendEmailConfig = SendingEmailConfig & {
  driver: 'resend'
  endpoint: string
  apiKey: string
}

export type EmailDeliveryConfig =
  | DisabledEmailConfig
  | ConsoleEmailConfig
  | PostboxEmailConfig
  | ResendEmailConfig

/**
 * Translates validated env into a driver configuration.
 *
 * `backend/src/env.ts` has already rejected every incoherent combination, so anything this
 * function still has to check would be a programming error rather than an operator mistake.
 */
export function emailDeliveryConfigFromEnv(env: AppEnv): EmailDeliveryConfig {
  if (env.EMAIL_DELIVERY === 'disabled') return { driver: 'disabled' }
  if (env.EMAIL_DELIVERY === 'console') return { driver: 'console' }

  const from = env.EMAIL_FROM
  if (!from) {
    throw new EmailDeliveryError(
      'misconfigured',
      `EMAIL_DELIVERY is ${env.EMAIL_DELIVERY} but EMAIL_FROM is missing`,
    )
  }

  const shared = {
    from,
    ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}),
    requestTimeoutMs: env.EMAIL_REQUEST_TIMEOUT_MS,
  }

  if (env.EMAIL_DELIVERY === 'postbox') {
    const accessKeyId = env.EMAIL_POSTBOX_ACCESS_KEY_ID
    const secretAccessKey = env.EMAIL_POSTBOX_SECRET_ACCESS_KEY

    if (!accessKeyId || !secretAccessKey) {
      throw new EmailDeliveryError(
        'misconfigured',
        'EMAIL_DELIVERY is postbox but the Postbox credentials are incomplete',
      )
    }

    return {
      driver: 'postbox',
      endpoint: stripTrailingSlashes(env.EMAIL_POSTBOX_ENDPOINT),
      region: env.EMAIL_POSTBOX_REGION,
      accessKeyId,
      secretAccessKey,
      ...(env.EMAIL_POSTBOX_CONFIGURATION_SET
        ? { configurationSet: env.EMAIL_POSTBOX_CONFIGURATION_SET }
        : {}),
      ...shared,
    }
  }

  const apiKey = env.EMAIL_RESEND_API_KEY
  if (!apiKey) {
    throw new EmailDeliveryError('misconfigured', 'EMAIL_DELIVERY is resend but EMAIL_RESEND_API_KEY is missing')
  }

  return {
    driver: 'resend',
    endpoint: stripTrailingSlashes(env.EMAIL_RESEND_ENDPOINT),
    apiKey,
    ...shared,
  }
}

function stripTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '')
}
