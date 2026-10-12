# Website

Astro renders public pages at build time (SSG). Signed-in pages belong to [webapp](../webapp/README.md). Scripts and dependencies are in [package.json](package.json).

Run `bun run dev:website` from the root. The website can run without the backend. When Astro starts a background server, use `bun run --cwd website astro dev status`, `logs`, or `stop` to manage it.

## Pages and data

Keep SEO content in the initial HTML. Put pages in `src/pages`, sections in `src/components/landing`, and metadata in `src/layouts/BaseLayout.astro`.

Use SSG until the required freshness or personalization needs request-time rendering. React components remain static unless they have a `client:*` directive.

For data fetched during a build, define a public schema in `packages/contracts`. Include only data safe to publish in static files. Keep credentials out of `PUBLIC_*` variables and build output. Fail the build when required data is missing or invalid.

Displayed prices and availability are informational. The backend confirms them at checkout. Browser checkout belongs to `webapp`; the public site can hand off selected IDs and quantities through a shared, versioned contract. Do not trust client totals or payment results.

## Configuration and UI

[.env.example](.env.example) defines canonical website and webapp origins. A release embeds these values in the static output. `PUBLIC_*` values are public.

Use [UI](../docs/UI.md) for theme generation and screenshots. The decorative hero has a static CSS fallback. Its 3D code loads only on wide screens without reduced motion. Keep product information outside the scene.

`bun run storybook:website` shows React primitives and compositions. It does not render Astro pages.

## Request-time rendering

Start with static pages and rebuilds. Add an Astro adapter only when a route needs server rendering. The steps are next to the configuration in [astro.config.mjs](astro.config.mjs).

An adapter requires a runtime host and changes the build directories. Update the deployment with the rendering change. A static bucket cannot execute server routes or server islands.

Cache only anonymous public output in a shared CDN. Keep personalized output private. Server islands need a stable secret `ASTRO_KEY` at build time and runtime during cached or gradual releases.

References: [Astro rendering](https://docs.astro.build/en/guides/on-demand-rendering/), [server islands](https://docs.astro.build/en/guides/server-islands/).
