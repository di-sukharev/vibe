# Background jobs

This guide covers work outside the request: after-response tasks, the outbox, and scheduled jobs.

## Choose the mechanism

Choose by the cost of a lost task:

- After-response task, `backend/src/background-tasks.ts`: work you can lose. `defer()` runs it after the response, without retries.
- Outbox task, `backend/src/outbox/`: promised work you must not lose. It survives restarts and retries.
- Scheduled job, `backend/src/jobs.ts`: recurring maintenance.

## Jobs

Declare a job once in `backend/src/jobs.ts`. Three processes run it:

- `cron.ts` runs one job and exits non-zero on failure. `--http <job>` serves a provider timer: only `POST /` runs the job and returns 204, other paths get 404, and other methods get 405. A failure returns 503, so the timer retries.
- `scheduler.ts` runs the schedule in a long-running process.
- `worker.ts` runs `workerLoops`, empty by default, for intervals under one minute or parallel loops.

[`backend/src/job-schedules.json`](../backend/src/job-schedules.json) is the only schedule, in UTC. Run one job by hand: `bun run --cwd backend start:cron -- <job>`.

Each run holds a PostgreSQL advisory lock for its job, so parallel schedulers are safe. The lock expires after `lockTimeoutMs`, or 15 minutes without a schedule entry. A longer run can then start twice. Keep jobs short and idempotent. Worker loops take the lock only with `singleInstance: true`.

### Add a job

1. Add an entry to `backgroundJobs`. Keep imports in `jobs.ts` type-only. Use `runtime` or `await import()` in the job body.
2. Test it like `backend/src/jobs.integration.test.ts`.
3. To schedule it, add an entry to `job-schedules.json` with a unique `key`, which names the Yandex container and timer. Give `expression` and `yandexExpression` the same UTC schedule, because nothing compares them. `lockTimeoutMs` must exceed `yandexExecutionTimeoutSeconds` × 1000. Update the timer count and timeouts in `infra/yandex/runtime/tests/runtime.tftest.hcl`. The next Yandex `release` adds a container and a timer.

## Outbox

The `outbox:drain` job claims each due `task_outbox` row, runs its handler, and records the result. The outbox is not for strict ordering, long waits, or bulk sends with receipt polling.

Shipped task types, in `backend/src/outbox/handlers.ts`:

- `auth:password-reset` is queued for any submitted address while email is configured. The handler finds the account, creates a token, and sends the link.
- `auth:password-changed` is queued in the transaction that completes a reset, keyed on the used token. It sends a notice.
- `website:rebuild` is a commented-out example for [Website rebuild](#website-rebuild).

### Add a task type

1. Add an entry to `taskHandlers`. Copy the shape of `auth:password-changed`. Load the module with `await import()` inside `run`, never with a top-level import.
2. Call `enqueueTask(tx, { type, dedupeKey, payload })` in the transaction that promises the work. Never insert rows with raw SQL, because Prisma sets `updated_at`, the lease clock.
3. Test it like `backend/src/modules/auth/application/auth-service.test.ts` and `backend/src/outbox/outbox.integration.test.ts`.

### Handler rules

- A task runs at least once. Make the handler idempotent or harmless to repeat.
- Validate `payload`, which is raw JSON. Throw `TerminalTaskError` when a retry cannot help. Other errors retry.
- The default is 5 attempts (`maxAttempts`). Retries come after 2, 4, 8, and 15 minutes, plus up to 50% jitter. Keep the first retry after the 60-second password-reset cooldown.
- Compensate when `finalAttempt` is true, and before you throw `TerminalTaskError`.
- Pass `signal` to every provider call. It aborts at `deadlineMs`, 15 seconds by default, which must stay well below `TASK_OUTBOX_LEASE_STALE_MS`.
- Return `'skipped'` for a deliberate no-op.
- Keep personal data out of errors. `last_error` outlives the cleared payload.

### Dedupe keys

`(type, dedupeKey)` is unique. A duplicate enqueue returns the existing row.

- `invoice:<id>` merges duplicates until retention deletes the row. To block a repeat permanently, record it in a product table.
- `<hash>:<time bucket>` merges a burst. Password reset uses the address hash and 60-second buckets.

Derive the key from request input, never from an account lookup, which would reveal registered addresses.

### Anonymous enqueue

Endpoints that anonymous clients call must limit what they enqueue. Per-IP rate limits are not enough. Follow the password-reset pattern.

Password reset queues a task for any address, so the response does not reveal accounts. It admits a row only while fewer due `auth:password-reset` rows exist than one drain pass takes: `TASK_OUTBOX_BATCH_LIMIT` × 5, 250 by default. Above this cap, it returns the same 202 and writes and logs nothing. The count ignores the address.

- A flood can leave a real user without an email.
- Without a drain, the cap stays full and new requests are dropped silently.
- On your own server, give the API and the scheduler the same `TASK_OUTBOX_BATCH_LIMIT`.

## Running the drain

`outbox:drain` is an ordinary scheduled job. Both Terraform stacks deploy its runner:

- Local: `bun run dev` starts the scheduler next to the API.
- DigitalOcean: an App Platform worker runs `bun run start:scheduler`, because scheduled jobs there run at most every 15 minutes. Alerts: [DIGITALOCEAN](DIGITALOCEAN.md).
- Yandex Cloud: a timer and an HTTP container, `cron.ts --http <job>`, per schedule entry. Alerts are manual: [YANDEX_CLOUD](YANDEX_CLOUD.md).
- Under one minute: a `workerLoops` entry with `intervalMs` and `singleInstance` off, run by `start:worker`, which no stack deploys. Row claims protect concurrent drains.
- Your own server: under systemd with `Restart=always`, run `bun run --cwd backend start:scheduler`. Under Docker, run the API image with `bun run start:scheduler` and `restart: unless-stopped`.
  - Set the backend environment and `NODE_ENV=production`. Without it, `EMAIL_DELIVERY=console` is allowed and prints reset links instead of sending.
  - `SIGTERM` waits for running jobs. Allow a stop timeout as long as the slowest job.
  - With no schedules, the scheduler exits at once, and a restart policy loops it. The same applies to `start:worker` with no `workerLoops`.
  - Configure supervisor alerts. A stopped scheduler is silent.

Run the scheduler even with `EMAIL_DELIVERY=disabled`: the cleanup jobs need it.

More drains add resilience, not throughput: a pass handles at most `TASK_OUTBOX_BATCH_LIMIT` × 5 rows. For a growing `backlog`, raise the batch limit or shorten the interval. Record the measurement before you add a queue ([ARCHITECTURE](ARCHITECTURE.md)).

## Observability

Each pass logs `Job outbox:drain completed.` and a metrics object. No alert reads the metrics; check the logs:

- `backlog` grows across passes, or `claimed` equals the pass capacity with mostly `skipped` rows (a reset flood): raise the batch limit or shorten the interval.
- `terminalFailed` > 0: a task gave up. Read `last_error` in `task_outbox`.
- `unhandled` > 0: the API queued a type this runner cannot handle. Deploy the new runner.
- `recoveredStale` > 0: a runner died holding rows, which were requeued.

## Website rebuild

`Automatic SSG rebuild` is `absent` in [CHECKLIST](../CHECKLIST.md). Build it only on request, to this specification:

1. A state row, the source of truth, holds `desiredRevision`, `publishedRevision`, and the ID, status, and revision of the active deployment.
2. The transaction that publishes data advances `desiredRevision` and enqueues a unique `website:rebuild:<revision>` task. The task only starts a short reconcile pass. Never wait for a build inside an outbox attempt.
3. The pass locks the state row and allows one active deployment, checked by ID. After an ambiguous start, it finds that deployment at the provider instead of starting another.
4. The build reads a consistent public snapshot and its database revision from the backend. The provider builds an immutable release and switches to it atomically or blue-green. Never overwrite the live site in place.
5. After the provider reports success, read the release's revision marker through the public domain with cache bypass. Only then set `publishedRevision`.
6. If `desiredRevision` is newer, start exactly one follow-up deployment, so an old build never replaces a newer one.
7. A periodic `website:rebuild:reconcile` job runs the same pass after restarts, lost signals, deleted rows, and long builds.

Provider adapters:

- DigitalOcean: `POST /v2/apps/{app_id}/deployments` rebuilds the website app from Git. Track the deployment and check its revision. The build must fetch its data from the backend.
- Yandex Cloud: releases build on the operator's machine, so first add a separate protected builder. Keep the website source, toolchain, and broad storage keys out of the backend runtime.

For which data may be static, and for fresher data, see [WEB_SURFACES](WEB_SURFACES.md).
