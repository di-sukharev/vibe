# Yandex Cloud Alternative

Use this document only when the user explicitly asks for Yandex Cloud or the product has a clear regional, compliance, or commercial reason to avoid the default DigitalOcean path.

DigitalOcean remains the default provider in this template. Do not ask the user to compare providers during first-run setup.

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

Ask only product and release questions:

- which surfaces are being deployed now: backend/API, webapp, website, mobile, or full-stack;
- production domains for API, webapp, website, media/CDN, and the mobile API endpoint;
- whether backend/database traffic may stay private inside a Yandex Cloud network or must be reachable from the internet;
- whether uploads/media are public, private, or mixed;
- whether real-time chat, presence, collaboration, live notifications, or WebSocket-style updates must work across multiple backend instances;
- whether images need fixed-size generated variants, dynamic transformations, compression, cropping, or moderation.

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

Production env must include:

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
AUTH_RATE_LIMIT_MAX=60
AUTH_RATE_LIMIT_WINDOW_SECONDS=60
SHUTDOWN_GRACE_SECONDS=20
TRUST_PROXY=true
TRUSTED_PROXY_CLIENT_IP_HEADER=x-forwarded-for
TRUSTED_PROXY_CLIENT_IP_POSITION=last
COOKIE_SECURE=true
```

Yandex Serverless Containers append the invoking user's address to `X-Forwarded-For`, including after any values supplied by the caller. Selecting the last value avoids trusting a caller-controlled first entry. Recheck this provider contract if the backend moves behind a different Yandex ingress product.

`AUTH_RATE_LIMIT_*` configures an in-process `Map`, so it is only a per-instance backstop. `--concurrency 1` limits simultaneous calls inside one instance; it does not keep Serverless Containers on one instance, and the platform can start instances in multiple availability zones. For meaningful production protection of login/register/refresh/logout, attach Yandex Smart Web Security with an Advanced Rate Limiter profile to the API Gateway, or replace the backend limiter with shared cross-instance state. Do not use the older API Gateway `x-yc-apigateway-rate-limit` extension for a new deployment: Yandex marks it deprecated and directs users to Smart Web Security. A container instance cap is a capacity/cost control, not a security boundary.

Container environment variables are part of a revision. When deploying with `yc serverless container revision deploy --environment`, include the full required environment for that revision because changing environment variables creates a new revision. Prefer the console, Terraform, or Yandex Lockbox for sensitive values when shell quoting becomes risky.

Generate `JWT_SECRET` with `openssl rand -hex 32`; that command creates 32 random bytes encoded as 64 hex characters. Do not use the placeholder from `.env.example`, repeated characters, or human phrases.

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

Create an OpenAPI 3 specification outside the repository, for example `.scratch/deploy/yandex-api-gateway.yaml`, using the actual container and service-account IDs:

```yaml
openapi: 3.0.0
info:
  title: project-api
  version: 1.0.0
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

Use `https://api.example.com` as `VITE_API_URL` and `https://app.example.com` in backend `CORS_ORIGINS`. Wait for certificate and DNS readiness before the browser auth smoke. The direct container URL remains private and is not a production API endpoint.

Before exposing auth routes, connect a Smart Web Security security profile and Advanced Rate Limiter profile to the gateway. Scope limits to the auth write paths and choose client grouping/thresholds from the product's abuse model. Keep the backend limiter enabled as defense in depth, but do not count it as a global attempt limit when Serverless Containers scales out.

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

## Auth Session Cleanup Timer

Production must run `auth:sessions:cleanup` on a schedule; setting `SESSION_RETENTION_DAYS` alone does not delete rows. Use a separate private Serverless Container from the same immutable backend image in **task** runtime mode. This keeps the public API process monolithic while giving the timer a one-shot command that exits non-zero on failure.

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

Configure the cleanup revision with the same production `DATABASE_URL`, `JWT_SECRET`, session TTL, retention, network, and Lockbox policy as the API revision. Prefer Lockbox or the console instead of putting real secrets into shell history. Do not make the cleanup container public.

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

After deployment, invoke the private cleanup container once with an IAM token and verify HTTP 200 plus `X-Task-Exit-Code: 0`. Then confirm `yc serverless trigger get --name <project>-auth-cleanup-daily` reports an active trigger. After the first scheduled window, inspect the cleanup container's invocation logs and require a recent `Cron auth:sessions:cleanup removed ... stale sessions.` entry; absence of a recent successful entry is an operational failure, not proof that there were zero stale sessions.

## Real-Time Pub/Sub

Keep the Yandex deployment path monolithic by default: the backend container should own HTTP routes, auth, persistence, and any WebSocket endpoints. Do not split chat, notifications, or presence into microservices unless the product has a concrete operational reason.

When the backend runs as one container instance, WebSocket connection state can stay inside that process. If the container is horizontally scaled and users connected to different instances must receive the same chat, presence, collaboration, or live-notification events, add Yandex Managed Service for Valkey as a Redis-compatible Pub/Sub broker.

Each backend instance should publish domain events to Valkey and subscribe to the channels it needs to deliver events to its own local WebSocket connections. Keep Valkey out of baseline local setup and ordinary request/response APIs; add it only for cross-instance real-time fanout.

## Static Webapp And Website

Deploy `webapp` and fully prerendered `website` output as static websites in Yandex Object Storage. Once `website` uses SSR/on-demand rendering or Astro server islands, that surface needs an Astro adapter and must move to a Serverless Container runtime instead of static hosting. When server islands appear on cached pages or rolling deploys, generate a stable key with `astro create-key` and configure `ASTRO_KEY` as a secret in both build and runtime environments. Never commit it, expose it as `PUBLIC_*`, print it in logs, or bake it into static output.

Use shared CDN caching only for anonymous, public-equivalent website responses. Auth-dependent or personalized routes and server islands must use `private` or `no-store`, or a deliberately supported `Vary: Cookie`/`Authorization` strategy. `ASTRO_KEY` is not a cache privacy boundary.

Build locally or in CI:

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

Upload built assets to public website buckets:

```bash
aws --endpoint-url=https://storage.yandexcloud.net/ s3 cp --recursive webapp/dist/ s3://<webapp-bucket>/
aws --endpoint-url=https://storage.yandexcloud.net/ s3 cp --recursive website/dist/ s3://<website-bucket>/
```

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

Use immutable asset filenames from Vite/Astro builds and long cache headers for hashed assets. Keep `index.html` cache short enough for releases to roll out quickly.

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

The backend storage service in this template is S3-compatible but currently named around the DigitalOcean default. If Yandex Cloud is selected for production storage, configure a provider-specific storage pass before launch: make the S3 signing region/provider endpoint explicit, set a Yandex CDN/public base URL, and validate presigned PUT/GET behavior against Object Storage.

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
- verify public media loads through the Cloud CDN domain when storage is active;
- verify private file links expire and require backend authorization when private storage is active.

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
