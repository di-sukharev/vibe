// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
//
// Default rendering is static (SSG): every page prerenders to HTML and the
// build emits a plain static site in `website/dist`, deployable to a Static
// Site host or object storage + CDN. This is the right default for landing and
// content pages, and for the public/SEO surface of a marketplace.
//
// SSR upgrade path (do this only when a route needs server rendering, e.g.
// live search/inventory/personalized pages):
//   1. Install a Node adapter that matches THIS Astro version:
//        bun add @astrojs/node --cwd website
//      (verify the resolved version's `astro` peer range covers the installed
//       Astro; mismatched majors fail the build).
//   2. Add the adapter here: `adapter: node({ mode: 'standalone' })`, keep
//      `output: 'static'`. With an adapter, `astro build` emits `dist/client`
//      (static assets/HTML) plus `dist/server` (runtime entry), so the static
//      output dir becomes `website/dist/client`.
//   3. Opt a single route into SSR with `export const prerender = false`.
//   4. Deploy this surface as a runtime service (a container), not a Static
//      Site, since SSR routes need the Node server. See README "SSR upgrade
//      path". Note: per-page ISR is a Vercel/Netlify feature, not available on
//      DigitalOcean/Yandex — use CDN cache headers for freshness instead.
export default defineConfig({});
