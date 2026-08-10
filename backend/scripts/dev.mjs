#!/usr/bin/env bun
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Runs the backend the way a deployment does: the API and the scheduler as two processes.
 *
 * They are separate here because they are separate in production, and because without the
 * scheduler nothing drains `task_outbox` - a developer would request a password reset, see
 * nothing, and reasonably conclude the reset is broken. The link now appears within a minute.
 *
 * Rejected alternatives, so nobody re-litigates them:
 * - `bun --watch src/index.ts & bun --watch src/scheduler.ts` orphans the scheduler when the API
 *   dies and forwards no signals, so Ctrl+C leaves a process holding the database.
 * - A `concurrently` dependency, for forty lines of `child_process`.
 * - Starting the scheduler inside `index.ts` behind a development flag. That would make
 *   `bun run start:api` a different program from the deployed one, and hide the fact that a
 *   deployment has to run this second process itself.
 */
// Derived rather than inherited, like every sibling script here: `bun backend/scripts/dev.mjs`
// from the repository root must not fail with two module-not-found errors and no hint.
const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

const processes = [
  { name: 'api', args: ['--watch', 'src/index.ts'] },
  { name: 'scheduler', args: ['--watch', 'src/scheduler.ts'] },
].map(({ name, args }) => ({
  name,
  child: spawn('bun', args, { cwd: backendRoot, stdio: 'inherit' }),
}))

/**
 * How long a child gets to shut down before it is killed outright.
 *
 * Generous enough for an in-flight drain to finish, short enough that Ctrl+C does not feel
 * broken. It exists because `bun --watch` does not always exit when the script under it does, and
 * a development supervisor that can be left hanging by its own children is worse than a blunt
 * one. Production shutdown is a different thing entirely and is governed by
 * `SHUTDOWN_GRACE_SECONDS` inside the API itself.
 */
const forceKillAfterMs = 10_000

let shuttingDown = false

function stopEverything(signal) {
  if (shuttingDown) return
  shuttingDown = true

  for (const { child } of processes) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal)
  }

  // Unreferenced so this timer never becomes the reason the process stays alive.
  setTimeout(() => {
    for (const { name, child } of processes) {
      if (child.exitCode === null && child.signalCode === null) {
        console.error(`The ${name} process did not stop in time; killing it.`)
        child.kill('SIGKILL')
      }
    }
  }, forceKillAfterMs).unref()
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stopEverything(signal))
}

for (const { name, child } of processes) {
  child.on('error', (error) => {
    console.error(`Failed to start the ${name} process: ${error.message}`)
    stopEverything('SIGTERM')
    process.exitCode = 1
  })

  // `close`, not `exit`: a child that fails to spawn emits `error` and `close` but never `exit`,
  // and that half of the pair still has to bring the other half down.
  child.on('close', (code, signal) => {
    // One half of the pair is useless without the other, and a half-dead `bun run dev` that still
    // looks alive is worse than one that stops: take the sibling down and report the first
    // failure. A signal we sent ourselves is a clean shutdown, not a failure.
    if (!shuttingDown) {
      console.error(`The ${name} process exited (${signal ?? `code ${code}`}); stopping the rest.`)
      // Never 0: half of the pair leaving on its own is a failed `bun run dev`, however politely
      // it exited, and a wrapper must not read that as success.
      process.exitCode = code || 1
    }

    stopEverything('SIGTERM')
  })
}
