import { expect, mock, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type FakeElement = FakeNode & {
  attributes: Record<string, string>;
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
    const index = this.childNodes.indexOf(node);
    if (index !== -1) {
      this.childNodes.splice(index, 1);
    }
    node.parentNode = null;
    return node;
  }

  addEventListener() {}
  removeEventListener() {}

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    this.childNodes = value ? [new FakeTextNode(value)] : [];
    for (const child of this.childNodes) {
      child.parentNode = this;
    }
  }
}

class FakeTextNode extends FakeNode {
  data: string;
  nodeValue: string;

  constructor(text: string) {
    super('#text');
    this.data = text;
    this.nodeValue = text;
  }

  get textContent() {
    return this.nodeValue;
  }

  set textContent(value: string) {
    this.data = value;
    this.nodeValue = value;
  }
}

class FakeDomElement extends FakeNode {
  attributes: Record<string, string> = {};
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  ownerDocument = fakeDocument;
  style: Record<string, unknown> = {};
  tagName: string;

  constructor(tagName: string) {
    super(tagName);
    this.tagName = this.nodeName;
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name: string) {
    delete this.attributes[name];
  }
}

const fakeDocument = {
  nodeType: 9,
  addEventListener() {},
  removeEventListener() {},
  createElement(tagName: string) {
    return new FakeDomElement(tagName) as FakeElement;
  },
  createElementNS(namespaceURI: string, tagName: string) {
    const element = new FakeDomElement(tagName) as FakeElement;
    element.namespaceURI = namespaceURI;
    return element;
  },
  createTextNode(text: string) {
    return new FakeTextNode(text);
  },
};

type NativeHostProps = {
  'aria-current'?: unknown;
  accessible?: boolean;
  accessibilityLabel?: unknown;
  accessibilityLiveRegion?: 'assertive' | 'none' | 'polite';
  accessibilityRole?: unknown;
  accessibilityState?: {
    checked?: boolean | 'mixed';
    disabled?: boolean;
    selected?: boolean;
  };
  children?: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
  disabled?: boolean;
  onPress?: () => void;
  pointerEvents?: unknown;
  role?: unknown;
  style?: unknown;
  testID?: string;
};

function NativeHost(tagName: string) {
  return function Host({
    'aria-current': ariaCurrent,
    accessible: _accessible,
    accessibilityLabel,
    accessibilityLiveRegion,
    accessibilityRole,
    accessibilityState,
    children,
    disabled,
    onPress,
    pointerEvents: _pointerEvents,
    role,
    style: _style,
    testID,
  }: NativeHostProps) {
    return React.createElement(tagName, {
      'aria-current': ariaCurrent,
      'aria-checked': accessibilityState?.checked,
      'aria-label': accessibilityLabel,
      'aria-live':
        accessibilityLiveRegion === 'none' ? undefined : accessibilityLiveRegion,
      'aria-selected': accessibilityState?.selected,
      children: typeof children === 'function' ? children({ pressed: false }) : children,
      'data-testid': testID,
      disabled,
      onClick: onPress,
      role: role ?? accessibilityRole,
    });
  };
}

const platform = {
  OS: 'web',
  select<T>(values: { android?: T; default?: T; ios?: T; web?: T }) {
    return values.web ?? values.default ?? values.ios ?? values.android;
  },
};

mock.module('react-native', () => ({
  ActivityIndicator: NativeHost('span'),
  Modal: NativeHost('div'),
  Platform: platform,
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
  TextInput: NativeHost('input'),
  View: NativeHost('div'),
  useColorScheme() {
    return 'light';
  },
}));

mock.module('react-native-safe-area-context', () => ({
  SafeAreaView: NativeHost('div'),
}));

mock.module('expo-symbols', () => ({
  SymbolView: NativeHost('span'),
}));

mock.module('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({
    back: () => undefined,
    canGoBack: () => false,
    push: () => undefined,
    replace: () => undefined,
  }),
}));

Object.assign(globalThis, {
  document: fakeDocument,
  HTMLElement: FakeDomElement,
  HTMLIFrameElement: class HTMLIFrameElement extends FakeDomElement {},
  IS_REACT_ACT_ENVIRONMENT: true,
  window: globalThis,
});

function waitForEffects() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function renderAndFlush(root: Root, element: React.ReactNode) {
  await act(async () => {
    root.render(element);
    await waitForEffects();
  });
}

function findByTestID(node: FakeNode, testID: string): FakeElement | null {
  if (
    node instanceof FakeDomElement &&
    node.attributes['data-testid'] === testID
  ) {
    return node as FakeElement;
  }

  for (const child of node.childNodes) {
    const match = findByTestID(child, testID);
    if (match) return match;
  }

  return null;
}

function findByRole(node: FakeNode, role: string): FakeElement | null {
  if (
    node instanceof FakeDomElement &&
    node.attributes.role === role
  ) {
    return node as FakeElement;
  }

  for (const child of node.childNodes) {
    const match = findByRole(child, role);
    if (match) return match;
  }

  return null;
}

function containsNode(ancestor: FakeNode, candidate: FakeNode) {
  if (ancestor === candidate) return true;
  return ancestor.childNodes.some((child) => containsNode(child, candidate));
}

test('alerts expose a polite cross-platform announcement landmark', async () => {
  const { Alert, AlertDescription, AlertTitle } =
    await import('../src/components/ui/alert');
  const container = fakeDocument.createElement('div');
  const root = createRoot(container);

  await renderAndFlush(
    root,
    <Alert variant="destructive">
      <AlertTitle>Session action needs attention</AlertTitle>
      <AlertDescription>Try again.</AlertDescription>
    </Alert>,
  );

  expect((container.firstChild as FakeElement).attributes.role).toBe('alert');
  expect((container.firstChild as FakeElement).attributes['aria-live']).toBe(
    'polite',
  );

  await act(async () => root.unmount());
});

test('error-state actions remain outside the accessible alert group', async () => {
  const { ScreenState } =
    await import('../src/components/dashboard/ScreenState');
  const { Button } = await import('../src/components/ui/button');
  const container = fakeDocument.createElement('div');
  const root = createRoot(container);

  await renderAndFlush(
    root,
    <ScreenState
      action={<Button testID="retry-session">Try again</Button>}
      description="The server could not be reached."
      status="error"
      title="Session recovery"
    />,
  );

  const alert = findByRole(container, 'alert');
  const action = findByTestID(container, 'retry-session');

  expect(alert).not.toBeNull();
  expect(action).not.toBeNull();
  expect(containsNode(alert!, action!)).toBe(false);

  await act(async () => root.unmount());
});

test('auth mode chooser exposes labelled tab semantics', async () => {
  const { AuthModeTabs } =
    await import('../src/features/auth/components/auth-mode-tabs');
  const container = fakeDocument.createElement('div');
  const root = createRoot(container);

  await renderAndFlush(
    root,
    <AuthModeTabs
      loginTestID="auth.login"
      mode="register"
      onModeChange={() => undefined}
      registerTestID="auth.register"
    />,
  );

  const tabList = container.firstChild as FakeElement;
  const registerTab = findByTestID(tabList, 'auth.register');
  const loginTab = findByTestID(tabList, 'auth.login');

  expect(tabList.attributes.role).toBe('tablist');
  expect(tabList.attributes['aria-label']).toBe('Authentication mode');
  expect(registerTab?.attributes.role).toBe('tab');
  expect(registerTab?.attributes['aria-selected']).toBe('true');
  expect(loginTab?.attributes.role).toBe('tab');
  expect(loginTab?.attributes['aria-selected']).toBe('false');

  await act(async () => root.unmount());
});

test('bottom navigation item exposes active and disabled tab state', async () => {
  const { BottomNavigationItem } =
    await import('../src/components/dashboard/BottomNavigationItem');
  const container = fakeDocument.createElement('div');
  const root = createRoot(container);

  await renderAndFlush(
    root,
    <BottomNavigationItem
      disabled
      icon={{
        android: 'person',
        ios: 'person.crop.circle.fill',
        web: 'person',
      }}
      isActive
      label="Profile"
      testID="tabs.profile"
    />,
  );

  const item = findByTestID(container, 'tabs.profile');
  expect(item?.attributes.role).toBe('tab');
  expect(item?.attributes['aria-current']).toBe('page');
  expect(item?.attributes['aria-selected']).toBe('true');
  expect(item?.attributes.disabled).toBe('');

  await renderAndFlush(
    root,
    <BottomNavigationItem
      icon={{
        android: 'view_module',
        ios: 'square.grid.2x2.fill',
        web: 'view_module',
      }}
      isActive={false}
      label="Components"
      testID="tabs.components"
    />,
  );

  expect(
    findByTestID(container, 'tabs.components')?.attributes['aria-current'],
  ).toBeUndefined();

  await act(async () => root.unmount());
});

test('profile controls reflect store connection and logout progress', async () => {
  const { SubscriptionSummary } =
    await import('../src/features/billing/components/subscription-summary');
  const { SessionControls } =
    await import('../src/features/auth/components/session-controls');
  const container = fakeDocument.createElement('div');
  const root = createRoot(container);
  const subscription = {
    entitlement: 'premium' as const,
    expiresAt: '2026-08-20T12:00:00.000Z',
    isActive: true,
    originalTransactionId: 'original-1',
    platform: 'ios' as const,
    productId: 'premium.monthly',
    state: 'active' as const,
    transactionId: 'transaction-1',
    updatedAt: '2026-07-20T12:00:00.000Z',
    willAutoRenew: true,
  };

  await renderAndFlush(
    root,
    <SubscriptionSummary
      isConnected={false}
      isManaging={false}
      onManage={() => undefined}
      subscription={subscription}
    />,
  );

  expect(
    findByTestID(container, 'profile.manage-subscription-button')?.attributes
      .disabled,
  ).toBe('');

  await renderAndFlush(
    root,
    <SessionControls isLoggingOut onLogout={() => undefined} />,
  );

  expect(
    findByTestID(container, 'auth.logout-button')?.attributes.disabled,
  ).toBe('');

  await act(async () => root.unmount());
});

test('paywall actions preserve purchase, restore, and platform availability states', async () => {
  const { PaywallActions } =
    await import('../src/features/billing/components/paywall-components');
  const container = fakeDocument.createElement('div');
  const root = createRoot(container);

  await renderAndFlush(
    root,
    <PaywallActions
      canRestore={false}
      isPurchasing={false}
      isRedeemingOfferCode={false}
      isRestoring={false}
      isSyncing={false}
      onPurchase={() => undefined}
      onRedeemOfferCode={() => undefined}
      onRestore={() => undefined}
      platform="ios"
      selectedPlanPrice={null}
    />,
  );

  expect(
    findByTestID(container, 'paywall.purchase-button')?.attributes.disabled,
  ).toBe('');
  expect(
    findByTestID(container, 'paywall.restore-button')?.attributes.disabled,
  ).toBe('');
  expect(
    findByTestID(container, 'paywall.redeem-offer-code-button')?.attributes
      .disabled,
  ).toBe('');

  await renderAndFlush(
    root,
    <PaywallActions
      canRestore
      isPurchasing={false}
      isRedeemingOfferCode={false}
      isRestoring={false}
      isSyncing={false}
      onPurchase={() => undefined}
      onRedeemOfferCode={() => undefined}
      onRestore={() => undefined}
      platform="android"
      selectedPlanPrice="$9.99"
    />,
  );

  expect(
    findByTestID(container, 'paywall.purchase-button')?.attributes.disabled,
  ).toBeUndefined();
  expect(
    findByTestID(container, 'paywall.restore-button')?.attributes.disabled,
  ).toBeUndefined();
  expect(
    findByTestID(container, 'paywall.redeem-offer-code-button'),
  ).toBeNull();

  await act(async () => root.unmount());
});

test('paywall plan selector exposes one labelled radio group and checked plan', async () => {
  const { PaywallPlanSelector } =
    await import('../src/features/billing/components/paywall-components');
  const container = fakeDocument.createElement('div');
  const root = createRoot(container);

  await renderAndFlush(
    root,
    <PaywallPlanSelector
      isConnecting={false}
      isLoading={false}
      plans={[
        {
          description: 'Billed monthly',
          displayName: 'Monthly',
          displayPrice: '$9.99',
          id: 'monthly',
          introOfferLabel: null,
          productId: 'premium.monthly',
        },
      ]}
      selectedPlanId="monthly"
      storeName="App Store"
      onSelect={() => undefined}
    />,
  );

  const radioGroup = findByTestID(container, 'paywall.plan-group');
  const selectedPlan = findByTestID(
    container,
    'paywall.plan-option.monthly',
  );

  expect(radioGroup?.attributes.role).toBe('radiogroup');
  expect(radioGroup?.attributes['aria-label']).toBe('Choose a subscription plan');
  expect(selectedPlan?.attributes.role).toBe('radio');
  expect(selectedPlan?.attributes['aria-checked']).toBe('true');

  await act(async () => root.unmount());
});

test('wide dashboard navigation exposes the active destination as the current page', async () => {
  const { NavigationRail, NavigationRailItem } =
    await import('../src/components/dashboard/NavigationRail');
  const container = fakeDocument.createElement('div');
  const root = createRoot(container);

  await renderAndFlush(
    root,
    <NavigationRail title="web_app_demo">
      <NavigationRailItem
        icon={{ ios: 'square.grid.2x2.fill', android: 'view_module', web: 'view_module' }}
        isActive
        label="Components"
      />
    </NavigationRail>,
  );

  expect((container.firstChild as FakeElement).attributes.role).toBe('navigation');
  expect((container.firstChild as FakeElement).attributes['aria-label']).toBe(
    'Primary navigation',
  );

  await renderAndFlush(
    root,
    <NavigationRailItem
      icon={{ ios: 'square.grid.2x2.fill', android: 'view_module', web: 'view_module' }}
      isActive
      label="Components"
    />,
  );

  expect((container.firstChild as FakeElement).attributes['aria-current']).toBe('page');

  await renderAndFlush(
    root,
    <NavigationRailItem
      icon={{ ios: 'person.crop.circle.fill', android: 'person', web: 'person' }}
      isActive={false}
      label="Profile"
    />,
  );

  expect((container.firstChild as FakeElement).attributes['aria-current']).toBeUndefined();

  await act(async () => root.unmount());
});

test('Select registers option effects, preserves same-value replacements, and clears removed selections', async () => {
  const { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } =
    await import('../src/components/ui/select');
  const container = fakeDocument.createElement('div');
  const root = createRoot(container);

  function selectFixture(items: React.ReactNode) {
    return (
      <Select defaultValue="a">
        <SelectTrigger>
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent>{items}</SelectContent>
      </Select>
    );
  }

  await renderAndFlush(
    root,
    selectFixture(
      <>
        <SelectItem key="old-a" value="a">
          Alpha
        </SelectItem>
        <SelectItem value="b">Beta</SelectItem>
      </>,
    ),
  );
  expect(container.textContent).toContain('Alpha');

  await renderAndFlush(
    root,
    selectFixture(
      <>
        <SelectItem key="new-a" value="a">
          Alpha reloaded
        </SelectItem>
        <SelectItem value="b">Beta</SelectItem>
      </>,
    ),
  );
  expect(container.textContent).toContain('Alpha reloaded');
  expect(container.textContent).not.toContain('Pick');

  await renderAndFlush(
    root,
    selectFixture(
      <>
        <SelectItem value="b">Beta</SelectItem>
      </>,
    ),
  );
  expect(container.textContent).toContain('Pick');

  await act(async () => {
    root.unmount();
    await waitForEffects();
  });
});

test('NativeSelect registers option effects and clears the trigger when selected option unmounts', async () => {
  const { NativeSelect, NativeSelectOption } =
    await import('../src/components/ui/native-select');
  const container = fakeDocument.createElement('div');
  const root = createRoot(container);

  function nativeSelectFixture(items: React.ReactNode) {
    return (
      <NativeSelect defaultValue="ios" placeholder="Platform">
        {items}
      </NativeSelect>
    );
  }

  await renderAndFlush(
    root,
    nativeSelectFixture(
      <>
        <NativeSelectOption key="old-ios" value="ios">
          iOS
        </NativeSelectOption>
        <NativeSelectOption value="android">Android</NativeSelectOption>
      </>,
    ),
  );
  expect(container.textContent).toContain('iOS');

  await renderAndFlush(
    root,
    nativeSelectFixture(
      <>
        <NativeSelectOption key="new-ios" value="ios">
          iOS reloaded
        </NativeSelectOption>
        <NativeSelectOption value="android">Android</NativeSelectOption>
      </>,
    ),
  );
  expect(container.textContent).toContain('iOS reloaded');
  expect(container.textContent).not.toContain('Platform');

  await renderAndFlush(
    root,
    nativeSelectFixture(
      <>
        <NativeSelectOption value="android">Android</NativeSelectOption>
      </>,
    ),
  );
  expect(container.textContent).toContain('Platform');

  await act(async () => {
    root.unmount();
    await waitForEffects();
  });
});
