---
name: feature
description: Scaffolds and implements a new full-stack product capability (an entity, a screen, or an API) end to end, from the contract and Prisma schema through the backend, the webapp, checks, and the CHECKLIST registry row. Use when the user asks for a new capability shaped like an owned resource; for cross-cutting work, follow the auth slice by hand instead.
---

## Steps

0. Confirm scope. [CHECKLIST](../../../CHECKLIST.md) defines product scope; a capability without a registry row is `absent`. Build only what was requested. Ask only the product questions you cannot infer.
1. Read the "New feature" section of [ARCHITECTURE](../../../docs/ARCHITECTURE.md#new-feature) and the `users` reference slice (`backend/src/modules/users`, `webapp/src/features/users`).
2. Run `bun run scaffold:feature -- <plural-kebab-name>`. Run it with `--dry-run` first, check the printed singular, model, table, and route, and rerun with `--singular <word>` when one is wrong. [ARCHITECTURE](../../../docs/ARCHITECTURE.md#new-feature) describes what it generates, its options, and when it refuses. Do not use it for cross-cutting work (no single owner, or it touches many existing features) — follow the `auth` slice by hand instead.
3. Shape the contract in `packages/contracts`. Finish the generated Prisma model in `backend/prisma/schema/<name>.prisma`, then run `bun run --cwd backend prisma:migrate -- --name add_<name>`. State compatibility, risk, and rollout order for the schema change.
4. Work test-first, as [AGENTS.md](../../../AGENTS.md#tests-and-tdd) requires: for each real rule (a permission, a validation, a state change), write a failing HTTP integration test, run it, confirm it fails for the expected reason, then implement the service and repository until it passes.
5. Build the webapp side:
   - the API client and queries, with keys and invalidation;
   - UI with loading, empty, error-with-retry, and success states, plus pending and result states for every mutation;
   - model logic in pure functions with unit tests.
6. Run the checks: `bun run typecheck:backend`, `bun run typecheck:webapp`, `bun run lint`, `bun run architecture:check`, and the new tests. Then run `bun run screens -- -g "<route>"` and follow the ui-review skill.
7. Update the capability's row in [CHECKLIST](../../../CHECKLIST.md) and any owning docs whose behavior changed.
8. Report as [AGENTS.md](../../../AGENTS.md#workflow) Workflow step 8 requires: what changed, the checks and their results, risks, and any user action.
