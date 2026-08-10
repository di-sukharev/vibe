/**
 * The provider-neutral email port.
 *
 * Four drivers implement it and one contract suite proves the two real ones behave the same:
 * `disabled` sends nothing, `console` prints, and Yandex Cloud Postbox and Resend talk to a
 * provider. Product code depends on this file only, so choosing a provider is a configuration
 * change rather than a code change.
 *
 * Deliberately absent, with the cost of adding each:
 *
 * - **`from` and `replyTo`.** Per-install configuration, not per-message data. A provider only
 *   accepts a verified identity, so letting a caller pick one models a freedom that does not
 *   exist and would force every call site to know the install's verified domain. They live in
 *   `config.ts`.
 * - **`html`.** Both shipped messages are plain text. Adding a second body means adding escaping
 *   and a text/HTML consistency rule for no current benefit. Both providers accept an HTML body,
 *   so this is one field here plus one line per driver whenever a product needs it.
 * - **`idempotencyKey`.** Resend honours `Idempotency-Key`; Postbox has no equivalent and would
 *   silently send twice, which is exactly the driver divergence this port exists to prevent. It
 *   would also need a stable task identity that `TaskHandlerContext` does not expose. Delivery is
 *   at-least-once and the 60-second password-reset cooldown already bounds duplication.
 * - **A returned provider message id.** Nothing consumes one, so it would be dead surface.
 *   Drivers log it instead, which is what an operator needs to find the message in a console.
 * - **cc, bcc, attachments, templates, tags, scheduled and batch sending, webhooks, bounce
 *   handling, suppression lists, and multiple recipients.** No shipped message needs them and
 *   every one of them differs between the two providers.
 */

export type EmailDriverName = 'disabled' | 'console' | 'postbox' | 'resend'

export type EmailMessage = {
  to: string
  subject: string
  text: string
}

export type EmailDelivery = {
  readonly driver: EmailDriverName
  /**
   * False when this install cannot send. Callers use it to skip work entirely rather than queue
   * messages nothing will deliver: `requestPasswordReset` creates no token and enqueues no task
   * while delivery is unconfigured.
   */
  configured: boolean
  /**
   * Rejects with an `EmailDeliveryError` whose `kind` says whether retrying could help.
   *
   * The signal is the caller's deadline, not a suggestion: a drain aborts it when the task's
   * deadline expires, and every driver must stop in-flight work when it fires.
   */
  send(message: EmailMessage, options: { signal: AbortSignal }): Promise<void>
}

export const disabledEmailDelivery: EmailDelivery = {
  driver: 'disabled',
  configured: false,
  send: async () => undefined,
}
