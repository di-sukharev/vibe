# Contracts

The contracts package is the shared source of truth for API payloads, DTOs, and error shapes. Backend, web, and mobile import these schemas instead of redefining request or response shapes locally.

## Stack

- TypeScript
- Zod

## Commands

From the repository root:

```bash
bun run --cwd packages/contracts typecheck
```

From `packages/contracts`:

```bash
bun run typecheck
bun run build
```

## Practice

Add or change API shapes here before updating backend routes or client forms. Export schemas and inferred TypeScript types from `src/index.ts` so all consumers use the same contract.

When a schema changes, validate both sides in the same pass:

- backend transport/application validation and serialization;
- web feature API adapter, form parsing, and UI state;
- mobile feature API adapters, form parsing, and UI state;
- relevant unit/integration/E2E tests from [../../docs/TESTING.md](../../docs/TESTING.md).

Do not add runtime-only business logic here. Contracts should stay focused on data validation, normalization, and shared TypeScript types.

For user-provided or database-stored public media URLs, validate the scheme explicitly instead of relying on `.url()` alone. Public image, video, and file URL fields should require `https:` unless a product has a documented reason to accept another scheme.

## Current Upstream Documentation

For schema, TypeScript, or consumer integration questions, consult the current upstream documentation linked here first. This README describes this package's conventions; upstream docs are authoritative for library behavior.

- [Zod docs](https://zod.dev/)
- [TypeScript docs](https://www.typescriptlang.org/docs/)
- [Hono docs](https://hono.dev/docs)
- [TanStack Form React docs](https://tanstack.com/form/latest/docs/framework/react/quick-start)
