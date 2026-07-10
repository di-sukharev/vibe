export type BillingFailureCode =
  | 'IAP_INVALID_TRANSACTION'
  | 'IAP_NOT_CONFIGURED'
  | 'IAP_OWNERSHIP_MISMATCH'

export class BillingFailure extends Error {
  constructor(
    readonly code: BillingFailureCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'BillingFailure'
  }
}
