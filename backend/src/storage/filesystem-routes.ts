import { Hono } from 'hono'

import type { FilesystemStorageConfig } from './config'
import { StorageError } from './errors'
import { readStorageUrlClaims, verifyStorageUrlSignature } from './filesystem-signing'
import { FilesystemPrivateStorage } from './filesystem-storage'

/**
 * Serves the URLs the filesystem driver signs.
 *
 * The checks below are ordered to mirror what an S3 endpoint does, and the status codes are
 * chosen to match it, because one contract suite runs against both drivers. In particular a
 * request with no signature, a tampered signature, or an expired one is **403**, never 401:
 * these URLs carry their own authority and are not tied to a session.
 */
export function createFilesystemStorageRoutes(config: FilesystemStorageConfig) {
  const storage = new FilesystemPrivateStorage(config)
  const routes = new Hono()

  routes.on(['GET', 'HEAD', 'PUT'], '/objects/*', async (c) => {
    const url = new URL(c.req.url)
    const key = decodeObjectKey(url.pathname)
    if (!key) return c.json(storageErrorBody('Storage object key is missing'), 403)

    const requested = readStorageUrlClaims(key, url.searchParams)
    if (!requested) return c.json(storageErrorBody('Storage URL is not signed'), 403)

    const { claims, signature } = requested
    if (!verifyStorageUrlSignature(config.signingKey, claims, signature)) {
      return c.json(storageErrorBody('Storage URL signature is invalid'), 403)
    }

    if (claims.expiresAt * 1000 <= Date.now()) {
      return c.json(storageErrorBody('Storage URL has expired'), 403)
    }

    const method = c.req.method
    const expectedOperation = method === 'PUT' ? 'put' : 'get'
    if (claims.operation !== expectedOperation) {
      return c.json(storageErrorBody('Storage URL does not grant this operation'), 403)
    }

    try {
      if (method === 'PUT') return await handlePut(c, storage, claims)
      return await handleRead(c, storage, key, method === 'HEAD')
    } catch (error) {
      if (error instanceof StorageError) {
        return c.json(storageErrorBody(error.message), 403)
      }
      throw error
    }
  })

  return routes
}

type SignedClaims = NonNullable<ReturnType<typeof readStorageUrlClaims>>['claims']

async function handlePut(
  c: Parameters<Parameters<Hono['on']>[2]>[0],
  storage: FilesystemPrivateStorage,
  claims: SignedClaims,
) {
  // Every one of these headers is inside the signature, so a mismatch means the caller changed
  // the request after it was authorised. S3 answers that with a signature failure; so do we.
  if (claims.contentType && c.req.header('content-type') !== claims.contentType) {
    return c.json(storageErrorBody('Upload content type does not match the signed value'), 403)
  }

  // Checked only when the client sent it: a chunked upload legitimately has no Content-Length,
  // and the byte count below is the authoritative check either way. A header that is present
  // but wrong, though, means the request was altered after it was signed.
  const declaredLength = c.req.header('content-length')
  if (
    claims.contentLength !== undefined &&
    declaredLength !== undefined &&
    Number(declaredLength) !== claims.contentLength
  ) {
    return c.json(storageErrorBody('Upload length does not match the signed value'), 403)
  }

  if (claims.ifNoneMatch && c.req.header('if-none-match') !== claims.ifNoneMatch) {
    return c.json(storageErrorBody('Upload precondition does not match the signed value'), 403)
  }

  // Read with a hard cap rather than buffering whatever arrives. A chunked request has no
  // Content-Length to check above, so without this a holder of a valid signed URL could stream
  // an unbounded body into memory. The cap is this upload's own signed length, which
  // `assertByteSize` already held to PRIVATE_STORAGE_UPLOAD_MAX_BYTES when the URL was issued.
  const body = await readBodyWithin(c.req.raw.body, claims.contentLength ?? 0)
  if (body === 'too_large') {
    return c.json(storageErrorBody('Upload body is larger than the signed value'), 403)
  }
  if (claims.contentLength !== undefined && body.byteLength !== claims.contentLength) {
    return c.json(storageErrorBody('Upload body length does not match the signed value'), 403)
  }

  const result = await storage.putObjectOnce(
    claims.key,
    body,
    claims.contentType ?? 'application/octet-stream',
  )

  if (!result.stored) {
    // `If-None-Match: *` on an existing key. Identical to S3, and the signal a client uses to
    // learn that an interrupted upload actually landed.
    return c.json(storageErrorBody('Object already exists'), 412)
  }

  c.header('ETag', result.etag)
  return c.body(null, 200)
}

async function handleRead(
  c: Parameters<Parameters<Hono['on']>[2]>[0],
  storage: FilesystemPrivateStorage,
  key: string,
  headOnly: boolean,
) {
  const metadata = await storage.readMetadata(key)
  if (!metadata) return c.json(storageErrorBody('Object not found'), 404)

  c.header('Content-Type', metadata.contentType)
  c.header('ETag', metadata.etag)
  c.header('Accept-Ranges', 'bytes')

  if (headOnly) {
    c.header('Content-Length', String(metadata.contentLength))
    return c.body(null, 200)
  }

  const range = parseByteRange(c.req.header('range'), metadata.contentLength)
  if (range === 'unsatisfiable') {
    c.header('Content-Range', `bytes */${metadata.contentLength}`)
    return c.body(null, 416)
  }

  if (range) {
    const bytes = await storage.readRange(key, range)
    if (!bytes) return c.json(storageErrorBody('Object not found'), 404)

    c.header('Content-Range', `bytes ${range.start}-${range.end}/${metadata.contentLength}`)
    c.header('Content-Length', String(bytes.byteLength))
    return c.body(bytes as unknown as ArrayBuffer, 206)
  }

  const bytes = await storage.readRange(key, { start: 0, end: metadata.contentLength - 1 })
  if (!bytes) return c.json(storageErrorBody('Object not found'), 404)

  c.header('Content-Length', String(bytes.byteLength))
  return c.body(bytes as unknown as ArrayBuffer, 200)
}

/**
 * Buffers a request body, refusing to hold more than `limit` bytes.
 *
 * Returns `'too_large'` instead of throwing so the caller answers with a status rather than a
 * 500, and stops reading as soon as the limit is passed rather than after the fact.
 */
async function readBodyWithin(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Promise<Uint8Array | 'too_large'> {
  if (!body) return new Uint8Array()

  const chunks: Uint8Array[] = []
  const reader = body.getReader()
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      total += value.byteLength
      if (total > maximumBytes) {
        // Tell the peer to stop sending rather than just walking away from the stream.
        await reader.cancel()
        return 'too_large'
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  return merged
}

function decodeObjectKey(pathname: string) {
  const marker = '/objects/'
  const index = pathname.indexOf(marker)
  if (index === -1) return null

  const raw = pathname.slice(index + marker.length)
  if (!raw) return null

  try {
    return raw.split('/').map(decodeURIComponent).join('/')
  } catch {
    return null
  }
}

/**
 * Understands the single-range form the storage contract relies on. A syntactically odd or
 * multi-range header is treated as no range at all, which is what HTTP allows a server to do.
 */
function parseByteRange(header: string | undefined, contentLength: number) {
  if (!header) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null

  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null

  if (rawStart === '') {
    const suffixLength = Number(rawEnd)
    if (suffixLength <= 0) return 'unsatisfiable' as const
    return { start: Math.max(0, contentLength - suffixLength), end: contentLength - 1 }
  }

  const start = Number(rawStart)
  if (start >= contentLength) return 'unsatisfiable' as const

  const end = rawEnd === '' ? contentLength - 1 : Math.min(Number(rawEnd), contentLength - 1)
  if (end < start) return 'unsatisfiable' as const

  return { start, end }
}

function storageErrorBody(message: string) {
  return { error: { code: 'STORAGE_ERROR', message } }
}
