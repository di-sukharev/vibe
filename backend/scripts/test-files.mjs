import { Glob } from 'bun'

/**
 * Splits backend integration tests between the local, database, and live runners by filename.
 *
 * Database tests use `*.integration.test.ts`. Tests for services that the runners do not start
 * use `*.live.test.ts`. Other tests run locally without Docker or provider credentials.
 * The root `bun run test` includes database integration tests and requires Docker.
 */
export function backendTestFiles(backendRoot) {
  const all = [...new Glob('{src,scripts}/**/*.test.{ts,mjs}').scanSync(backendRoot)].sort()

  return {
    all,
    local: all.filter(
      (file) => !file.includes('.integration.test.') && !file.includes('.live.test.'),
    ),
    integration: all.filter((file) => file.includes('.integration.test.')),
    live: all.filter((file) => file.includes('.live.test.')),
  }
}

/**
 * Selects exact discovered files while leaving Bun's test-name filter available to focused runs.
 * File paths are relative to `backend/`; a leading `backend/` is accepted for root-shell callers.
 */
export function selectBackendTestRun(discoveredFiles, args = []) {
  const requestedFiles = []
  const bunTestArgs = []

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]

    if (argument === '--') continue
    if (argument === '-t' || argument === '--test-name-pattern') {
      const pattern = args[index + 1]
      if (!pattern || pattern === '--') {
        throw new Error(`${argument} requires a test-name pattern`)
      }
      bunTestArgs.push(argument, pattern)
      index += 1
      continue
    }
    if (argument.startsWith('-')) {
      bunTestArgs.push(argument)
      continue
    }

    const normalized = argument
      .replaceAll('\\', '/')
      .replace(/^\.\//, '')
      .replace(/^backend\//, '')
    if (!discoveredFiles.includes(normalized)) {
      throw new Error(
        `Focused backend test file was not discovered: ${argument}. Use a path relative to backend/.`,
      )
    }
    requestedFiles.push(normalized)
  }

  return {
    testFiles: requestedFiles.length > 0 ? [...new Set(requestedFiles)] : discoveredFiles,
    bunTestArgs,
  }
}
