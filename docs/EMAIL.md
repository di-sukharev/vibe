# Email

Transactional email is off by default. Password reset is the reference: `backend/src/email`, `backend/src/modules/auth/infrastructure/password-reset-notifier.ts`, and `backend/src/outbox/handlers.ts`.

## Drivers

Product code uses `backend/src/email/port.ts`. `EMAIL_DELIVERY` selects the driver:

- `disabled`, the schema default: sends and queues nothing. Password reset creates no token and no task.
- `console`: prints each message to the log. Production refuses it.
- `resend`: needs a verified domain and an API key.
- `postbox`: Yandex Cloud Postbox, with a verified sender and a static access key.

## Local development

`backend/.env.example` sets `EMAIL_DELIVERY="console"`.

1. Run `bun run dev` to start the API and the scheduler.
2. Request a password reset in the webapp.
3. After the next drain pass, find the message in the terminal between `--- email (EMAIL_DELIVERY=console) ---` and `--- end email ---`.

To drain at once, run `bun run --cwd backend start:cron -- outbox:drain`.

## Configuration

`backend/.env.example` lists the variables. `backend/src/env.ts` refuses these at startup:

- Missing credentials for the selected provider, or credentials for an unselected provider.
- A provider driver without `EMAIL_FROM` or `WEBAPP_ORIGIN`, which builds the links.
- With a provider driver, an `EMAIL_FROM` or `EMAIL_REPLY_TO` other than `addr@example.com` or `Display Name <addr@example.com>`. Commas, line breaks, and extra angle brackets are refused.

## Choose a provider

Follow the hosting in [CHECKLIST](../CHECKLIST.md). Use Postbox for Yandex Cloud or a data-residency requirement, and Resend otherwise. Terraform supports `postbox` on Yandex Cloud and `resend` on DigitalOcean. Both services are for transactional mail, not marketing.

## Delivery contract

A reset request commits a `task_outbox` row, and `outbox:drain` sends the message later. With a provider configured, a drain must run ([BACKGROUND_JOBS](BACKGROUND_JOBS.md)).

Delivery is at least once. A crash between provider acceptance and the recorded result sends it again. A repeated reset email carries a new link.

- Transient, retried: network errors, timeouts, aborts, `401`, `403`, `404`, `408`, `429`, `5xx`, and a `2xx` without a message ID or with an unreadable body.
- Permanent: any other non-`2xx`, such as a rejected recipient. The task ends at once, and the reset token is invalidated.

`401` and `403` are transient on purpose. A rotated key or an unverified domain returns them until the operator fixes it. As permanent errors, they would invalidate every reset requested during a key rotation.

Errors carry only the provider, HTTP status, and provider error code. Provider text can name the recipient, and `task_outbox.last_error` outlives the payload.

## Proving it works

The unit contract in `backend/src/email/email-contract.ts` covers the error rules without an account. Live tests prove that the real endpoint accepts the request. `bun run --cwd backend test:live` runs each configured suite. It fails when a suite is half configured or none is:

```bash
export EMAIL_FROM="Example <no-reply@yourdomain.com>"
export EMAIL_LIVE_TEST_TO="you@yourdomain.com"
export EMAIL_RESEND_API_KEY="re_..."            # Resend suite
export EMAIL_POSTBOX_ACCESS_KEY_ID="..."        # Postbox suite: both keys
export EMAIL_POSTBOX_SECRET_ACCESS_KEY="..."
bun run --cwd backend test:live
```

Each suite sends one real message to `EMAIL_LIVE_TEST_TO`. Then it checks that a malformed recipient, which the API rejects before sending, is a permanent error. Only the Postbox run proves the SigV4 signature. Finally, test a password reset with a real mailbox.

## Provider setup

- Resend: verify the sending domain and create an API key. For DigitalOcean, see [DIGITALOCEAN](DIGITALOCEAN.md).
- Postbox: verify the sender and check the quotas before launch. On Yandex Cloud, Terraform keeps the sender key in Lockbox. See [YANDEX_CLOUD](YANDEX_CLOUD.md). Never reuse the storage key. The driver calls the SESv2 API with SigV4, not SMTP.

## Security and privacy

- The reset token is in the URL fragment. The browser never sends a fragment with the page request, so the token stays out of access logs and referrers.
- The response and its timing do not reveal whether the account exists.
- `task_outbox` keeps the submitted address only until the task finishes. The hashed dedupe key stays until retention deletes the row.
- Keep provider keys out of the repository. A new key takes effect in a new revision or process.
- Each message has one `to` recipient, with no cc, bcc, or batch sending.
