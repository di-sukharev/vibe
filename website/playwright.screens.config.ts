import { defineConfig } from '@playwright/test'
import e2eConfig from './playwright.config'

// `bun run screens:website`: the production preview runs a screenshot tour instead of the specs.
// Images land in e2e/.artifacts/screens. See docs/UI.md.
export default defineConfig({
  ...e2eConfig,
  testDir: './e2e/screens',
  outputDir: './e2e/.artifacts/screens-results',
  use: { ...e2eConfig.use, screenshot: 'off', trace: 'off', video: 'off' },
})
