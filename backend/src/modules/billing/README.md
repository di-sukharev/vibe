# Billing module (turned off)

Store subscriptions for App Store and Google Play. Everything here is implemented and was working
before it was switched off; nothing in the running app imports it right now.

## Why it ships switched off

A template cannot know whether a product sells anything. Deleting the module would mean rewriting
verification, webhooks, and restore logic later; leaving it mounted would put four unused tables in
every project's database and teach agents that subscriptions are a baseline. So the code stays, the
tables are commented out in `../../../prisma/schema/billing.prisma`, and the routes are not mounted.

## What is already solved here

- App Store transaction and renewal verification through `@apple/app-store-server-library`,
  pinned to `APPLE_IAP_ENVIRONMENT` with no silent Sandbox fallback.
- Google Play verification through Android Publisher `subscriptionsv2.get`, including linked
  purchase-token chains and ownership conflicts.
- App Store server notifications: signature verification, replay protection, a processing lease
  with reclaim, and bounded bodies before any verification work.
- Entitlement resolution shared by both stores, restore/reconcile paths, and offer-code redemption.

## Turning it on

The full checklist lives in `docs/IAP.md` under "How To Turn Subscriptions On". In short: uncomment
the schema and migrate, delete `infrastructure/prisma-billing-types.ts` and restore the imports it
replaced, uncomment the wiring in `src/app.ts` and `src/cron.ts`, put the integration suite back
into `scripts/test-integration.mjs`, then mount `IapProvider` on mobile.

## Type stand-ins

While the tables are commented out, `infrastructure/prisma-billing-types.ts` describes them by hand
so this module still compiles and its unit tests still run. Row shapes mirror the schema exactly;
query arguments are looser than Prisma's. That file is the first thing to delete when turning
billing on.

## Deleting instead

`docs/IAP.md` has the full list under "If Subscriptions Are Not Wanted". It is longer than this
directory: contracts, the DO spec generator, the Maestro audit, and several mobile tests reference
billing and must be cleaned up in the same pass.

## Reference

If this copy ever drifts, the working implementation lives at `github.com/di-sukharev/vibe`,
branch `mobile`.
