import type { SymbolViewProps } from 'expo-symbols';

export type PasswordVisibilitySymbolName = Extract<SymbolViewProps['name'], object>;

export type PasswordVisibilityPresentation = {
  accessibilityValueText: 'hidden' | 'visible';
  actionLabel: string;
  symbolName: PasswordVisibilitySymbolName;
};

/**
 * Derives the password field's non-security presentation (action label, accessibility value, and
 * the platform icon name) from the single `isVisible` flag it depends on.
 */
export function getPasswordVisibilityPresentation(
  isVisible: boolean,
): PasswordVisibilityPresentation {
  return {
    accessibilityValueText: isVisible ? 'visible' : 'hidden',
    actionLabel: isVisible ? 'Hide password' : 'Show password',
    symbolName: {
      android: isVisible ? 'visibility_off' : 'visibility',
      ios: isVisible ? 'eye.slash' : 'eye',
      web: isVisible ? 'visibility_off' : 'visibility',
    },
  };
}
