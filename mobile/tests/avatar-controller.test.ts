import { describe, expect, test } from 'bun:test';

import { uploadPickedAvatar } from '../src/features/avatar/avatar-controller';
import type { PickedAvatar } from '../src/features/avatar/picker';
import type { UploadSender } from '../src/platform/uploads';

const picked: PickedAvatar = {
  byteSize: 4096,
  contentType: 'image/jpeg',
  uri: 'file:///tmp/avatar.jpg',
};

const avatar = {
  byteSize: 4096,
  contentType: 'image/jpeg' as const,
  downloadUrl: 'https://storage.example.com/a?sig=1',
  downloadUrlExpiresAt: '2026-08-12T00:05:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
};

function createHarness(options: { sendStatus?: number; ticketContentLength?: number } = {}) {
  const steps: string[] = [];
  const finalized: string[] = [];

  const api = {
    createUpload: async (input: { byteSize: number; contentType: string }) => {
      steps.push('createUpload');
      return {
        upload: {
          contentLength: options.ticketContentLength ?? input.byteSize,
          expiresAt: '2026-08-12T00:15:00.000Z',
          headers: { 'Content-Type': input.contentType, 'If-None-Match': '*' },
          method: 'PUT' as const,
          uploadId: 'upload-1',
          url: 'https://storage.example.com/a?sig=2',
        },
      };
    },
    finalizeUpload: async (uploadId: string) => {
      steps.push('finalizeUpload');
      finalized.push(uploadId);
      return { avatar };
    },
  };

  const send: UploadSender = async () => {
    steps.push('send');
    return { status: options.sendStatus ?? 200 };
  };

  return { api, finalized, send, steps };
}

describe('uploadPickedAvatar', () => {
  test('runs ticket, then bytes, then finalize, in that order', async () => {
    const { api, finalized, send, steps } = createHarness();

    const response = await uploadPickedAvatar({ api, picked, send });

    expect(steps).toEqual(['createUpload', 'send', 'finalizeUpload']);
    // Finalizing a different upload than the one just sent would publish nothing, or worse,
    // someone else's pending row.
    expect(finalized).toEqual(['upload-1']);
    expect(response?.avatar).toEqual(avatar);
  });

  test('still finalizes when storage answers 412', async () => {
    // 412 means the object is already stored, so the upload is complete and must be published.
    // This proves the success-treatment survives composition, not just the protocol unit.
    const { api, send, steps } = createHarness({ sendStatus: 412 });

    const response = await uploadPickedAvatar({ api, picked, send });

    expect(steps).toEqual(['createUpload', 'send', 'finalizeUpload']);
    expect(response?.avatar).toEqual(avatar);
  });

  /** Reports the session as gone from the nth check onwards, so each step can be probed. */
  function cancelledFromCheck(nth: number) {
    let checks = 0;
    return () => {
      checks += 1;
      return checks >= nth;
    };
  }

  test('mints nothing when the session is already gone', async () => {
    // The picker can sit open for minutes. A ticket requested afterwards is written against the
    // new session's token and belongs to an account that never asked for it.
    const { api, send, steps } = createHarness();

    const response = await uploadPickedAvatar({
      api,
      isCancelled: cancelledFromCheck(1),
      picked,
      send,
    });

    expect(response).toBeNull();
    expect(steps).toEqual([]);
  });

  test('stops before sending when the session changes after the ticket', async () => {
    const { api, send, steps } = createHarness();

    const response = await uploadPickedAvatar({
      api,
      isCancelled: cancelledFromCheck(2),
      picked,
      send,
    });

    expect(response).toBeNull();
    expect(steps).toEqual(['createUpload']);
  });

  test('stops before finalizing when the session changes during the transfer', async () => {
    const { api, send, steps } = createHarness();

    const response = await uploadPickedAvatar({
      api,
      isCancelled: cancelledFromCheck(3),
      picked,
      send,
    });

    expect(response).toBeNull();
    expect(steps).toEqual(['createUpload', 'send']);
  });

  test('refuses to send bytes the ticket was not signed for', async () => {
    // The size is inside the signature. If the ticket ever comes back describing a different
    // number than the bytes on disk, sending anyway earns an opaque 403 from storage - so the
    // picked size is carried through to the transfer rather than the ticket being trusted.
    const { api, send, steps } = createHarness({ ticketContentLength: 9999 });

    await expect(uploadPickedAvatar({ api, picked, send })).rejects.toMatchObject({
      reason: 'size-changed',
    });

    expect(steps).toEqual(['createUpload']);
  });

  test('lets a finalize failure through untouched, so the caller owns the copy', async () => {
    const { send } = createHarness();
    const failure = new Error('rejected');
    const api = {
      createUpload: async () => ({
        upload: {
          contentLength: picked.byteSize,
          expiresAt: '2026-08-12T00:15:00.000Z',
          headers: { 'Content-Type': 'image/jpeg', 'If-None-Match': '*' },
          method: 'PUT' as const,
          uploadId: 'upload-1',
          url: 'https://storage.example.com/a?sig=2',
        },
      }),
      finalizeUpload: async () => {
        throw failure;
      },
    };

    await expect(uploadPickedAvatar({ api, picked, send })).rejects.toBe(failure);
  });
});
