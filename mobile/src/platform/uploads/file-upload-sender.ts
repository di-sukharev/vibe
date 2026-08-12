import { File, UploadType } from 'expo-file-system';

import type { UploadSender } from './transfer';

/**
 * The default sender: streams the file from disk straight into the request body.
 *
 * This is the only file in the app that imports `expo-file-system`, which is what keeps the
 * protocol and everything above it testable without a native module.
 *
 * Two properties of `File.upload` are why it is used here rather than `fetch(uri).blob()`. The
 * bytes never enter JavaScript, and a non-2xx response **resolves** with its status instead of
 * throwing - so the 412 that means "already stored" arrives as a value the protocol can read,
 * rather than something inferred from an exception.
 */
export const uploadFileWithFileSystem: UploadSender = async (request) => {
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
};
