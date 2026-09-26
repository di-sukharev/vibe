import { existsSync, readFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Workspace packages share one npm scope. Read it from the contracts package so a project rename
// keeps the alias rules working.
const workspaceScope = JSON.parse(
  readFileSync(path.join(repositoryRoot, 'packages/contracts/package.json'), 'utf8'),
).name.split('/')[0]
// Every client the workspace could have, kept only for the ones actually checked out. The
// `mobile` app lives on its own branch: on this one its directory is absent, `clientNames` drops
// it, and every client-scoped rule below simply has nothing to check there.
const clientNames = ['webapp', 'website', 'mobile'].filter((name) =>
  existsSync(path.join(repositoryRoot, name, 'src')),
)
const workspaceAliasPattern = new RegExp(
  `^${workspaceScope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(backend|contracts|${clientNames.join('|')})(?:/(.*))?$`,
)
const sourceRoots = [
  'backend/src',
  'packages/contracts/src',
  ...clientNames.map((name) => `${name}/src`),
]
const sourceExtension = /\.(?:[cm]?[jt]sx?)$/
// The clause before `from` cannot cross a quote, so a side-effect import (`import 'x'`) is not
// swallowed into the next statement's `from '...'`.
const importPattern = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g
const runtimeModulePattern = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const innerLayerAllowedPackages = [`${workspaceScope}/contracts`, 'zod']
const contractAllowedPackages = ['zod']
const transportForbiddenPackages = ['@prisma/', '@aws-sdk/', 'jose', 'pg']

export function checkArchitectureSources(files) {
  const violations = []

  for (const file of files) {
    const normalizedPath = normalizePath(file.path)
    const imports = staticImports(file.source)

    checkBackendModulePlacement(normalizedPath, (rule, message) => {
      violations.push({ path: normalizedPath, line: 1, rule, message })
    })

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

  checkClientFeatureCycles(files, violations)

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
    /^backend\/src\/modules\/[^/]+\/(domain|application|infrastructure|transport)\//,
  )?.[1]
  if (!layer) return

  const target = resolveRepositoryImport(filePath, specifier)
  const targetLayer = target?.match(
    /^backend\/src\/modules\/[^/]+\/(domain|application|infrastructure|transport)(?:\/|$)/,
  )?.[1]
  const forbiddenPackage =
    isPackageImport(specifier) &&
    !packageAllowed(specifier, innerLayerAllowedPackages, filePath)
  const importsPrisma =
    specifier.includes('generated/prisma') ||
    packageMatches(specifier, '@prisma/') ||
    target?.startsWith('backend/src/generated/prisma')
  // Backend code outside the modules is runtime: env, db, HTTP, storage and email adapters. Inner
  // layers reach it only through a `port` file, which holds types and no provider code.
  const importsBackendRuntime =
    target?.startsWith('backend/src/') &&
    !target.startsWith('backend/src/modules/') &&
    !target.endsWith('/port')

  if (
    (layer === 'domain' || layer === 'application') &&
    (forbiddenPackage || importsPrisma || importsBackendRuntime)
  ) {
    report(
      `backend-${layer}-dependencies`,
      `${layer} must not import framework, persistence, environment, or provider SDK code (${specifier}).`,
    )
  }

  const invalidInnerTarget =
    (layer === 'domain' && targetLayer && targetLayer !== 'domain') ||
    (layer === 'application' &&
      (targetLayer === 'infrastructure' || targetLayer === 'transport'))

  if (invalidInnerTarget && !importsBackendRuntime) {
    report(
      `backend-${layer}-dependencies`,
      `${layer} must depend on domain types and application ports, not outer layers (${specifier}).`,
    )
  }

  if (
    layer === 'transport' &&
    (
      importsPrisma ||
      target === 'backend/src/db' ||
      targetLayer === 'infrastructure' ||
      transportForbiddenPackages.some((name) => packageMatches(specifier, name))
    )
  ) {
    report(
      'backend-transport-dependencies',
      `transport must not import persistence, module infrastructure, or provider SDK code (${specifier}).`,
    )
  }

  if (
    layer === 'infrastructure' &&
    (target?.startsWith('backend/src/http/') || targetLayer === 'transport')
  ) {
    report(
      'backend-infrastructure-dependencies',
      `infrastructure must not depend on HTTP transport code (${specifier}).`,
    )
  }
}

function checkClientFeatureCycles(files, violations) {
  for (const client of clientNames) {
    const edges = []
    const graph = new Map()

    for (const file of files) {
      const normalizedPath = normalizePath(file.path)
      const sourceFeature = normalizedPath.match(
        new RegExp(`^${client}/src/features/([^/]+)/`),
      )?.[1]
      if (!sourceFeature) continue

      for (const imported of staticImports(file.source)) {
        const target = resolveRepositoryImport(normalizedPath, imported.specifier)
        const targetFeature = target?.match(
          new RegExp(`^${client}/src/features/([^/]+)(?:/|$)`),
        )?.[1]
        if (!targetFeature || targetFeature === sourceFeature) continue

        const edge = {
          source: sourceFeature,
          target: targetFeature,
          path: normalizedPath,
          line: imported.line,
          specifier: imported.specifier,
        }
        edges.push(edge)
        const targets = graph.get(sourceFeature) ?? new Set()
        targets.add(targetFeature)
        graph.set(sourceFeature, targets)
      }
    }

    for (const edge of edges) {
      if (!hasGraphPath(graph, edge.target, edge.source)) continue
      violations.push({
        path: edge.path,
        line: edge.line,
        rule: 'client-feature-cycle',
        message: `feature dependency ${edge.source} -> ${edge.target} creates a cycle (${edge.specifier}). Move collaboration into composition or an owning port.`,
      })
    }
  }
}

function hasGraphPath(graph, start, target) {
  const pending = [start]
  const visited = new Set()

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || visited.has(current)) continue
    if (current === target) return true
    visited.add(current)
    pending.push(...(graph.get(current) ?? []))
  }

  return false
}

/**
 * Layer rules key off `modules/<module>/<layer>/`, so a file sitting directly at a module root is
 * reached by none of them: it could import Prisma into what is really domain code and the check
 * would still pass. The root belongs to the module's public index and its module-wide tests, and
 * everything else belongs to a layer that has rules.
 */
function checkBackendModulePlacement(filePath, report) {
  const rootFile = filePath.match(/^backend\/src\/modules\/[^/]+\/([^/]+)$/)?.[1]
  if (!rootFile || rootFile === 'index.ts' || /\.test\.[cm]?[jt]sx?$/.test(rootFile)) return

  report(
    'backend-module-layer-placement',
    `${rootFile} must live in a module layer (domain, application, transport, or infrastructure); only the module's public index and its module-wide tests belong at the module root.`,
  )
}

function checkBackendModuleBoundary(filePath, specifier, report) {
  const sourceModule = filePath.match(/^backend\/src\/modules\/([^/]+)\//)?.[1]
  const target = resolveRepositoryImport(filePath, specifier)
  const match = target?.match(/^backend\/src\/modules\/([^/]+)(?:\/(.*))?$/)
  if (!match || match[1] === sourceModule) return

  if (match[2]) {
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
  const client = filePath.match(new RegExp(`^(${clientNames.join('|')})/src/`))?.[1]
  if (!client) return

  const target = resolveRepositoryImport(filePath, specifier)
  if (!target) return

  const sourceFeature = filePath.match(new RegExp(`^${client}/src/features/([^/]+)/`))?.[1]
  const targetFeature = target.match(new RegExp(`^${client}/src/features/([^/]+)(?:/(.*))?$`))
  if (targetFeature?.[2]) {
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
  const forbiddenPackage =
    isPackageImport(specifier) &&
    !packageAllowed(specifier, contractAllowedPackages, filePath)
  if (forbiddenTarget || forbiddenPackage) {
    report(
      'contracts-dependency-direction',
      `contracts must not import backend, client, framework, or provider code (${specifier}).`,
    )
  }
}

/**
 * Returns the imported module as an extensionless repository path, with any trailing `/index`
 * dropped, so `../env`, `../env.js`, and `../env.ts` all resolve to `backend/src/env` and every
 * rule below compares one spelling. Bundler resolution maps `.js` onto `.ts`, so all of them
 * compile.
 */
function resolveRepositoryImport(importer, specifier) {
  const target = resolveRepositoryPath(importer, specifier)
  return target?.replace(/\.[cm]?[jt]sx?$/, '').replace(/\/index$/, '') ?? null
}

function resolveRepositoryPath(importer, specifier) {
  if (specifier.startsWith('.')) {
    return normalizePath(path.normalize(path.join(path.dirname(importer), specifier)))
  }

  if (specifier.startsWith('@/')) {
    const workspace = importer.split('/')[0]
    return `${workspace}/src/${specifier.slice(2)}`
  }

  const workspaceAlias = specifier.match(workspaceAliasPattern)
  if (workspaceAlias) {
    return `${workspaceAlias[1]}/src/${workspaceAlias[2] ?? 'index'}`
  }

  return null
}

function staticImports(source) {
  const imports = []
  for (const pattern of [importPattern, runtimeModulePattern]) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]
      if (!specifier) continue
      const specifierOffset = (match.index ?? 0) + match[0].lastIndexOf(specifier)
      imports.push({
        specifier,
        line: source.slice(0, specifierOffset).split('\n').length,
      })
    }
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

function isPackageImport(specifier) {
  return !specifier.startsWith('.') && !specifier.startsWith('@/')
}

function packageAllowed(specifier, allowedPackages, filePath) {
  if (/\.test\.[cm]?[jt]sx?$/.test(filePath) && specifier === 'bun:test') return true
  return allowedPackages.some((allowed) => packageMatches(specifier, allowed))
}

if (import.meta.main) await main()
