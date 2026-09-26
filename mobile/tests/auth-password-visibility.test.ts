import { expect, test } from 'bun:test';

import { getPasswordVisibilityPresentation } from '../src/features/auth/components/password-visibility';

test('password visibility presentation reveals the value and offers to hide it', () => {
  const presentation = getPasswordVisibilityPresentation(true);

  expect(presentation).toEqual({
    accessibilityValueText: 'visible',
    actionLabel: 'Hide password',
    secureTextEntry: false,
    symbolName: {
      android: 'visibility_off',
      ios: 'eye.slash',
      web: 'visibility_off',
    },
  });
});

test('password visibility presentation masks the value and offers to show it', () => {
  const presentation = getPasswordVisibilityPresentation(false);

  expect(presentation).toEqual({
    accessibilityValueText: 'hidden',
    actionLabel: 'Show password',
    secureTextEntry: true,
    symbolName: {
      android: 'visibility',
      ios: 'eye',
      web: 'visibility',
    },
  });
});
