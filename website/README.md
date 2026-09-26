# Website

`website` is the Astro project for SEO pages: the landing page, content, and the public catalog. It builds static HTML (SSG) by default. Signed-in screens live in [webapp](../webapp/README.md). Auth scope, carts, checkout, and build-time backend data follow [WEB_SURFACES](../docs/WEB_SURFACES.md).

## Rules

- Put SEO data in the initial HTML: title, description, canonical URL, Open Graph and Twitter tags, product and category names, descriptions, and meaningful public prices. Islands may add to this data but must not be its only source.
- Stay on SSG until [CHECKLIST](../CHECKLIST.md) records a freshness or personalization need that a rebuild cannot meet, such as live search or prices and stock where stale HTML is unacceptable. A marketplace alone is not such a need.
- Never put a secret in a `PUBLIC_*` variable: Astro inlines these values into the static output.

## Stack and layout

Astro with static output, Tailwind CSS 4 through `@tailwindcss/vite`, shadcn/ui React components (`radix-vega` style, lucide icons), and React Three Fiber for the hero scene. `@astrojs/react` renders React components to static HTML; a component ships JavaScript only with a `client:*` directive.

Sections live in `src/components/landing`, the shadcn registry in `src/components/ui`, pages in `src/pages`, and metadata in `src/layouts/BaseLayout.astro`.

Add `@web-app-demo/contracts` when the site first reads API data.

### Hero scene

The SSG HTML always contains the CSS hero. `HeroScene` hydrates with `client:idle` and imports the R3F canvas only on viewports at least 1024 px wide without a reduced-motion request. Phones and reduced-motion users never download 3D code. Keep SEO text out of the scene. `bun run test:build-contracts` checks the fallback and the lazy chunk.

## Commands

From the root: `bun run dev:website`, `typecheck:website`, `build:website`, `test:website`, and `storybook:website` (port 6007). `bun run --cwd website preview` serves the last build. The index is [COMMANDS](../docs/COMMANDS.md).

When an AI agent runs `astro dev`, Astro 7 starts it in the background and prints JSON. Manage that server with `bun run --cwd website astro dev status`, `… logs`, and `… stop`; stop the servers you start.

Storybook renders `src/components/ui` modules and sample compositions in the dark theme through the React/Vite renderer. It has no Astro sections or pages and writes nothing to `website/dist`.

## Environment

Copy [.env.example](.env.example) to `website/.env` for local values. Each release sets both values from Terraform.

- `PUBLIC_WEBSITE_URL`: the canonical origin, such as `https://www.example.com`. Without it, pages omit `canonical` and `og:url`.
- `PUBLIC_WEBAPP_URL`: the webapp origin, such as `https://app.example.com`. Without it, the landing page keeps a local next-step link and builds without a webapp. A value that is not an absolute `http(s)` URL fails the build.

## Rendering ladder

Pick the first level that meets the need recorded in CHECKLIST:

1. SSG with rebuild and deploy: listing, category, landing, and content changes.
2. Cached on-demand SSR with `stale-while-revalidate`: when a full deploy is too slow.
3. Astro server islands: small dynamic fragments without SEO value, such as the sign-in state or a listing action. The page stays static.
4. Uncached or personal SSR: only when the initial HTML must reflect the current request.

Levels 2–4 need an adapter and a runtime host; a Static Site or a static bucket cannot run them. Automatic rebuilds are specified in [BACKGROUND_JOBS](../docs/BACKGROUND_JOBS.md).

Neither cloud stack has per-page ISR (a Vercel and Netlify feature): an update is a new static deploy or a cache refresh.

### CDN caching

- Use a shared CDN cache (`public`, `s-maxage`, `stale-while-revalidate`) only for anonymous public HTML.
- Serve personal pages and islands with `private`, `no-store`, or an explicitly supported `Vary: Cookie` or `Vary: Authorization` strategy.

### ASTRO_KEY

Server islands encrypt their props. For caching or a gradual rollout, create a stable key with `astro create-key`. Pass it as the secret `ASTRO_KEY` to the build and the runtime so old HTML and a new server decrypt the same props. Never commit, print, or ship the key in static output. The key does not make a cache private.

## SSR upgrade path

Take this path only for a route whose need is recorded in CHECKLIST. `astro.config.mjs` repeats the steps.

1. Install a Node adapter that matches the installed Astro: `bun add @astrojs/node --cwd website`. Check its `astro` peer range: a major-version mismatch fails the build.
2. In `astro.config.mjs`, add `adapter: node({ mode: 'standalone' })` and keep `output: 'static'`. The build then emits `dist/client` and `dist/server`, and the static output moves to `website/dist/client`.
3. Add `export const prerender = false` to the dynamic route.
4. Change the selected Terraform stack: the site now needs a Node service or container instead of static hosting.

Astro docs: [on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/), [Node adapter](https://docs.astro.build/en/guides/integrations-guide/node/).

## Deployment

Follow [DEPLOYMENT](../docs/DEPLOYMENT.md). Without SSR or server islands, `website/dist` is fully static: Terraform hosts it on an App Platform Static Site or a Yandex Object Storage bucket.
