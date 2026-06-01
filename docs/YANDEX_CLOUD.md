# Yandex Cloud Alternative

Use this document only when the user explicitly asks for Yandex Cloud or the product has a clear regional, compliance, or commercial reason to avoid the default DigitalOcean path.

DigitalOcean remains the default provider in this template. Do not ask the user to compare providers during first-run setup.

## Service Map

- Backend/API: Yandex Serverless Containers, running a Docker image from Yandex Container Registry.
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
- Production domains and DNS access when custom domains are in scope.
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

Create the Serverless Container and deploy a revision:

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

Serverless Containers set `PORT` automatically. The backend must continue reading `PORT` from the environment and exposing `/health`.

Production env must include:

```bash
DATABASE_URL=postgresql://...
JWT_SECRET=<at-least-32-random-characters>
CORS_ORIGINS=https://webapp.example.com,https://website.example.com
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=30
COOKIE_SECURE=true
```

Container environment variables are part of a revision. When deploying with `yc serverless container revision deploy --environment`, include the full required environment for that revision because changing environment variables creates a new revision. Prefer the console, Terraform, or Yandex Lockbox for sensitive values when shell quoting becomes risky.

Generate `JWT_SECRET` with `openssl rand -hex 32`; that command creates 32 random bytes encoded as 64 hex characters. Do not use the placeholder from `.env.example`, repeated characters, or human phrases.

## Managed PostgreSQL

Use Yandex Managed Service for PostgreSQL for production data.

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

## Real-Time Pub/Sub

Keep the Yandex deployment path monolithic by default: the backend container should own HTTP routes, auth, persistence, and any WebSocket endpoints. Do not split chat, notifications, or presence into microservices unless the product has a concrete operational reason.

When the backend runs as one container instance, WebSocket connection state can stay inside that process. If the container is horizontally scaled and users connected to different instances must receive the same chat, presence, collaboration, or live-notification events, add Yandex Managed Service for Valkey as a Redis-compatible Pub/Sub broker.

Each backend instance should publish domain events to Valkey and subscribe to the channels it needs to deliver events to its own local WebSocket connections. Keep Valkey out of baseline local setup and ordinary request/response APIs; add it only for cross-instance real-time fanout.

## Static Webapp And Website

Deploy `webapp` and fully prerendered `website` output as static websites in Yandex Object Storage. Once `website` uses SSR/on-demand rendering or Astro server islands, that surface needs an Astro adapter and must move to a Serverless Container runtime instead of static hosting. When server islands appear on cached pages or rolling deploys, generate a stable key with `astro create-key` and configure `ASTRO_KEY` as a secret in both build and runtime environments. Never commit it, expose it as `PUBLIC_*`, print it in logs, or bake it into static output.

Use shared CDN caching only for anonymous, public-equivalent website responses. Auth-dependent or personalized routes and server islands must use `private` or `no-store`, or a deliberately supported `Vary: Cookie`/`Authorization` strategy. `ASTRO_KEY` is not a cache privacy boundary.

Build locally or in CI:

```bash
bun run build:webapp
bun run build:website
```

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

- verify `/health` on the Serverless Container public URL;
- verify browser auth only from allowed `CORS_ORIGINS`;
- verify cookie-backed refresh/logout reject missing or untrusted browser `Origin` headers;
- verify Managed PostgreSQL connectivity and that Prisma migrations applied exactly once;
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
