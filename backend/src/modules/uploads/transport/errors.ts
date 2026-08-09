import { AppError } from '../../../http/errors'
import { UploadsFailure } from '../domain/errors'

/**
 * Each failure maps to a status and a code the client can act on: retry the transfer, start a
 * new upload, or pick a different file. A single generic conflict would leave the UI guessing.
 */
export function toUploadsAppError(error: unknown) {
  if (!(error instanceof UploadsFailure)) return error

  if (error.kind === 'not_found') {
    return new AppError(404, 'NOT_FOUND', error.message)
  }
  if (error.kind === 'expired') {
    return new AppError(410, 'UPLOAD_EXPIRED', error.message)
  }
  if (error.kind === 'not_completed') {
    return new AppError(409, 'UPLOAD_NOT_COMPLETED', error.message)
  }
  return new AppError(409, 'UPLOAD_REJECTED', error.message)
}

export async function executeUploads<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw toUploadsAppError(error)
  }
}
