import { describe, expect, test } from 'bun:test';
import type { UploadTicket } from '@web-app-demo/contracts';

import {
  sendUploadTicket,
  UploadTransferError,
  type UploadRequest,
  type UploadSender,
} from '../src/platform/uploads/transfer';

const ticket: UploadTicket = {
  contentLength: 70,
  expiresAt: '2026-08-12T00:15:00.000Z',
  headers: { 'Content-Type': 'image/jpeg', 'If-None-Match': '*' },
  method: 'PUT',
  uploadId: '019c0000-0000-7000-8000-000000000001',
  url: 'http://127.0.0.1:3000/storage/objects/avatars/2026/08/abc?x-sig=1',
};

const source = { byteSize: 70, uri: 'file:///tmp/avatar.jpg' };

function recordingSender(status: number) {
  const requests: UploadRequest[] = [];
  const send: UploadSender = async (request) => {
    requests.push(request);
    return { status };
  };
  return { requests, send };
}

describe('sendUploadTicket', () => {
  test('sends the ticket headers verbatim', async () => {
    const { requests, send } = recordingSender(200);

    await sendUploadTicket(ticket, source, { send });

    // The exact record, not a superset. This is the assertion that catches a future change
    // "helpfully" attaching Authorization to a presigned request, or re-casing a signed header.
    expect(requests).toHaveLength(1);
    expect(requests[0].headers).toEqual({
      'Content-Type': 'image/jpeg',
      'If-None-Match': '*',
    });
    expect(requests[0].method).toBe('PUT');
    expect(requests[0].url).toBe(ticket.url);
    expect(requests[0].uri).toBe(source.uri);
  });

  test('accepts every success status storage can answer with', async () => {
    for (const status of [200, 201, 204]) {
      const { send } = recordingSender(status);
      await expect(sendUploadTicket(ticket, source, { send })).resolves.toBeUndefined();
    }
  });

  test('treats 412 as success, because the object is already stored', async () => {
    // The key is signed write-once. A retry whose first attempt actually landed gets 412, and
    // the upload is complete - reporting a failure would strand the caller on work that worked.
    const { send } = recordingSender(412);

    await expect(sendUploadTicket(ticket, source, { send })).resolves.toBeUndefined();
  });

  test('rejects the statuses that mean storage refused the bytes', async () => {
    for (const status of [400, 403, 404, 500]) {
      const { send } = recordingSender(status);

      await expect(sendUploadTicket(ticket, source, { send })).rejects.toMatchObject({
        reason: 'transfer-failed',
      });
    }
  });

  test('reports a thrown sender as a transfer failure, not a raw error', async () => {
    const send: UploadSender = async () => {
      throw new TypeError('Network request failed');
    };

    const failure = await sendUploadTicket(ticket, source, { send }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UploadTransferError);
    expect((failure as UploadTransferError).reason).toBe('transfer-failed');
  });

  test('refuses a size that no longer matches the ticket, without sending anything', async () => {
    // The size is inside the signature, so sending would only earn an opaque 403 from storage.
    const { requests, send } = recordingSender(200);

    await expect(
      sendUploadTicket(ticket, { ...source, byteSize: 71 }, { send }),
    ).rejects.toMatchObject({ reason: 'size-changed' });

    expect(requests).toHaveLength(0);
  });
});
