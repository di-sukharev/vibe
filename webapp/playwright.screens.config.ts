import { defineConfig } from '@playwright/test'
import e2eConfig from './playwright.config'

// `bun run screens:webapp`: the E2E stack (test database, backend, Vite) runs a screenshot tour
// instead of the specs. Images land in e2e/.artifacts/screens. See docs/UI.md.

// Read by e2e/global-setup.ts (turns on the backend's DEV_SEED_DEMO fixtures) and by
// e2e/screens/screens.spec.ts (turns on the demo avatar fixture). Plain `bun run e2e:webapp`
// never sets this, so its specs keep today's two accounts.
process.env.SCREENS_SEED_DEMO = '1'

export default defineConfig({
  ...e2eConfig,
  testDir: './e2e/screens',
  outputDir: './e2e/.artifacts/screens-results',
  reporter: 'list',
  use: { ...e2eConfig.use, screenshot: 'off', trace: 'off', video: 'off' },
})
