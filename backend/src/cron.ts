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
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
