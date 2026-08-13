import { File, UploadType } from 'expo-file-system';

import type { UploadFileAccess } from './file-access';
import { UploadTransferError } from './transfer';

/**
 * Reading and sending a `file://` URI on iOS and Android.
 *
 * This is the only file in the app that imports `expo-file-system`, which is what keeps the
 * protocol and everything above it testable without a native module. Its web counterpart,
 * `web-file-access.ts`, needs no native module at all; `AppProviders` picks between them.
 *
 * Two properties of `File.upload` are why it is used here rather than `fetch(uri).blob()`. The
 * bytes never enter JavaScript, and a non-2xx response **resolves** with its status instead of
 * throwing - so the 412 that means "already stored" arrives as a value the protocol can read,
 * rather than something inferred from an exception.
 */
export const nativeFileAccess: UploadFileAccess = {
  measureBytes: async (uri) => {
    // Synchronous on this platform; the port is async because a browser has to read the blob.
    const { size } = new File(uri);

    // Falsy rather than `=== 0` on purpose, and do not narrow it. TypeScript declares `size` as
    // `number`, the documentation says 0 for a file that cannot be read, and both native
    // implementations actually return null when the underlying call throws or the file is
    // missing - while the web stub of this class has no `size` at all. One falsy test covers
    // every one of those, and any of them signed into a ticket earns an opaque 403 from storage
    // instead of the instruction below.
    // Typed rather than a plain Error on purpose: only the protocol's own error carries text
    // the UI is allowed to show, so a bare Error here would be replaced by generic copy telling
    // the person to retry - the one instruction that cannot work for a file that will not read.
    if (!size) {
      throw new UploadTransferError(
        'unreadable-file',
        'That photo could not be read from this device. Pick it again.',
      );
    }

    return size;
  },

  send: async (request) => {
    const result = await new File(request.uri).upload(request.url, {
      // Verbatim. `Content-Type` and `If-None-Match` are inside the signature, so anything that
      // adds, drops, or re-cases a header turns a valid upload into an unexplained 403.
      headers: request.headers,
      httpMethod: request.method,
      // Foreground: the transfer is tied to a visible spinner and a short-lived signed URL, so
      // surviving app suspension would buy nothing and the URL would likely be expired anyway.
      sessionType: 'foreground',
      uploadType: UploadType.BINARY_CONTENT,
    });

    return { status: result.status };
  },
};
