import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoots = [
  'backend/src',
  'packages/contracts/src',
  'webapp/src',
  'website/src',
  'mobile/src',
]
const sourceExtension = /\.(?:[cm]?[jt]sx?)$/
const importPattern = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g
const runtimeModulePattern = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g
/**
 * Packages that belong to a delivery mechanism, not to business rules. Application layers and the
 * shared contracts both refuse them, for the same reason and with the same list.
 */
const frameworkPackages = [
  '@prisma/',
  'pg',
  'hono',
  // Scoped siblings are separate packages: a 'hono' or '@aws-sdk/' entry does not cover them.
  '@hono/',
  '@aws-sdk/',
  '@smithy/',
  'expo-',
  'react',
  'react-native',
  'jose',
]
const applicationForbiddenPackages = frameworkPackages
const contractForbiddenPackages = frameworkPackages
// Transport owns the HTTP framework, so it keeps hono; it still refuses persistence and provider SDKs.
const transportForbiddenPackages = ['@prisma/', '@aws-sdk/', '@smithy/', 'jose', 'pg']

export function checkArchitectureSources(files) {
  const violations = []

  for (const file of files) {
    const normalizedPath = normalizePath(file.path)
    const imports = staticImports(file.source)

    for (const imported of imports) {
      const report = (rule, message) => {
        violations.push({
          path: normalizedPath,
          line: imported.line,
          rule,
          message,
        })
      }

      checkBackendLayers(normalizedPath, imported.specifier, report)
      checkBackendModuleBoundary(normalizedPath, imported.specifier, report)
      checkClientBoundary(normalizedPath, imported.specifier, report)
      checkContracts(normalizedPath, imported.specifier, report)
    }
  }

  return violations.sort((left, right) =>
    left.path.localeCompare(right.path) || left.line - right.line || left.rule.localeCompare(right.rule),
  )
}

async function main() {
  const files = []

  for (const sourceRoot of sourceRoots) {
    const absoluteRoot = path.join(repositoryRoot, sourceRoot)
    for (const filePath of await collectSourceFiles(absoluteRoot)) {
      files.push({
        path: path.relative(repositoryRoot, filePath),
        source: await readFile(filePath, 'utf8'),
      })
    }
  }

  const violations = checkArchitectureSources(files)
  if (violations.length === 0) {
    console.log(`Architecture check passed (${files.length} source files).`)
    return
  }

  for (const violation of violations) {
    console.error(`${violation.path}:${violation.line} [${violation.rule}] ${violation.message}`)
  }
  process.exitCode = 1
}

function checkBackendLayers(filePath, specifier, report) {
  const layer = filePath.match(
    /^backend\/src\/modules\/[^/]+\/(domain|application|transport|infrastructure)\//,
  )?.[1]
  if (!layer) return

  const forbiddenPackage = applicationForbiddenPackages.find((name) => packageMatches(specifier, name))
  const importsPrisma = specifier.includes('generated/prisma') || packageMatches(specifier, '@prisma/')
  const target = resolveRepositoryImport(filePath, specifier)
  const targetLayer = target?.match(/^backend\/src\/modules\/[^/]+\/(domain|application|transport|infrastructure)(?:\/|$)/)?.[1]

  if ((layer === 'domain' || layer === 'application') && (forbiddenPackage || importsPrisma)) {
    report(
      `backend-${layer}-dependencies`,
      `${layer} must not import framework, persistence, environment, or provider SDK code (${specifier}).`,
    )
  }

  if (
    (layer === 'domain' || layer === 'application') &&
    (specifier.includes('/env') || specifier.endsWith('/env'))
  ) {
    report(
      `backend-${layer}-dependencies`,
      `${layer} must depend on feature types and ports, not environment or infrastructure (${specifier}).`,
    )
  }

  if (
    layer === 'transport' &&
    (importsPrisma || transportForbiddenPackages.some((name) => packageMatches(specifier, name)))
  ) {
    report(
      'backend-transport-dependencies',
      `transport must not import persistence or provider SDK code (${specifier}).`,
    )
  }

  const invalidTargetLayer =
    (layer === 'domain' && targetLayer && targetLayer !== 'domain') ||
    (layer === 'application' && (targetLayer === 'transport' || targetLayer === 'infrastructure')) ||
    (layer === 'transport' && targetLayer === 'infrastructure') ||
    (layer === 'infrastructure' && targetLayer === 'transport')

  if (invalidTargetLayer) {
    report(
      `backend-${layer}-dependencies`,
      `${layer} must not depend on outer backend layer ${targetLayer} (${specifier}).`,
    )
  }
}

function checkBackendModuleBoundary(filePath, specifier, report) {
  const sourceModule = filePath.match(/^backend\/src\/modules\/([^/]+)\//)?.[1]
  const target = resolveRepositoryImport(filePath, specifier)
  const match = target?.match(/^backend\/src\/modules\/([^/]+)(?:\/(.*))?$/)
  if (!match || match[1] === sourceModule) return

  if (match[2] && match[2] !== 'index' && match[2] !== 'index.ts') {
    const boundaryMessage = sourceModule
      ? `module ${sourceModule} must import module ${match[1]}`
      : `code outside module ${match[1]} must import it`
    report(
      'backend-module-public-api',
      `${boundaryMessage} through its public index (${specifier}).`,
    )
  }
}

function checkClientBoundary(filePath, specifier, report) {
  const client = filePath.match(/^(webapp|mobile)\/src\//)?.[1]
  if (!client) return

  const target = resolveRepositoryImport(filePath, specifier)
  if (!target) return

  const sourceFeature = filePath.match(new RegExp(`^${client}/src/features/([^/]+)/`))?.[1]
  const targetFeature = target.match(new RegExp(`^${client}/src/features/([^/]+)(?:/(.*))?$`))
  if (targetFeature && targetFeature[2] && targetFeature[2] !== 'index' && targetFeature[2] !== 'index.ts') {
    const crossesPublicBoundary = !sourceFeature || targetFeature[1] !== sourceFeature
    if (crossesPublicBoundary) {
      report(
        'client-feature-public-api',
        `code outside feature ${targetFeature[1]} must import it through its public index (${specifier}).`,
      )
    }
  }

  const isLowerLayer =
    filePath.startsWith(`${client}/src/platform/`) ||
    filePath.startsWith(`${client}/src/components/ui/`)
  if (isLowerLayer && targetFeature) {
    report(
      'client-dependency-direction',
      `platform and UI primitives must not import product features (${specifier}).`,
    )
  }
}

function checkContracts(filePath, specifier, report) {
  if (!filePath.startsWith('packages/contracts/src/')) return

  const target = resolveRepositoryImport(filePath, specifier)
  const forbiddenTarget = target && /^(backend|webapp|website|mobile)\//.test(target)
  const forbiddenPackage = contractForbiddenPackages.some((name) => packageMatches(specifier, name))
  if (forbiddenTarget || forbiddenPackage) {
    report(
      'contracts-dependency-direction',
      `contracts must not import backend, client, framework, or provider code (${specifier}).`,
    )
  }
}

function resolveRepositoryImport(importer, specifier) {
  if (specifier.startsWith('.')) {
    return normalizePath(path.normalize(path.join(path.dirname(importer), specifier)))
  }

  if (specifier.startsWith('@/')) {
    const workspace = importer.split('/')[0]
    return `${workspace}/src/${specifier.slice(2)}`
  }

  const workspaceAlias = specifier.match(/^@(web-app-demo)\/(backend|contracts|webapp|website|mobile)(?:\/(.*))?$/)
  if (workspaceAlias) {
    return `${workspaceAlias[2]}/src/${workspaceAlias[3] ?? 'index'}`
  }

  return null
}

function staticImports(source) {
  const scannable = withoutComments(source)
  const imports = []
  for (const pattern of [importPattern, runtimeModulePattern]) {
    for (const match of scannable.matchAll(pattern)) {
      const specifier = match[1]
      if (!specifier) continue
      const specifierOffset = (match.index ?? 0) + match[0].lastIndexOf(specifier)
      imports.push({
        specifier,
        line: scannable.slice(0, specifierOffset).split('\n').length,
      })
    }
  }
  return imports
}

/**
 * Blanks out `//` and `/* *\/` comments so import scanning cannot match text that is commented
 * out, while leaving everything else (including line numbers) untouched. String and template
 * literals are tracked so a `//` inside one, such as a URL, is not mistaken for a comment.
 *
 * Known limit: does not disambiguate regex literals from division, so a `//` or `/*` inside a
 * character class of a regex literal could be misread as a comment start. Real code cannot
 * place a bare (unescaped) `//` in a regex body outside a character class, so this is rare;
 * switch to a real tokenizer (e.g. the TypeScript scanner) if it ever bites.
 */
function withoutComments(source) {
  let output = ''
  let templateDepth = 0
  const exprBraceDepth = []
  let i = 0

  while (i < source.length) {
    const char = source[i]
    const inTemplate = templateDepth > 0 && exprBraceDepth[templateDepth - 1] === -1

    if (inTemplate) {
      if (char === '\\') {
        output += source.slice(i, i + 2)
        i += 2
      } else if (char === '`') {
        templateDepth--
        exprBraceDepth.pop()
        output += char
        i++
      } else if (char === '$' && source[i + 1] === '{') {
        exprBraceDepth[templateDepth - 1] = 0
        output += '${'
        i += 2
      } else {
        output += char
        i++
      }
      continue
    }

    if (char === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i)
      const stop = end === -1 ? source.length : end
      output += ' '.repeat(stop - i)
      i = stop
      continue
    }

    if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? source.length : end + 2
      output += source.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
      continue
    }

    if (char === "'" || char === '"') {
      let j = i + 1
      while (j < source.length && source[j] !== char) j += source[j] === '\\' ? 2 : 1
      j = Math.min(j + 1, source.length)
      output += source.slice(i, j)
      i = j
      continue
    }

    if (char === '`') {
      templateDepth++
      exprBraceDepth.push(-1)
      output += char
      i++
      continue
    }

    if (templateDepth > 0 && char === '{') {
      exprBraceDepth[templateDepth - 1]++
      output += char
      i++
      continue
    }

    if (templateDepth > 0 && char === '}') {
      if (exprBraceDepth[templateDepth - 1] === 0) {
        exprBraceDepth[templateDepth - 1] = -1
      } else {
        exprBraceDepth[templateDepth - 1]--
      }
      output += char
      i++
      continue
    }

    output += char
    i++
  }

  return output
}

async function collectSourceFiles(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  const files = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await collectSourceFiles(entryPath)))
    else if (sourceExtension.test(entry.name)) files.push(entryPath)
  }
  return files
}

function normalizePath(filePath) {
  return filePath.replaceAll(path.sep, '/')
}

function packageMatches(specifier, packagePrefix) {
  if (packagePrefix.endsWith('/')) return specifier.startsWith(packagePrefix)
  return specifier === packagePrefix || specifier.startsWith(`${packagePrefix}/`)
}

if (import.meta.main) await main()
