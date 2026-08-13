import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * `native-file-access` imports `expo-file-system`, whose real module pulls in React Native's
 * Flow-typed entry point and cannot be parsed here, so it is substituted at its own boundary.
 * The fake records what the module was asked to do; every assertion below is about the request
 * this app builds, never about what the native module does with it.
 */
type UploadCall = { options: Record<string, unknown>; url: string };
const uploadCalls: UploadCall[] = [];
const fileSizes = new Map<string, number | null | undefined>();
let uploadStatus = 200;

mock.module('expo-file-system', () => ({
  File: class {
    constructor(readonly uri: string) {}

    get size() {
      return fileSizes.get(this.uri);
    }

    async upload(url: string, options: Record<string, unknown>) {
      uploadCalls.push({ options, url });
      return { status: uploadStatus };
    }
  },
  UploadType: { BINARY_CONTENT: 'binary' },
}));

const { UploadTransferError } = await import('../src/platform/uploads/transfer');
const { webFileAccess } = await import('../src/platform/uploads/web-file-access');
const { nativeFileAccess } = await import('../src/platform/uploads/native-file-access');
const { uploadFileAccessForPlatform } = await import('../src/composition/upload-file-access');

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  uploadCalls.length = 0;
  uploadStatus = 200;
});

const ticketUrl = 'https://storage.example/objects/avatars/2026/08/abc?x-sig=1';
const objectUrl = 'blob:http://localhost:8081/9f1c';

type Recorded = { init: RequestInit | undefined; url: string };

function stubFetch(bytes: Uint8Array, status = 200) {
  const calls: Recorded[] = [];

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ init, url });

    // The first call reads the picked object URL; the second is the upload itself.
    if (url === objectUrl) return { blob: async () => new Blob([bytes]) };
    return { status };
  }) as unknown as typeof fetch;

  return calls;
}

describe('webFileAccess', () => {
  test('measures the blob behind the object URL, not the URL', async () => {
    // The ticket is signed for one exact byte count, so this number has to come from the bytes
    // the browser actually holds.
    stubFetch(new Uint8Array(2048));

    expect(await webFileAccess.measureBytes(objectUrl)).toBe(2048);
  });

  test('sends the ticket headers verbatim and without credentials', async () => {
    // The headers are inside the signature, and the ticket carries its own authority: attaching
    // cookies or an Authorization header turns a valid upload into an opaque 403 or a failed
    // preflight. This is the mobile twin of webapp/tests/avatar-upload.test.ts.
    const calls = stubFetch(new Uint8Array(70));

    await webFileAccess.send({
      headers: { 'Content-Type': 'image/jpeg', 'If-None-Match': '*' },
      method: 'PUT',
      uri: objectUrl,
      url: ticketUrl,
    });

    const upload = calls.find((call) => call.url === ticketUrl);
    expect(upload?.init?.method).toBe('PUT');
    expect(upload?.init?.headers).toEqual({
      'Content-Type': 'image/jpeg',
      'If-None-Match': '*',
    });
    expect(upload?.init?.credentials).toBe('omit');
    expect(upload?.init?.mode).toBe('cors');
    expect(upload?.init?.body).toBeInstanceOf(Blob);
  });

  test('returns the status instead of throwing, so 412 stays readable as success', async () => {
    // The protocol decides what a status means. A sender that threw on non-2xx would collapse
    // "already stored" into "failed" before the rule that distinguishes them can run.
    for (const status of [200, 412, 403, 500]) {
      stubFetch(new Uint8Array(70), status);

      expect(
        await webFileAccess.send({
          headers: {},
          method: 'PUT',
          uri: objectUrl,
          url: ticketUrl,
        }),
      ).toEqual({ status });
    }
  });
});

describe('uploadFileAccessForPlatform', () => {
  test('gives the browser reader to web and the file reader to everything else', () => {
    // Inverting this is what produces a ticket signed for a size the transfer can never send.
    expect(uploadFileAccessForPlatform('web')).toBe(webFileAccess);
    expect(uploadFileAccessForPlatform('ios')).toBe(nativeFileAccess);
    expect(uploadFileAccessForPlatform('android')).toBe(nativeFileAccess);
  });
});

describe('nativeFileAccess', () => {
  test('sends the ticket headers verbatim, streaming the file as the raw body', () => {
    // The headers are inside the signature and the body must be the bytes themselves. A
    // re-cased header or a switch to multipart turns a valid upload into an unexplained 403.
    nativeFileAccess.send({
      headers: { 'Content-Type': 'image/jpeg', 'If-None-Match': '*' },
      method: 'PUT',
      uri: 'file:///tmp/avatar.jpg',
      url: ticketUrl,
    });

    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0].url).toBe(ticketUrl);
    expect(uploadCalls[0].options.headers).toEqual({
      'Content-Type': 'image/jpeg',
      'If-None-Match': '*',
    });
    expect(uploadCalls[0].options.httpMethod).toBe('PUT');
    expect(uploadCalls[0].options.uploadType).toBe('binary');
  });

  test('reports the status rather than throwing, so 412 stays readable as success', async () => {
    for (const status of [200, 412, 500]) {
      uploadStatus = status;

      expect(
        await nativeFileAccess.send({
          headers: {},
          method: 'PUT',
          uri: 'file:///tmp/avatar.jpg',
          url: ticketUrl,
        }),
      ).toEqual({ status });
    }
  });

  test('refuses an unreadable file instead of signing a ticket for zero bytes', async () => {
    // The native API reports 0 for a file that does not exist or cannot be read. Passing that
    // on would mint a ticket the transfer can never satisfy, and storage answers with a 403
    // that says nothing about the cause.
    // Every shape the platforms actually produce. The declared type is `number` and the docs
    // say 0, but both natives return null when the call throws or the file is gone, and the web
    // stub of this class has no `size` at all - so narrowing this guard to `size === 0` on the
    // strength of the type would let the real failure through.
    for (const size of [0, null, undefined]) {
      fileSizes.set('file:///tmp/missing.jpg', size as unknown as number);

      const nullish = await nativeFileAccess
        .measureBytes('file:///tmp/missing.jpg')
        .catch((error: unknown) => error);

      expect((nullish as InstanceType<typeof UploadTransferError>).reason).toBe('unreadable-file');
    }

    fileSizes.set('file:///tmp/missing.jpg', 0);
    const failure = await nativeFileAccess
      .measureBytes('file:///tmp/missing.jpg')
      .catch((error: unknown) => error);

    // The type is the contract. Only `UploadTransferError` survives the message mapper, so a
    // plain Error here would reach the person as "try again" - advice that cannot work.
    expect(failure).toBeInstanceOf(UploadTransferError);
    expect((failure as InstanceType<typeof UploadTransferError>).reason).toBe('unreadable-file');
    expect((failure as Error).message).toMatch(/could not be read/);

    fileSizes.set('file:///tmp/avatar.jpg', 2048);
    expect(await nativeFileAccess.measureBytes('file:///tmp/avatar.jpg')).toBe(2048);
  });
});
