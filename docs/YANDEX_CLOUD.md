# Yandex Cloud Alternative

Use this document when `CHECKLIST.md` records Yandex Cloud as the hosting - which is what an audience in Russia or a data-residency requirement implies.

DigitalOcean is the choice for audiences outside Russia. Either way the decision comes from the audience question in `CHECKLIST.md`, never from asking the owner to compare providers, and the tooling of the path not chosen is deleted during setup.

## If You Chose Another Hosting

The hosting choice is recorded in [CHECKLIST.md](../CHECKLIST.md) and only one path is kept. If the
project runs on DigitalOcean or an own server, delete the Yandex tooling in one pass.

**Delete this file, `scripts/release-yc.mjs`, `scripts/release-yc.test.mjs`, and
`backend/.env.deploy.example`, and drop the `release:yc` script from the root `package.json`.**

One piece of backend code is Yandex-specific and needs a decision rather than a delete:
`INGRESS_RATE_LIMIT_PROVIDER` in `backend/src/env.ts` accepts `yandex-sws`, and
`backend/src/app.ts` turns the backend's own IP-keyed rate limits off when it is set, because Smart
Web Security is doing that job at the edge. Keep the code and keep the value at its `local` default
- on any other hosting `yandex-sws` would silently disable those limits with nothing replacing them.
Delete the `yandex-sws` option and the checks around it only if you are sure no edge WAF will ever
sit in front of this API; `backend/src/app.test.ts` and `backend/src/env.test.ts` cover it.

Nothing else in `backend/` or `scripts/` is Yandex-only; the two mentions that remain (a comment in
`backend/src/jobs.ts` and the provider-doc check) are deliberately provider-neutral and stay.

**Then make the one conditional file deletion**, which depends on the path you kept rather than on this
one. The static precompression tooling - `scripts/precompress-static.mjs`, its test, the
`static:precompress` script in root `package.json`, and its `README.md` bullet - is own-server
tooling, not Yandex tooling:

- On the **own server** path keep all four and leave the `CHECKLIST.md` ledger row `included`, but
  rewrite that row's Note and the `README.md` bullet: both currently explain the capability by
  contrasting DigitalOcean and Yandex, and every trace of both providers is gone by the end of
  setup. Name the proxy you actually run instead.
- On **DigitalOcean** delete all four: App Platform Static Sites cannot select a precompressed
  sibling, so the files would be published and never requested. Then keep the `CHECKLIST.md` row
  rather than deleting it, set its State to `removed`, and rewrite its Note to say the tooling was
  deleted and why. A deleted row leaves the capability `absent`, which reads as "not built yet",
  and a Note still describing a working command invites the next agent to restore it. Finally,
  clear what now points at a deleted command in `docs/DEPLOYMENT.md`. In "Own Server", cut the
  whole tail of the "Static surfaces" bullet after "...SPA catch-all for the webapp." - every
  sentence from "Then run" onward, plus the three sub-bullets under it - because all of it is about
  serving `.br`/`.gz`; stopping earlier leaves "those files" without an antecedent and a colon
  introducing a deleted list. In "CDN And Domains", replace the two sentences beginning "So a
  Static Site cannot pick" and "Do not run" with `Confirm the CDN is compressing with the check in
  "Validation".` Cut the ingress-rules sentence before them too - it exists only to explain the
  conclusion those two sentences drew, and reads as a non-sequitur once they are gone. Everything
  else in that section, including all the external-CDN guidance, stays.

**Then edit these files** - one bullet each, so no link is left dangling:

- `docs/STORAGE.md`: the "Yandex Cloud Alternative" section and the Yandex upstream links.
- `docs/ARCHITECTURE.md`: the Yandex half of the Valkey broker sentence and the Managed Service for
  Valkey link.
- `docs/BACKGROUND_JOBS.md`: the Yandex bullet under "Provider specifics", the six-field-expression
  half of the cadence sentence, and the timer-trigger link. If the DigitalOcean bullet is gone too,
  delete the now-empty "Provider specifics" heading.
- `docs/DEPLOYMENT.md`: the links to this file, including the "use YANDEX_CLOUD.md instead" sentence
  in the opening paragraphs, the Yandex ingress header in "Secrets And Backend Env", and the
  `docs/YANDEX_CLOUD.md` bullet in its own removal list.
- the root `README.md`, `backend/README.md`, `webapp/README.md`, and `website/README.md`: the Yandex
  pointers and the Yandex upstream-documentation list.
- `AGENTS.md` and `CLAUDE.md`: the Yandex half of the hosting rule and the mention of this file in
  their "Deployment and infrastructure policy belongs in" rule. Keep the two files identical.
- `CHECKLIST.md`: the Yandex row in the hosting table, the option in the recorded-hosting row, the
  pointer to this file under the table, and the Yandex half of the hosting rule in the agent-owned
  decisions section.

Finally, sweep for what no list can enumerate:

```bash
rg -n 'Yandex|yandexcloud|yc serverless' --glob '!node_modules'
```

Every hit must go, except these:

- the `yandex-sws` ingress option in `backend/src/env.ts` and `backend/src/app.ts`, plus its cases
  in `backend/src/app.test.ts` and `backend/src/env.test.ts` - see the note above;
- the comment naming all three hostings in `backend/src/jobs.ts`;
- the comment next to the static output path in `website/astro.config.mjs`; and this file's own
  uppercase path `docs/YANDEX_CLOUD.md`, which the case-sensitive pattern above does not match.

When you are done, delete **both** "If You Chose Another Hosting" sections - this one, and the one
in `docs/DEPLOYMENT.md`. The choice is made; a surviving section tells the project to delete the
tooling it actually uses.

Run `bun run test` afterwards, and check that at least one of the two
provider documents survives.

## Service Map

- Browser API ingress: Yandex API Gateway on a custom `api.<site-domain>` host.
- Backend runtime: a private Yandex Serverless Container, running a Docker image from Yandex Container Registry and invoked through the gateway's `serverless_containers` integration.
- Production database: Yandex Managed Service for PostgreSQL.
- Uploads and media: Yandex Object Storage.
- Static `webapp` and fully prerendered `website` output: Yandex Object Storage static website hosting.
- CDN: Yandex Cloud CDN in front of public static sites and public media when production performance, custom domains, or cache controls matter.
- Real-time Pub/Sub: Yandex Managed Service for Valkey only when horizontally scaled WebSocket features need cross-instance fanout.
- CLI: Yandex Cloud CLI, `yc`.

## Intake

Active surfaces, media visibility, and release targets are recorded in [CHECKLIST.md](../CHECKLIST.md); confirm them there instead of asking again. Rows left `_unanswered_` were never decided - ask for those now and write the answers back into the checklist. Then ask only the product and release questions this path adds:

- whether backend/database traffic may stay private inside a Yandex Cloud network or must be reachable from the internet;
- whether real-time chat, presence, collaboration, live notifications, or WebSocket-style updates must work across multiple backend instances;
- whether the recorded image processing needs Yandex-side dynamic transformations or fixed-size variants generated on upload.

If mobile is active, switch to the `mobile` branch before mobile release planning.

## Prerequisites

Manual prerequisites for the user:

- Yandex Cloud account with billing enabled.
- Cloud and folder selected.
- Production domains and DNS access for the authenticated webapp and API. Browser auth requires same-site custom hosts such as `app.example.com` and `api.example.com`.
- A Certificate Manager certificate for the API Gateway custom domain.
- Docker running locally if the backend image will be built from this machine.
- AWS CLI when uploading static build output or media through the S3-compatible Object Storage API.
- `jq` when using the shell snippets below that parse `yc --format json` output.
- Yandex Cloud CLI installed and initialized:

```bash
curl -sSL https://storage.yandexcloud.net/yandexcloud-yc/install.sh | bash
yc init --username=<email_address>
yc config list
```

Use `yc config set folder-id <folder_ID>` when the active folder must be changed.

## Releases

Everything after this section provisions infrastructure **once**: registries, containers, buckets,
gateways, timers, service accounts, databases. Those steps are a runbook, not a routine.

Each subsequent release is one command:

```bash
cp backend/.env.deploy.example backend/.env.deploy   # once, then fill in the identifiers
bun run release:yc release
```

It runs five phases in order - `build-push`, `migrate`, `deploy`, `publish-web`, `verify` - and
records each one it finishes in `.scratch/release/<commit>.json`. A Yandex release is several
independent operations and any of them can fail halfway, so `bun run release:yc status` shows what
is done and re-running continues from there instead of redoing work. A single phase can be run on
its own by name, and `--dry-run` prints the exact commands without touching the cloud.

`backend/.env.deploy` holds identifiers, never credentials. The script never reads a secret: it
reads the **active revision's environment** and carries it forward unchanged, altering only the
image. That matters because container environment variables belong to a revision - a revision
deployed without them starts with none, so a release that did not carry them would silently strip
the production configuration. Runtime secrets therefore stay in the console or Lockbox, where you
set them once.

The release refuses to start when the worktree is dirty or the branch is not pushed and in sync,
and when the active `yc` profile does not match the `YC_EXPECTED_CLOUD_ID` and
`YC_EXPECTED_FOLDER_ID` recorded for the project. Releasing into the wrong folder is the expensive
mistake here, and it is the one a correct-looking command makes silently.

Two environment values cannot travel this path. `--environment` is parsed as CSV once an argument
holds more than one `=`, so a value containing both `=` and `,` would be split into bogus
variables; the script refuses such a value instead of deploying a mangled revision. Set that one in
the console or Lockbox and it will be carried forward like any other.

## Backend API

Use `backend/Dockerfile` from the monorepo root as the Docker build path, the same as the DigitalOcean path.

Create and configure Container Registry:

```bash
yc container registry create --name <project-registry>
yc container registry configure-docker
```

Build and push the backend image:

```bash
REGISTRY_ID=$(yc container registry get --name <project-registry> --format json | jq -r .id)
docker build -f backend/Dockerfile -t cr.yandex/$REGISTRY_ID/<project>-backend:<tag> .
docker push cr.yandex/$REGISTRY_ID/<project>-backend:<tag>
```

Create a private Serverless Container and deploy a revision:

```bash
yc serverless container create --name <project>-api
yc serverless container revision deploy \
  --container-name <project>-api \
  --image cr.yandex/$REGISTRY_ID/<project>-backend:<tag> \
  --cores 1 \
  --memory 1GB \
  --concurrency 1 \
  --execution-timeout 30s \
  --service-account-id <service_account_ID>
```

Before you deploy the revision, configure the full runtime environment for that revision. The container must receive `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`, and `COOKIE_SECURE` before it starts, either through the console or by passing `--environment` with the revision deploy command.

Serverless Containers set `PORT` automatically. The backend must continue reading `PORT` from the environment and exposing `/health/live` and `/health/ready`.

The initial production revision must keep the backend ingress limiter active. Use this safe
baseline until the SWS rollout checks below pass:

```bash
DATABASE_URL=postgresql://...
JWT_SECRET=<64-or-more-hex-characters>
CORS_ORIGINS=https://app.example.com
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
TRUSTED_PROXY_CLIENT_IP_HEADER=x-forwarded-for
TRUSTED_PROXY_CLIENT_IP_POSITION=last
COOKIE_SECURE=true
# Required. The image runs with NODE_ENV=production, where the backend refuses the filesystem
# storage driver because a container disk does not survive a redeploy, and refuses a remote
# endpoint until the gate below is opened deliberately.
PRIVATE_STORAGE_DRIVER=s3
PRIVATE_STORAGE_REGION=ru-central1
PRIVATE_STORAGE_BUCKET=<project-prod-bucket>
PRIVATE_STORAGE_ENDPOINT=https://storage.yandexcloud.net
PRIVATE_STORAGE_ACCESS_KEY_ID=<static-access-key-id>
PRIVATE_STORAGE_SECRET_ACCESS_KEY=<static-access-key-secret>
PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT=true
```

Yandex Serverless Containers append the invoking user's address to `X-Forwarded-For`, including after any values supplied by the caller. Selecting the last value avoids trusting a caller-controlled first entry. Recheck this provider contract if the backend moves behind a different Yandex ingress product.

After SWS is actively blocking and the rollout checks pass, change only `INGRESS_RATE_LIMIT_PROVIDER` to `yandex-sws` in a new container revision. This tells the backend that Smart Web Security owns the IP-keyed auth, account-write, IAP, and webhook budgets; it does not configure Yandex Cloud. In this mode, `AUTH_RATE_LIMIT_*`, `IAP_RATE_LIMIT_*`, and `WEBHOOK_RATE_LIMIT_*` remain documented compatibility defaults but are not enforced by the backend. Body limits remain active. `ADMIN_USERS_READ_RATE_LIMIT_*` also remains active because it is keyed by the authenticated administrator ID, which SWS cannot extract from the JWT; use shared application state if that budget must be global across container instances.

`--concurrency 1` limits simultaneous calls inside one instance; it does not keep Serverless Containers on one instance, and the platform can start instances in multiple availability zones. A container instance cap is a capacity/cost control, not a security boundary. Do not use the older API Gateway `x-yc-apigateway-rate-limit` extension: Yandex marks it deprecated and directs new deployments to Smart Web Security.

Container environment variables are part of a revision. When deploying with `yc serverless container revision deploy --environment`, include the full required environment for that revision because changing environment variables creates a new revision. Prefer the console, Terraform, or Yandex Lockbox for sensitive values when shell quoting becomes risky.

Generate `JWT_SECRET` with `openssl rand -hex 32`; that command creates 32 random bytes encoded as 64 hex characters. Do not use the placeholder from `backend/.env.example`, repeated characters, or human phrases.

### Browser API Gateway

Do not point the webapp at the direct `containers.yandexcloud.net` URL. Direct Serverless Container invocation removes incoming `Authorization` and `Cookie` headers, so bearer-token `/me` calls and HttpOnly refresh/logout flows cannot work there. The supported browser path is Yandex API Gateway's `serverless_containers` integration, which hands the original gateway request to the container.

Keep the API container private. Create a dedicated gateway service account and allow only that account to invoke the container:

```bash
yc iam service-account create --name <project>-api-gateway
GATEWAY_SA_ID=$(yc iam service-account get \
  --name <project>-api-gateway \
  --format json | jq -r .id)
API_CONTAINER_ID=$(yc serverless container get \
  --name <project>-api \
  --format json | jq -r .id)

yc serverless container deny-unauthenticated-invoke <project>-api
yc serverless container add-access-binding \
  --name <project>-api \
  --service-account-id "$GATEWAY_SA_ID" \
  --role serverless-containers.containerInvoker
```

### Smart Web Security rate limits

Configure SWS before generating the final API Gateway specification. The SWS console owns these values; changing the similarly named backend environment variables does not update an ARL profile.

1. Create an API response template named `<project>-api-rate-limited` with:
   - response code `429`;
   - format `JSON`;
   - body `{"error":{"code":"RATE_LIMITED","message":"Too many requests"}}`;
   - headers `Retry-After: 60`, `Cache-Control: no-store`,
     `Access-Control-Allow-Origin: https://app.example.com`,
     `Access-Control-Allow-Credentials: true`,
     `Access-Control-Expose-Headers: Retry-After`, and `Vary: Origin`.
2. Create an ARL profile named `<project>-api-arl` and add the rules below with **Logging only (dry run)** enabled. For each rule, select the response template, use **Grouping by property → IP address**, and select **Temporarily block all requests** with a 60-second block period. The console exposes **Block requests exceeding the limit** only for ungrouped counters, so it is not the correct action for these per-IP rules. Do not use CAPTCHA for API, XHR, webhook, or mobile traffic.

| Rule | Traffic conditions | Grouping | Limit |
| --- | --- | --- | --- |
| `auth-writes` | Request URI starts with `/api/auth/`; HTTP method is `POST` | IP address | 60 requests / 60 seconds; block 60 seconds |
| `account-writes` | Request URI starts with `/api/users/` **or** `/api/admin/`; HTTP method is one of `POST`, `PUT`, `PATCH`, `DELETE` | IP address | 60 requests / 60 seconds; block 60 seconds |
| `iap-writes` | Request URI starts with `/api/iap/`; HTTP method is `POST` | IP address | 60 requests / 60 seconds; block 60 seconds |
| `app-store-webhook` | Request URI matches `/api/webhooks/app-store`; HTTP method is `POST` | IP address | 600 requests / 60 seconds; block 60 seconds |

Create a security profile named `<project>-api-sws` from scratch with default action **Allow**, attach the ARL profile, and copy the security profile ID. Smart Protection or WAF is a separate product decision; if enabled for this API, use API protection mode and validate it independently in dry run.

The CORS origin in the response template must exactly match the credentialed browser app origin in `CORS_ORIGINS`; never use `*` with credentials. SWS generates a blocked response before Hono can add its CORS headers, and an SWS response template cannot dynamically reflect arbitrary browser origins. The supported baseline therefore has one browser origin that calls this API. Native/mobile clients do not need CORS. If more than one browser origin must read edge errors, do not switch to `yandex-sws` until each origin has a separately tested provider-supported edge design, such as a dedicated gateway/security profile and exact-origin template.

Enable **Write logs** on the security profile, send them to **Cloud Logging**, select **Advanced Rate Limiter**, and include both **DENY/CAPTCHA** and **ALLOW** verdicts. During dry run, record 100% of ALLOW requests because dry-run matches are allowed; after activation and observation, lower or disable ALLOW sampling to control log volume. Keep the backend on `INGRESS_RATE_LIMIT_PROVIDER=local` while the rules are in dry run, then inspect `dry_run_exceeded_quota_names` and `arl_matched_quotas` and confirm the rule/path distribution is expected. Dry-run requests still reach the backend and may be billable, so include the current SWS pricing in the release decision.

Create an OpenAPI 3 specification outside the repository, for example `.scratch/deploy/yandex-api-gateway.yaml`, using the actual container and service-account IDs:

```yaml
openapi: 3.0.0
info:
  title: project-api
  version: 1.0.0
x-yc-apigateway:
  smartWebSecurity:
    securityProfileId: <security_profile_ID>
  cors:
    origin: https://app.example.com
    methods: [GET, POST, PUT, PATCH, DELETE]
    allowedHeaders: [Authorization, Content-Type]
    exposedHeaders: [Retry-After, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset]
    credentials: true
    maxAge: 600
    optionsSuccessStatus: 204
paths:
  /{proxy+}:
    x-yc-apigateway-any-method:
      x-yc-apigateway-integration:
        type: serverless_containers
        container_id: <api_container_ID>
        service_account_id: <gateway_service_account_ID>
      parameters:
        - explode: false
          in: path
          name: proxy
          required: false
          schema:
            default: '-'
            type: string
          style: simple
```

Create the gateway, attach the issued Certificate Manager certificate, and point DNS for the API host to the gateway's default domain:

```bash
yc serverless api-gateway create \
  --name <project>-api \
  --spec=.scratch/deploy/yandex-api-gateway.yaml

yc serverless api-gateway add-domain <project>-api \
  --domain api.example.com \
  --certificate-id <certificate_ID>
```

Use `https://api.example.com` as `VITE_API_URL` and the same exact `https://app.example.com` origin in the Gateway CORS rule, SWS response template, and backend `CORS_ORIGINS`. The Gateway rule handles preflight requests; the SWS template keeps an edge-generated `429` readable by browser JavaScript. Wait for certificate and DNS readiness before the browser auth smoke. The direct container URL remains private and is not a production API endpoint.

For rollout, use this order so one limiter always remains active:

1. Deploy the initial container revision with `INGRESS_RATE_LIMIT_PROVIDER=local`.
2. Attach the security profile to a staging gateway with every ARL rule in dry run. Exceed each test quota and confirm its name appears in `dry_run_exceeded_quota_names` with the expected path and method.
3. Disable dry run in staging and repeat the quota tests. Confirm the SWS log has `module_type=ARL`, `action=DENY`, `arl_verdict=DENY`, and the expected `arl_applied_quota_name`. Also test from the deployed browser origin with credentials and confirm JavaScript can read the JSON `RATE_LIMITED` body and `Retry-After: 60`; inspect the response for the exact `Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials: true`, and `Access-Control-Expose-Headers: Retry-After`. These SWS verdict fields distinguish an edge rejection from the backend's compatible local 429 response.
4. Activate and verify the same rules on the production gateway while the backend still uses `local`. Confirm normal auth, account write, IAP, and signed webhook requests continue to reach the container.
5. Only then deploy a container revision that changes `INGRESS_RATE_LIMIT_PROVIDER` to `yandex-sws`.

For rollback, first deploy a container revision with `INGRESS_RATE_LIMIT_PROVIDER=local`. After local protection is restored, return ARL rules to dry run or disconnect the security profile. Never leave `INGRESS_RATE_LIMIT_PROVIDER=yandex-sws` active while the security profile is disconnected or every ARL rule is dry-run-only.

## Managed PostgreSQL

Use Yandex Managed Service for PostgreSQL **18** for production data. Do not accept the provider's default version implicitly: the committed schema uses native `uuidv7()`, which requires PostgreSQL 18+.

Operational defaults:

- Use the `PRODUCTION` environment for real production data.
- Keep the database in the same cloud network as the backend container when private connectivity is required.
- If the database host has no public access, the Serverless Container must be attached to the same cloud network.
- Configure security groups for PostgreSQL access, including port `6432` for the allowed source.
- Use SSL for public internet connections.
- Take a backup before destructive schema or data operations.

Apply Prisma migrations from a protected operator environment with production env configured:

```bash
bun run --cwd backend prisma:deploy
```

Do not run `prisma migrate dev` in production and do not hand-write Prisma migration SQL.

## Background Jobs And The Cleanup Timer

Jobs are provider-neutral and documented in [BACKGROUND_JOBS.md](BACKGROUND_JOBS.md); this section
covers the Yandex side. Two shapes are available: a timer trigger that starts a task container per
run (below), or the in-repo scheduler (`bun run start:scheduler`) when you prefer schedules to live
in the repository. The scheduler needs a process that stays up, so it belongs on a Compute Cloud VM
or in Managed Kubernetes - not in a Serverless Container, which is invocation-driven and scales to
zero, where it would simply never tick.

Two details of the timer trigger cost people time:

- The trigger expression has **six fields and is UTC only** — `'0 3 ? * * *'`, not the five-field
  form. Nothing validates it before you create the trigger, so a five-field habit fails at `yc`.
- `--environment` takes one comma-separated string, so a value that itself contains a comma, such
  as a multi-origin `CORS_ORIGINS`, is split into bogus variables. Pass such values through the
  console, Terraform, or Lockbox instead.


Production must run `auth:sessions:cleanup` on a schedule; setting `SESSION_RETENTION_DAYS` alone does not delete rows. An install that wires an email provider needs a second timer for `outbox:drain`, built exactly the same way but with `--args src/cron.ts,outbox:drain` and a one-minute expression `* * ? * * *` - the same six-field dialect as the cleanup trigger below, so one day field must be `?` - unlike DigitalOcean, this path has no 15-minute floor. See [BACKGROUND_JOBS.md](BACKGROUND_JOBS.md). Use a separate private Serverless Container from the same immutable backend image in **task** runtime mode. This keeps the public API process monolithic while giving the timer a one-shot command that exits non-zero on failure.

Create the cleanup container and deploy its revision. The image `WORKDIR` is already `/app/backend`, so the command can call the existing cron runner directly:

```bash
yc serverless container create --name <project>-auth-cleanup

yc serverless container revision deploy \
  --container-name <project>-auth-cleanup \
  --image cr.yandex/$REGISTRY_ID/<project>-backend:<immutable-tag> \
  --runtime task \
  --command bun \
  --args src/cron.ts,auth:sessions:cleanup \
  --cores 1 \
  --memory 256MB \
  --execution-timeout 60s \
  --service-account-id <cleanup_runtime_service_account_ID> \
  --environment DATABASE_URL='<production_database_url>',JWT_SECRET='<production_jwt_secret>',CORS_ORIGINS=https://app.example.com,COOKIE_SECURE=true,SESSION_ABSOLUTE_TTL_DAYS=90,SESSION_RETENTION_DAYS=7
```

Configure the cleanup revision with the same production `DATABASE_URL`, `JWT_SECRET`, `PRIVATE_STORAGE_*` group, session TTL, retention, network, and Lockbox policy as the API revision. The storage variables are not optional here either: the cleanup container runs the same image, so it fails the same startup validation without them, and `uploads:pending:cleanup` needs storage to do its work. Prefer Lockbox or the console instead of putting real secrets into shell history. Do not make the cleanup container public.

Create a narrowly scoped service account for the timer, grant it invocation access only to the cleanup container, and schedule the task daily at 03:00 UTC. Yandex timer expressions have six fields and use UTC:

```bash
yc iam service-account create --name <project>-auth-cleanup-trigger
TRIGGER_SA_ID=$(yc iam service-account get \
  --name <project>-auth-cleanup-trigger \
  --format json | jq -r .id)
CLEANUP_CONTAINER_ID=$(yc serverless container get \
  --name <project>-auth-cleanup \
  --format json | jq -r .id)

yc serverless container add-access-binding \
  --name <project>-auth-cleanup \
  --service-account-id "$TRIGGER_SA_ID" \
  --role serverless-containers.containerInvoker

yc serverless trigger create timer \
  --name <project>-auth-cleanup-daily \
  --cron-expression '0 3 ? * * *' \
  --invoke-container-id "$CLEANUP_CONTAINER_ID" \
  --invoke-container-service-account-id "$TRIGGER_SA_ID" \
  --retry-attempts 3 \
  --retry-interval 30s
```

After deployment, invoke the private cleanup container once with an IAM token and verify HTTP 200 plus `X-Task-Exit-Code: 0`. Then confirm `yc serverless trigger get --name <project>-auth-cleanup-daily` reports an active trigger. After the first scheduled window, inspect the cleanup container's invocation logs and require a recent `Job auth:sessions:cleanup removed ... stale sessions and ... expired password reset tokens.` entry; absence of a recent successful entry is an operational failure, not proof that there were zero stale auth artifacts.

## Real-Time Pub/Sub

Keep the Yandex deployment path monolithic by default: the backend container should own HTTP routes, auth, persistence, and any WebSocket endpoints. Do not split chat, notifications, or presence into microservices unless the product has a concrete operational reason.

When the backend runs as one container instance, WebSocket connection state can stay inside that process. If the container is horizontally scaled and users connected to different instances must receive the same chat, presence, collaboration, or live-notification events, add Yandex Managed Service for Valkey as a Redis-compatible Pub/Sub broker.

Each backend instance should publish domain events to Valkey and subscribe to the channels it needs to deliver events to its own local WebSocket connections. Keep Valkey out of baseline local setup and ordinary request/response APIs; add it only for cross-instance real-time fanout.

## Static Webapp And Website

Deploy `webapp` and fully prerendered `website` output as static websites in Yandex Object Storage. Once `website` uses SSR/on-demand rendering or Astro server islands, that surface needs an Astro adapter and must move to a Serverless Container runtime instead of static hosting. When server islands appear on cached pages or rolling deploys, generate a stable key with `astro create-key` and configure `ASTRO_KEY` as a secret in both build and runtime environments. Never commit it, expose it as `PUBLIC_*`, print it in logs, or bake it into static output.

Read [WEB_SURFACES.md](WEB_SURFACES.md) before adding build-time backend data, an automatic rebuild,
or commerce handoff. This section owns Yandex deployment mechanics, not product-surface ownership.

Use shared CDN caching only for anonymous, public-equivalent website responses. Auth-dependent or personalized routes and server islands must use `private` or `no-store`, or a deliberately supported `Vary: Cookie`/`Authorization` strategy. `ASTRO_KEY` is not a cache privacy boundary.

Build locally:

```bash
VITE_API_URL=https://api.example.com bun run build:webapp
PUBLIC_WEBSITE_URL=https://www.example.com bun run build:website
```

Both values are embedded at build time. `VITE_API_URL` must point to the API Gateway custom host. `PUBLIC_WEBSITE_URL` must be the public canonical origin of the website; without it, the generated pages intentionally omit canonical and `og:url` metadata. Rebuild after either origin changes. Add `PUBLIC_WEBAPP_URL` only when the public website intentionally links to the authenticated webapp.

Before uploading, create a Yandex Object Storage static access key for a service account and configure the AWS CLI with it. Yandex's Object Storage docs recommend `aws configure` with the static key and `ru-central1` as the region.

```bash
aws configure
# AWS Access Key ID: <static access key id>
# AWS Secret Access Key: <static secret key>
# Default region name: ru-central1
```

Upload built assets to public website buckets. Hashed assets go first and unhashed files last, so
no page is ever live pointing at an asset that has not landed yet, and each pass carries the
`Cache-Control` its filenames earn: Vite and Astro put a content hash in every asset name, which
makes those objects safe to cache forever, while `index.html` keeps its name across releases and
must be revalidated or the CDN serves the previous build indefinitely.

```bash
endpoint=https://storage.yandexcloud.net/

aws --endpoint-url=$endpoint s3 cp --recursive webapp/dist/assets/ s3://<webapp-bucket>/assets/ \
  --exclude '*.br' --exclude '*.gz' --cache-control 'public, max-age=31536000, immutable'
aws --endpoint-url=$endpoint s3 cp --recursive webapp/dist/ s3://<webapp-bucket>/ \
  --exclude '*.br' --exclude '*.gz' --exclude 'assets/*' --cache-control 'public, max-age=0, must-revalidate'

aws --endpoint-url=$endpoint s3 cp --recursive website/dist/_astro/ s3://<website-bucket>/_astro/ \
  --exclude '*.br' --exclude '*.gz' --cache-control 'public, max-age=31536000, immutable'
aws --endpoint-url=$endpoint s3 cp --recursive website/dist/ s3://<website-bucket>/ \
  --exclude '*.br' --exclude '*.gz' --exclude '_astro/*' --cache-control 'public, max-age=0, must-revalidate'
```

The `.br`/`.gz` exclusions matter because `bun run static:precompress` may have left those files in
`dist`, and they have no use in a bucket. A bucket cannot negotiate an encoding: it returns the
bytes it holds to every client, whatever the request asked for. So do not upload the variants, and
do not set `Content-Encoding` on objects by hand either. Compression on this path belongs to the
CDN - see "CDN And Domains" below.

### Automatic website rebuild

Automatic SSG rebuild is not part of the baseline Yandex path. Object Storage accepts files but
does not build the repository, and the backend runtime image intentionally lacks the website
source, Bun/Astro toolchain, and public-site upload credentials. Keep the capability `absent` while
the documented local build/upload above is the only release path.

If `CHECKLIST.md` requires automatic rebuilds, add a separate builder component that:

- runs a versioned artifact containing the repository website workspace and pinned build toolchain;
- exposes a private authenticated trigger to the backend provider adapter and uses a narrowly
  scoped service account;
- receives only a publication revision, fetches public build DTOs through server-only config, and
  validates them before building;
- stages the complete build under an immutable revisioned prefix or release bucket, validates it,
  then atomically/blue-green promotes that release (or uses an equivalent provider-supported
  switch); never treat an in-place recursive upload as a safe automatic release;
- includes the cache-busted public revision marker in the promoted artifact, performs the required
  CDN invalidation after promotion, and verifies the marker only after the release switch;
- reports a durable deployment id and status so short reconcile passes can survive restarts, verify
  the public marker, retry failures, roll back a failed promotion, clean old releases safely, and
  schedule one follow-up when a newer revision exists.

If the selected Yandex architecture cannot provide an atomic or blue-green release switch, keep
automatic rebuild `absent`; use the documented manual release or a runtime-rendering surface
instead of publishing mixed revisions. The `website:rebuild` outbox task coordinates revisions and
retries; it does not run Astro or hold Object Storage credentials inside the API/worker image.
Until this separate component is built and validated, choose manual release or record a
runtime-rendering requirement instead of claiming automatic rebuild support.

Configure Object Storage static website hosting with `index.html` as the home page. For the React SPA, also use `index.html` as the error document or configure equivalent CDN routing so route refreshes do not break client-side routing.

Example website settings file:

```json
{
  "index": "index.html",
  "error": "index.html"
}
```

Apply it with:

```bash
yc storage bucket update --name <webapp-bucket> --website-settings-from-file <path-to-website-settings.json>
```

Object Storage static website hosting requires public read access to the bucket objects and object list. Do not put secrets in frontend build output or static website buckets.

## CDN And Domains

For production `webapp`, `website`, and public media, put Yandex Cloud CDN in front of Object Storage when the product needs lower latency, custom cache behavior, HTTPS/domain management, or protection controls.

Authenticated browser traffic needs custom webapp and API Gateway hosts under the same registrable domain, for example `app.example.com` and `api.example.com`. Do not use the direct `containers.yandexcloud.net` URL: besides creating a cross-site cookie topology, direct container invocation strips the request headers required by this auth contract.

Cloud CDN can use an Object Storage bucket as an origin. Create a CDN resource, attach the public domain, configure caching rules, and point DNS to the CDN load balancer with a `CNAME` record. Do not use `ANAME` for CDN distribution domains.

Use immutable asset filenames from Vite/Astro builds and long cache headers for hashed assets. Keep `index.html` cache short enough for releases to roll out quickly. The upload commands above already set both.

Enable compression on the CDN resource; this is what makes the text assets small on this hosting path:

```bash
yc cdn resource update --id <resource-id> --gzip-on
```

`--gzip-on` is mutually exclusive with `--fetch-compressed` and `--brotli-compression`. Prefer it over the alternatives, and never solve compression by storing gzipped objects in the bucket. Yandex documents why: an Object Storage origin does not send `Vary: Accept-Encoding`, so the first compressed response to enter the CDN cache is then served to every later client - including ones that never sent `Accept-Encoding` and cannot decode it. With `--gzip-on` the CDN always fetches uncompressed content from the bucket and compresses at the edge only for clients that asked, which keeps that trap shut.

Without a CDN in front, a bare Object Storage website serves everything uncompressed. That is the tradeoff of skipping the CDN, not something the upload can fix.

## Transactional Email With Postbox

Yandex Cloud Postbox is the email provider for this hosting path: the same account, the same kind
of static access key as Object Storage, and the mail never leaves the region. It implements the
Amazon SESv2 API, so the driver in `backend/src/email/postbox-delivery.ts` signs its requests with
AWS SigV4 under service `ses` and region `ru-central1`.

Setup:

1. Create the sending address or domain in Postbox and complete verification. A domain needs DKIM
   and SPF records published in DNS; a single address needs its confirmation link followed. Nothing
   sends until verification is green.
2. Create a service account, grant it the `postbox.sender` role on the folder, then issue a
   **static access key** for it - the same AWS-compatible key type Object Storage uses:

```bash
yc iam service-account create --name postbox-sender
yc resource-manager folder add-access-binding <folder-id> \
  --role postbox.sender --subject serviceAccount:<service-account-id>
yc iam access-key create --service-account-name postbox-sender
```

   **Not an API key.** `yc iam api-key create --scope yc.postbox.send` also produces an id and a
   secret, and Postbox really does accept it - over **SMTP**, which is its other transport. This
   driver speaks the SES-compatible HTTP API, which authenticates with SigV4 and only accepts a
   static access key. Feeding it an API key fails as a signature error that looks like a revoked
   credential. An IAM token is wrong for a third reason: it expires.
3. Set the `EMAIL_*` group on the API container revision **and** on the drain task container. Both
   build delivery through `createBackendRuntime`, and the one that actually sends is the drain:

```bash
EMAIL_DELIVERY=postbox
EMAIL_FROM="Example <no-reply@example.com>"
EMAIL_POSTBOX_ACCESS_KEY_ID=<static access key id>
EMAIL_POSTBOX_SECRET_ACCESS_KEY=<static secret key>
# WEBAPP_ORIGIN is required alongside these: it builds the links inside the messages.
```

4. Run the drain. `outbox:drain` is already in the shipped `schedules`, so either deploy
   `bun run start:scheduler` as a long-running process, or create the timer trigger described in
   [Background Jobs And The Cleanup Timer](#background-jobs-and-the-cleanup-timer). Without a
   runner the API accepts every reset request and sends nothing.

New accounts start in a sandbox with low quotas - on the order of one message per second and 200
per day - and can only send to verified addresses. Request production access and a quota raise
before launch, not on launch day. The full driver contract, the failure classification, and the
live test that proves the signature are in [EMAIL.md](EMAIL.md).

## Object Storage And Media

Yandex Object Storage is S3-compatible. Use it for durable uploads, generated files, public media, and downloadable assets.

Recommended production setup:

- One bucket per environment and purpose when practical, for example `<project>-prod-media`, `<project>-prod-webapp`, and `<project>-prod-website`.
- Use service-account static access keys for S3-compatible SDKs and upload tools.
- Use `https://storage.yandexcloud.net` as the Object Storage endpoint.
- Use `ru-central1` as the S3 SDK region unless the current Yandex docs say otherwise.
- Store public immutable media behind Cloud CDN.
- Keep private files private and serve them through short-lived presigned URLs after backend permission checks.
- Do not put emails, names, customer IDs, or sensitive data in bucket names, object keys, metadata, or tags.

The backend storage layer is provider-neutral: Yandex Object Storage is configured, not coded for. Set the `PRIVATE_STORAGE_*` group above and the same code path that runs against a local container runs against Object Storage. Before launch, verify presigned PUT/GET behaviour against the real bucket and configure its CORS rule for the deployed web origins; see [STORAGE.md](STORAGE.md).

## Image Optimization

Yandex Object Storage and Cloud CDN store and deliver images. For image optimization:

- First consider Yandex Cloud Marketplace Image Resizer when the product only needs fixed-size variants generated after upload.
- For app-owned variants, generate thumbnails/responsive sizes in the backend, a worker, Cloud Functions, or a dedicated container, then store the generated files in Object Storage.
- For dynamic URL-based transformations, consider a dedicated Thumbor/imgproxy-style service and put Cloud CDN in front of it.
- Do not add image-processing dependencies or a dynamic image service until the product actually needs optimized variants.

## Validation

Before touching cloud resources, run the smallest relevant local checks for active surfaces:

```bash
bun run typecheck
bun run test
bun run build
```

After deployment:

- verify `/health/live` and `/health/ready` through `https://api.<site-domain>` on API Gateway while the underlying API container remains private;
- verify browser auth only from allowed `CORS_ORIGINS`;
- verify all cookie-backed auth writes reject missing or untrusted browser `Origin` headers;
- verify the webapp and API use same-site custom domains and that a reload restores the cookie-backed session in a browser with third-party cookies blocked;
- verify through API Gateway that register returns `Set-Cookie`, refresh receives that cookie, `/me` receives the bearer `Authorization` header, logout clears the cookie, and the next refresh returns 401;
- verify Managed PostgreSQL connectivity and that Prisma migrations applied exactly once;
- verify the private auth cleanup timer is active and its most recent scheduled invocation completed with task exit code `0`;
- verify `webapp` route refreshes load the SPA fallback instead of a broken 404 page;
- verify `website` static assets load from the production domain;
- verify text assets arrive compressed - `curl -sI -H 'Accept-Encoding: br, gzip' <origin>/<hashed-asset>` must answer with a `content-encoding` header, and the same request without `Accept-Encoding` must not. Take the asset path from the built output of the surface under test: `webapp` hashes into `assets/`, `website` into `_astro/`. Pick a JavaScript or CSS bundle. Cloud CDN decides what to compress from the `Content-Type` the bucket returns, which the upload above infers from the file extension, so an object stored with the wrong type is the realistic way a correctly configured resource still answers uncompressed. Compression here is one manual `--gzip-on` with nothing to fail loudly if it was skipped, so this check is the only thing that catches it;
- verify an avatar upload completes end to end against the production bucket, and that its
  download link expires and requires backend authorization.

## Current Upstream Documentation

- Yandex Cloud CLI quickstart: https://yandex.cloud/en/docs/cli/quickstart
- Yandex Cloud CLI reference: https://yandex.cloud/en/docs/cli/cli-ref/
- Yandex Serverless Containers: https://yandex.cloud/en/docs/serverless-containers/
- Getting started with Serverless Containers: https://yandex.cloud/en/docs/serverless-containers/quickstart/container
- Serverless Containers environment variables: https://yandex.cloud/en/docs/serverless-containers/operations/environment-variables-add
- Serverless Containers task runtime: https://yandex.cloud/en/docs/serverless-containers/operations/update-runtime
- Serverless Containers timer trigger: https://yandex.cloud/en/docs/serverless-containers/operations/timer-create
- Serverless Containers request-header filtering: https://yandex.cloud/en/docs/serverless-containers/concepts/invoke
- API Gateway Serverless Containers integration: https://yandex.cloud/en/docs/api-gateway/concepts/extensions/containers
- API Gateway custom domains: https://yandex.cloud/en/docs/api-gateway/operations/api-gw-domains
- Smart Web Security Advanced Rate Limiter: https://yandex.cloud/en/docs/smartwebsecurity/concepts/arl
- Creating an ARL profile: https://yandex.cloud/en/docs/smartwebsecurity/operations/arl-profile-create
- Adding an ARL rule: https://yandex.cloud/en/docs/smartwebsecurity/operations/arl-rule-add
- Smart Web Security response templates: https://yandex.cloud/en/docs/smartwebsecurity/concepts/response-templates
- API Gateway Smart Web Security extension: https://yandex.cloud/en/docs/api-gateway/concepts/extensions/sws
- API Gateway CORS extension: https://yandex.cloud/en/docs/api-gateway/concepts/extensions/cors
- Connecting a security profile to API Gateway: https://yandex.cloud/en/docs/smartwebsecurity/operations/host-connect
- Smart Web Security logging: https://yandex.cloud/en/docs/smartwebsecurity/operations/configure-logging
- Smart Web Security monitoring: https://yandex.cloud/en/docs/smartwebsecurity/operations/monitoring
- Smart Web Security alerts: https://yandex.cloud/en/docs/smartwebsecurity/operations/alerting
- Smart Web Security pricing: https://yandex.cloud/en/docs/smartwebsecurity/pricing
- Deprecated API Gateway rate-limit extension: https://yandex.cloud/en/docs/api-gateway/concepts/extensions/rate-limit
- Yandex Container Registry quickstart: https://yandex.cloud/en/docs/container-registry/quickstart
- Yandex Managed Service for PostgreSQL: https://yandex.cloud/en/docs/managed-postgresql/
- Managed PostgreSQL connection pre-configuration: https://yandex.cloud/en/docs/managed-postgresql/operations/connect/
- Yandex Managed Service for Valkey: https://yandex.cloud/en/docs/managed-redis/
- Connecting to a Yandex Valkey cluster: https://yandex.cloud/en/docs/managed-valkey/operations/connect/clients
- Yandex Object Storage: https://yandex.cloud/en/docs/storage/
- Object Storage static website hosting: https://yandex.cloud/en/docs/storage/operations/hosting/setup
- Object Storage AWS CLI: https://yandex.cloud/en/docs/storage/tools/aws-cli
- Uploading objects to Object Storage: https://yandex.cloud/en/docs/storage/operations/objects/upload
- Yandex Cloud CDN overview: https://yandex.cloud/en/docs/cdn/concepts/
- Yandex Cloud Marketplace Image Resizer: https://yandex.cloud/en/marketplace/products/yc/image-resizer
- Thumbor on Yandex Cloud: https://yandex.cloud/en/docs/marketplace/tutorials/thumbor
