# Webapp

The CSR browser client provides the baseline auth flow for future app features. It lives behind authentication and needs no SEO, so it stays client-side rendered; the public, SEO-facing surfaces live in the `website` workspace instead. It consumes the same API contracts as mobile and should keep server-state, form-state, and auth behavior centralized.

## Project Surface Status

This section may be updated during first-run bootstrap. If the root `README.md` marks webapp as deferred, add a short note here explaining that browser work is intentionally paused. When the user activates webapp, remove or rewrite that note before starting browser development.

## Stack

- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- Radix UI
- TanStack Query
- TanStack Form
- TanStack Router
- Zod contracts from `@web-app-demo/contracts`
- shadcn CLI
- Playwright
- ESLint

## Commands

```bash
bun run dev
bun run build
bun run typecheck
bun run lint
bun run test
bun run e2e
bun run e2e:ui
bun run ui:info
```

From the repository root, use `bun run dev:webapp`, `bun run build:webapp`, `bun run typecheck:webapp`, `bun run test:webapp`, and `bun run e2e:webapp`.

## Env

Create `webapp/.env` when needed:

```bash
VITE_API_URL=http://localhost:3000
```

`VITE_API_URL` is build-time config. In production it must be a concrete backend origin such as `https://api.example.com`; if it changes, redeploy the App Platform Static Site so the built bundle stops using the old URL.

## Deployment

Production deployment for the browser app uses DigitalOcean App Platform Static Sites from the full Git monorepo branch with `bun install --frozen-lockfile && bun run build:webapp`, `webapp/dist`, and `index.html` as the SPA catch-all by default. Generate the concrete spec with `bun run deploy:do:specs webapp`; App Platform builds from Git, not from local `dist`. Follow the shared runbook in [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md). If the user explicitly chooses Yandex Cloud, deploy the built `webapp/dist` output through Yandex Object Storage static website hosting plus Cloud CDN by following [../docs/YANDEX_CLOUD.md](../docs/YANDEX_CLOUD.md).

## Practice

Use TanStack Query for server state, TanStack Form for forms, and shared Zod schemas from `packages/contracts` for validation. The access token lives only in browser memory; refresh uses the HttpOnly cookie set by the backend.

Keep the API client responsible for base URLs, auth headers, refresh/retry, and error parsing. Do not duplicate API shapes or auth state in page components.

Use shadcn/ui for web interface primitives. Treat `src/components/ui` as the shared UI primitive layer: most files are shadcn registry output, plus project-wide primitives such as `Typography`. Import those primitives through `@/components/ui/*`. Put app-specific wrappers and composed product components in `src/components` so normal lint rules keep applying. Avoid adding new one-off global CSS classes for product UI; compose screens with Tailwind utilities and shadcn theme tokens from `src/index.css`.

All web typography must go through `src/components/ui/typography.tsx`. Use `Typography` for page copy, headings `h1` through `h6`, labels, controls, captions, emphasis, shortcuts, code/kbd text, and screen-reader-only text. Do not add raw heading/paragraph/emphasis elements or Tailwind text-size/font/leading/tracking utilities in pages or UI components; the local ESLint typography policy enforces this.

The current shadcn configuration is `radix-maia` with the `hugeicons` icon library and CSS variables, as recorded in `components.json`. This template intentionally includes the full official shadcn component registry from `bunx shadcn@latest add --all -c webapp` so future projects can start from a complete local UI foundation. Do not add community registries, blocks, or custom UI generator output unless the product asks for them.

When adding or refreshing shadcn components:

```bash
bun run --cwd webapp ui:info
bun run --cwd webapp ui:add -- <component>
```

Use the local `shadcn` devDependency pinned in `webapp/package.json` and `bun.lock`; do not use `shadcn@latest` for routine refreshes because it can produce registry output that no longer matches this template. If generated files need compatibility fixes for current package versions, keep the edits small and leave app-specific composition outside `src/components/ui`.

## E2E

The Playwright smoke test lives in `e2e/specs/auth.spec.ts` and verifies client-side auth validation visibility, register/login mode switching, register, refresh after reload, protected UI, logout, invalid login error rendering, and a successful login after logout.

The run starts Docker Compose `postgres_test`, applies migrations to `web_app_demo_test`, starts the backend with `TEST_DATABASE_URL` as its `DATABASE_URL`, starts Vite, and removes the test database volume after the run by default.

First run:

```bash
docker compose version
docker info
bun run e2e:install
bun run e2e
```

Detailed runbook: [../docs/TESTING.md](../docs/TESTING.md).

## Current Upstream Documentation

For browser framework, routing, forms, server-state, build, lint, or E2E questions, consult the current upstream documentation linked here first. This README describes this app's conventions; upstream docs are authoritative for library behavior.

- [React docs](https://react.dev/reference/react)
- [Vite guide](https://vite.dev/guide/)
- [Tailwind CSS docs](https://tailwindcss.com/docs)
- [shadcn/ui docs](https://ui.shadcn.com/docs)
- [Radix UI docs](https://www.radix-ui.com/primitives/docs/overview/introduction)
- [TanStack Query React docs](https://tanstack.com/query/latest/docs/framework/react/overview)
- [TanStack Form React docs](https://tanstack.com/form/latest/docs/framework/react/quick-start)
- [TanStack Router docs](https://tanstack.com/router/latest/docs/overview)
- [Zod docs](https://zod.dev/)
- [Playwright docs](https://playwright.dev/docs/intro)
- [ESLint docs](https://eslint.org/docs/latest/)
