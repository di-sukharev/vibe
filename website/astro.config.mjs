// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// SSG emits static pages in website/dist.
// For request-time rendering, add a compatible @astrojs/node adapter and
// adapter: node({ mode: 'standalone' }). Keep output: 'static'.
// Set prerender = false on dynamic routes. Deploy a runtime host and update
// static artifact paths to dist/client; the server entry is in dist/server.
// https://docs.astro.build/en/guides/on-demand-rendering/
export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()]
  }
});
