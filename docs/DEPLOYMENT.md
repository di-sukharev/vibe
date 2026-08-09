# Deployment

Use this document only after the user has asked for deployment. Read [CHECKLIST.md](../CHECKLIST.md) first; it records the installed project's active surfaces, deferred surfaces, capabilities, and release targets. Surface READMEs carry the longer explanations behind those answers.

The default production path is DigitalOcean App Platform plus DigitalOcean Managed PostgreSQL. Do not ask the user to choose a cloud provider during first-run setup. Confirm the recorded release scope and production domains; when deployment was deferred at install time those rows are still `_unanswered_`, so ask for them now and write the answers back into the checklist. Then ask only the release details the checklist does not cover:

- which S3-compatible bucket backs private file storage in this release; the backend requires one in production, so this is a choice of provider rather than whether to have storage;
- whether real-time chat, presence, collaboration, live notifications, or WebSocket-style updates must work across multiple backend instances;
- when mobile is active, whether this release covers EAS builds only or App Store / Google Play submission, and which API endpoint the app should point at;
- whether an external CDN is required for advanced bot, rate-limit, or geographic traffic controls.

If mobile is active, switch to the `mobile` branch before mobile release planning.

Local setup from `README.md` and [LOCAL_DATABASE.md](LOCAL_DATABASE.md) does not require cloud credentials.

This document covers the DigitalOcean path. If `CHECKLIST.md` records Yandex Cloud, use [YANDEX_CLOUD.md](YANDEX_CLOUD.md) instead. The supported Yandex Cloud alternative is Serverless Containers for backend/API, Managed Service for PostgreSQL for production data, Object Storage for files and static websites, and Cloud CDN for public static/media delivery.

## If You Chose Another Hosting

The hosting choice is recorded in [CHECKLIST.md](../CHECKLIST.md) and only one path is kept. If the
project runs on Yandex Cloud or an own server, delete the DigitalOcean tooling in one pass.

**Delete these files**

- `scripts/prepare-do-specs.mjs`, `scripts/do-cron.mjs`, `scripts/runner-collections.mjs`, and their
  tests - only the DigitalOcean generator reads runner collections
- `.do/`

**Edit these files** - one bullet each, so nothing is left half-removed:

- root `package.json`: drop the `deploy:do:specs` script. Leaving it behind points at a deleted
  generator, and `scripts/repo-env.test.mjs` fails on exactly that half-removal.
- **this file**: delete every section except the seven below, then clean those seven.
  - "Release Source Preflight" - drop the App Platform paragraph.
  - "Secrets And Backend Env" - `TRUSTED_PROXY_CLIENT_IP_HEADER=do-connecting-ip` is wrong on any
    other ingress, `PRIVATE_STORAGE_ENDPOINT` names a DigitalOcean host, and the storage paragraph mentions
    a `deploy:do:specs` command that no longer exists.
  - "Own Server" - keep as is; on the Yandex path, delete it too.
  - "Production Auth And CORS" - drop the `DO_AUTH_SITE_DOMAIN` sentence.
  - "Real-Time And Horizontal Scaling" - keep the monolith-first and Pub/Sub guidance, drop the
    Managed Valkey provisioning.
  - "Validation" - keep the local checks and the post-deploy list, minus the `deploy:do:specs` and
    `doctl apps spec validate` lines.
  - "Expo / EAS" - keep it; mobile releases go through Expo regardless of who hosts the API.
    Its opening line says mobile deployment is separate from DigitalOcean hosting - reword that to
    name your hosting instead.
  - Then rewrite the opening paragraphs above, which announce DigitalOcean as the default path.
- `docs/BACKGROUND_JOBS.md`: the DigitalOcean bullet under "Provider specifics", the App Platform
  half of the cadence sentence, and the two App Platform links. If the Yandex bullet is gone too, delete the
  now-empty "Provider specifics" heading.
- `docs/YANDEX_CLOUD.md`, when that is the chosen path: the opening sentence comparing the two
  providers, the Dockerfile line that says "the same as the DigitalOcean path", and the storage
  paragraph's note that the service is named around the DigitalOcean default. Keep everything
  else, including "Two details of the timer trigger cost people time" - those are Yandex traps,
  not a comparison.
- `docs/IAP.md`: the DigitalOcean references in the store-credential and validation sections.
- `docs/STORAGE.md`: the DigitalOcean provider specifics. Keep the upload flow, the private/public
  rules, and the storage-service guidance - they are about S3 and about this codebase, not about
  DigitalOcean.
- `webapp/README.md` and the root `README.md`: the DigitalOcean deployment guidance and every
  `bun run deploy:do:specs` mention, including the setup instructions near the top of `README.md`
  that name DigitalOcean as the supported production path.
- `backend/README.md`: the DigitalOcean part of "Deployment", and - in "Runtime Entrypoints" - the
  sentence about deployment generation refusing a runner whose list is empty.
- `website/README.md`: the `.do/backend-app.yaml.example` link and the
  `bun run deploy:do:specs website` command.
- `docs/ARCHITECTURE.md`: the App Platform sizing and component guidance, the DigitalOcean half of
  the Valkey broker sentence, and the Managed Valkey link. Agents are told to read this file for
  non-trivial work, so a leftover here misdirects every future session.
- `AGENTS.md` and `CLAUDE.md`: the App Platform spec-defaults rule and the "anything else means
  DigitalOcean" half of the hosting rule. Keep the two files identical.
- `CHECKLIST.md`: the DigitalOcean row in the hosting table, the option in the recorded-hosting row,
  the DigitalOcean half of the hosting rule, and the App Platform defaults in the agent-owned
  decisions section. Storage stays: it is provider-neutral and every hosting path needs it.
- `backend/src/env.ts` and `backend/.env.example`: the `PRIVATE_STORAGE_*` values, if the project
  also moves object storage. The storage layer is provider-neutral, so this is a configuration
  change rather than a code change.

Finally, sweep for what no list can enumerate:

```bash
rg -n 'DigitalOcean|App Platform|deploy:do:specs|doctl|Spaces|\.do/' --glob '!node_modules'
```

Every hit must either go or become provider-neutral, with four exceptions to leave alone:

- `scripts/repo-env.test.mjs` - its DigitalOcean block is the half-removal guard, and both removal
  lists rely on it;
- `backend/src/jobs.ts` - the one line that matches names all three hostings to explain what a
  job is, and is already provider-neutral;
- `website/astro.config.mjs` - a comment naming both providers next to the static output path;
- `backend/src/db.test.ts`, `backend/src/env.test.ts`, `backend/src/storage/*.test.ts` -
  "DigitalOcean" appears only in test titles about connection strings and S3 URL shapes.

Everything else goes. Keep the storage guidance that is really about S3 and uploads; only the
DigitalOcean specifics go.

When you are done, delete **both** "If You Chose Another Hosting" sections - this one, and the one
in the hosting document you kept. The choice is made; a surviving section tells the project to
delete the tooling it actually uses.

`bun run test:deploy` runs whatever is left in `scripts/`, so no test list needs editing. Run
`bun run typecheck` and `bun run test` afterwards to confirm.

## Release Source Preflight

Before any deployment or cloud-resource update, verify the release source:

```bash
git remote -v
git status --short --branch
```

Deploy only from the intended release branch after the intended commit is pushed and the local branch is in sync with its upstream. If the worktree has modified, deleted, or untracked files, stop and report that deployment is blocked. Do not run `git reset`, `git checkout --`, `git clean`, `git stash`, or equivalent cleanup to make deployment possible unless the user explicitly requested that exact destructive action.

DigitalOcean App Platform builds from the connected Git branch, not from local `dist` folders or uncommitted files. A dirty local checkout can still cause an agent to deploy the wrong branch, generate specs from the wrong release source, or erase another session's work while trying to make the branch clean. The supported failure mode is to stop, not to repair the checkout.

## Secrets And Backend Env

Do not store secrets in the repository. Minimum backend production env:

```bash
DATABASE_URL=postgresql://...
JWT_SECRET=<64-or-more-hex-characters>
CORS_ORIGINS=https://webapp.example.com,https://website.example.com
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=30
REFRESH_REUSE_GRACE_SECONDS=10
SESSION_ABSOLUTE_TTL_DAYS=90
SESSION_RETENTION_DAYS=7
AUTH_BODY_LIMIT_BYTES=65536
INGRESS_RATE_LIMIT_PROVIDER=local
AUTH_RATE_LIMIT_MAX=60
AUTH_RATE_LIMIT_WINDOW_SECONDS=60
ADMIN_USERS_READ_RATE_LIMIT_MAX=120
ADMIN_USERS_READ_RATE_LIMIT_WINDOW_SECONDS=60
IAP_BODY_LIMIT_BYTES=65536
IAP_RATE_LIMIT_MAX=60
IAP_RATE_LIMIT_WINDOW_SECONDS=60
WEBHOOK_BODY_LIMIT_BYTES=262144
WEBHOOK_RATE_LIMIT_MAX=600
WEBHOOK_RATE_LIMIT_WINDOW_SECONDS=60
SHUTDOWN_GRACE_SECONDS=20
TRUST_PROXY=true
TRUSTED_PROXY_CLIENT_IP_HEADER=do-connecting-ip
COOKIE_SECURE=true
```

`CORS_ORIGINS` must include every browser origin that calls the API with credentials. Use exact origins only, for example `https://webapp.example.com`; do not use wildcards, empty values, or paths. Native mobile apps do not need CORS, but Expo web previews or browser-based mobile previews do.

`JWT_SECRET` belongs in the production backend runtime env. Generate it with `openssl rand -hex 32`; that command creates 32 random bytes encoded as 64 hex characters. Do not use the placeholder from `backend/.env.example`, repeated characters, or human phrases.

`TRUSTED_PROXY_CLIENT_IP_HEADER` must name the header your ingress actually sets, otherwise auth/webhook ingress limits and session metadata are scoped to the ingress instead of the client. DigitalOcean App Platform puts the real client address in `do-connecting-ip` and uses `X-Forwarded-For` for the ingress server itself, so keep `INGRESS_RATE_LIMIT_PROVIDER=local` and `TRUSTED_PROXY_CLIENT_IP_HEADER=do-connecting-ip` on this path. Behind Yandex Serverless Containers or your own reverse proxy the value is `x-forwarded-for`; change it together with the hosting, and set `TRUST_PROXY=false` if nothing trustworthy sits in front of the backend.

With `INGRESS_RATE_LIMIT_PROVIDER=local`, `AUTH_RATE_LIMIT_*`, `IAP_RATE_LIMIT_*`, `WEBHOOK_RATE_LIMIT_*`, and `ADMIN_USERS_READ_RATE_LIMIT_*` use bounded in-process maps. The admin directory budget is shared by all sessions and search filters for the same administrator, but none of these budgets is global across multiple backend processes. Replace the ingress budgets with a trusted edge/WAF policy or shared state before scaling the API to multiple instances. The only other value, `yandex-sws`, exists for a Yandex Cloud deployment fronted by Smart Web Security: it disables the backend's IP-keyed ingress budgets on the assumption that the edge enforces them, while body limits and the administrator-keyed directory budget stay on. Do not set it on any other hosting - nothing would be enforcing those limits.

Object storage is required, not optional: the image runs with `NODE_ENV=production`, where the backend refuses the filesystem storage driver because a container disk does not survive a redeploy. `bun run deploy:do:specs` refuses to generate a backend spec without this group.

```bash
PRIVATE_STORAGE_DRIVER=s3
PRIVATE_STORAGE_REGION=nyc3
PRIVATE_STORAGE_BUCKET=<project-prod>
PRIVATE_STORAGE_ENDPOINT=https://nyc3.digitaloceanspaces.com
PRIVATE_STORAGE_ACCESS_KEY_ID=<storage-access-key>
PRIVATE_STORAGE_SECRET_ACCESS_KEY=<storage-secret-key>
PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT=true
PRIVATE_STORAGE_FORCE_PATH_STYLE=false
PRIVATE_STORAGE_UPLOAD_MAX_BYTES=5242880
PRIVATE_STORAGE_UPLOAD_URL_TTL_SECONDS=900
PRIVATE_STORAGE_DOWNLOAD_URL_TTL_SECONDS=300
```

Export the complete group before generating specs. On DigitalOcean, `bun run deploy:do:specs backend-final` rejects partial storage configuration, writes access credentials as `SECRET`, and gives the group to the API service only. Current notification, billing, and maintenance background commands do not consume Spaces, so their worker/cron components do not receive storage credentials. Add an explicit command-to-env mapping and tests before a future storage-consuming background command is deployed.

If native subscriptions are active, export the complete group for each enabled store before generating
the production backend spec:

```bash
APPLE_IAP_BUNDLE_ID=com.example.app
APPLE_IAP_APP_APPLE_ID=1234567890
APPLE_IAP_ENVIRONMENT=Production
APPLE_IAP_ISSUER_ID=<issuer-id>
APPLE_IAP_KEY_ID=<key-id>
APPLE_IAP_PRIVATE_KEY_BASE64=<base64-p8-private-key>
APPLE_IAP_PRODUCT_IDS=com.example.app.premium.monthly,com.example.app.premium.yearly

GOOGLE_PLAY_PACKAGE_NAME=com.example.app
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64=<base64-service-account-json>
GOOGLE_PLAY_PRODUCT_IDS=com.example.app.premium
GOOGLE_PLAY_BASE_PLAN_IDS=monthly,yearly
```

The generator treats each store as an atomic configuration group, rejects App Store Sandbox in a
production spec, marks credential payloads as `SECRET`, and points Apple verification at the public
root certificates bundled in the backend image. App Store credentials stay on the API. Google Play
credentials also go to `maintenance:process` when Google Play is configured (and to
`billing:google-play:reconcile` once subscriptions are turned on), but never to workers, unrelated cron jobs, static sites, or any `EXPO_PUBLIC_*`
variable.

## Own Server

Chosen when the project wants full control and no vendor lock-in. There is no generator and no
managed platform here: every step below is yours to run and to keep running.

- **Backend.** Build `backend/Dockerfile` from the repository root and run it with the env group
  from "Secrets And Backend Env". Behind a reverse proxy set `TRUST_PROXY=true` and
  `TRUSTED_PROXY_CLIENT_IP_HEADER=x-forwarded-for`; with the container exposed directly, set
  `TRUST_PROXY=false`.
- **Database.** PostgreSQL 18 or newer, because primary keys use `uuidv7()`. Apply migrations with
  `bun run --cwd backend db:deploy` as a step before the new container starts serving, never with
  `prisma migrate dev`. Take backups yourself and restore-test them; nobody else will.
- **TLS and domains.** Terminate TLS at the proxy (Caddy or nginx with certbot) and keep the API
  and the browser app under one registrable domain, as "Production Auth And CORS" requires.
- **Static surfaces.** `bun run build:webapp` and `bun run build:website` produce plain directories;
  serve them from the same proxy with `index.html` as the SPA catch-all for the webapp.
- **Background jobs.** Run `bun run --cwd backend start:scheduler` as its own service - see
  [BACKGROUND_JOBS.md](BACKGROUND_JOBS.md) for the systemd and Docker recipes.
- **Uploads.** `backend/src/storage` speaks S3 through a provider-neutral port, so any S3-compatible object storage
  works; see [STORAGE.md](STORAGE.md).

Alert on the backend health endpoint and on "the scheduled job has not reported success recently".
A managed platform surfaces a crash loop for you; here, silence looks exactly like success.

## DigitalOcean App Platform

Prerequisites:

1. DigitalOcean account with billing enabled.
2. A project and region chosen close to the expected users.
3. `doctl` installed and authenticated:

```bash
doctl auth init
```

4. DigitalOcean App Platform GitHub integration connected in the DigitalOcean Dashboard, with access to the user's repository before `doctl apps create`. Without this, `doctl apps create` can fail with `GitHub user not authenticated`.
5. DigitalOcean Managed PostgreSQL for production. Do not use App Platform dev databases for production data.
6. DigitalOcean Spaces Standard Storage, or another S3-compatible bucket, for private file storage. The backend refuses the filesystem storage driver in production, so a deployed app always needs one.
7. DigitalOcean Managed Valkey only when horizontally scaled real-time features need Pub/Sub between backend instances.
8. Production domains and DNS access for the authenticated webapp and API. Browser auth requires both custom hosts under one registrable site, for example `app.example.com` and `api.example.com`.

Prefer an App Platform app spec so the backend service, static sites, env, domains, and database attachment stay reviewable. Create or update with:

```bash
doctl apps create --spec <path-to-spec.yaml>
doctl apps update <app-id> --spec <path-to-spec.yaml>
```

Consult the current App Spec docs before applying a generated spec because provider fields and limits can change.

## Safe DigitalOcean App Spec Workflow

Keep committed spec templates under `.do/*.yaml.example`. Generate concrete specs only into `.scratch/deploy` with:

```bash
bun run deploy:do:specs <backend-initial|backend-final|webapp|website|all>
```

The generator rejects empty `value:` lines, unresolved `REPLACE_WITH_*` placeholders, wildcard/empty/path-bearing production CORS origins, non-generated production `JWT_SECRET` values, missing build-time static URLs, duplicate/too-short App Platform component names, and browser-auth URLs outside the declared registrable site. It also rejects two independent `*.ondigitalocean.app` hosts as a production browser-auth topology. Do not replace secrets or URLs with manual `sed`, `perl`, or shell one-liners.

The generator also refuses to run unless the current checkout is on the configured deployment branch, the branch tracks a pushed upstream, the branch is not ahead/behind/diverged, and the worktree has no uncommitted or untracked changes.

Concrete App Platform machine defaults live in [../scripts/prepare-do-specs.mjs](../scripts/prepare-do-specs.mjs), not in generated `.scratch` files. The `.do/*.yaml.example` templates intentionally keep budget-bearing values as placeholders so the generator can validate and test them. When changing default tiers, update the generator constants, generator tests, and this document in the same change.

Minimum environment for spec generation:

```bash
export DO_GITHUB_REPO=owner/repo
export DO_PROJECT_SLUG=project-slug
export DO_GIT_BRANCH=master
export DO_APP_REGION=fra
export JWT_SECRET="$(openssl rand -hex 32)"
export ADMIN_SEED_EMAIL=admin@example.com
export ADMIN_SEED_PASSWORD='<unique 12-128 character bootstrap password>'
export DO_AUTH_SITE_DOMAIN=example.com
export DO_BACKEND_URL=https://api.example.com
export DO_WEBAPP_URL=https://app.example.com
# Optional when website/admin or another browser origin also calls the API:
# export DO_ADDITIONAL_CORS_ORIGINS=https://website.example.com,https://admin.example.com
```

Optional API sizing overrides for an installed project:

```bash
export DO_API_INSTANCE_SIZE_SLUG=apps-s-1vcpu-1gb
export DO_API_INSTANCE_COUNT=1
```

Reuse the same `JWT_SECRET` for later `backend-final` updates unless the user intentionally wants to invalidate all existing sessions.

`ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD` are required only for
`backend-initial`. The generator rejects missing, shorter-than-12,
longer-than-128, blank, known-template, or repeated-pattern passwords. It writes
both values as `SECRET` env only on the `migrate` `PRE_DEPLOY` job; they are
never attached to the API, static webapp, workers, or cron components. Do not
keep exporting the bootstrap password for `backend-final`. Spec generation and
the pre-deploy bootstrap use the same validator; accepted password bytes,
including intentional leading or trailing spaces, are passed through unchanged.

Typical first deploy order:

```bash
# 1. Create backend with a temporary placeholder browser origin.
bun run deploy:do:specs backend-initial
doctl apps spec validate .scratch/deploy/backend-app.yaml >/dev/null
doctl apps create --spec .scratch/deploy/backend-app.yaml

# 2. Attach api.example.com to the backend app and wait for DNS/TLS, then create
#    the webapp with its final API and anticipated webapp custom origins.
export DO_AUTH_SITE_DOMAIN=example.com
export DO_BACKEND_URL=https://api.example.com
export DO_WEBAPP_URL=https://app.example.com
bun run deploy:do:specs webapp
doctl apps spec validate .scratch/deploy/webapp-static-app.yaml >/dev/null
doctl apps create --spec .scratch/deploy/webapp-static-app.yaml

# 3. Attach app.example.com to the webapp app and wait for DNS/TLS. Update
#    backend CORS only with those final custom origins, then create website if active.
bun run deploy:do:specs backend-final
doctl apps spec validate .scratch/deploy/backend-app.yaml >/dev/null
doctl apps update <backend-app-id> --spec .scratch/deploy/backend-app.yaml

bun run deploy:do:specs website
doctl apps spec validate .scratch/deploy/website-static-app.yaml >/dev/null
doctl apps create --spec .scratch/deploy/website-static-app.yaml
```

Generated specs are written with owner-only `0600` permissions because the backend spec contains `JWT_SECRET`. Keep validation output redirected, never attach the spec to logs or support tickets, and delete `.scratch/deploy/backend-app.yaml` after the create/update operation when it is no longer needed.

Static Sites build from the connected Git branch, not from local `dist` folders. The branch must contain the full monorepo: root `package.json`, `bun.lock`, `backend`, `webapp`, `website`, `mobile`, and `packages/contracts`.

## Backend API

The backend runs as an App Platform web service. Keep the Docker build context at the repository root because [../backend/Dockerfile](../backend/Dockerfile) copies workspace manifests and `packages/contracts`.

Supported build paths:

- Repository build: App Platform service uses `dockerfile_path: backend/Dockerfile` with repository-root build context.
- Container image: build and push to DOCR, then point the App Platform service at that image.

DOCR image workflow:

```bash
docker build -f backend/Dockerfile -t registry.digitalocean.com/<registry>/<project>-backend:latest .
doctl registry login
docker push registry.digitalocean.com/<registry>/<project>-backend:latest
```

Backend service requirements:

- Set both the service `http_port` and `PORT` env to `8080` unless the project has a reason to choose another port.
- Use `instance_size_slug: apps-s-1vcpu-1gb` and `instance_count: 1` as the default production API starter shape. This is one shared 1 vCPU / 1 GiB App Platform container; verify current provider pricing before deployment.
- Configure readiness at `/health/ready` and liveness at `/health/live`.
- Set `COOKIE_SECURE=true` for HTTPS production traffic.
- Set `CORS_ORIGINS` to the exact deployed browser origins. Do not use `*`, empty values, or URLs with paths.
- Attach DigitalOcean Managed PostgreSQL or provide its connection string as `DATABASE_URL`.
- Set the complete `PRIVATE_STORAGE_*` group. It is required, not conditional: `bun run deploy:do:specs` refuses to generate a backend spec without it, because a backend deployed without a bucket crash-loops on startup.
- Add a complete App Store and/or Google Play IAP group only when native subscriptions are active; partial groups fail spec generation.
- Keep the built-in limiter only for the default single-instance API. Use a shared limiter or trusted edge/WAF policy before increasing `instance_count`.

The default one-container shape is not a high-availability floor; it is the budget starter. Raise `instance_count` to two or three when availability or traffic justifies the extra monthly cost. Use `apps-s-1vcpu-2gb` or larger shared containers when memory pressure is the primary limit. Move to dedicated CPU only after metrics show CPU-bound work, noisy shared-CPU performance, strict latency requirements, or a need for CPU-based autoscaling. `webapp` and fully prerendered `website` output are Static Site components and do not have App Platform runtime container sizes. A `website` route with SSR/on-demand rendering or server islands needs a runtime service.

The committed App Platform `migrate` PRE_DEPLOY job runs:

```bash
bun run db:deploy
```

That command applies existing Prisma migrations, bootstraps or unlocks the first
administrator when the initial job has seed credentials, and then requires at
least one `admin` with a password credential. Later `backend-final` jobs receive
no bootstrap credentials and therefore never reset the seed password, but still
block a release if no login-capable administrator remains. Do not run `prisma
migrate dev` in production and do not hand-write migration SQL.

## Backend Worker And Cron

Jobs themselves are provider-neutral and documented in [BACKGROUND_JOBS.md](BACKGROUND_JOBS.md):
they are declared once in `backend/src/jobs.ts` and run by whichever process fits. This section
covers only the DigitalOcean side of that choice.

The backend ships as one Docker image with separate entrypoints:

- API service: `bun run start:api`
- one-shot job runner for a scheduled component: `bun run start:cron -- <job>`
- in-repo scheduler, if you would rather keep schedules in the repository than in App Platform:
  `bun run start:scheduler` as the worker component's run command
- loop worker, for work that must run more often than once a minute or continuously:
  `bun run start:worker`. Between one and fifteen minutes, use the scheduler instead - App
  Platform's own minimum cadence is 15 minutes, but a loop is the wrong shape for that gap
- push notification worker: `bun run start:worker:notifications`, the one long-running handler this
  branch ships ready to deploy

Keep API, worker, and cron in the same backend workspace so they share Prisma schema, generated Prisma client, env validation, contracts, and feature services. Do not create a second backend package or repository just to run background code.

DigitalOcean App Platform supports non-routable worker components and scheduled job components in the same app spec. The committed backend template always includes the API service and `migrate` pre-deploy job. Optional worker and scheduled jobs are inserted by the generator only when explicitly configured:

```bash
# Add the push notification worker after Expo Push is active.
export DO_BACKEND_WORKER_ENABLED=true
export DO_BACKEND_WORKER_RUN_COMMAND="bun run start:worker:notifications"
# Or run the in-repo scheduler instead - but only once `schedules` in backend/src/scheduler.ts has
# an entry, otherwise the process exits immediately and the generator refuses the command.

# Add the combined maintenance job for production. With Google Play configured,
# it also refreshes stale stored purchases; otherwise it only cleans auth sessions.
export DO_BACKEND_CRON_NAME=maintenance
export DO_BACKEND_CRON_TASK=maintenance:process
export DO_BACKEND_CRON_SCHEDULE="*/15 * * * *"
export DO_BACKEND_CRON_TIME_ZONE=UTC

# If notifications use scheduled processing instead of the persistent worker,
# add the independent notification recovery job alongside maintenance.
export DO_BACKEND_NOTIFICATION_CRON_NAME=notification-recovery
export DO_BACKEND_NOTIFICATION_CRON_SCHEDULE="*/15 * * * *"
export DO_BACKEND_NOTIFICATION_CRON_TIME_ZONE=UTC

bun run deploy:do:specs backend-final
```

Use worker components only after the process has work to do. The notification worker qualifies once the app sends push notifications. For the two generic runners the generator reads `backend/src/scheduler.ts` and `backend/src/worker.ts` before accepting `bun run start:scheduler` or `bun run start:worker`: while `schedules` or `workerLoops` is still the empty list the process exits immediately and App Platform would restart it forever. Fill the list in and the same command is accepted; any other command is passed through as-is. Production should normally schedule `maintenance:process`; it removes stale auth sessions and expired password-reset tokens, redacts legacy terminal notification content, and - once subscriptions are turned on and the complete Google Play group is configured - reconciles stale stored purchase tokens in bounded batches. `auth:sessions:cleanup` remains available as a dedicated task and covers both sessions and reset tokens. `billing:google-play:reconcile` exists only after subscriptions are turned on (docs/IAP.md); spec generation rejects it until then, because scheduling an unregistered task deploys a job that fails on every run.

Choose one notification-processing topology explicitly:

- Preferred for timely delivery: deploy `bun run start:worker:notifications`. The independent notification scheduled job may still be used as a recovery pass.
- Budget topology without a persistent notification worker: configure both the primary `maintenance:process` job and `DO_BACKEND_NOTIFICATION_CRON_*`. The second job is fixed to `notifications:process`, so maintenance and push processing cannot silently replace one another.

The generator rejects incomplete notification-job settings, schedules faster than DigitalOcean's supported 15-minute cadence, duplicate `notifications:process` cron definitions, and component-name collisions after normalization. All optional components use `backend/Dockerfile`, the repository-root build context, and the same managed PostgreSQL binding as the API. The generator gives Google Play credentials only to the API and a billing-capable scheduled task, while the notification worker and dedicated notification job receive only a configured `EXPO_PUSH_ACCESS_TOKEN`. Give every background component the same `PRIVATE_STORAGE_*` group as the API. It is not conditional on the job: every runner builds storage through `createBackendRuntime`, so a worker or cron container fails the same startup validation without it. The generator emits the group into all of these blocks.

The generator enforces the current optional-env ownership explicitly:

- API service: configured App Store, Google Play, and temporary `ENABLE_TEST_PUSH` values.
- `bun run start:worker:notifications` and `notifications:process`: configured `EXPO_PUSH_ACCESS_TOKEN`, because these components call Expo's delivery API.
- Google-enabled `maintenance:process`, and `billing:google-play:reconcile` once subscriptions are on: the complete Google Play group.
- Other worker/cron commands: none of the Expo, store, or test-route env above.

Worker and cron components receive neither `JWT_SECRET` nor cookie/CORS settings. Their background runtime loader uses a public non-signing compatibility value internally for shared module typing, so compromise of a background component cannot disclose the API key used to mint access or offer-code tokens.

`ENABLE_TEST_PUSH` accepts only `true` or `false` during spec generation and is always API-only; delivery still belongs to the notification worker or cron.

## Real-Time And Horizontal Scaling

Keep production architecture monolithic by default: one backend service can own HTTP routes, auth, persistence, and any WebSocket endpoints. Do not split chat, notifications, or presence into separate services unless there is a proven operational need.

When the backend runs as a single instance, WebSocket connection state can stay in that process. When App Platform is scaled to multiple containers, clients may connect to different backend instances. Any feature that must deliver the same event across those instances, such as chat messages, presence changes, or live notifications, needs a shared Pub/Sub broker.

Use DigitalOcean Managed Valkey as the default Redis-compatible broker for cross-instance fanout. Each backend instance publishes domain events to Valkey and subscribes to the channels it needs to deliver events to its local WebSocket connections. Do not add Valkey for ordinary request/response APIs, static pages, or single-instance development.

Valkey is a transient delivery layer, not the source of truth. Persist durable state in PostgreSQL first, publish small event messages after the write commits, and have each backend instance fan out only to its own local WebSocket or SSE clients. Clients should reconnect and refetch from the API because Pub/Sub messages can be missed during deploys, restarts, or network interruptions.

When a real-time feature needs cross-instance delivery, create a DigitalOcean Managed Valkey cluster in the same region as the app and database, attach the connection string to the backend as a runtime secret such as `VALKEY_URL`, and keep it out of static-site build-time env. Do not enable Valkey in the baseline template until the product has a realtime feature that requires it.

## Webapp Static Site

Deploy `webapp` as an App Platform Static Site component.

The minimum sufficient frontend tier is Static Site only. The CSR webapp lives behind auth and needs no SEO, so it stays a Static Site; do not add `instance_size_slug`, `instance_count`, or a service/container component for it.

Required component shape:

- Source directory/build context: repository root.
- Build command: `bun install --frozen-lockfile && bun run build:webapp`.
- Output directory: `webapp/dist`.
- Build-time env: `VITE_API_URL=https://api.example.com`.
- Index document: `index.html`.
- Catch-all document: `index.html`, because the React app uses client-side routing.

App Platform Static Sites are served through DigitalOcean's global CDN by default. Do not disable the CDN cache unless the product needs a specific behavior that the built-in CDN cannot provide.

`VITE_API_URL` is embedded at build time. If it is empty, the browser app can call its own static-site origin at `/api/*` instead of the backend. After changing `VITE_API_URL`, redeploy the static site; runtime env changes alone do not rewrite the already built bundle.

## Website Static Site

Deploy `website` as an App Platform Static Site component while it has only fully prerendered output and no server islands or runtime-rendered routes.

The minimum sufficient website tier is Static Site only. This is still the default for the public SEO catalog of a marketplace. Use rebuild/redeploy for durable listing/category/content changes, and do not move the full authenticated app into Astro just because the product has public SEO pages. Keep `webapp` for buyer account, seller/admin, checkout/account, dashboard, and other non-indexed workflows.

Move only request-specific `website` routes to SSR/hybrid with `export const prerender = false`; those routes need the Node adapter at runtime and must be deployed as an App Platform **service** (a runtime container, like the backend) instead of a Static Site. Astro server islands also need an adapter and runtime service even when the surrounding page is prerendered. When server islands appear on cached pages or rolling deploys, generate a stable key with `astro create-key` and configure `ASTRO_KEY` as a secret in both build and runtime environments. Never commit it, expose it as `PUBLIC_*`, print it in logs, or bake it into static output. Per-page incremental static regeneration (ISR) is a Vercel/Netlify-style platform feature and is not available on App Platform Static Sites, so keep runtime pages fresh with CDN cache headers (`Cache-Control`, `stale-while-revalidate`) instead.

Use shared CDN caching only for anonymous, public-equivalent website responses. Auth-dependent or personalized routes and server islands must use `private` or `no-store`, or a deliberately supported `Vary: Cookie`/`Authorization` strategy. `ASTRO_KEY` protects server-island prop encryption across builds; it does not make personalized responses safe for shared caches.

Required component shape (static build):

- Source directory/build context: repository root.
- Build command: `bun install --frozen-lockfile && bun run build:website`.
- Output directory: `website/dist`.
- Index document: `index.html`.
- Required build-time canonical origin: `PUBLIC_WEBSITE_URL=${_self.PUBLIC_URL}` in the generated App Platform spec, or the concrete public origin on another provider.
- Optional build-time public config only when the website intentionally needs it, such as `PUBLIC_WEBAPP_URL=https://webapp.example.com`.

Keep website independent from authenticated browser-app flows unless the product explicitly needs shared API data. The baseline website spec therefore does not require `PUBLIC_WEBAPP_URL`; add it as explicit build-time public config only when the product actually links to a separate webapp, then redeploy website after it changes.

## Managed PostgreSQL

Use DigitalOcean Managed PostgreSQL **18** for production data. Do not accept a provider default implicitly: the committed schema uses native `uuidv7()`, which requires PostgreSQL 18+, and the generated App Spec pins `version: "18"`. For a new low-cost production launch, start with the smallest supported shared-CPU single-node plan and verify current provider pricing before deployment. When attaching the database inside App Platform, prefer bindable variables such as the database component's `DATABASE_URL`/`DATABASE_PRIVATE_URL` rather than copying raw credentials into the spec.

Operational defaults:

- Keep the database in the same region/VPC as the backend service when possible.
- Enable trusted sources for the App Platform app when using managed database network restrictions.
- Use a connection pool if the app starts hitting connection limits.
- Take backups before destructive schema or data operations.

DigitalOcean Managed PostgreSQL uses TLS. The backend normalizes `sslmode=require` database URLs by adding `uselibpqcompat=true` for the Prisma PostgreSQL adapter unless the URL already sets that option explicitly.

## Production Auth And CORS

Production browser auth may be cross-origin, but it must remain same-site: use custom hosts under one registrable domain, such as `app.example.com` and `api.example.com`. Independent App Platform default hosts such as `app-abc.ondigitalocean.app` and `api-xyz.ondigitalocean.app` are different browser sites because `ondigitalocean.app` is a public suffix. A `SameSite=None` cookie can still be blocked by browser third-party-cookie policy, so default ingress hosts are supported only for initial provisioning and non-cookie health checks, not production browser auth.

Both hosts must sit under one registrable site (`example.com` in the example). On DigitalOcean, set `DO_AUTH_SITE_DOMAIN` to that site, not to either host, and the deploy generator verifies that `DO_BACKEND_URL`, `DO_WEBAPP_URL`, and any additional credentialed CORS origins belong to it; on another hosting, check it yourself. The required runtime shape is:

- backend cookies: `HttpOnly`, `Secure`, `SameSite=None`, scoped to `/api/auth`;
- backend CORS: exact HTTPS origins only, `credentials: true`, no wildcard fallback;
- every cookie-based auth write (`register`, `login`, `refresh`, and `logout`): requires an `Origin` header that exactly matches `CORS_ORIGINS`;
- webapp API client: `credentials: include`;
- webapp static build: concrete `VITE_API_URL` pointing at the backend origin.

The backend env validator rejects empty/wildcard/path-bearing `CORS_ORIGINS`, requires HTTPS origins and secure cookies in production, and requires a generated hexadecimal `JWT_SECRET` in production.

## Object Storage

Use DigitalOcean Spaces Standard Storage, or any other S3-compatible bucket, for private file storage. Do not write uploads to the App Platform container filesystem; it is not durable across deployments or container replacements, which is why the backend refuses the filesystem storage driver in production.

Default production setup:

- Create the bucket in the same region group as the backend when practical, and keep it private.
- Configure its CORS rule for browser direct uploads from the deployed web origins, allowing `GET`/`PUT`/`HEAD` with the `Content-Type` and `If-None-Match` headers and exposing `ETag`. `browserUploadAllowedHeaders` in `backend/src/storage/config.ts` is the list the app itself uses.
- Set the complete `PRIVATE_STORAGE_*` group, including `PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT=true`, which is the deliberate gate that lets the backend talk to a remote bucket at all.
- Objects are reached only through short-lived presigned URLs. This template has no public-object path: no public ACLs, no CDN base URL, no public URL builder. Adding one is a deliberate second surface — see [STORAGE.md](STORAGE.md).
- Generate optimized image variants in the backend, a worker, or a dedicated App Platform service when the product needs thumbnails, responsive sizes, compression, or format conversion.

DigitalOcean Spaces and Spaces CDN do not provide first-party dynamic image transformation. Add third-party image services only when the user explicitly chooses that product tradeoff.

## CDN And Domains

For `webapp` and fully prerendered `website` output, App Platform Static Sites already use DigitalOcean's global CDN. This is the default path.

Use an external CDN only for explicit advanced needs such as custom WAF rules, bot filtering, custom rate limiting, or geographic traffic controls. If an external CDN is used in front of App Platform:

- configure the custom domain on the CDN, not in App Platform;
- point the CDN origin to the default App Platform ingress, for example `<app-name>.ondigitalocean.app`;
- use HTTPS on port `443`;
- do not forward the original custom-domain `Host` header to App Platform.

## Expo / EAS

Mobile deployment is separate from DigitalOcean hosting. Use the deployed API URL as the mobile public API endpoint:

```bash
bunx eas-cli env:create --name EXPO_PUBLIC_API_URL --value https://api.example.com --environment production
```

Development build:

```bash
bunx eas-cli build --profile development --platform android
bunx eas-cli build --profile development --platform ios
```

Production build:

```bash
bunx eas-cli build --profile production --platform all
```

Installed mobile clients and the backend deploy independently. Keep the auth refresh response backward-compatible, and deploy notification contract changes with the repository's legacy token-only request bridge intact. That bridge binds an old request to its authenticated session but cannot replace a newer installation-scoped registration. Remove it only after release telemetry or an enforced minimum app version proves that no supported client depends on it.

### Expo Push deployment checklist

The repository includes mobile token registration, backend token storage, durable outbox delivery, Expo ticket/receipt tracking, retries, and dead-token cleanup. Deployment still needs project-specific Expo credentials:

1. In the installed project, set `expo.owner`, production app identifiers, and EAS `extra.eas.projectId`; do not commit those template-wide before a real Expo owner/project is chosen.
2. Configure APNs and FCM credentials in Expo/EAS. Keep native credential files and service-account JSON out of git and deployment logs.
3. Set the production mobile API URL with `EXPO_PUBLIC_API_URL` so the installed build can register tokens against the deployed backend.
4. If Expo Push Security is enabled, configure `EXPO_PUSH_ACCESS_TOKEN`; the generator gives it only to the notification worker and/or scheduled notification cron that call Expo's delivery API. The API route only enqueues notifications and does not receive this provider secret. Do not expose it through any `EXPO_PUBLIC_*` variable.
5. Deploy `bun run start:worker:notifications` as a backend worker for continuous push delivery, or schedule `bun run start:cron -- notifications:process` as the recovery/fallback path after the product starts sending notifications.
6. For a bounded verification window, export `ENABLE_TEST_PUSH=true` before generating the backend spec. The generator validates the value and writes it only to the API component. Install the development or production build on a physical device, sign in, and call authenticated `POST /api/notifications/test-push`. The route only enqueues and is durably limited to one test message per user per minute; the worker/cron performs delivery and receipt polling. Remove the variable or set it to `false`, regenerate the spec, and redeploy after verification.

Expo delivery is at-least-once across the narrow provider boundary: the provider can accept a push and the process can stop before its ticket is persisted. A retry may therefore produce a duplicate notification. Keep notification payload effects idempotent: deep links must safely open the same destination more than once, and receiving the same payload must not repeat purchases, writes, or other irreversible business actions.

Apple App Store release work requires Apple Developer Program access. Google Play release work requires a Google Play Developer account.

## Validation

Before changing cloud resources, run the smallest relevant local checks for the active surfaces:

```bash
bun run typecheck
bun run test
bun run build
```

For narrow deployment-only documentation or App Platform config work, run the subset that matches the affected surfaces, for example `bun run deploy:do:specs all`, `bun run build:webapp`, `bun run build:website`, or `bun run --cwd backend smoke:docker`.

After deployment:

- verify `doctl apps spec validate <generated-spec.yaml>` passes for every generated spec before create/update;
- verify `/health/live` and `/health/ready` on the backend public URL;
- verify browser auth only from allowed `CORS_ORIGINS`;
- verify `webapp` route refreshes hit the React catch-all instead of a static 404;
- verify `website` loads static assets from the deployed domain;
- verify an avatar upload completes end to end against the production bucket, and that its download link expires and requires backend authorization;
- verify Prisma migrations were applied exactly once to the production database.
- verify the PRE_DEPLOY log confirms a login-capable administrator without printing bootstrap credentials.

## Failure Modes This Template Guards Against

- `GitHub user not authenticated`: App Platform GitHub integration was not connected or did not have repository access before `doctl apps create`.
- Empty secrets or URLs in generated specs: `JWT_SECRET`, `CORS_ORIGINS`, and `VITE_API_URL` must be concrete before deployment.
- Dirty or ambiguous release source: deployment tooling must stop when the worktree has uncommitted/untracked files, the checkout branch differs from `DO_GIT_BRANCH`, or the branch is not pushed and in sync.
- Backend crash on startup: production requires a generated 64-or-more-character hexadecimal `JWT_SECRET`, so the spec generator must fail before App Platform deploys an unsafe value.
- Broken browser auth CORS: production CORS must use exact HTTPS origins, not wildcard or empty values.
- Webapp calling its own `/api/*`: missing `VITE_API_URL` at static build time makes the bundle use the wrong origin.
- Stale remote build dependencies: `.bun-version` pins the Static Site build runtime and build commands run `bun install --frozen-lockfile` before `bun run build:*`.
- Frozen backend install failures: `backend/Dockerfile` copies all workspace manifests before `bun install --frozen-lockfile`.
- Wrong App Platform port: backend specs set both `http_port: 8080` and `PORT=8080`.
- Managed PostgreSQL TLS errors: `sslmode=require` URLs are normalized with `uselibpqcompat=true` for the Prisma PostgreSQL adapter.
- Cross-origin cookie failures: production cookies use `Secure` and `SameSite=None`; webapp requests include credentials.
- Missing monorepo files in Git: App Platform Static Sites build from the connected Git branch, not from local `dist`.

## Current Upstream Documentation

For deployment questions, consult current upstream docs first. This document captures the repository's deployment shape; provider docs are authoritative for CLI flags, product limits, pricing, and service behavior.

- DigitalOcean App Platform: https://docs.digitalocean.com/products/app-platform/
- Create apps on App Platform: https://docs.digitalocean.com/products/app-platform/how-to/create-apps/
- DigitalOcean App specs: https://docs.digitalocean.com/products/app-platform/reference/app-spec/
- DigitalOcean Static Sites: https://docs.digitalocean.com/products/app-platform/how-to/manage-static-sites/
- DigitalOcean Managed Databases in App Platform: https://docs.digitalocean.com/products/app-platform/how-to/manage-databases/
- DigitalOcean Valkey: https://docs.digitalocean.com/products/databases/valkey/
- DigitalOcean Dockerfile builds: https://docs.digitalocean.com/products/app-platform/reference/dockerfile/
- DigitalOcean Bun buildpack: https://docs.digitalocean.com/products/app-platform/reference/buildpacks/bun/
- DigitalOcean doctl CLI: https://docs.digitalocean.com/reference/doctl/
- DigitalOcean `doctl apps spec validate`: https://docs.digitalocean.com/reference/doctl/reference/apps/spec/validate/
- DigitalOcean Container Registry: https://docs.digitalocean.com/products/container-registry/
- DigitalOcean Spaces: https://docs.digitalocean.com/products/spaces/
- DigitalOcean Spaces CDN: https://docs.digitalocean.com/products/spaces/how-to/enable-cdn/
- DigitalOcean Spaces S3 compatibility: https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/
- Configure CORS on Spaces: https://docs.digitalocean.com/products/spaces/how-to/configure-cors/
- External CDN in front of App Platform: https://docs.digitalocean.com/products/app-platform/how-to/configure-external-cdn/
- Yandex Cloud alternative runbook: https://yandex.cloud/en/docs/
- Docker Compose: https://docs.docker.com/compose/
- Prisma migrations: https://www.prisma.io/docs/orm/prisma-migrate
- Expo EAS: https://docs.expo.dev/eas/
- EAS Build: https://docs.expo.dev/build/introduction/
- Expo Push setup: https://docs.expo.dev/push-notifications/push-notifications-setup/
- Expo Push sending API: https://docs.expo.dev/push-notifications/sending-notifications/
