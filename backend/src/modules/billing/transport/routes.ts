import {
  apiErrorSchema,
  appStoreReconcileRequestSchema,
  appStoreOfferCodeRedemptionResponseSchema,
  appStoreTransactionRequestSchema,
  appStoreWebhookRequestSchema,
  googlePlayReconcileRequestSchema,
  googlePlayTransactionRequestSchema,
  iapEntitlementResponseSchema,
  iapMutationResponseSchema,
} from '@web-app-demo/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { Context } from 'hono'

import type { AuthenticatedPrincipal } from '../../auth'
import type { BillingService } from '../application/billing-service'
import { executeBilling } from './errors'

type AuthenticateAccessToken = (
  accessToken: string | undefined,
) => Promise<AuthenticatedPrincipal>

const errorResponseContent = {
  'application/json': {
    schema: apiErrorSchema,
  },
}

const entitlementRoute = createRoute({
  method: 'get',
  path: '/entitlement',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: iapEntitlementResponseSchema,
        },
      },
      description: 'Current premium subscription entitlement',
    },
    401: {
      content: errorResponseContent,
      description: 'Unauthorized',
    },
  },
})

const transactionRoute = createRoute({
  method: 'post',
  path: '/app-store/transactions',
  request: {
    body: {
      content: {
        'application/json': {
          schema: appStoreTransactionRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: iapMutationResponseSchema,
        },
      },
      description: 'Verified and stored App Store transaction',
    },
    400: {
      content: errorResponseContent,
      description: 'Invalid App Store transaction',
    },
    401: {
      content: errorResponseContent,
      description: 'Unauthorized',
    },
    403: {
      content: errorResponseContent,
      description: 'Transaction belongs to another user',
    },
    503: {
      content: errorResponseContent,
      description: 'App Store IAP verification is not configured',
    },
  },
})

const googlePlayTransactionRoute = createRoute({
  method: 'post',
  path: '/google-play/transactions',
  request: {
    body: {
      content: {
        'application/json': {
          schema: googlePlayTransactionRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: iapMutationResponseSchema,
        },
      },
      description: 'Verified and stored Google Play transaction',
    },
    400: {
      content: errorResponseContent,
      description: 'Invalid Google Play transaction',
    },
    401: {
      content: errorResponseContent,
      description: 'Unauthorized',
    },
    403: {
      content: errorResponseContent,
      description: 'Transaction belongs to another user',
    },
    503: {
      content: errorResponseContent,
      description: 'Google Play IAP verification is not configured',
    },
  },
})

const offerCodeRedemptionRoute = createRoute({
  method: 'post',
  path: '/app-store/offer-code-redemption',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: appStoreOfferCodeRedemptionResponseSchema,
        },
      },
      description: 'Short-lived token for user-initiated App Store offer code redemption',
    },
    401: {
      content: errorResponseContent,
      description: 'Unauthorized',
    },
  },
})

const reconcileRoute = createRoute({
  method: 'post',
  path: '/app-store/reconcile',
  request: {
    body: {
      content: {
        'application/json': {
          schema: appStoreReconcileRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: iapMutationResponseSchema,
        },
      },
      description: 'Reconciled App Store subscription state',
    },
    400: {
      content: errorResponseContent,
      description: 'Invalid reconcile payload',
    },
    401: {
      content: errorResponseContent,
      description: 'Unauthorized',
    },
    403: {
      content: errorResponseContent,
      description: 'Transaction belongs to another user',
    },
    503: {
      content: errorResponseContent,
      description: 'App Store IAP verification is not configured',
    },
  },
})

const googlePlayReconcileRoute = createRoute({
  method: 'post',
  path: '/google-play/reconcile',
  request: {
    body: {
      content: {
        'application/json': {
          schema: googlePlayReconcileRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: iapMutationResponseSchema,
        },
      },
      description: 'Reconciled Google Play subscription state',
    },
    400: {
      content: errorResponseContent,
      description: 'Invalid reconcile payload',
    },
    401: {
      content: errorResponseContent,
      description: 'Unauthorized',
    },
    403: {
      content: errorResponseContent,
      description: 'Transaction belongs to another user',
    },
    503: {
      content: errorResponseContent,
      description: 'Google Play IAP verification is not configured',
    },
  },
})

const webhookRoute = createRoute({
  method: 'post',
  path: '/app-store',
  request: {
    body: {
      content: {
        'application/json': {
          schema: appStoreWebhookRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Recorded App Store Server Notification V2 payload',
    },
    400: {
      content: errorResponseContent,
      description: 'Invalid App Store notification',
    },
    503: {
      content: errorResponseContent,
      description: 'App Store IAP verification is not configured',
    },
  },
})

export function createIapRoutes(input: {
  authenticateAccessToken: AuthenticateAccessToken
  service: BillingService
}) {
  const routes = new OpenAPIHono()

  routes.openapi(entitlementRoute, async (c) => {
    const user = await requireUser(c, input.authenticateAccessToken)
    return c.json({
      subscription: await executeBilling(() => input.service.getSubscription(user.id)),
    }, 200)
  })

  routes.openapi(transactionRoute, async (c) => {
    const user = await requireUser(c, input.authenticateAccessToken)
    const payload = c.req.valid('json')
    const subscription = await executeBilling(() =>
      input.service.ingestAppStore({
        userId: user.id,
        signedTransactionInfo: payload.signedTransactionInfo,
        signedRenewalInfo: payload.signedRenewalInfo,
        offerCodeRedemptionToken: payload.offerCodeRedemptionToken,
      }),
    )

    return c.json({ subscription }, 200)
  })

  routes.openapi(googlePlayTransactionRoute, async (c) => {
    const user = await requireUser(c, input.authenticateAccessToken)
    const payload = c.req.valid('json')
    const subscription = await executeBilling(() =>
      input.service.ingestGooglePlay({
        basePlanId: payload.basePlanId,
        productId: payload.productId,
        purchaseToken: payload.purchaseToken,
        userId: user.id,
      }),
    )

    return c.json({ subscription }, 200)
  })

  routes.openapi(offerCodeRedemptionRoute, async (c) => {
    const user = await requireUser(c, input.authenticateAccessToken)
    return c.json({
      token: await executeBilling(() => input.service.createOfferCodeRedemption(user.id)),
    }, 200)
  })

  routes.openapi(reconcileRoute, async (c) => {
    const user = await requireUser(c, input.authenticateAccessToken)
    const payload = c.req.valid('json')
    const subscription = await executeBilling(() =>
      input.service.reconcileAppStore({
        userId: user.id,
        signedTransactions: payload.signedTransactions,
        originalTransactionIds: payload.originalTransactionIds,
      }),
    )

    return c.json({ subscription }, 200)
  })

  routes.openapi(googlePlayReconcileRoute, async (c) => {
    const user = await requireUser(c, input.authenticateAccessToken)
    const payload = c.req.valid('json')
    const subscription = await executeBilling(() =>
      input.service.reconcileGooglePlay({
        purchases: payload.purchases,
        userId: user.id,
      }),
    )

    return c.json({ subscription }, 200)
  })

  return routes
}

export function createAppStoreWebhookRoutes(service: BillingService) {
  const routes = new OpenAPIHono()

  routes.openapi(webhookRoute, async (c) => {
    const payload = c.req.valid('json')
    const result = await executeBilling(() =>
      service.processAppStoreWebhook(payload.signedPayload),
    )

    return c.json({ ok: true, duplicate: result.duplicate }, 200)
  })

  return routes
}

async function requireUser(c: Context, authenticateAccessToken: AuthenticateAccessToken) {
  const authorization = c.req.header('Authorization')
  const accessToken = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  return authenticateAccessToken(accessToken)
}
