# Contracts

This package defines API requests, responses, and errors with Zod. Applications import its schemas and inferred types directly from `src/index.ts`. There is no generated build output.

Keep validation, normalization, and shared types here. Business rules belong to the backend. Import only Zod and other contract files. `bun run architecture:check` enforces the boundary.

Put each schema in its feature file and export it from `src/index.ts`. Update the backend and affected clients when the contract changes.

Restrict URL schemes explicitly. `z.url()` also accepts `javascript:` and `data:`. Use `https:` unless the product requires another scheme. [src/uploads.ts](src/uploads.ts) permits HTTP for local signed URLs.

Run `bun run test:contracts` from the root. [package.json](package.json) defines the other scripts.
