/**
 * The transfer protocol, and nothing native.
 *
 * `uploadFileWithFileSystem` is deliberately **not** re-exported here. It is the only piece that
 * imports a native module, and pulling it through this barrel would drag `expo-file-system` into
 * every consumer - including the pure modules and their tests, which is the whole point of the
 * sender being a port. Composition imports it from `./file-upload-sender` explicitly, so the one
 * place that depends on a native module says so out loud.
 */
export { sendUploadTicket, UploadTransferError } from './transfer';
export type {
  UploadRequest,
  UploadSender,
  UploadSource,
  UploadTransferFailure,
} from './transfer';
