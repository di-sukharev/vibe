# Files and media

Private storage for uploads and downloads. The user avatar is the reference implementation: `webapp/src/features/avatar`, `backend/src/modules/uploads`, and `backend/src/storage`. Ask the file questions in [CHECKLIST](../CHECKLIST.md) before you build.

## Two drivers, one contract

Product code uses `backend/src/storage/port.ts`. `PRIVATE_STORAGE_DRIVER` selects the driver:

- `filesystem`, the default: the local disk, with URLs that the backend signs and serves. URLs expire, unsigned requests get `403`, and a key accepts one write.
- `s3`: any S3-compatible endpoint.

`backend/src/storage/storage-contract.ts` tests both drivers: the disk in unit tests and S3 in the live run.

## Local development

`bun run dev` writes to `backend/.storage` through the filesystem driver. Git ignores that directory.

For S3 behavior or CORS, use the local container. `bun run storage:local:start` starts it, creates the bucket, applies CORS, and prints the env block. `storage:local:stop` keeps the volume. `bun run dev:backend:s3`, `test:storage:s3`, and `e2e:webapp:s3` start the container, then run the backend, the storage contract, or the avatar journey against it.

The container runs SeaweedFS `weed mini` from `docker-compose.yml` on `127.0.0.1` with fixed demo keys. Its port derives from the checkout path, and `PRIVATE_STORAGE_S3_PORT` overrides it. Local versioning is off, because SeaweedFS then breaks conditional writes.

## Configuration

`backend/.env.example` lists the variables. `backend/src/env.ts` refuses these at startup:

- `filesystem` in production, because a container disk does not survive a deploy.
- A non-loopback endpoint without `PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT=true`, in production too.
- A production endpoint that is loopback or not HTTPS.
- An incomplete set of the five S3 variables, or any of them with `filesystem`.
- A loopback endpoint without `PRIVATE_STORAGE_FORCE_PATH_STYLE=true`.

Local URLs are signed with a key derived from `JWT_SECRET`. Rotating it invalidates them.

## S3-compatible providers

Providers differ in endpoint, region, and path style:

- DigitalOcean Spaces: `https://<region>.digitaloceanspaces.com`, with the bucket in the host name.
- Yandex Object Storage: `https://storage.yandexcloud.net`, region `ru-central1`.
- MinIO and self-hosted gateways: `PRIVATE_STORAGE_FORCE_PATH_STYLE=true`.

Before you choose a provider, PUT one key twice with `aws s3api put-object --if-none-match '*'` on a versioned bucket, as in production. The second PUT must return `412`. Otherwise a repeated PUT replaces the object. Repository tests cannot check this.

The bucket is always private. Do not use object ACLs.

## Upload contract

The browser requests a ticket for a content type and exact size. The backend creates a key, signs a `PUT`, and saves a `pending` row. The browser uploads with the ticket headers unchanged. Finalize checks the stored object and publishes it.

- The signature covers the size, `Content-Type`, and `If-None-Match: *`.
- A key accepts one write. A second PUT gets `412`, which the client treats as success.
- Each attempt gets a new ticket and key. The old pending upload is removed.
- Finalize checks presence, size, stored type, and the leading bytes of JPEG, PNG, or HEIC/HEIF. A mismatch deletes the object.
- Keys are `<namespace>/<yyyy>/<mm>/<uuid>`. PostgreSQL maps records to keys.
- Reads use short-lived signed URLs.

## Deletion and recovery

Replaced and removed objects are deleted after the response. A failed delete orphans the object, because its row is gone and `uploads:pending:cleanup` covers only unfinished uploads. Deleting a user also orphans the avatar file. Accept this only for small avatars. For other files, or before you add account deletion, delete files explicitly, keep keys longer than their records, and reconcile the bucket.

Terraform versions the media bucket on both clouds. Noncurrent versions expire after 30 days, and incomplete multipart uploads after 7. DigitalOcean does not guarantee this expiry; see [DIGITALOCEAN](DIGITALOCEAN.md). This window is the only undo for media: an operator can remove a delete marker or copy an old version back. On Yandex Cloud, see [YANDEX_CLOUD](YANDEX_CLOUD.md) first. Reconciliation must skip delete markers.

The window restores bytes, not ownership, so back up the database separately. Never give the application an account-level access key, which can delete versions. The Yandex Cloud runtime key cannot delete versions; DigitalOcean does not document whether its scoped `readwrite` key can.

## CORS

`browserUploadAllowedHeaders` in `backend/src/storage/config.ts` is the source list. The API adds `Authorization`, and `scripts/storage-local.mjs` applies the list to the local bucket. A bucket never needs `Authorization`, because a signed URL carries its own authority. Terraform sets the production rule: the webapp origin; `GET`, `PUT`, and `HEAD`; `Content-Type` and `If-None-Match`; and the exposed `ETag`. Keep both in sync.

## Showing a private file

Download the file with a CORS `fetch` and show an object URL. Never put a signed URL in `<img src>`. The API sends `Cross-Origin-Resource-Policy: same-origin`, which blocks a no-cors image with the filesystem driver.

## Public files and CDN

The template has no public files. For public immutable files, add a separate public bucket, a `publicUrlForKey` next to the driver, and a CDN. Never mix public and private files in one bucket.

## Images

The template stores originals. Browsers need a conversion step to show HEIC. Create variants in the backend or a worker under stable keys, such as `images/<entity>/<id>/<variant>.webp`. For transforms by URL, put `imgproxy` in front of the bucket. Use Cloudinary or ImageKit only when the user chooses them.

## Security and privacy

- Never commit access keys. The fixed local keys are loopback-only demo values.
- Scope each access key to the application's bucket. Yandex Cloud policies: [YANDEX_CLOUD](YANDEX_CLOUD.md).
- Before you issue a URL, check type, size, owner, and permissions.
- Create object keys on the server. Never trust a client path.
- Keep personal data out of bucket names, keys, metadata, and tags.
- Parse every stored or returned URL and allow only `http:` and `https:`. `z.url()` accepts `javascript:` and `data:`. See `httpUrlSchema` in `packages/contracts/src/uploads.ts`.
