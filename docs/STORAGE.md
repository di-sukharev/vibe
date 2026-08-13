# Storage And Media

Use this document when a product needs uploads, images, media, generated files, or downloadable assets.

Private file storage is built into this template and switched on. The reference feature is the user avatar: one private image per user, replaceable and deletable, wired from both clients through to storage. Read it end to end before adding a second kind of upload — `webapp/src/features/avatar`, `mobile/src/features/avatar`, `mobile/src/platform/uploads`, `backend/src/modules/uploads`, `backend/src/storage`.

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

### Sending The Bytes From The Mobile Client

The five steps above are the same on mobile; only step 3 differs, and it lives in `mobile/src/platform/uploads`. `transfer.ts` holds the protocol as pure code — check the size still matches the ticket, hand the request to a sender, classify the answer, treat `412` as success — and knows nothing about avatars, endpoints, or images. Adding a second kind of upload reuses it as-is.

What it does not know is how to read a file, because that is the one thing that differs between the platforms Expo builds for:

| | Measuring the bytes | Sending them |
| --- | --- | --- |
| iOS, Android (`native-file-access.ts`) | `File.size` from `expo-file-system` | `File.upload`, streaming from disk |
| Web (`web-file-access.ts`) | the blob behind the `blob:` URL | `fetch` with that blob as the body |

`UploadFileAccess` pairs the two operations in one value on purpose, and `AppProviders` selects the pair once from `Platform.OS`. Measuring with one platform's reader and sending with the other's would sign a ticket for a byte count the transfer can never produce, and storage answers that with an opaque `403`.

The web half is not theoretical: `expo export --platform web` is a supported build here, and `expo-file-system` is a warn-only stub in a browser — its `File` reports no size and its upload resolves with status `0`. The picker and the manipulator do work there, so without a browser-aware reader the web build would fail with a perfectly good image in hand. The web `PUT` mirrors `webapp/src/features/avatar/upload.ts`, `credentials: 'omit'` included: the ticket carries its own authority, and sending cookies only breaks the preflight.

## CORS

The browser uploads cross-origin, so both drivers have to allow the same request. (Only in a browser: an iOS or Android build is not subject to CORS at all. The mobile app's **web** build is, so its origin belongs in the same rule.) `browserUploadAllowedHeaders` in `backend/src/storage/config.ts` is the single source: the API's CORS layer allows it plus `Authorization` (as `apiCorsAllowedHeaders`), and `scripts/storage-local.mjs` passes the bare list to `PutBucketCors` for the local container. A presigned URL carries its own authority, so the bucket rule never needs `Authorization`. A deployed bucket needs the equivalent rule — the deployed web origins, `GET`/`PUT`/`HEAD`, the `Content-Type` and `If-None-Match` headers, and `ETag` exposed.

## Displaying A Private File

The webapp loads an avatar with `fetch` and renders an object URL rather than pointing `<img src>` at the signed URL. `secureHeaders()` sets `Cross-Origin-Resource-Policy: same-origin` on the API, which blocks a no-cors image load from the web origin — that would break the filesystem driver while leaving S3 working, and two drivers behaving differently in a browser is the bug this whole layer exists to prevent. A CORS-mode fetch behaves identically on both, and keeps a time-limited credential out of the DOM.

The mobile client's **native** builds need none of that: `Cross-Origin-Resource-Policy` is a browser rule, and a native image loader does not enforce it, so `expo-image` points straight at the signed URL. Its **web** build is a browser and does enforce it, which with the filesystem driver blocks a plain `<img>` load and leaves the avatar showing initials with no error anywhere. `avatarImageSource` therefore attaches an `Accept` header on web only: `expo-image` loads a source that carries headers with `fetch` instead, and a CORS request is not subject to the rule - the same escape the webapp takes, through the library rather than by hand. `Accept` is CORS-safelisted, so it adds no preflight. The point is that both drivers then behave the same in a browser; without it only S3 works, because an S3 endpoint sets no CORP header. It does need one thing the browser does not — an explicit `cacheKey`. expo-image keys its cache on the URL, and every read of the avatar returns a freshly signed URL, so without a key tied to the image's identity every refetch is a cache miss, every signature earns its own disk entry, and a stale cached response can hand the loader a URL that has already expired. `avatarCacheKey` in `mobile/src/features/avatar/image-source.ts` derives that key from `updatedAt` and `byteSize`, so a replaced photo can never be served from the previous one's entry. That is a native mechanism: the web build ignores `cacheKey` and holds the image in the object URL `expo-image` builds from its own fetch, which lasts only as long as the component. Those are two different failures. A read that fails leaves the app not knowing whether a photo exists at all, which would make the card offer "Upload photo" to someone who has one and hide Remove - so the mobile provider exposes that state and a reload. A signature that expires before the image is needed again is invisible to it: the read succeeded and only the image loader failed, so the photo falls back to initials until the next launch while every action stays correct. That is accepted here; a product that needs the picture itself to recover should refetch on foreground rather than retry from the image's error, which loops when storage is what is broken. `avatarImageSource` builds the URI and the key together, because a caller that passes the signed URI on its own silently reintroduces every problem the key exists to prevent.

Those cached bytes outlive the session that fetched them: `cachePolicy="memory-disk"` writes a private photo into the app's cache directory and nothing erases it at sign-out. It is not a cross-account leak — the cache key is derived from the image's own identity, so a second account never matches an entry it did not write, and the directory is inside the app sandbox and reclaimed by the OS under storage pressure. A product with a stricter requirement — shared devices, a compliance rule about data at rest — should call `Image.clearDiskCache()` from `expo-image` in the logout path rather than assume the default is enough.

## Public Assets And CDN

This template has no public-object path: no public ACLs, no CDN base URL, no public URL builder. Everything it stores is private and reached through a short-lived signed URL.

If a product needs public immutable assets — marketing images, downloadable releases — add that deliberately rather than by loosening this layer: a second bucket that is public by default, a `publicUrlForKey` helper beside the driver, and a CDN in front of it. Keep the private path as it is; mixing the two in one bucket is how private files end up public.

## Images And Optimization

The backend stores what it is given and does not transform it. The web client uploads the file as picked, so HEIC from a desktop is stored as HEIC — and browsers do not render HEIC, so a product that wants those photos displayed on the web needs a conversion step.

The mobile client normalizes before it asks for a ticket: `expo-image-manipulator` resizes the long edge to 512px and re-encodes as JPEG. Both it and the picker are available on every platform Expo targets, so this step is shared code - but availability is not parity. The web manipulator decodes through a canvas, so a HEIC picked in Chrome or Firefox is refused there while the same file normalizes fine on a phone. The upload never starts in that case and the message says to try a different photo. Only reading the bytes that were written differs by design. That is why an iPhone photo — routinely HEIC and several megabytes — never reaches the 5 MB contract limit or the web client's HEIC gap. It is client-side convenience and **not** a substitute for verification: finalize still reads the magic bytes of whatever actually arrived. One consequence worth knowing: the backend's HEIC branch is now exercised only by the web client, so it is not dead code even though mobile no longer reaches it.

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
