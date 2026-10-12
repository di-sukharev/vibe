# Files and media

[backend/src/storage](../backend/src/storage) provides filesystem and S3 drivers. The upload module and avatar feature are the working examples. Product code uses the storage port rather than provider SDKs.

## Local development

The default filesystem driver writes to ignored `backend/.storage`. For S3 behavior, run:

```bash
bun run storage:local:start
bun run dev:backend:s3
bun run test:storage:s3
bun run e2e:webapp:s3
```

Run the backend and tests separately. The scripts start the local SeaweedFS container when needed. `storage:local:stop` preserves its volume. [docker-compose.yml](../docker-compose.yml) defines the image and local access. Local versioning is disabled because it breaks conditional writes.

## Configuration

Use [backend/.env.example](../backend/.env.example) and [backend/src/env.ts](../backend/src/env.ts) for variables and validation. Production requires private S3 storage and HTTPS. Remote endpoints need explicit permission through `PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT`.

Before using a provider, check conditional writes on a versioned bucket. Send two PUT requests to one key with `If-None-Match: *`. The second must return 412. Repository tests cannot verify a provider's behavior.

## Uploads and reads

The backend creates an upload ticket for an exact size and content type. The client must preserve its signed headers. Each attempt uses a new key. A repeated PUT to that key returns 412 and does not replace the object.

Finalize checks the stored size, type, and supported image signature before publishing the upload. Keep ownership and permissions in PostgreSQL. Create keys on the server and keep personal data out of keys and metadata.

Read private files through short-lived signed URLs. In the browser, fetch the file with CORS and display an object URL. A direct signed URL in `img src` conflicts with the filesystem driver's resource policy.

Restrict stored and returned URL schemes explicitly. Use the shared upload schema; unrestricted URL validation can admit executable schemes.

## Deletion and recovery

Avatar changes queue object deletion in the same database transaction. The outbox retries failed deletions after a restart. A second deletion after the old upload URL expires removes late uploads. Run the outbox worker or scheduled drain. Direct database user deletion can still orphan an avatar; it needs a separate deletion workflow. Existing orphaned objects need reconciliation.

Cloud media buckets retain noncurrent versions for 30 days. Recovery restores bytes, not ownership. Back up PostgreSQL separately. Reconciliation must preserve delete markers.

An operator can remove a delete marker or copy an old version. DigitalOcean expiry needs verification; see [DigitalOcean](DIGITALOCEAN.md#spaces-version-expiry). Yandex requires separate operator access; see [Yandex Cloud](YANDEX_CLOUD.md#media-version-recovery).

## Permissions and CORS

Keep buckets private and scope runtime keys to the application bucket. Keep operator keys separate. Verify provider permissions before relying on version retention.

[browserUploadAllowedHeaders](../backend/src/storage/config.ts) defines upload headers. The local script applies them automatically. Keep Terraform CORS aligned with the webapp origin and signed upload headers.

Public files require a separate bucket. Do not expose the private media bucket through a public CDN.
