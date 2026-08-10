import type { AppEnv } from '../env'
import { emailDeliveryConfigFromEnv } from './config'
import { consoleEmailDelivery } from './console-delivery'
import { disabledEmailDelivery, type EmailDelivery } from './port'
import { createPostboxDelivery } from './postbox-delivery'
import { createResendDelivery } from './resend-delivery'

/**
 * The one place a delivery adapter is built, so the API and the `outbox:drain` job get the same
 * one. A drain runs under `cron.ts` or `scheduler.ts`, neither of which calls `createApp`, so a
 * default parameter on `createApp` could never have reached it.
 *
 * Delivery is durable rather than immediate: a password-reset request queues a `task_outbox` row
 * and the message leaves when something runs `outbox:drain`. The shipped `schedules` in
 * `scheduler.ts` does that every minute, and `bun run dev` starts it alongside the API - but a
 * deployment still has to run that process. See docs/EMAIL.md and docs/BACKGROUND_JOBS.md.
 */
export function createEmailDelivery(env: AppEnv): EmailDelivery {
  const config = emailDeliveryConfigFromEnv(env)

  switch (config.driver) {
    case 'postbox':
      return createPostboxDelivery(config)
    case 'resend':
      return createResendDelivery(config)
    case 'console':
      return consoleEmailDelivery
    case 'disabled':
      return disabledEmailDelivery
  }
}

export { isUsableEmailAddress } from './address'
export { EmailDeliveryError, isPermanentEmailError, type EmailErrorKind } from './errors'
export {
  disabledEmailDelivery,
  type EmailDelivery,
  type EmailDriverName,
  type EmailMessage,
} from './port'

// The driver factories and their configs are deliberately absent, the same way
// `storage/index.ts` keeps `S3PrivateStorage` off its barrel: `createEmailDelivery` is the only
// way in, so nothing can build a driver while skipping `emailDeliveryConfigFromEnv` - the
// function that carries the "env.ts has already rejected every incoherent combination" contract.
