export type BillingFailureCode =
  | 'IAP_INVALID_TRANSACTION'
  | 'IAP_NOT_CONFIGURED'
  | 'IAP_OWNERSHIP_MISMATCH'
  | 'IAP_WEBHOOK_IN_PROGRESS'

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
