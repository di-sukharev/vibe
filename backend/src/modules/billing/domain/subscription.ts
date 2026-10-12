import type { SubscriptionSnapshot } from '@web-app-demo/contracts'

export type SubscriptionStateValue = SubscriptionSnapshot['state']

export const googlePlayTokenRetentionAfterExpiryMs = 60 * 24 * 60 * 60 * 1000

export type EntitlementRecord = {
  platform: 'android' | 'ios' | null
  state: SubscriptionStateValue
  productId: string | null
  originalTransactionId: string | null
  transactionId: string | null
  expiresAt: Date | null
  willAutoRenew: boolean | null
  updatedAt: Date
  googlePlayPurchaseId?: string | null
  appStoreSignedAt?: Date | null
}

export type SubscriptionSource = EntitlementRecord & {
  platform: 'android' | 'ios'
  purchaseDate: Date | null
  revokedAt: Date | null
  environment: string | null
  webOrderLineItemId: string | null
}

/** Select a paid period per Apple chain before comparing independent subscriptions. */
export function selectSubscriptionSource(
  sources: SubscriptionSource[],
  current: EntitlementRecord | null,
  now: Date,
): SubscriptionSource | null {
  const appleChains = new Map<string, SubscriptionSource>()
  const candidates: SubscriptionSource[] = []
  for (const source of sources) {
    if (source.platform === 'android') {
      candidates.push(source)
      continue
    }
    const key = source.originalTransactionId!
    const previous = appleChains.get(key)
    if (!previous || isLaterAppStorePeriod(previous, source, now)) {
      appleChains.set(key, source)
    }
  }
  candidates.push(...appleChains.values())
  const isCurrent = (source: SubscriptionSource) => source.platform === current?.platform && (
    source.platform === 'android'
      ? source.googlePlayPurchaseId === current.googlePlayPurchaseId
      : source.transactionId === current.transactionId
  )
  let selected = candidates.find(isCurrent) ?? null
  for (const candidate of candidates) {
    if (!selected) {
      selected = candidate
      continue
    }
    const selectedActive = isActiveSubscriptionState(selected.state, selected.expiresAt, now)
    const candidateActive = isActiveSubscriptionState(candidate.state, candidate.expiresAt, now)
    if (selectedActive !== candidateActive) {
      if (candidateActive) selected = candidate
      continue
    }
    // Keep the current inactive source for diagnostics until another source grants access.
    if (!candidateActive && isCurrent(selected)) continue
    if ((candidate.expiresAt?.getTime() ?? 0) > (selected.expiresAt?.getTime() ?? 0)) {
      selected = candidate
    }
  }
  return selected
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

function isLaterAppStorePeriod(
  existing: SubscriptionSource,
  incoming: SubscriptionSource,
  now: Date,
) {
  // An upgrade can replace an annual period with a shorter monthly period.
  if (existing.purchaseDate && incoming.purchaseDate &&
    incoming.purchaseDate.getTime() !== existing.purchaseDate.getTime()) {
    return incoming.purchaseDate > existing.purchaseDate
  }
  if (existing.appStoreSignedAt && incoming.appStoreSignedAt &&
    incoming.appStoreSignedAt < existing.appStoreSignedAt) return false

  // A refund affects its paid period. Older refunded periods cannot displace
  // a later period when the store did not provide comparable purchase dates.
  if (incoming.revokedAt) {
    if (existing.purchaseDate && incoming.purchaseDate) {
      return incoming.purchaseDate >= existing.purchaseDate
    }
    return !(existing.expiresAt && incoming.expiresAt && incoming.expiresAt < existing.expiresAt)
  }
  if (incoming.state === 'revoked') return true

  const existingActive = isActiveSubscriptionState(existing.state, existing.expiresAt, now)
  const incomingActive = isActiveSubscriptionState(incoming.state, incoming.expiresAt, now)
  if (incomingActive && !existingActive) return true
  return (incoming.expiresAt?.getTime() ?? incoming.purchaseDate?.getTime() ?? 0) >=
    (existing.expiresAt?.getTime() ?? 0)
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
