import type {
  RegisterPushTokenRequest,
  TestPushNotificationPayload,
  UnregisterPushTokenRequest,
} from '@web-app-demo/contracts'

import type { DbClient } from '../../../db'
import type { AppEnv } from '../../../env'
import { Prisma } from '../../../generated/prisma/client'
import { PushDeliveryStatus, PushNotificationOutboxStatus } from '../../../generated/prisma/enums'
import {
  createExpoPushClient,
  defaultExpoPushRequestTimeoutMs,
  ExpoPushTransientError,
  isDeviceNotRegisteredError,
  type ExpoPushClientOptions,
} from './expo-client'
import type {
  CheckPushReceiptsMetrics,
  EnqueuePushNotificationInput,
  NotificationOperations,
  ProcessPushOutboxMetrics,
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
}

type ReceiptDelivery = {
  id: string
  receiptCheckAttempts: number
}

export function createNotificationOperations(context: PushServiceContext): NotificationOperations {
  return {
    registerToken: (userId, input) => registerPushToken(context.prisma, userId, input),
    unregisterToken: (userId, input) => unregisterPushToken(context.prisma, userId, input),
    cleanupTokens: async (userId, expoPushTokens) => {
      if (expoPushTokens.length === 0) return
      await context.prisma.pushToken.deleteMany({
        where: { expoPushToken: { in: expoPushTokens }, userId },
      })
    },
    hasActiveToken: (userId) => hasActivePushToken(context.prisma, userId),
    enqueueAndProcess: (input) => enqueueAndProcessPushNotification(context, input),
    processOutbox: (options) => processPushOutbox(context, options),
    checkReceipts: (options) => checkPushReceipts(context, options),
  }
}

export async function registerPushToken(
  prisma: DbClient,
  userId: string,
  input: RegisterPushTokenRequest,
) {
  await prisma.pushToken.upsert({
    where: {
      expoPushToken: input.expoPushToken,
    },
    update: {
      deviceId: input.deviceId,
      disabledAt: null,
      platform: input.platform ?? null,
      userId,
    },
    create: {
      deviceId: input.deviceId,
      expoPushToken: input.expoPushToken,
      platform: input.platform ?? null,
      userId,
    },
  })
}

export async function unregisterPushToken(
  prisma: DbClient,
  userId: string,
  input: UnregisterPushTokenRequest,
) {
  await prisma.pushToken.deleteMany({
    where: {
      userId,
      ...(input.expoPushToken ? { expoPushToken: input.expoPushToken } : {}),
    },
  })
}

export async function hasActivePushToken(prisma: DbClient, userId: string) {
  const count = await prisma.pushToken.count({
    where: {
      disabledAt: null,
      userId,
    },
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

export async function enqueueAndProcessPushNotification(
  context: PushServiceContext,
  input: EnqueuePushNotificationInput,
) {
  const result = await enqueuePushNotification(context.prisma, input)
  await processPushOutbox(context, {
    maxLoops: 1,
    onlyIds: [result.id],
  })
  return result
}

export function buildTestPushInput(userId: string, payload: TestPushNotificationPayload) {
  return {
    body: payload.body,
    data: {
      href: payload.href,
      kind: 'test_push',
    },
    dedupeKey: `test-push:${userId}:${crypto.randomUUID()}`,
    title: payload.title,
    userId,
  } satisfies EnqueuePushNotificationInput
}

export async function processPushOutbox(
  context: PushServiceContext,
  options: {
    limit?: number
    maxLoops?: number
    maxRuntimeMs?: number
    now?: Date
    onlyIds?: string[]
    processingStaleMs?: number
  } = {},
): Promise<ProcessPushOutboxMetrics> {
  const now = options.now ?? new Date()
  const limit = options.limit ?? context.env.PUSH_OUTBOX_PROCESS_LIMIT ?? defaultProcessLimit
  const maxLoops = options.maxLoops ?? context.env.PUSH_OUTBOX_PROCESS_MAX_LOOPS ?? defaultProcessMaxLoops
  const maxRuntimeMs =
    options.maxRuntimeMs ?? context.env.PUSH_OUTBOX_PROCESS_MAX_RUNTIME_MS ?? defaultProcessMaxRuntimeMs
  const processingStaleMs = Math.max(
    options.processingStaleMs ??
      context.env.PUSH_OUTBOX_PROCESSING_STALE_MS ??
      defaultProcessingStaleMs,
    defaultExpoPushRequestTimeoutMs * 2,
  )
  const startedAt = Date.now()
  const metrics = emptyOutboxMetrics()

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
      scheduledFor: now,
      status: PushNotificationOutboxStatus.pending,
    },
  })
  metrics.requeuedStale = requeued.count

  while (metrics.loops < maxLoops && Date.now() - startedAt < maxRuntimeMs) {
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
      mergeOutboxMetrics(metrics, await processOutboxItem(context, item, now))
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
  options: {
    limit?: number
    now?: Date
  } = {},
): Promise<CheckPushReceiptsMetrics> {
  const now = options.now ?? new Date()
  const limit = options.limit ?? context.env.PUSH_RECEIPT_CHECK_LIMIT ?? defaultReceiptCheckLimit
  const deliveries = await context.prisma.pushDelivery.findMany({
    where: {
      receiptCheckedAt: null,
      OR: [
        {
          receiptNextCheckAt: null,
        },
        {
          receiptNextCheckAt: {
            lte: now,
          },
        },
      ],
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
      receiptCheckAttempts: true,
      ticketId: true,
      userId: true,
    },
    take: limit,
  })

  if (deliveries.length === 0) {
    return {
      checked: 0,
      delivered: 0,
      failed: 0,
      tokensDisabled: 0,
    }
  }

  const client = createExpoPushClient({
    accessToken: context.env.EXPO_PUSH_ACCESS_TOKEN,
    ...context.pushClientOptions,
  })
  const receiptByTicketId = await client.receipts(
    deliveries.map((delivery) => delivery.ticketId).filter((ticketId): ticketId is string => Boolean(ticketId)),
  )
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

    metrics.checked += 1

    if (receipt.status === 'ok') {
      await context.prisma.pushDelivery.update({
        where: {
          id: delivery.id,
        },
        data: {
          providerStatus: receipt.status,
          receiptCheckAttempts: {
            increment: 1,
          },
          receiptCheckedAt: now,
          receiptNextCheckAt: null,
          status: PushDeliveryStatus.delivered,
        },
      })
      metrics.delivered += 1
      continue
    }

    if (
      isRetryableProviderError(receipt.details?.error) &&
      delivery.pushTokenId &&
      shouldRetryOutbox(delivery.outbox.attempts)
    ) {
      await context.prisma.$transaction(async (tx) => {
        await tx.pushDelivery.delete({
          where: {
            id: delivery.id,
          },
        })
        await tx.pushNotificationOutbox.update({
          where: {
            id: delivery.outboxId,
          },
          data: {
            lastError: receipt.message ?? 'Retryable Expo push receipt failed',
            processedAt: null,
            scheduledFor: outboxRetryAt(delivery.outbox.attempts, now),
            status: PushNotificationOutboxStatus.pending,
          },
        })
      })
      metrics.failed += 1
      continue
    }

    await context.prisma.pushDelivery.update({
      where: {
        id: delivery.id,
      },
      data: {
        errorMessage: receipt.message ?? 'Expo push receipt failed',
        providerErrorCode: receipt.details?.error,
        providerStatus: receipt.status,
        receiptCheckAttempts: {
          increment: 1,
        },
        receiptCheckedAt: now,
        receiptNextCheckAt: null,
        status: PushDeliveryStatus.failed,
      },
    })
    metrics.failed += 1

    if (delivery.expoPushToken && isDeviceNotRegisteredError(receipt)) {
      metrics.tokensDisabled += await disableToken(context.prisma, delivery.userId, delivery.expoPushToken)
    }
  }

  return metrics
}

async function processOutboxItem(
  context: PushServiceContext,
  item: OutboxItem,
  now: Date,
): Promise<ProcessPushOutboxMetrics> {
  if (!(await claimPushOutboxItemForProcessing(context.prisma, item.id, now))) {
    return emptyOutboxMetrics()
  }

  const metrics = emptyOutboxMetrics()
  metrics.processed = 1

  const tokens = await context.prisma.pushToken.findMany({
    where: {
      disabledAt: null,
      userId: item.userId,
    },
    select: {
      expoPushToken: true,
      id: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  if (tokens.length === 0) {
    if (await hasAnyDelivery(context.prisma, item.id)) {
      return completeOutboxFromDeliveries(context.prisma, item, now, metrics)
    }

    await context.prisma.pushDelivery.create({
      data: {
        errorMessage: 'No active Expo push token registered',
        outboxId: item.id,
        status: PushDeliveryStatus.skipped,
        userId: item.userId,
      },
    })
    await markOutboxComplete(context.prisma, item.id, {
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
            in: tokens.map((token) => token.id),
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
  const tokensToSend = tokens.filter((token) => !existingDeliveryTokenIds.has(token.id))

  if (tokensToSend.length === 0) {
    return completeOutboxFromDeliveries(context.prisma, item, now, metrics)
  }

  const client = createExpoPushClient({
    accessToken: context.env.EXPO_PUSH_ACCESS_TOKEN,
    ...context.pushClientOptions,
  })
  let sentCount = 0
  let failedCount = 0
  const retryableTicketFailures: Array<{ message: string; token: PushTokenRecord }> = []

  for (let index = 0; index < tokensToSend.length; index += expoSendBatchSize) {
    const batchTokens = tokensToSend.slice(index, index + expoSendBatchSize)

    try {
      if (!(await touchOutboxProcessing(context.prisma, item.id))) {
        metrics.failed = 1
        metrics.transientFailed = 1
        return metrics
      }

      const tickets = await client.send(messagesForTokens(item, batchTokens))

      for (const [ticketIndex, ticket] of tickets.entries()) {
        const token = batchTokens[ticketIndex]
        if (!token) continue

        if (ticket.status === 'ok') {
          sentCount += 1
          await context.prisma.pushDelivery.create({
            data: {
              expoPushToken: token.expoPushToken,
              outboxId: item.id,
              pushTokenId: token.id,
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
        await context.prisma.pushDelivery.create({
          data: {
            errorMessage: ticket.message ?? 'Expo push ticket failed',
            expoPushToken: token.expoPushToken,
            outboxId: item.id,
            providerErrorCode: ticket.details?.error,
            providerStatus: ticket.status,
            pushTokenId: token.id,
            status: PushDeliveryStatus.failed,
            userId: item.userId,
          },
        })

        if (isDeviceNotRegisteredError(ticket)) {
          await disableToken(context.prisma, item.userId, token.expoPushToken)
        }
      }
    } catch (error) {
      const nextAttempts = item.attempts + 1
      const message = errorMessage(error)

      if (error instanceof ExpoPushTransientError && shouldRetryOutbox(nextAttempts)) {
        await markOutboxComplete(context.prisma, item.id, {
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

      await recordBatchFailure(context.prisma, item, tokensToSend.slice(index), message)
      await markOutboxComplete(context.prisma, item.id, {
        attempts: nextAttempts,
        lastError: message,
        processedAt: now,
        status: await completedOutboxStatus(context.prisma, item.id),
      })
      metrics.failed = 1
      return metrics
    }
  }

  if (retryableTicketFailures.length > 0) {
    const nextAttempts = item.attempts + 1
    const message = `${retryableTicketFailures.length} retryable Expo push ticket(s) failed`

    if (shouldRetryOutbox(nextAttempts)) {
      await markOutboxComplete(context.prisma, item.id, {
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

    await recordBatchFailure(
      context.prisma,
      item,
      retryableTicketFailures.map((failure) => failure.token),
      message,
    )
    failedCount += retryableTicketFailures.length
  }

  const hasSuccess = sentCount > 0 || (await hasSuccessfulDelivery(context.prisma, item.id))
  await markOutboxComplete(context.prisma, item.id, {
    attempts: item.attempts + 1,
    lastError: failedCount > 0 ? `${failedCount} Expo push ticket(s) failed` : null,
    processedAt: now,
    status: hasSuccess ? PushNotificationOutboxStatus.sent : PushNotificationOutboxStatus.failed,
  })
  metrics.sent = hasSuccess ? 1 : 0
  metrics.failed = metrics.sent > 0 ? 0 : 1
  return metrics
}

export async function claimPushOutboxItemForProcessing(prisma: DbClient, id: string, now: Date) {
  const lock = await prisma.pushNotificationOutbox.updateMany({
    where: {
      id,
      scheduledFor: {
        lte: now,
      },
      status: PushNotificationOutboxStatus.pending,
    },
    data: {
      status: PushNotificationOutboxStatus.processing,
    },
  })
  return lock.count === 1
}

async function recordBatchFailure(
  prisma: DbClient,
  item: OutboxItem,
  tokens: PushTokenRecord[],
  message: string,
) {
  await Promise.all(
    tokens.map((token) =>
      prisma.pushDelivery.create({
        data: {
          errorMessage: message,
          expoPushToken: token.expoPushToken,
          outboxId: item.id,
          pushTokenId: token.id,
          status: PushDeliveryStatus.failed,
          userId: item.userId,
        },
      }),
    ),
  )
}

async function touchOutboxProcessing(prisma: DbClient, id: string) {
  const result = await prisma.pushNotificationOutbox.updateMany({
    where: {
      id,
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
  now: Date,
  metrics: ProcessPushOutboxMetrics,
) {
  const status = await completedOutboxStatus(prisma, item.id)
  await markOutboxComplete(prisma, item.id, {
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
  data: {
    attempts: number
    lastError: string | null
    processedAt: Date | null
    scheduledFor?: Date
    status: PushNotificationOutboxStatus
  },
) {
  await prisma.pushNotificationOutbox.update({
    where: {
      id,
    },
    data,
  })
}

async function disableToken(prisma: DbClient, userId: string, expoPushToken: string) {
  const result = await prisma.pushToken.updateMany({
    where: {
      disabledAt: null,
      expoPushToken,
      userId,
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
    await prisma.pushDelivery.update({
      where: {
        id: delivery.id,
      },
      data: {
        errorMessage: 'Expo push receipt was unavailable after repeated checks',
        receiptCheckAttempts: nextAttempts,
        receiptCheckedAt: now,
        receiptNextCheckAt: null,
        status: PushDeliveryStatus.failed,
      },
    })
    metrics.failed += 1
    return
  }

  await prisma.pushDelivery.update({
    where: {
      id: delivery.id,
    },
    data: {
      receiptCheckAttempts: nextAttempts,
      receiptNextCheckAt: nextReceiptCheckAt(nextAttempts, now),
    },
  })
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
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
