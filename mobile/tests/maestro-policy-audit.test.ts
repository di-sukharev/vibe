import { expect, test } from 'bun:test';

import {
  authScreenUsesKeyboardAwareShell,
  // capability:billing:start
  nativePaywallLogoutHasTestId,
  // capability:billing:end
} from '../scripts/e2e/maestro-policy-audit.mjs';

// capability:billing:start
const paywallAccountActionsSource = `
  function PaywallAccountActions({ onLogout }) {
    return (
      <Button
        testID={TEST_IDS.auth.logoutButton}
        onPress={onLogout}>
        Logout
      </Button>
    )
  }
`;
// capability:billing:end

test('Maestro keyboard audit accepts only an enabled auth-form shell', () => {
  expect(
    authScreenUsesKeyboardAwareShell(`
      function AuthScreen() {
        return <ScreenShell keyboardAware={false}>Form</ScreenShell>
      }
    `),
  ).toBe(false);

  expect(
    authScreenUsesKeyboardAwareShell(`
      function AuthScreen() {
        return <ScreenShell keyboardAware>Form</ScreenShell>
      }
    `),
  ).toBe(true);
});

// capability:billing:start
test('Maestro logout audit requires the supported final paywall render path', () => {
  expect(
    nativePaywallLogoutHasTestId(
      `
        function PaywallScreen() {
          if (!iap.isSupported) {
            return (
              <PaywallAccountActions
                onLogout={() => void auth.logout()}
              />
            )
          }

          return <ScreenShell>Supported paywall</ScreenShell>
        }
      `,
      paywallAccountActionsSource,
    ),
  ).toBe(false);

  expect(
    nativePaywallLogoutHasTestId(
      `
        function PaywallScreen() {
          if (!iap.isSupported) return <ScreenShell>Unsupported</ScreenShell>

          return (
            <ScreenShell>
              <PaywallAccountActions
                onLogout={() => void auth.logout()}
              />
            </ScreenShell>
          )
        }
      `,
      paywallAccountActionsSource,
    ),
  ).toBe(true);
});
// capability:billing:end
