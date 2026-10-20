# Mobile social sign-in

Apple sign-in supports iOS. Google sign-in supports iOS and Android. Expo Web uses the existing browser session flow. Provider routes and mobile buttons are implemented but disabled.

## Enable sign-in

Mount `tokenSocialAuthRoute` in the backend auth routes. Render `SocialAuthButtons` in the mobile auth screen. Add HTTP integration tests for provider identity, account ownership, and rejected credentials. Then configure the providers below.

Run types, tests, and lint. Verify each provider on a development build.

## Apple setup

Enable Sign in with Apple for the bundle identifier in `mobile/app.config.js`. Set backend `APPLE_AUTH_BUNDLE_ID` to that identifier. Keep `ios.usesAppleSignIn` and the Apple authentication plugin enabled.

The backend accepts only tokens with the configured audience. Key-fetch deadlines are defined by the environment schema.

## Google setup

Create OAuth clients for each shipped platform. Register Android package names and every signing fingerprint used by development and production builds.

Set the web and iOS client IDs in `mobile/.env`. Set the reversed iOS URL scheme in `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME`. The app configuration adds the native plugin when that scheme exists.

Set backend `GOOGLE_AUTH_CLIENT_IDS` to the accepted audiences. Rebuild after native capability or URL-scheme changes.

Use the environment examples and schema for exact variable names. These client identifiers are public; credentials must remain server-side.

## Account rules

The provider subject identifies the account. Never link an existing password account by matching email. A new account needs a provider email; Google must verify it.

Known Apple subjects can sign in without another email disclosure. Social-only accounts have no password. Password reset must not create one implicitly.

Preserve authentication locks when creating sessions or changing roles. Provider errors must not bypass token verification or audience checks.

## Remove sign-in

Remove provider adapters, route wiring, mobile buttons, API methods, contracts, configuration, tests, and native plugins together. Follow the feature references and type errors rather than leaving partial wiring.

Keep `google-auth-library` while Google Play billing uses it. Removing provider-subject columns requires a migration. Run types, tests, and lint afterward.

References: [Apple authentication](https://docs.expo.dev/versions/latest/sdk/apple-authentication/), [Google sign-in setup](https://react-native-google-signin.github.io/docs/setting-up/expo).
