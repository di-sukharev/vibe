/**
 * Tells whether a runner process has any work configured.
 *
 * `backend/src/scheduler.ts` and `backend/src/worker.ts` ship with empty collections on purpose,
 * and a process with nothing to do exits immediately - which a platform that restarts workers
 * treats as a crash loop. Deploy tooling asks this before generating a component for one of them.
 *
 * This reads the source text rather than importing the module. `scheduler.ts` and `worker.ts`
 * import `./db` and `./runtime`, so loading either would pull the Prisma client and the backend
 * env schema into a spec generator that needs neither. (`jobs.ts` is different - its only import
 * is a type - which is why the generator imports that one directly to validate job names.)
 */
export function collectionIsEmpty(sourceText, collectionName) {
  const declaration = new RegExp(
    // The optional `: WorkerLoop[]` annotation is skipped by matching up to the `=`, so the
    // brackets that matter are the ones opening the array literal.
    `export const ${escapeRegExp(collectionName)}\\s*(?::[^=]*)?=\\s*\\[([\\s\\S]*?)\\]`,
  ).exec(stripComments(sourceText))

  if (!declaration) {
    throw new Error(
      `Could not find "export const ${collectionName}" as an array literal. It was renamed or reshaped, so the emptiness check no longer means anything - update the caller.`,
    )
  }

  return declaration[1].trim() === ''
}

function stripComments(sourceText) {
  return sourceText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
