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
 *
 * `secureTextEntry` stays out of this function and inline at the call site: the Maestro policy
 * audit (`scripts/e2e/maestro-policy-audit.mjs`) statically checks for the literal
 * `secureTextEntry={!isVisible}` in the component source, so that guarantee must stay visible
 * there instead of arriving through a spread.
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
