import { describe, expect, test } from 'bun:test'

import { createStorageObjectKey } from './object-keys'
import type { PrivateStorage } from './port'

/**
 * The one behavioural contract both drivers must satisfy.
 *
 * This file is the reason the filesystem driver is trustworthy. It is executed twice: once
 * against the local disk in the fast unit run, and once against a real SeaweedFS container in
 * the live run. If the two drivers ever diverge — on status codes, on write-once semantics, on
 * what an unsigned request gets — one of the two runs fails, instead of the difference being
 * discovered in production.
 *
 * Deliberately not named `*.test.ts`: it defines tests but does not own any, so it must not be
 * collected by a runner on its own.
 */

/** A real 1x1 PNG, so the bytes exercised here are shaped like an actual upload. */
export const pngFixture = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

export const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export type StorageContractSetup = {
  storage: PrivateStorage
  /** Issues a real HTTP request at a signed URL: in-process for local, over the wire for S3. */
  request(url: string, init?: RequestInit): Promise<Response>
  /** Origin a browser would upload from, used for the CORS preflight check. */
  browserOrigin: string
  cleanup?: () => Promise<void>
}

export function describeStorageContract(
  name: string,
  createSetup: () => Promise<StorageContractSetup>,
) {
  describe(name, () => {
    async function withSetup<T>(run: (setup: StorageContractSetup) => Promise<T>) {
      const setup = await createSetup()
      try {
        return await run(setup)
      } finally {
        await setup.cleanup?.()
      }
    }

    async function uploadFixture(setup: StorageContractSetup, key: string) {
      const upload = await setup.storage.createUploadUrl({
        key,
        contentType: 'image/png',
        byteSize: pngFixture.byteLength,
      })

      return {
        upload,
        response: await setup.request(upload.url, {
          method: 'PUT',
          headers: upload.headers,
          body: pngFixture,
        }),
      }
    }

    test('allows a browser to preflight the direct upload', async () => {
      await withSetup(async (setup) => {
        const upload = await setup.storage.createUploadUrl({
          key: createStorageObjectKey({ namespace: 'contract' }),
          contentType: 'image/png',
          byteSize: pngFixture.byteLength,
        })

        const response = await setup.request(upload.url, {
          method: 'OPTIONS',
          headers: {
            Origin: setup.browserOrigin,
            'Access-Control-Request-Method': 'PUT',
            'Access-Control-Request-Headers': 'content-type,if-none-match',
          },
        })

        expect(response.status).toBeLessThan(400)
        expect(response.headers.get('access-control-allow-origin')).toBe(setup.browserOrigin)
        expect(
          (response.headers.get('access-control-allow-methods') ?? '').toUpperCase(),
        ).toContain('PUT')
      })
    })

    test('refuses to read an object without a signature', async () => {
      await withSetup(async (setup) => {
        const key = createStorageObjectKey({ namespace: 'contract' })
        await uploadFixture(setup, key)

        const download = await setup.storage.createDownloadUrl({ key })
        const unsigned = new URL(download.url)
        unsigned.search = ''

        expect((await setup.request(unsigned.toString())).status).toBe(403)
      })
    })

    test('stores an object through a presigned PUT', async () => {
      await withSetup(async (setup) => {
        const key = createStorageObjectKey({ namespace: 'contract' })
        const { response, upload } = await uploadFixture(setup, key)

        expect(response.status).toBe(200)
        expect(upload.method).toBe('PUT')
        expect(upload.headers['If-None-Match']).toBe('*')
      })
    })

    test('refuses a second write to the same key, so a retry can never overwrite', async () => {
      await withSetup(async (setup) => {
        const key = createStorageObjectKey({ namespace: 'contract' })
        await uploadFixture(setup, key)

        expect((await uploadFixture(setup, key)).response.status).toBe(412)
      })
    })

    test('reports size and type through HEAD', async () => {
      await withSetup(async (setup) => {
        const key = createStorageObjectKey({ namespace: 'contract' })
        await uploadFixture(setup, key)

        const head = await setup.storage.headObject(key)

        expect(head?.contentLength).toBe(pngFixture.byteLength)
        expect(head?.contentType).toBe('image/png')
      })
    })

    test('returns a byte range without downloading the whole object', async () => {
      await withSetup(async (setup) => {
        const key = createStorageObjectKey({ namespace: 'contract' })
        await uploadFixture(setup, key)

        const prefix = await setup.storage.readRange(key, { start: 0, end: 7 })

        expect(prefix).not.toBeNull()
        expect([...(prefix as Uint8Array)]).toEqual(pngSignature)
      })
    })

    test('serves the stored bytes through a presigned GET', async () => {
      await withSetup(async (setup) => {
        const key = createStorageObjectKey({ namespace: 'contract' })
        await uploadFixture(setup, key)

        const download = await setup.storage.createDownloadUrl({ key })
        const response = await setup.request(download.url)

        expect(response.status).toBe(200)
        expect(Buffer.from(await response.arrayBuffer())).toEqual(pngFixture)
      })
    })

    test('deletes an object and stops serving it', async () => {
      await withSetup(async (setup) => {
        const key = createStorageObjectKey({ namespace: 'contract' })
        await uploadFixture(setup, key)
        const download = await setup.storage.createDownloadUrl({ key })

        await setup.storage.deleteObject(key)

        expect(await setup.storage.headObject(key)).toBeNull()
        expect(await setup.storage.readRange(key, { start: 0, end: 7 })).toBeNull()
        expect((await setup.request(download.url)).status).toBe(404)
      })
    })

    test('treats deleting a missing object as success', async () => {
      await withSetup(async (setup) => {
        const key = createStorageObjectKey({ namespace: 'contract' })

        await setup.storage.deleteObject(key)
        await setup.storage.deleteObject(key)

        expect(await setup.storage.headObject(key)).toBeNull()
      })
    })

    test('reports a missing object rather than throwing', async () => {
      await withSetup(async (setup) => {
        const key = createStorageObjectKey({ namespace: 'contract' })

        expect(await setup.storage.headObject(key)).toBeNull()
        expect(await setup.storage.readRange(key, { start: 0, end: 7 })).toBeNull()
      })
    })
  })
}
