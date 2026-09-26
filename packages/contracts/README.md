# Contracts

`@web-app-demo/contracts` holds the shared Zod schemas and inferred TypeScript types for API requests, responses, and errors. The backend, `webapp`, and the `mobile` branch import them. Never redefine these shapes in an app. The contracts-first workflow is in [ARCHITECTURE](../../docs/ARCHITECTURE.md).

## Rules

- Keep only validation, normalization, and shared types here, not business logic.
- Import only Zod and other contract files. `bun run architecture:check` rejects backend, client, framework, and provider imports.
- Put each schema and its inferred type in its domain file, such as `src/users.ts`, and re-export the file from `src/index.ts`.
- Pin the scheme of every URL field, from user input or storage. `z.url()` alone accepts `javascript:` and `data:`. Require `https:` unless the product needs another scheme. Example: `httpUrlSchema` in `src/uploads.ts` also allows `http:` for local signed URLs.
- Test each schema in the matching `src/*.test.ts`.

## Commands

From the root:

```bash
bun run test:contracts                       # the package's test script: bun test src
bun run --cwd packages/contracts typecheck   # tsc --noEmit; build does the same
```

Apps import `src/index.ts` directly, so the package has no build output.
