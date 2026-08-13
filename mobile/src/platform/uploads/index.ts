/**
 * The transfer protocol and its ports, and nothing native.
 *
 * `nativeFileAccess` and `webFileAccess` are deliberately **not** re-exported here. They are the
 * only pieces that touch a platform API, and pulling them through this barrel would drag
 * `expo-file-system` into every consumer - including the pure modules and their tests, which is
 * the whole point of the access being a port. Composition imports each one explicitly, so the
 * one place that depends on a platform says so out loud.
 */
export { sendUploadTicket, UploadTransferError } from './transfer';
export type { UploadFileAccess } from './file-access';
export type {
  UploadRequest,
  UploadSender,
  UploadSource,
  UploadTransferFailure,
} from './transfer';
