# Email

Use this document when a product needs to send email: account notices, password resets, receipts, digests.

Transactional email is built into this template and switched off. The reference feature is the password reset: a request queues a durable task, a background runner picks it up, and a provider sends the message. Read it end to end before adding a second kind of email — `backend/src/email`, `backend/src/modules/auth/infrastructure/password-reset-notifier.ts`, `backend/src/outbox/handlers.ts`.

## Four Drivers, One Port

Everything above the email layer talks to one provider-neutral port, `backend/src/email/port.ts`. Four drivers implement it:

| `EMAIL_DELIVERY` | What it is | What it needs |
| --- | --- | --- |
| `disabled` (default) | Sends nothing, and nothing is queued | Nothing |
| `console` | Prints the message to the log | Nothing. Refused in production |
| `postbox` | Yandex Cloud Postbox | A verified sender and a static access key |
| `resend` | Resend | A verified domain and an API key |

Moving between them is a configuration change, never a code change. `disabled` is not a stub either: `requestPasswordReset` short-circuits on it, so an install with no provider creates no tokens and accumulates no rows.

One suite proves the two real drivers agree. `backend/src/email/email-contract.ts` defines the behaviour once and runs it against each driver with an injected transport, because the part that must agree — what counts as worth retrying — is exactly what no live provider will produce on demand. The live tests prove the other half: that a real endpoint accepts what the driver signs and sends. Neither run is sufficient alone.

## Intake Before Building Email Features

The product-level questions live in [CHECKLIST.md](../CHECKLIST.md) under first-version capabilities, and the answers are recorded there. Ask them before implementation; do not restate them here, so the intake keeps one source.

## Local Development

Nothing to install. `backend/.env.example` ships `EMAIL_DELIVERY="console"`, so a fresh checkout can follow a reset link:

1. `bun run dev` — this starts the API **and** the scheduler, which is what drains the queue.
2. Request a password reset in the webapp.
3. Within a minute the message appears in the same terminal, between `--- email (EMAIL_DELIVERY=console) ---` markers, followed by `Job outbox:drain completed.`
4. Open the printed link and finish the reset.

Two things worth knowing. The wait is up to sixty seconds, because the drain runs on a one-minute schedule; `bun run --cwd backend start:cron -- outbox:drain` runs one pass immediately if you are impatient. And the scheduler takes a database advisory lock on every tick, so with the database down it logs one error a minute rather than dying.

## Configuration

```bash
EMAIL_DELIVERY=disabled                    # or console, postbox, resend
EMAIL_FROM=                                # "addr@example.com" or "Display Name <addr@example.com>"
EMAIL_REPLY_TO=                            # optional
EMAIL_REQUEST_TIMEOUT_MS=10000

EMAIL_POSTBOX_ACCESS_KEY_ID=               # both required when driver=postbox
EMAIL_POSTBOX_SECRET_ACCESS_KEY=
EMAIL_POSTBOX_ENDPOINT=https://postbox.cloud.yandex.net
EMAIL_POSTBOX_REGION=ru-central1
EMAIL_POSTBOX_CONFIGURATION_SET=           # optional

EMAIL_RESEND_API_KEY=                      # required when driver=resend
EMAIL_RESEND_ENDPOINT=https://api.resend.com
```

`backend/src/env.ts` refuses to start on an incoherent combination rather than failing at the first send:

- **Each provider group is all-or-nothing**, and setting another provider's credentials is an error rather than something quietly ignored. `EMAIL_FROM`, `EMAIL_REPLY_TO` and `EMAIL_REQUEST_TIMEOUT_MS` are shared and inert, so they are allowed under any driver — switching provider stays a one-line edit.
- **`EMAIL_FROM` must be a real address**, in one of the two forms above. A value with a comma, a newline, or a second pair of angle brackets is refused, which is what makes header injection impossible from this setting.
- **`WEBAPP_ORIGIN` is required whenever a provider is selected**, because it builds the links inside the messages. Without it the origin falls back to `CORS_ORIGINS[0]`, which in a background runner is not the browser app at all, and the user receives a link that goes nowhere.
- **Production refuses `console`.** It reports itself as configured, so password reset would mint tokens whose "delivery" is a log line nobody reads. Production accepts `disabled`: an install with no email is a real install.

## Choosing A Provider

This follows the hosting already recorded in [CHECKLIST.md](../CHECKLIST.md), not a separate preference:

- **Yandex Cloud, or any data-residency requirement → Postbox.** It stays in the selected cloud; Terraform creates a dedicated sender key directly in Lockbox rather than reusing storage credentials. Postbox speaks the Amazon SESv2 API, so the driver signs its requests with AWS SigV4 under service `ses`. It also offers SMTP, with a different credential — the template uses the API because SMTP would mean adding a mail client dependency for no gain. Check and raise the account's current quotas before launch. See [YANDEX_CLOUD.md](YANDEX_CLOUD.md).
- **Anything else → Resend.** A bearer token and one JSON POST, with a verified sending domain.

Both are transactional-email services, not marketing platforms, which is what the shipped messages are.

## The Delivery Contract

**Delivery is durable, not immediate.** A password-reset request commits a `task_outbox` row and returns; the message leaves when something runs `outbox:drain`. That is deliberate — a provider outage or a redeploy mid-request would otherwise lose the email silently. It also means **an install that wires a provider must run a drain**, or it will accept every request and send nothing. See [BACKGROUND_JOBS.md](BACKGROUND_JOBS.md), "Running the drain".

**Delivery is at-least-once.** If a process dies after the provider accepted a message but before the row was marked done, the task runs again and a second message goes out. For a password reset that means a second link, with the first already dead. Design new task types so a repeat is harmless.

**Failures are classified, and the classification decides what happens next:**

| What happened | Kind | What the outbox does |
| --- | --- | --- |
| Network failure, timeout, the caller aborting | `transient` | Retries, backing off from two minutes |
| `408`, `429`, or any `5xx` | `transient` | Retries |
| `401`, `403`, `404`: a revoked or rotated key, a domain still verifying, a wrong endpoint | `transient` | Retries |
| Any other non-2xx: a rejected recipient, a malformed request | `permanent` | Gives up immediately |
| `2xx` with no message id, or a body that will not parse | `transient` | Retries |

The auth statuses look permanent and deliberately are not. A permanent failure invalidates the reset token straight away rather than leaving a live token for a link the provider has refused to carry — so classifying a rotated API key as permanent would make a routine credential rotation destroy the reset of every user who asked during the window. Retrying instead costs four pointless attempts over half an hour.

**Errors never quote the provider's prose.** Both providers name the offending address in their human-readable message, and whatever a handler throws is stored in `task_outbox.last_error`, which outlives the payload the drain blanks. Errors carry the provider, the HTTP status, and the machine-readable code — nothing else. `email-contract.ts` asserts it against real provider bodies.

## Proving It Works

The unit suite runs everywhere and needs nothing. The live suites need an account, and `bun run --cwd backend test:live` refuses to run rather than passing quietly when they are not configured:

```bash
# Resend
export EMAIL_FROM="Example <no-reply@yourdomain.com>"
export EMAIL_LIVE_TEST_TO="you@yourdomain.com"
export EMAIL_RESEND_API_KEY="re_..."
bun run --cwd backend test:live

# Postbox
export EMAIL_FROM="Example <no-reply@yourdomain.com>"
export EMAIL_LIVE_TEST_TO="you@yourdomain.com"
export EMAIL_POSTBOX_ACCESS_KEY_ID="YCAJE..."
export EMAIL_POSTBOX_SECRET_ACCESS_KEY="YCP..."
bun run --cwd backend test:live
```

Each run sends one real message to `EMAIL_LIVE_TEST_TO` and then forces one permanent rejection with a syntactically invalid recipient, which the API refuses before anything leaves — so it costs no bounce against your domain's reputation. The Postbox run is the only thing that proves the SigV4 signature: a wrong region, a wrong service, or a missing `host` header all produce a request that looks fine locally and is rejected only by the real endpoint.

After that, run the app itself against the provider and complete a real password reset from a real inbox. That is the signal that matters; the suites only make its failure modes cheap to find.

## Security And Privacy

- The reset token travels in the URL **fragment**, which browsers never send to a server, so it stays out of access logs and referrers.
- Reset requests answer identically whether or not the account exists, and enqueue identically, so response timing reveals nothing.
- `task_outbox` briefly holds the address someone typed into the reset form, which may match no account. The row's payload is blanked and `redacted_at` stamped the moment the task reaches a terminal state, usually within the minute; what remains is a hash-derived dedupe key, not an address. `TASK_OUTBOX_RETENTION_DAYS` deletes the skeleton afterwards.
- Provider credentials are ordinary secrets: DigitalOcean injects them as secret app variables and Yandex binds them from Lockbox; they never belong in the repository. Rotating them takes effect on the next runtime revision/process start.
- A single `to` address per message is the port's whole model. There is no cc, no bcc, and no batch send, so one message can never reach an unintended recipient through a shared list.

## Current Upstream Documentation

- [Yandex Cloud Postbox — sending an email](https://yandex.cloud/en/docs/postbox/operations/send-email)
- [Yandex Cloud Postbox — API authentication](https://yandex.cloud/en/docs/postbox/api-ref/authentication)
- [Yandex Cloud Postbox — quotas and limits](https://yandex.cloud/en/docs/postbox/concepts/limits)
- [Resend — send an email](https://resend.com/docs/api-reference/emails/send-email)
- [Resend — errors](https://resend.com/docs/api-reference/errors)
