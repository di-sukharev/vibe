# Website

The website workspace is a separate Astro project for public, SEO-facing surfaces: landing pages, marketing/content sites, and the public catalog of product sites such as a marketplace. It is the SSG-first counterpart to the CSR `webapp` (which lives behind auth and needs no SEO). Keep it independent from authenticated browser-app workflows unless a product need explicitly requires shared API data.

## Stack

- Astro (static SSG by default; SSR-ready per route)
- TypeScript
- Vite through Astro

## Rendering model

Astro prerenders every page to static HTML by default, so the standard build is a cheap static site in `website/dist`, deployable to a Static Site host or object storage + CDN. No server adapter is installed by default, on purpose: the common case (landing and content pages, plus stable public marketplace pages) is pure static.

A route can opt into server rendering (SSR) with `export const prerender = false`. SSR is a deliberate upgrade, not the marketplace default, because it requires installing a Node adapter and deploying as a runtime service instead of a Static Site. Keep marketing/content pages and durable public catalog pages static. Render only request-specific routes on demand: live search, personalized public views, or inventory/price pages where stale HTML is unacceptable.

Use this freshness ladder before making an entire page uncached or personalized SSR:

1. SSG plus rebuild/redeploy for durable marketplace changes such as edited listings, category copy, and landing content.
2. Cached on-demand/SSR routes with CDN headers such as `stale-while-revalidate` when freshness matters more than a full redeploy cycle.
3. Astro server islands for non-SEO-critical dynamic or personalized fragments, such as a signed-in header state or saved/listing action.
4. Uncached or personalized Astro SSR only for request-specific pages where initial HTML must reflect current request data.

On-demand/SSR routes and server islands both require an Astro adapter and a runtime-capable deployment. They do not work from a pure Static Site host or object-storage static website. Server islands keep the main page prerendered while rendering only a fragment on demand; they are a smaller runtime step than making the whole route SSR, not a feature of static hosting. When server islands appear on cached pages or during rolling deploys, generate a stable key with `astro create-key` and configure `ASTRO_KEY` as a secret in both build and runtime environments so old cached HTML and the current server bundle can decrypt island props consistently. Never commit it, print it, expose it as `PUBLIC_*`, or bake it into static output.

Only anonymous, public-equivalent HTML may use shared CDN caching such as `public`, `s-maxage`, or `stale-while-revalidate`. Auth-dependent or personalized routes and server islands must use `private` or `no-store`, or a deliberately supported `Vary: Cookie`/`Authorization` strategy. `ASTRO_KEY` protects island prop encryption and deploy consistency; it is not a cache privacy boundary.

SEO-critical content must be present in the initial HTML: title, description, canonical URL, Open Graph/Twitter tags, product or category names, indexable descriptions, and public prices when they matter for search snippets. Client islands and server islands may enhance the page, but they must not be the only source of SEO-critical content.

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

When the website has only fully prerendered output and no server islands or runtime-rendered routes, the build output in `website/dist` is fully static. Production deployment uses DigitalOcean App Platform Static Sites from the full Git monorepo branch with `bun install --frozen-lockfile && bun run build:website` and `website/dist` by default. Generate the concrete spec with `bun run deploy:do:specs website`; App Platform builds from Git, not from local `dist`. If website links to the browser app, `PUBLIC_WEBAPP_URL` must be a concrete build-time URL and the website must be redeployed after it changes. Follow the shared runbook in [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md). If the user explicitly chooses Yandex Cloud, deploy the built `website/dist` output through Yandex Object Storage static website hosting plus Cloud CDN by following [../docs/YANDEX_CLOUD.md](../docs/YANDEX_CLOUD.md).

On the default DigitalOcean/Yandex path, "regeneration" means redeploying static output or letting CDN/runtime cache refresh. It is not the same product feature as built-in Next/Vercel on-demand ISR.

### SSR upgrade path

Do this only when a route actually needs server rendering. Do not use SSR just because the product is a marketplace. Steps (also summarized in `astro.config.mjs`):

1. Install a Node adapter that matches the installed Astro version: `bun add @astrojs/node --cwd website`. Verify the resolved version's `astro` peer range covers the installed Astro; a major mismatch fails the build.
2. Register it in `astro.config.mjs` as `adapter: node({ mode: 'standalone' })` and keep `output: 'static'`. With an adapter, `astro build` emits `dist/client` (static assets/HTML) plus `dist/server` (runtime entry), so the static output dir becomes `website/dist/client`.
3. Mark the dynamic route with `export const prerender = false`.
4. Deploy this surface as an App Platform **service** (a runtime container, like the backend in [../.do/backend-app.yaml.example](../.do/backend-app.yaml.example)) instead of a Static Site, since SSR routes need the Node server at runtime.

Keep dynamic pages fresh with HTTP cache headers (`Cache-Control`, `stale-while-revalidate`) in front of a CDN once the website is deployed as a runtime service. Per-page incremental static regeneration (ISR) is a platform feature of Vercel/Netlify-style deployments and is **not** available on DigitalOcean App Platform Static Sites or Yandex Object Storage, so do not design the default path around it.

## Practice

Keep website-specific UI and content in this workspace. Do not duplicate authenticated browser-app flows from `webapp`. Auth inside `website` is acceptable only for small public-site needs, such as a logged-in header state or lightweight listing actions. Full buyer account, seller/admin, checkout/account, and dashboard workflows stay in `webapp` unless they have a concrete SEO requirement.

If the website starts reading API data or shared DTOs, add `@web-app-demo/contracts` intentionally and validate the producer/consumer path. Add `@astrojs/react` only when a page needs interactive React islands.

Astro remains the default here because it is content-first, static-first, low-JS by default, and easy for agents to reason about as the SEO surface. Choose Next.js only when the project intentionally wants a Vercel-optimized ISR/cache platform. Treat TanStack Start as an optional future React full-stack path for teams that want one React app with selective SSR, not as this template's default website stack.

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
