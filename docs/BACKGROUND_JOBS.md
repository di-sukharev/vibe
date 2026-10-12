# Background jobs

Use after-response tasks for work that can be lost. Use the outbox for promised work that must survive a restart. Use scheduled jobs for recurring maintenance.

## Processes and schedules

Declare jobs in [backend/src/jobs.ts](../backend/src/jobs.ts). Keep schedules in [job-schedules.json](../backend/src/job-schedules.json). Run one job with:

```bash
bun run --cwd backend start:cron -- outbox:drain
```

`start:scheduler` runs the schedule in a persistent process. `start:worker` runs `workerLoops`, which are empty by default. Use worker loops for intervals below one minute or independent loops.

`start:cron -- --http <job>` accepts provider timer calls. Only `POST /` runs the job. Success returns 204; failure returns 503 so the timer can retry.

Scheduled jobs hold PostgreSQL advisory locks. A run that exceeds its lock timeout can overlap another run. Keep jobs safe to repeat. Worker loops take the lock only with `singleInstance: true`.

## Add a job

Add the implementation to `backgroundJobs`. Use the supplied runtime or load adapters inside the job. Keep top-level imports in `jobs.ts` type-only.

For a schedule, add a unique key to `job-schedules.json`. Keep both cron expressions on the same UTC schedule. Set `lockTimeoutMs` above the provider execution timeout. Update the Yandex timer tests when the number or limits change.

A new Yandex job creates a container and timer at the next release. Check scoped environment targets in [Deployment](DEPLOYMENT.md#extra-runtime-variables).

## Outbox tasks

`outbox:drain` claims due `task_outbox` rows and runs handlers from [handlers.ts](../backend/src/outbox/handlers.ts). It provides retries, not strict ordering or exactly-once delivery.

Add a handler to `taskHandlers`. Load its implementation inside `run`. Enqueue through `enqueueTask(tx, { type, dedupeKey, payload })` in the transaction that promises the work. Do not insert task rows through raw SQL: the enqueue helper maintains the lease timestamps.

Validate the JSON payload. Make repeated execution harmless. Pass `signal` to provider calls and keep their deadlines below the stale-lease timeout. Throw `TerminalTaskError` only when retry cannot help. Compensate before a terminal failure and on the final attempt.

Handlers use five attempts by default. Set `maxAttempts` to a number for another limit or to `null` to retry transient failures until success. Object deletion uses `null`: the task is its only remaining cleanup record. Invalid payloads still fail immediately. Monitor its backlog during storage outages.

The pair `(type, dedupeKey)` is unique until retention removes the row. Use a permanent product record when duplicate prevention must outlive that retention. Keep personal data out of errors because `last_error` outlives the payload.

Tests in `backend/src/outbox/outbox.integration.test.ts` cover claims and retries. Password-reset handlers show provider failure and compensation behavior.

## Anonymous requests

Anonymous enqueue endpoints need a global backlog limit as well as IP rate limits. Follow the password-reset implementation. Derive dedupe keys from submitted input, without an account lookup.

Password reset returns the same 202 when the queue is full. Without a working drain, new messages can remain silently rejected. Keep API and scheduler batch limits equal.

## Operations

Local backend development starts the scheduler. DigitalOcean runs it as an App Platform worker. Yandex runs each scheduled job through a timer and HTTP container.

On a private server, run `start:scheduler` under a supervisor with `NODE_ENV=production`. Allow shutdown time for running jobs. An empty schedule exits immediately and can cause a supervisor restart loop. Run maintenance even when email is disabled.

Read drain metrics in the job logs:

| Metric | Action |
| --- | --- |
| Growing `backlog` | Increase the batch limit or shorten the interval |
| `terminalFailed` | Inspect the row's `last_error` |
| `unhandled` | Deploy a runner that supports the queued type |
| `recoveredStale` | Investigate a runner that stopped while holding tasks |

Provider alerts are in [DigitalOcean](DIGITALOCEAN.md) and [Yandex Cloud](YANDEX_CLOUD.md). They do not inspect outbox metrics.
