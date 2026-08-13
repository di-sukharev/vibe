import { describe, expect, test } from 'bun:test'

import type { S3StorageConfig } from './config'
import { createStorageObjectKey } from './object-keys'
import { S3PrivateStorage } from './s3-storage'
import { describeStorageContract, pngFixture } from './storage-contract'

/**
 * The storage contract, proven against a real S3 server.
 *
 * This is the test that makes the filesystem driver believable. Everything the local driver
 * claims - unsigned reads are refused, a key can be written once, ranges work, deletes are
 * idempotent - is asserted here against SeaweedFS through the AWS SDK and plain `fetch`. If a
 * behaviour only holds on the local disk, this run is where that shows up.
 *
 * Started by `bun run test:storage:s3`, which brings up the container and supplies the
 * `PRIVATE_STORAGE_*` settings.
 */

const endpoint = process.env.PRIVATE_STORAGE_ENDPOINT
const maybeDescribe = endpoint ? describe : describe.skip

const config: S3StorageConfig = {
  driver: 's3',
  region: process.env.PRIVATE_STORAGE_REGION ?? 'us-east-1',
  bucket: process.env.PRIVATE_STORAGE_BUCKET ?? 'local-private-storage',
  endpoint: endpoint ?? 'http://127.0.0.1:24331',
  accessKeyId: process.env.PRIVATE_STORAGE_ACCESS_KEY_ID ?? '',
  secretAccessKey: process.env.PRIVATE_STORAGE_SECRET_ACCESS_KEY ?? '',
  forcePathStyle: true,
  uploadMaxBytes: 5 * 1024 * 1024,
  uploadUrlTtlSeconds: 900,
  downloadUrlTtlSeconds: 300,
}

const browserOrigin = 'http://localhost:5173'

// Registered only when there is something to talk to. `test-live.mjs` refuses to run without an
// endpoint, so this guard is for a stray `bun test`, not for the supported path.
if (endpoint) {
  describeStorageContract('S3PrivateStorage against a live S3 server', async () => ({
    storage: new S3PrivateStorage(config),
    browserOrigin,
    request: (url: string, init?: RequestInit) => fetch(url, init),
  }))
}

maybeDescribe('S3PrivateStorage live specifics', () => {
  const storage = new S3PrivateStorage(config)

  // Path-style addressing is signature maths with no server involved, so it is asserted exactly -
  // host and full pathname - in `s3-storage.test.ts`. A live run should not spend a container on
  // re-checking it more weakly.

  test('serves a ranged GET with a partial-content status', async () => {
    const key = createStorageObjectKey({ namespace: 'live' })
    const upload = await storage.createUploadUrl({
      key,
      contentType: 'image/png',
      byteSize: pngFixture.byteLength,
    })
    await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: pngFixture })

    const download = await storage.createDownloadUrl({ key })
    const response = await fetch(download.url, { headers: { Range: 'bytes=0-7' } })

    expect(response.status).toBe(206)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pngFixture.subarray(0, 8))

    await storage.deleteObject(key)
  })
})
