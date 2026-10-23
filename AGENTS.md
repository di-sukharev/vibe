# AGENTS.md

## Working agreement

The user is not a programmer. The user owns the product. You own all the engineering decisions.

Use the user's language for conversation, product documents, and tasks. Write technical documents and agent instructions in English. Follow ASD-STE100: short sentences, active voice, and consistent terms. Use complete sentences and enough words to make each instruction clear.

## Project

| Path                 | Purpose                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `packages/contracts` | Shared Zod schemas for API requests, responses, and errors                |
| `backend`            | Bun/Hono API and background processes; Prisma and PostgreSQL              |
| `webapp`             | React app for users who have signed in; pages render in the browser (CSR) |
| `website`            | Public Astro pages rendered at build time (SSG)                           |
| `mobile`             | Expo application for iOS, Android, and web                               |
| `infra`              | Terraform deployment configuration                                        |

Read each application's README for local setup instructions and rules for running it.

## Architecture

Define API changes in `packages/contracts`. The backend validates shared schemas. Clients import shared types and validation rules. Never duplicate API types in applications.

Keep backend features in `backend/src/modules/<feature>`. HTTP handlers call application services. Add a domain layer only for business rules. Other modules import a feature only through its `index.ts`.

Keep webapp features in `webapp/src/features/<feature>`. Features own API calls, queries, forms, and components. Routes build pages using the public exports of features. Shared platform code and UI primitives must not import features. Mobile follows the same feature boundaries; `src/composition` connects providers to their APIs. `bun run architecture:check` enforces these boundaries.

Put public pages in `website`. Use `webapp` for pages that require sign-in and for order and payment pages.

Record significant architecture and infrastructure decisions in `backend/adr/` as numbered Markdown files. Examples include changing application boundaries, choosing a database or external service, or changing how background work or deployment runs. Explain the problem, chosen approach, reasons, and tradeoffs. Read relevant records before making these changes. [Current architecture](backend/adr/0001-application-architecture.md) records the starting decisions.

## Database

Use PostgreSQL and the existing backend before adding another service. Add a queue, cache, broker, or other services only if load (RPS) grows and the existing system becomes insufficient.

Generate migrations with Prisma: edit `backend/prisma/schema/`, then run `bun run --cwd backend prisma:migrate`. Use custom migration SQL only on request or for database features Prisma cannot represent. Keep `prisma`, `@prisma/client`, and `@prisma/adapter-pg` on the same exact version.

Use PostgreSQL `uuidv7()` defaults for generated primary IDs. Use `@db.Uuid` for those IDs and their foreign keys.

Deployment applies migrations before switching application code. Keep migrations compatible with the running version. For changes to existing data, explain what will be changed or deleted.

## Background work

Use the PostgreSQL outbox to store tasks that must survive restarts. When a database change needs a background task, save both in one transaction as per the best swe practices.

Declare recurring jobs in `backend/src/jobs.ts` and schedules in `backend/src/job-schedules.json`. Use the existing scheduler and workers. See [Background jobs](docs/BACKGROUND_JOBS.md) for handlers and operations.

## Tests and TDD

Use TDD for behavior changes and bug fixes. Run the test and confirm the expected failure. Copy and styling changes never need TDD.

Write only integration tests. Test backend behavior through HTTP APIs. Test jobs by calling the functions used in production. Run both with real internal services and an isolated PostgreSQL test database. Replace external providers with test implementations.

Never add unit tests, component tests, or cosmetic tests. Do not test UI wording, CSS, markup, visual appearance, or snapshots.

Browser E2E tests must run the webapp against the backend and test database. Use Playwright for critical browser behavior that backend integration tests cannot cover. See [Testing](docs/TESTING.md) for runners, assertions, and checks for session and query changes.

## UI

Use the existing design system and generated shadcn primitives. Keep styles inside application components, such as login forms and user cards. Use theme tokens. Control component placement through wrappers in the parent. Do not pass `className` or `style` to these components. This restriction does not apply to generated shadcn primitives.

Use the application's icon library. Keep one icon style per application. Never recreate standard UI icons with custom SVG, CSS, or emoji.

Show real data. Follow [UI](docs/UI.md) for UI states, accessibility, component generation, theme changes, and scripted screenshots. The user performs the final visual check. Interactive browser use requires an explicit request.

## Verification and documentation

Run relevant type checks, lint, tests, and builds locally through package scripts. Run `bun run check` before releases or when changes affect more than one application. Never add cloud CI. Report changes, checks, failures, and required user actions. Never claim checks you did not run.

Document only decisions, constraints, and procedures that are not clear from code or configuration. For other documentation, update an existing document if it covers the topic. Add a new document only for a new topic. Never repeat instructions or add code inventories, such as lists of files or functions.

## Git and safety

Before changing Git state, inspect status and remotes. Create, delete, rename, or switch branches only on explicit request. Create, move, or remove worktrees only on explicit request. Commit, push, rebase, or reset only on explicit request. Never stash or discard another person's work. Never add AI attribution to commits.

Ask before destructive actions, spending, or changing who can read or modify existing data. Do not ask again for an action the user has already explicitly authorized. Never print or commit secrets or personal data. Never weaken authentication, permissions, validation, encryption, rate limits, or auditing.

Keep temporary files in the system temp/ directory. Delete them after use. Start your processes on unused ports. Stop only processes you started.

## Deployment

Deploy only on request through `scripts/infra.mjs`. Follow [Deployment](docs/DEPLOYMENT.md) and the selected provider guide. Stop if there are uncommitted changes or the branch has not been fully pushed. Stop if the commit to deploy is unclear.

Never run `terraform apply` directly or use `-target`. Edit Terraform state only as instructed in the documented recovery procedures.

## Maintenance

Add required npm packages without asking — prefer the most popular, actively maintained open-source solutions that meet requirements.

Clean declarative code. Remove code your changes make unused.

No slop and make no mistakes 🤙🗿
