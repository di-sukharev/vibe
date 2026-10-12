import type {
  AppStoreRenewal,
  AppStoreSubscriptionStatus,
  AppStoreTransaction,
} from './provider-values'
import { requireAppStoreSignedDate, toDate } from './purchase-policy'
import type { SubscriptionStateValue } from './subscription'

export type AppStoreSnapshot = {
  transactionSignedAt: Date | null
  transactionExpiresAt: Date | null
  revokedAt: Date | null
  isUpgraded: boolean
  renewalSignedAt: Date | null
  gracePeriodExpiresAt: Date | null
  isInBillingRetryPeriod: boolean | null
  willAutoRenew: boolean | null
  statusSignedAt: Date | null
  providerStatus: SubscriptionStateValue | null
  stateSignedAt: Date | null
  state: SubscriptionStateValue
  expiresAt: Date | null
}

export function mergeAppStoreSnapshot(input: {
  existing: AppStoreSnapshot | null
  transaction: AppStoreTransaction
  renewal: AppStoreRenewal | null
  status?: AppStoreSubscriptionStatus | null
  notificationSignedDate?: number
  now: Date
}) {
  const { existing, transaction, renewal, now } = input
  const transactionSignedAt = new Date(requireAppStoreSignedDate(transaction.signedDate))
  const renewalSignedAt = renewal
    ? new Date(requireAppStoreSignedDate(renewal.signedDate))
    : null
  const statusSignedAt = input.status
    ? new Date(input.notificationSignedDate ?? Math.max(
        transactionSignedAt.getTime(),
        renewalSignedAt?.getTime() ?? 0,
      ))
    : null
  const facts: AppStoreSnapshot = {
    transactionSignedAt: existing?.transactionSignedAt ?? null,
    transactionExpiresAt: existing?.transactionExpiresAt ?? null,
    revokedAt: existing?.revokedAt ?? null,
    isUpgraded: existing?.isUpgraded ?? false,
    renewalSignedAt: existing?.renewalSignedAt ?? null,
    gracePeriodExpiresAt: existing?.gracePeriodExpiresAt ?? null,
    isInBillingRetryPeriod: existing?.isInBillingRetryPeriod ?? null,
    willAutoRenew: existing?.willAutoRenew ?? null,
    statusSignedAt: existing?.statusSignedAt ?? null,
    providerStatus: existing?.providerStatus ?? null,
    stateSignedAt: null,
    state: 'inactive',
    expiresAt: null,
  }

  const transactionChanged = isNewer(transactionSignedAt, facts.transactionSignedAt)
  if (transactionChanged) {
    facts.transactionSignedAt = transactionSignedAt
    facts.transactionExpiresAt = toDate(transaction.expiresDate)
    facts.revokedAt = toDate(transaction.revocationDate)
    facts.isUpgraded = transaction.isUpgraded
  }

  const renewalChanged = Boolean(renewalSignedAt && isNewer(renewalSignedAt, facts.renewalSignedAt))
  if (renewalChanged && renewal) {
    facts.renewalSignedAt = renewalSignedAt
    facts.gracePeriodExpiresAt = toDate(renewal.gracePeriodExpiresDate)
    facts.isInBillingRetryPeriod = renewal.isInBillingRetryPeriod ?? null
    facts.willAutoRenew = renewal.willAutoRenew
  }

  // A newer renewal cannot reverse a revocation recorded only in a status payload.
  const preservesRevokedStatus = facts.providerStatus === 'revoked' &&
    facts.statusSignedAt !== null && transactionSignedAt <= facts.statusSignedAt
  const statusChanged = Boolean(
    statusSignedAt && isNewer(statusSignedAt, facts.statusSignedAt) &&
    (input.status === 'revoked' || !preservesRevokedStatus),
  )
  if (statusChanged && input.status) {
    facts.statusSignedAt = statusSignedAt
    facts.providerStatus = input.status
  }

  facts.stateSignedAt = new Date(Math.max(
    facts.transactionSignedAt?.getTime() ?? 0,
    facts.renewalSignedAt?.getTime() ?? 0,
    facts.statusSignedAt?.getTime() ?? 0,
  ))
  facts.state = resolveState(facts, now)
  facts.expiresAt = facts.state === 'billing_grace_period'
    ? laterDate(facts.transactionExpiresAt, facts.gracePeriodExpiresAt)
    : facts.transactionExpiresAt
  return {
    facts,
    transactionChanged,
    renewalChanged,
    changed: transactionChanged || renewalChanged || statusChanged,
  }
}

function resolveState(facts: AppStoreSnapshot, now: Date): SubscriptionStateValue {
  if (facts.revokedAt) return 'revoked'
  if (facts.isUpgraded) return 'expired'

  const transactionTime = facts.transactionSignedAt?.getTime() ?? 0
  const statusTime = facts.statusSignedAt?.getTime() ?? 0
  const renewalTime = facts.renewalSignedAt?.getTime() ?? 0
  if (facts.providerStatus === 'revoked' && transactionTime <= statusTime) return 'revoked'

  const paidPeriodActive = Boolean(facts.transactionExpiresAt && facts.transactionExpiresAt > now)
  let state: SubscriptionStateValue | null = facts.providerStatus === 'revoked' ? null : facts.providerStatus
  if (!state || renewalTime > statusTime) {
    state = renewalState(facts, paidPeriodActive, now)
  }
  if (transactionTime > Math.max(statusTime, renewalTime) && paidPeriodActive) {
    state = 'active'
  }
  if (state === 'billing_grace_period' && (!facts.gracePeriodExpiresAt || facts.gracePeriodExpiresAt <= now)) {
    return 'expired'
  }
  if (state === 'active' && !paidPeriodActive) return 'expired'
  return state
}

function renewalState(
  facts: AppStoreSnapshot,
  paidPeriodActive: boolean,
  now: Date,
): SubscriptionStateValue {
  if (facts.isInBillingRetryPeriod) {
    return facts.gracePeriodExpiresAt && facts.gracePeriodExpiresAt > now
      ? 'billing_grace_period'
      : 'billing_retry'
  }
  return paidPeriodActive ? 'active' : 'expired'
}

function isNewer(incoming: Date, existing: Date | null) {
  return !existing || incoming > existing
}

function laterDate(left: Date | null, right: Date | null) {
  if (!left) return right
  if (!right) return left
  return left > right ? left : right
}
