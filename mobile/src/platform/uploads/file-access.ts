import type { UploadSender } from './transfer';

/**
 * How one platform reads and sends the bytes behind a URI.
 *
 * The two operations travel together on purpose. A picked image is described by a URI whose
 * meaning is platform-specific - `file://` on a device, `blob:` in a browser - and only code
 * that understands that URI can either measure it or send it. Measuring with one platform's
 * reader and sending with the other's would sign a ticket for a size the transfer can never
 * match, and storage answers that with an opaque 403 - so the pair is chosen once, at the
 * composition root, and handed out from that single value. Keep it that way: nothing else in
 * the app should import one of the implementations directly.
 *
 * Everything above this type works with either implementation, which is what keeps the protocol,
 * the avatar feature, and their tests free of any native module.
 */
export type UploadFileAccess = {
  /**
   * The exact byte count behind `uri`.
   *
   * The ticket is signed for one exact number, so this is measured after any normalization
   * rather than taken from whatever produced the file.
   */
  measureBytes: (uri: string) => Promise<number>;
  send: UploadSender;
};
