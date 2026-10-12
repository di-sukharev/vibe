# Email

[backend/src/email](../backend/src/email) provides transactional delivery. Password reset is the working example. Product code uses the email port.

## Local development

[backend/.env.example](../backend/.env.example) selects `EMAIL_DELIVERY=console`. Run the backend and scheduler, request a reset, and read the local email in the terminal. To send queued messages immediately:

```bash
bun run --cwd backend start:cron -- outbox:drain
```

Production refuses console delivery. `disabled` sends nothing and creates no password-reset token or task.

## Providers

Use Postbox with Yandex Cloud and Resend with DigitalOcean. Both require a verified sender. Variables and valid combinations are defined in [backend/src/env.ts](../backend/src/env.ts).

Provider setup is in [DigitalOcean](DIGITALOCEAN.md#setup) and [Yandex Cloud](YANDEX_CLOUD.md#setup). Keep credentials in environment secrets. The Postbox driver uses SESv2 with SigV4; do not reuse storage keys.

## Delivery and privacy

The password-reset request enqueues an outbox task. The handler looks up the account and sends later. Keep the scheduler running whenever delivery is enabled.

Delivery can repeat after a crash. Handlers must tolerate it. Provider authentication failures are retried so an operator can repair credentials without losing pending resets. Permanent failure invalidates the unsent token.

Errors include only provider, status, and error code. Provider response text can reveal a recipient and must not enter retained outbox errors.

Reset responses must not reveal account existence. Reset tokens belong in URL fragments, which stay out of page-request logs. The outbox clears recipient data when the task finishes.

## Live verification

`bun run --cwd backend test:live` runs fully configured provider suites. It fails on partial configuration or when no suite is configured.

```bash
export EMAIL_FROM='Example <no-reply@yourdomain.com>'
export EMAIL_LIVE_TEST_TO='you@yourdomain.com'
export EMAIL_RESEND_API_KEY='<Resend key>'
# For Postbox, use its access key ID and secret instead of the Resend key.
bun run --cwd backend test:live
```

The variable names are defined in [backend/scripts/test-live.mjs](../backend/scripts/test-live.mjs). Each configured suite sends a real message. After provider verification, complete a password reset with a real mailbox.
