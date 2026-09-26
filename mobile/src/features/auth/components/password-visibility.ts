import type { SymbolViewProps } from 'expo-symbols';

export type PasswordVisibilitySymbolName = Extract<SymbolViewProps['name'], object>;

export type PasswordVisibilityPresentation = {
  accessibilityValueText: 'hidden' | 'visible';
  actionLabel: string;
  secureTextEntry: boolean;
  symbolName: PasswordVisibilitySymbolName;
};

/**
 * Derives the password field's visible/hidden presentation (action label, accessibility value,
 * `secureTextEntry`, and the platform icon name) from the single `isVisible` flag it depends on.
 */
export function getPasswordVisibilityPresentation(
  isVisible: boolean,
): PasswordVisibilityPresentation {
  return {
    accessibilityValueText: isVisible ? 'visible' : 'hidden',
    actionLabel: isVisible ? 'Hide password' : 'Show password',
    secureTextEntry: !isVisible,
    symbolName: {
      android: isVisible ? 'visibility_off' : 'visibility',
      ios: isVisible ? 'eye.slash' : 'eye',
      web: isVisible ? 'visibility_off' : 'visibility',
    },
  };
}
