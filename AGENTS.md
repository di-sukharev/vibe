# AGENTS.md

## Working agreement

The user decides product behavior. Choose the implementation, structure, and checks yourself. Ask when an unresolved product choice changes the result. A request authorizes its scope. Reviews and questions do not authorize edits.

Use the user's language in conversation, product documents, and tasks. Write technical documents and agent instructions in English. Follow ASD-STE100 writing rules: short sentences, active voice, and consistent terms.

## Project

| Path | Purpose |
| --- | --- |
| `packages/contracts` | Shared Zod schemas for API requests, responses, and errors |
| `backend` | Bun/Hono API and background processes, with Prisma and PostgreSQL |
| `webapp` | React application rendered in the browser (CSR), for signed-in users |
| `website` | Public Astro pages rendered at build time (SSG) |
| `mobile` branch | Expo application |
| `infra` | Terraform configuration for deployment |

Package scripts, environment schemas, and configuration files define current behavior. Use application README files for local setup and operational constraints. Do not copy code inventories into documents.

## Architecture

Define API changes in `packages/contracts`. The backend validates the shared schemas. Clients import their types and validation rules. Do not copy API types into applications.

Keep backend features in `backend/src/modules/<feature>`. HTTP handlers call application services. Application services own permissions, transactions, and use cases. Infrastructure adapters implement database and provider operations. Add a domain layer only for business rules. Other modules import the feature through its `index.ts` or an explicit application port.

Keep webapp features in `webapp/src/features/<feature>`. Each feature owns its API calls, queries, forms, and components. Routes compose public feature APIs. Shared platform code and UI primitives must not import features. `bun run architecture:check` enforces the import boundaries.

Enforce permissions in the backend. Client guards control navigation and presentation. Public pages belong to `website`; signed-in pages and browser checkout belong to `webapp`. The backend determines prices, payment status, and access. Client redirects cannot confirm payment.

## Database

Use PostgreSQL and the existing backend before adding infrastructure. Add a queue, cache, broker, or search service only to address a measured limit.

Edit `backend/prisma/schema/`, then run `bun run --cwd backend prisma:migrate`. Generate migrations with Prisma. Write custom SQL when the user requests it or Prisma cannot represent the required database feature. Keep `prisma`, `@prisma/client`, and `@prisma/adapter-pg` on the same exact version.

Use PostgreSQL `uuidv7()` defaults and `@db.Uuid` for generated IDs and their foreign keys. For existing data, explain compatibility and deployment order before changing the schema.

## Background work

Use the PostgreSQL outbox for work that must survive a restart. Enqueue the task in the transaction that requires it. Handlers can run more than once. Make them safe to repeat and pass cancellation signals to external calls.

Declare recurring jobs in `backend/src/jobs.ts`. Define schedules in `backend/src/job-schedules.json`. Use the existing scheduler and worker processes. See [Background jobs](docs/BACKGROUND_JOBS.md) for task handlers and operations.

## Feature changes

For a full-stack feature, define the shared contract and required migration first. Add a failing backend integration test, then implement the backend and client. Complete the UI states and verify the result.

Correct shared defects where the wrong result originates. Do not add separate workarounds in each caller.

## Tests and TDD

Use test-driven development for behavior changes and bug fixes. Run the test and confirm the expected failure. Implement the change, then refactor while tests pass. Copy and styling changes do not need test-first development.

Prefer HTTP integration tests with real PostgreSQL. Replace external providers with test doubles; keep internal services and the database real. Add unit tests only for cases that integration tests cannot cover efficiently. Do not duplicate the same coverage at several levels.

Test denied access as well as successful requests. For session and query changes, check sign-out, account changes, and responses from obsolete requests. Use Playwright when verification needs browser behavior. Do not assert UI wording, CSS, markup, or snapshots. Runner instructions are in [Testing](docs/TESTING.md).

## UI

Use the existing design system and generated shadcn primitives. Change generated primitives through the pinned CLI. Product components own colors, typography, padding, borders, and radius. Use theme tokens. Parents control placement through wrappers, padding, and gaps. Do not pass `className` or `style` into product components.

Show real data, loading and empty states, errors with retry, and feedback for writes. Keep screens usable on phones and with a keyboard. Follow [UI](docs/UI.md) for theme generation and scripted screenshots. The user performs the final visual check. Interactive browser use requires an explicit request.

## Verification and documentation

Run the relevant types, lint, tests, and builds locally. Use package scripts for commands. Run `bun run check` for releases or changes across applications. Do not add cloud CI. Report the changes, checks, failures, and required user actions. Never claim a check you did not run.

Code and configuration are the source of truth. Document only decisions, constraints, and procedures that they do not explain. Update the existing document instead of adding another guide or repeating instructions.

## Git and safety

Inspect Git status and remotes before Git operations. Stay on the current branch unless asked to switch. Branches, worktrees, commits, pushes, rebases, and resets require explicit requests. Never stash or discard another person's work. Do not add AI attribution to commits. New projects must not push to the template repository.

Ask before destructive actions, spending, new dependencies, or changes to data access. A request that names a dependency authorizes it. Never print or commit secrets or personal data. Never weaken authentication, permissions, validation, encryption, rate limits, or auditing.

Keep temporary files in the system temp directory and delete them afterward. Use your own ports and stop only processes you started.

## Deployment

Deploy only on request through `scripts/infra.mjs`. Follow [Deployment](docs/DEPLOYMENT.md) and the selected provider guide. Stop for a dirty tree, an unpushed branch, or an unclear release commit. Never run raw `terraform apply`, use `-target`, or edit state outside documented recovery.

## Maintenance

No slop. Write clear, declarative code. Prefer the smallest solution that meets the requirement and stays easy to read. Remove code your changes make unused.

Write as if you will maintain this code for the next 10 years. Keep it clean. Take ownership of every module you change and leave it better than you found it.
