import { AppError } from '../../../http/errors'
import { AuthFailure } from '../domain/errors'

export function toAuthAppError(error: unknown) {
  if (!(error instanceof AuthFailure)) return error

  if (error.kind === 'email_already_exists') {
    return new AppError(409, 'CONFLICT', error.message)
  }

  if (error.kind === 'password_reset_invalid') {
    return new AppError(400, 'AUTH_PASSWORD_RESET_INVALID', error.message)
  }

  if (error.kind === 'social_email_already_exists') {
    return new AppError(409, 'AUTH_EMAIL_ALREADY_EXISTS', error.message)
  }

  if (error.kind === 'provider_account_already_linked') {
    return new AppError(409, 'AUTH_PROVIDER_ACCOUNT_ALREADY_LINKED', error.message)
  }

  if (error.kind === 'provider_email_required') {
    return new AppError(401, 'AUTH_PROVIDER_EMAIL_REQUIRED', error.message)
  }

  if (error.kind === 'provider_invalid_token') {
    return new AppError(401, 'AUTH_INVALID_PROVIDER_TOKEN', error.message)
  }

  if (error.kind === 'provider_not_configured') {
    return new AppError(503, 'AUTH_PROVIDER_NOT_CONFIGURED', error.message)
  }

  if (error.kind === 'provider_unavailable') {
    return new AppError(503, 'AUTH_PROVIDER_UNAVAILABLE', error.message)
  }

  return new AppError(401, 'UNAUTHORIZED', error.message)
}

export async function executeAuth<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw toAuthAppError(error)
  }
}
