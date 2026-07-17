import { AppError } from '../../../http/errors'
import { BillingFailure, type BillingFailureCode } from '../domain/errors'

const statusByCode = {
  IAP_INVALID_TRANSACTION: 400,
  IAP_NOT_CONFIGURED: 503,
  IAP_OWNERSHIP_MISMATCH: 403,
  IAP_WEBHOOK_IN_PROGRESS: 503,
} as const satisfies Record<BillingFailureCode, 400 | 403 | 503>

export function toBillingAppError(error: unknown) {
  if (!(error instanceof BillingFailure)) return error
  return new AppError(statusByCode[error.code], error.code, error.message, error.details)
}

export async function executeBilling<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw toBillingAppError(error)
  }
}
