# Website

The website workspace is a separate Astro project for public, SEO-facing surfaces: landing pages, marketing/content sites, and the public part of product sites such as a marketplace. It is the SSG/SSR counterpart to the CSR `webapp` (which lives behind auth and needs no SEO). Keep it independent from the authenticated browser app unless a product need explicitly requires shared API data.

## Stack

- Astro (static SSG by default; SSR-ready per route)
- TypeScript
- Vite through Astro

## Rendering model

Astro prerenders every page to static HTML by default, so the standard build is a cheap static site in `website/dist`, deployable to a Static Site host or object storage + CDN. No server adapter is installed by default, on purpose: the common case (landing and content pages, and the public/SEO pages of a marketplace) is pure static.

A route can opt into server rendering (SSR) with `export const prerender = false`. SSR is a deliberate one-step upgrade, not the default, because it requires installing a Node adapter and deploying as a runtime service instead of a Static Site — see the SSR upgrade path below. This is how the website grows from a landing page into a content site and then a marketplace: keep marketing/content pages static, and render only the dynamic routes (search, filters, live inventory/price, anything personalized) on demand.

## Commands

From the repository root:

```bash
bun run dev:website
bun run typecheck:website
bun run build:website
```

From `website`:

```bash
bun run dev
bun run typecheck
bun run build
bun run preview
```

Astro publishes pages from `src/pages`. Static assets live in `public`.

## Deployment

While every route is prerendered, the build output in `website/dist` is fully static. Production deployment uses DigitalOcean App Platform Static Sites from the full Git monorepo branch with `bun install --frozen-lockfile && bun run build:website` and `website/dist` by default. Generate the concrete spec with `bun run deploy:do:specs website`; App Platform builds from Git, not from local `dist`. If website links to the browser app, `PUBLIC_WEBAPP_URL` must be a concrete build-time URL and the website must be redeployed after it changes. Follow the shared runbook in [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md). If the user explicitly chooses Yandex Cloud, deploy the built `website/dist` output through Yandex Object Storage static website hosting plus Cloud CDN by following [../docs/YANDEX_CLOUD.md](../docs/YANDEX_CLOUD.md).

### SSR upgrade path

Do this only when a route actually needs server rendering. Steps (also summarized in `astro.config.mjs`):

1. Install a Node adapter that matches the installed Astro version: `bun add @astrojs/node --cwd website`. Verify the resolved version's `astro` peer range covers the installed Astro; a major mismatch fails the build.
2. Register it in `astro.config.mjs` as `adapter: node({ mode: 'standalone' })` and keep `output: 'static'`. With an adapter, `astro build` emits `dist/client` (static assets/HTML) plus `dist/server` (runtime entry), so the static output dir becomes `website/dist/client`.
3. Mark the dynamic route with `export const prerender = false`.
4. Deploy this surface as an App Platform **service** (a runtime container, like the backend in [../.do/backend-app.yaml.example](../.do/backend-app.yaml.example)) instead of a Static Site, since SSR routes need the Node server at runtime.

Keep dynamic pages fresh with HTTP cache headers (`Cache-Control`, `stale-while-revalidate`) in front of a CDN — that is the practical "regenerate on demand" pattern here. Per-page incremental static regeneration (ISR) is a platform feature of Vercel/Netlify and is **not** available on DigitalOcean App Platform or Yandex Object Storage, so do not design around it.

## Practice

Keep website-specific UI and content in this workspace. Do not duplicate authenticated browser-app flows from `webapp`. If the website starts reading API data or shared DTOs (the first SSR/marketplace route), add `@web-app-demo/contracts` and, for interactive React islands, `@astrojs/react` intentionally, and validate the producer/consumer path.

## Current Upstream Documentation

For Astro, routing, content, on-demand rendering, adapters, build, or deployment questions, consult the current upstream documentation linked here first. This README describes this workspace's conventions; upstream docs are authoritative for Astro behavior.

- [Astro docs](https://docs.astro.build/en/getting-started/)
- [Astro project structure](https://docs.astro.build/en/basics/project-structure/)
- [Astro pages and routing](https://docs.astro.build/en/basics/astro-pages/)
- [Astro on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/)
- [Astro Node adapter](https://docs.astro.build/en/guides/integrations-guide/node/)
- [Astro deployment guides](https://docs.astro.build/en/guides/deploy/)
- [TypeScript docs](https://www.typescriptlang.org/docs/)
- [Vite guide](https://vite.dev/guide/)
