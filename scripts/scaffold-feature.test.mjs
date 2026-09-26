import { describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applyMarkerEdits,
  collectExistingNames,
  deriveFeatureNames,
  generatedFiles,
  guessSingularKebab,
  isKebabCase,
  markerEdits,
  reservedFeatureNames,
  runScaffold,
  ScaffoldError,
  toCamelCase,
  toPascalCase,
  toSnakeCase,
} from './scaffold-feature.mjs'

const noExistingNames = {
  backendModules: [],
  webappFeatures: [],
  contractFiles: [],
  prismaModelNames: [],
  userFields: [],
  tableNames: [],
  contractExports: [],
}

describe('naming', () => {
  test('accepts single- and multi-word kebab-case', () => {
    expect(isKebabCase('projects')).toBe(true)
    expect(isKebabCase('invoice-items')).toBe(true)
  })

  test('rejects everything that is not lowercase kebab-case', () => {
    for (const value of ['Projects', 'invoice_items', 'invoice items', '-projects', 'projects-', 'invoice--items', '']) {
      expect(isKebabCase(value)).toBe(false)
    }
  })

  test('derives camel, Pascal, and snake case from kebab-case', () => {
    expect(toCamelCase('invoice-items')).toBe('invoiceItems')
    expect(toPascalCase('invoice-items')).toBe('InvoiceItems')
    expect(toSnakeCase('invoice-items')).toBe('invoice_items')
    expect(toCamelCase('projects')).toBe('projects')
    expect(toPascalCase('projects')).toBe('Projects')
  })

  test('guesses the regular English singular for common plural shapes', () => {
    expect(guessSingularKebab('projects')).toBe('project')
    expect(guessSingularKebab('invoice-items')).toBe('invoice-item')
    expect(guessSingularKebab('categories')).toBe('category')
    expect(guessSingularKebab('boxes')).toBe('box')
    expect(guessSingularKebab('addresses')).toBe('address')
    expect(guessSingularKebab('watches')).toBe('watch')
    expect(guessSingularKebab('wishes')).toBe('wish')
    expect(guessSingularKebab('courses')).toBe('course')
    expect(guessSingularKebab('responses')).toBe('response')
    expect(guessSingularKebab('sizes')).toBe('size')
  })

  test('refuses to guess an ending with more than one plausible singular', () => {
    // bus/house, quiz/buzz, case/alias, thesis/cheese: "-es" or "-s" removal is wrong for half of them.
    for (const plural of ['buses', 'houses', 'quizzes', 'buzzes', 'cases', 'purchases', 'aliases', 'theses', 'analyses', 'waltzes']) {
      expect(guessSingularKebab(plural)).toBeNull()
    }
  })

  test('cannot guess a singular for a word that does not look plural', () => {
    expect(guessSingularKebab('data')).toBeNull()
    expect(guessSingularKebab('status')).toBeNull()
    expect(guessSingularKebab('analysis')).toBeNull()
  })
})

describe('deriveFeatureNames', () => {
  test('derives every casing for a simple plural name', () => {
    const names = deriveFeatureNames('projects', undefined, noExistingNames)
    expect(names).toEqual({
      pluralKebab: 'projects',
      singularKebab: 'project',
      pluralCamel: 'projects',
      singularCamel: 'project',
      pluralPascal: 'Projects',
      singularPascal: 'Project',
      pluralSnake: 'projects',
      singularSnake: 'project',
      pluralWords: 'projects',
      pluralTitle: 'Projects',
      singularTitle: 'Project',
    })
  })

  test('derives lowercase words and sentence-case titles for user-facing copy', () => {
    const names = deriveFeatureNames('invoice-items', undefined, noExistingNames)
    expect(names.pluralWords).toBe('invoice items')
    expect(names.pluralTitle).toBe('Invoice items')
    expect(names.singularTitle).toBe('Invoice item')
  })

  test('derives every casing for a hyphenated plural name', () => {
    const names = deriveFeatureNames('invoice-items', undefined, noExistingNames)
    expect(names.singularKebab).toBe('invoice-item')
    expect(names.pluralPascal).toBe('InvoiceItems')
    expect(names.singularPascal).toBe('InvoiceItem')
    expect(names.pluralCamel).toBe('invoiceItems')
    expect(names.singularCamel).toBe('invoiceItem')
  })

  test('accepts an explicit --singular override for an irregular plural', () => {
    const names = deriveFeatureNames('people', 'person', noExistingNames)
    expect(names.singularKebab).toBe('person')
    expect(names.singularPascal).toBe('Person')
  })

  test('rejects a non-kebab-case name', () => {
    expect(() => deriveFeatureNames('Projects', undefined, noExistingNames)).toThrow(ScaffoldError)
    expect(() => deriveFeatureNames('invoice_items', undefined, noExistingNames)).toThrow(ScaffoldError)
  })

  test('rejects a reserved name', () => {
    for (const reserved of reservedFeatureNames) {
      expect(() => deriveFeatureNames(reserved, undefined, noExistingNames)).toThrow(ScaffoldError)
    }
  })

  test('requires --singular when the plural cannot be guessed', () => {
    expect(() => deriveFeatureNames('data', undefined, noExistingNames)).toThrow(ScaffoldError)
    expect(() => deriveFeatureNames('quizzes', undefined, noExistingNames)).toThrow(ScaffoldError)
    expect(deriveFeatureNames('quizzes', 'quiz', noExistingNames).singularPascal).toBe('Quiz')
  })

  test('rejects a name colliding with an existing backend module', () => {
    const existing = { ...noExistingNames, backendModules: ['projects'] }
    expect(() => deriveFeatureNames('projects', undefined, existing)).toThrow(ScaffoldError)
  })

  test('rejects a name colliding with an existing webapp feature', () => {
    const existing = { ...noExistingNames, webappFeatures: ['projects'] }
    expect(() => deriveFeatureNames('projects', undefined, existing)).toThrow(ScaffoldError)
  })

  test('rejects a name colliding with an existing contracts file', () => {
    const existing = { ...noExistingNames, contractFiles: ['projects'] }
    expect(() => deriveFeatureNames('projects', undefined, existing)).toThrow(ScaffoldError)
  })

  test('rejects a singular that collides with an existing Prisma model', () => {
    const existing = { ...noExistingNames, prismaModelNames: ['Project'] }
    expect(() => deriveFeatureNames('projects', undefined, existing)).toThrow(ScaffoldError)
  })

  test('rejects a name whose back-relation collides with an existing User field', () => {
    const existing = { ...noExistingNames, userFields: ['projects'] }
    expect(() => deriveFeatureNames('projects', undefined, existing)).toThrow(ScaffoldError)
  })

  test('rejects a name whose table collides with an existing mapped table', () => {
    const existing = { ...noExistingNames, tableNames: ['invoice_items'] }
    expect(() => deriveFeatureNames('invoice-items', undefined, existing)).toThrow(ScaffoldError)
  })

  test('rejects a name whose generated contract exports collide with existing ones', () => {
    const existing = { ...noExistingNames, contractExports: ['projectSchema'] }
    expect(() => deriveFeatureNames('projects', undefined, existing)).toThrow(ScaffoldError)
  })
})

describe('collectExistingNames', () => {
  test('reads real module, feature, contract, and Prisma model names from this repository', () => {
    const existing = collectExistingNames()
    expect(existing.backendModules).toContain('users')
    expect(existing.webappFeatures).toContain('admin')
    expect(existing.contractFiles).toContain('users')
    expect(existing.prismaModelNames).toContain('User')
  })

  test('rejects real collisions in this repository, none of them a reserved name', () => {
    const existing = collectExistingNames()
    // A Prisma model (PasswordResetToken), a User field (sessions), a contract export (emailSchema).
    for (const name of ['password-reset-tokens', 'sessions', 'emails']) {
      expect(reservedFeatureNames.has(name)).toBe(false)
      expect(() => deriveFeatureNames(name, undefined, existing)).toThrow(ScaffoldError)
    }
    expect(() => deriveFeatureNames('projects', undefined, existing)).not.toThrow()
  })
})

describe('generatedFiles', () => {
  test('every generated file lives under the feature name and nothing collides across layers', () => {
    const names = deriveFeatureNames('projects', undefined, noExistingNames)
    const files = generatedFiles(names)
    const paths = files.map((file) => file.path)

    expect(new Set(paths).size).toBe(paths.length)
    expect(paths).toContain('packages/contracts/src/projects.ts')
    expect(paths).toContain('backend/src/modules/projects/index.ts')
    expect(paths).toContain('backend/src/modules/projects/projects.integration.test.ts')
    expect(paths).toContain('backend/prisma/schema/projects.prisma')
    expect(paths).toContain('webapp/src/features/projects/index.ts')
    expect(paths).toContain('webapp/tests/projects-model.test.ts')
  })

  test('no generated file binds the same top-level name twice, whatever the feature is called', () => {
    // "media" with singular "media-item" names its list hook useMediaQuery, like the shared
    // viewport hook the list component also imports.
    for (const [plural, singular] of [['media', 'media-item'], ['items', undefined], ['invoice-items', undefined]]) {
      const names = deriveFeatureNames(plural, singular, noExistingNames)
      for (const file of generatedFiles(names)) {
        if (!/\.tsx?$/.test(file.path)) continue
        const bindings = topLevelBindings(file.content)
        const duplicates = bindings.filter((name, index) => bindings.indexOf(name) !== index)
        expect({ file: file.path, duplicates }).toEqual({ file: file.path, duplicates: [] })
      }
    }
  })

  test('every generated file is non-empty and every backend/webapp file balances braces', () => {
    const names = deriveFeatureNames('invoice-items', undefined, noExistingNames)
    for (const file of generatedFiles(names)) {
      expect(file.content.length).toBeGreaterThan(0)
      if (file.path.endsWith('.ts') || file.path.endsWith('.tsx')) {
        const opens = [...file.content].filter((character) => character === '{').length
        const closes = [...file.content].filter((character) => character === '}').length
        expect(opens).toBe(closes)
      }
    }
  })
})

describe('markerEdits and applyMarkerEdits', () => {
  test('inserts before the marker and keeps the marker line intact', () => {
    const names = deriveFeatureNames('projects', undefined, noExistingNames)
    const fileContents = new Map([
      ['a.ts', 'first\n// scaffold:contracts-exports\nlast'],
    ])
    const edits = [
      { filePath: 'a.ts', marker: '// scaffold:contracts-exports', insertedLines: ["export * from './projects'"] },
    ]
    const updated = applyMarkerEdits(fileContents, edits)
    expect(updated.get('a.ts')).toBe(
      "first\nexport * from './projects'\n// scaffold:contracts-exports\nlast",
    )
  })

  test('preserves the marker line indentation for the inserted lines', () => {
    const fileContents = new Map([
      ['a.ts', 'first\n    // scaffold:route\nlast'],
    ])
    const edits = [{ filePath: 'a.ts', marker: '// scaffold:route', insertedLines: ["'/app/projects',"] }]
    const updated = applyMarkerEdits(fileContents, edits)
    expect(updated.get('a.ts')).toBe("first\n    '/app/projects',\n    // scaffold:route\nlast")
  })

  test('throws a clear error when a marker is missing, and touches nothing', () => {
    const fileContents = new Map([['a.ts', 'no marker here']])
    const edits = [{ filePath: 'a.ts', marker: '// scaffold:missing', insertedLines: ['x'] }]
    expect(() => applyMarkerEdits(fileContents, edits)).toThrow(/Marker.*was not found/)
  })

  test('every marker this generator relies on is present in the real repository files', () => {
    const names = deriveFeatureNames('projects', undefined, noExistingNames)
    const edits = markerEdits(names)
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const filesToRead = [...new Set(edits.map((edit) => edit.filePath))]
    const fileContents = new Map(
      filesToRead.map((relativePath) => [relativePath, readFileSync(path.join(root, relativePath), 'utf8')]),
    )
    expect(() => applyMarkerEdits(fileContents, edits)).not.toThrow()
  })
})

describe('runScaffold', () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

  // The files the generator reads or edits, copied into a scratch root it can safely write to.
  function fixtureRoot() {
    const root = mkdtempSync(path.join(tmpdir(), 'scaffold-feature-unit-'))
    const names = deriveFeatureNames('projects', undefined, noExistingNames)
    const copied = [
      ...new Set(markerEdits(names).map((edit) => edit.filePath)),
      'backend/prisma/schema',
      'packages/contracts/src',
    ]
    for (const relativePath of copied) {
      mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true })
      cpSync(path.join(repositoryRoot, relativePath), path.join(root, relativePath), { recursive: true })
    }
    for (const directory of ['backend/src/modules/users', 'webapp/src/features/users', 'webapp/tests']) {
      mkdirSync(path.join(root, directory), { recursive: true })
    }
    return root
  }

  function snapshot(root) {
    return readdirSync(root, { recursive: true, withFileTypes: true })
      .map((entry) => {
        const absolutePath = path.join(entry.parentPath, entry.name)
        const relativePath = path.relative(root, absolutePath)
        return entry.isFile() ? `${relativePath}\n${readFileSync(absolutePath, 'utf8')}` : `${relativePath}/`
      })
      .sort()
  }

  test('a failure after writing, such as prisma generate, leaves the tree exactly as it was', async () => {
    const root = fixtureRoot()
    try {
      const before = snapshot(root)
      const failingGenerate = () => {
        throw new ScaffoldError('prisma generate failed')
      }
      await expect(runScaffold(['projects'], root, { generate: failingGenerate, log: () => {} })).rejects.toThrow(
        ScaffoldError,
      )
      expect(snapshot(root)).toEqual(before)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('refuses, before writing, a name whose identifiers or paths already occur in a file it edits', async () => {
    // userSettingsRoute already exists in routes.tsx; '/app/profile' in the navigation and the
    // sidebar icon map.
    for (const argv of [['user-settings'], ['profile', '--singular', 'profile-entry']]) {
      const root = fixtureRoot()
      try {
        const before = snapshot(root)
        await expect(runScaffold(argv, root, { generate: () => {}, log: () => {} })).rejects.toThrow(/already occurs/)
        expect(snapshot(root)).toEqual(before)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  })

  test('SIGINT or SIGTERM during prisma generate rolls everything back and exits 130 or 143', async () => {
    for (const [signal, expectedCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
      const root = fixtureRoot()
      try {
        const before = snapshot(root)
        const driver = path.join(root, '..', `${path.basename(root)}-driver.mjs`)
        writeFileSync(
          driver,
          `import { runScaffold } from ${JSON.stringify(path.join(repositoryRoot, 'scripts/scaffold-feature.mjs'))}\n` +
            `await runScaffold(['projects'], ${JSON.stringify(root)}, {\n` +
            `  log: () => {},\n` +
            `  generate: () => { console.log('GENERATING'); return new Promise((resolve) => setTimeout(resolve, 60_000)) },\n` +
            `})\n`,
        )
        try {
          const child = spawn(process.execPath, [driver], { stdio: ['ignore', 'pipe', 'inherit'] })
          const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)))
          await new Promise((resolve, reject) => {
            child.stdout.on('data', (chunk) => chunk.toString().includes('GENERATING') && resolve())
            child.once('exit', () => reject(new Error('driver exited before generate started')))
          })
          child.kill(signal)
          expect(await exited).toBe(expectedCode)
          expect(snapshot(root)).toEqual(before)
        } finally {
          rmSync(driver, { force: true })
        }
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  }, 30_000)
})

// Names a TypeScript module binds at the top level: every import binding (after `as`) and every
// top-level declaration. Two equal entries are a duplicate identifier.
function topLevelBindings(source) {
  const bindings = []
  for (const match of source.matchAll(/^import\s+(?:type\s+)?\{([^}]*)\}\s+from/gm)) {
    for (const specifier of match[1].split(',')) {
      const name = specifier.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim()
      if (name) bindings.push(name)
    }
  }
  for (const match of source.matchAll(/^import\s+(?:type\s+)?(\w+)\s*(?:,|from)/gm)) bindings.push(match[1])
  for (const match of source.matchAll(/^(?:export\s+)?(?:const|let|type|interface|class|(?:async\s+)?function)\s+(\w+)/gm)) {
    bindings.push(match[1])
  }
  return bindings
}
