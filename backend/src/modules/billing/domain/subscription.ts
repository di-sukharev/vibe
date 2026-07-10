import type { SubscriptionSnapshot } from '@web-app-demo/contracts'

export type SubscriptionStateValue = SubscriptionSnapshot['state']

export type EntitlementRecord = {
  platform: 'android' | 'ios' | null
  state: SubscriptionStateValue
  productId: string | null
  originalTransactionId: string | null
  transactionId: string | null
  expiresAt: Date | null
  willAutoRenew: boolean | null
  updatedAt: Date
}

export type IncomingEntitlement = {
  platform: 'android' | 'ios'
  transactionId: string | null
  originalTransactionId: string | null
  purchaseDate: Date | null
  expiresAt: Date | null
  revokedAt: Date | null
  state: SubscriptionStateValue
}

export function inactiveSubscriptionSnapshot(): SubscriptionSnapshot {
  return {
    entitlement: 'premium',
    isActive: false,
    state: 'inactive',
    platform: null,
    productId: null,
    originalTransactionId: null,
    transactionId: null,
    expiresAt: null,
    willAutoRenew: null,
    updatedAt: null,
  }
}

export function toSubscriptionSnapshot(
  entitlement: EntitlementRecord,
  now: Date,
): SubscriptionSnapshot {
  const state = effectiveSubscriptionState(entitlement, now)
  return {
    entitlement: 'premium',
    isActive: state === 'active' || state === 'billing_grace_period',
    state,
    platform: entitlement.platform,
    productId: entitlement.productId,
    originalTransactionId: entitlement.originalTransactionId,
    transactionId: entitlement.transactionId,
    expiresAt: entitlement.expiresAt?.toISOString() ?? null,
    willAutoRenew: entitlement.willAutoRenew,
    updatedAt: entitlement.updatedAt.toISOString(),
  }
}

export function effectiveSubscriptionState(
  entitlement: Pick<EntitlementRecord, 'state' | 'expiresAt'>,
  now: Date,
): SubscriptionStateValue {
  if (
    (entitlement.state === 'active' || entitlement.state === 'billing_grace_period') &&
    entitlement.expiresAt &&
    entitlement.expiresAt.getTime() <= now.getTime()
  ) {
    return 'expired'
  }
  return entitlement.state
}

export function shouldUpdateEntitlement(input: {
  existing: EntitlementRecord
  incoming: IncomingEntitlement
  now: Date
}) {
  const { existing, incoming, now } = input
  if (!existing.transactionId) return true
  if (incoming.transactionId && existing.transactionId === incoming.transactionId) return true

  const sameOriginalTransaction =
    Boolean(incoming.originalTransactionId) &&
    existing.originalTransactionId === incoming.originalTransactionId
  if ((incoming.revokedAt || incoming.state === 'revoked') && sameOriginalTransaction) return true

  const existingActive = isActiveSubscriptionState(existing.state, existing.expiresAt, now)
  const incomingActive = isActiveSubscriptionState(incoming.state, incoming.expiresAt, now)
  if (!incomingActive && existingActive && !sameOriginalTransaction) return false
  if (incomingActive && !existingActive) return true

  const existingFreshness = existing.expiresAt?.getTime() ?? 0
  const incomingFreshness =
    incoming.expiresAt?.getTime() ?? incoming.purchaseDate?.getTime() ?? 0
  if (incomingFreshness > existingFreshness) return true
  if (incomingFreshness < existingFreshness) return false
  return incomingActive || sameOriginalTransaction || existing.platform === incoming.platform
}

export function resolveGooglePlaySubscriptionState(
  subscriptionState: string | null | undefined,
  expiresAt: Date | null,
  now: Date,
): SubscriptionStateValue {
  const future = Boolean(expiresAt && expiresAt.getTime() > now.getTime())
  switch (subscriptionState) {
    case 'SUBSCRIPTION_STATE_ACTIVE':
    case 'SUBSCRIPTION_STATE_CANCELED':
      return future ? 'active' : 'expired'
    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD':
      return future ? 'billing_grace_period' : 'expired'
    case 'SUBSCRIPTION_STATE_ON_HOLD':
    case 'SUBSCRIPTION_STATE_PAUSED':
      return 'billing_retry'
    case 'SUBSCRIPTION_STATE_EXPIRED':
    case 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED':
      return 'expired'
    default:
      return 'pending'
  }
}

export function resolveGooglePlayWillAutoRenew(
  subscriptionState: string | null | undefined,
  autoRenewEnabled: boolean | null | undefined,
) {
  if (subscriptionState === 'SUBSCRIPTION_STATE_CANCELED') return false
  return autoRenewEnabled ?? null
}

export function shouldAcknowledgeGooglePlayPurchase(input: {
  acknowledgementState: string | null
  state: SubscriptionStateValue
  subscriptionState: string | null | undefined
}) {
  if (input.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED') return false
  if (['pending', 'expired', 'revoked', 'inactive'].includes(input.state)) return false
  return input.subscriptionState !== 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'
}

function isActiveSubscriptionState(
  state: SubscriptionStateValue,
  expiresAt: Date | null,
  now: Date,
) {
  if (state !== 'active' && state !== 'billing_grace_period') return false
  return !expiresAt || expiresAt.getTime() > now.getTime()
}
