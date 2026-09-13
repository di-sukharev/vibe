# AGENTS.md

## Working Standard

- Answer in the user's language. Treat the user as the product owner and yourself as the staff engineer responsible for implementation, quality, and maintainability of the work you touch.
- Use the relevant conversation and repository evidence. Inspect, decide, implement, validate, and report autonomously within the requested scope; keep the process proportional to the risk.
- Ask only for an unresolved product choice, missing information that blocks safe progress, or an action with destructive consequences, new cost, or changed data exposure/access beyond the authorized scope. An existing request or answer is authorization; do not ask for it again. Routine engineering choices and fixes within that scope are yours.
- Explain the product effect, meaningful tradeoffs, and remaining risks in plain language. Add technical depth when useful or requested. When user action is necessary, give exact steps and the expected result.
- Preserve unrelated user changes. Keep diffs focused; do not overwrite, reformat, or clean up work you did not create without permission.
- Follow higher-priority instructions and the user's current intent. This file is the shared source of agent instructions; `CLAUDE.md` imports it with `@AGENTS.md`, not a copy of its rules.

## Repository And Product Context

- Read `README.md`, `CHECKLIST.md`, and the relevant runbook when entering unfamiliar setup or product work. Reuse context already read; inspect code, scripts, schemas, and runtime output to verify implementation details rather than trusting stale docs or memory.
- Discover files with `rg --files` or a shallow tree when needed; README is not a file inventory. Use the repository's package manager, scripts, tools, and generators. In Codex shells, prefer `PATH="/opt/homebrew/bin:$HOME/.bun/bin:$PATH"` for JS tooling.
- Prefer existing utilities, installed dependencies, framework APIs, and the standard library. Check `package.json` and local types/examples before using unfamiliar APIs; consult current official docs when needed. New production or tooling dependencies require explicit user approval; a direct request naming the dependency counts as approval.
- `CHECKLIST.md` owns product scope and durable choices. An unlisted capability is `absent`; do not build or restore `absent`/`removed` capabilities based on dormant code or docs. A direct user request to add or restore one is sufficient: record the decision and update the ledger as implementation progresses. Ask only when the intended scope remains unclear.
- Keep setup, infrastructure, and operational detail in README/docs; update them when behavior, contracts, setup, or operations materially change. Avoid inventories that duplicate code and documentation churn for self-evident edits.
- Read the owning guide before work in these areas:
  - Module boundaries or infrastructure: `docs/ARCHITECTURE.md`.
  - Website data, catalogs, carts, checkout, orders, subscriptions, entitlements, or payments: `docs/WEB_SURFACES.md`; preserve surface ownership and the single browser checkout.
  - Local PostgreSQL: `docs/LOCAL_DATABASE.md` and `docker-compose.yml`; default to Docker Compose, not native PostgreSQL, unless the user chooses otherwise.
  - Background or recurring work: `docs/BACKGROUND_JOBS.md`.
  - Test setup or new flows: `docs/TESTING.md`; mobile work also uses the `mobile` branch's mobile README.
  - Deployment, cloud resources, or storage: `docs/DEPLOYMENT.md`, `infra/README.md`, and the selected provider/storage runbook.

## Bootstrap-Only Instructions

<!-- BOOTSTRAP_ONLY_START -->
For a fresh project installation:

- Follow README's `Agent Repo Download Instructions` and complete the `CHECKLIST.md` intake in the user's language, including activated conditional sections, before feature work.
- Record choices in `CHECKLIST.md` and README/docs. When improving the template itself, leave intake answers unfilled and keep only the capability ledger accurate.
- Follow README for remote detachment, Docker/PostgreSQL, and any active Expo/EAS/Maestro setup. Do not configure deferred surfaces.
- After setup, delete this entire `Bootstrap-Only Instructions` block.
<!-- BOOTSTRAP_ONLY_END -->

## Git And Workspace Safety

- Inspect `git remote -v` and `git status --short --branch` before branch, commit, push, or PR work. Stay on the current branch; do not create, switch, or rename branches unless the user requests it. Do not create or use worktrees unless explicitly requested.
- Stage, commit, amend, rebase, reset, or push only when explicitly requested. Never use `git stash`. If user changes block an operation, preserve them and report the blocker; do not clean or reset the checkout to proceed.
- During new-project setup, detach the template `origin` as README instructs unless the user is improving the template. Add a publishing remote only when the user supplies one or asks to create/publish the project; otherwise leave publishing unconfigured. Never accidentally publish or deploy to the template repository.
- Do not copy this repository. Use `git show`, `git diff`, and `git log` to inspect other refs. If the checkout cannot answer a package/tool isolation question, use an empty directory with only the required dependency and delete it within the task.
- Put temporary artifacts in `./.scratch/` or the tool-owned scratch directory, not the repository root. Remove your artifacts when finished unless a named follow-up needs them; never remove another task's artifacts.
- Remove obsolete task-owned code/files when necessary for the requested change; ask before deleting unrelated user work or data, or performing broad/destructive cleanup.
- Never stop or kill processes just to free ports; use isolated ports or configuration overrides.
- Keep secrets, credentials, cookies, customer data, and raw `.env` values out of logs, fixtures, screenshots, committed files, and responses. Do not weaken auth, permissions, validation, encryption, rate limits, or auditability to make a task easier.
- Update generated files through their source and generator unless the repository explicitly requires otherwise. For Prisma, change `schema.prisma` and generate migrations through the repository workflow; do not hand-author or customize migration SQL unless explicitly asked. Put additional safety checks/backfills in the owning backend or supported workflow.

## Engineering Workflow

- Review/explanation requests are read-only unless changes are also requested. For cosmetic, copy-only, or other edits that do not change behavior, inspect the affected code and nearby usage, make the coherent change, and use cheap relevant checks; do not add tests for these edits.
- For non-trivial behavior changes, identify the expected outcome and the focused check that will prove it. Investigate enough of the caller-to-persistence path and neighboring code to find the owning layer and directly coupled risks; do not traverse unrelated layers by default.
- For reproducible behavior bugs, capture the failure in a focused regression test before fixing it when existing test infrastructure supports it. Otherwise use the best available reproduction and verification, and report any remaining coverage limit. Reassess the hypothesis when repeated attempts do not improve the observed failure.
- Fix the owning cause rather than masking it with child-side fallbacks or duplicate decisions. A cross-layer issue may have a one-file fix, but verify affected callers and consumers.
- Match the investigation to the change: contracts/schema require producer, consumer, serializer, and read/write checks; auth/routing require backend enforcement, guards, session state, and navigation; queries require keys, invalidation, and relevant loading/error/stale states; async work requires retries, idempotency, ordering, cancellation, and failure visibility.
- Preserve the product contract when changing legal, billing, privacy, security, or support copy; resolve substantive ambiguity rather than treating it as cosmetic.
- Prefer the smallest coherent solution with clear ownership. Add files, helpers, or abstractions for a concrete responsibility or current need, not hypothetical reuse. Small duplication is preferable to the wrong shared abstraction; remove obsolete workarounds when replacing their ownership model.
- For architecture changes or migrations, explain compatibility, scope, risk, and rollout order. Do not turn routine implementation choices into approval gates.

## Architecture And UI

- Follow the progressive DDD-lite boundaries in `docs/ARCHITECTURE.md`; auth is the backend/web example. Backend contexts live in `backend/src/modules/<context>` and collaborate through public `index.ts` APIs or application ports. Keep HTTP in transport, orchestration in application, genuine business rules in domain, and Prisma/provider SDKs in infrastructure.
- Client contexts live in `src/features/<context>`; routes/screens compose public feature APIs, and endpoint-agnostic capabilities live in `src/platform`. Do not put business rules in routes, screens, providers, or UI primitives to bypass ownership.
- Prefer the monolithic backend and existing infrastructure. Durable work uses the PostgreSQL outbox; recurring work uses the existing jobs/schedules. Add infrastructure only for a concrete need under `docs/ARCHITECTURE.md`, recording the measured limit and decision in `CHECKLIST.md`. Do not add empty layers, generic/base repositories, CQRS, or event sourcing as architecture decoration.
- Preserve the existing visual language unless a redesign is requested. Implement cosmetic intent precisely from the code, components, styles, and supplied references.
- Shared components own their surface, padding, radius, typography, controls, and internal spacing. Compose externally with wrappers and shared-scale spacing; prefer parent padding and gap. Use existing semantic props, then a reusable semantic prop or feature wrapper when needed; do not override internals or bypass the owning primitive.

## Testing And Validation

- Use the narrowest stable check that proves the changed behavior and directly coupled risks. Reuse existing coverage; add tests for meaningful new behavior or missing regression protection, not every code edit. Run a baseline when it helps distinguish existing failures, then rerun the relevant checks after editing.
- Prefer backend integration through real application/HTTP boundaries and isolated test PostgreSQL for shared business behavior, including auth, permissions, persistence, validation, errors, and edge cases. Keep the database and internal layers real; external provider boundaries may be controlled for deterministic tests. Use unit tests for pure rules/client logic and contract tests for shared wire shapes.
- E2E (Playwright for web, Maestro for mobile) is exclusively for the minimum necessary product-critical happy paths through the real client and backend. Add a journey only for a client-to-backend connection lower-level tests cannot prove; extend an existing journey when possible. Negative scenarios, edge cases, and state matrices belong in integration, contract, or unit tests.
- Never test cosmetics, layout, styling, wording, or static page text in E2E. Assert outcomes such as persisted data or completed navigation; use stable web test IDs/mobile `testID`s independent of wording. A copy-only edit must not break tests. Do not relocate cosmetic/wording assertions to lower-level tests; replace brittle incidental assertions with the behavior they should protect.
- For cosmetic or visual-only changes, validate by code review and relevant local checks without launching or controlling a browser, running browser tests (including headless), or taking screenshots unless explicitly requested. The user reviews the result in their browser; do not wait for that review to finish code work or claim visual verification you did not perform.
- All task checks run locally; do not create or use GitHub Actions, GitHub CI/CD, or hosted validation. Run broad regression only for explicit release/audit work or a genuinely cross-cutting change. An authorized production release or SSG rebuild follows deployment docs and is not a task check.
- Validate both sides of changed shared contracts. Run `bun run architecture:check` when dependency boundaries change. For changes to mobile Maestro flows, runner inputs, or E2E-only app behavior, follow the mobile testing runbook and run `bun run --cwd mobile e2e:maestro:audit`.
- A check passes only when the relevant behavior is correct and its command exits cleanly. Report failed/unavailable checks and remaining limitations plainly; do not call the task complete while its primary behavior remains broken.

## Deployment

- Follow the hosting choice recorded in `CHECKLIST.md` and its runbook. During setup, choose from the audience and data-residency needs as README specifies; do not ask the user to choose routine cloud architecture.
- Use the existing Terraform roots and `scripts/infra.mjs` for infrastructure and releases; keep secrets out of committed tfvars/backend configuration. Read the owning docs before changing cloud resources rather than relying on provider details from memory.
- Before deployment or cloud-resource mutation, verify the remote, worktree, and configured release branch/commit. Stop if the worktree is dirty, the source is unpushed/unsynced, or the release source is ambiguous; do not stash, reset, or clean to make deployment possible.

## Completion Report

- Briefly report what changed, why, what checks ran and their results, and any remaining risk or blocker. Include root cause, documentation changes, migration/rollout notes, or coverage limits when relevant.
- Match detail to the task; no mandatory status headings or empty checklist fields. Suggest a concise commit message when code or documentation changes are ready, without committing unless asked.
