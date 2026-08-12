# Storage And Media

Use this document when a product needs uploads, images, media, generated files, or downloadable assets.

Private file storage is built into this template and switched on. The reference feature is the user avatar: one private image per user, replaceable and deletable, wired from the browser through to storage. Read it end to end before adding a second kind of upload — `webapp/src/features/avatar`, `backend/src/modules/uploads`, `backend/src/storage`.

## Two Drivers, One Contract

Everything above the storage layer talks to one provider-neutral port, `backend/src/storage/port.ts`. Two drivers implement it:

| `PRIVATE_STORAGE_DRIVER` | What it is | What it needs |
| --- | --- | --- |
| `filesystem` (default) | Files on the local disk, served by the backend through signed URLs | Nothing. No cloud account, no Docker |
| `s3` | Any S3-compatible endpoint | Credentials, or the local container below |

The point of the split is that moving from one to the other is a configuration change, never a code change. The filesystem driver is not a stub: it issues time-limited signed URLs, refuses unsigned reads with `403`, and makes every upload key write-once. A development driver more permissive than production would hide exactly the bugs it exists to surface.

One suite proves it. `backend/src/storage/storage-contract.ts` defines the behaviour once and is executed twice: against the local disk in the fast unit run, and against a real S3 server in the live run. If the drivers ever diverge, one of the two runs fails.

## Intake Before Building File Features

The product-level questions live in [CHECKLIST.md](../CHECKLIST.md) under files, images, and media, and the answers are recorded there. Ask them before implementation; do not restate them here, so the intake keeps one source.

## Local Development

Nothing to start. `bun run dev` uses the filesystem driver and writes to `backend/.storage`, which is git-ignored.

To exercise the real S3 path — signature checks, provider behaviour, CORS — run a local S3 server:

```bash
bun run storage:local:start   # start the container, create the bucket, apply CORS, print the env
bun run storage:local:status  # is it up, and is the bucket reachable
bun run storage:local:env     # print the PRIVATE_STORAGE_* block again
bun run storage:local:stop    # stop it, keeping the volume and its objects
```

`storage:local:stop` stops one container. It never runs `docker compose down`, which cannot be scoped to a service and would take the database with it and, with `--volumes`, the uploaded objects too.

Then run the app or its tests against it:

```bash
bun run dev:backend:s3     # backend against the local S3 server
bun run test:storage:s3    # the live storage contract
bun run e2e:webapp:s3      # the full browser journey against the local S3 server
```

The container is SeaweedFS `weed mini`, pinned to a specific tag in `docker-compose.yml`, published on `127.0.0.1` only, with fixed and deliberately fake credentials. Its port is derived from this checkout's path so two clones never collide, and `PRIVATE_STORAGE_S3_PORT` overrides it. Versioning and object locking stay off: SeaweedFS mishandles conditional writes when they are enabled, and conditional writes are what make an upload key write-once.

## Configuration

```bash
PRIVATE_STORAGE_DRIVER=filesystem          # or s3
PRIVATE_STORAGE_LOCAL_ROOT=.storage        # filesystem driver only
PRIVATE_STORAGE_LOCAL_PUBLIC_URL=          # defaults to http://127.0.0.1:${PORT}

PRIVATE_STORAGE_REGION=                    # the five below are required together when driver=s3
PRIVATE_STORAGE_BUCKET=
PRIVATE_STORAGE_ENDPOINT=
PRIVATE_STORAGE_ACCESS_KEY_ID=
PRIVATE_STORAGE_SECRET_ACCESS_KEY=

PRIVATE_STORAGE_FORCE_PATH_STYLE=false     # true for local and most self-hosted endpoints
PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT=false
PRIVATE_STORAGE_UPLOAD_MAX_BYTES=5242880
PRIVATE_STORAGE_UPLOAD_URL_TTL_SECONDS=900
PRIVATE_STORAGE_DOWNLOAD_URL_TTL_SECONDS=300
```

`backend/src/env.ts` refuses to start on an incoherent combination rather than failing at the first upload:

- **Production refuses the filesystem driver.** An App Platform container's disk does not survive a deploy, so a production app that ships uploads must have a bucket.
- **A non-loopback endpoint needs `PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT=true`.** This is the whole safety story in one rule: outside production a stray `.env` cannot point a development machine at a real bucket, and production stays fail-closed until someone opens the gate on purpose. The committed DigitalOcean spec `.do/api-app.yaml` sets it explicitly, so opening the gate is a visible line in a reviewed file rather than a flag someone passed once.
- **Production requires HTTPS and a non-loopback endpoint.**
- **The five S3 settings are all-or-nothing**, and setting any of them under the filesystem driver is an error rather than something quietly ignored.
- **A local endpoint requires path-style addressing**, because it cannot resolve `<bucket>.<host>`.

## Any S3-Compatible Provider

The S3 driver is not written against one vendor. DigitalOcean Spaces, Yandex Object Storage, MinIO, Cloudflare R2, and AWS S3 are all configured by the five variables above; the differences are endpoint, region, and whether the provider wants path-style addressing.

One capability is worth checking before you commit to a provider: **conditional writes**. The write-once guarantee rests on `If-None-Match: *` returning `412` when the key exists, and not every S3-compatible server implements it — this template verifies it only against the local SeaweedFS container, and some providers do not document it at all. Where it is missing, uploads still work and the product path stays safe (every ticket mints a fresh UUID key, so there is nothing to overwrite), but a retried PUT silently replaces instead of being refused. `bun run test:storage:s3` against your own endpoint is the quickest way to find out.

- DigitalOcean Spaces — `https://<region>.digitaloceanspaces.com`, virtual-host addressing.
- Yandex Object Storage — `https://storage.yandexcloud.net`. See [YANDEX_CLOUD.md](YANDEX_CLOUD.md).
- MinIO or another self-hosted gateway — set `PRIVATE_STORAGE_FORCE_PATH_STYLE=true`.

Whichever you pick, the bucket must be private. These objects carry no ACL: privacy comes from the bucket default, because per-object ACLs are unavailable or discouraged on several of these providers.

## The Upload Contract

1. The browser asks the backend for an upload ticket, declaring content type and exact byte size.
2. The backend generates the object key, signs a `PUT`, and records a `pending` row.
3. The browser sends the file **straight to storage** using the ticket's headers verbatim.
4. The browser asks the backend to finalize.
5. The backend verifies what was actually stored, then publishes it.

Details that matter, and why:

- **The signature covers the size, the content type, and `If-None-Match: *`.** SigV4 leaves `content-type` out by default, which would let a URL issued for a PNG accept anything; the S3 driver signs it explicitly.
- **`If-None-Match: *` makes a key write-once.** A second `PUT` to the same key gets `412`, so a retry can never overwrite an object another record already points at.
- **A retry always gets a new key.** Because keys are write-once, reusing one after an interrupted transfer would hand the user a URL that can only answer `412`. Requesting a new ticket abandons the old row and sweeps its object.
- **The client treats `412` as success.** It means this exact object is already stored, which is what a retry looks like when the first attempt actually landed. Reporting a failure would strand the user on an upload that worked.
- **Finalize is the only authority on content.** It checks the object exists, that its size and type match the request, and that its leading bytes are a JPEG, PNG, or HEIC/HEIF signature. A declared content type is a claim; magic bytes are evidence. Anything else is deleted and rejected.
- **Object keys are generated by the backend and carry no personal data.** The shape is `<namespace>/<yyyy>/<mm>/<uuid>` — there is nowhere to put an email, a name, or a record id. Ownership lives in PostgreSQL, which is the only place that can enforce it.
- **Reads are signed and short-lived.** There is no public URL and no CDN base URL. An unsigned read is `403` on both drivers.
- **The optional AWS SDK checksum is disabled** (`requestChecksumCalculation: 'WHEN_REQUIRED'`). When presigning there is no body yet, so the SDK would sign the checksum of an empty one and every real upload would fail the signature.

Deletion is idempotent on both drivers, and superseded objects are removed after the response rather than inside the transaction, so a storage hiccup cannot fail an upload the database already committed.

Know the limit of that trade. The `uploads:pending:cleanup` job in [BACKGROUND_JOBS.md](BACKGROUND_JOBS.md) sweeps uploads that were **never finalized**: their row survives, so their key is still known. It does not cover replace and delete, where the row goes with the transaction and the object delete is best-effort afterwards — if that delete fails, nothing records the key any more and the object is orphaned. Deleting a user has the same shape, and worse: the `users` cascade drops the avatar row without any object delete at all. For a template storing one small avatar per user that is an acceptable leak; a product storing large or regulated files, or one that adds account deletion, should make the key outlive the row and add a reconciliation pass over the bucket.

## CORS

The browser uploads cross-origin, so both drivers have to allow the same request. `browserUploadAllowedHeaders` in `backend/src/storage/config.ts` is the single source: the API's CORS layer allows it plus `Authorization` (as `apiCorsAllowedHeaders`), and `scripts/storage-local.mjs` passes the bare list to `PutBucketCors` for the local container. A presigned URL carries its own authority, so the bucket rule never needs `Authorization`. A deployed bucket needs the equivalent rule — the deployed web origins, `GET`/`PUT`/`HEAD`, the `Content-Type` and `If-None-Match` headers, and `ETag` exposed.

## Displaying A Private File

The webapp loads an avatar with `fetch` and renders an object URL rather than pointing `<img src>` at the signed URL. `secureHeaders()` sets `Cross-Origin-Resource-Policy: same-origin` on the API, which blocks a no-cors image load from the web origin — that would break the filesystem driver while leaving S3 working, and two drivers behaving differently in a browser is the bug this whole layer exists to prevent. A CORS-mode fetch behaves identically on both, and keeps a time-limited credential out of the DOM.

## Public Assets And CDN

This template has no public-object path: no public ACLs, no CDN base URL, no public URL builder. Everything it stores is private and reached through a short-lived signed URL.

If a product needs public immutable assets — marketing images, downloadable releases — add that deliberately rather than by loosening this layer: a second bucket that is public by default, a `publicUrlForKey` helper beside the driver, and a CDN in front of it. Keep the private path as it is; mixing the two in one bucket is how private files end up public.

## Images And Optimization

The template stores the original upload and does not transform it. HEIC is accepted and stored, but browsers do not render it, so a product that wants HEIC photos displayed needs a conversion step.

When optimized images are required, generate app-owned variants in the backend or a worker and store them under stable keys such as `images/<entity>/<id>/<variant>.webp`. Use a library such as `sharp` only when actually implementing that. For dynamic transformation by URL, run an image proxy such as `imgproxy` against the bucket. Use Cloudinary or ImageKit only when the user explicitly chooses that tradeoff.

## Security And Privacy

- Never commit storage credentials. The local container's credentials are fixed, fake, and loopback-only by design.
- Use a limited-access key scoped to the app's bucket.
- Validate content type, size, owner, and permissions before issuing any URL, and verify the stored object before publishing it.
- Generate object keys server-side. Never trust a client-provided path.
- Keep emails, names, customer ids, and other personal data out of bucket names, object keys, metadata, and tags.
- Delete objects when the owning record is deleted. `user_avatars` cascades from `users`, but that removes only the rows — and a row is the only record of its object key, so deleting a user today orphans their avatar in the bucket. A product that adds account deletion must delete the objects first; see the limits noted under the upload contract.

## Current Upstream Documentation

- SeaweedFS `weed mini`: https://github.com/seaweedfs/seaweedfs/wiki/Quick-Start-with-weed-mini
- SeaweedFS S3 API: https://github.com/seaweedfs/seaweedfs/wiki/Amazon-S3-API
- AWS S3 conditional requests: https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-requests.html
- AWS SDK for JavaScript presigned URLs: https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-example-creating-buckets.html
- DigitalOcean Spaces S3 compatibility: https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/
- Configure CORS on Spaces: https://docs.digitalocean.com/products/spaces/how-to/configure-cors/
- Yandex Object Storage: https://yandex.cloud/en/docs/storage/
- MinIO S3 compatibility: https://min.io/docs/minio/linux/index.html
