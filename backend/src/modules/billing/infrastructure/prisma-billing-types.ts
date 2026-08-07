/**
 * Hand-written stand-ins for the billing tables while they are commented out in
 * `prisma/schema/billing.prisma`.
 *
 * This is the price of shipping billing switched off rather than deleted: with the models
 * commented out, the generated Prisma client knows nothing about them, and this module would
 * not compile. The row shapes below mirror the schema exactly, so query results stay honest;
 * field names, `select` narrowing, and NOT NULL columns on create are checked, but the filter
 * vocabulary is a subset of Prisma's, so an exotic query that Prisma would reject may reach
 * runtime. Treat the two infrastructure files as partly unverified until the real client is back.
 *
 * When you turn subscriptions on (see docs/IAP.md):
 *   1. uncomment the models in `prisma/schema/billing.prisma` and run the migration;
 *   2. delete this file;
 *   3. in every importer below, swap `BillingDbClient` back to `DbClient` from the backend `db`
 *      module, and take `SubscriptionState` from `generated/prisma/enums` again:
 *        - infrastructure/billing-operations.ts        (both)
 *        - infrastructure/billing-adapters.ts          (both)
 *        - infrastructure/billing-operations.test.ts   (both)
 *        - index.ts                                    (client type)
 *        - billing-routes.test.ts                      (both)
 *        - billing.integration.test.ts                 (client type)
 *      `rg -l prisma-billing-types backend/src --glob '!*.md'` finds them if this list drifts.
 */

import type { DbClient } from '../../../db'

export const SubscriptionState = {
  inactive: 'inactive',
  pending: 'pending',
  active: 'active',
  billing_grace_period: 'billing_grace_period',
  billing_retry: 'billing_retry',
  expired: 'expired',
  revoked: 'revoked',
} as const

export type SubscriptionState = (typeof SubscriptionState)[keyof typeof SubscriptionState]

export type SubscriptionPlatform = 'android' | 'ios'

export type SubscriptionEntitlementRow = {
  id: string
  userId: string
  entitlementKey: string
  platform: SubscriptionPlatform | null
  state: SubscriptionState
  productId: string | null
  originalTransactionId: string | null
  transactionId: string | null
  webOrderLineItemId: string | null
  expiresAt: Date | null
  willAutoRenew: boolean | null
  environment: string | null
  createdAt: Date
  updatedAt: Date
}

export type AppStoreTransactionRow = {
  id: string
  userId: string
  originalTransactionId: string
  transactionId: string
  webOrderLineItemId: string | null
  productId: string
  state: SubscriptionState
  environment: string | null
  appAccountToken: string | null
  purchaseDate: Date | null
  expiresAt: Date | null
  revokedAt: Date | null
  willAutoRenew: boolean | null
  signedTransactionHash: string
  signedRenewalHash: string | null
  createdAt: Date
  updatedAt: Date
}

export type AppStoreWebhookRow = {
  id: string
  notificationUuid: string | null
  signedPayloadHash: string
  notificationType: string | null
  subtype: string | null
  environment: string | null
  originalTransactionId: string | null
  transactionId: string | null
  claimToken: string | null
  claimedAt: Date | null
  processedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type GooglePlaySubscriptionPurchaseRow = {
  id: string
  userId: string
  purchaseToken: string
  purchaseTokenHash: string
  linkedPurchaseToken: string | null
  linkedPurchaseTokenHash: string | null
  productId: string
  basePlanId: string | null
  latestOrderId: string | null
  state: SubscriptionState
  environment: string | null
  acknowledgementState: string | null
  externalAccountId: string | null
  externalProfileId: string | null
  expiresAt: Date | null
  willAutoRenew: boolean | null
  acknowledgedAt: Date | null
  reconcileAttemptedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** Field names are checked; the comparison vocabulary is a subset of Prisma's. */
type ScalarFilter<Value> =
  | Value
  | {
      equals?: Value
      not?: Value | { equals?: Value }
      in?: Value[]
      notIn?: Value[]
      lt?: Value
      lte?: Value
      gt?: Value
      gte?: Value
    }

type Where<Row> = {
  [Field in keyof Row]?: ScalarFilter<Row[Field]>
} & {
  AND?: Where<Row> | Where<Row>[]
  OR?: Where<Row>[]
  NOT?: Where<Row> | Where<Row>[]
}

type UpdateData<Row> = {
  [Field in keyof Row]?: Row[Field] | { set?: Row[Field] }
}

/** Columns the database fills in: ids and timestamps. */
type GeneratedColumn = 'id' | 'createdAt' | 'updatedAt'

type NullableColumn<Row> = {
  [Field in keyof Row]-?: null extends Row[Field] ? Field : never
}[keyof Row]

/**
 * Mirrors Prisma's create rule: everything is optional except NOT NULL columns without a default.
 * Omitting one of those is the mistake most likely to reach Postgres unnoticed while the real
 * client is away, since the fake-db unit tests would never see it.
 */
type OptionalOnCreate<Row, Defaulted extends keyof Row> = Extract<
  GeneratedColumn | Defaulted | NullableColumn<Row>,
  keyof Row
>

type CreateData<Row, Defaulted extends keyof Row> = Omit<
  Row,
  OptionalOnCreate<Row, Defaulted>
> &
  Partial<Pick<Row, OptionalOnCreate<Row, Defaulted>>>

type Select<Row> = { [Field in keyof Row]?: boolean }

type SortOrder = 'asc' | 'desc'

type OrderBy<Row> = {
  [Field in keyof Row]?: SortOrder | { sort: SortOrder; nulls?: 'first' | 'last' }
}

/** `select` narrows the result exactly as Prisma does, so callers keep their real shapes. */
type Selected<Row, Selection> = Selection extends Select<Row>
  ? Pick<Row, Extract<{ [Field in keyof Selection]: Selection[Field] extends true ? Field : never }[keyof Selection], keyof Row>>
  : Row

export type BillingDelegate<Row, Defaulted extends keyof Row = never> = {
  findUnique<const Selection extends Select<Row> | undefined = undefined>(args: {
    where: Where<Row>
    select?: Selection
  }): Promise<Selected<Row, Selection> | null>
  findUniqueOrThrow<const Selection extends Select<Row> | undefined = undefined>(args: {
    where: Where<Row>
    select?: Selection
  }): Promise<Selected<Row, Selection>>
  findFirst<const Selection extends Select<Row> | undefined = undefined>(args?: {
    where?: Where<Row>
    select?: Selection
    orderBy?: OrderBy<Row> | OrderBy<Row>[]
  }): Promise<Selected<Row, Selection> | null>
  findMany<const Selection extends Select<Row> | undefined = undefined>(args?: {
    where?: Where<Row>
    select?: Selection
    orderBy?: OrderBy<Row> | OrderBy<Row>[]
    take?: number
    skip?: number
  }): Promise<Selected<Row, Selection>[]>
  create<const Selection extends Select<Row> | undefined = undefined>(args: {
    data: CreateData<Row, Defaulted>
    select?: Selection
  }): Promise<Selected<Row, Selection>>
  update<const Selection extends Select<Row> | undefined = undefined>(args: {
    where: Where<Row>
    data: UpdateData<Row>
    select?: Selection
  }): Promise<Selected<Row, Selection>>
  updateMany(args: { where?: Where<Row>; data: UpdateData<Row> }): Promise<{ count: number }>
  upsert<const Selection extends Select<Row> | undefined = undefined>(args: {
    where: Where<Row>
    create: CreateData<Row, Defaulted>
    update: UpdateData<Row>
    select?: Selection
  }): Promise<Selected<Row, Selection>>
  deleteMany(args?: { where?: Where<Row> }): Promise<{ count: number }>
  count(args?: { where?: Where<Row> }): Promise<number>
}

// The second parameter lists columns that carry a schema default, so creates may omit them.
export type BillingDelegates = {
  appStoreTransaction: BillingDelegate<AppStoreTransactionRow>
  appStoreWebhook: BillingDelegate<AppStoreWebhookRow>
  googlePlaySubscriptionPurchase: BillingDelegate<GooglePlaySubscriptionPurchaseRow>
  subscriptionEntitlement: BillingDelegate<SubscriptionEntitlementRow, 'entitlementKey' | 'state'>
}

type BillingTransactionClient = Omit<DbClient, '$transaction'> & BillingDelegates

/** The generated client plus the tables this module owns, including inside `$transaction`. */
export type BillingDbClient = Omit<DbClient, '$transaction'> &
  BillingDelegates & {
    $transaction<Result>(
      run: (tx: BillingTransactionClient) => Promise<Result>,
      options?: { isolationLevel?: string; maxWait?: number; timeout?: number },
    ): Promise<Result>
  }
