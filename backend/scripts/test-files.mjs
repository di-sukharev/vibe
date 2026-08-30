import { Glob } from 'bun'

/**
 * Splits the backend test files between the three runners, by filename.
 *
 * A test that needs the database is named `*.integration.test.ts`; a test that needs a service no
 * runner starts for it - the local S3 container, or an email provider - is named
 * `*.live.test.ts`; everything else runs with nothing installed. That third category keeps the
 * unit runner useful without Docker or provider credentials. The root `bun run test` still needs
 * Docker because it intentionally includes the integration runner.
 */
export function backendTestFiles(backendRoot) {
  const all = [...new Glob('{src,scripts}/**/*.test.{ts,mjs}').scanSync(backendRoot)].sort()

  return {
    all,
    unit: all.filter(
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
