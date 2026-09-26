import { describe, expect, test } from 'bun:test'

import type { BackendRuntime } from './runtime'
import { backgroundJobNames, runBackgroundJob } from './jobs'

const runtime = {} as BackendRuntime

describe('runBackgroundJob', () => {
  test('rejects unknown names, Object.prototype keys included, and lists the real jobs', async () => {
    // All three runners take job names from user input or config, so a typo has to fail loudly
    // rather than silently do nothing. `'constructor' in backgroundJobs` is true: a provider timer
    // configured with that name would exit 0 every night while doing no work at all. Checked
    // against the registry rather than a copy of it, so adding a job cannot break this test.
    for (const name of ['missing', 'constructor', 'toString', 'hasOwnProperty']) {
      const failure = String(await runBackgroundJob(name, runtime).catch((error: unknown) => error))

      expect(failure).toContain(`Unknown job "${name}"`)
      for (const job of backgroundJobNames()) expect(failure).toContain(job)
    }
  })

  // The billing reconcile task lived here commented out; docs/IAP.md says what to switch on.
})
