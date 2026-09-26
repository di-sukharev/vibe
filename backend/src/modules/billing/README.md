# Billing module

App Store and Google Play subscriptions. The module is complete and switched off. Its tables are commented out in `backend/prisma/schema/billing.prisma`, and `backend/src/app.ts` and `backend/src/jobs.ts` keep its wiring commented out. [IAP](../../../../docs/IAP.md) explains how it works and how to turn it on or remove it.

- `transport/`: the `/api/iap` routes, the App Store notification route, and the error mapping.
- `application/`: the ports and `BillingService`, which ingests and reconciles purchases, issues offer-code tokens, and processes notifications.
- `domain/`: subscription states and entitlement rules.
- `infrastructure/`: the Apple and Google verifiers, database operations, offer-code tokens, and the type stand-ins.
- `certs/apple/`: Apple root certificates ([manifest](certs/apple/README.md)).

While the tables are commented out, the generated Prisma client has no billing models. `infrastructure/prisma-billing-types.ts` describes them by hand, so the module still compiles. Its header says what to swap back.

Every suite here starts with `@parked-test`, so no test runner executes it ([TESTING](../../../../docs/TESTING.md)).
