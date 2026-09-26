import { expect, test } from 'bun:test';

import { getPasswordVisibilityPresentation } from '../src/features/auth/components/password-visibility';

test('password visibility presentation maps the visible state to the hide icon', () => {
  const presentation = getPasswordVisibilityPresentation(true);

  expect(presentation.accessibilityValueText).toBe('visible');
  expect(presentation.symbolName).toEqual({
    android: 'visibility_off',
    ios: 'eye.slash',
    web: 'visibility_off',
  });
});

test('password visibility presentation maps the hidden state to the show icon', () => {
  const presentation = getPasswordVisibilityPresentation(false);

  expect(presentation.accessibilityValueText).toBe('hidden');
  expect(presentation.symbolName).toEqual({
    android: 'visibility',
    ios: 'eye',
    web: 'visibility',
  });
});
