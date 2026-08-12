# Webapp

The CSR browser client provides authenticated, role-specific workspaces. It needs no SEO, so it stays client-side rendered; the public, SEO-facing surfaces live in the `website` workspace instead. It consumes the same API contracts as mobile and keeps server-state, form-state, auth, and role navigation centralized. Read [../docs/WEB_SURFACES.md](../docs/WEB_SURFACES.md) before adding product-data handoff, carts, checkout, orders, subscriptions, entitlements, or payments.

## Project Surface Status

This section may be updated during first-run bootstrap. Once [CHECKLIST.md](../CHECKLIST.md) reports an install in progress or completed and its *Active surfaces* section leaves webapp unmarked, add a short note here explaining that browser work is intentionally paused. When the user activates webapp, mark it there, then remove or rewrite that note before starting browser development.

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

Production deployment for the browser app uses DigitalOcean App Platform Static Sites from the full Git monorepo branch with `bun install --frozen-lockfile && bun run build:webapp`, `webapp/dist`, and `index.html` as the SPA catch-all by default. Deploy with `bun run deploy:do webapp`, which applies the committed `.do/webapp-app.yaml`; App Platform builds from Git, not from local `dist`. Follow the shared runbook in [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md). If `CHECKLIST.md` records Yandex Cloud, deploy the built `webapp/dist` output through Yandex Object Storage static website hosting plus Cloud CDN by following [../docs/YANDEX_CLOUD.md](../docs/YANDEX_CLOUD.md).

## Practice

Use TanStack Query for server state, TanStack Mutation for API writes, TanStack Form for forms, and shared Zod schemas from `packages/contracts` for validation. The access token lives only in browser memory; refresh uses the HttpOnly cookie set by the backend. One browser Web Lock serializes every cookie-changing auth transition across same-origin tabs. Versioned session events make login, registration, refresh expiry, and logout invalidate stale access tokens and session-scoped caches before another principal can be applied; refresh/retry also compares JWT subjects and never repeats an authenticated operation as a different user. `src/features/auth` is the golden path: its public index exposes the provider, user context, auth UI, and an authenticated transport capability for future product APIs; its API adapter owns auth paths and refresh/retry; and the login, signup, forgot-password, and reset-password forms validate submissions with shared contracts without putting product logic in pages.

Put user-specific TanStack Query keys under the `['session', ...]` prefix. Login, registration, confirmed logout, and auth expiry remove and cancel stale session scope while preserving public caches. Successful account changes notify other same-origin tabs to bootstrap from the winning HttpOnly cookie; confirmed logout and auth expiry clear their in-memory session UI. A failed server logout leaves both the HttpOnly cookie and local authenticated state intact and shows a retryable error instead of pretending the user signed out.

When browser commerce is activated, this workspace owns the only browser checkout. It imports the
public website's untrusted local selection, preserves it across registration/sign-in, returns the
user to a role-safe `/app/checkout`, and asks the backend for an authoritative price/availability
snapshot before starting payment. Provider redirects or wallet sheets may be part of that flow,
but order/payment authority and webhooks stay in the backend. Keep the account minimal: add only
checkout, purchase/subscription status, order history, and settings the product actually needs.
The default branch does not yet contain the cart, checkout route, or browser payment module; the
capability ledger must change before they are implemented.

The route map is intentionally disjoint:

- `/` resolves the current session and redirects guests to `/login`.
- `/login` and `/signup` use the official shadcn `login-02`/`signup-02` two-column Vega composition.
- `/forgot-password` requests generic reset instructions; `/reset-password` consumes the one-time token from the URL fragment and removes it from browser history.
- `user` owns `/app`, `/app/profile`, and `/app/settings`.
- `admin` owns `/admin`, `/admin/users`, and `/admin/settings`.

The auth bootstrap finishes before a workspace shell renders. Guests are returned
to a safe known internal path after login, while an authenticated account that
opens the other role’s zone is redirected to its own home. `WorkspaceShell` owns
the classic shadcn/ui `SidebarProvider`, collapsible desktop sidebar, mobile
sheet, inset/trigger, role-specific menu, account footer, and logout behavior.
Pages only compose their content.

`src/features/users` owns profile API/mutation state and user pages;
`src/features/admin` owns dashboard/list/role API queries and admin pages; and
`src/features/navigation` owns the pure role-to-route map. Profile mutations
update only the current-user query. Role mutations invalidate only admin
dashboard/directory queries; a target user’s revoked session is observed by that
client on its next authenticated request or bootstrap.

Keep raw fetch, base URL handling, and shared error parsing in the endpoint-agnostic `src/platform/api`. Each `src/features/<context>` owns its paths, schemas, queries, and provider. Pages import features only through public `index.ts`; features use platform and UI primitives; platform and `src/components/ui` never import product features. Run `bun run architecture:check` after changing boundaries.

Use shadcn/ui for web interface primitives. Treat `src/components/ui` as official shadcn registry output that can be regenerated as a unit. Keep app-specific composition and wrappers outside that directory: project typography lives at `src/components/typography.tsx`, shared dashboard composition at `src/components/dashboard`, and product panels beside their owning feature state. Import registry primitives through `@/components/ui/*`.

Product components own their surface, padding, radius, internal spacing, typography, responsive behavior, and control sizing. Their public props are semantic data, states, and callbacks—never cosmetic `className` or `style` escape hatches. Pages may arrange closed product components with layout wrappers; only low-level UI and explicit layout primitives accept constrained styling props. Narrow inherited DOM props locally with literal `Pick`/`Omit`, as `DashboardLink` does, and keep product-component props explicit. Avoid one-off global CSS classes for product UI; component-owned visuals use Tailwind utilities and the shadcn theme tokens from `src/index.css`.

Product typography goes through `src/components/typography.tsx`. Use `Typography` for page copy, headings `h1` through `h6`, captions, emphasis, shortcuts, code/kbd text, and screen-reader-only text. The local ESLint policy enforces this in application code while excluding official generated `src/components/ui` files.

The current shadcn configuration is `radix-vega` with the `hugeicons` icon library and CSS variables, as recorded in `components.json`. The registry was refreshed from the official CLI with `npx shadcn@latest add --all -c webapp --overwrite -y`; the auth composition comes from `login-02` and `signup-02`. Generated inputs use the standard Vega `rounded-md` primitive. The authenticated shell keeps real product/API state rather than registry demo data. Do not add community registries or custom generator output unless the product asks for them.

When adding or refreshing shadcn components:

```bash
bun run --cwd webapp ui:info
bun run --cwd webapp ui:add -- <component>
```

Use the local `shadcn` devDependency pinned in `webapp/package.json` and `bun.lock`; do not use `shadcn@latest` for routine refreshes because it can produce registry output that no longer matches this template. If generated files need compatibility fixes for current package versions, keep the edits small and leave app-specific composition outside `src/components/ui`.

## E2E

The Playwright tests live in `e2e/specs/auth.spec.ts` and
`e2e/specs/rbac.spec.ts`. They verify auth validation, register/login, refresh
after reload, profile/theme persistence, role-specific sidebar contents, safe
return paths, cross-role redirects, seeded-admin login, admin data
error-recovery and empty states, self-demotion protection, admin promotion,
target-session revocation, and the existing concurrent-tab session behavior.

The run starts Docker Compose `postgres_test`, applies migrations to
`web_app_demo_test`, idempotently seeds the E2E administrator, starts the backend
with `TEST_DATABASE_URL` as its `DATABASE_URL`, starts Vite, and removes the test
database volume after the run by default.

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
