import { ApiRequestError } from '@/platform/api';
import { UploadTransferError } from '@/platform/uploads';

/**
 * Turns a failure into something the person can act on.
 *
 * The backend distinguishes three recoverable upload failures on purpose, so collapsing them
 * into one message would throw away the only information that tells someone what to do next:
 * send the file again, start over, or pick a different photo.
 */
export function avatarUploadErrorMessage(error: unknown) {
  if (error instanceof UploadTransferError) return error.message;

  if (error instanceof ApiRequestError) {
    if (error.code === 'UPLOAD_NOT_COMPLETED') {
      return 'The upload did not finish. Try sending the photo again.';
    }
    if (error.code === 'UPLOAD_EXPIRED') {
      return 'The upload took too long. Pick the photo again to start over.';
    }
    if (error.code === 'UPLOAD_REJECTED') {
      return 'That file is not a supported image. Pick a JPEG, PNG, or HEIC photo.';
    }
  }

  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

export function avatarRemoveErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}
