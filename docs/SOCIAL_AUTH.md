# Mobile Social Auth

This template includes native mobile Apple and Google authentication on top of the existing backend session model. The native `/api/auth/token/*` password and social endpoints return `{ user, accessToken, refreshToken }`. Browser password auth uses cookie-only `/api/auth/*` endpoints instead and never returns a refresh token in JSON; browser social auth is not part of this template.

## Status: Off By Default

The implementation is complete and switched off. `POST /api/auth/token/social/{provider}` is
defined but not mounted in `backend/src/modules/auth/transport/routes.ts`, and the mobile sign-in
screen does not render `SocialAuthButtons`. Unlike subscriptions, the schema stays intact: the
`appleSubject` and `googleSubject` columns on `users` are two nullable columns that cost nothing
and keep the auth repository compiling.

Reference implementation, if this copy ever drifts: `github.com/di-sukharev/vibe`, branch `mobile`.

### How To Turn Social Sign-In On

1. Uncomment the `routes.openapi(tokenSocialAuthRoute, …)` handler in
   `backend/src/modules/auth/transport/routes.ts`, and its path in the OpenAPI expectation in
   `backend/src/app.test.ts`.
2. Uncomment the `SocialAuthButtons` block and its import in
   `mobile/src/features/auth/screens/AuthScreen.tsx`, and restore the screen description that
   mentions an identity provider.
3. Restore the parked tests: the eight social suites in
   `backend/src/modules/auth/auth.integration.test.ts` (they cover creation semantics, concurrent
   first-time auth, email-conflict refusal, and session issuance racing a role change - the
   transport and persistence layers the service-level tests do not reach).
4. Configure the provider credentials described below (`APPLE_AUTH_BUNDLE_ID`,
   `GOOGLE_AUTH_CLIENT_IDS`, and the client-side ids in `mobile/.env`).
5. Verify on a real development build - neither provider works in Expo Go.

### If Social Sign-In Is Not Wanted

Like billing, deleting reaches past the obvious files. Remove all of it in one pass:

- `backend/src/modules/auth/infrastructure/social-providers.ts`, the `tokenSocialAuthRoute`
  definition and its parked handler in `transport/routes.ts`, `AuthService.socialAuth` with the
  `socialIdentities` port, and the `SocialAuthProvider` branches in `infrastructure/auth-repository.ts`
- `AuthApi.socialAuth` in `mobile/src/features/auth/api.ts`, `socialAuth` in
  `mobile/src/features/auth/provider.tsx`, and the `verifySocialIdentity` wiring in
  `backend/src/modules/auth/index.ts`
- `mobile/src/features/auth/components/social-auth-buttons.tsx`,
  `mobile/src/features/auth/social-auth-config.ts`, their re-exports in
  `mobile/src/features/auth/index.ts`, the parked block in `screens/AuthScreen.tsx`, and the
  social entry in `mobile/eslint.config.js`
- the social schemas and types in `packages/contracts/src/auth.ts` and `auth.test.ts`
- `expo-apple-authentication` and `@react-native-google-signin/google-signin` in
  `mobile/package.json` with their entries in `mobile/app.config.js`
- `mobile/tests/social-auth-config.test.ts`, the social cases in `mobile/tests/api.test.ts` and
  `mobile/tests/cookie-auth-coordinator.test.ts`, the four service tests at the end of
  `backend/src/modules/auth/application/auth-service.test.ts`, the parked suites in
  `backend/src/modules/auth/auth.integration.test.ts` with their `socialAuthProviderDeps` and
  `gateNextSessionCreate` helpers, and the parked OpenAPI path in `backend/src/app.test.ts`
- `APPLE_AUTH_*` and `GOOGLE_AUTH_CLIENT_IDS` in `backend/src/env.ts`, `backend/src/env.test.ts`,
  every `.env.example`, and the same keys in every backend test env fixture (removing them from
  `env.ts` narrows `AppEnv`, so any fixture still listing them fails typecheck)
- the `appleSubject` / `googleSubject` columns on `users`, if you also want them out of the
  database - that needs a migration; leaving two nullable columns is harmless

Then record `removed` in the `CHECKLIST.md` capability ledger and run `bun run typecheck`,
`bun run test`, and `bun run lint`.

## Behavior

- Mobile buttons use a one-tap flow: if the provider subject already exists, the user is signed in; otherwise the backend creates a new social-only user.
- Provider subject is the stable identity key: Apple `sub` for Apple and Google `sub` for Google.
- The backend does not automatically link a social identity to an existing password account by email. If the email already exists, the API returns `AUTH_EMAIL_ALREADY_EXISTS`.
- Social-only users have `passwordHash = null`. They can later get a password through a product-specific reset/set-password flow.
- Apple may provide email only on first authorization. Returning Apple users are found by stored `appleSubject`, so later tokens can omit email.

## Backend Env

Add these to `backend/.env` when social auth is active:

```bash
APPLE_AUTH_BUNDLE_ID=com.example.app
APPLE_AUTH_JWKS_TIMEOUT_MS=5000
GOOGLE_AUTH_CLIENT_IDS=ios-client-id.apps.googleusercontent.com,web-client-id.apps.googleusercontent.com
```

`GOOGLE_AUTH_CLIENT_IDS` must include every Google OAuth client ID whose ID tokens this backend should accept: iOS, Android, development, preview, and production as needed. These client IDs are identifiers, not secrets.

The backend endpoints are:

- `POST /api/auth/token/social/apple`
- `POST /api/auth/token/social/google`

These are explicit-token native endpoints. They never read or set browser cookies and return both access and refresh tokens in JSON.

Payload:

```json
{
  "idToken": "provider-id-token",
  "displayName": "Optional Name"
}
```

## Apple Setup

1. In Apple Developer, enable **Sign in with Apple** for the app identifier used by `mobile` `ios.bundleIdentifier`.
2. Set `APPLE_AUTH_BUNDLE_ID` on the backend to that bundle identifier.
3. Keep `ios.usesAppleSignIn: true` and the `expo-apple-authentication` plugin in `mobile/app.config.js`.
4. Rebuild the Expo development build after changing native auth config.

Apple Sign-In is iOS-only in this template.

## Google Setup

1. Create Google OAuth client IDs in Google Cloud for the mobile platforms you ship.
2. Put the iOS client ID in `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.
3. Put the web client ID in `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`; Android uses this to request an ID token.
4. Put the reversed iOS client ID in `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME`, for example `com.googleusercontent.apps.1234567890-abcdef`.
5. Add all accepted client IDs to backend `GOOGLE_AUTH_CLIENT_IDS`.
6. Rebuild the Expo development build after changing `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME` or other native Google Sign-In config.

For Android release builds, configure the Google OAuth Android client with the package name and SHA-1/SHA-256 fingerprints for each signing key used by development, preview, and production builds.

## Validation

Run the local checks after configuration or implementation changes:

```bash
bun run test:contracts
bun run test:backend
bun run test:mobile
bun run typecheck
bun run build:mobile
```

Real provider testing requires a development build installed on a device or simulator. Expo Go is not the validation target for this template's Google Sign-In path.

## Upstream Docs

- [Expo AppleAuthentication](https://docs.expo.dev/versions/latest/sdk/apple-authentication/)
- [React Native Google Sign-In Expo setup](https://react-native-google-signin.github.io/docs/setting-up/expo)
- [Google Auth Library for Node.js](https://cloud.google.com/nodejs/docs/reference/google-auth-library/latest/google-auth-library/oauth2client)
