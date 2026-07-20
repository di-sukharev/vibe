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
  accessibilityLabel?: unknown;
  accessibilityRole?: unknown;
  accessibilityState?: unknown;
  children?: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
  disabled?: boolean;
  onPress?: () => void;
  pointerEvents?: unknown;
  role?: unknown;
  style?: unknown;
};

function NativeHost(tagName: string) {
  return function Host({
    'aria-current': ariaCurrent,
    accessibilityLabel,
    accessibilityRole: _accessibilityRole,
    accessibilityState: _accessibilityState,
    children,
    disabled,
    onPress,
    pointerEvents: _pointerEvents,
    role,
    style: _style,
  }: NativeHostProps) {
    return React.createElement(tagName, {
      'aria-current': ariaCurrent,
      'aria-label': accessibilityLabel,
      children: typeof children === 'function' ? children({ pressed: false }) : children,
      disabled,
      onClick: onPress,
      role,
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
