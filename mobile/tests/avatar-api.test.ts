import { afterEach, describe, expect, test } from 'bun:test';
import { AVATAR_MAX_BYTES } from '@web-app-demo/contracts';

import { AvatarApi } from '../src/features/avatar/api';
import { ApiRequestError, ApiTransport } from '../src/platform/api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const avatar = {
  byteSize: 4096,
  contentType: 'image/jpeg',
  downloadUrl: 'https://storage.example.com/avatars/2026/08/abc?sig=1',
  downloadUrlExpiresAt: '2026-08-12T00:05:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
};

const ticket = {
  contentLength: 4096,
  expiresAt: '2026-08-12T00:15:00.000Z',
  headers: { 'Content-Type': 'image/jpeg', 'If-None-Match': '*' },
  method: 'PUT',
  uploadId: '019c0000-0000-7000-8000-000000000001',
  url: 'https://storage.example.com/avatars/2026/08/abc?sig=2',
};

type Call = { authorization: string | null; body: unknown; method: string; path: string };

function createApi(respond: (call: Call) => Response) {
  const calls: Call[] = [];

  globalThis.fetch = async (input, init) => {
    const call: Call = {
      authorization: new Headers(init?.headers).get('Authorization'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      method: init?.method ?? 'GET',
      path: new URL(String(input)).pathname,
    };
    calls.push(call);
    return respond(call);
  };

  const transport = new ApiTransport({
    expire: () => undefined,
    getAccessToken: () => 'access-token',
    getGeneration: () => 1,
    isGenerationCurrent: (candidate) => candidate === 1,
    refresh: async () => ({ accessToken: 'access-token' }),
    setAccessToken: () => true,
  });

  return { api: new AvatarApi(transport), calls };
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AvatarApi', () => {
  test('asks for a ticket with the declared type and size, authenticated', async () => {
    const { api, calls } = createApi(() => json({ upload: ticket }, 201));

    const response = await api.createUpload({ byteSize: 4096, contentType: 'image/jpeg' });

    expect(calls[0]).toMatchObject({
      authorization: 'Bearer access-token',
      body: { byteSize: 4096, contentType: 'image/jpeg' },
      method: 'POST',
      path: '/api/uploads/avatar',
    });
    expect(response.upload.uploadId).toBe(ticket.uploadId);
  });

  test('refuses an oversized request locally, before it costs a round trip', async () => {
    const { api, calls } = createApi(() => json({ upload: ticket }, 201));

    // The contract is parsed in the argument position, so this throws synchronously rather than
    // rejecting - the request is never built at all.
    expect(() =>
      api.createUpload({ byteSize: AVATAR_MAX_BYTES + 1, contentType: 'image/jpeg' }),
    ).toThrow();
    expect(calls).toHaveLength(0);
  });

  test('percent-encodes the upload id so it cannot reshape the path', async () => {
    const { api, calls } = createApi(() => json({ avatar }, 200));

    await api.finalizeUpload('../../escape');

    expect(calls[0].path).toBe('/api/uploads/avatar/..%2F..%2Fescape/finalize');
  });

  test('reads the current avatar, and accepts having none', async () => {
    const { api, calls } = createApi(() => json({ avatar: null }, 200));

    const response = await api.getAvatar();

    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/uploads/avatar' });
    expect(response.avatar).toBeNull();
  });

  test('removes the avatar with DELETE', async () => {
    // The transport's method union had to be widened for this. Without the widening the request
    // silently falls back to GET, which reads the avatar instead of deleting it.
    const { api, calls } = createApi(() => json({ avatar: null }, 200));

    const response = await api.removeAvatar();

    expect(calls[0]).toMatchObject({ method: 'DELETE', path: '/api/uploads/avatar' });
    expect(response.avatar).toBeNull();
  });

  test('surfaces a recoverable upload failure with its own code', async () => {
    const { api } = createApi(() =>
      json({ error: { code: 'UPLOAD_NOT_COMPLETED', message: 'Upload has not finished' } }, 409),
    );

    const failure = await api.finalizeUpload(ticket.uploadId).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiRequestError);
    expect((failure as ApiRequestError).code).toBe('UPLOAD_NOT_COMPLETED');
  });
});
