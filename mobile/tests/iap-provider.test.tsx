import type { SubscriptionSnapshot } from '@web-app-demo/contracts';
import { expect, mock, beforeEach, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type FakeElement = FakeNode & {
  childNodes: FakeNode[];
  firstChild: FakeNode | null;
  namespaceURI: string;
  ownerDocument: typeof fakeDocument;
  style: Record<string, unknown>;
  tagName: string;
};

class FakeNode {
  childNodes: FakeNode[] = [];
  nodeType: number;
  nodeName: string;
  parentNode: FakeNode | null = null;

  constructor(nodeName: string) {
    this.nodeName = nodeName.toUpperCase();
    this.nodeType = nodeName === '#text' ? 3 : 1;
  }

  appendChild(node: FakeNode) {
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }

  insertBefore(node: FakeNode, beforeNode: FakeNode | null) {
    if (!beforeNode) return this.appendChild(node);
    const index = this.childNodes.indexOf(beforeNode);
    if (index === -1) return this.appendChild(node);
    this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    return node;
  }

  removeChild(node: FakeNode) {
    this.childNodes = this.childNodes.filter((child) => child !== node);
    node.parentNode = null;
    return node;
  }

  addEventListener() {}
  removeEventListener() {}

  get firstChild() {
    return this.childNodes[0] ?? null;
  }
}

class FakeDomElement extends FakeNode {
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  ownerDocument = fakeDocument;
  style: Record<string, unknown> = {};
  tagName: string;

  constructor(tagName: string) {
    super(tagName);
    this.tagName = this.nodeName;
  }

  setAttribute() {}
  removeAttribute() {}
}

const fakeDocument = {
  nodeType: 9,
  addEventListener() {},
  removeEventListener() {},
  createElement(tagName: string) {
    return new FakeDomElement(tagName) as FakeElement;
  },
  createElementNS(_namespaceURI: string, tagName: string) {
    return new FakeDomElement(tagName) as FakeElement;
  },
  createTextNode(text: string) {
    const node = new FakeNode('#text');
    Object.assign(node, { data: text, nodeValue: text });
    return node;
  },
};

type Purchase = {
  productId?: string;
  purchaseState?: string;
  purchaseToken?: string | null;
  store?: string;
  transactionId?: string;
};

type UseIapOptions = {
  onPurchaseError?: (error: unknown) => void;
  onPurchaseSuccess?: (purchase: Purchase) => void | Promise<void>;
};

type IapContextProbe = {
  error: string | null;
  isConnected: boolean;
  isManagingSubscriptions: boolean;
  isPurchasing: boolean;
  isSupported: boolean;
  manageSubscriptions: () => Promise<void>;
  platform: string;
  purchase: () => Promise<void>;
  redeemOfferCode: () => Promise<void>;
  restore: () => Promise<void>;
  sync: () => Promise<void>;
};

type NativeHostProps = {
  children?: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
  disabled?: boolean;
  onPress?: () => void;
};

function NativeHost(tagName: string) {
  return function Host({ children, disabled, onPress }: NativeHostProps) {
    return React.createElement(tagName, {
      children: typeof children === 'function' ? children({ pressed: false }) : children,
      disabled,
      onClick: onPress,
    });
  };
}

const inactiveSubscription: SubscriptionSnapshot = {
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
};

const activeSubscription: SubscriptionSnapshot = {
  entitlement: 'premium',
  isActive: true,
  state: 'active',
  platform: 'ios',
  productId: 'premium_monthly',
  originalTransactionId: 'original-1',
  transactionId: 'transaction-1',
  expiresAt: '2026-06-19T00:00:00.000Z',
  willAutoRenew: true,
  updatedAt: '2026-05-19T00:00:00.000Z',
};

const purchase = {
  purchaseState: 'purchased',
  purchaseToken: 'signed-transaction',
  store: 'apple',
  transactionId: 'transaction-1',
};

const pendingPurchase = {
  purchaseState: 'pending',
  purchaseToken: 'signed-pending',
  store: 'apple',
  transactionId: 'transaction-pending',
};

let authState: {
  api: {
    createAppStoreOfferCodeRedemption: ReturnType<typeof mock>;
    ingestGooglePlayTransaction: ReturnType<typeof mock>;
    entitlement: ReturnType<typeof mock>;
    ingestAppStoreTransaction: ReturnType<typeof mock>;
    reconcileGooglePlayTransactions: ReturnType<typeof mock>;
    reconcileAppStoreTransactions: ReturnType<typeof mock>;
  };
  isBootstrapping: boolean;
  setSubscription: ReturnType<typeof mock>;
  user: { id: string; subscription: SubscriptionSnapshot } | null;
};
let availablePurchases: Purchase[] = [];
let deepLinkToSubscriptionsMock: ReturnType<typeof mock> = mock(async () => undefined);
let getAvailablePurchasesMock: ReturnType<typeof mock> = mock(async () => availablePurchases);
let platformOS: 'android' | 'ios' = 'ios';
let presentCodeRedemptionSheetIOSMock: ReturnType<typeof mock> = mock(async () => true);
let useIapCallCount = 0;
let currentIap: {
  availablePurchases: Purchase[];
  connected: boolean;
  fetchProducts: ReturnType<typeof mock>;
  finishTransaction: ReturnType<typeof mock>;
  getAvailablePurchases: ReturnType<typeof mock>;
  requestPurchase: ReturnType<typeof mock>;
  restorePurchases: ReturnType<typeof mock>;
  subscriptions: unknown[];
};
let iapDiagnostics: Array<{ event: string; payload: Record<string, unknown> }> = [];
let latestUseIapOptions: UseIapOptions = {};
let latestContext: IapContextProbe | null = null;
let updateHookAvailablePurchases: ((purchases: Purchase[]) => void) | null = null;

process.env.EXPO_PUBLIC_IAP_ANDROID_MONTHLY_PRODUCT_ID = 'premium';
process.env.EXPO_PUBLIC_IAP_ANDROID_MONTHLY_BASE_PLAN_ID = 'monthly';
process.env.EXPO_PUBLIC_IAP_ANDROID_YEARLY_PRODUCT_ID = 'premium';
process.env.EXPO_PUBLIC_IAP_ANDROID_YEARLY_BASE_PLAN_ID = 'yearly';
process.env.EXPO_PUBLIC_IAP_ANDROID_PACKAGE_NAME = 'com.example.app';

mock.module('react-native', () => ({
  ActivityIndicator: NativeHost('span'),
  AppState: {
    addEventListener() {
      return { remove() {} };
    },
  },
  Modal: NativeHost('div'),
  Platform: {
    get OS() {
      return platformOS;
    },
  },
  Pressable: NativeHost('button'),
  ScrollView: NativeHost('div'),
  StyleSheet: {
    absoluteFillObject: {},
    create<T>(styles: T) {
      return styles;
    },
    hairlineWidth: 1,
  },
  Text: NativeHost('span'),
  View: NativeHost('div'),
  useColorScheme() {
    return 'light';
  },
}));

mock.module('expo-iap', () => ({
  deepLinkToSubscriptions: (options?: unknown) => deepLinkToSubscriptionsMock(options),
  getAvailablePurchases: (options?: unknown) => getAvailablePurchasesMock(options),
  openRedeemOfferCodeAndroid: mock(async () => undefined),
  presentCodeRedemptionSheetIOS: () => presentCodeRedemptionSheetIOSMock(),
  useIAP(options: UseIapOptions) {
    const [hookAvailablePurchases, setHookAvailablePurchases] = React.useState<Purchase[]>(
      currentIap.availablePurchases,
    );
    updateHookAvailablePurchases = setHookAvailablePurchases;
    useIapCallCount += 1;
    latestUseIapOptions = options;
    return {
      ...currentIap,
      availablePurchases: hookAvailablePurchases,
    };
  },
}));

mock.module('@/features/auth', () => ({
  useAuth() {
    return authState;
  },
}));

mock.module('../src/features/billing/iap-diagnostics', () => ({
  trackIapDiagnostic(event: string, payload: Record<string, unknown>) {
    iapDiagnostics.push({ event, payload });
  },
}));

Object.assign(globalThis, {
  document: fakeDocument,
  HTMLElement: FakeDomElement,
  HTMLIFrameElement: class HTMLIFrameElement extends FakeDomElement {},
  IS_REACT_ACT_ENVIRONMENT: true,
  window: globalThis,
});

beforeEach(() => {
  availablePurchases = [];
  deepLinkToSubscriptionsMock = mock(async () => undefined);
  getAvailablePurchasesMock = mock(async () => availablePurchases);
  platformOS = 'ios';
  presentCodeRedemptionSheetIOSMock = mock(async () => true);
  useIapCallCount = 0;
  latestUseIapOptions = {};
  currentIap = {
    availablePurchases: [],
    connected: true,
    fetchProducts: mock(async () => undefined),
    finishTransaction: mock(async () => undefined),
    getAvailablePurchases: mock(async (options?: unknown) => {
      const purchases = await getAvailablePurchasesMock(options);
      currentIap.availablePurchases = purchases;
      updateHookAvailablePurchases?.([...purchases]);
    }),
    requestPurchase: mock(async () => undefined),
    restorePurchases: mock(async () => undefined),
    subscriptions: [],
  };
  iapDiagnostics = [];
  updateHookAvailablePurchases = null;
  authState = {
    api: {
      createAppStoreOfferCodeRedemption: mock(async () => ({ token: 'offer-code-redemption-token' })),
      ingestGooglePlayTransaction: mock(async () => ({
        subscription: { ...activeSubscription, platform: 'android', originalTransactionId: null, productId: 'premium' },
      })),
      entitlement: mock(async () => ({ subscription: inactiveSubscription })),
      ingestAppStoreTransaction: mock(async () => ({ subscription: activeSubscription })),
      reconcileGooglePlayTransactions: mock(async () => ({
        subscription: { ...activeSubscription, platform: 'android', originalTransactionId: null, productId: 'premium' },
      })),
      reconcileAppStoreTransactions: mock(async () => ({ subscription: activeSubscription })),
    },
    isBootstrapping: false,
    setSubscription: mock(() => undefined),
    user: {
      id: '018fd4f2-1f3a-7c88-bc49-333333333333',
      subscription: inactiveSubscription,
    },
  };
  latestContext = null;
});

test('IapProvider finishes purchase callbacks only after backend ingest succeeds', async () => {
  const events: string[] = [];
  authState.api.ingestAppStoreTransaction = mock(async () => {
    events.push('ingest');
    return { subscription: activeSubscription };
  });
  currentIap.finishTransaction = mock(async () => {
    events.push('finish');
  });

  const root = await renderProvider();

  await act(async () => {
    await latestUseIapOptions.onPurchaseSuccess?.(purchase);
    await waitForEffects();
  });

  expect(events).toEqual(['ingest', 'finish']);
  expect(authState.api.ingestAppStoreTransaction).toHaveBeenCalledWith({
    signedTransactionInfo: 'signed-transaction',
  });
  expect(currentIap.finishTransaction).toHaveBeenCalledTimes(1);
  await unmount(root);
});

test('IapProvider starts StoreKit listeners before auth resolves and processes queued purchases after login', async () => {
  authState.user = null;

  const root = await renderProvider();

  expect(useIapCallCount).toBeGreaterThan(0);

  await act(async () => {
    await latestUseIapOptions.onPurchaseSuccess?.(purchase);
    await waitForEffects();
  });

  expect(authState.api.ingestAppStoreTransaction).not.toHaveBeenCalled();
  expect(currentIap.finishTransaction).not.toHaveBeenCalled();

  authState.user = {
    id: '018fd4f2-1f3a-7c88-bc49-333333333333',
    subscription: inactiveSubscription,
  };

  await rerenderProvider(root);
  await waitForEffects();

  expect(authState.api.ingestAppStoreTransaction).toHaveBeenCalledWith({
    signedTransactionInfo: 'signed-transaction',
  });
  expect(currentIap.finishTransaction).toHaveBeenCalledTimes(1);
  await unmount(root);
});

test('IapProvider keeps purchase intent pending until StoreKit sends a purchase callback', async () => {
  currentIap.subscriptions = [
    {
      displayName: 'Premium',
      displayPrice: '$9.99',
      id: 'premium_monthly',
      title: 'Premium Monthly',
    },
  ];

  const root = await renderProvider();

  await act(async () => {
    await latestContext?.purchase();
    await waitForEffects();
  });

  expect(currentIap.requestPurchase).toHaveBeenCalledTimes(1);
  expect(latestContext?.isPurchasing).toBe(true);

  await act(async () => {
    await latestContext?.purchase();
    await waitForEffects();
  });

  expect(currentIap.requestPurchase).toHaveBeenCalledTimes(1);

  await act(async () => {
    await latestUseIapOptions.onPurchaseSuccess?.(purchase);
    await waitForEffects();
  });

  expect(latestContext?.isPurchasing).toBe(false);
  expect(currentIap.finishTransaction).toHaveBeenCalledTimes(1);
  await unmount(root);
});

test('IapProvider allows retrying a purchase after StoreKit sends an error callback', async () => {
  currentIap.subscriptions = [
    {
      displayName: 'Premium',
      displayPrice: '$9.99',
      id: 'premium_monthly',
      title: 'Premium Monthly',
    },
  ];

  const root = await renderProvider();

  await act(async () => {
    await latestContext?.purchase();
    await waitForEffects();
  });

  expect(currentIap.requestPurchase).toHaveBeenCalledTimes(1);
  expect(latestContext?.isPurchasing).toBe(true);

  await act(async () => {
    latestUseIapOptions.onPurchaseError?.({ code: 'network-error' });
    await waitForEffects();
  });

  expect(latestContext?.isPurchasing).toBe(false);
  expect(latestContext?.error).toContain('temporarily unavailable');

  await act(async () => {
    await latestContext?.purchase();
    await waitForEffects();
  });

  expect(currentIap.requestPurchase).toHaveBeenCalledTimes(2);
  expect(latestContext?.isPurchasing).toBe(true);
  await unmount(root);
});

test('IapProvider records structured StoreKit error diagnostics', async () => {
  const root = await renderProvider();

  await act(async () => {
    latestUseIapOptions.onPurchaseError?.({
      code: 'network-error',
      debugMessage: 'StoreKit request timed out',
      message: 'Network down',
      platform: 'ios',
      productId: 'premium_monthly',
      responseCode: 2,
      underlyingError: new Error('NSURLErrorDomain -1009'),
    });
    await waitForEffects();
  });

  expect(iapDiagnostics).toContainEqual({
    event: 'purchase-error',
    payload: {
      code: 'network-error',
      debugMessage: 'StoreKit request timed out',
      message: 'Network down',
      network: true,
      platform: 'ios',
      productId: 'premium_monthly',
      responseCode: 2,
      retryable: true,
      underlyingError: 'NSURLErrorDomain -1009',
    },
  });
  expect(latestContext?.error).toContain('temporarily unavailable');
  await unmount(root);
});

test('IapProvider does not treat generic payment-cancelled messages as user cancellations', async () => {
  const root = await renderProvider();

  await act(async () => {
    latestUseIapOptions.onPurchaseError?.(new Error('Payment cancelled'));
    await waitForEffects();
  });

  expect(latestContext?.error).toContain('temporarily unavailable');
  expect(iapDiagnostics).toContainEqual({
    event: 'purchase-error',
    payload: {
      code: null,
      debugMessage: undefined,
      message: 'Payment cancelled',
      network: false,
      platform: 'ios',
      productId: undefined,
      responseCode: undefined,
      retryable: false,
      underlyingError: undefined,
    },
  });
  await unmount(root);
});

test('IapProvider allows retrying a purchase after StoreKit sends a non-ingestable success callback', async () => {
  currentIap.subscriptions = [
    {
      displayName: 'Premium',
      displayPrice: '$9.99',
      id: 'premium_monthly',
      title: 'Premium Monthly',
    },
  ];

  const root = await renderProvider();

  await act(async () => {
    await latestContext?.purchase();
    await waitForEffects();
  });

  expect(currentIap.requestPurchase).toHaveBeenCalledTimes(1);
  expect(latestContext?.isPurchasing).toBe(true);

  await act(async () => {
    await latestUseIapOptions.onPurchaseSuccess?.({
      purchaseState: 'purchased',
      purchaseToken: null,
      store: 'apple',
      transactionId: 'transaction-without-token',
    });
    await waitForEffects();
  });

  expect(latestContext?.isPurchasing).toBe(false);
  expect(latestContext?.error).toContain('missing signed transaction info');

  await act(async () => {
    await latestContext?.purchase();
    await waitForEffects();
  });

  expect(currentIap.requestPurchase).toHaveBeenCalledTimes(2);
  expect(latestContext?.isPurchasing).toBe(true);
  await unmount(root);
});

test('IapProvider restore reconciles available purchases with the backend before finishing', async () => {
  const events: string[] = [];
  authState.user = {
    id: '018fd4f2-1f3a-7c88-bc49-333333333333',
    subscription: {
      ...inactiveSubscription,
      originalTransactionId: 'original-1',
    },
  };
  authState.api.ingestAppStoreTransaction = mock(async () => {
    events.push('ingest');
    return { subscription: activeSubscription };
  });
  authState.api.reconcileAppStoreTransactions = mock(async () => {
    events.push('reconcile');
    return { subscription: activeSubscription };
  });
  currentIap.finishTransaction = mock(async () => {
    events.push('finish');
  });

  const root = await renderProvider();
  availablePurchases = [purchase];

  await act(async () => {
    await latestContext?.restore();
    await waitForEffects();
  });

  expect(events).toEqual(['ingest', 'finish', 'reconcile']);
  expect(currentIap.restorePurchases).toHaveBeenCalledWith({
    alsoPublishToEventListenerIOS: false,
    onlyIncludeActiveItemsIOS: false,
  });
  expect(getAvailablePurchasesMock).toHaveBeenLastCalledWith({
    alsoPublishToEventListenerIOS: false,
    onlyIncludeActiveItemsIOS: false,
  });
  expect(authState.api.ingestAppStoreTransaction).toHaveBeenCalledWith({
    signedTransactionInfo: 'signed-transaction',
  });
  expect(authState.api.reconcileAppStoreTransactions).toHaveBeenCalledWith({
    originalTransactionIds: ['original-1'],
  });
  await unmount(root);
});

test('IapProvider opens the iOS offer-code sheet and attaches the redemption token to the next purchase', async () => {
  const root = await renderProvider();

  await act(async () => {
    await latestContext?.redeemOfferCode();
    await waitForEffects();
  });

  expect(authState.api.createAppStoreOfferCodeRedemption).toHaveBeenCalledTimes(1);
  expect(presentCodeRedemptionSheetIOSMock).toHaveBeenCalledTimes(1);

  await act(async () => {
    await latestUseIapOptions.onPurchaseSuccess?.(purchase);
    await waitForEffects();
  });

  expect(authState.api.ingestAppStoreTransaction).toHaveBeenCalledWith({
    offerCodeRedemptionToken: 'offer-code-redemption-token',
    signedTransactionInfo: 'signed-transaction',
  });
  expect(currentIap.finishTransaction).toHaveBeenCalledTimes(1);
  expect(authState.setSubscription).toHaveBeenCalledWith(activeSubscription);
  await unmount(root);
});

test('IapProvider accepts offer-code sheet implementations that return no result', async () => {
  presentCodeRedemptionSheetIOSMock = mock(async () => undefined);

  const root = await renderProvider();

  await act(async () => {
    await latestContext?.redeemOfferCode();
    await waitForEffects();
  });

  expect(authState.api.createAppStoreOfferCodeRedemption).toHaveBeenCalledTimes(1);
  expect(presentCodeRedemptionSheetIOSMock).toHaveBeenCalledTimes(1);
  expect(latestContext?.error).toBeNull();
  expect(authState.api.entitlement).toHaveBeenCalled();
  await unmount(root);
});

test('IapProvider attaches offer-code redemption tokens to available-purchases recovery', async () => {
  const root = await renderProvider();

  await act(async () => {
    await latestContext?.redeemOfferCode();
    await waitForEffects();
  });

  availablePurchases = [purchase];

  await act(async () => {
    await latestContext?.sync();
    await waitForEffects();
  });

  expect(authState.api.ingestAppStoreTransaction).toHaveBeenCalledWith({
    offerCodeRedemptionToken: 'offer-code-redemption-token',
    signedTransactionInfo: 'signed-transaction',
  });
  expect(currentIap.finishTransaction).toHaveBeenCalledTimes(1);
  await unmount(root);
});

test('IapProvider drops stale offer-code redemption tokens before later purchases', async () => {
  const originalNow = Date.now;
  let now = new Date('2026-05-19T00:00:00.000Z').getTime();
  Date.now = () => now;

  try {
    const root = await renderProvider();

    await act(async () => {
      await latestContext?.redeemOfferCode();
      await waitForEffects();
    });

    now += 15 * 60 * 1000;

    await act(async () => {
      await latestUseIapOptions.onPurchaseSuccess?.(purchase);
      await waitForEffects();
    });

    expect(authState.api.ingestAppStoreTransaction).toHaveBeenCalledWith({
      signedTransactionInfo: 'signed-transaction',
    });
    expect(currentIap.finishTransaction).toHaveBeenCalledTimes(1);
    await unmount(root);
  } finally {
    Date.now = originalNow;
  }
});

test('IapProvider surfaces offer-code sheet failures without ingesting a transaction', async () => {
  const originalWarn = console.warn;
  console.warn = mock(() => undefined) as never;
  presentCodeRedemptionSheetIOSMock = mock(async () => false);

  try {
    const root = await renderProvider();

    await act(async () => {
      await latestContext?.redeemOfferCode();
      await waitForEffects();
    });

    expect(authState.api.createAppStoreOfferCodeRedemption).toHaveBeenCalledTimes(1);
    expect(latestContext?.error).toContain('temporarily unavailable');
    expect(authState.api.ingestAppStoreTransaction).not.toHaveBeenCalled();
    await unmount(root);
  } finally {
    console.warn = originalWarn;
  }
});

test('IapProvider ignores user-cancelled offer-code redemption sheets', async () => {
  const originalWarn = console.warn;
  console.warn = mock(() => undefined) as never;
  presentCodeRedemptionSheetIOSMock = mock(async () => {
    throw { code: 'user-cancelled' };
  });

  try {
    const root = await renderProvider();

    await act(async () => {
      await latestContext?.redeemOfferCode();
      await waitForEffects();
    });

    expect(authState.api.createAppStoreOfferCodeRedemption).toHaveBeenCalledTimes(1);
    expect(latestContext?.error).toBeNull();
    expect(authState.api.ingestAppStoreTransaction).not.toHaveBeenCalled();
    await unmount(root);
  } finally {
    console.warn = originalWarn;
  }
});

test('IapProvider purchases Android subscriptions through Google Play before finishing', async () => {
  platformOS = 'android';
  currentIap.subscriptions = [androidSubscriptionProduct()];

  const root = await renderProvider();
  await waitForEffects();

  expect(useIapCallCount).toBeGreaterThan(0);
  expect(latestContext?.platform).toBe('android');
  expect(latestContext?.isSupported).toBe(true);
  expect(latestContext?.isConnected).toBe(true);

  await act(async () => {
    await latestContext?.purchase();
    await waitForEffects();
  });

  expect(currentIap.requestPurchase).toHaveBeenCalledWith({
    type: 'subs',
    request: {
      google: {
        skus: ['premium'],
        obfuscatedAccountId: '018fd4f2-1f3a-7c88-bc49-333333333333',
        obfuscatedProfileId: '018fd4f2-1f3a-7c88-bc49-333333333333',
        subscriptionOffers: [{ sku: 'premium', offerToken: 'monthly-offer-token' }],
      },
    },
  });

  await act(async () => {
    await latestUseIapOptions.onPurchaseSuccess?.({
      productId: 'premium',
      purchaseState: 'purchased',
      purchaseToken: 'google-purchase-token',
      store: 'google',
      transactionId: 'GPA.1234',
    });
    await waitForEffects();
  });

  expect(authState.api.ingestGooglePlayTransaction).toHaveBeenCalledWith({
    basePlanId: 'monthly',
    productId: 'premium',
    purchaseToken: 'google-purchase-token',
  });
  expect(currentIap.finishTransaction).toHaveBeenCalledTimes(1);
  await unmount(root);
});

test('IapProvider restore reconciles Android available purchases without StoreKit restore', async () => {
  platformOS = 'android';
  currentIap.subscriptions = [androidSubscriptionProduct()];
  availablePurchases = [
    {
      productId: 'premium',
      purchaseState: 'purchased',
      purchaseToken: 'google-purchase-token',
      store: 'google',
      transactionId: 'GPA.1234',
    },
  ];

  const root = await renderProvider();
  await waitForEffects();
  authState.api.reconcileGooglePlayTransactions = mock(async () => ({ subscription: inactiveSubscription }));

  await act(async () => {
    await latestContext?.restore();
    await waitForEffects();
  });

  expect(currentIap.restorePurchases).not.toHaveBeenCalled();
  expect(authState.api.reconcileGooglePlayTransactions).toHaveBeenCalledWith({
    purchases: [
      {
        productId: 'premium',
        purchaseToken: 'google-purchase-token',
      },
    ],
  });
  await unmount(root);
});

test('IapProvider restore does not mask StoreKit restore failures as empty restores', async () => {
  const originalWarn = console.warn;
  console.warn = mock(() => undefined) as never;
  currentIap.restorePurchases = mock(async () => {
    throw { code: 'network-error' };
  });

  try {
    const root = await renderProvider();

    await act(async () => {
      await latestContext?.restore();
      await waitForEffects();
    });

    expect(latestContext?.error).toContain('temporarily unavailable');
    expect(authState.api.reconcileAppStoreTransactions).not.toHaveBeenCalled();
    await unmount(root);
  } finally {
    console.warn = originalWarn;
  }
});

test('IapProvider restore surfaces pending StoreKit purchases without ingesting or finishing', async () => {
  let availablePurchaseCalls = 0;
  getAvailablePurchasesMock = mock(async () => {
    availablePurchaseCalls += 1;
    return availablePurchaseCalls === 1 ? [] : [pendingPurchase];
  });

  const root = await renderProvider();
  await waitForEffects();

  await act(async () => {
    await latestContext?.restore();
    await waitForEffects();
  });

  expect(latestContext?.error).toContain('pending approval');
  expect(authState.api.ingestAppStoreTransaction).not.toHaveBeenCalled();
  expect(currentIap.finishTransaction).not.toHaveBeenCalled();
  await unmount(root);
});

test('IapProvider startup sync surfaces pending StoreKit purchases without ingesting or finishing', async () => {
  availablePurchases = [pendingPurchase];

  const root = await renderProvider();
  await waitForEffects();

  expect(latestContext?.error).toContain('pending approval');
  expect(authState.api.ingestAppStoreTransaction).not.toHaveBeenCalled();
  expect(currentIap.finishTransaction).not.toHaveBeenCalled();
  await unmount(root);
});

test('IapProvider restore ignores user-cancelled restore sheets', async () => {
  const originalWarn = console.warn;
  console.warn = mock(() => undefined) as never;
  authState.user = {
    id: '018fd4f2-1f3a-7c88-bc49-333333333333',
    subscription: {
      ...inactiveSubscription,
      originalTransactionId: 'original-1',
    },
  };
  currentIap.restorePurchases = mock(async () => {
    throw { code: 'user-cancelled' };
  });

  try {
    const root = await renderProvider();

    await act(async () => {
      await latestContext?.restore();
      await waitForEffects();
    });

    expect(latestContext?.error).toBeNull();
    expect(authState.api.reconcileAppStoreTransactions).not.toHaveBeenCalled();
    expect(currentIap.finishTransaction).not.toHaveBeenCalled();
    await unmount(root);
  } finally {
    console.warn = originalWarn;
  }
});

test('IapProvider restore surfaces StoreKit failures for linked original transactions without local purchases', async () => {
  const originalWarn = console.warn;
  console.warn = mock(() => undefined) as never;
  authState.user = {
    id: '018fd4f2-1f3a-7c88-bc49-333333333333',
    subscription: {
      ...inactiveSubscription,
      originalTransactionId: 'original-1',
    },
  };
  currentIap.restorePurchases = mock(async () => {
    throw { code: 'network-error' };
  });
  authState.api.reconcileAppStoreTransactions = mock(async () => ({ subscription: inactiveSubscription }));

  try {
    const root = await renderProvider();

    await act(async () => {
      await latestContext?.restore();
      await waitForEffects();
    });

    expect(latestContext?.error).toContain('temporarily unavailable');
    expect(authState.api.reconcileAppStoreTransactions).toHaveBeenCalledWith({
      originalTransactionIds: ['original-1'],
    });
    await unmount(root);
  } finally {
    console.warn = originalWarn;
  }
});

test('IapProvider sync does not finish purchases already being processed by purchase callback', async () => {
  let resolveIngest: ((value: { subscription: SubscriptionSnapshot }) => void) | null = null;
  authState.api.ingestAppStoreTransaction = mock(
    () =>
      new Promise((resolve) => {
        resolveIngest = resolve;
      }),
  );

  const root = await renderProvider();

  await act(async () => {
    latestUseIapOptions.onPurchaseSuccess?.(purchase);
    await waitForEffects();
  });
  availablePurchases = [purchase];

  await act(async () => {
    await latestContext?.sync();
    await waitForEffects();
  });

  expect(authState.api.reconcileAppStoreTransactions).not.toHaveBeenCalled();
  expect(currentIap.finishTransaction).not.toHaveBeenCalled();

  await act(async () => {
    resolveIngest?.({ subscription: activeSubscription });
    await waitForEffects();
  });

  expect(currentIap.finishTransaction).toHaveBeenCalledTimes(1);
  await unmount(root);
});

test('IapProvider grants backend-verified purchases even when StoreKit finish fails', async () => {
  const originalWarn = console.warn;
  console.warn = mock(() => undefined) as never;
  currentIap.finishTransaction = mock(async () => {
    throw new Error('finish failed');
  });

  try {
    const root = await renderProvider();

    await act(async () => {
      await latestUseIapOptions.onPurchaseSuccess?.(purchase);
      await waitForEffects();
    });

    expect(authState.setSubscription).toHaveBeenCalledWith(activeSubscription);
    expect(currentIap.finishTransaction).toHaveBeenCalledTimes(1);

    currentIap.finishTransaction = mock(async () => undefined);
    availablePurchases = [purchase];

    await act(async () => {
    await latestContext?.sync();
    await waitForEffects();
  });

    expect(authState.api.ingestAppStoreTransaction).toHaveBeenCalledTimes(2);
    expect(authState.api.ingestAppStoreTransaction).toHaveBeenLastCalledWith({
      signedTransactionInfo: 'signed-transaction',
    });
    expect(currentIap.finishTransaction).toHaveBeenCalledTimes(1);
    await unmount(root);
  } finally {
    console.warn = originalWarn;
  }
});

test('IapProvider does not finish available purchases that backend ingest rejects', async () => {
  const originalWarn = console.warn;
  console.warn = mock(() => undefined) as never;
  const rejectedPurchase = {
    ...purchase,
    purchaseToken: 'signed-invalid',
    transactionId: 'transaction-invalid',
  };
  authState.user = {
    id: '018fd4f2-1f3a-7c88-bc49-333333333333',
    subscription: activeSubscription,
  };
  authState.api.entitlement = mock(async () => ({ subscription: activeSubscription }));
  authState.api.ingestAppStoreTransaction = mock(async () => {
    throw new Error('backend rejected purchase');
  });
  authState.api.reconcileAppStoreTransactions = mock(async () => ({ subscription: activeSubscription }));
  availablePurchases = [rejectedPurchase];

  try {
    const root = await renderProvider();
    await waitForEffects();

    expect(authState.api.ingestAppStoreTransaction).toHaveBeenCalledWith({
      signedTransactionInfo: 'signed-invalid',
    });
    expect(authState.api.reconcileAppStoreTransactions).toHaveBeenCalledWith({
      originalTransactionIds: ['original-1'],
    });
    expect(currentIap.finishTransaction).not.toHaveBeenCalled();
    await unmount(root);
  } finally {
    console.warn = originalWarn;
  }
});

test('IapProvider startup sync scans non-active StoreKit purchases for unfinished cleanup', async () => {
  authState.user = {
    id: '018fd4f2-1f3a-7c88-bc49-333333333333',
    subscription: activeSubscription,
  };
  authState.api.entitlement = mock(async () => ({ subscription: activeSubscription }));
  availablePurchases = [purchase];

  const root = await renderProvider();
  await waitForEffects();

  expect(getAvailablePurchasesMock).toHaveBeenCalledWith({
    alsoPublishToEventListenerIOS: false,
    onlyIncludeActiveItemsIOS: false,
  });
  expect(authState.api.ingestAppStoreTransaction).toHaveBeenCalledWith({
    signedTransactionInfo: 'signed-transaction',
  });
  expect(currentIap.finishTransaction).toHaveBeenCalledTimes(1);
  await unmount(root);
});

test('IapProvider reconciles known original transactions even before StoreKit connects', async () => {
  currentIap.connected = false;
  authState.user = {
    id: '018fd4f2-1f3a-7c88-bc49-333333333333',
    subscription: activeSubscription,
  };
  authState.api.entitlement = mock(async () => ({ subscription: activeSubscription }));

  const root = await renderProvider();
  await waitForEffects();

  expect(authState.api.entitlement).toHaveBeenCalledTimes(1);
  expect(authState.api.reconcileAppStoreTransactions).toHaveBeenCalledWith({
    originalTransactionIds: ['original-1'],
  });
  expect(currentIap.fetchProducts).not.toHaveBeenCalled();
  expect(currentIap.finishTransaction).not.toHaveBeenCalled();
  await unmount(root);
});

test('IapProvider falls back to server reconcile when available purchases fail for a known original transaction', async () => {
  const originalWarn = console.warn;
  console.warn = mock(() => undefined) as never;
  authState.user = {
    id: '018fd4f2-1f3a-7c88-bc49-333333333333',
    subscription: activeSubscription,
  };
  authState.api.entitlement = mock(async () => ({ subscription: activeSubscription }));
  getAvailablePurchasesMock = mock(async () => {
    throw { code: 'unknown' };
  });

  try {
    const root = await renderProvider();
    await waitForEffects();

    expect(getAvailablePurchasesMock).toHaveBeenCalledTimes(1);
    expect(authState.api.reconcileAppStoreTransactions).toHaveBeenCalledWith({
      originalTransactionIds: ['original-1'],
    });
    expect(currentIap.finishTransaction).not.toHaveBeenCalled();
    await unmount(root);
  } finally {
    console.warn = originalWarn;
  }
});

test('IapProvider does not resync just because an unchanged subscription rerenders auth state', async () => {
  authState.setSubscription = mock((subscription: SubscriptionSnapshot) => {
    if (!authState.user) return;
    authState.user = {
      ...authState.user,
      subscription: { ...subscription },
    };
  });

  const root = await renderProvider();
  await waitForEffects();

  expect(authState.api.entitlement).toHaveBeenCalledTimes(1);

  await rerenderProvider(root);
  await waitForEffects();

  expect(authState.api.entitlement).toHaveBeenCalledTimes(1);
});

test('IapProvider blocks store actions while the App Store connection is not ready', async () => {
  currentIap.connected = false;
  currentIap.subscriptions = [
    {
      displayName: 'Premium',
      displayPrice: '$9.99',
      id: 'premium_monthly',
      title: 'Premium Monthly',
    },
  ];

  const root = await renderProvider();

  await act(async () => {
    await latestContext?.purchase();
    await waitForEffects();
  });

  expect(latestContext?.error).toBe('App Store connection is not ready yet. Please try again in a moment.');
  expect(currentIap.requestPurchase).not.toHaveBeenCalled();
  expect(authState.api.ingestAppStoreTransaction).not.toHaveBeenCalled();

  await act(async () => {
    await latestContext?.restore();
    await waitForEffects();
  });

  expect(latestContext?.error).toBe('App Store connection is not ready yet. Please try again in a moment.');
  expect(currentIap.restorePurchases).not.toHaveBeenCalled();
  expect(authState.api.reconcileAppStoreTransactions).not.toHaveBeenCalled();

  await act(async () => {
    await latestContext?.redeemOfferCode();
    await waitForEffects();
  });

  expect(latestContext?.error).toBe('App Store connection is not ready yet. Please try again in a moment.');
  expect(authState.api.createAppStoreOfferCodeRedemption).not.toHaveBeenCalled();
  expect(presentCodeRedemptionSheetIOSMock).not.toHaveBeenCalled();

  await act(async () => {
    await latestContext?.manageSubscriptions();
    await waitForEffects();
  });

  expect(latestContext?.error).toBe('App Store connection is not ready yet. Please try again in a moment.');
  expect(deepLinkToSubscriptionsMock).not.toHaveBeenCalled();
  await unmount(root);
});

function androidSubscriptionProduct() {
  return {
    description: 'Premium access',
    displayName: 'Premium',
    displayPrice: '$4.99',
    id: 'premium',
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
    title: 'Premium',
  };
}

async function renderProvider() {
  const container = fakeDocument.createElement('div');
  const root = createRoot(container);

  await renderProviderTree(root);

  return root;
}

async function rerenderProvider(root: Root) {
  await renderProviderTree(root);
}

async function renderProviderTree(root: Root) {
  const { IapProvider, useSubscriptionIap } = await import('../src/features/billing/provider');

  function Probe() {
    latestContext = useSubscriptionIap();
    return null;
  }

  await act(async () => {
    root.render(
      <IapProvider api={authState.api}>
        <Probe />
      </IapProvider>,
    );
    await waitForEffects();
  });
}

function waitForEffects() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function unmount(root: Root) {
  await act(async () => {
    root.unmount();
    await waitForEffects();
  });
}
