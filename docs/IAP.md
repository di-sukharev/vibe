# Store subscriptions

The backend verifies purchases and owns premium access. Billing is optional and disabled by default. Schema and automated tests remain active in both modes.

## Enable or remove billing

Apply migrations before releasing the API. Configure the stores and backend credentials. Set `BILLING_ENABLED=true` in the backend and `EXPO_PUBLIC_BILLING_ENABLED=true` in the mobile build. Rebuild the application after changing its public configuration.

Disabled billing mounts no API routes or mobile IAP provider. Enabled routes use separate ingress limits. Define what premium unlocks and enforce access in the backend. Client state controls presentation only.

For hosted environments, pass billing settings through `extra_runtime_env`. Google credentials and `BILLING_ENABLED` must reach the API, maintenance, and outbox jobs. Keep the existing schedules active. See [Deployment](DEPLOYMENT.md#extra-runtime-variables).

To remove billing, remove the module, Prisma schema, contracts, mobile feature, native plugin, configuration, and tests together. Generate the migration. Keep `google-auth-library` if social sign-in uses it. Run types, tests, and the Maestro journey.

## Store configuration

In App Store Connect, create subscriptions and an In-App Purchase API key. Set the version 2 notification URL to `https://<api-domain>/api/webhooks/app-store`. The backend includes reviewed [Apple root certificates](../backend/src/modules/billing/certs/apple/README.md).

In Play Console, create subscriptions with active base plans and offers. Give a service account access to orders and subscriptions. Enable the Android Publisher API. Bundle and package IDs must match `mobile/app.config.js`.

[Backend configuration](../backend/.env.example) defines credentials and product allowlists. Keep secrets in the backend. [Mobile configuration](../mobile/.env.example) contains public product and base-plan IDs. Every `EXPO_PUBLIC_*` value enters the bundle.

Apple verification uses the configured environment. It does not fall back to sandbox. Production rejects Google test purchases. Use separate test configuration for sandbox purchases. Native plugin changes require a new development or store build; Expo Go cannot run purchases.

## Purchase processing

Validate the store result and owner before recording access. Keep ownership immutable under the purchase locks. Pending purchases unlock nothing. Order IDs are metadata; Google purchase tokens identify purchases.

Keep premium access while any current owned subscription is active. Revoking one purchase does not revoke another.

The Google transaction saves ownership, access, and an acknowledgement task together. The API then acknowledges outside the transaction. The outbox retries after failure or restart. Android does not acknowledge again on the client. iOS finishes the transaction only after backend verification succeeds.

Google replacements retain ownership history but stop using the old token for access. Stored-token reconciliation follows the current allowed product and base plan. Store responses cannot overwrite changes committed after verification began.

Apple transaction, renewal, and canonical status have separate signing times. Merge each fact independently. Renewal data must belong to the same original transaction. A newer renewal cannot remove a refund or upgrade marker. Newer paid periods replace older periods even when their duration is shorter. An old-period refund updates history without revoking a later renewal.

A tokenless Apple offer-code purchase requires the short-lived redemption session. Its first assignment trusts possession of the fresh signed transaction; the session proves recent user intent, not store-account identity. An existing owner cannot change. Keep signed transactions secret.

## Limits and diagnostics

Google uses bounded polling for tokens already submitted by the application. RTDN and out-of-app resubscribe are not implemented. Alternative billing, external purchase programs, and in-app Google code redemption are outside this module.

The client replaces catalogue snapshots after a refresh. It preserves account boundaries, shows introductory and recurring terms, and offers store reconnection. Diagnostics contain structured codes, not free-form SDK errors or purchase credentials.

If products do not load, check identifiers, active plans, API connectivity, and the native build. Package scripts define automated checks. Use separate store test accounts when validating a store configuration.

References: [Google verification and acknowledgement](https://developer.android.com/google/play/billing/security), [Google subscription lifecycle](https://developer.android.com/google/play/billing/lifecycle/subscriptions), [Apple Server API](https://developer.apple.com/documentation/appstoreserverapi), [Expo IAP](https://hyochan.github.io/expo-iap/).
