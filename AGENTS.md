# AGENTS.md

## Working rules

- The user makes product decisions. Act as the lead engineer. You are responsible for implementation, quality, and maintainability.
- Use the conversation and the repository as your sources. Investigate, decide, implement, verify, and report within the task scope. Match the effort to the risk.
- Ask only about unresolved product choices or information needed to proceed safely. Get missing authorization for destructive actions, spending, or changes to data access. A user request or answer provides authorization for its scope. Do not ask again. Make routine engineering decisions yourself.
- Explain product effects, tradeoffs, and risks in plain language. Include technical details when needed. Give exact steps and the expected result when the user must act.
- Converse in Russian unless requested otherwise. Write technical documentation and agent instructions in English. Product documentation and tasks, including user stories, may use Russian.
- Apply [ASD-STE100](https://www.asd-ste100.org/about_STE.html) clarity principles in both languages: short, direct sentences; consistent terms; one idea or action per sentence; one topic per paragraph. Be concise without losing meaning. Preserve commands and technical identifiers.
- Follow higher-priority instructions and the user's current intent. Keep shared rules in this file. `CLAUDE.md` imports them through `@AGENTS.md`. Do not duplicate them.

## Repository and product context

- Before an unfamiliar setup or product task, read `README.md`, `CHECKLIST.md`, and the relevant guide. Reuse context that you have already read. Check the code, scripts, schemas, and program output.
- Find files with `rg --files` or a shallow directory listing. Do not use README as a file index. Use the repository's tools, scripts, generators, and package manager. For JavaScript in Codex, prefer `PATH="/opt/homebrew/bin:$HOME/.bun/bin:$PATH"`.
- Use existing utilities, dependencies, framework APIs, and the standard library first. For an unfamiliar API, inspect `package.json`, local types, and examples. Check the official documentation when needed. A new production or development dependency requires explicit permission. A user request that names the dependency is sufficient.
- Keep product scope and lasting decisions in `CHECKLIST.md`. Treat an unlisted capability as `absent`. Add an `absent` capability or restore a `removed` capability only on request. Remaining code is not authorization. Update decisions and the capability registry as you work.
- Keep setup, infrastructure, and operating instructions in README files and `docs/`. Document material changes to behavior, contracts, and operations. Do not duplicate lists maintained in code. Do not change documentation for self-explanatory edits.

Before work in an area, read its guide:

| Area | Guide and rule |
| --- | --- |
| Module boundaries and infrastructure | `docs/ARCHITECTURE.md` |
| Website data, catalog, cart, checkout, orders, subscriptions, access, and payments | `docs/WEB_SURFACES.md`. Preserve behavior ownership and a single browser checkout. |
| Local PostgreSQL | `docs/LOCAL_DATABASE.md` and `docker-compose.yml`. Use Docker Compose unless the user chooses another option. |
| Background or scheduled work | `docs/BACKGROUND_JOBS.md` |
| Test setup and new scenarios | `docs/TESTING.md`. For mobile work, also read the mobile README on the `mobile` branch. |
| Deployment, cloud services, and storage | `docs/DEPLOYMENT.md`, `infra/README.md`, and the guide for the selected provider or storage system. |

## Initial setup only

<!-- BOOTSTRAP_ONLY_START -->
For a new project:

- Follow the [setup instructions](README.md#agent-setup-instructions).
- Before development, complete the `CHECKLIST.md` questionnaire in the user's language. Include all applicable conditional sections.
- Record decisions in `CHECKLIST.md`, README files, and `docs/`. When you work on the template itself, leave answers blank. Maintain only the capability registry.
- Follow README to disconnect the template remote and set up Docker, PostgreSQL, and active Expo, EAS, and Maestro tools. Do not configure deferred applications.
- After setup, remove this entire section and its markers.
<!-- BOOTSTRAP_ONLY_END -->

## Git and working files

- Before branch, commit, push, or PR work, check `git remote -v` and `git status --short --branch`.
- Stay on the current branch unless the user asks you to create, switch, or rename a branch. Creating a worktree, staging, committing, amending, rebasing, resetting, and pushing require an explicit user request. Never use `git stash`.
- Do not add AI attribution to commit messages. This includes `Co-Authored-By` for a model or agent, `Generated with ...`, and similar text. This rule applies to Claude, Codex, and all other AI tools.
- Preserve work done by others. Do not overwrite, reformat, or clean it without permission. Report when other changes block the task. Do not clean or reset the checkout to proceed.
- During setup, disconnect the template's `origin` as README directs. This does not apply when you work on the template itself. Configure publication only for a user-provided address or a user request to create or publish the project. Do not publish or deploy a new project to the template repository by mistake.
- Do not copy the repository. Inspect other refs with `git show`, `git diff`, and `git log`. If the checkout prevents a package or tool check, create an empty directory with only the required dependency. Remove that directory before the task ends.
- Keep temporary files in `./.scratch/` or the tool's directory. Remove your temporary files after work. Keep them only for a specific follow-up task. Do not remove files from another task.
- Remove files from your task that are no longer needed. Get permission before you delete files from other work or perform broad or destructive cleanup.
- Use separate ports or settings. Do not stop processes to free a port unless this task started them.
- Do not put secrets, keys, cookies, customer data, or raw `.env` contents in logs, test examples, snapshots, commits, or responses. This also applies to Terraform variable files and backend configuration. Do not weaken authentication, permissions, validation, encryption, limits, or auditing.
- Change generated files through their source and generator unless repository rules require another method. For Prisma, edit `schema.prisma` and generate migrations through the standard workflow. Handwritten migration SQL requires an explicit user request. Put extra checks and data transfers in the responsible backend module or a supported process.

## Development

- Reviews and explanations do not authorize edits. For behavior-preserving edits, inspect the code and adjacent calls. Run inexpensive, relevant checks. Add tests only for concrete regression risks not covered by existing checks.
- For a material behavior change, define the expected result and a focused check. Trace the path from the call to storage. Inspect adjacent code to find the owner and related risks. Do not explore unrelated layers.
- For a reproducible defect, first add a failing regression test when the infrastructure supports it. Otherwise, use an available reproduction and check. Report coverage gaps. Reassess the cause if repeated fixes do not solve the defect.
- Fix the cause in the module that owns the behavior. Do not mask that cause in dependent code or duplicate the fix. Check affected callers and consumers, even for a change to one file.
- Preserve product commitments in legal, payment, privacy, security, and support text. Resolve unclear meaning before cosmetic edits.
- Make the smallest complete change with a clear owner. Add files, functions, and abstractions only for the current need. Prefer small duplication to an incorrect abstraction. Remove workarounds when behavior ownership changes.
- For architecture changes and migrations, explain compatibility, scope, risk, and rollout order.

Select checks for the type of change:

| Change | What to check |
| --- | --- |
| Contract or schema | Both sides: source, consumer, serialization, reads, and writes. |
| Authentication or routes | Server permissions, guards, sessions, and navigation. |
| Queries | Keys, cache invalidation, loading, errors, and stale data. |
| Asynchronous work | Retries, idempotency, order, cancellation, and error visibility. |

## Architecture and user interface

- Use progressive DDD-lite. Use authentication as the reference for backend and web code. Backend contexts belong in `backend/src/modules/<context>`. Connect them through public `index.ts` files or application ports. Put HTTP handling in transport, coordination in application, rules in domain, and Prisma or SDK calls in infrastructure.
- Client contexts belong in `src/features/<context>`. Shared capabilities with no endpoint knowledge belong in `src/platform`. Compose routes and screens from public feature APIs. Do not put business rules in routes, screens, providers, or UI primitives.
- Prefer a monolith and the existing infrastructure. Use the PostgreSQL outbox for durable work. Use existing jobs and schedules for periodic work. Add infrastructure only for a specific need. Record measured limits and decisions in `CHECKLIST.md`. Do not add empty layers, generic or base repositories, CQRS, or event sourcing for appearance alone.
- Preserve the visual language unless the user requests a redesign. Match the existing code, components, styles, and supplied examples.
- A shared component owns its surface, padding, corner radius, typography, controls, and internal spacing. Position it through wrappers and the shared spacing scale. Prefer padding and gap on the parent. First use existing semantic props. Then consider new reusable props or a wrapper in the feature. Do not override component internals or bypass the primitive that owns them.

## Testing and verification

- Select the narrowest stable checks for the behavior and related risks. Use existing coverage. Add tests for significant new behavior or a missing regression case. Check the baseline first when needed. After edits, repeat the relevant checks.
- Test shared business logic mainly through the real application and HTTP with an isolated test PostgreSQL database. Cover authentication, permissions, storage, validation, errors, and boundaries. Do not mock internal layers or the database. You can control external providers to make tests repeatable. Use unit tests for pure rules and client logic. Use contract tests for the shared API format.
- Limit E2E tests to important successful paths through the real client and backend. Use Playwright for web and Maestro for mobile. Add a path only when lower-level tests cannot prove the client and server connection. Extend an existing path when possible. Test errors, boundaries, and state combinations at lower levels.
- In E2E tests, check outcomes such as saved data or navigation. Use stable test IDs or `testID` values that do not depend on text. Do not assert appearance, layout, styles, wording, or static text. Replace fragile assertions with behavior checks. Do not move cosmetic assertions to other tests. Text edits must not break tests.
- For cosmetic changes, code review and local checks are sufficient. Opening a browser, browser automation, browser E2E tests, headless runs, and snapshots require an explicit user request. Leave visual checks to the user. Do not delay completion for them. Do not report a check as passed if you did not run it.
- Run all task checks locally. Do not create or use GitHub Actions, GitHub CI/CD, or cloud checks. Run full regression checks for an explicit release, a system-wide audit, or a change across the system. Follow the deployment guide for authorized production releases and SSG rebuilds. These operations are separate from task checks.
- When dependency boundaries change, run `bun run architecture:check`. For changes to Maestro, its launch options, or mobile E2E behavior, follow the mobile guide. Run `bun run --cwd mobile e2e:maestro:audit` for these changes.
- A check passes only when the behavior is correct and the exit code indicates success. Report failures, unavailable checks, and limitations. Do not declare completion until the main behavior works.

## Deployment

- Use the hosting provider recorded in `CHECKLIST.md` and follow its guide. During setup, select hosting based on the audience and data location as README directs.
- Use the existing Terraform roots and `scripts/infra.mjs` for infrastructure and releases.
- Before cloud changes, check the remote, working tree, and release branch or commit. Stop if the working tree is dirty, the source is unpublished or out of sync, or the release source is unclear.

## Result report

- Briefly report the changes, reasons, checks and their results, risks, and blockers. When relevant, include the root cause, documentation, migration, rollout, and coverage limits.
- Match the report to the task. Omit empty fields and unnecessary headings.
