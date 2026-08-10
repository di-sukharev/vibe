# Web Surfaces And Payments

This is the canonical product and architecture contract for work that crosses `website`,
`webapp`, `mobile`, and `backend`. Read it before implementing public product data, catalogs,
offers, carts, checkout, orders, subscriptions, entitlements, or payments. The app-local READMEs
explain how each workspace works; this document decides which workspace owns the behavior.

`CHECKLIST.md` still gates what the installed product contains. This document defines the default
shape of a capability after the product owner activates it; it does not make an `absent` capability
present. In particular, the default branch does not ship browser cart, checkout, or payment code.

## Surface ownership

| Surface | Owns | Must not own |
| --- | --- | --- |
| `website` | Public product information, SEO pages, static catalog/listing pages, and an optional anonymous local cart or offer selection. | Account screens, authoritative order totals, payment creation, payment status, or a second checkout. |
| `webapp` | Registration and sign-in, the minimal authenticated account, imported cart review, checkout, orders, subscriptions, and browser payment UI. | A duplicate SEO catalog or a second public product site. |
| `mobile` | Its own native account and payment experiences, including store purchases and, when the product needs them, native wallet or card flows. | A forced redirect through browser checkout merely to avoid implementing the correct native flow or to evade store rules. |
| `backend` | Public build DTOs, authoritative products/prices/availability, carts or checkout drafts when needed, orders, entitlements, payment-provider orchestration and webhooks, and rebuild tasks. | Product-page composition or client-owned payment decisions. |

The public website and authenticated browser app are intentionally different surfaces. A small
account is enough: build only the registration, checkout, purchase/subscription status, order
history, and settings the product actually needs. Do not add dashboard ceremony just because the
user crossed the sign-in boundary.

There is one browser checkout. A product may be discovered and selected on `website`, but browser
payment starts from the authenticated `webapp` and is backed by the same backend order/payment
authority. A hosted provider page, wallet sheet, or redirect may appear inside that flow; this does
not give `website` ownership of checkout.

## Static website data and freshness

`website` exists for public product information and is SSG by default. Its production artifact is
static HTML/assets. Database-backed information may still appear there: Astro fetches a public,
contract-validated backend snapshot while building the static output, then publishes that output
to the Static Site host or object storage/CDN. That is build-time data, not request-time rendering.

When `website` reads backend data at build time:

- expose only data safe to publish permanently in static HTML and assets;
- define the DTO in `packages/contracts` and validate both producer and build consumer;
- keep any build credential server-only and out of `PUBLIC_*` variables and generated output;
- fail the build on an unavailable or invalid required snapshot instead of silently publishing an
  empty catalog or stale fallback;
- deploy a backward-compatible backend/build contract before asking a hosted builder to consume it;
- treat displayed prices and availability as public information, while the backend remains
  authoritative when an order is created.

If a database change must become visible on the static site, the feature is incomplete until it
has an explicit rebuild/redeploy controller. Persist durable rebuild state with at least
`desiredRevision`, `publishedRevision`, the active provider deployment id/status, and its requested
revision. In the same PostgreSQL transaction that publishes a change, advance `desiredRevision` and
enqueue a uniquely keyed `website:rebuild:<revision>` wake-up task. The state row is the source of
truth; outbox rows only prompt a short reconcile pass, and correctness does not depend on reopening
a terminal outbox row.

The reconcile pass is single-flight and restart-safe:

1. Acquire the rebuild state row so at most one provider deployment may be active.
2. If a deployment is active, poll or adopt it by provider id; after an ambiguous trigger response,
   query the provider and adopt the matching deployment before sending another trigger.
3. The build endpoint reads one consistent public DTO snapshot plus its actual database revision.
   Build an immutable revisioned artifact and promote it atomically or with an equivalent blue-green
   provider release; the public, cache-busted revision marker is part of the promoted artifact.
4. Do not mark a deployment published when the provider merely accepts it. After provider success,
   verify the revision marker through the public site/CDN, then advance `publishedRevision` to the
   revision the artifact actually contains.
5. If `desiredRevision` is still newer, start exactly one follow-up deployment; otherwise stop.

A configured `website:rebuild:reconcile` recurring job runs the same short pass so restarts, lost
wake-ups, expired outbox rows, and long provider builds recover from durable state. Never wait for a
hosted build inside one outbox attempt. Serial provider activation prevents an older build from
becoming live after a newer one, while the public marker proves what users actually receive.

The outbox coordinates durable requests and retries; it does not add another queue service. The
actual build executor depends on the hosting path recorded in `CHECKLIST.md`. DigitalOcean can run
the Git-backed build after a deployment trigger. The baseline Yandex Object Storage path has no
automatic builder; keep automatic rebuild `absent` until a dedicated authenticated build/upload
component is implemented, or choose manual release/runtime rendering for the recorded freshness
need. Provider details live in [BACKGROUND_JOBS.md](BACKGROUND_JOBS.md), under "Rebuilding a static
site".

Keep SSG plus rebuild as the default. Request-time SSR, server islands, or client-only fetching of
SEO-critical product data is an exception, not a shortcut. Use an exception only when the product
has a recorded freshness or personalization need that a rebuild cycle cannot satisfy, then record
the runtime-rendering capability and deployment impact in `CHECKLIST.md` before implementation.
Fast-changing inventory or a price that must never be stale is such a product decision; repeatedly
rebuilding on every small change is not a substitute for choosing the right rendering boundary.

## Browser cart and checkout

The default pre-auth purchase flow is:

1. `website` keeps an anonymous cart or selected offer locally in the browser.
2. A versioned schema from `packages/contracts` serializes stable product/offer/variant identifiers
   and quantities. It never treats client-provided prices, discounts, totals, user data, or payment
   credentials as authoritative.
3. The checkout action transfers that payload to the configured `PUBLIC_WEBAPP_URL`, targeting the
   authenticated `/app/checkout` flow. For the normal small, non-sensitive payload, use a URL
   fragment so it is not sent in HTTP request logs. If the payload becomes large, sensitive, or
   must survive across devices, replace the transport with a short-lived opaque backend handoff
   token; do not create a second checkout.
4. `webapp` validates and imports the handoff once, removes it from the URL, and preserves the
   imported selection across its registration/sign-in flow.
5. Guests register or sign in and return to `/app/checkout`; authenticated users continue directly.
6. The backend resolves current products, prices, availability, discounts, taxes, and permissions,
   then returns an authoritative checkout snapshot. The UI must show and require acceptance of any
   material change before payment.
7. `webapp` asks the backend to create or continue the payment. Provider secrets and order-state
   transitions stay in the backend. Provider webhooks are authenticated, idempotent, and
   authoritative; a browser success URL alone never marks an order paid.

For browser and mobile card or wallet flows, collect payment credentials only in the audited,
PCI-compliant payment provider's hosted UI or native SDK and use its tokenization contract. Raw
PAN/CVC must never enter custom app inputs, application APIs, logs, analytics, or storage. Clients
and the backend may handle only the provider's opaque payment-method/token identifiers, with
secrets, authoritative state transitions, and idempotent webhooks remaining in the backend.

The flow must preserve a recoverable cart when registration, login, payment, or a provider redirect
is cancelled or fails. It must also handle removed products, changed quantities or prices,
duplicate submissions, expired handoffs, delayed webhooks, and a user returning on another tab.
Do not put a payment SDK, card form, payment secret, authoritative total, order state machine, or
provider webhook in `website`.

The existing auth `returnTo` mechanism is the starting point, but a checkout implementation must
add `/app/checkout` to the typed role-safe route map and test the full guest-to-registration-to-
checkout recovery path. Never relax return-path validation to accept arbitrary origins.

## Mobile payments

Mobile payments are a separate presentation and transport boundary from browser checkout. The
`mobile` branch already contains the backend/contracts/native foundation for App Store and Google
Play subscriptions through `expo-iap`; the purchase paths work after the capability is explicitly
enabled and the real store products, credentials, and testing accounts are configured. The
template keeps them switched off until `CHECKLIST.md` activates payments.

The mobile app may also implement direct card entry, a saved-card provider flow, Apple Pay, or
Google Pay when the product needs that payment method. This architecture does not force those
payments through `website` or `webapp`. Apple Pay and Google Pay are wallet/card methods, not
synonyms for App Store In-App Purchase or Google Play Billing. Pick the native method from what is
being sold, the target storefront/region, and the current store rules:

- digital features, content, or subscriptions consumed in the app normally use the applicable
  store purchase path unless a current regional/program exception applies;
- physical goods or services consumed outside the app may use an appropriate native wallet or card
  provider;
- do not add an external link or browser detour to evade App Store or Google Play payment policy.

Re-check current Apple and Google policy before implementing or changing a mobile payment path;
these rules and regional programs change. When browser and mobile sell the same entitlement or
order, the backend owns one normalized product/order/entitlement model while each client keeps its
own policy-compliant payment transport and UI. Store receipts, provider tokens, webhooks, and
idempotency stay in the owning billing infrastructure, not in UI components.

The mobile branch's detailed store setup and validation live in `docs/IAP.md`. Current upstream
references:

- [Apple App Review Guidelines, Payments](https://developer.apple.com/app-store/review/guidelines/#business)
- [Apple Pay](https://developer.apple.com/apple-pay/)
- [Google Play Payments policy](https://support.google.com/googleplay/android-developer/answer/10281818)
- [Google Play Billing](https://developer.android.com/google/play/billing)
- [Google Pay for Android](https://developers.google.com/pay/api/android/overview)

## Implementation checklist

Before implementation:

- confirm the relevant rows in `CHECKLIST.md` are `included` or intentionally moving from `absent`
  to an implemented state;
- identify which public data is static in the repository and which is fetched from the backend at
  build time, plus the acceptable freshness window;
- define the shared public-product and cart/handoff contracts before producer or consumer code;
- choose one browser checkout and the required native payment paths; never infer a provider or
  payment method from dormant code;
- define success, cancellation, failure, retry, idempotency, price-change, unavailable-product,
  delayed-webhook, and entitlement-recovery behavior;
- for automatic rebuilds, implement durable desired/published revision state, single-flight
  provider deployment, short trigger/reconcile operations, public-marker verification, and the
  provider path described in `BACKGROUND_JOBS.md`; on Yandex, do not mark the capability usable
  until the separate builder/upload component exists;
- validate browser commerce end to end from public selection through auth and payment recovery;
  validate native store/wallet paths on their required real-device or store test environments;
- update the capability ledger and app-local README when the code becomes usable, remains gated by
  configuration, or is deliberately removed.

Keep provider deployment details in `DEPLOYMENT.md` or `YANDEX_CLOUD.md`, native IAP setup on the
`mobile` branch, and app-specific coding conventions in each workspace README. Keep this document
focused on the product boundaries that every implementation must preserve.
