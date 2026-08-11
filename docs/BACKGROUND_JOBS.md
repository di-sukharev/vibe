# Background Jobs

Work that happens without a user waiting for it: cleaning up expired sessions, retrying a delivery,
refreshing something on a timer. This document is provider-neutral — the same jobs run on
DigitalOcean, on Yandex Cloud, and on your own server.

## Three ways to work off the request path

Two of them are not this document's job registry, and picking the wrong one is the mistake worth
avoiding. The question is what happens if the work is lost.

| | `background-tasks.ts` | `outbox` | `jobs.ts` |
| --- | --- | --- | --- |
| Survives a restart | no | **yes** | n/a, it runs again on the next tick |
| Retries | none | until it succeeds or gives up | next tick |
| Starts | immediately after the response | on the next drain | on a schedule |
| Idempotency | none | a dedupe key you choose | job's own business |
| Use it for | work whose loss is acceptable | work you promised someone | recurring upkeep |

Losing a best-effort cleanup costs a stray file. Losing a password-reset email costs a user their
account. The first is `background-tasks.ts`; the second is the outbox.

## One registry, three processes

A job is declared once, in `backend/src/jobs.ts`. It says *what* to do and never *when* or *where*:

```ts
export const backgroundJobs = {
  'auth:sessions:cleanup': async ({ env, prisma }, now) => { /* … */ },
  'uploads:pending:cleanup': async ({ prisma, privateStorage }, now) => { /* … */ },
} satisfies Record<string, BackgroundJob>
```

Three processes run that same registry. Which one you use is a hosting decision, not a code change.

| Process | Shape | Use it when |
| --- | --- | --- |
| `backend/src/cron.ts` | One shot: starts, runs one job, exits. | A provider timer already exists — a DigitalOcean scheduled job, a Yandex timer trigger, a system crontab. Cheapest option: nothing runs between ticks. |
| `backend/src/scheduler.ts` | Long-running process with timers inside. | You want schedules to live in the repository instead of a cloud console, or you run on your own server. Also the natural fit for a cloud worker component. |
| `backend/src/worker.ts` | Long-running loop. | Work must run more often than once a minute, must run continuously, or several jobs should run side by side. No cron expression goes below one minute — this is the way around that. |

The scheduler ships with **one** entry, `outbox:drain` every minute, which is the worked example
for the rest of this document and the reason a password-reset email leaves at all. The worker
ships **empty**: `workerLoops` contains only a commented example, so an install that never needs
sub-minute work pays nothing for it.

Neither process starts itself. Shipping the entry decides *what* runs; a deployment still has to
run the process — see "Running the drain" below.

## The push pipeline is the exception

`bun run --cwd backend start:worker:notifications` runs the Expo push outbox and receipt check, and
it is **not** a `workerLoop`. Do not reimplement it as one: an interval is all a loop gets, and this
pipeline needs more. Outbox processing is handed the shutdown `AbortSignal` and a runtime budget
derived from `SHUTDOWN_GRACE_SECONDS`, so a long batch is cut short cleanly instead of being killed
mid-send with its retry state unpersisted, and quiet periods emit a sparse heartbeat rather than a
log line per poll. It lives in `worker.ts` alongside the loops, selected by the `notifications`
argument.

The same work is also available as the `notifications:process` job in the registry, for installs
that would rather have a provider timer poke it every few minutes than keep a process alive. That
is the trade: timely delivery versus one less thing to supervise.

## Adding a job

1. Add an entry to `backgroundJobs` in `backend/src/jobs.ts`.
2. Cover it with a fake Prisma client the way `auth:sessions:cleanup` is covered in
   `backend/src/jobs.test.ts`; a job with real logic deserves its own test file next to it.
3. Give it a runner — see the next section.

Run it once by hand at any time: `bun run --cwd backend start:cron -- <job>`.

## Choosing a runner, with the honest trade-offs

**Provider timer + `cron.ts`.** The platform owns the schedule, so a crashed container does not
stop the next tick. In return the schedule lives outside your repository, and each provider has its
own dialect: DigitalOcean App Platform refuses anything more frequent than every 15 minutes, and
Yandex timer triggers take a six-field UTC expression, not the five-field one you are used to.

**`scheduler.ts` on your own server or a cloud worker.** Schedules are versioned and reviewed with
the code, local runs behave exactly like production, and moving between providers touches nothing.
The cost is that the process is now yours to keep alive: put it under systemd or a Docker restart
policy, and alert on "the job has not reported success recently" — a stopped scheduler is silent.
Two copies of the process are handled: each job takes a Postgres advisory lock before running, so a
rolling deploy cannot run the same job twice, and the copy that loses the race logs that it skipped.

**`worker.ts`.** The only option below one-minute granularity, and the right one for continuous
processing. Same operational duties as the scheduler, with one difference to know: loops run
without the database lock by default, so scaling the worker to two instances runs every loop twice.
That is often what you want for parallel throughput; when it is not, set `singleInstance: true` on
the loop and it takes the same lock the scheduler uses. Add your own backpressure if a loop can
fall behind its own interval.

Whatever you pick, keep locked jobs short. The advisory lock is held by an open transaction for
the length of the run, so a long job holds a connection - and, more importantly, the lock only
lasts as long as `timeoutMs` (15 minutes by default). A job that outruns it loses the lock while
still working: another instance can start the same job, and the first one then fails with a
transaction-expired error after its side effects have already landed. The scheduler recognises that
case and says so in the log instead of reporting a generic failure, but the fix is yours: raise
`timeoutMs` for that entry, or make the job idempotent.

## Running the scheduler on your own server

```bash
bun run --cwd backend start:scheduler
```

Under systemd, the unit needs `Restart=always`, `NODE_ENV=production` (without it the backend
still accepts `EMAIL_DELIVERY=console`, so a real install could write reset links to a log instead
of sending them), the backend environment, and a working directory of
`backend`. Under Docker, the same image the API uses with the command overridden and
`restart: unless-stopped`. The shipped `schedules` already has an entry, so the process stays up;
if you empty the list it logs that it has nothing to do and exits, and a restart policy turns that
into a loop. On `SIGINT`/`SIGTERM` the scheduler stops its timers, waits for jobs
already in flight to finish, and only then closes the database - so give the process a shutdown
grace period at least as long as your slowest job.

## The task outbox

Durable one-off work, in one PostgreSQL table. Not a queue service - `docs/ARCHITECTURE.md`
explains why the template reaches for a table first and what would justify more.

A row is claimed by whichever drain gets there first, run once, and written back. Two drains can
run at the same time safely: the claim is a conditional update, so the loser simply moves on.

### Adding a task type

1. Add an entry to `taskHandlers` in `backend/src/outbox/handlers.ts`:

```ts
'invoices:send': {
  maxAttempts: 5,
  run: async ({ payload, finalAttempt, now, signal }, runtime) => {
    const { createInvoiceTasks } = await import('../modules/invoices')
    await createInvoiceTasks(runtime).send(payload, { signal })
  },
},
```

   Import the module **inside** `run`. A top-level import of `../modules/*` would load that
   module into every process that can enqueue.

2. Enqueue it from wherever the work is decided:

```ts
await enqueueTask(prisma, { type: 'invoices:send', dedupeKey: `invoice:${id}`, payload: { id } })
```

3. Cover the handler the way `auth:password-reset` is covered in
   `backend/src/modules/auth/application/auth-service.test.ts`.

There is no migration: the type is a text column validated against the registry. A typo throws at
the call site, naming the types that exist.

Always enqueue through `enqueueTask`. A raw `INSERT` has to set `updated_at` itself - it is the
lease clock, and Prisma, not the database, is what fills it in.

### What the handler is promised, and what it must promise back

- **At least once, not exactly once.** A process killed after the side effect but before the
  completion write will run the task again. Make the work idempotent, or make a duplicate
  harmless. This is the one rule that cannot be moved into the framework.
- `finalAttempt` tells the handler its failure is the last one, so compensating work happens
  there and only there. Password reset uses it to invalidate a token that will never be received.
- `signal` aborts at the type's `deadlineMs` (15s by default). Pass it to every provider call.
- Returning `'skipped'` says the handler deliberately did nothing. Without it, a system where
  every task finds nothing to do looks exactly like a healthy one.
- A row that gives up keeps `lastError` as its dead-letter diagnostic for the retention window,
  while the payload is blanked immediately. Whatever your handler lets escape ends up there - and
  a provider error rethrown verbatim often quotes the recipient, which would outlive the payload
  it was redacted with. Wrap or trim provider errors that can carry personal data.
- Throwing retries. Throwing `TerminalTaskError` gives up immediately - for work that can never
  succeed, such as a payload that will not validate.
- Five attempts by default, so four retries: 2, 4, 8 and 15 minutes apart, with jitter that only
  ever adds. The lower bound is
  load-bearing: the first retry has to clear the 60-second password-reset cooldown.

### Dedupe keys

`(type, dedupeKey)` is unique, and enqueueing an existing pair returns the existing row instead of
failing. The key is how you choose the window:

- a natural identity - `invoice:<id>` - collapses for as long as the row exists, which is
  `TASK_OUTBOX_RETENTION_DAYS`. The sweeper deletes the row and the uniqueness with it, so this is
  not a permanent once-only guard; if the work must never happen twice, keep that fact in your own
  tables;
- a time bucket - `<hash>:<minute>` - collapses a burst, which is what password reset does;
- a random value never collapses.

Derive the key from what the caller submitted, never from what you looked up: a key that depends
on whether an account exists is an oracle for which addresses are registered.

### Running the drain

`outbox:drain` is an ordinary job, so every runner in the table above can run it. The template
ships the second row already configured - `schedules` in `scheduler.ts` runs it every minute, and
`bun run dev` starts that process next to the API. What is left is deploying it. Latency is
whatever the schedule allows:

| Hosting | How | Achievable |
| --- | --- | --- |
| Local development | `bun run dev` runs the scheduler alongside the API | 1 minute |
| Own server, Yandex Cloud | the shipped `scheduler.ts` entry, or a timer trigger `* * ? * * *` | 1 minute |
| DigitalOcean worker component | `bun run start:scheduler`, accepted as shipped | 1 minute |
| DigitalOcean scheduled job | `*/15 * * * *` | **15 minutes - the platform floor** |
| Anywhere, sub-minute | a `workerLoops` entry with `intervalMs` | seconds |

**A password-reset email arriving fifteen minutes late is not acceptable**, so a DigitalOcean
install that wires an email provider needs the worker component, not the scheduled job. An install
with no provider can leave the drain on a slow schedule, or not run it at all - the table stays
empty because `requestPasswordReset` writes nothing while delivery is unconfigured.

The worker component and the loop worker are different things: the component runs
`bun run start:scheduler`, which the deployment generator accepts as shipped, while
`bun run start:worker` stays refused until `workerLoops` has an entry.

If you use a `workerLoops` entry, leave `singleInstance` off. It looks like the careful choice and
is the wrong one: the job lock would serialise the whole outbox across instances and throw away
the per-row claim that already makes parallel drains safe.

Running several drains buys resilience, not throughput. They read the same ordered window of due
rows and mostly lose claims to each other, so one pass moves at most
`TASK_OUTBOX_BATCH_LIMIT * 5` rows however many drains you start - measured at ~250 rows whether
one drain runs or eight. If `backlog` is climbing, raise `TASK_OUTBOX_BATCH_LIMIT` or shorten the
interval; adding instances will not help, and the measurement is what `docs/ARCHITECTURE.md` asks
you to record before reaching for a queue service.

### What to watch

Each pass logs one line. Three numbers matter:

- `backlog` climbing across consecutive runs - the drain cannot keep up. That is the measurement
  `docs/ARCHITECTURE.md` asks for before reaching for a queue service.
- `terminalFailed` above zero - work was given up on. `lastError` on the row says why.
- `unhandled` above zero - rows are queued for a type this deployment has no handler for, which
  means an API is ahead of its runner. Roll the runner forward.

Tuning lives in `TASK_OUTBOX_*` (see `backend/.env.example`). One invariant holds them together:
a task's `deadlineMs` must stay well inside `TASK_OUTBOX_LEASE_STALE_MS`, or a second drain could
claim a row whose first runner is still working. The code floors the lease at twice the slowest
deadline so the two cannot cross.

### What this table is not for

Work that fans out to N recipients and then polls each one for a delivery receipt is a two-level
problem, and squeezing it in here would mean a row that is partly done. The `mobile` branch's Expo
push pipeline is exactly that case and keeps its own tables.

## Rebuilding a static site

Read the cross-surface contract in [WEB_SURFACES.md](WEB_SURFACES.md) before implementing this
capability. It defines which data may enter static output and when rebuild is part of the owning
product write flow.

The website ships as static output, and rung one of its freshness ladder is "rebuild and
redeploy". If a project ever needs that rebuild to happen automatically, implement a durable
controller rather than treating one outbox attempt as the whole deployment. Its state row stores
`desiredRevision`, `publishedRevision`, and the active provider deployment id/status/revision. The
publishing transaction advances `desiredRevision` and enqueues a uniquely keyed
`website:rebuild:<revision>` wake-up. The wake-up runs one short reconcile pass; a configured
`website:rebuild:reconcile` recurring job runs the same pass to recover after restarts, lost
wake-ups, expired terminal rows, or hosted builds longer than an outbox deadline.

The controller allows at most one provider deployment at a time. It adopts an ambiguously triggered
deployment instead of blindly sending another, records the provider id, and polls on later passes.
The backend build snapshot returns its actual revision. The provider builds an immutable revisioned
artifact and promotes it atomically or through an equivalent blue-green release; an in-place
recursive upload is not safe enough. The artifact contains that revision in a cache-busted public
marker, and provider success is accepted only after promotion and marker verification. Then the
controller advances `publishedRevision`; if `desiredRevision` is newer, it starts one follow-up.
This single-flight state machine prevents a slow older deployment from overwriting a newer one.
`backend/src/outbox/handlers.ts` carries only a commented shape; it is documentation, not an enabled
controller or provider adapter.

The template documents this instead of shipping it, because the two hosting paths are not one
feature:

- **DigitalOcean** builds the site from Git, so the adapter triggers a deployment through
  `/v2/apps/{app_id}/deployments`, tracks the returned deployment to success, and reconciles the
  deployed revision. The build runs from your branch, so database content appears only when the
  site fetches it at build time.
- **Yandex Object Storage** has no remote build. The shipped path supports manual local
  build/upload only. Automatic rebuild remains unavailable until the project adds the dedicated,
  authenticated builder described in `YANDEX_CLOUD.md`; the backend runtime container must not
  grow a website toolchain and broad storage credentials for this purpose.

Before building either, check you need it. If the site must be fresher than a deploy cycle, climb
the ladder in `website/README.md` - cached SSR with `stale-while-revalidate`, then server islands -
rather than building a rebuild pipeline. Neither hosting offers per-page ISR.

## Provider specifics

- DigitalOcean: [docs/DEPLOYMENT.md](DEPLOYMENT.md) — "Backend Worker And Cron". `bun run deploy:do:specs`
  generates the scheduled job or worker component and validates the schedule before you deploy.
- Yandex Cloud: [docs/YANDEX_CLOUD.md](YANDEX_CLOUD.md) — "Automatic website rebuild". The baseline
  is manual build/upload; automatic rebuild requires a separate builder component before the
  capability can leave `absent`.

## Upstream documentation

- DigitalOcean App Platform jobs: https://docs.digitalocean.com/products/app-platform/how-to/create-jobs/
- DigitalOcean App Platform workers: https://docs.digitalocean.com/products/app-platform/concepts/worker/
- Yandex Serverless Containers timer trigger: https://yandex.cloud/en/docs/serverless-containers/operations/timer-create
- systemd timers: https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html
- Docker restart policies: https://docs.docker.com/engine/containers/start-containers-automatically/
- croner, the scheduler library used here: https://github.com/hexagon/croner
- PostgreSQL advisory locks: https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS
