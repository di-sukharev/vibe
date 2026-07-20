import type {
  LegacyRegisterPushTokenRequest,
  LegacyUnregisterPushTokenRequest,
  RegisterPushTokenRequest,
  UnregisterPushTokenRequest,
} from '@web-app-demo/contracts'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'

import {
  acquirePushInstallationLock,
  acquirePushTokenValueLock,
  acquirePushTokenUserLock,
  maximumPushSendFenceTransactionMs,
  type DbClient,
} from '../../../db'
import type { AppEnv } from '../../../env'
import { Prisma } from '../../../generated/prisma/client'
import { PushDeliveryStatus, PushNotificationOutboxStatus } from '../../../generated/prisma/enums'
import {
  createExpoPushClient,
  defaultExpoPushRequestTimeoutMs,
  ExpoPushTransientError,
  isDeviceNotRegisteredError,
  type ExpoPushClientOptions,
  type ExpoTicket,
} from './expo-client'
import type {
  CheckPushReceiptsOptions,
  CheckPushReceiptsMetrics,
  EnqueuePushNotificationInput,
  NotificationServiceDependencies,
  ProcessPushOutboxOptions,
  ProcessPushOutboxMetrics,
  PushInstallationMutationResult,
  RedactTerminalNotificationDataOptions,
} from '../application/ports'
import {
  initialReceiptCheckAt,
  isReceiptCheckTerminal,
  isRetryableProviderError,
  nextReceiptCheckAt,
  outboxRetryAt,
  shouldRetryOutbox,
} from '../domain/retry-policy'

const defaultProcessLimit = 100
const defaultProcessMaxLoops = 5
const defaultProcessMaxRuntimeMs = 55_000
const defaultProcessingStaleMs = 120_000
const defaultReceiptCheckLimit = 300
const defaultPushTokenMaxPerUser = 10
const defaultSessionAbsoluteTtlDays = 90
const defaultTerminalRedactionLimit = 100
const expoSendBatchSize = 100

type PushServiceContext = {
  env: AppEnv
  prisma: DbClient
  pushClientOptions?: ExpoPushClientOptions
}

type OutboxItem = {
  attempts: number
  body: string
  data: Prisma.JsonValue | null
  dedupeKey: string
  id: string
  title: string
  userId: string
}

type PushTokenRecord = {
  expoPushToken: string
  id: string
  installationGeneration: number | null
  installationId: string | null
  registrationSessionId: string | null
}

type ReceiptDelivery = {
  id: string
  outboxId: string
  receiptClaimToken: string
  receiptCheckAttempts: number
}

export function createNotificationAdapters(
  context: PushServiceContext,
): Omit<NotificationServiceDependencies, 'now'> {
  return {
    tokens: {
      register: (userId, sessionId, input, now) =>
        registerPushToken(
          context.prisma,
          userId,
          sessionId,
          input,
          now,
          context.env.PUSH_TOKEN_MAX_PER_USER ?? defaultPushTokenMaxPerUser,
          context.env.SESSION_ABSOLUTE_TTL_DAYS,
        ),
      unregister: (userId, sessionId, input, now) =>
        unregisterPushToken(
          context.prisma,
          userId,
          sessionId,
          input,
          now,
          context.env.SESSION_ABSOLUTE_TTL_DAYS,
        ),
      cleanup: async (userId, expoPushTokens) => {
        if (expoPushTokens.length === 0) return
        await context.prisma.pushToken.deleteMany({
          where: { expoPushToken: { in: expoPushTokens }, userId },
        })
      },
      hasActive: (userId) => hasActivePushToken(
        context.prisma,
        userId,
        new Date(),
        context.env.SESSION_ABSOLUTE_TTL_DAYS,
      ),
    },
    outbox: {
      enqueue: (input) => enqueuePushNotification(context.prisma, input),
      process: (options) => processPushOutbox(context, options),
      redactTerminalData: (options) =>
        redactTerminalNotificationDataBatch(context.prisma, options),
    },
    receipts: {
      check: (options) => checkPushReceipts(context, options),
    },
  }
}

export async function registerPushToken(
  prisma: DbClient,
  userId: string,
  sessionId: string,
  input: RegisterPushTokenRequest,
  now: Date,
  maxTokensPerUser = defaultPushTokenMaxPerUser,
  sessionAbsoluteTtlDays = defaultSessionAbsoluteTtlDays,
) {
  if (!('installationId' in input)) {
    return registerLegacyPushToken(
      prisma,
      userId,
      sessionId,
      input,
      now,
      maxTokensPerUser,
      sessionAbsoluteTtlDays,
    )
  }

  return prisma.$transaction<PushInstallationMutationResult>(async (tx) => {
    await acquirePushTokenUserLock(tx, userId)
    await acquirePushTokenValueLock(tx, input.expoPushToken)
    await acquirePushInstallationLock(tx, input.installationId)
    const activeSession = await tx.authSession.count({
      where: {
        expiresAt: { gt: now },
        id: sessionId,
        revokedAt: null,
        createdAt: { gt: sessionAbsoluteNotBefore(now, sessionAbsoluteTtlDays) },
        userId,
      },
    })
    if (activeSession === 0) return 'inactive-session'

    const installation = await tx.pushInstallation.findUnique({
      where: { id: input.installationId },
      include: {
        pushToken: {
          select: {
            expoPushToken: true,
            registrationSessionId: true,
          },
        },
      },
    })
    const authoritySecretHash = hashInstallationSecret(input.installationSecret)
    if (!hasInstallationAuthority(installation, userId, authoritySecretHash)) {
      return 'forbidden'
    }
    if (
      installation &&
      (
        input.generation < installation.generation ||
        (
          input.generation === installation.generation &&
          (
            !installation.active ||
            installation.ownerUserId !== userId ||
            installation.pushToken?.expoPushToken !== input.expoPushToken ||
            installation.pushToken.registrationSessionId !== sessionId
          )
        )
      )
    ) {
      return 'stale'
    }

    const requestedToken = await tx.pushToken.findUnique({
      where: { expoPushToken: input.expoPushToken },
      select: {
        id: true,
        installation: { select: { ownerUserId: true } },
        installationId: true,
        userId: true,
      },
    })
    if (
      requestedToken &&
      requestedToken.installationId !== input.installationId &&
      (
        requestedToken.userId !== userId ||
        (
          requestedToken.installationId !== null &&
          requestedToken.installation?.ownerUserId !== userId
        )
      )
    ) {
      await tx.pushToken.updateMany({
        where: {
          disabledAt: null,
          id: requestedToken.id,
        },
        data: { disabledAt: now },
      })
      return 'forbidden'
    }
    const replacedInstallationId =
      requestedToken?.installationId &&
      requestedToken.installationId !== input.installationId
        ? requestedToken.installationId
        : null

    if (installation && !installation.authoritySecretHash) {
      await tx.pushInstallation.update({
        where: { id: installation.id },
        data: { authoritySecretHash },
      })
    }

    if (installation?.generation === input.generation) {
      return 'applied'
    }

    await tx.pushInstallation.upsert({
      where: { id: input.installationId },
      update: {
        active: true,
        authoritySecretHash,
        generation: input.generation,
        ownerUserId: userId,
      },
      create: {
        active: true,
        authoritySecretHash,
        generation: input.generation,
        id: input.installationId,
        ownerUserId: userId,
      },
    })

    if (replacedInstallationId) {
      await tx.pushInstallation.updateMany({
        where: { id: replacedInstallationId, ownerUserId: userId },
        data: { active: false },
      })
    }

    const tokensToReplace = input.previousExpoPushTokens ?? []
    await tx.pushToken.deleteMany({
      where: {
        OR: [
          { installationId: input.installationId },
          ...(tokensToReplace.length > 0
            ? [{
                expoPushToken: { in: tokensToReplace },
                installationId: null,
                userId,
              }]
            : []),
        ],
      },
    })

    await tx.pushToken.upsert({
      where: {
        expoPushToken: input.expoPushToken,
      },
      update: {
        deviceId: input.deviceId,
        disabledAt: null,
        installationId: input.installationId,
        platform: input.platform ?? null,
        registrationSessionId: sessionId,
        userId,
      },
      create: {
        deviceId: input.deviceId,
        expoPushToken: input.expoPushToken,
        installationId: input.installationId,
        platform: input.platform ?? null,
        registrationSessionId: sessionId,
        userId,
      },
    })

    await enforcePushTokenCap(tx, userId, maxTokensPerUser)
    return 'applied'
  })
}

async function registerLegacyPushToken(
  prisma: DbClient,
  userId: string,
  sessionId: string,
  input: LegacyRegisterPushTokenRequest,
  now: Date,
  maxTokensPerUser: number,
  sessionAbsoluteTtlDays: number,
) {
  return prisma.$transaction<PushInstallationMutationResult>(async (tx) => {
    await acquirePushTokenUserLock(tx, userId)
    await acquirePushTokenValueLock(tx, input.expoPushToken)
    if (!(await isActiveRegistrationSession(
      tx,
      userId,
      sessionId,
      now,
      sessionAbsoluteTtlDays,
    ))) return 'inactive-session'

    const existing = await tx.pushToken.findUnique({
      where: { expoPushToken: input.expoPushToken },
      select: { installationId: true },
    })
    if (existing?.installationId) return 'forbidden'

    await tx.pushToken.upsert({
      where: { expoPushToken: input.expoPushToken },
      create: {
        deviceId: input.deviceId,
        expoPushToken: input.expoPushToken,
        platform: input.platform ?? null,
        registrationSessionId: sessionId,
        userId,
      },
      update: {
        deviceId: input.deviceId,
        disabledAt: null,
        platform: input.platform ?? null,
        registrationSessionId: sessionId,
        userId,
      },
    })
    await enforcePushTokenCap(tx, userId, maxTokensPerUser)
    return 'applied'
  })
}

async function enforcePushTokenCap(
  tx: Parameters<Parameters<DbClient['$transaction']>[0]>[0],
  userId: string,
  maxTokensPerUser: number,
) {
  const overflow = await tx.pushToken.findMany({
    where: { userId },
    orderBy: [
      { disabledAt: { sort: 'asc', nulls: 'first' } },
      { updatedAt: 'desc' },
      { id: 'desc' },
    ],
    select: { id: true },
    skip: maxTokensPerUser,
  })
  if (overflow.length === 0) return

  const overflowInstallations = await tx.pushToken.findMany({
    where: { id: { in: overflow.map((token) => token.id) }, userId },
    select: { installationId: true },
  })
  await tx.pushToken.deleteMany({
    where: { id: { in: overflow.map((token) => token.id) }, userId },
  })
  const installationIds = overflowInstallations
    .map((token) => token.installationId)
    .filter((id): id is string => Boolean(id))
  if (installationIds.length > 0) {
    await tx.pushInstallation.updateMany({
      where: { id: { in: installationIds }, ownerUserId: userId },
      data: { active: false },
    })
  }
}

export async function unregisterPushToken(
  prisma: DbClient,
  userId: string,
  sessionId: string,
  input: UnregisterPushTokenRequest,
  now: Date,
  sessionAbsoluteTtlDays = defaultSessionAbsoluteTtlDays,
) {
  if (!('installationId' in input)) {
    return unregisterLegacyPushToken(
      prisma,
      userId,
      sessionId,
      input,
      now,
      sessionAbsoluteTtlDays,
    )
  }

  return prisma.$transaction<PushInstallationMutationResult>(async (tx) => {
    await acquirePushTokenUserLock(tx, userId)
    await acquirePushInstallationLock(tx, input.installationId)
    const activeSession = await tx.authSession.count({
      where: {
        expiresAt: { gt: now },
        id: sessionId,
        revokedAt: null,
        createdAt: { gt: sessionAbsoluteNotBefore(now, sessionAbsoluteTtlDays) },
        userId,
      },
    })
    if (activeSession === 0) return 'inactive-session'

    const installation = await tx.pushInstallation.findUnique({
      where: { id: input.installationId },
    })
    const authoritySecretHash = hashInstallationSecret(input.installationSecret)
    if (!hasInstallationAuthority(installation, userId, authoritySecretHash)) {
      return 'forbidden'
    }
    if (
      installation &&
      (
        input.generation < installation.generation ||
        (
          input.generation === installation.generation &&
          (installation.active || installation.ownerUserId !== userId)
        )
      )
    ) {
      return 'stale'
    }

    if (installation && !installation.authoritySecretHash) {
      await tx.pushInstallation.update({
        where: { id: installation.id },
        data: { authoritySecretHash },
      })
    }

    if (installation?.generation === input.generation) {
      return 'applied'
    }

    await tx.pushInstallation.upsert({
      where: { id: input.installationId },
      update: {
        active: false,
        authoritySecretHash,
        generation: input.generation,
        ownerUserId: userId,
      },
      create: {
        active: false,
        authoritySecretHash,
        generation: input.generation,
        id: input.installationId,
        ownerUserId: userId,
      },
    })

    const expoPushTokens = input.expoPushTokens ?? []
    await tx.pushToken.deleteMany({
      where: {
        OR: [
          { installationId: input.installationId },
          ...(expoPushTokens.length > 0
            ? [{
                expoPushToken: { in: expoPushTokens },
                installationId: null,
                userId,
              }]
            : []),
        ],
      },
    })
    return 'applied'
  })
}

async function unregisterLegacyPushToken(
  prisma: DbClient,
  userId: string,
  sessionId: string,
  input: LegacyUnregisterPushTokenRequest,
  now: Date,
  sessionAbsoluteTtlDays: number,
) {
  return prisma.$transaction<PushInstallationMutationResult>(async (tx) => {
    await acquirePushTokenUserLock(tx, userId)
    if (!(await isActiveRegistrationSession(
      tx,
      userId,
      sessionId,
      now,
      sessionAbsoluteTtlDays,
    ))) return 'inactive-session'

    if (input.expoPushToken) {
      await acquirePushTokenValueLock(tx, input.expoPushToken)
    }
    await tx.pushToken.deleteMany({
      where: {
        installationId: null,
        userId,
        ...(input.expoPushToken ? { expoPushToken: input.expoPushToken } : {}),
      },
    })
    return 'applied'
  })
}

async function isActiveRegistrationSession(
  tx: Pick<DbClient, 'authSession'>,
  userId: string,
  sessionId: string,
  now: Date,
  sessionAbsoluteTtlDays: number,
) {
  return (await tx.authSession.count({
    where: {
      expiresAt: { gt: now },
      id: sessionId,
      revokedAt: null,
      createdAt: { gt: sessionAbsoluteNotBefore(now, sessionAbsoluteTtlDays) },
      userId,
    },
  })) > 0
}

function hashInstallationSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex')
}

function hasInstallationAuthority(
  installation: {
    authoritySecretHash: string | null
    ownerUserId: string
  } | null,
  userId: string,
  candidateHash: string,
) {
  if (!installation) return true
  if (!installation.authoritySecretHash) {
    return installation.ownerUserId === userId
  }
  const expected = Buffer.from(installation.authoritySecretHash, 'hex')
  const candidate = Buffer.from(candidateHash, 'hex')
  return expected.length === candidate.length && timingSafeEqual(expected, candidate)
}

export async function hasActivePushToken(
  prisma: DbClient,
  userId: string,
  now = new Date(),
  sessionAbsoluteTtlDays = defaultSessionAbsoluteTtlDays,
) {
  const activeSessionIds = await findActivePushRegistrationSessionIds(
    prisma,
    userId,
    now,
    sessionAbsoluteTtlDays,
  )
  await bindLegacyPushTokensToActiveSession(prisma, userId, activeSessionIds)
  const count = await prisma.pushToken.count({
    where: activePushTokenWhere(userId, activeSessionIds),
  })
  return count > 0
}

export async function enqueuePushNotification(
  prisma: DbClient,
  input: EnqueuePushNotificationInput,
) {
  try {
    const created = await prisma.pushNotificationOutbox.create({
      data: {
        body: input.body,
        data: input.data === undefined ? undefined : (input.data as Prisma.InputJsonObject),
        dedupeKey: input.dedupeKey,
        scheduledFor: input.scheduledFor,
        title: input.title,
        userId: input.userId,
      },
      select: {
        id: true,
      },
    })

    return { created: true, id: created.id }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const existing = await prisma.pushNotificationOutbox.findUnique({
        where: {
          userId_dedupeKey: {
            dedupeKey: input.dedupeKey,
            userId: input.userId,
          },
        },
        select: {
          id: true,
        },
      })

      return { created: false, id: existing?.id ?? '' }
    }

    throw error
  }
}

export async function processPushOutbox(
  context: PushServiceContext,
  options: ProcessPushOutboxOptions = {},
): Promise<ProcessPushOutboxMetrics> {
  const now = options.now ?? new Date()
  const limit = options.limit ?? context.env.PUSH_OUTBOX_PROCESS_LIMIT ?? defaultProcessLimit
  const maxLoops = options.maxLoops ?? context.env.PUSH_OUTBOX_PROCESS_MAX_LOOPS ?? defaultProcessMaxLoops
  const maxRuntimeMs =
    options.maxRuntimeMs ?? context.env.PUSH_OUTBOX_PROCESS_MAX_RUNTIME_MS ?? defaultProcessMaxRuntimeMs
  const pushRequestTimeoutMs =
    context.pushClientOptions?.requestTimeoutMs ?? defaultExpoPushRequestTimeoutMs
  const processingStaleMs = Math.max(
    options.processingStaleMs ??
      context.env.PUSH_OUTBOX_PROCESSING_STALE_MS ??
      defaultProcessingStaleMs,
    pushRequestTimeoutMs * 2,
  )
  const startedAt = Date.now()
  const metrics = emptyOutboxMetrics()

  if (options.signal?.aborted) return metrics

  const requeued = await context.prisma.pushNotificationOutbox.updateMany({
    where: {
      status: PushNotificationOutboxStatus.processing,
      updatedAt: {
        lt: new Date(now.getTime() - processingStaleMs),
      },
      ...(options.onlyIds ? { id: { in: options.onlyIds } } : {}),
    },
    data: {
      lastError: 'Recovered stale processing lock',
      processingToken: null,
      scheduledFor: now,
      status: PushNotificationOutboxStatus.pending,
    },
  })
  metrics.requeuedStale = requeued.count

  while (
    !options.signal?.aborted &&
    metrics.loops < maxLoops &&
    Date.now() - startedAt < maxRuntimeMs
  ) {
    const pending = await context.prisma.pushNotificationOutbox.findMany({
      where: {
        scheduledFor: {
          lte: now,
        },
        status: PushNotificationOutboxStatus.pending,
        ...(options.onlyIds ? { id: { in: options.onlyIds } } : {}),
      },
      orderBy: {
        scheduledFor: 'asc',
      },
      select: {
        attempts: true,
        body: true,
        data: true,
        dedupeKey: true,
        id: true,
        title: true,
        userId: true,
      },
      take: limit,
    })

    if (pending.length === 0) break

    metrics.loops += 1

    for (const item of pending) {
      if (options.signal?.aborted || Date.now() - startedAt >= maxRuntimeMs) break
      mergeOutboxMetrics(
        metrics,
        await processOutboxItem(context, item, now, processingStaleMs, options.signal),
      )
    }
  }

  metrics.pendingCount = await context.prisma.pushNotificationOutbox.count({
    where: {
      scheduledFor: {
        lte: now,
      },
      status: PushNotificationOutboxStatus.pending,
    },
  })

  return metrics
}

export async function checkPushReceipts(
  context: PushServiceContext,
  options: CheckPushReceiptsOptions = {},
): Promise<CheckPushReceiptsMetrics> {
  if (options.signal?.aborted) return emptyReceiptMetrics()

  const now = options.now ?? new Date()
  const limit = options.limit ?? context.env.PUSH_RECEIPT_CHECK_LIMIT ?? defaultReceiptCheckLimit
  const receiptClaimStaleBefore = new Date(
    now.getTime() - Math.max(defaultProcessingStaleMs, defaultExpoPushRequestTimeoutMs * 2),
  )
  const candidates = await context.prisma.pushDelivery.findMany({
    where: {
      AND: [
        {
          OR: [
            { receiptNextCheckAt: null },
            { receiptNextCheckAt: { lte: now } },
          ],
        },
        {
          OR: [
            { receiptClaimToken: null },
            { receiptClaimedAt: { lt: receiptClaimStaleBefore } },
          ],
        },
      ],
      receiptCheckedAt: null,
      status: PushDeliveryStatus.sent,
      ticketId: {
        not: null,
      },
    },
    orderBy: [
      {
        receiptNextCheckAt: 'asc',
      },
      {
        createdAt: 'asc',
      },
    ],
    select: {
      expoPushToken: true,
      id: true,
      outbox: {
        select: {
          attempts: true,
        },
      },
      outboxId: true,
      pushTokenId: true,
      registrationGeneration: true,
      registrationInstallationId: true,
      registrationSessionId: true,
      receiptCheckAttempts: true,
      ticketId: true,
      userId: true,
    },
    take: limit,
  })

  const deliveries: Array<(typeof candidates)[number] & ReceiptDelivery> = []
  for (const candidate of candidates) {
    if (options.signal?.aborted) break
    const receiptClaimToken = randomUUID()
    const claimed = await context.prisma.pushDelivery.updateMany({
      where: {
        AND: [
          {
            OR: [
              { receiptNextCheckAt: null },
              { receiptNextCheckAt: { lte: now } },
            ],
          },
          {
            OR: [
              { receiptClaimToken: null },
              { receiptClaimedAt: { lt: receiptClaimStaleBefore } },
            ],
          },
        ],
        id: candidate.id,
        receiptCheckedAt: null,
        status: PushDeliveryStatus.sent,
      },
      data: { receiptClaimToken, receiptClaimedAt: now },
    })
    if (claimed.count === 1) deliveries.push({ ...candidate, receiptClaimToken })
  }

  if (deliveries.length === 0) {
    return emptyReceiptMetrics()
  }

  const client = createExpoPushClient({
    accessToken: context.env.EXPO_PUSH_ACCESS_TOKEN,
    ...context.pushClientOptions,
    signal: options.signal ?? context.pushClientOptions?.signal,
  })
  let receiptByTicketId
  try {
    receiptByTicketId = await client.receipts(
      deliveries.map((delivery) => delivery.ticketId).filter((ticketId): ticketId is string => Boolean(ticketId)),
    )
  } catch (error) {
    await releaseReceiptClaims(context.prisma, deliveries)
    throw error
  }
  const metrics: CheckPushReceiptsMetrics = {
    checked: 0,
    delivered: 0,
    failed: 0,
    tokensDisabled: 0,
  }

  for (const delivery of deliveries) {
    if (!delivery.ticketId) continue
    const receipt = receiptByTicketId[delivery.ticketId]
    if (!receipt) {
      await handleMissingReceipt(context.prisma, delivery, now, metrics)
      continue
    }

    if (receipt.status === 'ok') {
      const updated = await context.prisma.pushDelivery.updateMany({
        where: {
          id: delivery.id,
          receiptClaimToken: delivery.receiptClaimToken,
        },
        data: {
          expoPushToken: null,
          providerStatus: receipt.status,
          receiptClaimToken: null,
          receiptClaimedAt: null,
          receiptCheckAttempts: {
            increment: 1,
          },
          receiptCheckedAt: now,
          receiptNextCheckAt: null,
          status: PushDeliveryStatus.delivered,
        },
      })
      metrics.checked += updated.count
      metrics.delivered += updated.count
      if (updated.count === 1) {
        await redactTerminalNotificationData(context.prisma, delivery.outboxId)
      }
      continue
    }

    if (
      isRetryableProviderError(receipt.details?.error) &&
      delivery.pushTokenId &&
      shouldRetryOutbox(delivery.outbox.attempts)
    ) {
      const requeued = await requeueRetryableReceipt(context.prisma, {
        deliveryId: delivery.id,
        message: receipt.message ?? 'Retryable Expo push receipt failed',
        now,
        outboxAttempts: delivery.outbox.attempts,
        outboxId: delivery.outboxId,
        receiptCheckAttempts: delivery.receiptCheckAttempts,
        receiptClaimToken: delivery.receiptClaimToken,
      })
      if (requeued) {
        metrics.checked += 1
        metrics.failed += 1
      }
      continue
    }

    const updated = await context.prisma.pushDelivery.updateMany({
      where: {
        id: delivery.id,
        receiptClaimToken: delivery.receiptClaimToken,
      },
      data: {
        errorMessage: receipt.message ?? 'Expo push receipt failed',
        expoPushToken: null,
        providerErrorCode: receipt.details?.error,
        providerStatus: receipt.status,
        receiptClaimToken: null,
        receiptClaimedAt: null,
        receiptCheckAttempts: {
          increment: 1,
        },
        receiptCheckedAt: now,
        receiptNextCheckAt: null,
        status: PushDeliveryStatus.failed,
      },
    })
    metrics.checked += updated.count
    metrics.failed += updated.count

    if (updated.count === 1 && delivery.expoPushToken && isDeviceNotRegisteredError(receipt)) {
      metrics.tokensDisabled += await disableToken(context.prisma, {
        expoPushToken: delivery.expoPushToken,
        installationGeneration: delivery.registrationGeneration,
        installationId: delivery.registrationInstallationId,
        pushTokenId: delivery.pushTokenId,
        registrationSessionId: delivery.registrationSessionId,
        userId: delivery.userId,
      })
    }
    if (updated.count === 1) {
      await redactTerminalNotificationData(context.prisma, delivery.outboxId)
    }
  }

  return metrics
}

async function releaseReceiptClaims(
  prisma: DbClient,
  deliveries: Array<{ id: string; receiptClaimToken: string }>,
) {
  await Promise.all(
    deliveries.map((delivery) =>
      prisma.pushDelivery.updateMany({
        where: {
          id: delivery.id,
          receiptClaimToken: delivery.receiptClaimToken,
          receiptCheckedAt: null,
        },
        data: { receiptClaimToken: null, receiptClaimedAt: null },
      }),
    ),
  )
}

async function processOutboxItem(
  context: PushServiceContext,
  item: OutboxItem,
  now: Date,
  processingStaleMs: number,
  signal?: AbortSignal,
): Promise<ProcessPushOutboxMetrics> {
  const processingToken = await claimPushOutboxItemForProcessing(context.prisma, item.id, now)
  if (!processingToken) {
    return emptyOutboxMetrics()
  }

  const metrics = emptyOutboxMetrics()
  metrics.processed = 1

  if (signal?.aborted) {
    await releaseOutboxForShutdown(context.prisma, item, processingToken, now)
    return metrics
  }

  const activeSessionIds = await findActivePushRegistrationSessionIds(
    context.prisma,
    item.userId,
    now,
    context.env.SESSION_ABSOLUTE_TTL_DAYS,
  )
  await bindLegacyPushTokensToActiveSession(context.prisma, item.userId, activeSessionIds)
  const tokens = await context.prisma.pushToken.findMany({
    where: {
      ...activePushTokenWhere(item.userId, activeSessionIds),
    },
    select: {
      expoPushToken: true,
      id: true,
      installation: { select: { generation: true } },
      installationId: true,
      registrationSessionId: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  const tokenRecords = tokens.map((token) => ({
    expoPushToken: token.expoPushToken,
    id: token.id,
    installationGeneration: token.installation?.generation ?? null,
    installationId: token.installationId,
    registrationSessionId: token.registrationSessionId,
  }))

  if (tokenRecords.length === 0) {
    if (await hasAnyDelivery(context.prisma, item.id)) {
      return completeOutboxFromDeliveries(context.prisma, item, processingToken, now, metrics)
    }

    await context.prisma.pushDelivery.create({
      data: {
        errorMessage: 'No active Expo push token registered',
        outboxId: item.id,
        status: PushDeliveryStatus.skipped,
        userId: item.userId,
      },
    })
    await markOutboxComplete(context.prisma, item.id, processingToken, {
      attempts: item.attempts + 1,
      lastError: 'No active Expo push token registered',
      processedAt: now,
      status: PushNotificationOutboxStatus.skipped,
    })
    metrics.skipped = 1
    return metrics
  }

  const existingDeliveryTokenIds = new Set(
    (
      await context.prisma.pushDelivery.findMany({
        where: {
          outboxId: item.id,
          pushTokenId: {
            in: tokenRecords.map((token) => token.id),
          },
        },
        select: {
          pushTokenId: true,
        },
      })
    )
      .map((delivery) => delivery.pushTokenId)
      .filter((pushTokenId): pushTokenId is string => Boolean(pushTokenId)),
  )
  const tokensToSend = tokenRecords.filter((token) => !existingDeliveryTokenIds.has(token.id))

  if (tokensToSend.length === 0) {
    return completeOutboxFromDeliveries(context.prisma, item, processingToken, now, metrics)
  }

  let sentCount = 0
  let failedCount = 0
  const retryableTicketFailures: Array<{ message: string; token: PushTokenRecord }> = []

  for (let index = 0; index < tokensToSend.length; index += expoSendBatchSize) {
    if (signal?.aborted) {
      await releaseOutboxForShutdown(context.prisma, item, processingToken, now)
      return metrics
    }
    const selectedBatchTokens = tokensToSend.slice(index, index + expoSendBatchSize)
    let admittedBatchTokens = selectedBatchTokens

    try {
      if (!(await touchOutboxProcessing(context.prisma, item.id, processingToken))) {
        metrics.failed = 1
        metrics.transientFailed = 1
        return metrics
      }
      const admission = await sendAuthorizedPushBatch(
        context,
        item,
        processingToken,
        selectedBatchTokens,
        processingStaleMs,
        signal,
      )
      if (!admission.owned) {
        metrics.failed = 1
        metrics.transientFailed = 1
        return metrics
      }
      admittedBatchTokens = admission.tokens
      if (admission.outcome !== 'sent') {
        if (signal?.aborted) {
          await releaseOutboxForShutdown(context.prisma, item, processingToken, now)
          metrics.transientFailed = 1
          return metrics
        }
        if (admission.outcome === 'failed') throw admission.error
        continue
      }

      const persisted = await persistExpoTicketBatch(
        context.prisma,
        item,
        processingToken,
        now,
        admittedBatchTokens,
        admission.tickets,
      )
      if (!persisted.owned) {
        metrics.failed = 1
        metrics.transientFailed = 1
        return metrics
      }
      sentCount += persisted.sentCount
      failedCount += persisted.failedCount
      retryableTicketFailures.push(...persisted.retryableTicketFailures)
    } catch (error) {
      if (signal?.aborted) {
        await releaseOutboxForShutdown(context.prisma, item, processingToken, now)
        metrics.transientFailed = 1
        return metrics
      }

      const nextAttempts = item.attempts + 1
      const message = errorMessage(error)

      if (isRetryablePushSendError(error) && shouldRetryOutbox(nextAttempts)) {
        await markOutboxComplete(context.prisma, item.id, processingToken, {
          attempts: nextAttempts,
          lastError: message,
          processedAt: null,
          scheduledFor: outboxRetryAt(nextAttempts, now),
          status: PushNotificationOutboxStatus.pending,
        })
        metrics.failed = 1
        metrics.transientFailed = 1
        return metrics
      }

      if (!await recordBatchFailure(
        context.prisma,
        item,
        processingToken,
        admittedBatchTokens,
        message,
      )) {
        metrics.failed = 1
        metrics.transientFailed = 1
        return metrics
      }
      await markOutboxComplete(context.prisma, item.id, processingToken, {
        attempts: nextAttempts,
        lastError: message,
        processedAt: now,
        status: await completedOutboxStatus(context.prisma, item.id),
      })
      metrics.failed = 1
      return metrics
    }
  }

  if (
    sentCount === 0 &&
    failedCount === 0 &&
    retryableTicketFailures.length === 0
  ) {
    if (await hasAnyDelivery(context.prisma, item.id)) {
      return completeOutboxFromDeliveries(context.prisma, item, processingToken, now, metrics)
    }

    await context.prisma.pushDelivery.create({
      data: {
        errorMessage: 'No active Expo push token registered at send admission',
        outboxId: item.id,
        status: PushDeliveryStatus.skipped,
        userId: item.userId,
      },
    })
    await markOutboxComplete(context.prisma, item.id, processingToken, {
      attempts: item.attempts + 1,
      lastError: 'No active Expo push token registered at send admission',
      processedAt: now,
      status: PushNotificationOutboxStatus.skipped,
    })
    metrics.skipped = 1
    return metrics
  }

  if (retryableTicketFailures.length > 0) {
    const nextAttempts = item.attempts + 1
    const message = `${retryableTicketFailures.length} retryable Expo push ticket(s) failed`

    if (shouldRetryOutbox(nextAttempts)) {
      await markOutboxComplete(context.prisma, item.id, processingToken, {
        attempts: nextAttempts,
        lastError: message,
        processedAt: null,
        scheduledFor: outboxRetryAt(nextAttempts, now),
        status: PushNotificationOutboxStatus.pending,
      })
      metrics.failed = 1
      metrics.transientFailed = 1
      return metrics
    }

    if (!await recordBatchFailure(
      context.prisma,
      item,
      processingToken,
      retryableTicketFailures.map((failure) => failure.token),
      message,
    )) {
      metrics.failed = 1
      metrics.transientFailed = 1
      return metrics
    }
    failedCount += retryableTicketFailures.length
  }

  const hasSuccess = sentCount > 0 || (await hasSuccessfulDelivery(context.prisma, item.id))
  await markOutboxComplete(context.prisma, item.id, processingToken, {
    attempts: item.attempts + 1,
    lastError: failedCount > 0 ? `${failedCount} Expo push ticket(s) failed` : null,
    processedAt: now,
    status: hasSuccess ? PushNotificationOutboxStatus.sent : PushNotificationOutboxStatus.failed,
  })
  metrics.sent = hasSuccess ? 1 : 0
  metrics.failed = metrics.sent > 0 ? 0 : 1
  return metrics
}

async function sendAuthorizedPushBatch(
  context: PushServiceContext,
  item: OutboxItem,
  processingToken: string,
  selectedTokens: PushTokenRecord[],
  processingStaleMs: number,
  signal?: AbortSignal,
) {
  const requestTimeoutMs =
    context.pushClientOptions?.requestTimeoutMs ?? defaultExpoPushRequestTimeoutMs
  const timing = outboxSendFenceTiming(processingStaleMs, requestTimeoutMs)
  const deadline = createSendDeadlineSignal(
    [signal, context.pushClientOptions?.signal],
    timing.providerDeadlineMs,
  )

  try {
    return await context.prisma.$transaction(async (tx) => {
      await acquirePushTokenUserLock(tx, item.userId)
      for (const expoPushToken of sortedUnique(
        selectedTokens.map((token) => token.expoPushToken),
      )) {
        await acquirePushTokenValueLock(tx, expoPushToken)
      }
      for (const installationId of sortedUnique(
        selectedTokens
          .map((token) => token.installationId)
          .filter((id): id is string => id !== null),
      )) {
        await acquirePushInstallationLock(tx, installationId)
      }

      const admissionNow = new Date()
      const activeSessionIds = await findActivePushRegistrationSessionIds(
        tx,
        item.userId,
        admissionNow,
        context.env.SESSION_ABSOLUTE_TTL_DAYS,
      )
      const currentTokens = await tx.pushToken.findMany({
        where: {
          ...activePushTokenWhere(item.userId, activeSessionIds),
          id: { in: selectedTokens.map((token) => token.id) },
        },
        select: {
          expoPushToken: true,
          id: true,
          installation: { select: { generation: true } },
          installationId: true,
          registrationSessionId: true,
        },
      })
      const currentTokensById = new Map(currentTokens.map((token) => [token.id, {
        expoPushToken: token.expoPushToken,
        id: token.id,
        installationGeneration: token.installation?.generation ?? null,
        installationId: token.installationId,
        registrationSessionId: token.registrationSessionId,
      }]))
      const admittedTokens = selectedTokens.filter((selectedToken) => {
        const currentToken = currentTokensById.get(selectedToken.id)
        return (
          currentToken?.expoPushToken === selectedToken.expoPushToken &&
          currentToken.installationId === selectedToken.installationId &&
          currentToken.installationGeneration === selectedToken.installationGeneration &&
          currentToken.registrationSessionId === selectedToken.registrationSessionId
        )
      })

      if (!(await touchOutboxProcessing(tx, item.id, processingToken))) {
        return {
          owned: false as const,
          tokens: [] as PushTokenRecord[],
        }
      }
      if (admittedTokens.length === 0) {
        return {
          outcome: 'skipped' as const,
          owned: true as const,
          tokens: admittedTokens,
        }
      }

      let outcome:
        | {
            outcome: 'sent'
            tickets: ExpoTicket[]
          }
        | {
            error: unknown
            outcome: 'failed'
          }
      try {
        if (deadline.signal.aborted) {
          throw new ExpoPushTransientError('Expo push send admission deadline elapsed')
        }
        const client = createExpoPushClient({
          accessToken: context.env.EXPO_PUSH_ACCESS_TOKEN,
          ...context.pushClientOptions,
          signal: deadline.signal,
        })
        outcome = {
          outcome: 'sent',
          tickets: await client.send(messagesForTokens(item, admittedTokens)),
        }
      } catch (error) {
        outcome = { error, outcome: 'failed' }
      }

      if (!(await touchOutboxProcessing(tx, item.id, processingToken))) {
        return {
          owned: false as const,
          tokens: [] as PushTokenRecord[],
        }
      }
      return {
        ...outcome,
        owned: true as const,
        tokens: admittedTokens,
      }
    }, {
      timeout: timing.transactionTimeoutMs,
    })
  } finally {
    deadline.dispose()
  }
}

function outboxSendFenceTiming(processingStaleMs: number, requestTimeoutMs: number) {
  const safetyMs = Math.min(5_000, Math.max(1, Math.floor(requestTimeoutMs / 6)))
  const transactionTimeoutMs = Math.min(
    maximumPushSendFenceTransactionMs,
    Math.max(1, processingStaleMs - safetyMs),
  )
  return {
    providerDeadlineMs: Math.max(1, transactionTimeoutMs - safetyMs),
    transactionTimeoutMs,
  }
}

function createSendDeadlineSignal(
  signals: Array<AbortSignal | undefined>,
  timeoutMs: number,
) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const sources = signals.filter((signal): signal is AbortSignal => Boolean(signal))
  for (const source of sources) {
    if (source.aborted) abort()
    else source.addEventListener('abort', abort, { once: true })
  }
  const timeout = setTimeout(abort, timeoutMs)

  return {
    dispose() {
      clearTimeout(timeout)
      for (const source of sources) source.removeEventListener('abort', abort)
    },
    signal: controller.signal,
  }
}

function sortedUnique(values: string[]) {
  return [...new Set(values)].sort()
}

export async function claimPushOutboxItemForProcessing(prisma: DbClient, id: string, now: Date) {
  return prisma.$transaction(async (tx) => {
    await acquirePushOutboxLock(tx, id)
    const processingToken = randomUUID()
    const lock = await tx.pushNotificationOutbox.updateMany({
      where: {
        id,
        scheduledFor: {
          lte: now,
        },
        status: PushNotificationOutboxStatus.pending,
      },
      data: {
        processingToken,
        status: PushNotificationOutboxStatus.processing,
      },
    })
    return lock.count === 1 ? processingToken : null
  })
}

export async function requeueRetryableReceipt(
  prisma: DbClient,
  input: {
    deliveryId: string
    message: string
    now: Date
    outboxAttempts: number
    outboxId: string
    receiptCheckAttempts: number
    receiptClaimToken: string
  },
) {
  return prisma.$transaction(async (tx) => {
    await acquirePushOutboxLock(tx, input.outboxId)
    const outbox = await tx.pushNotificationOutbox.findUnique({
      where: { id: input.outboxId },
      select: { processingToken: true, status: true },
    })

    if (
      !outbox ||
      outbox.processingToken ||
      outbox.status === PushNotificationOutboxStatus.processing
    ) {
      await tx.pushDelivery.updateMany({
        where: {
          id: input.deliveryId,
          receiptClaimToken: input.receiptClaimToken,
        },
        data: {
          receiptClaimToken: null,
          receiptClaimedAt: null,
          receiptCheckAttempts: { increment: 1 },
          receiptNextCheckAt: nextReceiptCheckAt(input.receiptCheckAttempts + 1, input.now),
        },
      })
      return false
    }

    if (
      outbox.status !== PushNotificationOutboxStatus.sent &&
      outbox.status !== PushNotificationOutboxStatus.pending
    ) {
      await tx.pushDelivery.updateMany({
        where: {
          id: input.deliveryId,
          receiptClaimToken: input.receiptClaimToken,
        },
        data: { receiptClaimToken: null, receiptClaimedAt: null },
      })
      return false
    }

    const deleted = await tx.pushDelivery.deleteMany({
      where: {
        id: input.deliveryId,
        receiptClaimToken: input.receiptClaimToken,
      },
    })
    if (deleted.count === 0) return false

    const updated = await tx.pushNotificationOutbox.updateMany({
      where: {
        id: input.outboxId,
        processingToken: null,
        status: {
          in: [PushNotificationOutboxStatus.sent, PushNotificationOutboxStatus.pending],
        },
      },
      data: {
        lastError: input.message,
        processedAt: null,
        processingToken: null,
        scheduledFor: outboxRetryAt(input.outboxAttempts, input.now),
        status: PushNotificationOutboxStatus.pending,
      },
    })
    if (updated.count !== 1) {
      throw new Error('Push outbox retry claim changed while its receipt was being requeued')
    }
    return true
  })
}

async function acquirePushOutboxLock(
  prisma: Pick<DbClient, '$executeRaw'>,
  outboxId: string,
) {
  await prisma.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`push-outbox:${outboxId}`}, 0))`,
  )
}

async function recordBatchFailure(
  prisma: DbClient,
  item: OutboxItem,
  processingToken: string,
  tokens: PushTokenRecord[],
  message: string,
) {
  return prisma.$transaction(async (tx) => {
    await acquirePushOutboxLock(tx, item.id)
    const owned = await tx.pushNotificationOutbox.updateMany({
      where: {
        id: item.id,
        processingToken,
        status: PushNotificationOutboxStatus.processing,
      },
      data: { processingToken },
    })
    if (owned.count === 0) return false

    for (const token of tokens) {
      await tx.pushDelivery.create({
        data: {
          errorMessage: message,
          outboxId: item.id,
          pushTokenId: token.id,
          registrationGeneration: token.installationGeneration,
          registrationInstallationId: token.installationId,
          registrationSessionId: token.registrationSessionId,
          status: PushDeliveryStatus.failed,
          userId: item.userId,
        },
      })
    }
    return true
  })
}

async function persistExpoTicketBatch(
  prisma: DbClient,
  item: OutboxItem,
  processingToken: string,
  now: Date,
  tokens: PushTokenRecord[],
  tickets: ExpoTicket[],
) {
  return prisma.$transaction(async (tx) => {
    await acquirePushOutboxLock(tx, item.id)
    const owned = await tx.pushNotificationOutbox.updateMany({
      where: {
        id: item.id,
        processingToken,
        status: PushNotificationOutboxStatus.processing,
      },
      data: { processingToken },
    })
    if (owned.count === 0) {
      return {
        failedCount: 0,
        owned: false,
        retryableTicketFailures: [] as Array<{ message: string; token: PushTokenRecord }>,
        sentCount: 0,
      }
    }

    let failedCount = 0
    let sentCount = 0
    const retryableTicketFailures: Array<{ message: string; token: PushTokenRecord }> = []
    for (const [ticketIndex, ticket] of tickets.entries()) {
      const token = tokens[ticketIndex]
      if (!token) continue

      if (ticket.status === 'ok') {
        sentCount += 1
        await tx.pushDelivery.create({
          data: {
            expoPushToken: token.expoPushToken,
            outboxId: item.id,
            pushTokenId: token.id,
            registrationGeneration: token.installationGeneration,
            registrationInstallationId: token.installationId,
            registrationSessionId: token.registrationSessionId,
            receiptNextCheckAt: initialReceiptCheckAt(now),
            status: PushDeliveryStatus.sent,
            ticketId: ticket.id,
            userId: item.userId,
          },
        })
        continue
      }

      if (isRetryableProviderError(ticket.details?.error)) {
        retryableTicketFailures.push({
          message: ticket.message ?? 'Retryable Expo push ticket failed',
          token,
        })
        continue
      }

      failedCount += 1
      await tx.pushDelivery.create({
        data: {
          errorMessage: ticket.message ?? 'Expo push ticket failed',
          outboxId: item.id,
          providerErrorCode: ticket.details?.error,
          providerStatus: ticket.status,
          pushTokenId: token.id,
          registrationGeneration: token.installationGeneration,
          registrationInstallationId: token.installationId,
          registrationSessionId: token.registrationSessionId,
          status: PushDeliveryStatus.failed,
          userId: item.userId,
        },
      })
      if (isDeviceNotRegisteredError(ticket)) {
        await disableToken(tx, {
          expoPushToken: token.expoPushToken,
          installationGeneration: token.installationGeneration,
          installationId: token.installationId,
          pushTokenId: token.id,
          registrationSessionId: token.registrationSessionId,
          userId: item.userId,
        })
      }
    }

    return {
      failedCount,
      owned: true,
      retryableTicketFailures,
      sentCount,
    }
  })
}

async function findActivePushRegistrationSessionIds(
  prisma: Pick<DbClient, 'authSession'>,
  userId: string,
  now: Date,
  sessionAbsoluteTtlDays: number,
) {
  return (
    await prisma.authSession.findMany({
      where: {
        expiresAt: { gt: now },
        revokedAt: null,
        createdAt: { gt: sessionAbsoluteNotBefore(now, sessionAbsoluteTtlDays) },
        userId,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    })
  ).map((session) => session.id)
}

async function bindLegacyPushTokensToActiveSession(
  prisma: Pick<DbClient, 'pushToken'>,
  userId: string,
  activeSessionIds: string[],
) {
  const registrationSessionId = activeSessionIds[0]
  if (!registrationSessionId) return
  await prisma.pushToken.updateMany({
    where: { installationId: null, registrationSessionId: null, userId },
    data: { registrationSessionId },
  })
}

function sessionAbsoluteNotBefore(now: Date, sessionAbsoluteTtlDays: number) {
  return new Date(
    now.getTime() - sessionAbsoluteTtlDays * 24 * 60 * 60 * 1_000,
  )
}

function activePushTokenWhere(
  userId: string,
  activeSessionIds: string[],
): Prisma.PushTokenWhereInput {
  return {
    disabledAt: null,
    registrationSessionId: { in: activeSessionIds },
    userId,
  }
}

async function touchOutboxProcessing(
  prisma: Pick<DbClient, 'pushNotificationOutbox'>,
  id: string,
  processingToken: string,
) {
  const result = await prisma.pushNotificationOutbox.updateMany({
    where: {
      id,
      processingToken,
      status: PushNotificationOutboxStatus.processing,
    },
    data: {
      updatedAt: new Date(),
    },
  })
  return result.count === 1
}

async function completeOutboxFromDeliveries(
  prisma: DbClient,
  item: OutboxItem,
  processingToken: string,
  now: Date,
  metrics: ProcessPushOutboxMetrics,
) {
  const status = await completedOutboxStatus(prisma, item.id)
  await markOutboxComplete(prisma, item.id, processingToken, {
    attempts: item.attempts + 1,
    lastError: status === PushNotificationOutboxStatus.sent ? null : 'All Expo push deliveries failed',
    processedAt: now,
    status,
  })
  metrics.sent = status === PushNotificationOutboxStatus.sent ? 1 : 0
  metrics.failed = status === PushNotificationOutboxStatus.failed ? 1 : 0
  metrics.skipped = status === PushNotificationOutboxStatus.skipped ? 1 : 0
  return metrics
}

async function completedOutboxStatus(prisma: DbClient, outboxId: string) {
  const deliveries = await prisma.pushDelivery.findMany({
    where: {
      outboxId,
    },
    select: {
      status: true,
    },
  })

  if (
    deliveries.some(
      (delivery) =>
        delivery.status === PushDeliveryStatus.sent ||
        delivery.status === PushDeliveryStatus.delivered,
    )
  ) {
    return PushNotificationOutboxStatus.sent
  }

  if (deliveries.some((delivery) => delivery.status === PushDeliveryStatus.failed)) {
    return PushNotificationOutboxStatus.failed
  }

  return PushNotificationOutboxStatus.skipped
}

async function hasAnyDelivery(prisma: DbClient, outboxId: string) {
  const count = await prisma.pushDelivery.count({
    where: {
      outboxId,
    },
  })
  return count > 0
}

async function hasSuccessfulDelivery(prisma: DbClient, outboxId: string) {
  const count = await prisma.pushDelivery.count({
    where: {
      outboxId,
      status: {
        in: [PushDeliveryStatus.sent, PushDeliveryStatus.delivered],
      },
    },
  })
  return count > 0
}

function messagesForTokens(item: OutboxItem, tokens: PushTokenRecord[]) {
  return tokens.map((token) => ({
    body: item.body,
    data: jsonObjectToRecord(item.data),
    sound: 'default' as const,
    title: item.title,
    to: token.expoPushToken,
  }))
}

async function markOutboxComplete(
  prisma: DbClient,
  id: string,
  processingToken: string,
  data: {
    attempts: number
    lastError: string | null
    processedAt: Date | null
    scheduledFor?: Date
    status: PushNotificationOutboxStatus
  },
) {
  const updated = await prisma.pushNotificationOutbox.updateMany({
    where: {
      id,
      processingToken,
      status: PushNotificationOutboxStatus.processing,
    },
    data: { ...data, processingToken: null },
  })
  if (
    updated.count === 1 &&
    data.status !== PushNotificationOutboxStatus.pending &&
    data.status !== PushNotificationOutboxStatus.processing
  ) {
    await redactTerminalNotificationData(prisma, id)
  }
  return updated
}

function releaseOutboxForShutdown(
  prisma: DbClient,
  item: OutboxItem,
  processingToken: string,
  now: Date,
) {
  return markOutboxComplete(prisma, item.id, processingToken, {
    attempts: item.attempts,
    lastError: 'Notification worker stopped before delivery completed',
    processedAt: null,
    scheduledFor: now,
    status: PushNotificationOutboxStatus.pending,
  })
}

function emptyReceiptMetrics(): CheckPushReceiptsMetrics {
  return {
    checked: 0,
    delivered: 0,
    failed: 0,
    tokensDisabled: 0,
  }
}

async function disableToken(
  prisma: Pick<DbClient, 'pushToken'>,
  input: {
    expoPushToken: string
    installationGeneration: number | null
    installationId: string | null
    pushTokenId: string | null
    registrationSessionId: string | null
    userId: string
  },
) {
  if (!input.pushTokenId) return 0
  const result = await prisma.pushToken.updateMany({
    where: {
      disabledAt: null,
      expoPushToken: input.expoPushToken,
      id: input.pushTokenId,
      installationId: input.installationId,
      registrationSessionId: input.registrationSessionId,
      userId: input.userId,
      ...(input.installationGeneration == null
        ? { installation: null }
        : { installation: { generation: input.installationGeneration } }),
    },
    data: {
      disabledAt: new Date(),
    },
  })
  return result.count
}

async function handleMissingReceipt(
  prisma: DbClient,
  delivery: ReceiptDelivery,
  now: Date,
  metrics: CheckPushReceiptsMetrics,
) {
  const nextAttempts = delivery.receiptCheckAttempts + 1

  if (isReceiptCheckTerminal(nextAttempts)) {
    const updated = await prisma.pushDelivery.updateMany({
      where: {
        id: delivery.id,
        receiptClaimToken: delivery.receiptClaimToken,
      },
      data: {
        errorMessage: 'Expo push receipt was unavailable after repeated checks',
        expoPushToken: null,
        receiptClaimToken: null,
        receiptClaimedAt: null,
        receiptCheckAttempts: nextAttempts,
        receiptCheckedAt: now,
        receiptNextCheckAt: null,
        status: PushDeliveryStatus.failed,
      },
    })
    metrics.failed += updated.count
    if (updated.count === 1) {
      await redactTerminalNotificationData(prisma, delivery.outboxId)
    }
    return
  }

  await prisma.pushDelivery.updateMany({
    where: {
      id: delivery.id,
      receiptClaimToken: delivery.receiptClaimToken,
    },
    data: {
      receiptClaimToken: null,
      receiptClaimedAt: null,
      receiptCheckAttempts: nextAttempts,
      receiptNextCheckAt: nextReceiptCheckAt(nextAttempts, now),
    },
  })
}

async function redactTerminalNotificationData(prisma: DbClient, outboxId: string) {
  return prisma.$transaction(async (tx) => {
    await acquirePushOutboxLock(tx, outboxId)
    const outbox = await tx.pushNotificationOutbox.findUnique({
      where: { id: outboxId },
      select: { status: true },
    })
    if (
      !outbox ||
      outbox.status === PushNotificationOutboxStatus.pending ||
      outbox.status === PushNotificationOutboxStatus.processing
    ) {
      return false
    }

    const nonTerminalDeliveries = await tx.pushDelivery.count({
      where: {
        outboxId,
        status: {
          in: [PushDeliveryStatus.pending, PushDeliveryStatus.sent],
        },
      },
    })
    if (nonTerminalDeliveries > 0) return false

    await tx.pushDelivery.updateMany({
      where: {
        expoPushToken: { not: null },
        outboxId,
      },
      data: { expoPushToken: null },
    })
    await tx.pushNotificationOutbox.update({
      where: { id: outboxId },
      data: {
        body: '',
        data: Prisma.DbNull,
        title: '',
      },
    })
    return true
  })
}

export async function redactTerminalNotificationDataBatch(
  prisma: DbClient,
  options: RedactTerminalNotificationDataOptions = {},
) {
  const limit = Math.max(1, Math.min(options.limit ?? defaultTerminalRedactionLimit, 1_000))
  const candidates = await prisma.pushNotificationOutbox.findMany({
    where: {
      status: {
        in: [
          PushNotificationOutboxStatus.failed,
          PushNotificationOutboxStatus.sent,
          PushNotificationOutboxStatus.skipped,
        ],
      },
      OR: [
        { body: { not: '' } },
        { title: { not: '' } },
        { deliveries: { some: { expoPushToken: { not: null } } } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
    take: limit,
  })

  let redacted = 0
  for (const candidate of candidates) {
    if (await redactTerminalNotificationData(prisma, candidate.id)) redacted += 1
  }
  return redacted
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function isRetryablePushSendError(error: unknown) {
  return (
    error instanceof ExpoPushTransientError ||
    (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2028', 'P2034'].includes(error.code)
    )
  )
}

function jsonObjectToRecord(value: Prisma.JsonValue | null): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown push notification error'
}

function emptyOutboxMetrics(): ProcessPushOutboxMetrics {
  return {
    failed: 0,
    loops: 0,
    pendingCount: 0,
    processed: 0,
    requeuedStale: 0,
    sent: 0,
    skipped: 0,
    transientFailed: 0,
  }
}

function mergeOutboxMetrics(target: ProcessPushOutboxMetrics, partial: ProcessPushOutboxMetrics) {
  target.failed += partial.failed
  target.processed += partial.processed
  target.requeuedStale += partial.requeuedStale
  target.sent += partial.sent
  target.skipped += partial.skipped
  target.transientFailed += partial.transientFailed
}
