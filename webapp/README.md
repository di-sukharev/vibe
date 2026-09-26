# Webapp

`webapp` is the client-rendered (CSR) React app for signed-in users, with one workspace per role. It needs no SEO: public pages live in [website](../website/README.md). Carts, checkout, orders, and payments follow [WEB_SURFACES](../docs/WEB_SURFACES.md); `master` has none of them.

## Stack

React, TypeScript, Vite, Tailwind CSS, shadcn/ui (Radix UI, Hugeicons), TanStack Router, Query, and Form (writes use `useMutation`), Zod from `@web-app-demo/contracts`, Storybook, Playwright, and ESLint.

## Commands

From the root: `bun run dev:webapp`, `build:webapp`, `typecheck:webapp`, `lint`, `test:webapp`, and `storybook:webapp` (port 6006). Scripts are in [package.json](package.json); the index is [COMMANDS](../docs/COMMANDS.md).

## Environment

`VITE_API_URL` is the backend origin. The default is `http://localhost:3000`; to change it locally, copy [.env.example](.env.example) to `webapp/.env`. Vite inlines the value at build time, and each release sets it from Terraform. After the API origin changes, release again: a deployed build keeps the old address.

## Session rules

`src/features/auth` owns the browser session. Keep these rules:

- Keep the access token only in memory. The refresh token stays in the backend's HttpOnly cookie. Never copy a token to storage that JavaScript can read.
- A Web Lock (`browser-auth-coordinator.ts`) serializes every auth-cookie change across the tabs of one origin. Put new cookie-changing calls behind it.
- Each session change publishes a new session version to the other tabs (`session-coordinator.ts`). Before another user's session applies, each tab drops its access token and session cache. Then it restores the session from the cookie or clears its UI.
- Refresh and retry compare the JWT subject (`sub`). If the refreshed token belongs to another user, the client clears the session and does not retry.
- Put user-scoped query keys under `['session', ...]`, built from `sessionQueryKeys.all` in `@/features/auth`. Session changes cancel and remove these queries; other keys survive.
- If the server sign-out fails, keep the cookie and the local state, and show an error with a retry. Never show a sign-out that did not happen.
- Call authenticated endpoints through `useAuth().transport`. On a 401, it refreshes once and retries. Pass the query `signal` so that a superseded request aborts.

## Routes and guards

`src/routes.tsx` registers the routes, and `src/pages.tsx` composes them from public feature APIs.

- Public pages: `/login`, `/signup`, `/forgot-password` (guest-only), and `/reset-password`. The reset page reads the one-time token from the URL fragment and removes it from history.
- Role `user` owns the `/app` workspace, and role `admin` owns `/admin`. `workspaceRoutesByRole` in `src/features/navigation/model.ts` lists every workspace route; the sidebar shows a subset.
- Guards wait for the session restore; a restore error shows a retry.
- A guest on `/` goes to `/login`; on a workspace route, to `/login?returnTo=<path>`.
- After sign-in, `safeReturnPath` accepts only a same-origin path from the user's own workspace list. Otherwise, the user goes to the role home (`/app` or `/admin`).
- A signed-in user on `/` or a guest-only page goes to the safe return path or the role home; on another role's workspace, to the role home.
- To add a workspace route, register it under its role layout and add it to `workspaceRoutesByRole`. `tests/navigation.test.ts` fails when the two differ.

## Code layout

- `src/features/<context>` owns its endpoints, queries, forms, and UI. Other code imports a feature only through its `index.ts`.
- A feature's `api.ts` receives the `AuthenticatedTransport`. Do not give pages a universal API service.
- `src/platform` holds shared code without endpoint knowledge: `api` (HTTP client, base URL, error parsing) and `intl` (fixed-locale formatters).
- `src/platform` and `src/components/ui` never import features. Shared compositions in `src/components`, such as `WorkspaceShell`, may import public feature APIs. `bun run architecture:check` enforces these boundaries.
- Render product text only through `Typography` (`src/components/typography.tsx`). ESLint enforces it in `src`, except `src/components/ui` and `src/stories`.

## shadcn registry

`src/components/ui` is the generated shadcn registry. Keep it regenerable: never edit it for product needs, and import primitives from `@/components/ui/*`. Keep compositions outside it: shared panels in `src/components/dashboard`, product panels in their feature.

`components.json` pins the `radix-vega` style, the `hugeicons` icon library, and CSS variables in `src/index.css`. The auth pages follow the `login-02` and `signup-02` blocks. Use the local `shadcn` that `package.json` and `bun.lock` pin:

```bash
bun run --cwd webapp ui:info
bun run --cwd webapp ui:add -- <component>
```

- Never use `shadcn@latest` for routine updates: its output may not match the template.
- Keep compatibility fixes in generated files small.
- Add third-party registries or generators only when the product needs them.

Storybook (`src/stories`) shows registry modules and shared compositions with the real theme CSS. It excludes routes, auth, and features. Add a story when a new primitive or composition needs visual review.

## Styling

Follow [UI](../docs/UI.md) for the UI rules, patterns, and the `bun run screens` visual check.

## E2E tests

Playwright specs live in `e2e/specs`. Setup and commands are in [TESTING](../docs/TESTING.md).

## Deployment

Follow [DEPLOYMENT](../docs/DEPLOYMENT.md). Every host must serve `index.html` for unknown paths so client routes load. Both Terraform stacks do.
