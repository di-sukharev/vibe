import { expect, test } from 'bun:test';

import {
  getPackageName,
  isSingletonPackageRequest,
  SINGLETON_PACKAGES,
} from '../scripts/metro-singleton-packages';

test('getPackageName extracts the package name from bare and deep specifiers', () => {
  expect(getPackageName('expo-symbols')).toBe('expo-symbols');
  expect(getPackageName('expo-symbols/build/utils')).toBe('expo-symbols');
  expect(getPackageName('@expo/dom-webview')).toBe('@expo/dom-webview');
  expect(getPackageName('@expo/dom-webview/build/index')).toBe('@expo/dom-webview');
});

test('getPackageName returns null for relative and absolute specifiers', () => {
  expect(getPackageName('./local-module')).toBeNull();
  expect(getPackageName('../shared/utils')).toBeNull();
  expect(getPackageName('/abs/path/module')).toBeNull();
});

test('isSingletonPackageRequest matches every canonicalized package, including deep imports', () => {
  for (const pkg of SINGLETON_PACKAGES) {
    expect(isSingletonPackageRequest(pkg)).toBe(true);
    expect(isSingletonPackageRequest(`${pkg}/some/subpath`)).toBe(true);
  }
});

test('isSingletonPackageRequest rejects packages outside the canonicalized set', () => {
  expect(isSingletonPackageRequest('react-native-reanimated')).toBe(false);
  expect(isSingletonPackageRequest('expo-router')).toBe(false);
  expect(isSingletonPackageRequest('./expo')).toBe(false);
});
