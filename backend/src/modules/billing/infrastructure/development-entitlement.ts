import type { DbClient } from '../../../db'

const developmentEntitlement = {
  environment: 'DevelopmentSeed',
  expiresAt: null,
  originalTransactionId: null,
  platform: null,
  productId: 'local.premium',
  state: 'active' as const,
  transactionId: null,
  webOrderLineItemId: null,
  willAutoRenew: false,
}

export async function bootstrapDevelopmentEntitlement(
  db: DbClient,
  userId: string,
) {
  const existing = await db.subscriptionEntitlement.findUnique({
    where: { userId },
  })
  if (
    existing &&
    existing.environment === developmentEntitlement.environment &&
    existing.expiresAt === developmentEntitlement.expiresAt &&
    existing.originalTransactionId === developmentEntitlement.originalTransactionId &&
    existing.platform === developmentEntitlement.platform &&
    existing.productId === developmentEntitlement.productId &&
    existing.state === developmentEntitlement.state &&
    existing.transactionId === developmentEntitlement.transactionId &&
    existing.webOrderLineItemId === developmentEntitlement.webOrderLineItemId &&
    existing.willAutoRenew === developmentEntitlement.willAutoRenew
  ) {
    return existing
  }

  return db.subscriptionEntitlement.upsert({
    where: { userId },
    create: { userId, ...developmentEntitlement },
    update: developmentEntitlement,
  })
}
