# Website

React Router Framework Mode renders public pages at build time. Public pages use React and Vite. Signed-in pages belong to [webapp](../webapp/README.md). Scripts and dependencies are in [package.json](package.json).

Run `bun run dev:website` from the root. The development server uses port 4321. The website can run without the backend.

## Pages and data

Register routes in [src/routes.ts](src/routes.ts). Put route modules in `src/routes` and sections in `src/components/landing`. The root document is [src/root.tsx](src/root.tsx). Route modules render React 19 `title`, `meta`, and `link` elements so metadata is included in the initial HTML.

[react-router.config.ts](react-router.config.ts) sets `ssr: false` and `prerender: true`. Builds produce static files in `build/client`. Deploy that directory to a static host. No production React Router server is required. `bun run preview` serves the build locally through Vite.

For data fetched during a build, define a public schema in `packages/contracts`. Include only data safe to publish in static files. Keep credentials out of `VITE_*` variables and build output. Fail the build when required data is missing or invalid.

Displayed prices and availability are informational. The backend confirms them at checkout. Browser checkout belongs to `webapp`; the public site can hand off selected IDs and quantities through a shared, versioned contract. Do not trust client totals or payment results.

## Configuration and UI

[.env.example](.env.example) defines `VITE_WEBSITE_URL` and `VITE_WEBAPP_URL`. A build embeds these public values in the static output. Empty values omit canonical metadata and keep the local next-step link. A nonempty invalid webapp URL fails the build.

Use [UI](../docs/UI.md) for theme generation and screenshots. The decorative hero has a static CSS fallback. Its 3D code loads at browser idle, with a 2500 ms timeout, only on wide screens without reduced motion. Keep product information outside the scene.

Use `bun run --cwd website ui:add -- <component>` to generate primitives with the pinned shadcn CLI. Both applications use the Base UI registry. Keep product compositions outside `src/components/ui`.

`bun run storybook:website` shows React primitives and compositions. Storybook uses a separate Vite configuration so it does not load the application router.

References: [React Router pre-rendering](https://reactrouter.com/how-to/pre-rendering), [SPA mode](https://reactrouter.com/how-to/spa).
