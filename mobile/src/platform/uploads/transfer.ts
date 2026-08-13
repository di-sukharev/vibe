import type { UploadTicket } from '@web-app-demo/contracts';

/**
 * The direct-to-storage transfer protocol.
 *
 * The backend hands out a ticket; the client sends the bytes straight at storage using that
 * ticket's headers, and only then asks the backend to finalize. This module owns the middle
 * step and nothing else.
 *
 * It deliberately knows nothing about what is being uploaded, which endpoint minted the ticket,
 * or what happens afterwards. If this file ever needs to know that a file is an avatar, the
 * knowledge belongs in the feature that owns avatars.
 */

export type UploadTransferFailure =
  /** The bytes on disk are no longer the size the ticket was signed for. */
  | 'size-changed'
  /** The request never reached storage, or storage refused it. */
  | 'transfer-failed'
  /** The picked file could not be read, so there is nothing to sign a ticket for. */
  | 'unreadable-file';

export class UploadTransferError extends Error {
  readonly reason: UploadTransferFailure;

  constructor(reason: UploadTransferFailure, message: string) {
    super(message);
    this.name = 'UploadTransferError';
    this.reason = reason;
  }
}

/**
 * The bytes to send, described the way a native uploader accepts them.
 *
 * A URI rather than the bytes themselves: loading the file into JavaScript only so the native
 * layer can stream it straight back out is a copy that buys nothing. `byteSize` is passed in
 * rather than measured here because the ticket was signed for that exact number - this module's
 * job is to hold the invariant, not to go and find the answer a second time.
 */
export type UploadSource = {
  uri: string;
  byteSize: number;
};

export type UploadRequest = {
  headers: Record<string, string>;
  method: 'PUT';
  uri: string;
  url: string;
};

/** Performs the transfer. A port so the native implementation can be swapped or faked. */
export type UploadSender = (request: UploadRequest) => Promise<{ status: number }>;

/**
 * A second write to the same key. The storage key is signed write-once, so this means the object
 * is already there - which is exactly what a retry looks like when the first attempt actually
 * landed. Treating it as a failure would strand the caller on an upload that succeeded.
 */
const alreadyStoredStatus = 412;

export async function sendUploadTicket(
  ticket: UploadTicket,
  source: UploadSource,
  options: { send: UploadSender },
): Promise<void> {
  if (source.byteSize !== ticket.contentLength) {
    throw new UploadTransferError(
      'size-changed',
      'The file changed after the upload was prepared. Pick it again.',
    );
  }

  let result: { status: number };
  try {
    result = await options.send({
      headers: ticket.headers,
      method: ticket.method,
      uri: source.uri,
      url: ticket.url,
    });
  } catch {
    throw new UploadTransferError(
      'transfer-failed',
      'The upload could not reach storage. Check your connection and try again.',
    );
  }

  if (result.status === alreadyStoredStatus) return;

  if (result.status < 200 || result.status >= 300) {
    throw new UploadTransferError(
      'transfer-failed',
      'Storage rejected the upload. Try again with a different file.',
    );
  }
}
