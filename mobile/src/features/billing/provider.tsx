import type { SubscriptionSnapshot } from '@web-app-demo/contracts';
import {
  deepLinkToSubscriptions,
  presentCodeRedemptionSheetIOS,
  useIAP,
  type ProductSubscription,
  type Purchase,
  type PurchaseOptions,
} from 'expo-iap';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { useAuth } from '@/features/auth';
import type { BillingApiPort } from './api';
import { trackIapDiagnostic } from './iap-diagnostics';
import {
  buildReconcilePayloadFromPurchases,
  buildGooglePlayReconcilePayloadFromPurchases,
  buildSubscriptionPurchaseRequest,
  iapDiagnosticPayload,
  iapErrorMessage,
  ingestAndFinishPurchase,
  isUserCancelledPurchaseError,
  retryIapOperation,
  shouldSuppressPostSuccessError,
  selectGooglePlaySubscriptionOffer,
  sortProductsByConfiguredOrder,
  validateAppStorePurchaseForIngest,
  validateGooglePlayPurchaseForIngest,
} from './purchase-controller';
import { OfferCodeRedemptionController } from './offer-code-controller';

const iosProductIds = [
  process.env.EXPO_PUBLIC_IAP_IOS_MONTHLY_PRODUCT_ID,
  process.env.EXPO_PUBLIC_IAP_IOS_YEARLY_PRODUCT_ID,
]
  .map((productId) => productId?.trim())
  .filter((productId): productId is string => Boolean(productId));
const androidPlanConfigs = [
  {
    basePlanId: process.env.EXPO_PUBLIC_IAP_ANDROID_MONTHLY_BASE_PLAN_ID?.trim(),
    id: 'android-monthly',
    label: 'Monthly',
    productId: process.env.EXPO_PUBLIC_IAP_ANDROID_MONTHLY_PRODUCT_ID?.trim(),
  },
  {
    basePlanId: process.env.EXPO_PUBLIC_IAP_ANDROID_YEARLY_BASE_PLAN_ID?.trim(),
    id: 'android-yearly',
    label: 'Yearly',
    productId: process.env.EXPO_PUBLIC_IAP_ANDROID_YEARLY_PRODUCT_ID?.trim(),
  },
].filter(
  (plan): plan is { basePlanId: string; id: string; label: string; productId: string } =>
    Boolean(plan.productId && plan.basePlanId),
);
const androidProductIds = [...new Set(androidPlanConfigs.map((plan) => plan.productId))];
const androidPackageName = process.env.EXPO_PUBLIC_IAP_ANDROID_PACKAGE_NAME?.trim() || null;
const allIosAvailablePurchaseOptions: PurchaseOptions = {
  alsoPublishToEventListenerIOS: false,
  onlyIncludeActiveItemsIOS: false,
};

type StorePlatform = 'android' | 'ios';

type SubscriptionPlan = {
  basePlanId: string | null;
  displayName: string;
  displayPrice: string;
  id: string;
  product: ProductSubscription;
  productId: string;
};

type AppStorePurchaseValidation = Extract<ReturnType<typeof validateAppStorePurchaseForIngest>, { ok: true }>;
type GooglePlayPurchaseValidation = Extract<ReturnType<typeof validateGooglePlayPurchaseForIngest>, { ok: true }>;

type AvailablePurchasesReconciliation = {
  finishPurchases: boolean;
  hasKnownOriginalTransaction: boolean;
  id: number;
  kind: 'restore' | 'sync';
  originalTransactionIds?: string[];
  restoreError?: unknown;
};

type SubscriptionContextValue = {
  error: string | null;
  isConnected: boolean;
  isLoadingProducts: boolean;
  isManagingSubscriptions: boolean;
  isPurchasing: boolean;
  isRedeemingOfferCode: boolean;
  isRestoring: boolean;
  isSupported: boolean;
  isSyncing: boolean;
  platform: typeof Platform.OS;
  plans: SubscriptionPlan[];
  productIds: string[];
  products: ProductSubscription[];
  purchase: () => Promise<void>;
  redeemOfferCode: () => Promise<void>;
  restore: () => Promise<void>;
  manageSubscriptions: () => Promise<void>;
  selectedPlanId: string | null;
  selectedProductId: string | null;
  setSelectedPlanId: (planId: string) => void;
  setSelectedProductId: (productId: string) => void;
  subscription: SubscriptionSnapshot | null;
  sync: () => Promise<void>;
};

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

export function IapProvider({ api, children }: PropsWithChildren<{ api: BillingApiPort }>) {
  const auth = useAuth();

  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return (
      <SubscriptionContext.Provider value={unsupportedSubscriptionValue(auth.user?.subscription ?? null)}>
        {children}
      </SubscriptionContext.Provider>
    );
  }

  return <NativeIapProvider api={api} platform={Platform.OS}>{children}</NativeIapProvider>;
}

function NativeIapProvider({ api, children, platform }: PropsWithChildren<{
  api: BillingApiPort;
  platform: StorePlatform;
}>) {
  const auth = useAuth();
  const { setSubscription } = auth;
  const user = auth.user;
  const userId = user?.id ?? null;
  const productIds = platform === 'ios' ? iosProductIds : androidProductIds;
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(defaultPlanId(platform));
  const [error, setError] = useState<string | null>(null);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [isManagingSubscriptions, setIsManagingSubscriptions] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRedeemingOfferCode, setIsRedeemingOfferCode] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const iapRef = useRef<ReturnType<typeof useIAP> | null>(null);
  const inFlightReconcileKeysRef = useRef(new Set<string>());
  const purchaseRequestInFlightRef = useRef(false);
  const processingTransactionsRef = useRef(new Set<string>());
  const processedTransactionsRef = useRef(new Set<string>());
  const handledAvailablePurchasesReconciliationIdsRef = useRef(new Set<number>());
  const nextAvailablePurchasesReconciliationIdRef = useRef(0);
  const pendingAvailablePurchasesReconciliationRef = useRef<AvailablePurchasesReconciliation | null>(null);
  const pendingGooglePlayBasePlanByProductIdRef = useRef(new Map<string, string>());
  const queuedPurchaseKeysRef = useRef(new Set<string>());
  const queuedPurchasesRef = useRef<Purchase[]>([]);
  const lastPurchaseSuccessAtRef = useRef<number | null>(null);
  const offerCodeControllerRef = useRef(new OfferCodeRedemptionController());

  const queuePurchaseUntilAuthenticated = useCallback((purchase: Purchase) => {
    const queueKey = purchaseQueueKey(purchase);
    if (queueKey && queuedPurchaseKeysRef.current.has(queueKey)) return;

    if (queueKey) {
      queuedPurchaseKeysRef.current.add(queueKey);
    }
    queuedPurchasesRef.current.push(purchase);
  }, []);

  const finishPurchase = useCallback((nextPurchase: Purchase) => {
    if (!iapRef.current) {
      throw new Error('Store connection is not ready.');
    }
    return iapRef.current.finishTransaction({ purchase: nextPurchase, isConsumable: false });
  }, []);

  const ingestAndFinishAppStorePurchase = useCallback(
    (purchase: Purchase, validation: AppStorePurchaseValidation) => {
      const offerCodeRedemptionToken = offerCodeControllerRef.current.current(Date.now());

      return ingestAndFinishPurchase({
        purchase,
        signedTransactionInfo: validation.signedTransactionInfo,
        ingest: (request) =>
          api.ingestAppStoreTransaction({
            ...request,
            ...(offerCodeRedemptionToken ? { offerCodeRedemptionToken } : {}),
          }),
        finish: finishPurchase,
      });
    },
    [api, finishPurchase],
  );

  const ingestAndFinishGooglePlayPurchase = useCallback(
    async (purchase: Purchase, validation: GooglePlayPurchaseValidation) => {
      const basePlanId = pendingGooglePlayBasePlanByProductIdRef.current.get(validation.productId);
      const response = await api.ingestGooglePlayTransaction({
        productId: validation.productId,
        purchaseToken: validation.purchaseToken,
        ...(basePlanId ? { basePlanId } : {}),
      });

      try {
        await retryIapOperation(() => finishPurchase(purchase));
        pendingGooglePlayBasePlanByProductIdRef.current.delete(validation.productId);
        return { finishError: null, subscription: response.subscription };
      } catch (finishError) {
        return { finishError, subscription: response.subscription };
      }
    },
    [api, finishPurchase],
  );

  const handlePurchase = useCallback(
    async (purchase: Purchase) => {
      if (!userId) {
        queuePurchaseUntilAuthenticated(purchase);
        purchaseRequestInFlightRef.current = false;
        setIsPurchasing(false);
        return;
      }

      const validation =
        platform === 'ios'
          ? validateAppStorePurchaseForIngest(purchase)
          : validateGooglePlayPurchaseForIngest(purchase);
      if (!validation.ok) {
        if (!validation.pending) {
          reportIapDiagnostic('purchase-invalid', validation.message);
        }
        setError(validation.message);
        purchaseRequestInFlightRef.current = false;
        setIsPurchasing(false);
        return;
      }

      if (processedTransactionsRef.current.has(validation.transactionKey)) {
        purchaseRequestInFlightRef.current = false;
        setIsPurchasing(false);
        return;
      }

      if (processingTransactionsRef.current.has(validation.transactionKey)) {
        return;
      }

      processingTransactionsRef.current.add(validation.transactionKey);
      setIsPurchasing(true);
      setError(null);

      try {
        const result =
          platform === 'ios'
            ? await ingestAndFinishAppStorePurchase(purchase, validation as AppStorePurchaseValidation)
            : await ingestAndFinishGooglePlayPurchase(purchase, validation as GooglePlayPurchaseValidation);
        offerCodeControllerRef.current.clear();
        setSubscription(result.subscription);
        if (result.finishError) {
          reportIapDiagnostic('purchase-finish-error', result.finishError);
        } else {
          processedTransactionsRef.current.add(validation.transactionKey);
        }
        lastPurchaseSuccessAtRef.current = Date.now();
      } catch (caughtError) {
        reportIapDiagnostic('purchase-ingest-error', caughtError);
        setError(iapErrorMessage(caughtError));
      } finally {
        purchaseRequestInFlightRef.current = false;
        processingTransactionsRef.current.delete(validation.transactionKey);
        setIsPurchasing(false);
      }
    },
    [
      ingestAndFinishAppStorePurchase,
      ingestAndFinishGooglePlayPurchase,
      platform,
      queuePurchaseUntilAuthenticated,
      setSubscription,
      userId,
    ],
  );

  const iap = useIAP({
    onPurchaseSuccess: (purchase) => {
      void handlePurchase(purchase);
    },
    onPurchaseError: (purchaseError) => {
      purchaseRequestInFlightRef.current = false;
      setIsPurchasing(false);
      if (!isUserCancelledPurchaseError(purchaseError)) {
        if (shouldSuppressPostSuccessError(purchaseError, lastPurchaseSuccessAtRef.current)) {
          return;
        }
        reportIapDiagnostic('purchase-error', purchaseError);
        setError(iapErrorMessage(purchaseError));
      }
    },
    onError: (caughtError) => {
      if (isUserCancelledPurchaseError(caughtError)) {
        return;
      }
      reportIapDiagnostic('iap-error', caughtError);
      setError(iapErrorMessage(caughtError));
    },
  });
  iapRef.current = iap;
  const {
    availablePurchases,
    connected,
    fetchProducts,
    getAvailablePurchases,
    requestPurchase,
    restorePurchases,
    subscriptions,
  } = iap;

  const loadProducts = useCallback(async () => {
    if (productIds.length === 0) {
      setError('Subscription product IDs are not configured.');
      return;
    }

    setIsLoadingProducts(true);
    setError(null);

    try {
      await retryIapOperation(() => fetchProducts({ skus: productIds, type: 'subs' }));
    } catch (caughtError) {
      reportIapDiagnostic('product-fetch-error', caughtError);
      setError(iapErrorMessage(caughtError));
    } finally {
      setIsLoadingProducts(false);
    }
  }, [fetchProducts, productIds]);

  const plans = useMemo(() => buildSubscriptionPlans(platform, subscriptions), [platform, subscriptions]);
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? null;

  const reconcileAndFinishPurchases = useCallback(
    async ({
      finishPurchases,
      originalTransactionIds,
      purchases,
    }: {
      finishPurchases: boolean;
      originalTransactionIds?: string[];
      purchases: Purchase[];
    }) => {
      let firstError: unknown = null;
      let latestSubscription: SubscriptionSnapshot | null = null;
      let pendingPurchaseMessage: string | null = null;

      if (finishPurchases) {
        for (const purchase of purchases) {
          const validation =
            platform === 'ios'
              ? validateAppStorePurchaseForIngest(purchase)
              : validateGooglePlayPurchaseForIngest(purchase);
          if (!validation.ok) {
            if (validation.pending) {
              pendingPurchaseMessage ??= validation.message;
            }
            continue;
          }

          if (
            processedTransactionsRef.current.has(validation.transactionKey) ||
            processingTransactionsRef.current.has(validation.transactionKey)
          ) {
            continue;
          }

          const reconcileKey =
            platform === 'ios'
              ? `signed:${(validation as AppStorePurchaseValidation).signedTransactionInfo}`
              : `google:${(validation as GooglePlayPurchaseValidation).productId}:${(validation as GooglePlayPurchaseValidation).purchaseToken}`;
          if (inFlightReconcileKeysRef.current.has(reconcileKey)) {
            continue;
          }

          inFlightReconcileKeysRef.current.add(reconcileKey);
          processingTransactionsRef.current.add(validation.transactionKey);

          try {
            const result =
              platform === 'ios'
                ? await ingestAndFinishAppStorePurchase(purchase, validation as AppStorePurchaseValidation)
                : await ingestAndFinishGooglePlayPurchase(purchase, validation as GooglePlayPurchaseValidation);
            offerCodeControllerRef.current.clear();
            setSubscription(result.subscription);
            latestSubscription = result.subscription;

            if (result.finishError) {
              reportIapDiagnostic('available-purchase-finish-error', result.finishError);
            } else {
              processedTransactionsRef.current.add(validation.transactionKey);
            }
          } catch (caughtError) {
            firstError ??= caughtError;
            reportIapDiagnostic('available-purchase-ingest-error', caughtError);
          } finally {
            processingTransactionsRef.current.delete(validation.transactionKey);
            inFlightReconcileKeysRef.current.delete(reconcileKey);
          }
        }
      }

      if (platform === 'android') {
        const basePlanIdsByProductId = new Map(pendingGooglePlayBasePlanByProductIdRef.current);
        const googlePayload = buildGooglePlayReconcilePayloadFromPurchases(purchases, basePlanIdsByProductId);
        const googleReconcileKey = (googlePayload.purchases ?? [])
          .map((purchase) => `google:${purchase.productId}:${purchase.purchaseToken}`)
          .join('|') || 'google:stored';

        if (inFlightReconcileKeysRef.current.has(googleReconcileKey)) {
          if (latestSubscription) return latestSubscription;
          if (firstError) throw firstError;
          return null;
        }

        inFlightReconcileKeysRef.current.add(googleReconcileKey);
        try {
          const response = await api.reconcileGooglePlayTransactions(googlePayload);
          setSubscription(response.subscription);
          if (pendingPurchaseMessage && !response.subscription.isActive) {
            setError(pendingPurchaseMessage);
          }
          return response.subscription;
        } finally {
          inFlightReconcileKeysRef.current.delete(googleReconcileKey);
        }
      }

      const originalPayload = buildReconcilePayloadFromPurchases([], originalTransactionIds);
      if (!originalPayload) {
        if (latestSubscription) return latestSubscription;
        if (firstError) throw firstError;
        if (pendingPurchaseMessage) {
          setError(pendingPurchaseMessage);
        }
        return null;
      }

      const originalReconcileKey = (originalPayload.originalTransactionIds ?? [])
        .map((transactionId) => `original:${transactionId}`)
        .join('|');

      if (inFlightReconcileKeysRef.current.has(originalReconcileKey)) {
        if (latestSubscription) return latestSubscription;
        if (firstError) throw firstError;
        return null;
      }

      inFlightReconcileKeysRef.current.add(originalReconcileKey);
      try {
        const response = await api.reconcileAppStoreTransactions(originalPayload);
        setSubscription(response.subscription);
        if (pendingPurchaseMessage && !response.subscription.isActive) {
          setError(pendingPurchaseMessage);
        }
        return response.subscription;
      } finally {
        inFlightReconcileKeysRef.current.delete(originalReconcileKey);
      }
    },
    [
      api,
      ingestAndFinishAppStorePurchase,
      ingestAndFinishGooglePlayPurchase,
      platform,
      setSubscription,
    ],
  );

  useEffect(() => {
    const pendingReconciliation = pendingAvailablePurchasesReconciliationRef.current;
    if (!pendingReconciliation) return;
    if (handledAvailablePurchasesReconciliationIdsRef.current.has(pendingReconciliation.id)) return;

    handledAvailablePurchasesReconciliationIdsRef.current.add(pendingReconciliation.id);
    pendingAvailablePurchasesReconciliationRef.current = null;

    void (async () => {
      try {
        const subscription = await reconcileAndFinishPurchases({
          finishPurchases: pendingReconciliation.finishPurchases,
          originalTransactionIds: pendingReconciliation.originalTransactionIds,
          purchases: availablePurchases,
        });

        if (pendingReconciliation.kind === 'restore') {
          if (
            pendingReconciliation.restoreError &&
            availablePurchases.length === 0 &&
            !subscription?.isActive
          ) {
            setError(iapErrorMessage(pendingReconciliation.restoreError));
          } else if (!subscription?.isActive && availablePurchases.length === 0) {
            setError(
              pendingReconciliation.restoreError
                ? iapErrorMessage(pendingReconciliation.restoreError)
                : pendingReconciliation.hasKnownOriginalTransaction
                  ? `${storeDisplayName(platform)} did not return an active subscription for this account. Please try again.`
                  : `No restorable ${storeDisplayName(platform)} subscription was found for this account.`,
            );
          }
        }
      } catch (caughtError) {
        reportIapDiagnostic(
          pendingReconciliation.kind === 'restore' ? 'restore-error' : 'subscription-sync-error',
          caughtError,
        );
        setError(iapErrorMessage(caughtError));
      } finally {
        if (pendingReconciliation.kind === 'restore') {
          setIsRestoring(false);
        } else {
          setIsSyncing(false);
        }
      }
    })();
  }, [availablePurchases, platform, reconcileAndFinishPurchases]);

  const sync = useCallback(async () => {
    if (!userId) return;

    setIsSyncing(true);
    let waitingForAvailablePurchasesState = false;

    try {
      const entitlement = await api.entitlement();
      setSubscription(entitlement.subscription);
      const originalTransactionIds = platform === 'ios' && entitlement.subscription.originalTransactionId
        ? [entitlement.subscription.originalTransactionId]
        : undefined;

      if (connected) {
        const reconciliationId = nextAvailablePurchasesReconciliationIdRef.current + 1;
        nextAvailablePurchasesReconciliationIdRef.current = reconciliationId;
        pendingAvailablePurchasesReconciliationRef.current = {
          finishPurchases: true,
          hasKnownOriginalTransaction: Boolean(originalTransactionIds),
          id: reconciliationId,
          kind: 'sync',
          originalTransactionIds,
        };

        try {
          await retryIapOperation(() =>
            platform === 'ios' ? getAvailablePurchases(allIosAvailablePurchaseOptions) : getAvailablePurchases(),
          );
          waitingForAvailablePurchasesState = true;
          return;
        } catch (storeError) {
          pendingAvailablePurchasesReconciliationRef.current = null;
          if (!originalTransactionIds && platform !== 'android') {
            throw storeError;
          }
          reportIapDiagnostic('available-purchases-error', storeError);
        }
      }

      if (platform === 'android') {
        await reconcileAndFinishPurchases({
          finishPurchases: false,
          purchases: [],
        });
        return;
      }

      if (originalTransactionIds) {
        await reconcileAndFinishPurchases({
          finishPurchases: false,
          originalTransactionIds,
          purchases: [],
        });
      }
    } catch (caughtError) {
      reportIapDiagnostic('subscription-sync-error', caughtError);
      setError(iapErrorMessage(caughtError));
    } finally {
      if (!waitingForAvailablePurchasesState) {
        setIsSyncing(false);
      }
    }
  }, [api, connected, getAvailablePurchases, platform, reconcileAndFinishPurchases, setSubscription, userId]);

  const purchase = useCallback(async () => {
    if (!user || !selectedPlan) return;
    if (purchaseRequestInFlightRef.current) return;

    if (!connected) {
      setError(`${storeDisplayName(platform)} connection is not ready yet. Please try again in a moment.`);
      return;
    }

    setIsPurchasing(true);
    purchaseRequestInFlightRef.current = true;
    setError(null);

    try {
      if (platform === 'android') {
        if (!selectedPlan.basePlanId) {
          throw new Error('Google Play base plan is not configured for this subscription.');
        }

        const offer = selectGooglePlaySubscriptionOffer(selectedPlan.product, selectedPlan.basePlanId);
        if (!offer) {
          throw new Error('Configured Google Play base plan is not available for this account.');
        }

        pendingGooglePlayBasePlanByProductIdRef.current.set(selectedPlan.productId, selectedPlan.basePlanId);
        await requestPurchase(
          buildSubscriptionPurchaseRequest({
            appAccountToken: user.id,
            offerToken: offer.offerToken,
            platform: 'android',
            productId: selectedPlan.productId,
          }),
        );
        return;
      }

      await requestPurchase(
        buildSubscriptionPurchaseRequest({
          appAccountToken: user.id,
          platform: 'ios',
          productId: selectedPlan.productId,
        }),
      );
    } catch (caughtError) {
      purchaseRequestInFlightRef.current = false;
      setIsPurchasing(false);
      if (!isUserCancelledPurchaseError(caughtError)) {
        reportIapDiagnostic('purchase-request-error', caughtError);
        setError(iapErrorMessage(caughtError));
      }
    }
  }, [connected, platform, requestPurchase, selectedPlan, user]);

  const restore = useCallback(async () => {
    if (!user) return;

    if (!connected) {
      setError(`${storeDisplayName(platform)} connection is not ready yet. Please try again in a moment.`);
      return;
    }

    setIsRestoring(true);
    setError(null);
    let waitingForAvailablePurchasesState = false;

    try {
      let restoreError: unknown = null;
      let restoreCancelled = false;
      if (platform === 'ios') {
        await restorePurchases(allIosAvailablePurchaseOptions).catch((caughtError) => {
          if (isUserCancelledPurchaseError(caughtError)) {
            restoreCancelled = true;
            return;
          }
          restoreError = caughtError;
          reportIapDiagnostic('storekit-restore-sync-error', caughtError);
        });
      }
      if (restoreCancelled) return;

      const originalTransactionIds = platform === 'ios' && user.subscription.originalTransactionId
        ? [user.subscription.originalTransactionId]
        : undefined;
      const reconciliationId = nextAvailablePurchasesReconciliationIdRef.current + 1;
      nextAvailablePurchasesReconciliationIdRef.current = reconciliationId;
      pendingAvailablePurchasesReconciliationRef.current = {
        finishPurchases: true,
        hasKnownOriginalTransaction: Boolean(originalTransactionIds),
        id: reconciliationId,
        kind: 'restore',
        originalTransactionIds,
        restoreError,
      };
      await retryIapOperation(() =>
        platform === 'ios' ? getAvailablePurchases(allIosAvailablePurchaseOptions) : getAvailablePurchases(),
      );
      waitingForAvailablePurchasesState = true;
    } catch (caughtError) {
      pendingAvailablePurchasesReconciliationRef.current = null;
      reportIapDiagnostic('restore-error', caughtError);
      setError(iapErrorMessage(caughtError));
    } finally {
      if (!waitingForAvailablePurchasesState) {
        setIsRestoring(false);
      }
    }
  }, [connected, getAvailablePurchases, platform, restorePurchases, user]);

  const redeemOfferCode = useCallback(async () => {
    if (!user) return;
    if (platform !== 'ios') {
      setError('Offer code redemption is only available for App Store subscriptions.');
      return;
    }
    if (!connected) {
      setError('App Store connection is not ready yet. Please try again in a moment.');
      return;
    }

    setIsRedeemingOfferCode(true);
    setError(null);

    try {
      const response = await api.createAppStoreOfferCodeRedemption();
      offerCodeControllerRef.current.store(response.token, Date.now());
      const presented = await presentCodeRedemptionSheetIOS();
      if (presented === false) {
        throw new Error('App Store offer code sheet could not be opened.');
      }
      await sync();
    } catch (caughtError) {
      offerCodeControllerRef.current.clear();
      if (isUserCancelledPurchaseError(caughtError)) {
        return;
      }
      reportIapDiagnostic('offer-code-redemption-error', caughtError);
      setError(iapErrorMessage(caughtError));
    } finally {
      setIsRedeemingOfferCode(false);
    }
  }, [api, connected, platform, sync, user]);

  const manageSubscriptions = useCallback(async () => {
    if (!connected) {
      setError(`${storeDisplayName(platform)} connection is not ready yet. Please try again in a moment.`);
      return;
    }

    setIsManagingSubscriptions(true);
    setError(null);

    try {
      if (platform === 'android' && !androidPackageName) {
        throw new Error('Google Play package name is not configured.');
      }
      await deepLinkToSubscriptions(
        platform === 'android'
          ? {
              packageNameAndroid: androidPackageName ?? undefined,
              skuAndroid: user?.subscription.productId ?? selectedPlan?.productId ?? undefined,
            }
          : {},
      );
    } catch (caughtError) {
      if (isUserCancelledPurchaseError(caughtError)) {
        return;
      }
      setError(iapErrorMessage(caughtError));
    } finally {
      setIsManagingSubscriptions(false);
    }
  }, [connected, platform, selectedPlan?.productId, user?.subscription.productId]);

  useEffect(() => {
    if (connected && userId) {
      void loadProducts();
    }
    void sync();
  }, [connected, loadProducts, sync, userId]);

  useEffect(() => {
    if (!userId || queuedPurchasesRef.current.length === 0) return;

    const queuedPurchases = queuedPurchasesRef.current;
    queuedPurchasesRef.current = [];
    queuedPurchaseKeysRef.current.clear();

    for (const purchase of queuedPurchases) {
      void handlePurchase(purchase);
    }
  }, [handlePurchase, userId]);

  useEffect(() => {
    if (plans.length === 0) return;

    if (!selectedPlanId || !plans.some((plan) => plan.id === selectedPlanId)) {
      setSelectedPlanId(plans[0]?.id ?? null);
    }
  }, [plans, selectedPlanId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void sync();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [sync]);

  const setSelectedProductId = useCallback(
    (productId: string) => {
      const matchingPlan = plans.find((plan) => plan.id === productId || plan.productId === productId);
      setSelectedPlanId(matchingPlan?.id ?? productId);
    },
    [plans],
  );
  const selectedProductId = selectedPlan?.productId ?? null;

  const value = useMemo<SubscriptionContextValue>(
    () => ({
      error,
      isConnected: connected,
      isLoadingProducts,
      isManagingSubscriptions,
      isPurchasing,
      isRedeemingOfferCode,
      isRestoring,
      isSupported: true,
      isSyncing,
      platform: Platform.OS,
      plans,
      productIds,
      products: sortProductsByConfiguredOrder(subscriptions, productIds),
      purchase,
      redeemOfferCode,
      restore,
      manageSubscriptions,
      selectedPlanId,
      selectedProductId,
      setSelectedPlanId,
      setSelectedProductId,
      subscription: user?.subscription ?? null,
      sync,
    }),
    [
      error,
      connected,
      isLoadingProducts,
      isManagingSubscriptions,
      isPurchasing,
      isRedeemingOfferCode,
      isRestoring,
      isSyncing,
      manageSubscriptions,
      purchase,
      productIds,
      plans,
      redeemOfferCode,
      restore,
      selectedPlanId,
      selectedProductId,
      setSelectedProductId,
      sync,
      user?.subscription,
      subscriptions,
    ],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscriptionIap() {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error('useSubscriptionIap must be used inside IapProvider');
  }

  return context;
}

function unsupportedSubscriptionValue(subscription: SubscriptionSnapshot | null): SubscriptionContextValue {
  return {
    error: null,
    isConnected: false,
    isLoadingProducts: false,
    isManagingSubscriptions: false,
    isPurchasing: false,
    isRedeemingOfferCode: false,
    isRestoring: false,
    isSupported: false,
    isSyncing: false,
    platform: Platform.OS,
    plans: [],
    productIds: [],
    products: [],
    purchase: async () => undefined,
    redeemOfferCode: async () => undefined,
    restore: async () => undefined,
    manageSubscriptions: async () => undefined,
    selectedPlanId: null,
    selectedProductId: null,
    setSelectedPlanId: () => undefined,
    setSelectedProductId: () => undefined,
    subscription,
    sync: async () => undefined,
  };
}

function defaultPlanId(platform: StorePlatform) {
  return platform === 'ios' ? iosProductIds[0] ?? null : androidPlanConfigs[0]?.id ?? null;
}

function buildSubscriptionPlans(platform: StorePlatform, products: ProductSubscription[]): SubscriptionPlan[] {
  if (platform === 'ios') {
    return sortProductsByConfiguredOrder(products, iosProductIds).map((product) => ({
      basePlanId: null,
      displayName: product.displayName ?? product.title,
      displayPrice: product.displayPrice,
      id: product.id,
      product,
      productId: product.id,
    }));
  }

  return androidPlanConfigs.flatMap((config) => {
    const product = products.find((candidate) => candidate.id === config.productId);
    if (!product) return [];

    const offer = selectGooglePlaySubscriptionOffer(product, config.basePlanId);
    if (!offer) return [];

    return [
      {
        basePlanId: config.basePlanId,
        displayName: product.displayName ?? config.label,
        displayPrice: offer.displayPrice,
        id: config.id,
        product,
        productId: product.id,
      },
    ];
  });
}

function storeDisplayName(platform: StorePlatform) {
  return platform === 'ios' ? 'App Store' : 'Google Play';
}

function purchaseQueueKey(purchase: Purchase) {
  const validation = validateAppStorePurchaseForIngest(purchase);
  if (validation.ok) return validation.transactionKey;

  const googleValidation = validateGooglePlayPurchaseForIngest(purchase);
  if (googleValidation.ok) return googleValidation.transactionKey;

  return purchase.transactionId?.trim() || purchase.purchaseToken?.trim() || null;
}

function reportIapDiagnostic(event: string, error: unknown) {
  trackIapDiagnostic(event, iapDiagnosticPayload(error, Platform.OS));
}
