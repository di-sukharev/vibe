# Mobile social sign-in

The mobile app signs in with Apple on iOS and with Google on iOS and Android. It gets an ID token from the provider and exchanges it at `POST /api/auth/token/social/{provider}` for a native token session ([ARCHITECTURE](ARCHITECTURE.md)). The request carries `{ idToken, displayName? }` (`packages/contracts/src/auth.ts`). The Expo web build does not support social sign-in.

The capability is implemented and switched off. The route is defined but not mounted in `backend/src/modules/auth/transport/routes.ts`, and `mobile/src/features/auth/screens/AuthScreen.tsx` does not render `SocialAuthButtons`. The nullable `appleSubject` and `googleSubject` columns stay on `users`; they cost nothing and keep the auth repository compiling. The upstream template keeps a working copy on branch `mobile` of `github.com/di-sukharev/vibe`.

## How To Turn Social Sign-In On

1. Uncomment the `tokenSocialAuthRoute` handler in `backend/src/modules/auth/transport/routes.ts`.
2. In `AuthScreen.tsx`, uncomment the `SocialAuthButtons` import and block, and change the screen description to mention the providers.
3. Remove the `@parked-test` line from `backend/src/modules/auth/social-auth.integration.test.ts`. Its eight tests cover creation and return, a concurrent first sign-in, a missing or conflicting email, provider errors, and a session that races a role change.
4. Set up the providers below.
5. Sign in with each provider on a [development build](../mobile/README.md#development-build), not Expo Go.
6. Run `bun run typecheck`, `bun run test`, and `bun run lint`. Set the `Social sign-in (Apple / Google)` row in [CHECKLIST](../CHECKLIST.md) to `included`.

## Behavior

- The provider subject (`sub`) identifies the user. A known subject signs in (`200`). A new subject creates a social-only user without a password (`201`).
- A new user needs an email from the provider (`AUTH_PROVIDER_EMAIL_REQUIRED`), and Google emails must be verified. Apple can omit the email on later sign-ins; the stored subject still finds the user.
- The backend never links a social identity to an existing account by email. It returns `AUTH_EMAIL_ALREADY_EXISTS` instead.
- Password reset skips accounts without a password, so a set-password flow for social-only users is product work.
- Other errors: `AUTH_INVALID_PROVIDER_TOKEN` (`401`), `AUTH_PROVIDER_ACCOUNT_ALREADY_LINKED` (`409`), and `AUTH_PROVIDER_NOT_CONFIGURED` or `AUTH_PROVIDER_UNAVAILABLE` (`503`).

## Provider setup

`backend/.env.example` lists the backend variables. They are identifiers, not secrets; in production they go in `extra_runtime_env` ([DEPLOYMENT](DEPLOYMENT.md)). `APPLE_AUTH_JWKS_TIMEOUT_MS` bounds the fetch of Apple's signing keys.

Apple:

1. In Apple Developer, enable Sign in with Apple for the app ID of `ios.bundleIdentifier` in `mobile/app.config.js`.
2. Set `APPLE_AUTH_BUNDLE_ID` to that bundle ID. Apple tokens must name it as their audience.
3. Keep `ios.usesAppleSignIn: true` and the `expo-apple-authentication` plugin in `mobile/app.config.js`.

Google:

1. In Google Cloud, create OAuth client IDs for the platforms you ship. For Android, register the package name and the SHA-1/SHA-256 fingerprints of every signing key: development, preview, and production builds.
2. In `mobile/.env`, set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. Set `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME` to the reversed iOS client ID, such as `com.googleusercontent.apps.1234567890-abcdef`; `mobile/app.config.js` adds the Google Sign-In plugin only when it is set.
3. Set `GOOGLE_AUTH_CLIENT_IDS` to every client ID whose ID tokens the backend accepts, comma-separated, for example the iOS and web client IDs.

A native auth change needs a new development build. The Apple button appears only on iOS devices where Apple reports that sign-in is available. The Google button appears when the platform's config is complete: the web client ID, plus the iOS client ID and URL scheme on iOS.

## If Social Sign-In Is Not Wanted

Remove it in one pass:

- Backend: `backend/src/modules/auth/infrastructure/social-providers.ts`, `tokenSocialAuthRoute` and its commented handler in `transport/routes.ts`, `AuthService.socialAuth` and its `socialIdentities` dependency, the `verifySocialIdentity` wiring in `backend/src/modules/auth/index.ts`, the provider-subject code in `infrastructure/auth-repository.ts`, and the provider failure kinds in `domain/errors.ts` and `transport/errors.ts`.
- Contracts: the social schemas and types in `packages/contracts/src/auth.ts` and `auth.test.ts`, and the social `AUTH_*` codes in `packages/contracts/src/errors.ts`.
- Mobile: `AuthApi.socialAuth` in `mobile/src/features/auth/api.ts`, `socialAuth` in `provider.tsx`, `components/social-auth-buttons.tsx` and `social-auth-config.ts` with their re-exports in `index.ts`, the commented import and block in `screens/AuthScreen.tsx`, the social test IDs in `mobile/src/constants/testIds.ts`, and the social entry in `mobile/eslint.config.js`.
- Dependencies: `expo-apple-authentication` and `@react-native-google-signin/google-signin` in `mobile/package.json`, with their plugins and `ios.usesAppleSignIn` in `mobile/app.config.js`. Keep `google-auth-library` while Google Play billing uses it.
- Env: `APPLE_AUTH_*` and `GOOGLE_AUTH_CLIENT_IDS` in `backend/src/env.ts`, `env.test.ts`, and `backend/.env.example`, and `EXPO_PUBLIC_GOOGLE_*` in `mobile/.env.example` and `mobile/src/types/env.d.ts`. Typecheck finds any other use.
- Tests: `mobile/tests/social-auth-config.test.ts`, the social cases in `mobile/tests/api.test.ts` and `cookie-auth-coordinator.test.ts`, the social tests at the end of `backend/src/modules/auth/application/auth-service.test.ts`, and the `socialAuthProviderDeps` resets and `gateNextSessionCreate` helper in `auth.integration.test.ts`.
- Database, optionally: drop `appleSubject` and `googleSubject` with a migration.

Then set the `Social sign-in (Apple / Google)` row in [CHECKLIST](../CHECKLIST.md) to `removed`, and run `bun run typecheck`, `bun run test`, and `bun run lint`.

## References

- [Expo AppleAuthentication](https://docs.expo.dev/versions/latest/sdk/apple-authentication/)
- [React Native Google Sign-In Expo setup](https://react-native-google-signin.github.io/docs/setting-up/expo)
- [Google Auth Library for Node.js](https://cloud.google.com/nodejs/docs/reference/google-auth-library/latest/google-auth-library/oauth2client)
