# AGENTS.md

## Role

- The user owns product decisions; you own engineering, implementation, quality, and maintainability.
- Decide engineering questions. Resolve uncertainty from code and docs; state assumptions affecting scope or user-visible behavior.
- Ask only about product choices you cannot infer, or before destructive actions, spending, or changes to data access. Requests authorize their scope; do not reconfirm. Reviews and questions do not authorize edits.
- Use the user's language (Russian by default). Explain product effects and tradeoffs plainly. When user action is needed, give exact steps and expected results.
- Use English for technical docs and agent instructions; Russian is allowed for product docs and tasks. Short sentences, one idea each, consistent terms.

<!-- BOOTSTRAP_ONLY_START -->
## New project setup

For projects created from this template, complete [agent setup](README.md#agent-setup-instructions) before features, then delete this section and its markers. Skip when editing the template.
<!-- BOOTSTRAP_ONLY_END -->

## Map

| Area | Guide |
| --- | --- |
| Contracts (`packages/contracts`, Zod) | [Architecture](docs/ARCHITECTURE.md) |
| API, jobs, storage, email (`backend`) | [Backend](backend/README.md) |
| Signed-in app (`webapp`) | [Webapp](webapp/README.md), [UI](docs/UI.md) |
| Public site (`website`, Astro SSG) | [Website](website/README.md), [UI](docs/UI.md) |
| Carts, checkout, orders, payments, access | [Web surfaces](docs/WEB_SURFACES.md) |
| Tests and test databases | [Testing](docs/TESTING.md) |
| Infrastructure (`infra`, `scripts/infra.mjs`) | [Deployment](docs/DEPLOYMENT.md) |
| Product scope and capability registry | [CHECKLIST](CHECKLIST.md) |
| Mobile (`mobile` branch, Expo) | [Mobile](mobile/README.md) |

## Commands

Run from the root. If `bun` is missing, prefix `PATH="/opt/homebrew/bin:$HOME/.bun/bin:$PATH"`.

```bash
bun run typecheck:webapp        # fastest signal; also :backend, :website
bun run lint                    # webapp ESLint, including UI rules
bun run architecture:check      # after imports cross boundaries
bun run test:backend:unit -- src/path.test.ts -t "name"
bun run test:backend:integration -- src/path.integration.test.ts -t "name"   # Docker
bun run test:webapp             # also test:website and test:contracts
bun run e2e:webapp -- auth.spec.ts -g "name"                                  # Docker
bun run screens -- -g "/app/profile"                                          # Docker
bun run --cwd backend prisma:migrate   # after schema edits
```

Run `bun run check` only for releases or system-wide changes.

## Architecture

- API contract changes start in `packages/contracts`. The backend validates against shared schemas; clients import them. Never copy API types manually.
- Backend contexts: `backend/src/modules/<context>`. Layers: `transport` (HTTP) → `application` (use cases, permissions, transactions) → `domain` (pure rules; omit if none) → `infrastructure` (Prisma, SDKs). Imports from outside the context use only its `index.ts`.
- Webapp contexts: `webapp/src/features/<context>`, owning endpoints, queries, forms, and UI. `src/platform` and `src/components/ui` never import features. Routes compose public feature APIs only.
- No business rules in routes, pages, providers, or UI primitives. Enforce permissions on the server; client guards serve UX.
- Reference structure: `users` for features, `auth` for cross-cutting work.
- PostgreSQL monolith. Durable async work uses the outbox; handlers must be safe to retry. Periodic work: `backend/src/jobs.ts`. Add queues, caches, brokers, or search engines only for measured limits recorded in `CHECKLIST.md`.
- Browser checkout runs only in the signed-in `webapp` with the backend. `website` only hands off anonymous carts.
- Database changes: `backend/prisma/schema/` → `prisma:migrate`. Manual migration SQL only on request. IDs: PostgreSQL `uuidv7()` with `@db.Uuid`. For schema or architecture changes, state compatibility, risks, and rollout order.
- `CHECKLIST.md` defines scope. No registry row means `absent`; build or restore only on request, then update the row. Existing code is not a request. No features, setup, or tests for deferred applications.

## Workflow

1. Before editing, read relevant guide sections and nearby reference code. Search with `rg`; do not scan the repository. Prefer existing utilities and framework APIs. Inspect installed types or official docs before using unfamiliar or recently changed APIs.
2. For multi-file changes, plan expected behavior, affected files, and checks that verify it. Implement in coherent passes.
3. Full-stack order: contracts + Prisma schema/migration → failing backend test → backend module → webapp API/queries → UI with all states → screenshots → registry update.
4. Fix root causes. Inspect affected call sites and consumers.
5. Assess risks: contracts—backend routes, client APIs, forms; auth/routes—server permissions, guards, sessions, navigation; queries—keys, invalidation, loading, errors, stale data; async—retries, idempotency, order, cancellation.
6. Keep changes minimal and complete. No speculative abstractions, layers, or options. Review the final diff: each change must serve the request or its verification. Remove code your changes made unused; leave unrelated code, comments, and formatting alone.
7. Preserve commitments in legal, payment, privacy, security, and support text; ask if the meaning is unclear.
8. Verify expected behavior with the narrowest relevant checks before finishing. Report changes, checks and results, risks, and required user actions. Never claim checks you did not run.

## Tests and TDD

Test first when expected behavior is known:

- Bugs: failing regression test at the lowest level that reproduces the defect.
- Backend behavior (endpoints, permissions, validation, state changes): HTTP integration tests with the test database.
- Pure rules and client models (calculations, mappers, route tables): unit tests.

Run the new test; confirm it fails for the expected reason, then make it pass. Change the test only if it is wrong; explain why.

Skip test-first for layout, styling, copy, spikes, and wiring verified by types. Extract UI logic into pure functions or hooks; test it.

- Test behavior, not implementation; one rule per test. Use test doubles only for external providers, never internal layers or the database.
- No assertions on wording, styles, layout, or snapshots. Use stable `data-testid` values.
- Add Playwright journeys only when lower-level tests cannot verify the client-server connection. Prefer extending existing specs.
- Delete tests that cannot fail for real defects.

## UI

Build elegant, consistent UI with the existing design system.

- Use generated shadcn primitives in `src/components/ui` and existing compositions. Never restyle primitives.
- Use theme CSS tokens for colors, radii, and fonts; Tailwind scale for spacing. No raw colors or arbitrary values.
- Product components own surface, padding, radius, and typography. Parents place them with layout wrappers, `gap`, and padding. No `className` or `style` props on product components.
- Data views: loading, empty, error with retry, success. Display API data or derived values; no hardcoded sample data. Mutations: pending, success, and error feedback.
- Support 375 px and 1280 px widths, light/dark themes, keyboard focus, and reduced motion.
- For new screens, layout changes, or branding (`theme.json`, `bun run theme`), run `bun run screens` for affected routes. Review images and fix visible issues; at most two rounds ([visual check](docs/UI.md#visual-check)). Skip small cosmetic edits. Interactive browser control requires an explicit request.

## Git and safety

- Before Git work, inspect `git status` and `git remote -v`. Stay on the current branch. In projects created from this template, never push to the template repository.
- Branches, worktrees, commits, pushes, rebases, and resets require explicit requests. Never use `git stash`.
- No AI attribution in commit messages, including agent `Co-Authored-By` trailers or "Generated with".
- Preserve others' uncommitted work; never reset, clean, or reformat it.
- Keep temporary files in the system temp directory; delete yours afterward. Use your own ports; stop only processes you started.
- Never print or commit secrets, tokens, cookies, customer data, `.env` values, or Terraform variable values.
- Never weaken authentication, permissions, validation, encryption, rate limits, or auditing.
- Edit generated code through its generator (Prisma, shadcn CLI).
- New dependencies require approval; a request naming one counts.
- Run all checks locally. No GitHub Actions or other cloud CI.

## Deployment

Deploy only on request, using hosting in `CHECKLIST.md` and `scripts/infra.mjs`. Follow [Deployment](docs/DEPLOYMENT.md) and the provider guide. Never run raw `terraform apply`, use `-target`, or edit Terraform state. Stop for a dirty tree, unpushed branch, or unclear release commit.

## Documentation

- Product decisions: `CHECKLIST.md`. Setup and operations: README files and `docs/`. Link; never duplicate.
- Update the owning doc when behavior, contracts, or operations change. Do not document what code already lists.
