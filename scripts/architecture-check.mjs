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
const applicationForbiddenPackages = [
  '@prisma/',
  'hono',
  '@aws-sdk/',
  'expo-',
  'react',
  'react-native',
  'jose',
]
const contractForbiddenPackages = [
  '@prisma/',
  'hono',
  'react',
  'react-native',
  'expo-',
  '@aws-sdk/',
]

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
  const layer = filePath.match(/^backend\/src\/modules\/[^/]+\/(domain|application|transport)\//)?.[1]
  if (!layer) return

  const forbiddenPackage = applicationForbiddenPackages.find((name) => packageMatches(specifier, name))
  const importsPrisma = specifier.includes('generated/prisma') || packageMatches(specifier, '@prisma/')

  if ((layer === 'domain' || layer === 'application') && (forbiddenPackage || importsPrisma)) {
    report(
      `backend-${layer}-dependencies`,
      `${layer} must not import framework, persistence, environment, or provider SDK code (${specifier}).`,
    )
  }

  if (
    (layer === 'domain' || layer === 'application') &&
    (specifier.includes('/env') || specifier.endsWith('/env') || specifier.includes('/infrastructure/'))
  ) {
    report(
      `backend-${layer}-dependencies`,
      `${layer} must depend on feature types and ports, not environment or infrastructure (${specifier}).`,
    )
  }

  if (layer === 'transport' && importsPrisma) {
    report('backend-transport-dependencies', `transport must not import Prisma (${specifier}).`)
  }
}

function checkBackendModuleBoundary(filePath, specifier, report) {
  const sourceModule = filePath.match(/^backend\/src\/modules\/([^/]+)\//)?.[1]
  if (!sourceModule) return

  const target = resolveRepositoryImport(filePath, specifier)
  const match = target?.match(/^backend\/src\/modules\/([^/]+)(?:\/(.*))?$/)
  if (!match || match[1] === sourceModule) return

  if (match[2] && match[2] !== 'index' && match[2] !== 'index.ts') {
    report(
      'backend-module-public-api',
      `module ${sourceModule} must import module ${match[1]} through its public index (${specifier}).`,
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
  if (sourceFeature && targetFeature && targetFeature[1] !== sourceFeature) {
    if (targetFeature[2] && targetFeature[2] !== 'index' && targetFeature[2] !== 'index.ts') {
      report(
        'client-feature-public-api',
        `feature ${sourceFeature} must import feature ${targetFeature[1]} through its public index (${specifier}).`,
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
  const imports = []
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1]
    if (!specifier) continue
    const specifierOffset = (match.index ?? 0) + match[0].lastIndexOf(specifier)
    imports.push({
      specifier,
      line: source.slice(0, specifierOffset).split('\n').length,
    })
  }
  return imports
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
