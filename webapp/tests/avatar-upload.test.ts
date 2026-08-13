import { afterEach, describe, expect, mock, test } from 'bun:test'
import { AVATAR_MAX_BYTES, type UploadTicket } from '@web-app-demo/contracts'

import {
  AvatarUploadError,
  describeAvatarFile,
  resolveAvatarContentType,
  uploadAvatarObject,
} from '@/features/avatar'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function file(name: string, type: string, size: number) {
  return new File([new Uint8Array(size)], name, { type })
}

function ticket(contentLength: number): UploadTicket {
  return {
    uploadId: '019c0000-0000-7000-8000-000000000001',
    method: 'PUT',
    url: 'http://127.0.0.1:24331/local-private-storage/avatars/2026/08/abc?x-sig=1',
    headers: { 'Content-Type': 'image/png', 'If-None-Match': '*' },
    contentLength,
    expiresAt: '2026-08-09T00:15:00.000Z',
  }
}

describe('resolveAvatarContentType', () => {
  test('uses the type the browser reported when it is one we accept', () => {
    expect(resolveAvatarContentType(file('a.png', 'image/png', 10))).toBe('image/png')
    expect(resolveAvatarContentType(file('a.jpg', 'IMAGE/JPEG', 10))).toBe('image/jpeg')
  })

  test('falls back to the extension when the browser reports nothing useful', () => {
    // Safari and some Android pickers send an empty type, or `image/heif` for a HEIC photo.
    expect(resolveAvatarContentType(file('photo.HEIC', '', 10))).toBe('image/heic')
    expect(resolveAvatarContentType(file('photo.heif', '', 10))).toBe('image/heif')
    expect(resolveAvatarContentType(file('photo.jpeg', 'application/octet-stream', 10))).toBe(
      'image/jpeg',
    )
  })

  test('refuses anything it cannot name confidently', () => {
    expect(resolveAvatarContentType(file('a.svg', 'image/svg+xml', 10))).toBeNull()
    expect(resolveAvatarContentType(file('a.gif', 'image/gif', 10))).toBeNull()
    expect(resolveAvatarContentType(file('resume', '', 10))).toBeNull()
  })
})

describe('describeAvatarFile', () => {
  test('accepts a supported image inside the size bounds', () => {
    expect(describeAvatarFile(file('a.png', 'image/png', 2048))).toEqual({
      ok: true,
      contentType: 'image/png',
      byteSize: 2048,
    })
  })

  test('rejects unsupported types and out-of-range sizes before any request is made', () => {
    expect(describeAvatarFile(file('a.svg', 'image/svg+xml', 2048)).ok).toBe(false)
    expect(describeAvatarFile(file('a.png', 'image/png', 1)).ok).toBe(false)
    expect(describeAvatarFile(file('a.png', 'image/png', AVATAR_MAX_BYTES + 1)).ok).toBe(false)
  })
})

describe('uploadAvatarObject', () => {
  test('sends the ticket headers verbatim, without credentials', async () => {
    const calls: Array<[string, RequestInit]> = []
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const picked = file('a.png', 'image/png', 2048)
    await uploadAvatarObject(ticket(2048), picked)

    expect(calls).toHaveLength(1)
    expect(calls[0][1].method).toBe('PUT')
    expect(calls[0][1].headers).toEqual({ 'Content-Type': 'image/png', 'If-None-Match': '*' })
    expect(calls[0][1].credentials).toBe('omit')
    expect(calls[0][1].body).toBe(picked)
  })

  test('treats 412 as success, because the object is already stored', async () => {
    // The key is signed write-once. A retry after a dropped connection whose first attempt
    // actually landed gets 412, and the upload is complete - reporting a failure would strand
    // the user on an upload that worked.
    globalThis.fetch = mock(async () => new Response(null, { status: 412 })) as unknown as typeof fetch

    await expect(uploadAvatarObject(ticket(2048), file('a.png', 'image/png', 2048))).resolves.toBeUndefined()
  })

  test('reports a refused transfer', async () => {
    globalThis.fetch = mock(async () => new Response(null, { status: 403 })) as unknown as typeof fetch

    await expect(uploadAvatarObject(ticket(2048), file('a.png', 'image/png', 2048))).rejects.toMatchObject(
      { reason: 'transfer-failed' },
    )
  })

  test('reports a network failure without letting it surface as a raw fetch error', async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch

    await expect(uploadAvatarObject(ticket(2048), file('a.png', 'image/png', 2048))).rejects.toBeInstanceOf(
      AvatarUploadError,
    )
  })

  test('refuses to send a file whose size no longer matches the signed ticket', async () => {
    let called = false
    globalThis.fetch = mock(async () => {
      called = true
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    await expect(uploadAvatarObject(ticket(2048), file('a.png', 'image/png', 4096))).rejects.toMatchObject(
      { reason: 'size-changed' },
    )
    expect(called).toBe(false)
  })
})
