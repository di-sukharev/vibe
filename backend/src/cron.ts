import { createBackgroundRuntime } from './runtime'
import { backgroundJobNames, runBackgroundJob } from './jobs'

/**
 * One-shot runner: a provider timer starts the process, it runs a single job from the shared
 * registry in `jobs.ts`, and exits. Nothing runs between ticks.
 */
export async function main(argv: string[] = Bun.argv.slice(2)) {
  const [jobName] = argv

  if (!jobName) {
    console.error(`A job name is required. Available jobs: ${backgroundJobNames().join(', ')}`)
    process.exit(1)
  }

  const runtime = createBackgroundRuntime()

  try {
    await runBackgroundJob(jobName, runtime)
  } finally {
    await runtime.close()
  }
}

if (import.meta.main) {
  await main()
}
