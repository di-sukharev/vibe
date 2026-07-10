# Mobile Social Auth

This template includes native mobile Apple and Google authentication on top of the existing backend session model. The native `/api/auth/token/*` password and social endpoints return `{ user, accessToken, refreshToken }`. Browser password auth uses cookie-only `/api/auth/*` endpoints instead and never returns a refresh token in JSON; browser social auth is not part of this template.

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
