import type { UploadFileAccess } from './file-access';

/**
 * Reading and sending a `blob:` URI in a browser.
 *
 * `expo-file-system` is a warn-only stub on web: its `File` has no size and its upload resolves
 * with status 0. Both the image picker and the image manipulator, however, work there and hand
 * back object URLs, so the web build reaches this code with a perfectly good image and needs a
 * reader that understands that URL. Without this file the web build fails at the measurement
 * step, before anything is ever sent.
 *
 * Reading an object URL back through `fetch` is the browser's own way to get at the bytes; the
 * blob is held in memory, so measuring and sending do not cost two trips to disk or network.
 *
 * The PUT mirrors the web client's proven one in `webapp/src/features/avatar/upload.ts`, down to
 * `credentials: 'omit'` - the ticket carries its own authority, and sending cookies would only
 * break the CORS preflight.
 */
export const webFileAccess: UploadFileAccess = {
  measureBytes: async (uri) => (await readBlob(uri)).size,

  send: async (request) => {
    const body = await readBlob(request.uri);

    const response = await fetch(request.url, {
      body,
      credentials: 'omit',
      // Verbatim, for the same reason as on native: these headers are inside the signature.
      headers: request.headers,
      method: request.method,
      mode: 'cors',
    });

    // Returned rather than thrown, so the protocol can read 412 as "already stored".
    return { status: response.status };
  },
};

async function readBlob(uri: string) {
  const response = await fetch(uri);
  return response.blob();
}
