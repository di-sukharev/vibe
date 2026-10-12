import type { SubscriptionSnapshot } from '@web-app-demo/contracts';
import {
  deepLinkToSubscriptions,
  fetchProducts as fetchProductsFromStore,
  getAvailablePurchases as getAvailablePurchasesFromStore,
  presentCodeRedemptionSheetIOS,
  syncIOS,
  useIAP,
  type ProductSubscription,
  type Purchase,
  type PurchaseOptions,
} from 'expo-iap';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { useAuth, type AuthAccountScope } from '@/features/auth';
import type { BillingApiPort } from './api';
import { trackIapDiagnostic } from './iap-diagnostics';
import {
  appStoreBillingTerms,
  buildReconcilePayloadFromPurchases,
  buildGooglePlayReconcilePayloadFromPurchases,
  buildSubscriptionPurchaseRequest,
  googlePlayBillingTerms,
  iapDiagnosticPayload,
  iapErrorMessage,
  ingestAndFinishPurchase,
  introOfferLabel,
  introOfferLabelForOffer,
  isUserCancelledPurchaseError,
  retryIapOperation,
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
  billingTerms: string | null;
  basePlanId: string | null;
  displayName: string;
  displayPrice: string;
  id: string;
  introOfferLabel: string | null;
  offerToken: string | null;
  product: ProductSubscription;
  productId: string;
};

type AppStorePurchaseValidation = Extract<ReturnType<typeof validateAppStorePurchaseForIngest>, { ok: true }>;
type GooglePlayPurchaseValidation = Extract<ReturnType<typeof validateGooglePlayPurchaseForIngest>, { ok: true }>;

type IapOperationScope = {
  accountScope: AuthAccountScope | null;
  generation: number;
};

type NativePurchaseRequest = {
  scope: IapOperationScope;
  pending: boolean;
  completed: boolean;
};

type SubscriptionContextValue = {
  error: string | null;
  isConnected: boolean;
  isLoadingProducts: boolean;
  isManagingSubscriptions: boolean;
  isPurchasing: boolean;
  isRedeemingOfferCode: boolean;
  isRestoring: boolean;
  isRetryingStore: boolean;
  isSupported: boolean;
  isSyncing: boolean;
  platform: typeof Platform.OS;
  plans: SubscriptionPlan[];
  productIds: string[];
  products: ProductSubscription[];
  purchase: () => Promise<void>;
  redeemOfferCode: () => Promise<void>;
  restore: () => Promise<void>;
  retryStore: () => Promise<void>;
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
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return (
      <SubscriptionContext.Provider value={unsupportedSubscriptionValue(null)}>
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
  const { isAccountScopeCurrent } = auth;
  const accountScope = auth.accountScope;
  const user = auth.user;
  const userId = user?.id ?? null;
  // Billing owns the entitlement: `sync` reads it from the backend and every verified purchase
  // updates it here, so the auth user contract stays free of subscription state.
  const [subscription, setSubscriptionState] = useState<SubscriptionSnapshot | null>(null);
  const subscriptionRequestIdRef = useRef(0);
  const publishedSubscriptionRef = useRef<{ updatedAt: number; requestId: number } | null>(null);
  const setSubscription = useCallback(
    (next: SubscriptionSnapshot, scope: AuthAccountScope, requestId: number) => {
      if (!isAccountScopeCurrent(scope)) return false;
      const updatedAt = next.updatedAt ? Date.parse(next.updatedAt) : 0;
      const published = publishedSubscriptionRef.current;
      // Server commits determine freshness. Request order breaks ties, including
      // snapshots whose effective state expires without a database write.
      if (published && (
        updatedAt < published.updatedAt ||
        (updatedAt === published.updatedAt && requestId < published.requestId)
      )) return false;
      publishedSubscriptionRef.current = { updatedAt, requestId };
      setSubscriptionState(next);
      return true;
    },
    [isAccountScopeCurrent],
  );
  const productIds = platform === 'ios' ? iosProductIds : androidProductIds;
  const [products, setProducts] = useState<ProductSubscription[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(defaultPlanId(platform));
  const [error, setError] = useState<string | null>(null);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [isManagingSubscriptions, setIsManagingSubscriptions] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRedeemingOfferCode, setIsRedeemingOfferCode] = useState(false);
  const [isRetryingStore, setIsRetryingStore] = useState(false);
  const retryStoreScopeRef = useRef<IapOperationScope | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const iapRef = useRef<ReturnType<typeof useIAP> | null>(null);
  const inFlightReconcileKeysRef = useRef(new Set<string>());
  const purchaseRequestInFlightRef = useRef(false);
  const nativePurchaseRequestRef = useRef<NativePurchaseRequest | null>(null);
  const processingTransactionsRef = useRef(new Set<string>());
  const processedTransactionsRef = useRef(new Set<string>());
  const pendingGooglePlayBasePlanByProductIdRef = useRef(new Map<string, string>());
  const queuedPurchaseKeysRef = useRef(new Set<string>());
  const queuedPurchasesRef = useRef<{ generation: number; purchase: Purchase }[]>([]);
  const loadProductsOperationIdRef = useRef(0);
  const offerCodeControllerRef = useRef(new OfferCodeRedemptionController());
  const offerCodeRedemptionOperationIdRef = useRef(0);
  const manageSubscriptionsOperationIdRef = useRef(0);
  const currentSessionGenerationRef = useRef(auth.sessionGeneration);
  currentSessionGenerationRef.current = auth.sessionGeneration;

  const operationScope = useMemo<IapOperationScope>(
    () => ({ accountScope, generation: auth.sessionGeneration }),
    [accountScope, auth.sessionGeneration],
  );

  const isScopeCurrent = useCallback(
    (scope: AuthAccountScope) => isAccountScopeCurrent(scope),
    [isAccountScopeCurrent],
  );
  const isOperationScopeCurrent = useCallback(
    (scope: IapOperationScope) =>
      currentSessionGenerationRef.current === scope.generation &&
      (!scope.accountScope || isAccountScopeCurrent(scope.accountScope)),
    [isAccountScopeCurrent],
  );

  const releaseNativePurchase = useCallback((request: NativePurchaseRequest) => {
    if (nativePurchaseRequestRef.current !== request || request.pending || !request.completed) return;
    nativePurchaseRequestRef.current = null;
    if (!isOperationScopeCurrent(request.scope)) setIsPurchasing(false);
  }, [isOperationScopeCurrent]);

  useEffect(() => {
    inFlightReconcileKeysRef.current.clear();
    purchaseRequestInFlightRef.current = false;
    processingTransactionsRef.current.clear();
    processedTransactionsRef.current.clear();
    pendingGooglePlayBasePlanByProductIdRef.current.clear();
    queuedPurchaseKeysRef.current.clear();
    loadProductsOperationIdRef.current += 1;
    offerCodeControllerRef.current.clear();
    offerCodeRedemptionOperationIdRef.current += 1;
    manageSubscriptionsOperationIdRef.current += 1;
    setError(null);
    setProducts([]);
    setIsLoadingProducts(false);
    setIsManagingSubscriptions(false);
    setIsPurchasing(Boolean(nativePurchaseRequestRef.current));
    setIsRedeemingOfferCode(false);
    setIsRestoring(false);
    setIsRetryingStore(false);
    retryStoreScopeRef.current = null;
    setIsSyncing(false);
    // A new account starts with no entitlement until its own sync answers.
    publishedSubscriptionRef.current = null;
    setSubscriptionState(null);
  }, [accountScope?.generation, userId]);

  const queuePurchaseUntilAuthenticated = useCallback((purchase: Purchase, generation: number) => {
    const purchaseKey = purchaseQueueKey(purchase);
    const queueKey = purchaseKey ? `${generation}:${purchaseKey}` : null;
    if (queueKey && queuedPurchaseKeysRef.current.has(queueKey)) return;

    if (queueKey) {
      queuedPurchaseKeysRef.current.add(queueKey);
    }
    queuedPurchasesRef.current.push({ generation, purchase });
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

  const ingestGooglePlayPurchase = useCallback(
    async (
      validation: GooglePlayPurchaseValidation,
      basePlanIdHint?: string | null,
      scope?: AuthAccountScope,
    ) => {
      const usesPendingPurchaseIntent = basePlanIdHint === undefined;
      const requestedBasePlanId = usesPendingPurchaseIntent
        ? pendingGooglePlayBasePlanByProductIdRef.current.get(validation.productId)
        : basePlanIdHint;
      if (
        requestedBasePlanId &&
        validation.basePlanId &&
        requestedBasePlanId !== validation.basePlanId
      ) {
        throw new Error('Google Play returned a different base plan than the one requested.');
      }
      const basePlanId = validation.basePlanId ?? requestedBasePlanId;
      const response = await api.ingestGooglePlayTransaction({
        productId: validation.productId,
        purchaseToken: validation.purchaseToken,
        ...(basePlanId ? { basePlanId } : {}),
      });

      // The backend acknowledges Google Play only after it persists ownership.
      if (usesPendingPurchaseIntent && (!scope || isScopeCurrent(scope))) {
        pendingGooglePlayBasePlanByProductIdRef.current.delete(validation.productId);
      }
      return { finishError: null, subscription: response.subscription };
    },
    [api, isScopeCurrent],
  );

  const handlePurchase = useCallback(
    async (purchase: Purchase) => {
      const purchaseScope = operationScope;
      const scope = purchaseScope.accountScope;
      if (!isOperationScopeCurrent(purchaseScope)) return;
      if (!userId || !scope) {
        if (auth.isBootstrapping) {
          queuePurchaseUntilAuthenticated(purchase, purchaseScope.generation);
        }
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
        const requestId = ++subscriptionRequestIdRef.current;
        const result =
          platform === 'ios'
            ? await ingestAndFinishAppStorePurchase(purchase, validation as AppStorePurchaseValidation)
            : await ingestGooglePlayPurchase(
                validation as GooglePlayPurchaseValidation,
                undefined,
                scope,
              );
        if (!isOperationScopeCurrent(purchaseScope)) return;
        setSubscription(result.subscription, scope, requestId);
        if (result.finishError) {
          reportIapDiagnostic('purchase-finish-error', result.finishError);
        } else {
          processedTransactionsRef.current.add(validation.transactionKey);
        }
      } catch (caughtError) {
        if (!isOperationScopeCurrent(purchaseScope)) return;
        reportIapDiagnostic('purchase-ingest-error', caughtError);
        setError(iapErrorMessage(caughtError));
      } finally {
        if (isOperationScopeCurrent(purchaseScope)) {
          purchaseRequestInFlightRef.current = false;
          processingTransactionsRef.current.delete(validation.transactionKey);
          setIsPurchasing(false);
        }
      }
    },
    [
      ingestAndFinishAppStorePurchase,
      ingestGooglePlayPurchase,
      auth.isBootstrapping,
      isOperationScopeCurrent,
      operationScope,
      platform,
      queuePurchaseUntilAuthenticated,
      setSubscription,
      userId,
    ],
  );

  const iap = useIAP({
    onPurchaseSuccess: (purchase) => {
      const request = nativePurchaseRequestRef.current;
      if (request) {
        request.completed = true;
        releaseNativePurchase(request);
        if (!isOperationScopeCurrent(request.scope)) return;
      }
      void handlePurchase(purchase);
    },
    onPurchaseError: (purchaseError) => {
      // expo-iap 4.6.0 rejects requestPurchase for request errors (including
      // cancellation and deferred payment). This duplicate event has no request
      // identity and can arrive after a new account starts another purchase.
      // Only the scoped promise catch below may change request state or UI.
      if (!isUserCancelledPurchaseError(purchaseError)) {
        reportIapDiagnostic('purchase-error', purchaseError);
      }
    },
    onError: (caughtError) => {
      if (!isOperationScopeCurrent(operationScope)) return;
      if (isUserCancelledPurchaseError(caughtError)) {
        return;
      }
      reportIapDiagnostic('iap-error', caughtError);
      // Hook errors use the latest callback even when an older request failed.
      // Promise-based store operations report errors through their scoped catches.
    },
  });
  iapRef.current = iap;
  const {
    connected,
    reconnect,
    requestPurchase,
  } = iap;

  const loadProducts = useCallback(async () => {
    const loadScope = operationScope;
    if (!isOperationScopeCurrent(loadScope)) return;
    const operationId = loadProductsOperationIdRef.current + 1;
    loadProductsOperationIdRef.current = operationId;
    const ownsOperation = () =>
      loadProductsOperationIdRef.current === operationId &&
      isOperationScopeCurrent(loadScope);

    if (productIds.length === 0) {
      setError('Subscription product IDs are not configured.');
      return;
    }

    setIsLoadingProducts(true);
    setError(null);

    try {
      const fetched = await retryIapOperation(() => fetchProductsFromStore({ skus: productIds, type: 'subs' }));
      if (!ownsOperation()) return;
      setProducts((fetched ?? []) as ProductSubscription[]);
    } catch (caughtError) {
      if (!ownsOperation()) return;
      reportIapDiagnostic('product-fetch-error', caughtError);
      setError(iapErrorMessage(caughtError));
    } finally {
      if (ownsOperation()) {
        setIsLoadingProducts(false);
      }
    }
  }, [isOperationScopeCurrent, operationScope, productIds]);

  const plans = useMemo(() => buildSubscriptionPlans(platform, products), [platform, products]);
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
      const scope = accountScope;
      if (!scope || !isScopeCurrent(scope)) return null;
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
            const requestId = ++subscriptionRequestIdRef.current;
            const result =
              platform === 'ios'
                ? await ingestAndFinishAppStorePurchase(purchase, validation as AppStorePurchaseValidation)
                : await ingestGooglePlayPurchase(
                    validation as GooglePlayPurchaseValidation,
                    null,
                  );
            if (!isScopeCurrent(scope)) return null;
            setSubscription(result.subscription, scope, requestId);
            latestSubscription = result.subscription;

            if (result.finishError) {
              reportIapDiagnostic('available-purchase-finish-error', result.finishError);
            } else {
              processedTransactionsRef.current.add(validation.transactionKey);
            }
          } catch (caughtError) {
            if (!isScopeCurrent(scope)) return null;
            firstError ??= caughtError;
            reportIapDiagnostic('available-purchase-ingest-error', caughtError);
          } finally {
            if (isScopeCurrent(scope)) {
              processingTransactionsRef.current.delete(validation.transactionKey);
              inFlightReconcileKeysRef.current.delete(reconcileKey);
            }
          }
        }
      }

      if (!isScopeCurrent(scope)) return null;

      if (platform === 'android') {
        const googlePayload = buildGooglePlayReconcilePayloadFromPurchases(purchases, new Map());
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
          const requestId = ++subscriptionRequestIdRef.current;
          const response = await api.reconcileGooglePlayTransactions(googlePayload);
          if (!isScopeCurrent(scope)) return null;
          setSubscription(response.subscription, scope, requestId);
          if (pendingPurchaseMessage && !response.subscription.isActive) {
            setError(pendingPurchaseMessage);
          }
          return response.subscription;
        } finally {
          if (isScopeCurrent(scope)) {
            inFlightReconcileKeysRef.current.delete(googleReconcileKey);
          }
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
        const requestId = ++subscriptionRequestIdRef.current;
        const response = await api.reconcileAppStoreTransactions(originalPayload);
        if (!isScopeCurrent(scope)) return null;
        setSubscription(response.subscription, scope, requestId);
        if (pendingPurchaseMessage && !response.subscription.isActive) {
          setError(pendingPurchaseMessage);
        }
        return response.subscription;
      } finally {
        if (isScopeCurrent(scope)) {
          inFlightReconcileKeysRef.current.delete(originalReconcileKey);
        }
      }
    },
    [
      api,
      accountScope,
      ingestAndFinishAppStorePurchase,
      ingestGooglePlayPurchase,
      platform,
      isScopeCurrent,
      setSubscription,
    ],
  );

  const sync = useCallback(async () => {
    const syncScope = operationScope;
    const scope = syncScope.accountScope;
    if (!userId || !scope || auth.isTransitioning || !isOperationScopeCurrent(syncScope)) return;

    setIsSyncing(true);

    try {
      const requestId = ++subscriptionRequestIdRef.current;
      const entitlement = await api.entitlement();
      if (!isOperationScopeCurrent(syncScope)) return;
      setSubscription(entitlement.subscription, scope, requestId);
      const originalTransactionIds = platform === 'ios' && entitlement.subscription.originalTransactionId
        ? [entitlement.subscription.originalTransactionId]
        : undefined;

      if (connected) {
        try {
          const purchases = await retryIapOperation(() =>
            platform === 'ios'
              ? getAvailablePurchasesFromStore(allIosAvailablePurchaseOptions)
              : getAvailablePurchasesFromStore(),
          );
          if (!isOperationScopeCurrent(syncScope)) return;
          await reconcileAndFinishPurchases({
            finishPurchases: true,
            originalTransactionIds,
            purchases,
          });
          return;
        } catch (storeError) {
          if (!isOperationScopeCurrent(syncScope)) return;
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
      if (!isOperationScopeCurrent(syncScope)) return;
      reportIapDiagnostic('subscription-sync-error', caughtError);
      setError(iapErrorMessage(caughtError));
    } finally {
      if (isOperationScopeCurrent(syncScope)) {
        setIsSyncing(false);
      }
    }
  }, [api, auth.isTransitioning, connected, isOperationScopeCurrent, operationScope, platform, reconcileAndFinishPurchases, setSubscription, userId]);

  const retryStore = useCallback(async () => {
    const scope = operationScope;
    if (!scope.accountScope || auth.isTransitioning || !isOperationScopeCurrent(scope)) return;
    if (retryStoreScopeRef.current === scope) return;
    retryStoreScopeRef.current = scope;
    setIsRetryingStore(true);
    setError(null);
    try {
      if (!connected) {
        const reconnected = await reconnect();
        if (!isOperationScopeCurrent(scope)) return;
        if (!reconnected) {
          setError('The store is unavailable. Check your connection and try again.');
        }
        // A successful reconnect triggers the catalogue and entitlement effect.
        return;
      }
      await Promise.all([loadProducts(), sync()]);
    } catch (caughtError) {
      if (isOperationScopeCurrent(scope)) setError(iapErrorMessage(caughtError));
    } finally {
      if (isOperationScopeCurrent(scope)) {
        retryStoreScopeRef.current = null;
        setIsRetryingStore(false);
      }
    }
  }, [auth.isTransitioning, connected, isOperationScopeCurrent, loadProducts, operationScope, reconnect, sync]);

  const purchase = useCallback(async () => {
    const purchaseScope = operationScope;
    if (
      !user ||
      !purchaseScope.accountScope ||
      auth.isTransitioning ||
      !isOperationScopeCurrent(purchaseScope)
    ) return;
    if (purchaseRequestInFlightRef.current || nativePurchaseRequestRef.current) return;

    if (!connected) {
      setError(`${storeDisplayName(platform)} connection is not ready yet. Please try again in a moment.`);
      return;
    }

    if (!selectedPlan) return;

    setIsPurchasing(true);
    purchaseRequestInFlightRef.current = true;
    setError(null);

    // Keep one owner across sign-out until the promise settles and a purchase
    // result arrives. A rejected promise is itself a terminal result.
    const nativeRequest: NativePurchaseRequest = {
      scope: purchaseScope,
      pending: true,
      completed: false,
    };
    nativePurchaseRequestRef.current = nativeRequest;

    try {
      let request: ReturnType<typeof buildSubscriptionPurchaseRequest>;
      if (platform === 'android') {
        if (!selectedPlan.basePlanId) {
          throw new Error('Google Play base plan is not configured for this subscription.');
        }

        if (!selectedPlan.offerToken) {
          throw new Error('Configured Google Play base plan is not available for this account.');
        }

        pendingGooglePlayBasePlanByProductIdRef.current.set(selectedPlan.productId, selectedPlan.basePlanId);
        request = buildSubscriptionPurchaseRequest({
          appAccountToken: user.id,
          offerToken: selectedPlan.offerToken,
          platform: 'android',
          productId: selectedPlan.productId,
        });
      } else {
        request = buildSubscriptionPurchaseRequest({
          appAccountToken: user.id,
          platform: 'ios',
          productId: selectedPlan.productId,
        });
      }

      const result = await requestPurchase(request);
      const purchases = Array.isArray(result) ? result : result ? [result] : [];
      // expo-iap suppresses duplicate transaction callbacks for 30 seconds but
      // still returns the purchase. Empty results can precede a later event.
      if (!nativeRequest.completed && purchases.length > 0) {
        nativeRequest.completed = true;
        if (!isOperationScopeCurrent(purchaseScope)) return;
        for (const returnedPurchase of purchases) {
          await handlePurchase(returnedPurchase);
        }
      }
    } catch (caughtError) {
      nativeRequest.completed = true;
      if (!isOperationScopeCurrent(purchaseScope)) return;
      if (platform === 'android') {
        pendingGooglePlayBasePlanByProductIdRef.current.clear();
      }
      purchaseRequestInFlightRef.current = false;
      setIsPurchasing(false);
      if (!isUserCancelledPurchaseError(caughtError)) {
        reportIapDiagnostic('purchase-request-error', caughtError);
        setError(iapErrorMessage(caughtError));
      }
    } finally {
      nativeRequest.pending = false;
      releaseNativePurchase(nativeRequest);
    }
  }, [auth.isTransitioning, connected, handlePurchase, isOperationScopeCurrent, operationScope, platform, releaseNativePurchase, requestPurchase, selectedPlan, user]);

  const restore = useCallback(async () => {
    const restoreScope = operationScope;
    const scope = restoreScope.accountScope;
    if (!user || !scope || auth.isTransitioning || !isOperationScopeCurrent(restoreScope)) return;

    if (!connected) {
      setError(`${storeDisplayName(platform)} connection is not ready yet. Please try again in a moment.`);
      return;
    }

    setIsRestoring(true);
    setError(null);

    try {
      let restoreError: unknown = null;
      let restoreCancelled = false;
      if (platform === 'ios') {
        await syncIOS().catch((caughtError) => {
          if (!isOperationScopeCurrent(restoreScope)) return;
          if (isUserCancelledPurchaseError(caughtError)) {
            restoreCancelled = true;
            return;
          }
          restoreError = caughtError;
          reportIapDiagnostic('storekit-restore-sync-error', caughtError);
        });
      }
      if (!isOperationScopeCurrent(restoreScope)) return;
      if (restoreCancelled) return;

      // Null until the mount sync answers. That only widens the error copy below: the sync
      // itself reconciles the same original transaction, so the entitlement still restores.
      const originalTransactionIds = platform === 'ios' && subscription?.originalTransactionId
        ? [subscription.originalTransactionId]
        : undefined;
      const purchases = await retryIapOperation(() =>
        platform === 'ios'
          ? getAvailablePurchasesFromStore(allIosAvailablePurchaseOptions)
          : getAvailablePurchasesFromStore(),
      );
      if (!isOperationScopeCurrent(restoreScope)) return;
      const restoredSubscription = await reconcileAndFinishPurchases({
        finishPurchases: true,
        originalTransactionIds,
        purchases,
      });
      if (!isOperationScopeCurrent(restoreScope)) return;

      if (restoreError && purchases.length === 0 && !restoredSubscription?.isActive) {
        setError(iapErrorMessage(restoreError));
      } else if (!restoredSubscription?.isActive && purchases.length === 0) {
        setError(
          originalTransactionIds
            ? `${storeDisplayName(platform)} did not return an active subscription for this account. Please try again.`
            : `No restorable ${storeDisplayName(platform)} subscription was found for this account.`,
        );
      }
    } catch (caughtError) {
      if (!isOperationScopeCurrent(restoreScope)) return;
      reportIapDiagnostic('restore-error', caughtError);
      setError(iapErrorMessage(caughtError));
    } finally {
      if (isOperationScopeCurrent(restoreScope)) {
        setIsRestoring(false);
      }
    }
  }, [auth.isTransitioning, connected, isOperationScopeCurrent, operationScope, platform, reconcileAndFinishPurchases, subscription, user]);

  const redeemOfferCode = useCallback(async () => {
    const redemptionScope = operationScope;
    if (!user || !redemptionScope.accountScope || auth.isTransitioning || !isOperationScopeCurrent(redemptionScope)) return;
    if (platform !== 'ios') {
      setError('Offer code redemption is only available for App Store subscriptions.');
      return;
    }
    if (!connected) {
      setError('App Store connection is not ready yet. Please try again in a moment.');
      return;
    }

    const operationId = offerCodeRedemptionOperationIdRef.current + 1;
    offerCodeRedemptionOperationIdRef.current = operationId;
    const ownsOperation = () =>
      offerCodeRedemptionOperationIdRef.current === operationId &&
      isOperationScopeCurrent(redemptionScope);

    setIsRedeemingOfferCode(true);
    setError(null);
    let redemptionToken: string | null = null;

    try {
      const response = await api.createAppStoreOfferCodeRedemption();
      if (!ownsOperation()) return;
      redemptionToken = response.token;
      offerCodeControllerRef.current.store(redemptionToken, Date.now());
      const presented = await presentCodeRedemptionSheetIOS();
      if (!ownsOperation()) return;
      if (presented === false) {
        throw new Error('App Store offer code sheet could not be opened.');
      }
      await sync();
    } catch (caughtError) {
      if (!ownsOperation()) return;
      if (redemptionToken) {
        offerCodeControllerRef.current.clearIfCurrent(redemptionToken);
      }
      if (isUserCancelledPurchaseError(caughtError)) {
        return;
      }
      reportIapDiagnostic('offer-code-redemption-error', caughtError);
      setError(iapErrorMessage(caughtError));
    } finally {
      if (ownsOperation()) {
        setIsRedeemingOfferCode(false);
      }
    }
  }, [api, auth.isTransitioning, connected, isOperationScopeCurrent, operationScope, platform, sync, user]);

  const manageSubscriptions = useCallback(async () => {
    const manageScope = operationScope;
    if (
      !manageScope.accountScope ||
      auth.isTransitioning ||
      !isOperationScopeCurrent(manageScope)
    ) return;
    if (!connected) {
      setError(`${storeDisplayName(platform)} connection is not ready yet. Please try again in a moment.`);
      return;
    }

    const operationId = manageSubscriptionsOperationIdRef.current + 1;
    manageSubscriptionsOperationIdRef.current = operationId;
    const ownsOperation = () =>
      manageSubscriptionsOperationIdRef.current === operationId &&
      isOperationScopeCurrent(manageScope);

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
              skuAndroid: subscription?.productId ?? selectedPlan?.productId ?? undefined,
            }
          : {},
      );
    } catch (caughtError) {
      if (!ownsOperation()) return;
      if (isUserCancelledPurchaseError(caughtError)) {
        return;
      }
      setError(iapErrorMessage(caughtError));
    } finally {
      if (ownsOperation()) {
        setIsManagingSubscriptions(false);
      }
    }
  }, [auth.isTransitioning, connected, isOperationScopeCurrent, operationScope, platform, selectedPlan, subscription]);

  useEffect(() => {
    if (connected && userId) {
      void loadProducts();
    } else {
      loadProductsOperationIdRef.current += 1;
      setIsLoadingProducts(false);
    }
    void sync();
  }, [connected, loadProducts, sync, userId]);

  useEffect(() => {
    if (!userId || queuedPurchasesRef.current.length === 0) return;

    const queuedPurchases = queuedPurchasesRef.current.filter(
      (queuedPurchase) => queuedPurchase.generation === auth.sessionGeneration,
    );
    queuedPurchasesRef.current = [];
    queuedPurchaseKeysRef.current.clear();

    for (const queuedPurchase of queuedPurchases) {
      void handlePurchase(queuedPurchase.purchase);
    }
  }, [auth.sessionGeneration, handlePurchase, userId]);

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
      isRetryingStore,
      isSupported: true,
      isSyncing,
      platform: Platform.OS,
      plans,
      productIds,
      products: sortProductsByConfiguredOrder(products, productIds),
      purchase,
      redeemOfferCode,
      restore,
      retryStore,
      manageSubscriptions,
      selectedPlanId,
      selectedProductId,
      setSelectedPlanId,
      setSelectedProductId,
      subscription,
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
      isRetryingStore,
      isSyncing,
      manageSubscriptions,
      purchase,
      productIds,
      plans,
      products,
      redeemOfferCode,
      restore,
      retryStore,
      selectedPlanId,
      selectedProductId,
      setSelectedProductId,
      subscription,
      sync,
    ],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

/**
 * Returns `null` when `IapProvider` is not mounted, which is the shipped state: subscriptions are
 * turned off in the template (see docs/IAP.md). Screens render their "billing is off" branch
 * instead of crashing, and turning billing on needs no change here.
 */
export function useSubscriptionIap() {
  return useContext(SubscriptionContext);
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
    isRetryingStore: false,
    isSupported: false,
    isSyncing: false,
    platform: Platform.OS,
    plans: [],
    productIds: [],
    products: [],
    purchase: async () => undefined,
    redeemOfferCode: async () => undefined,
    restore: async () => undefined,
    retryStore: async () => undefined,
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
      billingTerms: appStoreBillingTerms(product),
      basePlanId: null,
      displayName: product.displayName ?? product.title,
      displayPrice: product.displayPrice,
      id: product.id,
      introOfferLabel: introOfferLabel(product),
      offerToken: null,
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
        billingTerms: googlePlayBillingTerms(offer.offer),
        basePlanId: config.basePlanId,
        displayName: product.displayName ?? config.label,
        displayPrice: offer.displayPrice,
        id: config.id,
        introOfferLabel: offer.offer.pricingPhasesAndroid?.pricingPhaseList.length ? null : introOfferLabelForOffer(offer.offer),
        offerToken: offer.offerToken,
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
