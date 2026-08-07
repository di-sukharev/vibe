# Background Jobs

Work that happens without a user waiting for it: cleaning up expired sessions, retrying a delivery,
refreshing something on a timer. This document is provider-neutral — the same jobs run on
DigitalOcean, on Yandex Cloud, and on your own server.

## One registry, three processes

A job is declared once, in `backend/src/jobs.ts`. It says *what* to do and never *when* or *where*:

```ts
export const backgroundJobs = {
  'auth:sessions:cleanup': async ({ env, prisma }, now) => { /* … */ },
} satisfies Record<string, BackgroundJob>
```

Three processes run that same registry. Which one you use is a hosting decision, not a code change.

| Process | Shape | Use it when |
| --- | --- | --- |
| `backend/src/cron.ts` | One shot: starts, runs one job, exits. | A provider timer already exists — a DigitalOcean scheduled job, a Yandex timer trigger, a system crontab. Cheapest option: nothing runs between ticks. |
| `backend/src/scheduler.ts` | Long-running process with timers inside. | You want schedules to live in the repository instead of a cloud console, or you run on your own server. Also the natural fit for a cloud worker component. |
| `backend/src/worker.ts` | Long-running loop. | Work must run more often than once a minute, must run continuously, or several jobs should run side by side. No cron expression goes below one minute — this is the way around that. |

The scheduler and the worker are shipped **empty**: `schedules` and `workerLoops` contain only a
commented example. An install that never needs recurring work pays nothing for them.

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

Under systemd, the unit needs `Restart=always`, the backend environment, and a working directory of
`backend`. Under Docker, the same image the API uses with the command overridden and
`restart: unless-stopped`. Add the entry to `schedules` before you set either up: with the list
still empty the process logs that it has nothing to do and exits, and a restart policy turns that
into a loop. On `SIGINT`/`SIGTERM` the scheduler stops its timers, waits for jobs
already in flight to finish, and only then closes the database - so give the process a shutdown
grace period at least as long as your slowest job.

## Provider specifics

- DigitalOcean: [docs/DEPLOYMENT.md](DEPLOYMENT.md) — "Backend Worker And Cron". `bun run deploy:do:specs`
  generates the scheduled job or worker component and validates the schedule before you deploy.
- Yandex Cloud: [docs/YANDEX_CLOUD.md](YANDEX_CLOUD.md) — "Background Jobs And The Cleanup Timer". A second
  container in task mode plus a timer trigger, provisioned by hand.

## Upstream documentation

- DigitalOcean App Platform jobs: https://docs.digitalocean.com/products/app-platform/how-to/create-jobs/
- DigitalOcean App Platform workers: https://docs.digitalocean.com/products/app-platform/concepts/worker/
- Yandex Serverless Containers timer trigger: https://yandex.cloud/en/docs/serverless-containers/operations/timer-create
- systemd timers: https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html
- Docker restart policies: https://docs.docker.com/engine/containers/start-containers-automatically/
- croner, the scheduler library used here: https://github.com/hexagon/croner
- PostgreSQL advisory locks: https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS
