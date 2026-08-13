import { ApiRequestError } from '@/platform/api';
import { UploadTransferError } from '@/platform/uploads';

/**
 * Turns a failure into something the person can act on.
 *
 * The backend distinguishes three recoverable upload failures on purpose, so collapsing them
 * into one message would throw away the only information that tells someone what to do next:
 * send the file again, start over, or pick a different photo.
 *
 * Only two kinds of error carry text meant for a person: the backend's, and the transfer
 * protocol's. Anything else reaching here is an internal failure - a schema validation dump, a
 * native module's diagnostic - and echoing its `message` would put a JSON blob or a stack
 * fragment on screen in place of an instruction. Those get a fixed sentence instead, the same
 * way `iapErrorMessage` guards the billing surface.
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
      return 'That file was not accepted as an image. Try a different photo.';
    }
    return error.message;
  }

  return 'The photo could not be uploaded. Try again.';
}

export function avatarRemoveErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) return error.message;

  return 'The photo could not be removed. Try again.';
}

/**
 * Failures from choosing and preparing a photo, before anything is uploaded.
 *
 * Separate from the upload mapper because the instruction differs: nothing was sent, so "try
 * again" is wrong - the photo itself is the problem. The realistic case is a browser that cannot
 * decode the picked format (Chrome and Firefox refuse HEIC), where the manipulator rejects with
 * a value that is not even an `Error`.
 */
export function avatarPickErrorMessage(error: unknown) {
  if (error instanceof UploadTransferError) return error.message;

  return 'That photo could not be prepared for upload. Try a different one.';
}
