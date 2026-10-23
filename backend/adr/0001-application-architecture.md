# 0001: Application architecture

Status: Current baseline. Recorded: 2026-10-20.

## Context

This record describes the architecture already used by the template. Public content, authenticated browser interactions, and protected data operations have different requirements. Keep their responsibilities separate while sharing API contracts.

## Decisions

### Separate public pages, browser application, and backend

Astro builds public pages as static HTML. React renders the authenticated application in the browser. Order and payment pages belong to the browser application. The backend owns permissions, authoritative prices, and payment verification when payments are added.

This keeps public content available in the initial HTML and puts protected operations behind one API. Client navigation and static content cannot grant access or confirm a payment.

### Share contracts and organize code by feature

Define API requests, responses, and errors with Zod in `packages/contracts`. The backend validates requests with these schemas. Clients reuse the schemas and their inferred types. This prevents separate applications from defining incompatible API rules.

Backend HTTP handlers call application services. These services check permissions and manage transactions. Database and provider code stays in infrastructure adapters. Add a domain layer when business rules need one. Other modules import a feature through its public `index.ts`.

Webapp features contain their API calls, queries, forms, and components. Routes assemble pages from feature exports. Shared platform code and UI primitives do not import features. These boundaries keep feature details out of unrelated code. `bun run architecture:check` checks the imports.

### Use PostgreSQL for data and durable background work

Use Prisma with PostgreSQL. Store durable tasks in the PostgreSQL outbox. Save a task and the data change requiring it in one transaction. Use the existing scheduler and workers for recurring work.

This avoids a separate broker for tasks that PostgreSQL can already handle. Outbox tasks can run more than once, so handlers must prevent harmful duplicate actions. Add another service only when measurements show that the existing system is insufficient.

### Deploy through the repository script

Terraform defines infrastructure. `scripts/infra.mjs` controls infrastructure changes and releases for the supported providers. It checks release inputs, protects resources, and coordinates concurrent operations. Operational steps belong in [Deployment](../../docs/DEPLOYMENT.md) and the provider guides.

Migrations run before application replacement. The previous application version must work with the migrated schema until the new version takes over.

## Consequences

- Public content changes require a rebuild. Interactive application pages require browser JavaScript.
- Contract changes can require coordinated backend and client changes.
- Breaking schema changes can require several compatible releases.
- Background tasks need retry handling and duplicate prevention.
- A new infrastructure service adds deployment and failure-handling work. Record its need and tradeoffs before adding it.
