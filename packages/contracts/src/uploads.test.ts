import { describe, expect, test } from 'bun:test'

import {
  AVATAR_MAX_BYTES,
  AVATAR_MIN_BYTES,
  avatarResponseSchema,
  createAvatarUploadRequestSchema,
  createAvatarUploadResponseSchema,
  uploadTicketSchema,
} from './index'

const ticket = {
  uploadId: '019c0000-0000-7000-8000-000000000001',
  method: 'PUT',
  url: 'https://storage.example.com/bucket/avatars/2026/08/019c0000?X-Amz-Signature=abc',
  headers: { 'Content-Type': 'image/png', 'If-None-Match': '*' },
  contentLength: 1024,
  expiresAt: '2026-08-09T00:15:00.000Z',
} as const

const avatar = {
  contentType: 'image/png',
  byteSize: 1024,
  updatedAt: '2026-08-09T00:00:00.000Z',
  downloadUrl: 'https://storage.example.com/bucket/avatars/2026/08/019c0000?X-Amz-Signature=def',
  downloadUrlExpiresAt: '2026-08-09T00:05:00.000Z',
} as const

describe('avatar upload contracts', () => {
  test('accepts the four image types the finalize check can actually verify', () => {
    for (const contentType of ['image/jpeg', 'image/png', 'image/heic', 'image/heif'] as const) {
      expect(
        createAvatarUploadRequestSchema.parse({ contentType, byteSize: 2048 }).contentType,
      ).toBe(contentType)
    }

    expect(() =>
      createAvatarUploadRequestSchema.parse({ contentType: 'image/gif', byteSize: 2048 }),
    ).toThrow()
    expect(() =>
      createAvatarUploadRequestSchema.parse({ contentType: 'image/svg+xml', byteSize: 2048 }),
    ).toThrow()
  })

  test('bounds the declared size on both ends and rejects unknown fields', () => {
    expect(
      createAvatarUploadRequestSchema.parse({
        contentType: 'image/png',
        byteSize: AVATAR_MIN_BYTES,
      }).byteSize,
    ).toBe(AVATAR_MIN_BYTES)
    expect(
      createAvatarUploadRequestSchema.parse({
        contentType: 'image/png',
        byteSize: AVATAR_MAX_BYTES,
      }).byteSize,
    ).toBe(AVATAR_MAX_BYTES)

    for (const byteSize of [0, -1, 12.5, AVATAR_MIN_BYTES - 1, AVATAR_MAX_BYTES + 1]) {
      expect(() =>
        createAvatarUploadRequestSchema.parse({ contentType: 'image/png', byteSize }),
      ).toThrow()
    }

    expect(() =>
      createAvatarUploadRequestSchema.parse({
        contentType: 'image/png',
        byteSize: 2048,
        key: 'avatars/mine',
      }),
    ).toThrow()
  })

  test('carries the headers the browser must replay on the direct PUT', () => {
    const parsed = uploadTicketSchema.parse(ticket)
    expect(parsed.headers['Content-Type']).toBe('image/png')
    expect(parsed.headers['If-None-Match']).toBe('*')
    expect(parsed.method).toBe('PUT')
    expect(createAvatarUploadResponseSchema.parse({ upload: ticket }).upload.uploadId).toBe(
      ticket.uploadId,
    )
  })

  test('rejects non-http schemes on every URL that reaches a client', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:image/png;base64,iVBORw0KGgo=',
      'ftp://storage.example.com/bucket/key',
      'not a url',
    ]) {
      expect(() => uploadTicketSchema.parse({ ...ticket, url })).toThrow()
      expect(() =>
        avatarResponseSchema.parse({ avatar: { ...avatar, downloadUrl: url } }),
      ).toThrow()
    }

    // A loopback http URL is the filesystem driver's normal shape and must stay valid.
    expect(
      uploadTicketSchema.parse({ ...ticket, url: 'http://127.0.0.1:3000/storage/objects/a?x-sig=1' })
        .url,
    ).toBe('http://127.0.0.1:3000/storage/objects/a?x-sig=1')
  })

  test('represents "no avatar yet" explicitly rather than by omission', () => {
    expect(avatarResponseSchema.parse({ avatar: null }).avatar).toBeNull()
    expect(avatarResponseSchema.parse({ avatar }).avatar).toEqual(avatar)
    expect(() => avatarResponseSchema.parse({})).toThrow()
  })

})
