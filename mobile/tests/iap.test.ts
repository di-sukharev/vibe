import { expect, test } from 'bun:test';

const {
  buildReconcilePayloadFromPurchases,
  buildGooglePlayReconcilePayloadFromPurchases,
  buildSubscriptionPurchaseRequest,
  extractGooglePlayPurchaseToken,
  extractSignedTransactionInfo,
  friendlyIapErrorMessage,
  iapDiagnosticPayload,
  iapErrorMessage,
  ingestAndFinishPurchase,
  introOfferLabel,
  isNetworkIapError,
  isRecoverableIapError,
  isRetryableIapError,
  isUserCancelledPurchaseError,
  purchaseButtonLabel,
  retryIapOperation,
  shouldSuppressPostSuccessError,
  selectGooglePlaySubscriptionOffer,
  validateAppStorePurchaseForIngest,
  validateGooglePlayPurchaseForIngest,
} = await import('../src/lib/iap-utils');
const { ApiRequestError } = await import('../src/lib/api');

const activeSubscription = {
  entitlement: 'premium' as const,
  isActive: true,
  state: 'active' as const,
  platform: 'ios' as const,
  productId: 'premium_monthly',
  originalTransactionId: 'original-1',
  transactionId: 'transaction-1',
  expiresAt: '2026-06-19T00:00:00.000Z',
  willAutoRenew: true,
  updatedAt: '2026-05-19T00:00:00.000Z',
};

test('builds iOS subscription purchase requests with backend-owned finishing', () => {
  expect(buildSubscriptionPurchaseRequest('premium_monthly', '018fd4f2-1f3a-7c88-bc49-333333333333')).toEqual({
    type: 'subs',
    request: {
      apple: {
        sku: 'premium_monthly',
        appAccountToken: '018fd4f2-1f3a-7c88-bc49-333333333333',
        andDangerouslyFinishTransactionAutomatically: false,
      },
    },
  });

  expect(() => buildSubscriptionPurchaseRequest('premium_monthly', 'user-uuid')).toThrow('UUID');
});

test('builds Android subscription purchase requests with Google offer tokens and obfuscated ids', () => {
  expect(
    buildSubscriptionPurchaseRequest({
      appAccountToken: '018fd4f2-1f3a-7c88-bc49-333333333333',
      offerToken: 'offer-token',
      platform: 'android',
      productId: 'premium',
    }),
  ).toEqual({
    type: 'subs',
    request: {
      google: {
        skus: ['premium'],
        obfuscatedAccountId: '018fd4f2-1f3a-7c88-bc49-333333333333',
        obfuscatedProfileId: '018fd4f2-1f3a-7c88-bc49-333333333333',
        subscriptionOffers: [{ sku: 'premium', offerToken: 'offer-token' }],
      },
    },
  });
});

test('extracts signed App Store transaction info from purchase tokens', () => {
  expect(extractSignedTransactionInfo({ purchaseToken: ' signed-jws ' } as never)).toBe('signed-jws');
  expect(extractSignedTransactionInfo({ purchaseToken: '' } as never)).toBeNull();
});

test('extracts Google Play purchase tokens from purchase callbacks', () => {
  expect(extractGooglePlayPurchaseToken({ purchaseToken: ' purchase-token ' } as never)).toBe('purchase-token');
  expect(extractGooglePlayPurchaseToken({ purchaseToken: '' } as never)).toBeNull();
});

test('builds restore reconcile payloads from available App Store purchases', () => {
  expect(
    buildReconcilePayloadFromPurchases([
      { purchaseToken: 'signed-1' },
      { purchaseToken: null },
      { purchaseToken: 'signed-2' },
      { purchaseToken: 'signed-1' },
    ] as never, ['original-1', 'original-1']),
  ).toEqual({ signedTransactions: ['signed-1', 'signed-2'], originalTransactionIds: ['original-1'] });
});

test('builds Google Play reconcile payloads from available purchases', () => {
  const basePlanIds = new Map([['premium', 'monthly']]);

  expect(
    buildGooglePlayReconcilePayloadFromPurchases(
      [
        { productId: 'premium', purchaseState: 'purchased', purchaseToken: 'token-1', store: 'google' },
        { productId: 'premium', purchaseState: 'purchased', purchaseToken: 'token-1', store: 'google' },
        { productId: 'premium', purchaseState: 'pending', purchaseToken: 'token-2', store: 'google' },
        { productId: 'premium', purchaseState: 'purchased', purchaseToken: 'signed-apple', store: 'apple' },
      ] as never,
      basePlanIds,
    ),
  ).toEqual({
    purchases: [
      {
        basePlanId: 'monthly',
        productId: 'premium',
        purchaseToken: 'token-1',
      },
    ],
  });
});

test('finishes purchases only after backend ingest succeeds', async () => {
  const successfulFinishCalls: unknown[] = [];
  const failingFinishCalls: unknown[] = [];

  await expect(
    ingestAndFinishPurchase({
      purchase: { purchaseToken: 'signed-jws' } as never,
      ingest: async () => ({ subscription: activeSubscription }),
      finish: async (purchase) => {
        successfulFinishCalls.push(purchase);
      },
    }),
  ).resolves.toEqual({ finishError: null, subscription: activeSubscription });

  await expect(
    ingestAndFinishPurchase({
      purchase: { purchaseToken: 'signed-jws' } as never,
      ingest: async () => {
        throw new Error('backend rejected purchase');
      },
      finish: async (purchase) => {
        failingFinishCalls.push(purchase);
      },
    }),
  ).rejects.toThrow('backend rejected purchase');

  expect(successfulFinishCalls).toHaveLength(1);
  expect(failingFinishCalls).toHaveLength(0);
});

test('retries transient finish failures after backend ingest succeeds', async () => {
  const finishCalls: unknown[] = [];

  await expect(
    ingestAndFinishPurchase({
      purchase: { purchaseToken: 'signed-jws' } as never,
      ingest: async () => ({ subscription: activeSubscription }),
      finish: async (purchase) => {
        finishCalls.push(purchase);
        if (finishCalls.length === 1) {
          throw { code: 'service-error' };
        }
      },
    }),
  ).resolves.toEqual({ finishError: null, subscription: activeSubscription });

  expect(finishCalls).toHaveLength(2);
});

test('returns verified subscriptions even when post-ingest finish fails', async () => {
  const finishError = new Error('finish failed');
  const result = await ingestAndFinishPurchase({
    purchase: { purchaseToken: 'signed-jws' } as never,
    ingest: async () => ({ subscription: activeSubscription }),
    finish: async () => {
      throw finishError;
    },
  });

  expect(result).toEqual({
    finishError,
    subscription: activeSubscription,
  });
});

test('recognizes user-cancelled purchase errors without surfacing them as failures', () => {
  expect(isUserCancelledPurchaseError({ code: 'user-cancelled' })).toBe(true);
  expect(isUserCancelledPurchaseError({ code: 'E_USER_CANCELLED' })).toBe(true);
  expect(isUserCancelledPurchaseError(new Error('User cancel'))).toBe(false);
  expect(isUserCancelledPurchaseError(new Error('User cancelled purchase'))).toBe(true);
  expect(isUserCancelledPurchaseError(new Error('Purchase cancelled by user'))).toBe(true);
  expect(isUserCancelledPurchaseError(new Error('Payment cancelled'))).toBe(false);
  expect(isUserCancelledPurchaseError({ code: 'network-error' })).toBe(false);
  expect(isUserCancelledPurchaseError(new Error('Cannot complete purchase'))).toBe(false);
});

test('classifies retryable IAP errors and returns friendly messages', async () => {
  expect(isRetryableIapError({ code: 'network-error' })).toBe(true);
  expect(isRetryableIapError({ code: 'E_SERVICE_ERROR' })).toBe(true);
  expect(isRetryableIapError({ code: 'SERVICE_ERROR' })).toBe(true);
  expect(isNetworkIapError({ code: 'billing-unavailable' })).toBe(true);
  expect(isRecoverableIapError({ code: 'query-product' })).toBe(true);
  expect(isRecoverableIapError({ code: 'init-connection' })).toBe(true);
  expect(isRetryableIapError({ code: 'billing-unavailable' })).toBe(false);
  expect(isRetryableIapError({ code: 'init-connection' })).toBe(false);
  expect(isRetryableIapError({ code: 'query-product' })).toBe(false);
  expect(isRetryableIapError({ code: 'item-unavailable' })).toBe(false);
  expect(friendlyIapErrorMessage({ code: 'item-unavailable' })).toContain('not available');
  expect(friendlyIapErrorMessage({ code: 'query-product' })).toContain('temporarily unavailable');
  expect(friendlyIapErrorMessage({ code: 'init-connection' })).toContain('temporarily unavailable');
  expect(friendlyIapErrorMessage({ code: 'user-error' })).toContain('payment settings');
  expect(friendlyIapErrorMessage({ code: 'E_USER_ERROR' })).toContain('payment settings');
  expect(friendlyIapErrorMessage({ code: 'UserError' })).toContain('payment settings');

  let attempts = 0;
  const delays: number[] = [];
  await expect(
    retryIapOperation(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw { code: 'service-error' };
        }
        return 'ok';
      },
      {
        attempts: 3,
        baseDelayMs: 10,
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    ),
  ).resolves.toBe('ok');
  expect(attempts).toBe(3);
  expect(delays).toEqual([10, 20]);

  attempts = 0;
  await expect(
    retryIapOperation(
      async () => {
        attempts += 1;
        throw { code: 'billing-unavailable' };
      },
      {
        attempts: 3,
        sleep: async () => undefined,
      },
    ),
  ).rejects.toEqual({ code: 'billing-unavailable' });
  expect(attempts).toBe(1);
});

test('maps backend IAP errors and store errors to user-facing messages', () => {
  expect(iapErrorMessage(new ApiRequestError(503, 'IAP_NOT_CONFIGURED', 'server not configured'))).toBe(
    'Subscriptions are not configured on the server yet.',
  );
  expect(iapErrorMessage(new ApiRequestError(400, 'IAP_INVALID_TRANSACTION', 'invalid'))).toContain(
    'could not be verified',
  );
  expect(iapErrorMessage(new ApiRequestError(409, 'IAP_OWNERSHIP_MISMATCH', 'owned elsewhere'))).toContain(
    'linked to another account',
  );
  expect(iapErrorMessage(new ApiRequestError(500, 'INTERNAL_ERROR', 'backend failed'))).toBe('backend failed');
  expect(iapErrorMessage({ code: 'network-error' })).toBe(
    'The store is temporarily unavailable. Check your connection and try again.',
  );
  expect(iapErrorMessage({ code: 'deferred-payment' })).toBe(
    'Purchase is pending approval. Premium will unlock after the store approves it.',
  );
  expect(iapErrorMessage({ code: 'user-error' })).toBe(
    'The store could not complete the purchase. Check your store payment settings and try again.',
  );
});

test('builds structured IAP diagnostics without depending on React provider state', () => {
  expect(
    iapDiagnosticPayload(
      {
        code: 'network-error',
        debugMessage: 'StoreKit request timed out',
        message: 'Network down',
        platform: 'ios',
        productId: 'premium_monthly',
        responseCode: 2,
        underlyingError: new Error('NSURLErrorDomain -1009'),
      },
      'android',
    ),
  ).toEqual({
    code: 'network-error',
    debugMessage: 'StoreKit request timed out',
    message: 'Network down',
    network: true,
    platform: 'ios',
    productId: 'premium_monthly',
    responseCode: 2,
    retryable: true,
    underlyingError: 'NSURLErrorDomain -1009',
  });
  expect(iapDiagnosticPayload('plain diagnostic', 'ios')).toEqual({
    code: null,
    debugMessage: undefined,
    message: 'plain diagnostic',
    network: false,
    platform: 'ios',
    productId: undefined,
    responseCode: undefined,
    retryable: false,
    underlyingError: undefined,
  });
});

test('suppresses short-lived StoreKit noise after successful purchase', () => {
  const lastPurchaseSuccessAt = 1_000;

  expect(shouldSuppressPostSuccessError({ code: 'service-error' }, lastPurchaseSuccessAt, 5_999)).toBe(true);
  expect(shouldSuppressPostSuccessError({ code: 'service-error' }, lastPurchaseSuccessAt, 6_000)).toBe(false);
  expect(shouldSuppressPostSuccessError({ code: 'network-error' }, lastPurchaseSuccessAt, 2_000)).toBe(false);
  expect(shouldSuppressPostSuccessError({ code: 'service-error' }, null, 2_000)).toBe(false);
});

test('validates App Store purchases before backend ingest', () => {
  expect(
    validateAppStorePurchaseForIngest({
      purchaseToken: 'signed-jws',
      purchaseState: 'purchased',
      store: 'apple',
      transactionId: 'transaction-1',
    } as never),
  ).toEqual({
    ok: true,
    signedTransactionInfo: 'signed-jws',
    transactionKey: 'transaction-1',
  });

  expect(
    validateAppStorePurchaseForIngest({
      purchaseToken: 'signed-jws',
      purchaseState: 'pending',
      store: 'apple',
    } as never),
  ).toMatchObject({ ok: false, pending: true });

  expect(
    validateAppStorePurchaseForIngest({
      purchaseState: 'purchased',
      store: 'apple',
    } as never),
  ).toMatchObject({ ok: false, pending: false });

  expect(
    validateAppStorePurchaseForIngest({
      purchaseToken: 'signed-jws',
      purchaseState: 'purchased',
      store: 'google',
    } as never),
  ).toMatchObject({ ok: false, pending: false });

  expect(
    validateAppStorePurchaseForIngest({
      purchaseToken: 'signed-jws',
      purchaseState: 'purchased',
      store: 'unknown',
    } as never),
  ).toMatchObject({ ok: false, pending: false });

  expect(
    validateAppStorePurchaseForIngest({
      purchaseToken: 'signed-jws',
      purchaseState: 'purchased',
    } as never),
  ).toMatchObject({ ok: false, pending: false });
});

test('validates Google Play purchases before backend ingest', () => {
  expect(
    validateGooglePlayPurchaseForIngest({
      productId: 'premium',
      purchaseState: 'purchased',
      purchaseToken: 'purchase-token',
      store: 'google',
      transactionId: 'GPA.1234',
    } as never),
  ).toEqual({
    ok: true,
    productId: 'premium',
    purchaseToken: 'purchase-token',
    transactionKey: 'GPA.1234',
  });

  expect(
    validateGooglePlayPurchaseForIngest({
      productId: 'premium',
      purchaseState: 'pending',
      purchaseToken: 'purchase-token',
      store: 'google',
    } as never),
  ).toMatchObject({ ok: false, pending: true });

  expect(
    validateGooglePlayPurchaseForIngest({
      productId: 'premium',
      purchaseState: 'purchased',
      store: 'google',
    } as never),
  ).toMatchObject({ ok: false, pending: false });

  expect(
    validateGooglePlayPurchaseForIngest({
      purchaseState: 'purchased',
      purchaseToken: 'purchase-token',
      store: 'google',
    } as never),
  ).toMatchObject({ ok: false, pending: false });
});

test('selects Google Play subscription offers by configured base plan', () => {
  const product = {
    displayPrice: '$9.99',
    subscriptionOffers: [
      {
        basePlanIdAndroid: 'monthly',
        displayPrice: '$4.99/month',
        offerTokenAndroid: 'monthly-offer-token',
      },
      {
        basePlanIdAndroid: 'yearly',
        displayPrice: '$49.99/year',
        offerTokenAndroid: 'yearly-offer-token',
      },
    ],
  } as never;

  expect(selectGooglePlaySubscriptionOffer(product, 'yearly')).toEqual({
    displayPrice: '$49.99/year',
    offerToken: 'yearly-offer-token',
  });
  expect(selectGooglePlaySubscriptionOffer(product, 'weekly')).toBeNull();
  expect(
    selectGooglePlaySubscriptionOffer(
      {
        displayPrice: '$9.99',
        subscriptionOfferDetailsAndroid: [
          {
            basePlanId: 'yearly',
            offerToken: 'deprecated-offer-token',
          },
        ],
      } as never,
      'yearly',
    ),
  ).toBeNull();
});

test('formats iOS introductory offer copy by payment mode', () => {
  const baseProduct = {
    displayPrice: '$9.99',
    subscriptionOffers: [
      {
        displayPrice: '$0.00',
        paymentMode: 'free-trial',
        period: { unit: 'week' },
        periodCount: 2,
        type: 'introductory',
      },
    ],
  } as never;

  expect(introOfferLabel(baseProduct)).toBe('Eligible users may get a free trial for 2 weeks');
  expect(purchaseButtonLabel(baseProduct)).toBe('Subscribe for $9.99');
  expect(
    introOfferLabel({
      ...baseProduct,
      subscriptionOffers: [
        {
          displayPrice: '$0.99',
          paymentMode: 'pay-as-you-go',
          period: { unit: 'month' },
          periodCount: 3,
          type: 'introductory',
        },
      ],
    } as never),
  ).toBe('Eligible users may get an intro pay-as-you-go price: $0.99 for 3 months');
  expect(
    introOfferLabel({
      ...baseProduct,
      subscriptionOffers: [
        {
          displayPrice: '$19.99',
          paymentMode: 'pay-up-front',
          period: { unit: 'year' },
          periodCount: 1,
          type: 'introductory',
        },
      ],
    } as never),
  ).toBe('Eligible users may get an intro upfront price: $19.99 for first 1 year');

  expect(
    introOfferLabel({
      ...baseProduct,
      subscriptionOffers: [
        {
          displayPrice: '$4.99',
          paymentMode: 'pay-up-front',
          period: { unit: 'month' },
          periodCount: 1,
          type: 'promotional',
        },
      ],
      subscriptionInfoIOS: {
        introductoryOffer: {
          displayPrice: '$0.00',
          paymentMode: 'free-trial',
          period: { unit: 'week' },
          periodCount: 1,
        },
      },
    } as never),
  ).toBe('Eligible users may get a free trial for 1 week');
});
