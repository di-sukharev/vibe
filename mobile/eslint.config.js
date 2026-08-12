// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // These components intentionally use refs as imperative native/store bridges.
    files: [
      "src/components/ui/carousel.tsx",
      "src/components/ui/native-select.tsx",
      "src/components/ui/select.tsx",
      "src/features/billing/provider.tsx",
    ],
    rules: {
      "react-hooks/refs": "off",
    },
  },
  {
    // These provider effects intentionally mirror and reset external session/store state.
    files: [
      "src/features/auth/components/social-auth-buttons.tsx",
      "src/features/auth/provider.tsx",
      "src/features/avatar/provider.tsx",
      "src/features/billing/provider.tsx",
      "src/features/notifications/provider.tsx",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
