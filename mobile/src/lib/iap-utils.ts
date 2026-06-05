import type { GooglePlayPurchaseReference, SubscriptionSnapshot } from '@web-app-demo/contracts';
import type { ExpoPurchaseError, ProductSubscription, Purchase, RequestPurchaseProps, SubscriptionOffer } from 'expo-iap';
import { ErrorCode } from 'expo-iap/build/types';

import { ApiRequestError } from './api';
import type { IapDiagnosticPayload } from './iap-diagnostics';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const nonRetryableRecoverableErrorCodes = new Set<ErrorCode>([
  ErrorCode.BillingUnavailable,
  ErrorCode.InitConnection,
  ErrorCode.QueryProduct,
]);
const networkErrorCodes = new Set<ErrorCode>([
  ErrorCode.BillingUnavailable,
  ErrorCode.NetworkError,
  ErrorCode.RemoteError,
  ErrorCode.ServiceDisconnected,
  ErrorCode.ServiceError,
]);
const recoverableErrorCodes = new Set<ErrorCode>([
  ErrorCode.BillingUnavailable,
  ErrorCode.InitConnection,
  ErrorCode.Interrupted,
  ErrorCode.NetworkError,
  ErrorCode.QueryProduct,
  ErrorCode.RemoteError,
  ErrorCode.ServiceDisconnected,
  ErrorCode.ServiceError,
]);

type SubscriptionPurchaseRequestInput =
  | {
      appAccountToken: string;
      platform: 'ios';
      productId: string;
    }
  | {
      appAccountToken: string;
      offerToken: string;
      platform: 'android';
      productId: string;
    };

export function buildSubscriptionPurchaseRequest(productId: string, appAccountToken: string): RequestPurchaseProps;
export function buildSubscriptionPurchaseRequest(input: SubscriptionPurchaseRequestInput): RequestPurchaseProps;
export function buildSubscriptionPurchaseRequest(
  inputOrProductId: string | SubscriptionPurchaseRequestInput,
  appAccountToken?: string,
): RequestPurchaseProps {
  const input =
    typeof inputOrProductId === 'string'
      ? {
          appAccountToken: appAccountToken ?? '',
          platform: 'ios' as const,
          productId: inputOrProductId,
        }
      : inputOrProductId;

  if (!uuidPattern.test(input.appAccountToken)) {
    throw new Error(`${input.platform === 'ios' ? 'App Store appAccountToken' : 'Google Play obfuscated account ID'} must be a UUID.`);
  }

  if (input.platform === 'android') {
    return {
      type: 'subs',
      request: {
        google: {
          skus: [input.productId],
          obfuscatedAccountId: input.appAccountToken,
          obfuscatedProfileId: input.appAccountToken,
          subscriptionOffers: [{ sku: input.productId, offerToken: input.offerToken }],
        },
      },
    };
  }

  return {
    type: 'subs',
    request: {
      apple: {
        sku: input.productId,
        appAccountToken: input.appAccountToken,
        andDangerouslyFinishTransactionAutomatically: false,
      },
    },
  };
}

export async function ingestAndFinishPurchase({
  finish,
  ingest,
  purchase,
  signedTransactionInfo,
}: {
  finish: (purchase: Purchase) => Promise<void>;
  ingest: (request: { signedTransactionInfo: string }) => Promise<{ subscription: SubscriptionSnapshot }>;
  purchase: Purchase;
  signedTransactionInfo?: string;
}): Promise<{ finishError: unknown | null; subscription: SubscriptionSnapshot }> {
  const transactionInfo = signedTransactionInfo ?? extractSignedTransactionInfo(purchase);
  if (!transactionInfo) {
    throw new Error('App Store purchase is missing signed transaction info.');
  }

  const response = await ingest({ signedTransactionInfo: transactionInfo });
  try {
    await retryIapOperation(() => finish(purchase));
    return { finishError: null, subscription: response.subscription };
  } catch (finishError) {
    return { finishError, subscription: response.subscription };
  }
}

export function buildReconcilePayloadFromPurchases(purchases: Purchase[], originalTransactionIds: string[] = []) {
  const signedTransactions = uniqueStrings(purchases
    .map(extractSignedTransactionInfo)
    .filter((signedTransactionInfo): signedTransactionInfo is string => Boolean(signedTransactionInfo)));
  const originalIds = uniqueStrings(originalTransactionIds);

  return signedTransactions.length > 0 || originalIds.length > 0
    ? {
        ...(signedTransactions.length > 0 ? { signedTransactions } : {}),
        ...(originalIds.length > 0 ? { originalTransactionIds: originalIds } : {}),
      }
    : null;
}

export function extractSignedTransactionInfo(purchase: Purchase) {
  return purchase.purchaseToken?.trim() || null;
}

export function buildGooglePlayReconcilePayloadFromPurchases(
  purchases: Purchase[],
  basePlanIdsByProductId: ReadonlyMap<string, string> = new Map(),
) {
  const references: GooglePlayPurchaseReference[] = [];
  const seenKeys = new Set<string>();

  for (const purchase of purchases) {
    const validation = validateGooglePlayPurchaseForIngest(purchase);
    if (!validation.ok) continue;

    const basePlanId = basePlanIdsByProductId.get(validation.productId);
    const key = `${validation.productId}:${validation.purchaseToken}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    references.push({
      productId: validation.productId,
      purchaseToken: validation.purchaseToken,
      ...(basePlanId ? { basePlanId } : {}),
    });
  }

  return references.length > 0 ? { purchases: references } : {};
}

export function extractGooglePlayPurchaseToken(purchase: Purchase) {
  return purchase.purchaseToken?.trim() || null;
}

export function isUserCancelledPurchaseError(error: unknown) {
  return getIapErrorCode(error) === ErrorCode.UserCancelled || isLegacyUserCancelledMessage(error);
}

export function isNetworkIapError(error: unknown) {
  const code = getIapErrorCode(error);
  return Boolean(code && networkErrorCodes.has(code));
}

export function isRecoverableIapError(error: unknown) {
  const code = getIapErrorCode(error);
  return Boolean(code && recoverableErrorCodes.has(code));
}

export function isRetryableIapError(error: unknown) {
  const code = getIapErrorCode(error);
  return Boolean(code && isRecoverableIapError(error) && !nonRetryableRecoverableErrorCodes.has(code));
}

export function isPostSuccessNoiseError(error: unknown) {
  return getIapErrorCode(error) === ErrorCode.ServiceError;
}

export function friendlyIapErrorMessage(error: unknown) {
  const code = getIapErrorCode(error);

  switch (code) {
    case ErrorCode.UserCancelled:
      return 'Purchase was cancelled.';
    case ErrorCode.DeferredPayment:
    case ErrorCode.Pending:
      return 'Purchase is pending approval. Premium will unlock after the store approves it.';
    case ErrorCode.NetworkError:
    case ErrorCode.RemoteError:
    case ErrorCode.ServiceDisconnected:
    case ErrorCode.ServiceError:
    case ErrorCode.InitConnection:
    case ErrorCode.QueryProduct:
      return 'The store is temporarily unavailable. Check your connection and try again.';
    case ErrorCode.IapNotAvailable:
    case ErrorCode.BillingUnavailable:
    case ErrorCode.FeatureNotSupported:
      return 'In-app purchases are not available on this device or account.';
    case ErrorCode.ItemUnavailable:
    case ErrorCode.SkuNotFound:
      return 'This subscription is not available from the store for this account.';
    case ErrorCode.ItemNotOwned:
      return 'No restorable subscription was found for this store account.';
    case ErrorCode.UserError:
      return 'The store could not complete the purchase. Check your store payment settings and try again.';
    case ErrorCode.AlreadyOwned:
      return 'This store account already owns the subscription. Use Restore purchases.';
    case ErrorCode.EmptySkuList:
      return 'Subscription products are not configured correctly.';
    default:
      return 'Subscription is temporarily unavailable. Please try again.';
  }
}

export function iapErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    switch (error.code) {
      case 'IAP_NOT_CONFIGURED':
        return 'Subscriptions are not configured on the server yet.';
      case 'IAP_INVALID_TRANSACTION':
        return 'The store transaction could not be verified. Use Restore purchases or try again.';
      case 'IAP_OWNERSHIP_MISMATCH':
        return 'This store purchase is linked to another account.';
      default:
        return error.message;
    }
  }

  return friendlyIapErrorMessage(error);
}

export function shouldSuppressPostSuccessError(
  error: unknown,
  lastPurchaseSuccessAt: number | null,
  now = Date.now(),
) {
  return (
    Boolean(lastPurchaseSuccessAt) &&
    isPostSuccessNoiseError(error) &&
    now - Number(lastPurchaseSuccessAt) < 5_000
  );
}

export function iapDiagnosticPayload(error: unknown, platform: string): IapDiagnosticPayload {
  const code = typeof error === 'string' ? null : getIapErrorCode(error);
  const network = typeof error === 'string' ? false : isNetworkIapError(error);
  const retryable = typeof error === 'string' ? false : isRetryableIapError(error);

  return {
    code,
    debugMessage: diagnosticStringField(error, 'debugMessage'),
    message: diagnosticMessage(error),
    network,
    platform: diagnosticStringField(error, 'platform') ?? platform,
    productId: diagnosticStringField(error, 'productId'),
    responseCode: diagnosticNumberField(error, 'responseCode'),
    retryable,
    underlyingError: diagnosticStringField(error, 'underlyingError'),
  };
}

export async function retryIapOperation<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
) {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? options.delayMs ?? 300;
  const sleep = options.sleep ?? delay;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryableIapError(error)) {
        throw error;
      }
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

export function validateAppStorePurchaseForIngest(purchase: Purchase) {
  if (purchase.store !== 'apple') {
    return {
      ok: false as const,
      message: 'This purchase did not come from the App Store.',
      pending: false,
    };
  }

  if (purchase.purchaseState === 'pending') {
    return {
      ok: false as const,
      message: 'Purchase is pending approval. Premium will unlock after Apple approves it.',
      pending: true,
    };
  }

  if (purchase.purchaseState === 'unknown') {
    return {
      ok: false as const,
      message: 'Apple has not confirmed this purchase yet. Please try restore again.',
      pending: false,
    };
  }

  const signedTransactionInfo = extractSignedTransactionInfo(purchase);
  if (!signedTransactionInfo) {
    return {
      ok: false as const,
      message: 'App Store purchase is missing signed transaction info. Use Restore purchases or try again on a real iOS device.',
      pending: false,
    };
  }

  return {
    ok: true as const,
    signedTransactionInfo,
    transactionKey: purchase.transactionId?.trim() || signedTransactionInfo,
  };
}

export function validateGooglePlayPurchaseForIngest(purchase: Purchase) {
  if (purchase.store !== 'google') {
    return {
      ok: false as const,
      message: 'This purchase did not come from Google Play.',
      pending: false,
    };
  }

  if (purchase.purchaseState === 'pending') {
    return {
      ok: false as const,
      message: 'Purchase is pending approval. Premium will unlock after Google Play completes it.',
      pending: true,
    };
  }

  if (purchase.purchaseState === 'unknown') {
    return {
      ok: false as const,
      message: 'Google Play has not confirmed this purchase yet. Please try restore again.',
      pending: false,
    };
  }

  const purchaseToken = extractGooglePlayPurchaseToken(purchase);
  if (!purchaseToken) {
    return {
      ok: false as const,
      message: 'Google Play purchase is missing a purchase token. Use Restore purchases or try again on a Play-enabled Android build.',
      pending: false,
    };
  }

  const productId = purchase.productId?.trim();
  if (!productId) {
    return {
      ok: false as const,
      message: 'Google Play purchase is missing a product ID. Use Restore purchases or try again.',
      pending: false,
    };
  }

  return {
    ok: true as const,
    productId,
    purchaseToken,
    transactionKey: purchase.transactionId?.trim() || `${productId}:${purchaseToken}`,
  };
}

export function selectGooglePlaySubscriptionOffer(product: ProductSubscription, basePlanId: string) {
  const standardizedOffer = product.subscriptionOffers?.find((offer) => isMatchingGooglePlayOffer(offer, basePlanId));
  if (standardizedOffer?.offerTokenAndroid) {
    return {
      displayPrice: standardizedOffer.displayPrice || product.displayPrice,
      offerToken: standardizedOffer.offerTokenAndroid,
    };
  }

  return null;
}

export function sortProductsByConfiguredOrder(products: ProductSubscription[], productIds: string[]) {
  return [...products].sort((left, right) => {
    const leftIndex = productIds.indexOf(left.id);
    const rightIndex = productIds.indexOf(right.id);
    return normalizedProductIndex(leftIndex) - normalizedProductIndex(rightIndex);
  });
}

export function purchaseButtonLabel(product: ProductSubscription) {
  return `Subscribe for ${product.displayPrice}`;
}

export function introOfferLabel(product: ProductSubscription) {
  const offer =
    product.subscriptionOffers?.find((subscriptionOffer) => subscriptionOffer.type === 'introductory') ??
    ('subscriptionInfoIOS' in product ? product.subscriptionInfoIOS?.introductoryOffer : null);
  if (!offer) return null;

  const period = formatOfferPeriod(offer.periodCount, offer.period?.unit);

  switch (offer.paymentMode) {
    case 'free-trial':
      return period ? `Eligible users may get a free trial for ${period}` : 'Eligible users may get a free trial';
    case 'pay-as-you-go':
      return period
        ? `Eligible users may get an intro pay-as-you-go price: ${offer.displayPrice} for ${period}`
        : `Eligible users may get an intro pay-as-you-go price: ${offer.displayPrice}`;
    case 'pay-up-front':
      return period
        ? `Eligible users may get an intro upfront price: ${offer.displayPrice} for first ${period}`
        : `Eligible users may get an intro upfront price: ${offer.displayPrice}`;
    default:
      return period
        ? `Eligible users may get an intro offer: ${offer.displayPrice} for ${period}`
        : `Eligible users may get an intro offer: ${offer.displayPrice}`;
  }
}

export function getIapErrorCode(error: unknown): ErrorCode | null {
  if (typeof error === 'string') return normalizeErrorCode(error);
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = (error as ExpoPurchaseError).code;
  return typeof code === 'string' ? normalizeErrorCode(code) : null;
}

function normalizedProductIndex(index: number) {
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function isMatchingGooglePlayOffer(offer: SubscriptionOffer, basePlanId: string) {
  return offer.basePlanIdAndroid === basePlanId && Boolean(offer.offerTokenAndroid?.trim());
}

function diagnosticMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (!isRecord(error)) return undefined;

  return diagnosticString(error.message);
}

function diagnosticStringField(error: unknown, field: 'debugMessage' | 'platform' | 'productId' | 'underlyingError') {
  if (!isRecord(error)) return undefined;

  return diagnosticString(error[field]);
}

function diagnosticString(value: unknown) {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  return undefined;
}

function diagnosticNumberField(error: unknown, field: 'responseCode') {
  if (!isRecord(error)) return undefined;

  const value = error[field];
  return typeof value === 'number' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeErrorCode(value: string): ErrorCode {
  const code = value.trim();
  const knownCodes = new Set<string>(Object.values(ErrorCode));
  if (knownCodes.has(code)) return code as ErrorCode;

  const normalized = toKebabCase(code);
  if (knownCodes.has(normalized)) return normalized as ErrorCode;

  if (code.startsWith('E_')) {
    const trimmed = code.slice(2);
    if (knownCodes.has(trimmed)) return trimmed as ErrorCode;

    const normalizedTrimmed = toKebabCase(trimmed);
    if (knownCodes.has(normalizedTrimmed)) return normalizedTrimmed as ErrorCode;
  }

  return ErrorCode.Unknown;
}

function isLegacyUserCancelledMessage(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /\b(purchase|payment)\s+cancell?ed\s+by\s+user\b|\bcancell?ed\s+by\s+user\b|\buser\s+cancell?ed\s+(purchase|payment)\b/i.test(message);
}

function toKebabCase(value: string) {
  return value.includes('_')
    ? value
        .split('_')
        .map((word) => word.toLowerCase())
        .join('-')
    : value
        .replace(/([A-Z])/g, '-$1')
        .toLowerCase()
        .replace(/^-/, '');
}

function formatOfferPeriod(value: number | null | undefined, unit: string | null | undefined) {
  if (!value || !unit || unit === 'empty') return null;
  const normalizedUnit = value === 1 ? unit : `${unit}s`;
  return `${value} ${normalizedUnit}`;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
