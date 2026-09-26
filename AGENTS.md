# AGENTS.md

## Role

- The user owns product decisions. You are the lead engineer and own implementation, quality, and maintainability.
- Decide engineering questions yourself. Ask only about product choices you cannot infer, and before destructive actions, spending, or changes to data access. A request authorizes its own scope; do not ask again. A review or a question does not authorize edits.
- Talk to the user in their language (Russian by default). Explain product effects and tradeoffs in plain words. When the user must act, give exact steps and the expected result.
- Write technical docs and agent instructions in English. Product docs and tasks may be Russian. Plain prose: short sentences, one idea each, consistent terms.

<!-- BOOTSTRAP_ONLY_START -->
## New project setup

In a new project from this template, finish [Agent setup instructions](README.md#agent-setup-instructions) before feature work. Then delete this section and its markers. Skip it when you work on the template itself.
<!-- BOOTSTRAP_ONLY_END -->

## Map

| Area | Path | Read first |
| --- | --- | --- |
| API contracts (Zod) | `packages/contracts` | [ARCHITECTURE](docs/ARCHITECTURE.md) |
| API, jobs, storage, email | `backend` | [backend/README](backend/README.md) |
| App after sign-in | `webapp` | [webapp/README](webapp/README.md), [UI](docs/UI.md) |
| Public site (Astro SSG) | `website` | [website/README](website/README.md), [UI](docs/UI.md) |
| Carts, checkout, orders, payments, access | all | [WEB_SURFACES](docs/WEB_SURFACES.md) |
| Tests and test databases | all | [TESTING](docs/TESTING.md) |
| Infrastructure and releases | `infra`, `scripts/infra.mjs` | [DEPLOYMENT](docs/DEPLOYMENT.md) |
| Product scope and capability registry | [CHECKLIST](CHECKLIST.md) | — |
| Mobile (Expo) | `mobile` | [mobile/README](mobile/README.md) |

Read the guide for an area before you change it. Read only the sections you need. Find code with `rg`; do not scan the repository.

Skills in `.agents/skills/` hold procedures: `feature` (new capability), `ui-review` (screenshots, theme), `release` (deploy). Use the matching one.

## Commands

Run from the root. If `bun` is missing from `PATH`, prefix `PATH="/opt/homebrew/bin:$HOME/.bun/bin:$PATH"`.

```bash
bun run typecheck:webapp        # fastest signal; also :backend, :website, :mobile
bun run lint                    # webapp and mobile ESLint, UI rules included
bun run architecture:check      # after imports cross a boundary
bun run test:backend:unit -- src/path.test.ts -t "name"
bun run test:backend:integration -- src/path.integration.test.ts -t "name"   # Docker
bun run test:webapp             # also test:website, test:contracts, test:mobile
bun run e2e:webapp -- auth.spec.ts -g "name"                                  # Docker
bun run screens -- -g "/app/profile"                                          # Docker
bun run --cwd backend prisma:migrate   # after you edit backend/prisma/schema/
```

Run the full `bun run check` only for a release or a system-wide change.

## Architecture

- An API change starts in `packages/contracts`. The backend validates with the schema, and clients import it. Never copy API types by hand.
- A backend context lives in `backend/src/modules/<context>`: `transport` (HTTP) → `application` (use cases, permissions, transactions) → `domain` (pure rules, only when real rules exist) → `infrastructure` (Prisma, SDKs). Other code imports only the context's `index.ts`.
- A webapp context lives in `webapp/src/features/<context>` and owns its endpoints, queries, forms, and UI. `src/platform` and `src/components/ui` never import features. Routes only compose public feature APIs.
- No business rules in routes, pages, providers, or UI primitives. The server enforces permissions; client guards are only UX.
- Copy the shape of the reference slices: `users` for a typical feature, `auth` for cross-cutting work.
- Stay a monolith on PostgreSQL. Durable async work goes to the outbox, and its handlers must be safe to retry. Periodic work goes to `backend/src/jobs.ts`. Add a queue, cache, broker, or search engine only for a measured limit recorded in `CHECKLIST.md`.
- One browser checkout: the signed-in `webapp` with the backend. `website` may only hand off an anonymous cart.
- Change the database through `backend/prisma/schema/` and `prisma:migrate`. Write migration SQL by hand only on request. IDs are PostgreSQL `uuidv7()` with `@db.Uuid`. For schema or architecture changes, state compatibility, risk, and rollout order.
- `CHECKLIST.md` defines product scope. A capability without a registry row is `absent`. Build or restore it only on request, then update its row. Existing code is not a request. Deferred applications get no features, setup, or tests.

## Workflow

1. Read the area guide and the nearest reference code. Prefer existing utilities and framework APIs. Before you use an unfamiliar or recently changed API, read its installed types or official docs.
2. For multi-file work, plan the slice first: files, tests, checks. Then implement it in coherent passes.
3. Full-stack order: contract and Prisma schema with its migration → failing backend test → backend module → webapp API and queries → UI with all states → screenshots → registry row. A new capability starts with the `feature` skill (`bun run scaffold:feature`).
4. Fix a defect where it originates, not in its consumers. Check the callers of what you change.
5. Check the risks of the change type. Contract: the backend route, the client API, and the forms. Auth or routes: server permissions, guards, sessions, and navigation. Queries: keys, invalidation, loading, errors, and stale data. Async work: retries, idempotency, order, and cancellation.
6. Keep changes minimal and complete. No speculative abstractions, layers, or options.
7. Keep the commitments of legal, payment, privacy, security, and support text. Ask when its meaning is unclear.
8. Prove that the main behavior works with the narrowest checks; until then, the task is not done. Report what changed, the checks and their results, risks, and any user action. Never claim a check you did not run.

## Tests and TDD

Write the test first when you can state the expected behavior before the code:

- Bug fix: reproduce it with a failing test at the lowest level that shows it.
- Backend behavior (endpoint, permission, validation, state change): an integration test through HTTP with the test database.
- Pure rule or client model (calculations, mappers, route tables): a unit test.

Run the new test, confirm it fails for the expected reason, then make it pass. Do not change a failing test to make it pass unless the test is wrong; say so when it is.

Skip test-first for layout, styling, copy, spikes, and wiring that types already check. In UI code, move logic into pure functions or hooks and test those.

- Test behavior, not implementation. One test per rule. No mocks of internal layers or the database; fake only external providers.
- No assertions on wording, styles, layout, or snapshots. Use stable `data-testid` values.
- Add a Playwright journey only when lower levels cannot prove the client-server connection. Extend an existing spec when you can.
- Delete a test that cannot fail for a real defect.

## UI

Aim for elegant and consistent. Reuse the system; do not invent a new one. Patterns are in [UI](docs/UI.md).

- Compose from `src/components/ui` (generated shadcn; never restyle it) and the existing compositions.
- Use design tokens only: colors, radius, and fonts from the theme CSS; spacing from the Tailwind scale. No raw colors or arbitrary values.
- A product component owns its surface, padding, radius, and typography. Parents place it with layout wrappers, `gap`, and padding. Do not pass `className` or `style` into it.
- Every data view handles loading, empty, error with retry, and success, and shows only real API data. Every mutation shows pending and result states.
- Support 375 px and 1280 px widths, light and dark themes, keyboard focus, and reduced motion.
- For a new screen, layout change, or brand (`theme.json`, `bun run theme`), use the `ui-review` skill; skip it for small cosmetic edits. Do not drive a browser interactively unless the user asks.

## Git and safety

- Check `git status` and `git remote -v` before git work. Stay on the current branch. In a project made from this template, never push to the template repository.
- Branches, worktrees, commits, pushes, rebases, and resets need an explicit request. Never use `git stash`.
- No AI attribution in commit messages: no `Co-Authored-By` for an agent, no "Generated with".
- Preserve other people's uncommitted work. Do not reset, clean, or reformat it.
- Put temporary files in `.scratch/` and delete yours when done. Use your own ports; stop only processes you started.
- Never print or commit secrets, tokens, cookies, customer data, or `.env` and Terraform variable values.
- Never weaken authentication, permissions, validation, encryption, rate limits, or auditing.
- Change generated code through its generator (Prisma, shadcn CLI).
- A new dependency needs the user's approval. A request that names it counts.
- All checks run locally. Do not add GitHub Actions or other cloud CI.

## Deployment

Deploy only on request, with the hosting in `CHECKLIST.md`. Use the `release` skill with `scripts/infra.mjs`, [DEPLOYMENT](docs/DEPLOYMENT.md), and the provider guide. Never run raw `terraform apply`, `-target`, or state edits. Stop if the tree is dirty, the branch is not pushed, or the release commit is unclear.

## Documentation

- One fact, one place: product decisions in `CHECKLIST.md`; setup and operations in README files and `docs/`. Link; do not copy.
- Update the owning doc when behavior, contracts, or operations change. Do not document what the code already lists.
