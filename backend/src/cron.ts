import { createBackgroundRuntime, type BackendRuntime } from './runtime'
import { backgroundJobNames, isBackgroundJobName } from './jobs'
import {
  runLockedBackgroundJob,
  schedules,
  type ScheduleEntry,
} from './scheduler'

/** Runs one job from the shared registry and advisory-lock envelope. */
export async function runOneShotJob(
  runtime: BackendRuntime,
  jobName: string,
  entries: ScheduleEntry[] = schedules,
) {
  if (!isBackgroundJobName(jobName)) {
    throw new Error(
      `Unknown job "${jobName}". Available jobs: ${backgroundJobNames().join(', ')}`,
    )
  }

  const entry = entries.find((candidate) => candidate.job === jobName) ?? {
    expression: 'manual',
    job: jobName,
  }
  await runLockedBackgroundJob(runtime, entry)
}

/**
 * Provider timers need the job outcome as an HTTP status. Yandex task-mode containers always
 * return HTTP 200 and hide the process result in a header, so a failed command would never reach
 * the trigger's retry policy. HTTP mode keeps the same one-shot executor while exposing failure
 * as non-2xx to the platform.
 */
export async function handleProviderJobInvocation(
  jobName: string,
  createRuntime: () => BackendRuntime = createBackgroundRuntime,
  entries: ScheduleEntry[] = schedules,
) {
  let runtime: BackendRuntime | undefined

  try {
    runtime = createRuntime()
    await runOneShotJob(runtime, jobName, entries)
    await runtime.close()
    return new Response(null, { status: 204 })
  } catch (error) {
    if (runtime) {
      try {
        await runtime.close()
      } catch (closeError) {
        console.error(
          `Provider job ${jobName} also failed to close cleanly.`,
          closeError,
        )
      }
    }
    console.error(`Provider job ${jobName} failed.`, error)
    return new Response('Background job failed', { status: 503 })
  }
}

export function startProviderJobServer(jobName: string) {
  if (!isBackgroundJobName(jobName)) {
    throw new Error(
      `Unknown job "${jobName}". Available jobs: ${backgroundJobNames().join(', ')}`,
    )
  }

  const server = Bun.serve({
    port: Number(Bun.env.PORT ?? 8080),
    fetch: () => handleProviderJobInvocation(jobName),
  })
  console.log(`Provider timer for ${jobName} listening on ${server.url}`)
  return server
}

export async function main(argv: string[] = Bun.argv.slice(2)) {
  const [jobName] = argv

  if (!jobName) {
    throw new Error(
      `A job name is required. Available jobs: ${backgroundJobNames().join(', ')}`,
    )
  }

  const runtime = createBackgroundRuntime()

  try {
    await runOneShotJob(runtime, jobName)
  } finally {
    await runtime.close()
  }
}

if (import.meta.main) {
  const [mode, jobName] = Bun.argv.slice(2)

  if (mode === '--http') {
    try {
      if (!jobName) throw new Error('HTTP provider mode requires a job name')
      startProviderJobServer(jobName)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  } else {
    try {
      await main()
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  }
}
