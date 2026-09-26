import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createApp } from '../app'
import type { DbClient } from '../db'
import { loadEnv } from '../env'
import { privateStorageConfigFromEnv, type FilesystemStorageConfig } from './config'
import { createFilesystemStorageRoutes } from './filesystem-routes'
import { signStorageUrl, storageUrlParams } from './filesystem-signing'
import { FilesystemPrivateStorage } from './filesystem-storage'
import { createStorageObjectKey } from './object-keys'
import { describeStorageContract, pngFixture } from './storage-contract'

const browserOrigin = 'http://localhost:5173'

async function createFilesystemSetup() {
  const root = await mkdtemp(join(tmpdir(), 'private-storage-'))
  const env = loadEnv({
    DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
    JWT_SECRET: '12345678901234567890123456789012',
    CORS_ORIGINS: browserOrigin,
    PRIVATE_STORAGE_LOCAL_ROOT: root,
  })
  const config = privateStorageConfigFromEnv(env) as FilesystemStorageConfig
  const storage = new FilesystemPrivateStorage(config)
  // The real app, so the contract is proven against the CORS and routing a browser will meet,
  // not against a hand-built harness that could allow more than production does.
  const app = createApp({
    env,
    prisma: {} as DbClient,
    privateStorage: { storage, httpRoutes: createFilesystemStorageRoutes(config) },
  })

  return {
    config,
    storage,
    browserOrigin,
    request: async (url: string, init?: RequestInit) => app.request(url, init),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

describeStorageContract('FilesystemPrivateStorage', createFilesystemSetup)

describe('FilesystemPrivateStorage signed URLs', () => {
  async function withSetup<T>(run: (setup: Awaited<ReturnType<typeof createFilesystemSetup>>) => Promise<T>) {
    const setup = await createFilesystemSetup()
    try {
      return await run(setup)
    } finally {
      await setup.cleanup()
    }
  }

  test('rejects a tampered signature', async () => {
    await withSetup(async ({ request, storage }) => {
      const upload = await storage.createUploadUrl({
        key: createStorageObjectKey({ namespace: 'contract' }),
        contentType: 'image/png',
        byteSize: pngFixture.byteLength,
      })
      const tampered = new URL(upload.url)
      tampered.searchParams.set(storageUrlParams.signature, 'f'.repeat(64))

      const response = await request(tampered.toString(), {
        method: 'PUT',
        headers: upload.headers,
        body: pngFixture,
      })

      expect(response.status).toBe(403)
    })
  })

  test('rejects an expired URL even when the signature is genuine', async () => {
    await withSetup(async ({ config, request }) => {
      const key = createStorageObjectKey({ namespace: 'contract' })
      const claims = {
        operation: 'get' as const,
        key,
        expiresAt: Math.floor(Date.now() / 1000) - 1,
      }
      const url = new URL(`http://127.0.0.1:3000/storage/objects/${key}`)
      url.searchParams.set(storageUrlParams.operation, claims.operation)
      url.searchParams.set(storageUrlParams.expiresAt, String(claims.expiresAt))
      url.searchParams.set(storageUrlParams.signature, signStorageUrl(config.signingKey, claims))

      expect((await request(url.toString())).status).toBe(403)
    })
  })

  test('refuses to reuse a download URL for an upload', async () => {
    await withSetup(async ({ request, storage }) => {
      const download = await storage.createDownloadUrl({
        key: createStorageObjectKey({ namespace: 'contract' }),
      })

      const response = await request(download.url, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png', 'If-None-Match': '*' },
        body: pngFixture,
      })

      expect(response.status).toBe(403)
    })
  })

  test('refuses a chunked body that outgrows the signed size instead of buffering it', async () => {
    await withSetup(async ({ request, storage }) => {
      const upload = await storage.createUploadUrl({
        key: createStorageObjectKey({ namespace: 'contract' }),
        contentType: 'image/png',
        byteSize: pngFixture.byteLength,
      })
      // A streamed body carries no Content-Length, so the header check cannot catch it.
      // The assertion that matters is not the status - buffering everything and then comparing
      // lengths also ends in 403 - but that the read STOPS at the cap. This stream keeps handing
      // out chunks until someone stops pulling, so a reader without a cap drains all of them.
      let pulls = 0
      const oversized = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1
          if (pulls > 500) {
            controller.close()
            return
          }
          controller.enqueue(new Uint8Array(pngFixture))
        },
      })

      const response = await request(upload.url, {
        method: 'PUT',
        headers: upload.headers,
        body: oversized,
        // @ts-expect-error duplex is required for a streamed request body and is not yet in the types
        duplex: 'half',
      })

      expect(response.status).toBe(403)
      expect(await storage.headObject(upload.key)).toBeNull()
      // Two chunks are enough to pass a one-chunk limit; anything near 500 means it kept reading.
      expect(pulls).toBeLessThan(10)
    })
  })

  test('keeps every object inside the storage root', async () => {
    await withSetup(async ({ config, storage }) => {
      expect(storage.objectPath('avatars/2026/08/abc').startsWith(config.root)).toBe(true)
      expect(() => storage.objectPath('../../escape')).toThrow()
    })
  })
})
