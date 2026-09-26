# Web surfaces

This guide names the owner of public data, carts, checkout, orders, subscriptions, access, and payments.

`master` has no browser cart, checkout, or payment code; these rules apply once [CHECKLIST](../CHECKLIST.md) includes one. Never infer a payment provider from inactive code.

## App ownership

| App | Owns | Never owns |
| --- | --- | --- |
| `website` | Public data, SEO, the static catalog, an optional anonymous cart, small public auth features such as the header sign-in state | Account areas, payment SDKs, card forms, secrets, final totals, order state, webhooks, a second checkout |
| `webapp` | Sign-in, a minimal account area, cart import, checkout, orders, subscriptions, browser payments | A copy of the SEO catalog |
| `mobile` | A native account area, store purchases, native cards and wallets | Store-rule workarounds, a forced browser checkout |
| `backend` | Public DTOs for builds, prices, availability, orders, access, payment providers, webhooks, rebuild jobs | Page composition, client payment decisions |

The browser has one checkout, in the signed-in `webapp`. A provider page, wallet sheet, or redirect inside it does not move checkout to `website`.

## Website data and freshness

`astro build` can fetch, validate, and embed a public backend snapshot. When it does:

- Publish only data that is safe to keep in static files indefinitely.
- Define the DTO in `packages/contracts`, and check both sides.
- Keep the build credential on the server, never in `PUBLIC_*` or the build output.
- Fail the build when a required snapshot is missing or invalid. Never publish an empty or stale catalog.
- Deploy the backward-compatible backend contract before the cloud build uses it.
- Displayed prices and availability are informational. The backend decides at order creation.

Database changes reach the site only through a release until the rebuild controller in [BACKGROUND_JOBS](BACKGROUND_JOBS.md) exists. When rebuilds cannot meet the freshness need, use the rendering ladder in [website/README](../website/README.md).

## Browser cart and checkout

1. `website` keeps the selection or cart in browser storage.
2. A versioned schema in `packages/contracts` carries stable product, offer, or variant IDs and quantities. Client prices, discounts, totals, user data, and payment data are untrusted.
3. The checkout button hands the data to `/app/checkout` at `PUBLIC_WEBAPP_URL`. A small, non-sensitive payload goes in the URL fragment, which stays out of HTTP logs. Large or sensitive data or a cross-device handoff uses a short-lived opaque backend token.
4. `webapp` validates and imports the data once, removes it from the URL, and keeps it through registration or sign-in.
5. A guest signs in or registers and returns to `/app/checkout`. A signed-in user continues at once.
6. The backend resolves current products, prices, availability, discounts, taxes, and entitlements. Show material changes and get consent before payment.
7. `webapp` asks the backend to create or resume the payment. Secrets, order state changes, and verified idempotent webhooks stay in the backend. A browser success URL never confirms a payment.

Add `/app/checkout` to `workspaceRoutesByRole` (see [webapp/README](../webapp/README.md)) so `returnTo` accepts it. Never accept another origin. Test the guest path from selection through registration to the restored checkout.

Keep the cart recoverable after a cancel or failure at any step. Handle removed items, changed prices or quantities, repeated requests, an expired handoff, late webhooks, a return in another tab, and access recovery.

On every client, card and wallet details enter only the provider's verified PCI-compliant UI or SDK. PAN and CVC never reach your own fields, APIs, logs, analytics, or storage; the app handles only opaque token IDs.

## Mobile payments

`mobile` has its own payment UI and transport; it does not need `website` or `webapp`. The `mobile` branch ships App Store and Google Play subscriptions through `expo-iap`, off by default; `docs/IAP.md` on that branch covers setup. Native cards, Apple Pay, and Google Pay are optional; the wallets are not In-App Purchase or Play Billing.

Choose the method by product, storefront, region, and current store rules, checked before each change:

- Digital features, content, and subscriptions used in the app usually go through the store, unless a current regional or program exception applies.
- Physical goods and services used outside the app may use native cards or wallets.
- Never add a link or a browser workaround that breaks store payment rules.

When web and mobile sell the same order or access, the backend keeps one normalized model. Receipts, tokens, webhooks, and idempotency belong to payment infrastructure, not to UI components.

Sources: [Apple payment guidelines](https://developer.apple.com/app-store/review/guidelines/#business), [Google Play payments policy](https://support.google.com/googleplay/android-developer/answer/10281818), [Google Play Billing](https://developer.android.com/google/play/billing).
