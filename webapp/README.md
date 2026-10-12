# Webapp

React and Vite render the signed-in application in the browser (CSR). Public SEO pages belong to [website](../website/README.md). Scripts and dependencies are in [package.json](package.json).

Run `bun run dev:webapp` from the root. Authentication needs the [backend](../backend/README.md#local-development).

## Configuration

[.env.example](.env.example) defines `VITE_API_URL`. Vite embeds this value at build time. Rebuild and release after changing the API origin. The backend must permit the webapp origin through `CORS_ORIGINS`.

## Sessions and requests

[src/features/auth](src/features/auth) owns the browser session. Keep access tokens in memory and refresh tokens in HttpOnly cookies. Put calls that change auth cookies behind the existing Web Lock.

Session changes notify other tabs. Each tab cancels and removes session queries before applying another account. Use keys under `sessionQueryKeys.all` for user data. A refresh that returns another JWT subject must clear the session without retrying the original request.

Call protected endpoints through `useAuth().transport`. Pass the query cancellation signal. If server sign-out fails, preserve local state and show a retry.

## Routes and features

[src/routes.tsx](src/routes.tsx) registers routes. [src/pages.tsx](src/pages.tsx) composes public feature APIs. Add workspace routes to `workspaceRoutesByRole` in [navigation/model.ts](src/features/navigation/model.ts) as well as the router.

Guards wait for session restoration. Return paths must be local routes in the user's permitted workspace. Enforce access in the backend even when a client guard exists.

Each feature owns its API calls, queries, forms, and components. Its `api.ts` receives the authenticated transport. Keep shared HTTP mechanics in `src/platform/api`.

## Components

Use the pinned shadcn CLI to generate primitives:

```bash
bun run --cwd webapp ui:add -- <component>
```

Keep product compositions outside `src/components/ui`. Render product text through `Typography`. Follow [UI](../docs/UI.md) for styling and screenshots.

`bun run storybook:webapp` shows primitives and shared compositions. It excludes application routes and authenticated features.

## Hosting

The host must serve `index.html` for unknown paths. Otherwise direct navigation to a client route fails. Follow [Deployment](../docs/DEPLOYMENT.md).
